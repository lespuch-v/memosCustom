# Jev Semantic Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-demand, non-persistent Semantic Analysis inspector that evaluates one readable memo with seven independent TypeSafe Jev judgments through an administrator-configured OpenRouter provider.

**Architecture:** A dedicated `provider/ai/decision` client owns Jev's state-and-questions protocol and OpenRouter's pre-stable decisions endpoint. A new authenticated `AIService` RPC fetches and authorizes the memo, applies a dedicated rate limit, sends seven server-owned Noul questions, validates the complete result, and returns typed probabilities. One frontend context owns selection and an in-memory revision-keyed cache; memo headers invoke it, while `RootLayout` renders one responsive desktop right rail/mobile sheet.

**Tech Stack:** Go 1.27, Echo/Connect RPC, Protocol Buffers/Buf, React 19, TypeScript 6, React Query 5, Tailwind CSS 4, Base UI primitives, Vitest/Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-19-jev-semantic-analysis-design.md`

## Global Constraints

- Results must never be persisted to the database, memo metadata, local storage, or browser storage.
- The browser sends only a memo resource name; provider, model, questions, and memo content remain server-authoritative.
- The fixed model is `~typesafe/jev-latest` and the first version supports only configured `OPENROUTER` providers.
- All seven judgments are independent Jev `noul` questions sent in one request.
- Do not add a TypeSafe/OpenRouter SDK or another production dependency; use the existing Go HTTP stack.
- Do not route Jev through `/chat/completions`; isolate `POST /api/alpha/decisions` inside the OpenRouter decisions provider.
- The feature is absent by default and visible only to authenticated users when a valid Semantic Analysis configuration is present.
- Any authenticated user who can read a memo may analyze it; normal memo authorization remains authoritative.
- Generated files under `proto/gen/` and `web/src/types/proto/` must come from `.proto` changes via `cd proto && buf generate`.
- Preserve unrelated working-tree changes and do not include `.superpowers/` visual-companion artifacts in implementation commits.

## Review Focus

- A configured provider may be deleted or changed from OpenRouter while another AI feature still references it; saving must clear or reject only the invalid semantic configuration without corrupting transcription/chat drafts.
- A memo can be updated between a cached analysis and reopening the inspector; the cache key must include a stable content revision and stale results must not be labeled current.
- Jev may return syntactically valid JSON with one missing answer, a wrong answer type, `NaN`/infinity, or a probability outside `0..1`; the service must fail rather than synthesize a score.
- A user may open analysis and then lose memo access or the memo may be deleted before retry/refresh; every RPC must re-fetch and re-authorize instead of trusting client state.
- Desktop list layouts can use multiple columns and memo cards can unmount during filtering/navigation; the single inspector must replace selection cleanly and return focus only when the original trigger still exists.

---

## File Map

### New files

- `provider/ai/decision/decision.go` — provider-independent request, question, answer, result, and client interface.
- `provider/ai/decision/openrouter/openrouter.go` — OpenRouter decisions HTTP transport and strict response validation.
- `provider/ai/decision/openrouter/openrouter_test.go` — request-shape, parsing, bounds, error, and cancellation tests.
- `server/api/v1/ai_semantic.go` — fixed Jev model/questions, configuration resolution, memo authorization, and RPC mapping.
- `web/src/contexts/SemanticAnalysisContext.tsx` — selected memo, request lifecycle, revision-keyed memory cache, refresh, close, and focus-return ownership.
- `web/src/components/SemanticAnalysis/SemanticAnalysisButton.tsx` — quiet indigo sparkle action used by memo headers.
- `web/src/components/SemanticAnalysis/SemanticAnalysisInspector.tsx` — success, skeleton, error, refresh, and responsive rail/sheet UI.
- `web/src/components/SemanticAnalysis/index.ts` — focused exports.
- `web/tests/semantic-analysis-settings.test.tsx` — admin configuration behavior.
- `web/tests/semantic-analysis-context.test.tsx` — cache, refresh, replacement, revision invalidation, and late-response behavior.
- `web/tests/semantic-analysis-ui.test.tsx` — button visibility, result rendering, responsive shell, close, and focus behavior.

### Modified source files

- `proto/store/instance_setting.proto` — persisted `SemanticAnalysisConfig` referenced by `InstanceAISetting`.
- `proto/api/v1/instance_service.proto` — public configuration shape.
- `proto/api/v1/ai_service.proto` — `AnalyzeMemoSemantic` RPC and typed probabilities.
- `server/api/v1/instance_service_converters.go` — public/store configuration conversion.
- `server/api/v1/instance_service_validation.go` — semantic provider reference/type/secret validation.
- `server/api/v1/instance_service_validation_test.go` — configuration validation coverage.
- `server/api/v1/test/instance_service_test.go` — configuration API round-trip and secret-preservation coverage.
- `server/api/v1/test/ai_service_test.go` — authenticated semantic RPC behavior and authorization coverage.
- `internal/ratelimit/ratelimit.go` and `internal/ratelimit/ratelimit_test.go` — dedicated per-user semantic budget.
- `web/src/components/Settings/AISection.tsx` — OpenRouter selector and enable/save behavior.
- `web/src/components/MemoView/components/MemoHeader.tsx` — place the sparkle beside the reaction trigger.
- `web/src/layouts/RootLayout.tsx` — mount one context and responsive inspector for all normal memo routes.
- `web/src/locales/en.json` — canonical English copy for settings, action, inspector, and errors.
- Other locale JSON files — carry the new English fallback strings only if repository locale policy/tests require key parity; do not invent machine translations.

### Generated files

- `proto/gen/api/v1/ai_service.pb.go`, `proto/gen/api/v1/ai_service.pb.gw.go`, `proto/gen/api/v1/ai_service_grpc.pb.go`, and OpenAPI output generated by Buf.
- `proto/gen/api/v1/instance_service.pb.go` and `proto/gen/store/instance_setting.pb.go` generated by Buf.
- `web/src/types/proto/api/v1/ai_service_pb.ts` and `web/src/types/proto/api/v1/instance_service_pb.ts` generated by Buf.

## Task 1: Dedicated OpenRouter Decisions Client

**Files:**
- Create: `provider/ai/decision/decision.go`
- Create: `provider/ai/decision/openrouter/openrouter.go`
- Create: `provider/ai/decision/openrouter/openrouter_test.go`
- Reference: `provider/ai/chat/openai/openai.go`
- Reference: `provider/ai/endpoint.go`

**Interfaces:**
- Consumes: `ai.ProviderConfig` from `provider/ai/ai.go` and existing endpoint/header conventions.
- Produces: `decision.Client.Evaluate(context.Context, decision.Request) (*decision.Result, error)` and `openrouter.New(ai.ProviderConfig, ...decision.Option) (*Client, error)` for the service task.

- [ ] **Step 1: Define provider-independent decision types and the client contract**

```go
package decision

import "context"

type Question struct {
	Type         string            `json:"type"`
	Instructions string            `json:"instructions"`
	Criteria     map[string]string `json:"criteria,omitempty"`
}

type Request struct {
	Model     string
	State     string
	Questions map[string]Question
}

type NoulAnswer struct {
	Type string  `json:"type"`
	Noul float64 `json:"noul"`
}

type Result struct {
	Model   string
	Answers map[string]NoulAnswer
}

type Client interface {
	Evaluate(context.Context, Request) (*Result, error)
}
```

Add functional options matching `provider/ai/chat/options.go`: `WithHTTPClient(*http.Client)` for deterministic tests and a bounded default client timeout.

- [ ] **Step 2: Write failing request-shape and success-parsing tests**

Create an `httptest.Server` that asserts:

```go
require.Equal(t, "/api/alpha/decisions", r.URL.Path)
require.Equal(t, "Bearer secret", r.Header.Get("Authorization"))
require.Equal(t, "application/json", r.Header.Get("Content-Type"))
require.Equal(t, "~typesafe/jev-latest", body.Model)
require.Equal(t, "memo body", body.State)
require.Equal(t, decision.Question{Type: "noul", Instructions: "Is this actionable?"}, body.Questions["is_actionable"])
```

Return `{"model":"typesafe/jev-1.13","answers":{"is_actionable":{"type":"noul","noul":0.875}}}` and assert the resolved model and probability.

- [ ] **Step 3: Run the focused test and verify it fails**

Run: `go test -v ./provider/ai/decision/openrouter`

Expected: FAIL because the client and types do not yet exist.

- [ ] **Step 4: Implement the minimal OpenRouter transport**

Use `ai.ResolveEndpoint`/existing endpoint rules where applicable, but normalize the configured OpenRouter base URL to exactly one `api/alpha/decisions` path. Encode:

```go
type requestBody struct {
	Model     string                       `json:"model"`
	State     string                       `json:"state"`
	Questions map[string]decision.Question `json:"questions"`
}
```

Decode a bounded response body, reject non-2xx status codes with sanitized errors, and preserve context cancellation. Never include API keys, state, or full upstream bodies in returned errors.

- [ ] **Step 5: Add failing malformed-answer and failure-mode tests**

Table-test: missing `answers`, missing requested key, answer `type != "noul"`, `math.NaN()`, positive infinity, `-0.01`, `1.01`, malformed JSON, oversized response, `401`, `429`, `500`, and a canceled request. Assert no invalid case produces a `Result`.

- [ ] **Step 6: Implement strict answer validation and error mapping**

For every requested question, require an answer with `Type == "noul"` and `!math.IsNaN`, `!math.IsInf`, `0 <= Noul <= 1`. Ignore no missing requested key; extra keys may be ignored. Keep upstream status internally classifiable without leaking its body.

- [ ] **Step 7: Run provider tests and static checks**

Run: `go test -v -race ./provider/ai/decision/...`

Expected: PASS.

Run: `gofmt -w provider/ai/decision provider/ai/decision/openrouter`

- [ ] **Step 8: Commit the provider increment**

```bash
git add provider/ai/decision
git commit -m "feat: add OpenRouter decisions client"
```

## Task 2: Proto Contract and Semantic Configuration

**Files:**
- Modify: `proto/store/instance_setting.proto`
- Modify: `proto/api/v1/instance_service.proto`
- Modify: `proto/api/v1/ai_service.proto`
- Modify: `server/api/v1/instance_service_converters.go`
- Modify: `server/api/v1/instance_service_validation.go`
- Modify: `server/api/v1/instance_service_validation_test.go`
- Modify: `server/api/v1/test/instance_service_test.go`
- Generated: `proto/gen/**`, `web/src/types/proto/**`, OpenAPI output

**Interfaces:**
- Consumes: existing `InstanceAISetting.providers`, `AIProviderType_OPENROUTER`, converter patterns, and write-only key preservation.
- Produces: store/public `SemanticAnalysisConfig{provider_id}`, `AIService.AnalyzeMemoSemantic`, request field `memo`, and seven `double` probability fields plus `model`.

- [ ] **Step 1: Write failing configuration validation tests**

Add cases asserting:

```go
func TestPreparePersistedSemanticAnalysisConfigRequiresOpenRouter(t *testing.T)
func TestPreparePersistedSemanticAnalysisConfigRejectsMissingProvider(t *testing.T)
func TestPreparePersistedSemanticAnalysisConfigAllowsUnset(t *testing.T)
func TestPrepareInstanceAISettingPreservesProviderSecretForSemanticAnalysis(t *testing.T)
```

The valid fixture uses provider ID `router` with `AIProviderType_OPENROUTER`. A provider of type OpenAI, Gemini, or DeepInfra must be rejected even if it is chat-capable.

- [ ] **Step 2: Run validation tests and verify they fail**

Run: `go test -v -run 'SemanticAnalysis|InstanceAISetting' ./server/api/v1/...`

Expected: FAIL because the configuration fields and validation function do not exist.

- [ ] **Step 3: Add source proto messages and RPC**

Add field 4 to both AI setting messages:

```proto
SemanticAnalysisConfig semantic_analysis = 4;
```

Add the store top-level and public nested message with `string provider_id = 1`. Add to `AIService`:

```proto
rpc AnalyzeMemoSemantic(AnalyzeMemoSemanticRequest) returns (AnalyzeMemoSemanticResponse) {
  option (google.api.http) = { post: "/api/v1/ai:analyzeMemoSemantic" body: "*" };
  option (google.api.method_signature) = "memo";
}
```

Define the request and response exactly as approved in the spec, using field numbers 1 through 8 without reusing reserved fields.

- [ ] **Step 4: Regenerate and lint protobuf artifacts**

Run: `cd proto && buf generate && buf lint`

Expected: PASS and generated Go, TypeScript, gateway, and OpenAPI diffs corresponding only to the new fields/RPC.

- [ ] **Step 5: Implement converters and semantic configuration validation**

Add `convertSemanticAnalysisConfigFromStore` and `convertSemanticAnalysisConfigToStore`. Extend `prepareInstanceAISettingForUpdate` with:

```go
func preparePersistedSemanticAnalysisConfig(setting *storepb.InstanceAISetting) error
```

Treat `nil` or empty `provider_id` as disabled and normalize it to nil/empty consistently with transcription/chat. Otherwise find the provider by ID, require `OPENROUTER`, and rely on the existing provider-secret preservation pass before validating usable credentials.

- [ ] **Step 6: Add API round-trip and provider-deletion tests**

In `server/api/v1/test/instance_service_test.go`, verify an administrator can save/read the semantic provider reference without reading the API key. Verify deleting the referenced provider while leaving the semantic config set fails; clearing semantic config in the same update succeeds and leaves chat/transcription untouched.

- [ ] **Step 7: Run proto and configuration verification**

Run: `go test -v ./server/api/v1/...`

Run: `cd proto && buf lint && buf format --diff --exit-code`

Expected: PASS.

- [ ] **Step 8: Commit the contract/configuration increment**

```bash
git add proto server/api/v1/instance_service_converters.go server/api/v1/instance_service_validation.go server/api/v1/instance_service_validation_test.go server/api/v1/test/instance_service_test.go web/src/types/proto
git commit -m "feat: configure Jev semantic analysis"
```

## Task 3: Authenticated Semantic Analysis Service

**Files:**
- Create: `server/api/v1/ai_semantic.go`
- Modify: `server/api/v1/test/ai_service_test.go`
- Modify: `internal/ratelimit/ratelimit.go`
- Modify: `internal/ratelimit/ratelimit_test.go`

**Interfaces:**
- Consumes: `decision.Client`, `openrouter.New`, `SemanticAnalysisConfig`, `AIProviderConfig`, the generated RPC request/response, `fetchCurrentUser`, and the memo read-policy path used by `GetMemo`.
- Produces: `APIV1Service.AnalyzeMemoSemantic(context.Context, *v1pb.AnalyzeMemoSemanticRequest) (*v1pb.AnalyzeMemoSemanticResponse, error)` and `ratelimit.ScopeSemanticAnalysisUser`.

- [ ] **Step 1: Add an injectable decisions-client seam to service tests**

Follow existing AI service `httptest.Server` patterns rather than adding mutable package state. Configure an OpenRouter provider endpoint pointed at the test server and capture whether it was called and what body it received.

- [ ] **Step 2: Write failing happy-path and exact-question tests**

Create a readable memo containing Markdown, configure semantic analysis, call the RPC, and assert:

```go
require.Equal(t, memo.Content, captured.State)
require.Equal(t, "~typesafe/jev-latest", captured.Model)
require.Equal(t, sevenQuestionIDs, maps.Keys(captured.Questions))
require.Equal(t, 0.91, response.IdeaProbability)
require.Equal(t, "typesafe/jev-1.13", response.Model)
```

Pin every approved instruction string from the spec so question drift is reviewed deliberately.

- [ ] **Step 3: Write failing authorization and review-focus tests**

Cover unauthenticated caller, owner, authenticated reader of a visible/shared memo, user without read access, deleted memo, whitespace-only content, missing configuration, missing provider, wrong provider type, missing provider secret, and provider returning any invalid answer. Assert unauthorized/empty/configuration cases never reach the upstream test server.

- [ ] **Step 4: Add the dedicated rate-limit scope and policy test**

Add:

```go
ScopeSemanticAnalysisUser Scope = "semantic_analysis_user"
```

Use a starting default of 120 requests per user per hour, matching chat's paid-provider budget. Add it to `TestDefaultPolicyCoversEveryScope` and a service test that proves the second call is refused under a test policy with limit 1.

- [ ] **Step 5: Run focused tests and verify they fail**

Run: `go test -v -run 'Semantic|DefaultPolicyCoversEveryScope' ./server/api/v1/... ./internal/ratelimit/...`

Expected: FAIL because the handler and scope do not exist.

- [ ] **Step 6: Implement configuration resolution and the fixed question set**

In `ai_semantic.go`, define:

```go
const semanticAnalysisModel = "~typesafe/jev-latest"

var semanticAnalysisQuestions = map[string]decision.Question{
	"is_idea": {Type: "noul", Instructions: "Does this memo express or develop an idea, possibility, hypothesis, or proposed direction?"},
	"is_task": {Type: "noul", Instructions: "Does this memo describe a task, commitment, reminder, or concrete piece of work to complete?"},
	"is_journal": {Type: "noul", Instructions: "Is this memo primarily a personal record of experiences, events, observations, or reflections?"},
	"is_reference": {Type: "noul", Instructions: "Is this memo primarily information preserved for later lookup or reference?"},
	"is_actionable": {Type: "noul", Instructions: "Does this memo imply at least one concrete action that its reader could take?"},
	"worth_revisiting": {Type: "noul", Instructions: "Would revisiting this memo later likely provide useful follow-up, reflection, or reference value?"},
	"is_technical": {Type: "noul", Instructions: "Is this memo primarily about software, computing, engineering, or another technical subject?"},
}
```

Resolve only the configured OpenRouter provider and construct the dedicated decisions client. Return `FailedPrecondition` for absent/invalid server configuration.

- [ ] **Step 7: Implement the RPC in the tested order**

Require authentication, charge `ScopeSemanticAnalysisUser`, parse `memos/{uid}`, fetch the memo, apply the same visibility/access decision as `GetMemo`, reject `strings.TrimSpace(content) == ""`, call Jev, and map the seven answer IDs to the seven response fields. Do not write to Store.

If the existing `GetMemo` authorization logic cannot be safely reused without calling another transport handler, extract only the narrow read-policy function beside its current caller and cover both old and new paths. Do not introduce a generic helper package.

- [ ] **Step 8: Run server and rate-limit tests**

Run: `go test -v -race ./server/api/v1/... ./internal/ratelimit/...`

Expected: PASS.

- [ ] **Step 9: Commit the service increment**

```bash
git add server/api/v1/ai_semantic.go server/api/v1/test/ai_service_test.go internal/ratelimit
git commit -m "feat: analyze memo semantics with Jev"
```

## Task 4: Administrator Semantic Analysis Settings

**Files:**
- Modify: `web/src/components/Settings/AISection.tsx`
- Create: `web/tests/semantic-analysis-settings.test.tsx`
- Modify: `web/src/locales/en.json`
- Possibly modify locale JSON files only for required key parity

**Interfaces:**
- Consumes: generated `InstanceSetting_SemanticAnalysisConfig`, existing `useInstance()` AI setting, `persistAISetting`, and `InstanceSetting_AIProviderType.OPENROUTER`.
- Produces: saved/cleared `semanticAnalysis.providerId` and a client-visible configured state through `InstanceContext`.

- [ ] **Step 1: Write failing settings tests**

Test that the form:

- lists only OpenRouter providers;
- offers a disabled/none option;
- saves `{providerId: "router"}` without changing provider, transcription, or chat drafts;
- clears the semantic config when disabled;
- clears the persisted semantic reference when its provider is deleted while preserving other AI configs;
- warns when the selected provider has no stored or newly entered key;
- does not wipe an in-progress semantic draft when a provider-only save refreshes instance settings.

- [ ] **Step 2: Run the focused frontend test and verify it fails**

Run: `cd web && pnpm test -- semantic-analysis-settings.test.tsx`

Expected: FAIL because the form and generated config use are absent.

- [ ] **Step 3: Extend local settings state and persistence atomically**

Add:

```ts
type LocalSemanticAnalysis = { providerId: string };

const toLocalSemanticAnalysis = (config?: InstanceSetting_SemanticAnalysisConfig): LocalSemanticAnalysis => ({
  providerId: config?.providerId ?? "",
});
```

Extend every `persistAISetting` call to pass an explicit semantic config just as it already passes transcription and chat. This prevents provider saves from committing unsaved semantic edits and prevents semantic saves from committing unsaved chat/transcription edits.

- [ ] **Step 4: Add the settings section**

Render a `SettingSection` titled `Semantic analysis` with explanatory copy: analysis runs only when requested and is not saved. The selector contains `None` plus providers where `type === OPENROUTER`; no model input is shown because the server fixes Jev latest.

- [ ] **Step 5: Add canonical English strings and satisfy locale policy**

Add keys for section title/description, provider label, none option, missing-provider warning, save action, sparkle tooltip, inspector labels, refresh, retry, current-memo status, and error copy. Run existing locale-key tests; if they require parity, add the English fallback values to other locale files without presenting them as translations.

- [ ] **Step 6: Run settings and lint verification**

Run: `cd web && pnpm test -- semantic-analysis-settings.test.tsx`

Run: `cd web && pnpm lint`

Expected: PASS.

- [ ] **Step 7: Commit the settings increment**

```bash
git add web/src/components/Settings/AISection.tsx web/tests/semantic-analysis-settings.test.tsx web/src/locales
git commit -m "feat: configure memo semantic analysis"
```

## Task 5: Shared Ephemeral Analysis State

**Files:**
- Create: `web/src/contexts/SemanticAnalysisContext.tsx`
- Create: `web/tests/semantic-analysis-context.test.tsx`
- Modify: `web/src/layouts/RootLayout.tsx`

**Interfaces:**
- Consumes: `aiServiceClient.analyzeMemoSemantic({memo})`, `Memo` name/content/updateTime, and generated `AnalyzeMemoSemanticResponse`.
- Produces: `useSemanticAnalysis()` with `openForMemo(memo, trigger)`, `close()`, `refresh()`, `selectedMemo`, `result`, `isLoading`, `isRefreshing`, and `error`.

- [ ] **Step 1: Define and test the revision key as a pure function**

Use the memo resource name plus a content-revision value. Prefer the protobuf `updateTime` when present, but include content as a collision-safe fallback for optimistic/local changes:

```ts
export const semanticRevisionKey = (memo: Memo) =>
  `${memo.name}\u0000${memo.updateTime ? timestampDate(memo.updateTime).toISOString() : ""}\u0000${memo.content}`;
```

Test same memo/same revision equality and invalidation on content or timestamp change.

- [ ] **Step 2: Write failing context lifecycle tests**

With a mocked `aiServiceClient`, prove:

- first open calls the RPC once and exposes loading;
- close/reopen unchanged uses memory cache without another RPC;
- refresh makes a new call while retaining the previous result;
- revised content makes a new call and does not display the old result as current;
- selecting memo B while memo A is pending prevents A's late response from replacing B;
- close followed by a late response does not reopen the inspector;
- only one selected memo exists;
- closing returns focus to the initiating trigger if it is still connected and does nothing if it unmounted.

- [ ] **Step 3: Run the context test and verify it fails**

Run: `cd web && pnpm test -- semantic-analysis-context.test.tsx`

Expected: FAIL because the provider/context does not exist.

- [ ] **Step 4: Implement the context with an in-memory Map and request identity guard**

Store `Map<string, AnalyzeMemoSemanticResponse>` in a ref, not React Query persistence or storage. Maintain an incrementing request ID or `AbortController`; only the active selection/request may commit state. `refresh()` bypasses the cache. Do not clear a valid previous result until refresh succeeds or the memo revision changes.

- [ ] **Step 5: Mount the provider once in RootLayout**

Wrap the normal routed content so Home, Explore, user profile, archived, and memo detail share one inspector selection. Do not mount a provider per list or per memo card.

- [ ] **Step 6: Run focused tests and lint**

Run: `cd web && pnpm test -- semantic-analysis-context.test.tsx`

Run: `cd web && pnpm lint`

Expected: PASS.

- [ ] **Step 7: Commit the state-management increment**

```bash
git add web/src/contexts/SemanticAnalysisContext.tsx web/src/layouts/RootLayout.tsx web/tests/semantic-analysis-context.test.tsx
git commit -m "feat: manage ephemeral semantic analysis"
```

## Task 6: Memo Sparkle Action and Responsive Inspector

**Files:**
- Create: `web/src/components/SemanticAnalysis/SemanticAnalysisButton.tsx`
- Create: `web/src/components/SemanticAnalysis/SemanticAnalysisInspector.tsx`
- Create: `web/src/components/SemanticAnalysis/index.ts`
- Modify: `web/src/components/MemoView/components/MemoHeader.tsx`
- Modify: `web/src/layouts/RootLayout.tsx`
- Modify: `web/tests/memo-header-navigation.test.tsx`
- Create: `web/tests/semantic-analysis-ui.test.tsx`

**Interfaces:**
- Consumes: `useSemanticAnalysis()`, `useInstance().aiSetting.semanticAnalysis`, current authenticated user, and current memo.
- Produces: a quiet indigo sparkle immediately after the reaction trigger and one desktop right rail/mobile bottom sheet.

- [ ] **Step 1: Write failing sparkle visibility and placement tests**

Extend the memo-header test mocks and assert the action order is reaction, semantic analysis, then existing visibility/pin/menu actions. Test hidden states: no current user, archived/read-only memo if reactions are unavailable, absent semantic config, and a configured provider that is missing or not OpenRouter. Test the button has `aria-label="Semantic analysis"`, tooltip copy, quiet `icon-sm` geometry, and an active indigo state when its memo is selected.

- [ ] **Step 2: Write failing inspector rendering tests**

Assert success renders all seven labels and rounded percentages (for example `0.875` as `88%`) in the two approved groups. Assert skeleton, error/Retry, Analyze again, Close, resolved model footer, and current-memo indicator. Assert the desktop container has the right-rail layout classes and the narrow-screen presentation uses the existing dialog/sheet primitive with a usable accessible title.

- [ ] **Step 3: Run UI tests and verify they fail**

Run: `cd web && pnpm test -- memo-header-navigation.test.tsx semantic-analysis-ui.test.tsx`

Expected: FAIL because the components are absent.

- [ ] **Step 4: Implement the sparkle action**

Use a Lucide sparkle/sparkles glyph and existing `Button`, tooltip, and focus classes. Keep it next to the reaction selector inside `data-slot="memo-header-actions"`. The click passes the memo and `event.currentTarget` to `openForMemo`; it must not navigate or mutate the memo.

- [ ] **Step 5: Implement the inspector body**

Define a single row table:

```ts
const groups = [
  { label: "Note characteristics", rows: [["Idea", "ideaProbability"], ["Task", "taskProbability"], ["Journal", "journalProbability"], ["Reference", "referenceProbability"]] },
  { label: "Signals", rows: [["Actionable", "actionableProbability"], ["Revisit later", "revisitProbability"], ["Technical", "technicalProbability"]] },
] as const;
```

Render accessible progress semantics (`role="progressbar"`, `aria-valuemin={0}`, `aria-valuemax={100}`, `aria-valuenow={percent}`) in addition to the visual bar and percentage text.

- [ ] **Step 6: Implement desktop rail and mobile sheet without narrowing memo cards**

At desktop width, position the inspector in RootLayout's available content space to the right of the main memo column, with bounded width around 310–350px. Do not change `PagedMemoList` packing width or MemoDetail's `max-w-2xl` memo column. At the responsive breakpoint, render the same body inside the existing accessible dialog/sheet primitive. Verify that list filters or navigation that unmount the trigger do not throw during close.

- [ ] **Step 7: Run UI and broader frontend tests**

Run: `cd web && pnpm test -- memo-header-navigation.test.tsx semantic-analysis-context.test.tsx semantic-analysis-ui.test.tsx paged-memo-list.test.tsx memo-detail-access.test.tsx`

Run: `cd web && pnpm lint`

Expected: PASS.

- [ ] **Step 8: Commit the visible feature increment**

```bash
git add web/src/components/SemanticAnalysis web/src/components/MemoView/components/MemoHeader.tsx web/src/layouts/RootLayout.tsx web/tests
git commit -m "feat: add memo semantic inspector"
```

## Task 7: End-to-End Verification and Polish

**Files:**
- Modify only files required by failures discovered in this task.
- Verify: all files changed since the design commit.

**Interfaces:**
- Consumes: the complete server and frontend feature.
- Produces: release-ready evidence, one optional live OpenRouter smoke result, and a clean diff.

- [ ] **Step 1: Run proto verification**

Run: `cd proto && buf generate && buf lint && buf format --diff --exit-code`

Expected: PASS with no newly generated diff after the first command.

- [ ] **Step 2: Run backend verification**

Run: `go test -v -race ./provider/ai/... ./server/api/v1/... ./internal/ratelimit/...`

Expected: PASS.

- [ ] **Step 3: Run frontend verification**

Run: `cd web && pnpm lint && pnpm test && pnpm build`

Expected: PASS. If an unrelated Windows/CRLF baseline failure occurs, record the exact command/output separately and still run every focused Semantic Analysis test.

- [ ] **Step 4: Start the application and perform desktop browser QA**

Run backend and frontend using the repository commands. With an authenticated user and configured OpenRouter provider, verify in both a memo list and memo detail:

1. Sparkle sits beside the reaction control and has correct hover/focus/tooltip behavior.
2. First click opens the right rail without shifting or narrowing the memo card.
3. Selecting another memo replaces the existing inspector.
4. Close returns focus when the trigger remains mounted.
5. Reopen uses the in-memory result; Analyze again performs a new request.
6. Editing the memo invalidates the old revision.
7. Error and retry remain contained in the inspector.
8. Browser console has no new warnings or errors.

- [ ] **Step 5: Perform mobile browser QA**

At representative narrow widths, verify the sparkle remains operable, the bottom sheet has an accessible title and close control, every probability is readable, background scrolling/focus follow the existing primitive, and closing returns to the trigger when possible.

- [ ] **Step 6: Perform one explicit live OpenRouter smoke test when credentials are available**

Use the configured application flow, not a key pasted into source or shell history. Confirm `~typesafe/jev-latest` resolves, `/api/alpha/decisions` accepts the seven-question request, all seven Noul values return, the model footer reflects the resolved model, and no memo/store mutation occurs. If no configured key is available, report this single verification limit rather than weakening automated tests.

- [ ] **Step 7: Inspect final diff and repository state**

Run: `git diff --check`

Run: `git status --short --branch`

Run: `git diff 939e3cdb...HEAD --stat`

Confirm generated outputs match source protos, no secrets or `.superpowers/` files are tracked, and no unrelated changes entered feature commits.

- [ ] **Step 8: Commit any verification-only fixes**

```bash
git add provider/ai/decision server/api/v1 internal/ratelimit proto web/src web/tests
git commit -m "test: verify Jev semantic analysis"
```

Skip this commit when verification required no changes.
