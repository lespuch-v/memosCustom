package v1

import (
	"context"
	"strings"

	"github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/usememos/memos/internal/ratelimit"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/provider/ai"
	"github.com/usememos/memos/provider/ai/decision"
	decisionopenrouter "github.com/usememos/memos/provider/ai/decision/openrouter"
	"github.com/usememos/memos/store"
)

const semanticAnalysisModel = "~typesafe/jev-latest"

var semanticAnalysisQuestions = map[string]decision.Question{
	"is_idea":           {Type: "noul", Instructions: "Does this memo express or develop an idea, possibility, hypothesis, or proposed direction?"},
	"is_task":           {Type: "noul", Instructions: "Does this memo describe a task, commitment, reminder, or concrete piece of work to complete?"},
	"is_journal":        {Type: "noul", Instructions: "Is this memo primarily a personal record of experiences, events, observations, or reflections?"},
	"is_reference":      {Type: "noul", Instructions: "Is this memo primarily information preserved for later lookup or reference?"},
	"is_actionable":     {Type: "noul", Instructions: "Does this memo imply at least one concrete action that its reader could take?"},
	"is_time_sensitive": {Type: "noul", Instructions: "Is this memo tied to a specific deadline, date, or window of time after which it loses relevance?"},
	"is_question":       {Type: "noul", Instructions: "Does this memo pose an open question or unsolved problem seeking an answer?"},
	"worth_revisiting":  {Type: "noul", Instructions: "Would revisiting this memo later likely provide useful follow-up, reflection, or reference value?"},
	"is_technical":      {Type: "noul", Instructions: "Is this memo primarily about software, computing, engineering, or another technical subject?"},
}

// AnalyzeMemoSemantic returns ephemeral Jev judgments for one readable memo.
func (s *APIV1Service) AnalyzeMemoSemantic(ctx context.Context, request *v1pb.AnalyzeMemoSemanticRequest) (*v1pb.AnalyzeMemoSemanticResponse, error) {
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
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &uid})
	if err != nil {
		return nil, errors.Wrap(err, "failed to get memo")
	}
	if memo == nil {
		return nil, status.Errorf(codes.NotFound, "memo not found")
	}
	if err := s.checkMemoReadAccess(ctx, memo); err != nil {
		return nil, err
	}
	if strings.TrimSpace(memo.Content) == "" {
		return nil, status.Errorf(codes.InvalidArgument, "memo content is required")
	}
	provider, err := s.resolveSemanticAnalysisProvider(ctx)
	if err != nil {
		return nil, err
	}
	client, err := decisionopenrouter.New(provider)
	if err != nil {
		return nil, status.Errorf(codes.FailedPrecondition, "semantic analysis provider is invalid: %v", err)
	}
	result, err := client.Evaluate(ctx, decision.Request{Model: semanticAnalysisModel, State: memo.Content, Questions: semanticAnalysisQuestions})
	if err != nil {
		return nil, status.Errorf(codes.Unavailable, "semantic analysis provider failed: %v", err)
	}
	answer := func(id string) float64 { return result.Answers[id].Noul }
	return &v1pb.AnalyzeMemoSemanticResponse{
		IdeaProbability: answer("is_idea"), TaskProbability: answer("is_task"), JournalProbability: answer("is_journal"),
		ReferenceProbability: answer("is_reference"), ActionableProbability: answer("is_actionable"),
		TimeSensitiveProbability: answer("is_time_sensitive"), QuestionProbability: answer("is_question"),
		RevisitProbability: answer("worth_revisiting"), TechnicalProbability: answer("is_technical"), Model: result.Model,
	}, nil
}

func (s *APIV1Service) resolveSemanticAnalysisProvider(ctx context.Context) (ai.ProviderConfig, error) {
	setting, err := s.Store.GetInstanceAISetting(ctx)
	if err != nil {
		return ai.ProviderConfig{}, status.Errorf(codes.Internal, "failed to get AI setting")
	}
	config := setting.GetSemanticAnalysis()
	if config.GetProviderId() == "" {
		return ai.ProviderConfig{}, status.Errorf(codes.FailedPrecondition, "semantic analysis is not configured")
	}
	for _, provider := range setting.GetProviders() {
		if provider.GetId() != config.GetProviderId() {
			continue
		}
		if provider.GetType() != storepb.AIProviderType_OPENROUTER {
			return ai.ProviderConfig{}, status.Errorf(codes.FailedPrecondition, "semantic analysis requires an OpenRouter provider")
		}
		return convertAIProviderConfigFromStore(provider), nil
	}
	return ai.ProviderConfig{}, status.Errorf(codes.FailedPrecondition, "semantic analysis provider is not configured")
}
