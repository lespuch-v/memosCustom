package openrouter_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/provider/ai"
	"github.com/usememos/memos/provider/ai/decision"
	decisionopenrouter "github.com/usememos/memos/provider/ai/decision/openrouter"
)

func TestEvaluateSendsDecisionRequestAndParsesNoulAnswer(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodPost, r.Method)
		require.Equal(t, "/api/alpha/decisions", r.URL.Path)
		require.Equal(t, "Bearer secret", r.Header.Get("Authorization"))
		require.Equal(t, "application/json", r.Header.Get("Content-Type"))

		var body struct {
			Model     string                       `json:"model"`
			State     string                       `json:"state"`
			Questions map[string]decision.Question `json:"questions"`
		}
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		require.Equal(t, "~typesafe/jev-latest", body.Model)
		require.Equal(t, "memo body", body.State)
		require.Equal(t, decision.Question{Type: "noul", Instructions: "Is this actionable?"}, body.Questions["is_actionable"])

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"typesafe/jev-1.13","answers":{"is_actionable":{"type":"noul","noul":0.875}}}`))
	}))
	t.Cleanup(server.Close)

	client, err := decisionopenrouter.New(ai.ProviderConfig{
		Type:     ai.ProviderOpenRouter,
		Endpoint: server.URL,
		APIKey:   "secret",
	})
	require.NoError(t, err)

	result, err := client.Evaluate(context.Background(), decision.Request{
		Model: "~typesafe/jev-latest",
		State: "memo body",
		Questions: map[string]decision.Question{
			"is_actionable": {Type: "noul", Instructions: "Is this actionable?"},
		},
	})
	require.NoError(t, err)
	require.Equal(t, "typesafe/jev-1.13", result.Model)
	require.Equal(t, decision.NoulAnswer{Type: "noul", Noul: 0.875}, result.Answers["is_actionable"])
}

func TestEvaluateRejectsInvalidResponses(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		status int
		body   string
	}{
		{name: "missing answers", status: http.StatusOK, body: `{"model":"jev"}`},
		{name: "missing requested answer", status: http.StatusOK, body: `{"model":"jev","answers":{"other":{"type":"noul","noul":0.5}}}`},
		{name: "wrong answer type", status: http.StatusOK, body: `{"model":"jev","answers":{"is_actionable":{"type":"choice","noul":0.5}}}`},
		{name: "missing probability", status: http.StatusOK, body: `{"model":"jev","answers":{"is_actionable":{"type":"noul"}}}`},
		{name: "null probability", status: http.StatusOK, body: `{"model":"jev","answers":{"is_actionable":{"type":"noul","noul":null}}}`},
		{name: "negative probability", status: http.StatusOK, body: `{"model":"jev","answers":{"is_actionable":{"type":"noul","noul":-0.01}}}`},
		{name: "probability over one", status: http.StatusOK, body: `{"model":"jev","answers":{"is_actionable":{"type":"noul","noul":1.01}}}`},
		{name: "infinite probability", status: http.StatusOK, body: `{"model":"jev","answers":{"is_actionable":{"type":"noul","noul":1e999}}}`},
		{name: "malformed json", status: http.StatusOK, body: `{`},
		{name: "unauthorized", status: http.StatusUnauthorized, body: `{"secret":"must not leak"}`},
		{name: "rate limited", status: http.StatusTooManyRequests, body: `{"secret":"must not leak"}`},
		{name: "provider failure", status: http.StatusInternalServerError, body: `{"secret":"must not leak"}`},
		{name: "oversized response", status: http.StatusOK, body: `{"padding":"` + strings.Repeat("x", (1<<20)+1) + `"}`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(test.status)
				_, _ = w.Write([]byte(test.body))
			}))
			t.Cleanup(server.Close)

			client, err := decisionopenrouter.New(ai.ProviderConfig{Type: ai.ProviderOpenRouter, Endpoint: server.URL, APIKey: "secret"})
			require.NoError(t, err)
			result, err := client.Evaluate(context.Background(), actionableRequest())
			require.Error(t, err)
			require.Nil(t, result)
			require.NotContains(t, err.Error(), "must not leak")
		})
	}
}

func TestEvaluatePreservesCancellation(t *testing.T) {
	t.Parallel()

	started := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		close(started)
		select {
		case <-r.Context().Done():
		case <-time.After(time.Second):
		}
	}))
	t.Cleanup(func() {
		server.CloseClientConnections()
		server.Close()
	})
	client, err := decisionopenrouter.New(ai.ProviderConfig{Type: ai.ProviderOpenRouter, Endpoint: server.URL, APIKey: "secret"})
	require.NoError(t, err)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, evaluateErr := client.Evaluate(ctx, actionableRequest())
		done <- evaluateErr
	}()
	<-started
	cancel()
	require.ErrorIs(t, <-done, context.Canceled)
}

func TestNewRejectsNonOpenRouterAndMissingKey(t *testing.T) {
	t.Parallel()

	_, err := decisionopenrouter.New(ai.ProviderConfig{Type: ai.ProviderOpenAI, APIKey: "secret"})
	require.ErrorContains(t, err, "not supported")
	_, err = decisionopenrouter.New(ai.ProviderConfig{Type: ai.ProviderOpenRouter})
	require.ErrorContains(t, err, "API key is required")
}

func actionableRequest() decision.Request {
	return decision.Request{
		Model: "~typesafe/jev-latest",
		State: "memo body",
		Questions: map[string]decision.Question{
			"is_actionable": {Type: "noul", Instructions: "Is this actionable?"},
		},
	}
}
