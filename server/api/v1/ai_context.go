package v1

import (
	"context"
	"sort"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/usememos/memos/store"
)

const (
	// DefaultChatContextBudgetTokens caps injected note content when the chat
	// config does not set a budget. It is deliberately conservative: the token
	// estimate is a character-ratio heuristic, not real tokenization, so a
	// generous margin keeps a wrong estimate from becoming a provider error.
	DefaultChatContextBudgetTokens = 32000

	// charsPerToken approximates how many characters make one token. It is a
	// heuristic; see DefaultChatContextBudgetTokens for why that is acceptable.
	charsPerToken = 4

	// maxChatContextMemos bounds how many notes are injected in one turn. A
	// selection can be within budget and still be thousands of tiny notes, which
	// would produce an unusable prompt and an enormous request.
	maxChatContextMemos = 500

	// maxChatFilterLength bounds the accepted CEL filter text.
	maxChatFilterLength = 4096
)

// chatContext is the note content selected for one chat turn, with the receipt
// describing what was included.
type chatContext struct {
	// prompt is the rendered note content injected into the system message.
	prompt string
	// selected is the notes the filter matched, in the order they were rendered.
	selected []*store.Memo
	// commentsByMemoID holds each selected note's comment thread. Empty unless
	// the caller asked for comments.
	commentsByMemoID map[int32][]*store.Memo
	// usernamesByID attributes comments to their authors. Empty unless the
	// caller asked for comments.
	usernamesByID map[int32]string
	// memoCount is how many notes were injected.
	memoCount int64
	// commentCount is how many comments were injected alongside them.
	commentCount int64
	// totalChars is the character count of the injected note content. Comments
	// are excluded so the estimate stays stable regardless of include_comments.
	totalChars int64
	// estimatedTokens is totalChars converted through charsPerToken.
	estimatedTokens int64
	// budgetTokens is the budget the selection was measured against.
	budgetTokens int64
}

// estimateChatContext resolves a filter to its token cost without building a
// prompt, so the Hub can refuse an over-budget selection before sending.
func (s *APIV1Service) estimateChatContext(ctx context.Context, filterText string, budgetTokens int64) (*chatContext, error) {
	accessScope, currentUser, err := s.resolveMemoAccessScope(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "%v", err)
	}
	if currentUser == nil {
		return nil, status.Error(codes.Unauthenticated, "user not authenticated")
	}

	selected, err := s.resolveChatContextMemos(ctx, filterText, accessScope, currentUser)
	if err != nil {
		return nil, err
	}

	var totalChars int64
	for _, memo := range selected {
		totalChars += int64(len(memo.Content))
	}
	return &chatContext{
		selected:        selected,
		memoCount:       int64(len(selected)),
		totalChars:      totalChars,
		estimatedTokens: estimateTokens(totalChars),
		budgetTokens:    budgetTokens,
	}, nil
}

// resolveChatContext resolves the notes a filter matches and, when the caller
// opted in, their comment threads. Everything is read under the caller's memo
// access scope, so neither a note nor a comment the caller could not already
// read can enter the context.
func (s *APIV1Service) resolveChatContext(
	ctx context.Context,
	filterText string,
	includeComments bool,
	budgetTokens int64,
) (*chatContext, error) {
	selection, err := s.estimateChatContext(ctx, filterText, budgetTokens)
	if err != nil {
		return nil, err
	}

	if includeComments && len(selection.selected) > 0 {
		accessScope, _, err := s.resolveMemoAccessScope(ctx)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "%v", err)
		}
		commentsByMemoID, err := s.resolveMemoCommentsForContext(ctx, selection.selected, accessScope)
		if err != nil {
			return nil, err
		}
		selection.commentsByMemoID = commentsByMemoID

		usernamesByID, err := s.listUsernamesByID(ctx, contextCommentCreatorIDs(commentsByMemoID))
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to resolve comment authors: %v", err)
		}
		selection.usernamesByID = usernamesByID

		for _, comments := range commentsByMemoID {
			selection.commentCount += int64(len(comments))
		}
	}

	selection.prompt = buildChatContextPrompt(selection.selected, selection.commentsByMemoID, selection.usernamesByID)
	return selection, nil
}

// resolveMemoCommentsForContext loads the comment threads of the selected notes
// in two batched queries: the COMMENT relations that point at a selected note,
// then the comments themselves.
//
// A reply is a comment on a comment, so the relation walk is transitive until
// it stops finding new parents. That is the only way a reply can reach the
// context: the filter matches notes, and a reply is not reachable from any note
// the filter could have matched. The walk is bounded because a comment cannot
// be its own ancestor.
func (s *APIV1Service) resolveMemoCommentsForContext(
	ctx context.Context,
	selected []*store.Memo,
	accessScope *store.MemoAccessScope,
) (map[int32][]*store.Memo, error) {
	selectedIDs := make([]int32, 0, len(selected))
	// rootIDByMemoID maps every visited memo to the selected note its thread
	// belongs to, seeded with the notes themselves so a comment's parent always
	// resolves.
	rootIDByMemoID := make(map[int32]int32, len(selected))
	for _, memo := range selected {
		selectedIDs = append(selectedIDs, memo.ID)
		rootIDByMemoID[memo.ID] = memo.ID
	}
	// commentIDs collects the memos found through a COMMENT relation, which is
	// what keeps the selected notes out of the comment fetch below.
	commentIDs := make([]int32, 0)
	seenCommentIDs := make(map[int32]struct{})

	commentType := store.MemoRelationComment
	// The notes to walk next: the selected notes first, then each generation of
	// comments, so a nested reply is reached through its own parent.
	walkIDs := selectedIDs
	for len(walkIDs) > 0 {
		relations, err := s.Store.ListMemoRelations(ctx, &store.FindMemoRelation{
			RelatedMemoIDList: walkIDs,
			Type:              &commentType,
		})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to resolve comments for chat context: %v", err)
		}

		nextWalkIDs := make([]int32, 0, len(relations))
		for _, relation := range relations {
			// A comment has exactly one parent, so the first relation wins and a
			// malformed duplicate cannot attach the same comment twice.
			if _, seen := seenCommentIDs[relation.MemoID]; seen {
				continue
			}
			// The walk only ever visits an already-mapped memo, so the parent's
			// root is always known here.
			rootIDByMemoID[relation.MemoID] = rootIDByMemoID[relation.RelatedMemoID]
			seenCommentIDs[relation.MemoID] = struct{}{}
			commentIDs = append(commentIDs, relation.MemoID)
			nextWalkIDs = append(nextWalkIDs, relation.MemoID)
		}
		walkIDs = nextWalkIDs
	}

	if len(commentIDs) == 0 {
		return map[int32][]*store.Memo{}, nil
	}

	state := store.Normal
	comments, err := s.Store.ListMemos(ctx, &store.FindMemo{
		IDList:    commentIDs,
		RowStatus: &state,
		// The same memo-local scope ListMemoComments applies: a comment's own
		// visibility decides, never its parent's.
		Access: accessScope,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to load comments for chat context: %v", err)
	}

	commentsByMemoID := make(map[int32][]*store.Memo, len(comments))
	for _, comment := range comments {
		rootID := rootIDByMemoID[comment.ID]
		commentsByMemoID[rootID] = append(commentsByMemoID[rootID], comment)
	}
	// ListMemos orders newest first; a thread reads oldest first. Comments
	// written in the same second share a timestamp, so the id breaks the tie and
	// keeps the thread in the order it was actually written.
	for _, thread := range commentsByMemoID {
		sort.Slice(thread, func(left, right int) bool {
			if thread[left].CreatedTs != thread[right].CreatedTs {
				return thread[left].CreatedTs < thread[right].CreatedTs
			}
			return thread[left].ID < thread[right].ID
		})
	}
	return commentsByMemoID, nil
}

// contextCommentCreatorIDs collects the authors of every loaded comment so they
// can be resolved in one query.
func contextCommentCreatorIDs(commentsByMemoID map[int32][]*store.Memo) []int32 {
	var creatorIDs []int32
	for _, comments := range commentsByMemoID {
		for _, comment := range comments {
			creatorIDs = append(creatorIDs, comment.CreatorID)
		}
	}
	return creatorIDs
}

// resolveChatContextMemos runs the selection filter under the caller's memo
// access scope. Reusing the scope and the filter validator from ListMemos means
// the model can never read a note the caller could not already read.
//
// Comments stay out of the selection on purpose: they are notes, so a tag they
// carry would otherwise pull a comment in on its own, detached from the note it
// belongs to. resolveMemoCommentsForContext attaches them to their parent
// instead, when the caller asks for them.
func (s *APIV1Service) resolveChatContextMemos(
	ctx context.Context,
	filterText string,
	accessScope *store.MemoAccessScope,
	currentUser *store.User,
) ([]*store.Memo, error) {
	filterText = strings.TrimSpace(filterText)
	if filterText == "" {
		// An empty filter selects nothing. Defaulting to "all notes" would make
		// an accidental empty selection upload the user's whole corpus.
		return nil, nil
	}
	if len(filterText) > maxChatFilterLength {
		return nil, status.Errorf(codes.InvalidArgument, "filter is too long; maximum length is %d characters", maxChatFilterLength)
	}
	if err := s.validateMemoFilterForUser(ctx, filterText, currentUser); err != nil {
		return nil, err
	}

	state := store.Normal
	// Fetch one more than the cap so an oversized selection is detected rather
	// than silently truncated: a receipt that quietly dropped notes would
	// misreport what the model actually read.
	limit := maxChatContextMemos + 1
	memoFind := &store.FindMemo{
		ExcludeComments: true,
		RowStatus:       &state,
		Access:          accessScope,
		Filters:         []string{filterText},
		Limit:           &limit,
	}
	memos, err := s.Store.ListMemos(ctx, memoFind)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to resolve chat context: %v", err)
	}
	if len(memos) > maxChatContextMemos {
		return nil, status.Errorf(
			codes.FailedPrecondition,
			"selection matches more than %d notes; narrow the selection",
			maxChatContextMemos,
		)
	}
	return memos, nil
}

// estimateTokens converts a character count into an approximate token count.
func estimateTokens(chars int64) int64 {
	if chars <= 0 {
		return 0
	}
	return (chars + charsPerToken - 1) / charsPerToken
}

// buildChatContextPrompt renders the selected notes into the prompt section the
// model reads. Notes are delimited so the model can tell them apart, and each
// note's comments follow it so the model reads a discussion as part of the note
// it belongs to rather than as an unrelated entry.
func buildChatContextPrompt(memos []*store.Memo, commentsByMemoID map[int32][]*store.Memo, usernamesByID map[int32]string) string {
	if len(memos) == 0 {
		return ""
	}
	var builder strings.Builder
	builder.WriteString("The user's notes follow. Treat them as the only source of truth about the user's own notes.\n")
	if len(commentsByMemoID) > 0 {
		// Without this, a note that carries no comments section would look like
		// the model simply had not been given the comments.
		builder.WriteString("A note's comments, when it has any, follow that note under a comments heading.\n")
	}
	for _, memo := range memos {
		builder.WriteString("\n--- note ---\n")
		if memo.UID != "" {
			builder.WriteString("id: memos/")
			builder.WriteString(memo.UID)
			builder.WriteString("\n")
		}
		builder.WriteString(strings.TrimSpace(memo.Content))
		builder.WriteString("\n")

		comments := commentsByMemoID[memo.ID]
		if len(comments) == 0 {
			continue
		}
		builder.WriteString("\ncomments:\n")
		for _, comment := range comments {
			// A reply hangs off another comment, so mark the nesting rather than
			// letting the model read the thread as one flat exchange.
			marker := "-"
			if comment.ParentUID != nil {
				marker = "  -"
			}
			builder.WriteString(marker)
			builder.WriteString(" ")
			if username, ok := usernamesByID[comment.CreatorID]; ok && username != "" {
				builder.WriteString(username)
				builder.WriteString(": ")
			}
			builder.WriteString(strings.TrimSpace(comment.Content))
			builder.WriteString("\n")
		}
	}
	builder.WriteString("\n--- end of notes ---\n")
	return builder.String()
}

// overBudgetError explains a refused selection in terms the user can act on.
func overBudgetError(selection *chatContext) error {
	return status.Errorf(
		codes.FailedPrecondition,
		"selection is too large: %d note(s), about %d tokens, over the %d token budget; narrow the selection",
		selection.memoCount, selection.estimatedTokens, selection.budgetTokens,
	)
}
