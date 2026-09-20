package v1

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

func TestBuildRelatedNotesState(t *testing.T) {
	state := buildRelatedNotesState("source body", "candidate body")
	assert.Contains(t, state, "SOURCE memo:")
	assert.Contains(t, state, "source body")
	assert.Contains(t, state, "CANDIDATE memo:")
	assert.Contains(t, state, "candidate body")
	assert.Less(t, strings.Index(state, "SOURCE"), strings.Index(state, "CANDIDATE"))
}

func TestTruncateMemoContent(t *testing.T) {
	assert.Equal(t, "short", truncateMemoContent("  short\n"))
	long := strings.Repeat("a", relatedNotesMaxMemoChars+10)
	truncated := truncateMemoContent(long)
	assert.Equal(t, relatedNotesMaxMemoChars+1, len([]rune(truncated)))
	assert.True(t, strings.HasSuffix(truncated, "…"))
}

func TestMemoSnippet(t *testing.T) {
	assert.Equal(t, "a b", memoSnippet("a\n\tb"))
	long := strings.Repeat("a", 200)
	snippet := memoSnippet(long)
	assert.Equal(t, 121, len([]rune(snippet)))
	assert.True(t, strings.HasSuffix(snippet, "…"))
}

func TestSortRelatedMemoResults(t *testing.T) {
	results := []*v1pb.RelatedMemoResult{
		{Memo: "memos/low", Relevance: 0.5},
		{Memo: "memos/high", Relevance: 0.9},
		{Memo: "memos/mid", Relevance: 0.7},
	}
	sortRelatedMemoResults(results)
	assert.Equal(t, []string{"memos/high", "memos/mid", "memos/low"}, []string{results[0].Memo, results[1].Memo, results[2].Memo})
}

func TestExtractMemoKeywords(t *testing.T) {
	// Frequency ranking, stopword filtering, punctuation trimming, dedupe.
	keywords := extractMemoKeywords("spring forces! The spring... forces, and #jelly effect", 8)
	assert.Equal(t, []string{"spring", "forces", "jelly", "effect"}, keywords)

	// Short tokens and numbers are dropped; the limit caps the result.
	many := extractMemoKeywords("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda", 4)
	assert.Equal(t, []string{"alpha", "beta", "gamma", "delta"}, many)
	assert.Equal(t, []string{"hello"}, extractMemoKeywords("Hello", 8))
	assert.Empty(t, extractMemoKeywords("ab 12 **", 8))
}

func TestBuildMemoKeywordFilter(t *testing.T) {
	filter := buildMemoKeywordFilter([]string{"spring", `quote"d`, `back\slash`})
	assert.Equal(t, `content.contains("spring") || content.contains("quote\"d") || content.contains("back\\slash")`, filter)
}

func TestMergeRelatedCandidates(t *testing.T) {
	hits := []*store.Memo{{ID: 1}, {ID: 2}}
	recent := []*store.Memo{{ID: 2}, {ID: 3}, {ID: 4}}
	merged := mergeRelatedCandidates(hits, recent, 3)
	assert.Equal(t, []int32{1, 2, 3}, []int32{merged[0].ID, merged[1].ID, merged[2].ID})
}
