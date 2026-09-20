package v1

import (
	"cmp"
	"context"
	"log/slog"
	"slices"
	"strings"
	"sync"

	"github.com/pkg/errors"
	"golang.org/x/sync/errgroup"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/usememos/memos/internal/ratelimit"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/provider/ai/decision"
	decisionopenrouter "github.com/usememos/memos/provider/ai/decision/openrouter"
	"github.com/usememos/memos/store"
)

// Experimental "find related notes" prototype tuning. All values are starting
// points; adjust after real-world testing.
const (
	// relatedNotesCandidateLimit caps how many memos are compared against the
	// source memo. Each candidate costs one Jev call, so this bounds cost and
	// latency regardless of how wide the retrieval windows are.
	relatedNotesCandidateLimit = 30
	// relatedNotesRecentLimit bounds the recency window: how many of the
	// caller's most recently updated readable memos feed the candidate merge.
	relatedNotesRecentLimit = 15
	// relatedNotesSearchLimit bounds how many candidates the keyword search may
	// contribute. Search hits are recall insurance for old notes that share
	// vocabulary with the source and would fall outside the recency window.
	relatedNotesSearchLimit = 15
	// relatedNotesKeywordLimit caps how many distinct keywords are extracted
	// from the source memo for the search filter.
	relatedNotesKeywordLimit = 8
	// relatedNotesResultLimit caps how many matches are returned.
	relatedNotesResultLimit = 8
	// relatedNotesMinRelevance drops matches below this combined score. Jev's
	// calibrated noul output is conservative: even clearly related short memos
	// rarely exceed ~0.45 on a single question (Hello↔hola scored 0.37 while
	// gibberish noise scored ~0.09), so the bar must sit well below 0.5.
	relatedNotesMinRelevance = 0.25
	// relatedNotesMaxMemoChars truncates each memo in a comparison state so a
	// very long memo cannot dominate the pair's prompt.
	relatedNotesMaxMemoChars = 2000
	// relatedNotesConcurrency bounds parallel Jev calls per request.
	relatedNotesConcurrency = 5
)

// Relevance weights: keep small so the combined score stays readable.
const (
	relatedNotesWeightSameTopic    = 0.4
	relatedNotesWeightSameProblem  = 0.35
	relatedNotesWeightContinuation = 0.25
)

// relatedNotesQuestions compare the source memo (named in the state) with the
// candidate memo. Each question must be answerable from the pair alone.
var relatedNotesQuestions = map[string]decision.Question{
	"same_topic":   {Type: "noul", Instructions: "The state contains a SOURCE memo and a CANDIDATE memo. Are the source memo and the candidate memo primarily about the same subject, concept, or area of interest?"},
	"same_problem": {Type: "noul", Instructions: "The state contains a SOURCE memo and a CANDIDATE memo. Do these memos concern the same underlying problem, goal, or challenge, even if one memo describes the problem and the other proposes an approach or solution?"},
	"continuation": {Type: "noul", Instructions: "The state contains a SOURCE memo and a CANDIDATE memo. Does one memo continue, develop, answer, revisit, or resolve the thought expressed in the other?"},
}

// FindRelatedMemos compares a readable source memo against a bounded set of the
// caller's other readable memos and returns the strongest semantic matches.
func (s *APIV1Service) FindRelatedMemos(ctx context.Context, request *v1pb.FindRelatedMemosRequest) (*v1pb.FindRelatedMemosResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	if err := s.throttleAndCharge(ratelimit.ScopeSemanticAnalysisUser, userKey(user.ID), 1); err != nil {
		return nil, err
	}
	uid, err := ExtractMemoUIDFromName(request.GetMemo())
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid memo name: %v", err)
	}
	source, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &uid})
	if err != nil {
		return nil, errors.Wrap(err, "failed to get memo")
	}
	if source == nil {
		return nil, status.Errorf(codes.NotFound, "memo not found")
	}
	if err := s.checkMemoReadAccess(ctx, source); err != nil {
		return nil, err
	}
	sourceContent := strings.TrimSpace(source.Content)
	if sourceContent == "" {
		return nil, status.Errorf(codes.InvalidArgument, "memo content is required")
	}
	accessScope, _, err := s.resolveMemoAccessScope(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to resolve memo access: %v", err)
	}
	provider, err := s.resolveSemanticAnalysisProvider(ctx)
	if err != nil {
		return nil, err
	}
	client, err := decisionopenrouter.New(provider)
	if err != nil {
		return nil, status.Errorf(codes.FailedPrecondition, "semantic analysis provider is invalid: %v", err)
	}

	// Candidate selection: a hybrid of two bounded windows merged under one
	// hard cap, so Jev cost and latency stay flat. (1) The caller's most recent
	// readable memos. (2) Memos matching keywords extracted from the source,
	// through the CEL filter engine. The access scope is applied as a database
	// predicate in both, so nothing unreadable is ever fetched. The search step
	// is recall insurance — Jev makes the semantic call either way.
	candidates, err := s.listRelatedCandidates(ctx, accessScope, source)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list candidate memos: %v", err)
	}
	pairs := candidates

	results, model, err := evaluateRelatedMemoPairs(ctx, client, sourceContent, pairs)
	if err != nil {
		return nil, err
	}
	matches := make([]*v1pb.RelatedMemoResult, 0, len(results))
	for _, result := range results {
		relevance := relatedNotesWeightSameTopic*result.sameTopic +
			relatedNotesWeightSameProblem*result.sameProblem +
			relatedNotesWeightContinuation*result.continuation
		if relevance < relatedNotesMinRelevance {
			continue
		}
		matches = append(matches, &v1pb.RelatedMemoResult{
			Memo:         "memos/" + result.memo.UID,
			SameTopic:    result.sameTopic,
			SameProblem:  result.sameProblem,
			Continuation: result.continuation,
			Relevance:    relevance,
			Snippet:      memoSnippet(result.memo.Content),
		})
	}
	sortRelatedMemoResults(matches)
	if len(matches) > relatedNotesResultLimit {
		matches = matches[:relatedNotesResultLimit]
	}
	return &v1pb.FindRelatedMemosResponse{Results: matches, Model: model}, nil
}

// listRelatedCandidates builds the candidate set for one FindRelatedMemos run:
// keyword-matched memos first, then the recency window, deduplicated and cut
// to the total candidate cap.
func (s *APIV1Service) listRelatedCandidates(
	ctx context.Context,
	accessScope *store.MemoAccessScope,
	source *store.Memo,
) ([]*store.Memo, error) {
	recent, err := s.listRecentCandidates(ctx, accessScope, source)
	if err != nil {
		return nil, err
	}
	searchHits := s.listKeywordCandidates(ctx, accessScope, source)
	return mergeRelatedCandidates(searchHits, recent, relatedNotesCandidateLimit), nil
}

// listRecentCandidates returns the caller's most recently updated readable
// memos, excluding the source and empty-content memos.
func (s *APIV1Service) listRecentCandidates(
	ctx context.Context,
	accessScope *store.MemoAccessScope,
	source *store.Memo,
) ([]*store.Memo, error) {
	state := store.Normal
	limit := relatedNotesRecentLimit + 1 // the source memo may be among the newest.
	candidates, err := s.Store.ListMemos(ctx, &store.FindMemo{
		Access:           accessScope,
		RowStatus:        &state,
		ExcludeComments:  true,
		OrderByUpdatedTs: true,
		Limit:            &limit,
	})
	if err != nil {
		return nil, err
	}
	return usableRelatedCandidates(candidates, source), nil
}

// listKeywordCandidates returns readable memos whose content contains keywords
// extracted from the source memo. The query is best-effort: on failure the run
// degrades to the recency window instead of failing the request.
func (s *APIV1Service) listKeywordCandidates(
	ctx context.Context,
	accessScope *store.MemoAccessScope,
	source *store.Memo,
) []*store.Memo {
	keywords := extractMemoKeywords(source.Content, relatedNotesKeywordLimit)
	if len(keywords) == 0 {
		return nil
	}
	state := store.Normal
	limit := relatedNotesSearchLimit + 1 // the source memo matches its own keywords.
	candidates, err := s.Store.ListMemos(ctx, &store.FindMemo{
		Access:           accessScope,
		RowStatus:        &state,
		ExcludeComments:  true,
		OrderByUpdatedTs: true,
		Filters:          []string{buildMemoKeywordFilter(keywords)},
		Limit:            &limit,
	})
	if err != nil {
		slog.Info("related notes keyword search failed; using recency window only", slog.Any("error", err))
		return nil
	}
	return usableRelatedCandidates(candidates, source)
}

// usableRelatedCandidates drops the source memo and empty-content memos from a
// query result.
func usableRelatedCandidates(candidates []*store.Memo, source *store.Memo) []*store.Memo {
	usable := make([]*store.Memo, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate.ID == source.ID || strings.TrimSpace(candidate.Content) == "" {
			continue
		}
		usable = append(usable, candidate)
	}
	return usable
}

// mergeRelatedCandidates unions the two windows, deduplicating by ID with the
// search hits first, cut to cap.
func mergeRelatedCandidates(searchHits, recent []*store.Memo, cap int) []*store.Memo {
	seen := make(map[int32]struct{}, cap)
	merged := make([]*store.Memo, 0, cap)
	for _, window := range [][]*store.Memo{searchHits, recent} {
		for _, memo := range window {
			if _, duplicate := seen[memo.ID]; duplicate {
				continue
			}
			seen[memo.ID] = struct{}{}
			merged = append(merged, memo)
			if len(merged) == cap {
				return merged
			}
		}
	}
	return merged
}

// relatedComparison is one candidate's Jev judgment against the source memo.
type relatedComparison struct {
	memo         *store.Memo
	sameTopic    float64
	sameProblem  float64
	continuation float64
}

// evaluateRelatedMemoPairs sends one Jev decision per candidate, bounded by a
// small worker pool so a full run finishes in one round of provider calls.
func evaluateRelatedMemoPairs(
	ctx context.Context,
	client decision.Client,
	sourceContent string,
	candidates []*store.Memo,
) ([]*relatedComparison, string, error) {
	comparisons := make([]*relatedComparison, len(candidates))
	group, groupCtx := errgroup.WithContext(ctx)
	group.SetLimit(relatedNotesConcurrency)
	var model string
	var modelOnce sync.Once // provider-reported model; any call's answer is fine.
	for index, candidate := range candidates {
		group.Go(func() error {
			result, err := client.Evaluate(groupCtx, decision.Request{
				Model:     semanticAnalysisModel,
				State:     buildRelatedNotesState(sourceContent, candidate.Content),
				Questions: relatedNotesQuestions,
			})
			if err != nil {
				return errors.Wrapf(err, "failed to compare memo %s", candidate.UID)
			}
			answer := func(id string) float64 { return result.Answers[id].Noul }
			comparisons[index] = &relatedComparison{
				memo:         candidate,
				sameTopic:    answer("same_topic"),
				sameProblem:  answer("same_problem"),
				continuation: answer("continuation"),
			}
			modelOnce.Do(func() { model = result.Model })
			return nil
		})
	}
	if err := group.Wait(); err != nil {
		return nil, "", status.Errorf(codes.Unavailable, "semantic comparison failed: %v", err)
	}
	return comparisons, model, nil
}

// relatedNotesKeywordTrimChars are stripped from both ends of a whitespace
// token before it can become a keyword. Hashtags lose their marker on purpose.
const relatedNotesKeywordTrimChars = " \t\r\n.,;:!?()[]{}<>\"'*`~-_=+/\\|&%$#@^"

// relatedNotesStopwords is a small English stopword list. Words in other
// languages pass through; a spurious keyword only costs a cheap database
// predicate, never a Jev call.
var relatedNotesStopwords = map[string]struct{}{
	"about": {}, "after": {}, "all": {}, "also": {}, "and": {}, "any": {}, "are": {},
	"because": {}, "been": {}, "before": {}, "but": {}, "can": {}, "could": {}, "did": {},
	"does": {}, "for": {}, "from": {}, "had": {}, "has": {}, "have": {}, "here": {},
	"him": {}, "his": {}, "how": {}, "into": {}, "its": {}, "just": {}, "like": {},
	"not": {}, "now": {}, "only": {}, "our": {}, "out": {}, "over": {}, "she": {},
	"should": {}, "some": {}, "such": {}, "than": {}, "that": {}, "the": {}, "their": {},
	"them": {}, "then": {}, "there": {}, "these": {}, "they": {}, "this": {}, "too": {},
	"was": {}, "were": {}, "what": {}, "when": {}, "where": {}, "which": {}, "who": {},
	"will": {}, "with": {}, "would": {}, "you": {}, "your": {},
}

// extractMemoKeywords picks up to limit distinct words from the source memo,
// ranked by frequency. Keywords feed a database pre-filter only, so precision
// matters little; recall and cheapness matter.
func extractMemoKeywords(content string, limit int) []string {
	scan := []rune(strings.TrimSpace(content))
	if len(scan) > relatedNotesMaxMemoChars {
		scan = scan[:relatedNotesMaxMemoChars]
	}
	counts := make(map[string]int)
	order := make([]string, 0, limit)
	for _, field := range strings.Fields(string(scan)) {
		word := strings.ToLower(strings.Trim(field, relatedNotesKeywordTrimChars))
		if len([]rune(word)) < 3 {
			continue
		}
		if _, stop := relatedNotesStopwords[word]; stop {
			continue
		}
		if _, seen := counts[word]; !seen {
			order = append(order, word)
		}
		counts[word]++
	}
	slices.SortStableFunc(order, func(left, right string) int {
		return cmp.Compare(counts[right], counts[left])
	})
	if len(order) > limit {
		order = order[:limit]
	}
	return order
}

// buildMemoKeywordFilter renders the keywords as one CEL OR chain of
// content.contains terms for the memo filter engine.
func buildMemoKeywordFilter(keywords []string) string {
	terms := make([]string, len(keywords))
	for index, keyword := range keywords {
		escaped := strings.ReplaceAll(keyword, `\`, `\\`)
		escaped = strings.ReplaceAll(escaped, `"`, `\"`)
		terms[index] = `content.contains("` + escaped + `")`
	}
	return strings.Join(terms, " || ")
}

// buildRelatedNotesState names the two sides explicitly so every question can
// refer to "the source memo" and "the candidate memo" unambiguously.
func buildRelatedNotesState(sourceContent, candidateContent string) string {
	var builder strings.Builder
	builder.WriteString("SOURCE memo:\n")
	builder.WriteString(truncateMemoContent(sourceContent))
	builder.WriteString("\n\nCANDIDATE memo:\n")
	builder.WriteString(truncateMemoContent(candidateContent))
	return builder.String()
}

func truncateMemoContent(content string) string {
	trimmed := strings.TrimSpace(content)
	runes := []rune(trimmed)
	if len(runes) <= relatedNotesMaxMemoChars {
		return trimmed
	}
	return string(runes[:relatedNotesMaxMemoChars]) + "…"
}

// memoSnippet reduces a memo to a short single-line preview for the UI.
func memoSnippet(content string) string {
	compact := strings.Join(strings.Fields(content), " ")
	runes := []rune(compact)
	if len(runes) <= 120 {
		return compact
	}
	return string(runes[:120]) + "…"
}

// sortRelatedMemoResults orders matches by descending relevance.
func sortRelatedMemoResults(results []*v1pb.RelatedMemoResult) {
	slices.SortFunc(results, func(left, right *v1pb.RelatedMemoResult) int {
		return cmp.Compare(right.Relevance, left.Relevance)
	})
}
