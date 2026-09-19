package v1

import (
	"testing"

	"github.com/stretchr/testify/require"

	storepb "github.com/usememos/memos/proto/gen/store"
)

func TestPreparePersistedTranscriptionConfigRejectsUnsupportedProviderType(t *testing.T) {
	setting := &storepb.InstanceAISetting{
		Providers:     []*storepb.AIProviderConfig{{Id: "router", Type: storepb.AIProviderType_OPENROUTER}},
		Transcription: &storepb.TranscriptionConfig{ProviderId: "router"},
	}

	err := preparePersistedTranscriptionConfig(setting, nil)
	require.ErrorContains(t, err, "not supported for transcription")
}

func TestPreparePersistedChatConfigRejectsUnsupportedProviderType(t *testing.T) {
	setting := &storepb.InstanceAISetting{
		Providers: []*storepb.AIProviderConfig{{Id: "gemini", Type: storepb.AIProviderType_GEMINI}},
		Chat:      &storepb.ChatConfig{ProviderId: "gemini", Model: "gemini-2.5-flash"},
	}

	err := preparePersistedChatConfig(setting, nil)
	require.ErrorContains(t, err, "not supported for chat")
}

func TestPreparePersistedSemanticAnalysisConfigRequiresOpenRouter(t *testing.T) {
	for _, providerType := range []storepb.AIProviderType{
		storepb.AIProviderType_OPENAI,
		storepb.AIProviderType_GEMINI,
		storepb.AIProviderType_DEEPINFRA,
	} {
		setting := &storepb.InstanceAISetting{
			Providers:        []*storepb.AIProviderConfig{{Id: "provider", Type: providerType}},
			SemanticAnalysis: &storepb.SemanticAnalysisConfig{ProviderId: "provider"},
		}
		err := preparePersistedSemanticAnalysisConfig(setting, nil)
		require.ErrorContains(t, err, "not supported for semantic analysis")
	}
}

func TestPreparePersistedSemanticAnalysisConfigRejectsMissingProvider(t *testing.T) {
	setting := &storepb.InstanceAISetting{SemanticAnalysis: &storepb.SemanticAnalysisConfig{ProviderId: "missing"}}
	err := preparePersistedSemanticAnalysisConfig(setting, nil)
	require.ErrorContains(t, err, "does not reference any configured provider")
}

func TestPreparePersistedSemanticAnalysisConfigAllowsUnsetAndPreservesExisting(t *testing.T) {
	setting := &storepb.InstanceAISetting{Providers: []*storepb.AIProviderConfig{{Id: "router", Type: storepb.AIProviderType_OPENROUTER}}}
	existing := &storepb.InstanceAISetting{SemanticAnalysis: &storepb.SemanticAnalysisConfig{ProviderId: "router"}}
	require.NoError(t, preparePersistedSemanticAnalysisConfig(setting, existing))
	require.Equal(t, "router", setting.GetSemanticAnalysis().GetProviderId())

	setting.SemanticAnalysis = &storepb.SemanticAnalysisConfig{}
	require.NoError(t, preparePersistedSemanticAnalysisConfig(setting, existing))
	require.Empty(t, setting.GetSemanticAnalysis().GetProviderId())
}
