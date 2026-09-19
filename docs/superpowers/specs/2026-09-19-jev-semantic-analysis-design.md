# Jev Semantic Analysis Design

## Summary

Add an ephemeral Semantic Analysis inspector for a single memo. An authenticated reader explicitly invokes the inspector from a new sparkle action beside the memo reaction control. The server reads the memo under the caller's normal access scope, sends its content and seven fixed questions to TypeSafe Jev through OpenRouter, and returns seven independent probabilities. Results are never persisted.

On desktop, the result occupies otherwise-unused space to the right of the selected memo. On narrow screens, the same inspector appears as a bottom sheet. One shared inspector serves memo lists and the memo detail page.

## Goals

- Give users fast, inspectable semantic signals about one memo without modifying or labeling it.
- Evaluate seven independent characteristics in one Jev request:
  - idea
  - task
  - journal
  - reference
  - actionable
  - worth revisiting
  - technical or software related
- Reuse an administrator-configured OpenRouter provider and keep provider, model, and questions server-authoritative.
- Keep results ephemeral while avoiding duplicate requests for unchanged content in the current browser session.
- Provide a polished desktop side inspector and a usable mobile fallback.

## Non-goals

- Persisting analysis in the database, memo metadata, local storage, or browser storage.
- Automatically analyzing memos on creation, edit, load, or background schedules.
- Filtering, searching, sorting, or routing memos from these signals.
- Project-affinity classification, open-loop detection, decision detection, or deeper-thinking signals.
- Letting clients supply arbitrary state, questions, provider IDs, or model IDs.
- Supporting providers other than OpenRouter in this first version.

## User Experience

### Entry point

When Semantic Analysis is configured and the viewer is authenticated, memo action rows show a quiet indigo sparkle button immediately beside the emoji reaction control. The button has a tooltip and accessible name of `Semantic analysis`.

The entry point appears anywhere the normal memo reaction action is available, including memo lists and the memo detail page. Anonymous viewers do not see it. A missing or invalid server configuration also hides it.

### Shared inspector

Only one inspector is open at a time:

1. Clicking a sparkle selects that memo and opens the inspector immediately.
2. Clicking another memo's sparkle replaces the selected memo and its result in the existing inspector.
3. Closing the inspector returns the normal layout.

On desktop, the inspector uses available space to the right of the selected memo rather than covering memo content. It remains visually associated with the selected memo. On narrow screens, it opens as a bottom sheet so neither the memo nor the results are compressed into an unusable width.

The success state groups horizontal probability bars into:

- **Note characteristics:** Idea, Task, Journal, Reference.
- **Signals:** Actionable, Revisit later, Technical.

Every row shows a percentage. The header contains the sparkle mark, `Semantic analysis`, a short `Seven independent judgments` description, an Analyze again control, and Close. A small footer indicates that the result matches the current memo and identifies the resolved Jev model.

### Loading, caching, and refresh

- The inspector opens immediately with a lightweight skeleton while the first request runs.
- Results are cached only in application memory, keyed by memo resource name and the memo content revision available to the client.
- Reopening an unchanged memo displays the cached result immediately.
- Editing or receiving an updated memo invalidates its cached result.
- Page reload clears all analysis results.
- Analyze again explicitly bypasses the cached result. During refresh, the existing result remains visible with a subtle progress state.

### Errors

The inspector remains open when analysis fails and shows a concise explanation with Retry. Expected user-facing cases include unavailable configuration, inaccessible or deleted memo, empty memo content, rate limiting, and a temporary provider failure. Provider response details and credentials must not be exposed.

## Configuration

Extend the existing instance AI setting with an optional semantic-analysis configuration:

```proto
message SemanticAnalysisConfig {
  string provider_id = 1;
}
```

Presence enables the feature. Absence disables it. `provider_id` must reference an existing configured provider of type `OPENROUTER`. The API key remains on that provider and continues to use the repository's existing secret-preservation behavior.

The model is not configurable in the first version. The server uses the constant:

```text
~typesafe/jev-latest
```

The administrator UI adds a Semantic Analysis section to the existing AI settings surface. It provides an enable control and an OpenRouter-provider selector. It explains that analysis is performed only on demand and is not saved.

## API Contract

Add a unary method to `AIService`:

```proto
rpc AnalyzeMemoSemantic(AnalyzeMemoSemanticRequest)
    returns (AnalyzeMemoSemanticResponse);

message AnalyzeMemoSemanticRequest {
  string memo = 1; // Required resource name: memos/{uid}.
}

message AnalyzeMemoSemanticResponse {
  double idea_probability = 1;
  double task_probability = 2;
  double journal_probability = 3;
  double reference_probability = 4;
  double actionable_probability = 5;
  double revisit_probability = 6;
  double technical_probability = 7;
  string model = 8;
}
```

The exact generated HTTP route follows the repository's existing Connect and gRPC-Gateway conventions. The request contains only the memo resource name. The browser cannot submit memo text or inference configuration.

The response probabilities are finite numbers in the inclusive range `0..1`. `model` is the provider-reported resolved model and may differ from the configured moving alias.

## Jev Questions

TypeSafe Jev accepts one `state` and multiple independently evaluated typed questions. This feature sends the memo's raw Markdown content as state and seven `noul` questions in one request:

| ID | Instructions |
| --- | --- |
| `is_idea` | Does this memo express or develop an idea, possibility, hypothesis, or proposed direction? |
| `is_task` | Does this memo describe a task, commitment, reminder, or concrete piece of work to complete? |
| `is_journal` | Is this memo primarily a personal record of experiences, events, observations, or reflections? |
| `is_reference` | Is this memo primarily information preserved for later lookup or reference? |
| `is_actionable` | Does this memo imply at least one concrete action that its reader could take? |
| `worth_revisiting` | Would revisiting this memo later likely provide useful follow-up, reflection, or reference value? |
| `is_technical` | Is this memo primarily about software, computing, engineering, or another technical subject? |

These are independent binary judgments, not an exclusive taxonomy. A memo may score highly on several characteristics. There is no `other` probability because each result independently measures evidence for its own statement.

The exact instruction wording is application behavior and must be covered by a request-shape test so accidental changes are visible in review.

## Provider Architecture

Add a small decisions abstraction separate from the existing chat abstraction:

```text
AIService.AnalyzeMemoSemantic
        |
        +-- authenticate, rate-limit, authorize, fetch memo
        +-- resolve SemanticAnalysisConfig + OpenRouter provider
        +-- decision.Client.Evaluate(state, questions)
                           |
                           +-- OpenRouter decisions implementation
```

The OpenRouter implementation belongs under `provider/ai/decision/openrouter` or the closest repository-consistent equivalent. It owns authorization headers, endpoint construction, JSON request and response types, non-success response handling, and response-size limits.

Jev is a decisions model, not a text-generation model. It must not be routed through the existing `/chat/completions` client. TypeSafe documents the `state`, `model`, and `questions` contract. OpenRouter currently exposes decisions through `POST /api/alpha/decisions`; because that route is pre-stable, only the provider implementation may know its path.

References:

- [TypeSafe introduction](https://docs.typesafe.ai/introduction)
- [TypeSafe quick start](https://docs.typesafe.ai/introduction/quickstart)
- [TypeSafe Noul primitive](https://docs.typesafe.ai/primitives/noul)
- [OpenRouter Jev Latest](https://openrouter.ai/~typesafe/jev-latest/)

No new SDK or other production dependency is required. The provider implementation uses the existing Go HTTP stack and repository transport conventions.

## Server Flow and Security

The handler performs operations in this order:

1. Require an authenticated user.
2. Charge a dedicated per-user Semantic Analysis rate-limit scope.
3. Validate the memo resource name.
4. Fetch the memo through the normal store path and enforce the same read policy used by memo retrieval.
5. Reject missing or whitespace-only content before contacting OpenRouter.
6. Resolve the optional Semantic Analysis configuration and its referenced provider.
7. Require the referenced provider to exist, be OpenRouter, and contain usable credentials and endpoint configuration.
8. Send the fixed model, memo content, and seven fixed questions through the decisions client.
9. Validate that all seven expected answers exist, are `noul` answers, and contain finite probabilities from `0` through `1`.
10. Return the typed response without writing any data.

The endpoint is authenticated in the standard service path and is not added as a public unauthenticated ACL route. Any authenticated user who can read a memo may analyze it, including shared memos they do not own. Users who cannot read the memo receive the same safe authorization/not-found behavior used by memo retrieval.

Use a bounded request timeout and bounded response body. Do not log memo content, the provider API key, or full upstream response bodies. Operational logs may contain the RPC outcome, provider/model identifiers, latency, and token usage where available.

## Failure Mapping

- Missing or disabled configuration: `FailedPrecondition`.
- Invalid memo resource name or empty content: `InvalidArgument`.
- Unauthenticated caller: `Unauthenticated`.
- Memo not visible to caller: existing memo read-policy result.
- Rate limit exceeded: existing rate-limit error mapping.
- Provider authentication or request rejection: sanitized `Unavailable` or repository-consistent upstream-provider status.
- Timeout, transport failure, malformed JSON, missing answers, wrong answer types, or invalid probabilities: sanitized `Unavailable` or `Internal`, without upstream secrets or memo content.

The service must never manufacture default probabilities when Jev returns an incomplete or invalid response.

## Frontend State Ownership

A feature-level context or focused hook owns:

- selected memo resource name
- open/closed inspector state
- in-memory results keyed by memo name plus content revision
- first-load, refresh, and error state
- cache invalidation when memo query data changes

Memo cards only render and invoke the sparkle action; they do not own independent inspector instances. The inspector is mounted once at the page/layout level so selecting a different memo updates one panel rather than stacking popovers or dialogs.

The layout must preserve existing memo widths when sufficient right-side space exists. At the responsive breakpoint, it changes to the bottom-sheet presentation. Closing the inspector returns focus to the sparkle button that opened it when that button remains mounted.

## Testing and Verification

### Provider tests

- Exact OpenRouter decisions endpoint, authorization, model, state, and seven-question request shape.
- Successful parsing of all seven `noul` answers and resolved model.
- Non-2xx responses, bounded error bodies, malformed JSON, missing answers, wrong answer types, NaN/infinite values, and values outside `0..1`.
- Context cancellation and timeout behavior.

### Service tests

- Authentication required.
- Readable owned and shared memos succeed.
- Inaccessible memos do not reach the provider.
- Empty content does not reach the provider.
- Missing, invalid, non-OpenRouter, and secret-less configurations fail safely.
- Dedicated per-user rate limiting applies.
- The response maps every probability to the correct API field.
- No store mutation occurs.

### Configuration tests

- Semantic Analysis can be enabled only with an existing OpenRouter provider.
- Deleting or changing a referenced provider cannot leave a silently usable invalid configuration.
- Editing settings without resupplying a provider secret preserves the existing secret.
- Proto source, generated Go/TypeScript/OpenAPI artifacts, and configuration converters remain in sync.

### Frontend tests

- Button visibility for configured authenticated users and absence for anonymous or disabled states.
- Selection and replacement behavior across multiple memo cards.
- Loading, success, error, retry, cached reopen, Analyze again, and memo-revision invalidation.
- Seven correct labels, percentages, and grouping.
- Desktop right-side placement, mobile bottom sheet, close behavior, and focus return.

### Required commands

Run the narrowest tests while iterating, then before completion run:

```text
cd proto && buf generate && buf lint
go test -v -race ./provider/ai/... ./server/api/v1/... ./internal/ratelimit/...
cd web && pnpm lint && pnpm test && pnpm build
git diff --check
```

Perform real browser validation of the memo-list and detail-page interactions at desktop and mobile widths, including focus return, panel replacement, Analyze again, visible geometry, and console errors. If a configured OpenRouter key is available, perform one explicit live smoke test against `~typesafe/jev-latest`; automated tests must remain credential-free and deterministic.

## Rollout and Compatibility

The feature is off by default because the optional configuration is absent. Existing AI providers, transcription, and AI Hub chat configuration continue unchanged. Enabling the feature requires an administrator to select an existing OpenRouter provider.

Because results are ephemeral and the RPC is read-only, rollback consists of removing or disabling the Semantic Analysis configuration or reverting the code. There is no data migration and no persisted analysis data to clean up.
