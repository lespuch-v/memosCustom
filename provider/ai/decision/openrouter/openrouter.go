// Package openrouter implements structured decisions through OpenRouter.
package openrouter

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/url"
	"strings"

	"github.com/pkg/errors"

	"github.com/usememos/memos/provider/ai"
	"github.com/usememos/memos/provider/ai/decision"
)

const maxResponseBytes = 1 << 20

// Client evaluates TypeSafe decision models through OpenRouter.
type Client struct {
	endpoint string
	apiKey   string
	http     *http.Client
}

// New constructs an OpenRouter decisions client.
func New(config ai.ProviderConfig, options ...decision.Option) (*Client, error) {
	if config.Type != ai.ProviderOpenRouter {
		return nil, errors.Errorf("decision provider type %q is not supported", config.Type)
	}
	if strings.TrimSpace(config.APIKey) == "" {
		return nil, errors.New("AI provider API key is required")
	}
	base, err := ai.NormalizeEndpoint(config.Type, config.Endpoint)
	if err != nil {
		return nil, err
	}
	endpoint, err := decisionsEndpoint(base)
	if err != nil {
		return nil, err
	}
	resolved := decision.ApplyOptions(options)
	return &Client{endpoint: endpoint, apiKey: config.APIKey, http: resolved.HTTPClient}, nil
}

// Evaluate sends one state and its independent typed questions to OpenRouter.
func (client *Client) Evaluate(ctx context.Context, request decision.Request) (*decision.Result, error) {
	if strings.TrimSpace(request.Model) == "" {
		return nil, errors.New("model is required")
	}
	if len(request.Questions) == 0 {
		return nil, errors.New("at least one question is required")
	}
	payload, err := json.Marshal(struct {
		Model     string                       `json:"model"`
		State     string                       `json:"state"`
		Questions map[string]decision.Question `json:"questions"`
	}{Model: request.Model, State: request.State, Questions: request.Questions})
	if err != nil {
		return nil, errors.Wrap(err, "failed to encode decision request")
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, client.endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, errors.Wrap(err, "failed to build decision request")
	}
	httpRequest.Header.Set("Authorization", "Bearer "+client.apiKey)
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Accept", "application/json")

	response, err := client.http.Do(httpRequest)
	if err != nil {
		return nil, errors.Wrap(err, "failed to reach decision provider")
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, errors.Errorf("decision provider returned HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return nil, errors.Wrap(err, "failed to read decision response")
	}
	if len(data) > maxResponseBytes {
		return nil, errors.New("decision provider response is too large")
	}
	var decoded struct {
		Model   string                         `json:"model"`
		Answers map[string]decision.NoulAnswer `json:"answers"`
	}
	if err := json.Unmarshal(data, &decoded); err != nil {
		return nil, errors.Wrap(err, "failed to decode decision response")
	}
	if decoded.Answers == nil {
		return nil, errors.New("decision provider returned no answers")
	}
	for id := range request.Questions {
		answer, ok := decoded.Answers[id]
		if !ok {
			return nil, errors.Errorf("decision provider omitted answer %q", id)
		}
		if answer.Type != "noul" {
			return nil, errors.Errorf("decision provider returned invalid answer type for %q", id)
		}
		if math.IsNaN(answer.Noul) || math.IsInf(answer.Noul, 0) || answer.Noul < 0 || answer.Noul > 1 {
			return nil, errors.Errorf("decision provider returned invalid probability for %q", id)
		}
	}
	return &decision.Result{Model: decoded.Model, Answers: decoded.Answers}, nil
}

func decisionsEndpoint(base string) (string, error) {
	parsed, err := url.Parse(base)
	if err != nil {
		return "", errors.Wrap(err, "invalid AI provider endpoint")
	}
	path := strings.TrimRight(parsed.Path, "/")
	path = strings.TrimSuffix(path, "/api/v1")
	parsed.Path = strings.TrimRight(path, "/") + "/api/alpha/decisions"
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}
