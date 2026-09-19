// Package decision defines provider-independent structured decision requests.
package decision

import (
	"context"
	"net/http"
	"time"
)

const defaultHTTPTimeout = 3 * time.Minute

// Question is one typed judgment evaluated against the request state.
type Question struct {
	Type         string            `json:"type"`
	Instructions string            `json:"instructions"`
	Criteria     map[string]string `json:"criteria,omitempty"`
}

// Request asks a decisions model to evaluate independent questions against one state.
type Request struct {
	Model     string
	State     string
	Questions map[string]Question
}

// NoulAnswer is a calibrated yes-probability returned for a Noul question.
type NoulAnswer struct {
	Type string  `json:"type"`
	Noul float64 `json:"noul"`
}

// Result is a structured provider response keyed by the caller's question IDs.
type Result struct {
	Model   string
	Answers map[string]NoulAnswer
}

// Client evaluates structured decision requests.
type Client interface {
	Evaluate(context.Context, Request) (*Result, error)
}

// Options configures a decision client.
type Options struct {
	HTTPClient *http.Client
}

// Option customizes a decision client.
type Option func(*Options)

// WithHTTPClient overrides the HTTP client used for requests.
func WithHTTPClient(client *http.Client) Option {
	return func(options *Options) {
		if client != nil {
			options.HTTPClient = client
		}
	}
}

// ApplyOptions resolves client options with bounded defaults.
func ApplyOptions(options []Option) Options {
	resolved := Options{HTTPClient: &http.Client{Timeout: defaultHTTPTimeout}}
	for _, apply := range options {
		apply(&resolved)
	}
	return resolved
}
