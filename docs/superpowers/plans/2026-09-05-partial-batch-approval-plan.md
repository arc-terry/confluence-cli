# Partial Batch Approval TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Pi TUI users select a subset of preflighted Confluence batch actions, then authorize only that subset with the existing exact-text confirmation.

**Architecture:** Add a presentation-only selector component under `.pi/extensions/` and call it from the shared batch executor only in TUI mode. The executor preflights all requested actions for display, re-normalizes and re-preflights the selected subset, confirms that subset exactly, and executes only selected actions while reporting skipped indexes. RPC keeps the current full-batch confirmation path.

**Tech Stack:** TypeScript Pi extension, Pi's runtime-provided `@earendil-works/pi-tui` available import, TypeBox, Jest/Jiti, Node 18/20/22.

**Spec:** `docs/superpowers/specs/2026-09-05-partial-batch-approval-design.md`

## Global Constraints

- Selection is available only when `ctx.mode === "tui"`.
- Every action starts selected.
- Up/Down moves, Space toggles, `a` selects all or clears all, Enter continues, and Escape cancels.
- Cancel, empty selection, abort, blank final input, or mismatched final input starts no mutation.
- Selection is not authorization; selected actions still require exact text `MANIPULATE <selected-count> ACTIONS: <selected-canonical-scope-tokens>`.
- Initially normalize and preflight every requested action; after selection, re-normalize and re-preflight only selected actions before final confirmation.
- Execute selected actions in original input order; never pass unselected actions to the mutation runner.
- Preserve `succeeded`, `failed`, `unknown`, and `cancelled`; add `skipped` records for unselected actions.
- RPC keeps full-batch exact confirmation and never assumes a partial selection.
- Preserve write enablement, read-only blocking, space allowlists, project-path restrictions, payload limits, file snapshots, retry behavior, redaction, and untrusted-content marking.
- Keep Node `>=18.0.0` and the Node 18/20/22 CI matrix. `@earendil-works/pi-tui` remains an optional runtime peer only: no development dependency, no locked package/transitives, and no static selector import.
- Use the `ctx.ui.custom()` factory's injected keybindings manager for `tui.select.up/down/confirm/cancel`, literal Space/`a`, and dynamically obtain only `truncateToWidth` inside that real factory.

---

### Task 1: Build the isolated batch-action selector

**Files:**
- Create: `.pi/extensions/confluence-cli/batch-action-selector.ts`
- Create: `tests/pi-batch-selector.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `npm-shrinkwrap.json`
- Modify: `tests/prod-shrinkwrap.test.js`
- Modify: `tests/pi-package-manifest.test.js`

**Interfaces:**
- Produces:
  - `BatchSelectionItem = Readonly<{ index: number; summary: string }>`
  - `BatchActionSelector`, a keyboard-driven Pi component with `render()`, `handleInput()`, and `invalidate()`.
  - `selectBatchActionIndexes(ctx, items, signal): Promise<number[] | null>`; returns all indexes outside TUI mode, selected indexes in TUI mode, or `null` on cancellation/abort.
- Consumes: `ctx.ui.custom()`, Pi theme callbacks, the injected keybindings manager, and a dynamically obtained `truncateToWidth` from Pi's documented available-import contract.

- [ ] **Step 1: Keep Pi TUI runtime-provided and add failing compatibility contracts**

Retain the optional runtime peer declaration without adding Pi TUI to production or development dependencies:

```json
"peerDependencies": {
  "@earendil-works/pi-tui": "*",
  "typebox": "*"
},
"peerDependenciesMeta": {
  "@earendil-works/pi-tui": { "optional": true },
  "typebox": { "optional": true }
}
```

Update `tests/prod-shrinkwrap.test.js` to require the optional peer while rejecting a Pi TUI development dependency and its lockfile package/transitives. Keep the package tarball assertion for `.pi/extensions/confluence-cli/batch-action-selector.ts`.

Refresh lock metadata without Pi TUI and regenerate the production-only shrinkwrap:

```bash
npm install --package-lock-only
bash scripts/generate-prod-shrinkwrap.sh
```

Run:

```bash
npx jest --runInBand tests/prod-shrinkwrap.test.js tests/pi-package-manifest.test.js
```

Expected RED before removal, then GREEN with the optional runtime peer and packaged selector intact.

- [ ] **Step 2: Write failing selector behavior tests**

Use Jiti to import `.pi/extensions/confluence-cli/batch-action-selector.ts` without loading Pi TUI. Instantiate `BatchActionSelector` with three literal items, a fake theme, fake keybindings, and a fake truncator. Test configured up/down/confirm/cancel bindings plus literal Space and `"a"`; directly assert render requests and abort/dispose lifecycle through the component factory seam.

The behavior remains: injected Down then literal Space toggles the highlighted row; injected Confirm returns selected indexes in item order; `a` clears/restores all; injected Cancel returns `null`; every state-changing navigation/toggle requests render; and non-state keys do not.

Also test `selectBatchActionIndexes()` with a non-TUI context returns all item indexes without calling `ctx.ui.custom()`.

- [ ] **Step 3: Run selector tests and verify RED**

Run:

```bash
npx jest --runInBand tests/pi-batch-selector.test.js
```

Expected: FAIL because the existing selector statically loads Pi TUI and lacks injected keybinding/truncator and lifecycle seams.

- [ ] **Step 4: Implement the minimal selector**

Create `.pi/extensions/confluence-cli/batch-action-selector.ts`. Keep all actions selected initially and clamp cursor movement to valid rows. Render this shape using an injected `truncateToWidth()` on every line:

```text
Confluence batch approval
Select actions to execute

[✓] 1. <summary>
[ ] 2. <summary>

Selected: 1 of 2
↑↓ navigate • space toggle • a all • enter continue • esc cancel
```

`handleInput()` calls the supplied render callback only after a state change. Enter returns selected indexes in original item order. Escape returns `null`.

Implement `selectBatchActionIndexes()` without a static Pi TUI import. Inside the async `ctx.ui.custom()` factory, dynamically import and destructure only `truncateToWidth`, then pass it with `tui`, theme, injected keybindings, `done`, and the signal to a separately testable component factory. That seam owns abort listener registration/removal and selector construction.

The selector module performs no Confluence calls and owns no authorization logic.

- [ ] **Step 5: Run selector and package tests and verify GREEN**

Run:

```bash
npx jest --runInBand tests/pi-batch-selector.test.js tests/prod-shrinkwrap.test.js tests/pi-package-manifest.test.js
```

Expected: PASS; package tests show `@earendil-works/pi-tui` as an optional peer and the selector ships in the tarball.

- [ ] **Step 6: Commit**

```bash
git add .pi/extensions/confluence-cli/batch-action-selector.ts tests/pi-batch-selector.test.js package.json package-lock.json npm-shrinkwrap.json tests/prod-shrinkwrap.test.js tests/pi-package-manifest.test.js
git commit -m "feat: add Pi batch action selector"
```

---

### Task 2: Apply selected-only authorization and execution

**Files:**
- Modify: `.pi/extensions/confluence-cli.ts:1-90, 689-810`
- Modify: `tests/pi-extension-tools.test.js:40-310, 350-510`

**Interfaces:**
- Consumes: `selectBatchActionIndexes()` from Task 1 and the existing normalization, preflight, exact-confirmation, retry, and mutation helpers.
- Produces: selected-only second preflight, confirmation, execution, and `details.skipped` for both batch tools.

- [ ] **Step 1: Extend the extension harness for TUI selection**

Add `mode` to the test context, defaulting to `"rpc"` so existing tests retain full-batch confirmation. Add a `custom()` UI stub which records `custom:batch-selection` and returns `scenario.selectedActionIndexes`:

```js
async custom() {
  events.push('custom:batch-selection');
  return setting('selectedActionIndexes', undefined);
}
```

Set `ctx.mode = setting('mode', 'rpc')` in `executeStep()`.

- [ ] **Step 2: Write the failing selected-subset integration test**

Use three child-page creates under distinct parents `111`, `222`, and `333`, then select indexes `0` and `2`. Assert the exact preflight sequence (`111,222,333,111,333`), exact scope phrase `MANIPULATE 2 ACTIONS: 111,333`, final summaries containing Page A/Page C but not Page B, selected-only mutations in original order, and the skipped record for index 1.

- [ ] **Step 3: Write failing fail-closed and RPC tests**

Add table-driven cancellation cases for `null`, `undefined`, and an empty dense array. Add a malformed-selection table covering non-arrays, sparse/null entries, duplicates, non-integers, and unknown indexes; each must return `INVALID_SELECTION` before final confirmation or mutation.

Add selected-path regressions that change a content file and the write-space allowlist during custom selection; both must start no mutation.

Add a TUI exact-text mismatch case with selected indexes `[0, 2]`; it must show the selected phrase but start no mutation.

Add an RPC case with no `custom()` call which confirms and executes the full original batch.

Add one comment-batch case selecting one of two comment creates; it must execute only the selected comment and report the other as skipped.

- [ ] **Step 4: Run integration tests and verify RED**

Run:

```bash
npx jest --runInBand tests/pi-extension-tools.test.js -t 'TUI batch|partial selection|RPC batch|comment batch selection'
```

Expected: FAIL because the executor does not call the selector, does not re-preflight a subset, and has no `skipped` field.

- [ ] **Step 5: Refactor `executeBatch()` around original indexed actions**

Import `selectBatchActionIndexes`. While building the initial action list, retain:

```ts
{ index, operation, input, normalized, preflight }
```

After initial preflight and duplicate-delete validation, assert the initial target spaces as today. Call the selector with `{ index, summary: preflight.summary }` items.

Treat `null`, `undefined`, and an empty dense array as cancellation. Before constructing a `Set` or iterating values, reject non-arrays, sparse/null entries, duplicate indexes, non-integers, and unknown indexes with `INVALID_SELECTION`; this is a defensive boundary against malformed custom-UI adapters. Recover selected actions by filtering original indexed actions so execution order never follows selector return order.

Build `skipped` from initial action records not selected:

```ts
const skipped = actions
  .filter((action) => !selectedIndexes.has(action.index))
  .map(({ index, operation, preflight }) => ({ index, operation, target: preflight.summary }));
```

- [ ] **Step 6: Re-normalize and re-preflight selected actions**

Immediately after selection, call `assertWriteEnabled()` again. For each selected original action:

1. Normalize its original `input` under fresh limits.
2. Compare the new normalized input and file snapshots to the initial normalized record with `assertPayloadSnapshotUnchanged()`.
3. Verify the fresh file snapshots.
4. Run `runPreflight()` again.

Use only these fresh selected preflights to build the confirmation message, targets, allowlist check, scope tokens, and exact phrase. Do not use initial or skipped targets in the final phrase.

- [ ] **Step 7: Confirm and execute selected actions only**

Call `confirmWrite()` with selected count and scope. After confirmation, retain the existing configuration, limit, snapshot, and allowlist rechecks for the selected records. Execute selected actions in original index order through `executeWithRetries()`.

Preserve original indexes in success/failure/unknown/cancellation records. Return:

```ts
details: {
  actions: actions.length,
  selected: selectedActions.length,
  skipped,
  succeeded,
  failed,
  unknown,
  cancelled,
}
```

Report all counts and retain the existing partial-result retry warning.

- [ ] **Step 8: Run integration and regression tests and verify GREEN**

Run:

```bash
npx jest --runInBand tests/pi-extension-tools.test.js
```

Expected: PASS, including existing retry, unknown-result, cancellation, duplicate-delete, path, payload, and confirmation tests.

- [ ] **Step 9: Commit**

```bash
git add .pi/extensions/confluence-cli.ts tests/pi-extension-tools.test.js
git commit -m "feat: authorize partial Confluence batches"
```

---

### Task 3: Document partial approval and verify packaging

**Files:**
- Modify: `README.md:75-125`
- Modify: `plugins/confluence/skills/confluence/SKILL.md:20-45`
- Modify: `tests/pi-package-manifest.test.js`
- Modify: `tests/pi-install-registration-smoke.js`

**Interfaces:**
- Consumes: Task 2’s TUI subset selection and result fields.
- Produces: user-facing controls, exact-confirmation behavior, mode fallback, and packaged registration evidence.

- [ ] **Step 1: Write failing documentation contracts**

Add README assertions for these literal user-facing concepts:

```js
expect(readme).toContain('Space toggles the highlighted action');
expect(readme).toContain('MANIPULATE <selected-count> ACTIONS');
expect(readme).toContain('RPC confirms the full batch');
expect(readme).toContain('skipped');
```

Update the registration smoke assertion so package loading still reports 13 read tools, 29 protected tools, and 31 tools with the two batch tools enabled.

- [ ] **Step 2: Run documentation and smoke tests and verify RED**

Run:

```bash
npx jest --runInBand tests/pi-package-manifest.test.js
node tests/pi-install-registration-smoke.js
```

Expected: Jest FAIL because the partial-selection documentation is absent; smoke remains green.

- [ ] **Step 3: Update README and bundled skill**

Document:

- Every TUI action starts selected.
- Up/Down moves; Space toggles; `a` selects/clears all; Enter reviews; Escape cancels.
- The second prompt must exactly match `MANIPULATE <selected-count> ACTIONS: <selected-canonical-scope-tokens>`.
- Empty selection, cancellation, blank/mismatched text, or abort starts no mutation.
- Only selected actions execute; unselected actions appear under `skipped`.
- RPC confirms the full batch because custom TUI selection is unavailable.

Do not change standalone CLI documentation or imply that selection alone authorizes writes.

- [ ] **Step 4: Run complete verification**

Run:

```bash
npm test -- --runInBand
npx -p node@18 node ./node_modules/jest/bin/jest.js --runInBand tests/pi-batch-selector.test.js tests/prod-shrinkwrap.test.js tests/pi-extension-tools.test.js
npm run lint
git diff --check
node tests/pi-install-registration-smoke.js
npm pack --dry-run --json
```

Expected: all tests pass on the supported runtime checks, lint and whitespace are clean, the registration smoke reports the unchanged tool counts, and the package includes `.pi/extensions/confluence-cli/batch-action-selector.ts`.

- [ ] **Step 5: Commit**

```bash
git add README.md plugins/confluence/skills/confluence/SKILL.md tests/pi-package-manifest.test.js tests/pi-install-registration-smoke.js
git commit -m "docs: document partial batch approval"
```
