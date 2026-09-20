package test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
)

func TestAnalyzeMemoSemantic(t *testing.T) {
	ctx := context.Background()

	t.Run("requires authentication", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()
		_, err := ts.Service.AnalyzeMemoSemantic(ctx, &v1pb.AnalyzeMemoSemanticRequest{Memo: "memos/example"})
		require.ErrorContains(t, err, "user not authenticated")
	})

	t.Run("sends one memo and nine fixed noul questions", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()
		user, err := ts.CreateRegularUser(ctx, "semantic-user")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)
		memo, err := ts.Service.CreateMemo(userCtx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "# Build the semantic inspector"}})
		require.NoError(t, err)

		called := false
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			called = true
			require.Equal(t, "/api/alpha/decisions", r.URL.Path)
			var body struct {
				Model     string `json:"model"`
				State     string `json:"state"`
				Questions map[string]struct {
					Type         string `json:"type"`
					Instructions string `json:"instructions"`
				} `json:"questions"`
			}
			require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
			require.Equal(t, "~typesafe/jev-latest", body.Model)
			require.Equal(t, memo.Content, body.State)
			require.Len(t, body.Questions, 9)
			require.Equal(t, "Does this memo pose an open question or unsolved problem seeking an answer?", body.Questions["is_question"].Instructions)
			require.Equal(t, "Does this memo imply at least one concrete action that its reader could take?", body.Questions["is_actionable"].Instructions)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"model":"typesafe/jev-1.13","answers":{"is_idea":{"type":"noul","noul":0.91},"is_task":{"type":"noul","noul":0.82},"is_journal":{"type":"noul","noul":0.1},"is_reference":{"type":"noul","noul":0.4},"is_actionable":{"type":"noul","noul":0.88},"worth_revisiting":{"type":"noul","noul":0.77},"is_technical":{"type":"noul","noul":0.95},"is_question":{"type":"noul","noul":0.05},"is_time_sensitive":{"type":"noul","noul":0.6}}}`))
		}))
		defer server.Close()
		_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{Key: storepb.InstanceSettingKey_AI, Value: &storepb.InstanceSetting_AiSetting{AiSetting: &storepb.InstanceAISetting{
			Providers:        []*storepb.AIProviderConfig{{Id: "router", Title: "OpenRouter", Type: storepb.AIProviderType_OPENROUTER, Endpoint: server.URL, ApiKey: "secret"}},
			SemanticAnalysis: &storepb.SemanticAnalysisConfig{ProviderId: "router"},
		}}})
		require.NoError(t, err)

		response, err := ts.Service.AnalyzeMemoSemantic(userCtx, &v1pb.AnalyzeMemoSemanticRequest{Memo: memo.Name})
		require.NoError(t, err)
		require.True(t, called)
		require.Equal(t, 0.91, response.IdeaProbability)
		require.Equal(t, 0.88, response.ActionableProbability)
		require.Equal(t, 0.05, response.QuestionProbability)
		require.Equal(t, 0.6, response.TimeSensitiveProbability)
		require.Equal(t, "typesafe/jev-1.13", response.Model)
	})

	t.Run("rejects empty memo before provider call", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()
		user, err := ts.CreateRegularUser(ctx, "empty-semantic-user")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)
		memo, err := ts.Service.CreateMemo(userCtx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "   "}})
		require.NoError(t, err)
		_, err = ts.Service.AnalyzeMemoSemantic(userCtx, &v1pb.AnalyzeMemoSemanticRequest{Memo: memo.Name})
		require.ErrorContains(t, err, "memo content is required")
	})
}

func TestTranscribe(t *testing.T) {
	ctx := context.Background()

	t.Run("requires authentication", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		_, err := ts.Service.Transcribe(ctx, &v1pb.TranscribeRequest{
			Audio: &v1pb.TranscriptionAudio{
				Source:      &v1pb.TranscriptionAudio_Content{Content: []byte("RIFF")},
				Filename:    "voice.wav",
				ContentType: "audio/wav",
			},
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "user not authenticated")
	})

	t.Run("transcribes audio file using persisted transcription setting", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		user, err := ts.CreateRegularUser(ctx, "alice")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		openAIServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			require.Equal(t, "/audio/transcriptions", r.URL.Path)
			require.Equal(t, "Bearer sk-test", r.Header.Get("Authorization"))
			require.NoError(t, r.ParseMultipartForm(10<<20))
			require.Equal(t, "whisper-1", r.FormValue("model"))
			require.Equal(t, "fr", r.FormValue("language"))
			require.Equal(t, "names: Alice", r.FormValue("prompt"))

			file, header, err := r.FormFile("file")
			require.NoError(t, err)
			defer file.Close()
			require.Equal(t, "voice.wav", header.Filename)

			w.Header().Set("Content-Type", "application/json")
			require.NoError(t, json.NewEncoder(w).Encode(map[string]string{
				"text": "transcribed text",
			}))
		}))
		defer openAIServer.Close()

		_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
			Key: storepb.InstanceSettingKey_AI,
			Value: &storepb.InstanceSetting_AiSetting{
				AiSetting: &storepb.InstanceAISetting{
					Providers: []*storepb.AIProviderConfig{
						{
							Id:       "openai-main",
							Title:    "OpenAI",
							Type:     storepb.AIProviderType_OPENAI,
							Endpoint: openAIServer.URL,
							ApiKey:   "sk-test",
						},
					},
					Transcription: &storepb.TranscriptionConfig{
						ProviderId: "openai-main",
						Model:      "whisper-1",
						Language:   "fr",
						Prompt:     "names: Alice",
					},
				},
			},
		})
		require.NoError(t, err)

		resp, err := ts.Service.Transcribe(userCtx, &v1pb.TranscribeRequest{
			Audio: &v1pb.TranscriptionAudio{
				Source:      &v1pb.TranscriptionAudio_Content{Content: []byte("RIFF")},
				Filename:    "voice.wav",
				ContentType: "audio/wav",
			},
		})
		require.NoError(t, err)
		require.Equal(t, "transcribed text", resp.Text)
	})

	t.Run("returns provider error without rewriting it", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		user, err := ts.CreateRegularUser(ctx, "notfound-user")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		openAIServer := httptest.NewServer(http.NotFoundHandler())
		defer openAIServer.Close()

		_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
			Key: storepb.InstanceSettingKey_AI,
			Value: &storepb.InstanceSetting_AiSetting{
				AiSetting: &storepb.InstanceAISetting{
					Providers: []*storepb.AIProviderConfig{
						{
							Id:       "openai-main",
							Title:    "OpenAI",
							Type:     storepb.AIProviderType_OPENAI,
							Endpoint: openAIServer.URL,
							ApiKey:   "sk-test",
						},
					},
					Transcription: &storepb.TranscriptionConfig{
						ProviderId: "openai-main",
					},
				},
			},
		})
		require.NoError(t, err)

		_, err = ts.Service.Transcribe(userCtx, &v1pb.TranscribeRequest{
			Audio: &v1pb.TranscriptionAudio{
				Source:      &v1pb.TranscriptionAudio_Content{Content: []byte("RIFF")},
				Filename:    "voice.wav",
				ContentType: "audio/wav",
			},
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "failed to transcribe audio")
	})

	t.Run("transcribes audio file with Gemini provider", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		user, err := ts.CreateRegularUser(ctx, "gemini-user")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		geminiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			require.Equal(t, "/v1beta/models/gemini-2.5-flash:generateContent", r.URL.Path)
			require.Equal(t, "gemini-key", r.Header.Get("x-goog-api-key"))
			w.Header().Set("Content-Type", "application/json")
			require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
				"candidates": []map[string]any{
					{
						"finishReason": "STOP",
						"content": map[string]any{
							"parts": []map[string]string{{"text": "gemini transcript"}},
						},
					},
				},
			}))
		}))
		defer geminiServer.Close()

		_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
			Key: storepb.InstanceSettingKey_AI,
			Value: &storepb.InstanceSetting_AiSetting{
				AiSetting: &storepb.InstanceAISetting{
					Providers: []*storepb.AIProviderConfig{
						{
							Id:       "gemini-main",
							Title:    "Gemini",
							Type:     storepb.AIProviderType_GEMINI,
							Endpoint: geminiServer.URL + "/v1beta",
							ApiKey:   "gemini-key",
						},
					},
					Transcription: &storepb.TranscriptionConfig{
						ProviderId: "gemini-main",
					},
				},
			},
		})
		require.NoError(t, err)

		resp, err := ts.Service.Transcribe(userCtx, &v1pb.TranscribeRequest{
			Audio: &v1pb.TranscriptionAudio{
				Source:      &v1pb.TranscriptionAudio_Content{Content: []byte("mp3 bytes")},
				Filename:    "voice.mp3",
				ContentType: "audio/mp3",
			},
		})
		require.NoError(t, err)
		require.Equal(t, "gemini transcript", resp.Text)
	})

	t.Run("falls back to engine default model when transcription model is empty", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		user, err := ts.CreateRegularUser(ctx, "bob")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		openAIServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			require.NoError(t, r.ParseMultipartForm(10<<20))
			require.Equal(t, "whisper-1", r.FormValue("model"))
			w.Header().Set("Content-Type", "application/json")
			require.NoError(t, json.NewEncoder(w).Encode(map[string]string{
				"text": "built-in model",
			}))
		}))
		defer openAIServer.Close()

		_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
			Key: storepb.InstanceSettingKey_AI,
			Value: &storepb.InstanceSetting_AiSetting{
				AiSetting: &storepb.InstanceAISetting{
					Providers: []*storepb.AIProviderConfig{
						{
							Id:       "openai-main",
							Title:    "OpenAI",
							Type:     storepb.AIProviderType_OPENAI,
							Endpoint: openAIServer.URL,
							ApiKey:   "sk-test",
						},
					},
					Transcription: &storepb.TranscriptionConfig{
						ProviderId: "openai-main",
					},
				},
			},
		})
		require.NoError(t, err)

		resp, err := ts.Service.Transcribe(userCtx, &v1pb.TranscribeRequest{
			Audio: &v1pb.TranscriptionAudio{
				Source:      &v1pb.TranscriptionAudio_Content{Content: []byte("RIFF")},
				Filename:    "voice.wav",
				ContentType: "audio/wav",
			},
		})
		require.NoError(t, err)
		require.Equal(t, "built-in model", resp.Text)
	})

	t.Run("rejects non-audio content before provider call", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		user, err := ts.CreateRegularUser(ctx, "charlie")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		_, err = ts.Service.Transcribe(userCtx, &v1pb.TranscribeRequest{
			Audio: &v1pb.TranscriptionAudio{
				Source:      &v1pb.TranscriptionAudio_Content{Content: []byte("not audio")},
				Filename:    "notes.txt",
				ContentType: "text/plain",
			},
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "not supported")
	})

	t.Run("returns FailedPrecondition when transcription is not configured", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		user, err := ts.CreateRegularUser(ctx, "alice-empty")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		_, err = ts.Service.Transcribe(userCtx, &v1pb.TranscribeRequest{
			Audio: &v1pb.TranscriptionAudio{
				Source:      &v1pb.TranscriptionAudio_Content{Content: []byte("RIFF")},
				Filename:    "voice.wav",
				ContentType: "audio/wav",
			},
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "transcription is not configured")
	})
}
