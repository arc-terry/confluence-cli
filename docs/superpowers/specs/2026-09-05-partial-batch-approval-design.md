# Partial Batch Approval TUI Design

## Goal

Let an interactive Pi user choose which preflighted Confluence batch actions to authorize, while preserving the existing exact-text destructive confirmation and all mutation safety gates.

## Scope

This applies to `confluence_pages_batch` and `confluence_comments_batch` in Pi TUI mode. Tool schemas and standalone CLI commands do not change. Print and JSON modes remain unable to mutate. RPC mode keeps the current full-batch exact-text confirmation because `ctx.ui.custom()` is TUI-only.

## Interaction

After validating and preflighting every requested action, the tool opens a custom selection screen. Every action starts selected. Each row shows:

```text
[✓] <index>. <canonical preflight summary>
```

Controls are:

- Up/Down: move the cursor.
- Space: toggle the highlighted action.
- `a`: select all when any action is unselected; otherwise clear all.
- Enter: continue with the selected actions.
- Escape: cancel.

The footer shows the selected and requested counts. The component uses Pi theme colors, truncates lines to the available width, requests a render after state changes, and exposes no mouse-only operation.

Cancel or an empty selection returns the existing no-mutation result. No mutation process starts.

## Final confirmation

Selection is not authorization. After selection, the tool re-normalizes and re-preflights only the selected actions. It then displays the selected canonical summaries and requires the existing exact phrase:

```text
MANIPULATE <selected-count> ACTIONS: <selected-canonical-scope-tokens>
```

For example, selecting two of three child-page creations under parent `300720018` requires:

```text
MANIPULATE 2 ACTIONS: 300720018,300720018
```

The reply must match exactly. Cancel, blank input, or any other text starts no mutation.

## Execution and reporting

After exact confirmation, the tool rechecks write configuration, payload limits, selected file snapshots, and selected spaces, then executes selected actions in their original input order. Unselected actions never reach the mutation runner.

The existing `succeeded`, `failed`, `unknown`, and `cancelled` records remain. The result also includes `skipped` records for unselected actions so every requested index is accounted for. The summary reports requested, selected, skipped, succeeded, failed, unknown, and cancelled counts.

Retry behavior remains unchanged: known retryable failures receive three retries after the first attempt; cancellations, configuration/preflight failures, and unknown results are not retried.

## Safety boundaries

- The selection UI is available only when `ctx.mode === "tui"`.
- RPC uses full-batch exact-text confirmation and never silently assumes a partial selection.
- Missing UI, Escape, empty selection, abort, and exact-text mismatch all fail closed.
- Every requested action is initially normalized and preflighted before selection so the user sees canonical server-derived targets.
- Only selected actions are re-preflighted immediately before final confirmation.
- Existing write enablement, read-only blocking, space allowlist, project-path restrictions, payload limits, file snapshots, output redaction, and untrusted-content marking remain mandatory.

## Structure

Add one small TUI selector module under `.pi/extensions/` and keep Confluence execution and authorization logic in `.pi/extensions/confluence-cli.ts` and `lib/pi/write-authorization.js`. The selector module owns rendering and keyboard state only; it cannot execute mutations.

Use `ctx.ui.custom()` with its injected keybindings manager for `tui.select.up`, `tui.select.down`, `tui.select.confirm`, and `tui.select.cancel`; Space and `a` remain literal controls. Preserve Node 18/20 support by keeping `@earendil-works/pi-tui` only as an optional runtime peer, with no development dependency or static selector import. The real TUI factory dynamically obtains only `truncateToWidth` from Pi's documented available imports. Selector state and lifecycle stay behind an injected keybindings/truncator factory seam so tests do not load Pi TUI.

## Testing

Tests cover selector navigation/toggling/select-all/cancel behavior, render requests and abort disposal, selected-index ordering, malformed selection rejection, TUI-only activation, RPC full-batch fallback, selected-only second preflight, exact selected confirmation phrase and summaries, selection-time file/allowlist changes, no mutation for empty/cancel/mismatch, selected-only execution, skipped result records, and unchanged retry/partial-result behavior. Full Jest, lint, a Node 18 focused Jest run without the unsupported development dependency, package-registration smoke, package tarball, and whitespace checks remain required.
