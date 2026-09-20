package frontend

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestDefaultBrandAssets verifies that the default shipped identity is the
// notebook-and-pen artwork selected for this distribution of Memos.
func TestDefaultBrandAssets(t *testing.T) {
	tests := map[string]string{
		"android-chrome-192x192.png": "932e1f441b0725b7fcbe7c00c3dadad4d2788431f99a72d47e94e21a6ec819a0",
		"android-chrome-512x512.png": "7e3b53462b0de9a42353e23a3491a8c5eaa4ef9aa989ae39ba45196ee7e94196",
		"apple-touch-icon.png":        "e5d5afdab00b79b61d4ff1815f0a56733e293c3901eeb38bbc6238b1a53ae89c",
		"full-logo.webp":              "43ae3a6e0f6b80b3902f4f331a8d0a36eea55029c761537a68cd1088c1333300",
		"logo.webp":                   "a6c0057e5689eaea59d4747a344360d1d2ad2108958360454fc71fd1c3bbf290",
	}

	for name, want := range tests {
		t.Run(name, func(t *testing.T) {
			contents, err := os.ReadFile(filepath.Join("..", "..", "web", "public", name))
			require.NoError(t, err)
			got := sha256.Sum256(contents)
			require.Equal(t, want, fmt.Sprintf("%x", got))
		})
	}
}
