# Consistent Confluence Pi TUI Design

## Goal

Give all currently registered Confluence Pi tools one consistent interactive experience across:

- Single operations: reads, searches, creates, updates, moves, deletes, comments, properties, attachments, versions, exports, conversions, previews, and similar tools.
- Current bulk operations: page batches, comment batches, copy-tree preview/execution, and version-purge preview/execution.

The experience covers both transcript rendering and write authorization. It must preserve the existing execution and safety semantics.

## Scope

This design applies to the canonical Confluence tools registered by `.pi/extensions/confluence-cli.ts`:

- Thirteen read-only tools.
- Twelve ordinary write tools.
- Four preview-backed bulk tools.
- `confluence_pages_batch` and `confluence_comments_batch` when `CONFLUENCE_PI_BULK_ACTIONS=true`.

The presentation contract should be reusable by future batch-read or mixed-workflow tools, but this work does not define or register any new tool APIs.

## Non-goals

- Changing tool names, schemas, CLI commands, or Confluence operations.
- Parsing Confluence response bodies solely to improve display.
- Changing preflight, approval tokens, retries, execution order, partial failures, cancellation, or unknown-result behavior.
- Editing tool arguments or payloads from an authorization screen.
- Adding resource-specific page, comment, property, attachment, or version components.
- Adding partial batch selection to RPC, JSON, or print modes.

## Current State

Canonical tools share registration loops and execution helpers but have no custom `renderCall` or `renderResult`. Pi therefore displays fallback tool names and raw result content.

Ordinary writes normalize and preflight input before using Pi's standard `confirm` or `input` dialogs. Non-destructive writes use approve/cancel; destructive writes require exact phrases.

Copy-tree and version-purge previews issue one-use, five-minute approval IDs. Their execution tools consume and revalidate those approvals before exact-phrase authorization.

Interactive page and comment batches currently open a custom partial-selection component, close it, re-preflight selected actions, and then open a separate exact-phrase prompt. RPC skips partial selection and confirms the complete batch through Pi's extension UI protocol. JSON and print modes cannot authorize writes.

## Design Principles

1. Looking stays separate from doing: reads and previews never prompt for authorization.
2. Existing operation policy, preflight output, and result details remain the source of truth.
3. Collapsed transcript rows stay compact; expansion provides raw detail.
4. Presentation cannot weaken or replace authorization.
5. One shared implementation serves every current resource and action.
6. Missing UI or uncertain mutation state fails closed.

## Architecture and Components

### Generic Tool Renderer

A shared renderer is attached through the existing read, ordinary-write, bulk-write, and batch registration loops. It supplies both `renderCall` and `renderResult` for every canonical tool.

The renderer derives the display resource and action from the canonical tool name and registration family. It uses existing operation risk metadata where available and receives the batch category from the existing batch registration path. It does not introduce a second per-tool presentation registry.

The renderer consumes only:

- Canonical tool name.
- Current arguments.
- Pi render context and state.
- Existing result `content` and `details`.
- Existing error and partial-result flags.

### Unified Write Review

A shared TUI review component replaces the current TUI-only confirmation presentation. The existing authorization flow remains its controller and owns normalization, preflight, allowlist checks, snapshots, approval validation, and execution.

The component has three capabilities enabled as needed:

- Canonical preflight summary display.
- Batch action selection.
- Approve/cancel or exact-phrase input.

It is review-only. It never edits arguments, payloads, preflight facts, or approval records, and it cannot invoke a mutation.

### Existing Execution Layer

The command runner, operation policy, preflight store, preflight handlers, write authorization checks, and mutation executors remain authoritative and unchanged in responsibility. Presentation receives prepared data from these layers and returns only a user decision or selected indexes.

## Rendering Contract

### Tool Calls

Collapsed calls use this conceptual form:

```text
Confluence · <resource> <action> · <safe key arguments>
```

Safe key arguments include identifiers and short routing fields already present in the call, such as page ID, space key, title, parent ID, property key, attachment ID, version number, query, destination, or action count. The formatter omits inline bodies, property values, file contents, and approval IDs from collapsed output.

Partial argument streams must render without throwing. Missing or malformed display fields produce a generic Confluence operation label until complete arguments are available.

### Tool Results

Collapsed results use text plus a themed state; symbols may supplement but never replace the text label:

- Pending.
- Succeeded.
- Cancelled — no mutation.
- Partial — with existing batch counts when available.
- Unknown — mutation outcome must be reviewed before retry.
- Failed.
- Approval ready — with existing operation, count, and expiry metadata when available.
- Truncated — when the existing result marks truncation.

The renderer may display only metadata already known in arguments or `details`. It must not parse JSON, HTML, storage format, Markdown, or plain-text response bodies to synthesize richer cards.

Expanded results show the unchanged raw result content as plain text. Existing redaction and the untrusted-content prefix remain visible. Confluence content is not rendered as trusted Markdown or interpreted as instructions.

If result details are absent or malformed, the renderer falls back to raw content. A rendering problem must not alter tool execution, persisted content, result details, or error state.

### Component Behavior

All components:

- Respect the width supplied by Pi.
- Use the injected theme and keybindings.
- Request rendering after visible state changes.
- Invalidate cached themed output correctly.
- Remove abort listeners and other transient resources on disposal.
- Keep keyboard controls sufficient without requiring a mouse.

## Authorization Interaction

### Ordinary Non-destructive Writes

After existing normalization, preflight, and allowlist validation, TUI opens the unified review with the canonical preflight summary and approve/cancel controls. Approval proceeds to the existing post-confirmation checks; cancellation returns the existing no-mutation result.

### Destructive Single Writes

The same review displays the canonical preflight summary and the existing exact phrase. Mutation remains blocked until the entered value matches exactly. Blank input, mismatch, Escape, or abort starts no mutation.

The existing phrases remain unchanged, including page, comment, property, attachment, and version deletion phrases.

### Preview-backed Bulk Writes

Copy-tree and version-purge preview tools remain non-interactive. Their collapsed result reports that an approval is ready, its count when known, and its expiry. Raw expanded output retains the approval ID and exact phrase for model context and user inspection.

The corresponding execution tool continues to accept only `approvalId`, consume it once, revalidate its operation and snapshot, and then open the unified review with the refreshed canonical summary and existing exact phrase. Cancellation or failure does not restore the consumed approval.

### Page and Comment Batches

The unified review is one component with two phases:

1. **Select:** display every initially preflighted canonical action summary. All actions start selected. Up/Down moves the cursor, Space toggles the current action, `a` selects or clears all, Enter continues, and Escape cancels.
2. **Authorize:** the authorization controller re-normalizes and re-preflights only the selected actions, then updates the same component with refreshed summaries and the existing `MANIPULATE <count> ACTIONS: <scope>` phrase. Exact entry authorizes the selected set.

An empty selection is cancellation. Selection alone is never authorization. The component remains open across the selected-only re-preflight so selection and phrase confirmation form one integrated review experience. A re-preflight or safety-check failure closes the review without mutation and is reported as a tool error.

After authorization, existing configuration, payload limits, file snapshots, and allowed spaces are checked again. Selected actions execute in original input order. Existing `skipped`, `succeeded`, `failed`, `unknown`, and `cancelled` records remain the complete action accounting.

## Data Flow

### Read and Preview

```text
arguments → compact pending call → existing execution/preflight → existing result
          → compact result metadata → expanded raw content
```

### Ordinary Write

```text
arguments → normalize → preflight → allowlist check → unified review
          → existing rechecks → mutation → compact result/raw expansion
```

### Interactive Batch

```text
all actions → normalize/preflight all → integrated selection
            → validate selection → normalize/re-preflight selected
            → integrated exact phrase → existing rechecks
            → ordered selected execution → existing action report
```

The renderer observes these states but does not control them. Authorization decisions return to the existing execution flow before any mutation process starts.

## Mode Behavior

### TUI

TUI receives custom compact call/result rendering and the integrated review component. Current partial batch selection remains TUI-only.

### RPC

RPC continues emitting normal tool execution events and raw result data. Authorization uses Pi's supported `confirm` and `input` extension UI requests. Ordinary risk tiers and exact phrases remain equivalent to TUI.

RPC page and comment batches authorize the complete initially preflighted batch. They do not open custom UI, perform partial selection, or silently infer a subset.

### JSON and Print

Read and preview behavior remains available as today. Because these modes have no authorization UI, every write continues to return or throw the existing fail-closed no-mutation outcome. Rendering callbacks do not change protocol payloads.

## Safety and Error Handling

- Write enablement, read-only blocking, space allowlists, path confinement, payload limits, and file snapshots remain mandatory.
- Exact phrases remain exact and risk-tiered; ordinary writes do not gain unnecessary phrase entry.
- Cancellation, empty selection, missing UI, phrase mismatch, stale payload, stale approval, stale preflight, and abort all start no mutation.
- Unknown mutation results are visibly distinct from failures and successes and retain the warning against blind retry.
- Known batch failures, unknown outcomes, later cancellation, and retry counts preserve current semantics and reporting.
- Mutation errors remain thrown so Pi marks the tool result as failed; known no-mutation cancellations retain their current result shape.
- Existing credential redaction and untrusted-content marking apply before presentation.
- Authorization UI never treats Confluence-provided text as instructions and never mutates the reviewed input.

## Reusable Contract for Future Tools

A future canonical Confluence tool can adopt the shared renderer by joining an existing registration loop or supplying the same minimal registration-family context. A future write can use the review component by providing:

- One or more canonical preflight summaries.
- Existing risk classification.
- Optional selectable action indexes.
- Optional exact phrase.
- An authorization-controller callback for any required refreshed preflight.

This contract does not prescribe future schemas, operations, batch semantics, or APIs.

## Testing

### Rendering

Tests cover:

- Generic call labels and safe key arguments for representative read, preview, ordinary write, destructive write, and batch tools.
- Partial and malformed arguments.
- Pending, success, approval-ready, cancelled, partial, unknown, failed, and truncated result states.
- Existing batch counts and preview expiry metadata.
- Collapsed omission of bodies, values, file contents, and approval IDs.
- Expanded unchanged raw content and fallback when details are absent or malformed.
- Width compliance, theme invalidation, and non-throwing fallback behavior.

### Review Component

Tests cover:

- Ordinary approve/cancel.
- Exact destructive phrase entry and mismatch.
- Batch navigation, toggling, select-all/clear-all, original-order selection, and empty-selection cancellation.
- The selection-to-selected-re-preflight-to-phrase transition within one component.
- Abort behavior and listener disposal.
- Keyboard behavior through injected keybindings.

### Safety and Modes

Tests prove:

- No mutation on cancellation, phrase mismatch, missing UI, abort, stale files, tightened limits, changed allowlist, stale approval, or failed selected-only re-preflight.
- Only selected actions reach the mutation runner.
- Existing skipped, succeeded, failed, unknown, and cancelled records remain intact.
- Existing retry and ordered-execution behavior is unchanged.
- RPC uses full-batch `confirm`/`input` prompts without custom selection.
- JSON and print writes remain blocked.
- Reads and previews remain non-interactive.

The existing registration, operation-policy, preflight, write-authorization, command-runner, package-registration smoke, and batch tests remain regression gates. Full Jest, lint, package smoke, and whitespace checks must pass.

## Approval Criteria

The design is satisfied when every currently registered canonical Confluence tool has the shared compact TUI rendering, every TUI write uses the unified review appropriate to its existing risk tier, preview and mode boundaries remain intact, and all existing safety and execution semantics pass unchanged.
