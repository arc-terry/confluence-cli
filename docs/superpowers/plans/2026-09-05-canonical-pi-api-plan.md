# Canonical-only Pi API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose only canonical Pi tool names while preserving the reliable one-confirmation batch behavior from the prior page-manipulation implementation.

**Architecture:** Keep existing CLI operation names as private execution identifiers. The Pi extension registers only canonical resource-action tool names and maps each to its private operation. Replace the current batch executor with one shared page/comment executor that preflights all actions, confirms once, retries only known retryable failures, and returns complete partial-result records.

**Tech Stack:** TypeScript Pi extension, TypeBox, JavaScript operation policy, Jest.

**Spec:** `docs/superpowers/specs/2026-09-05-canonical-pi-api-design.md`

## Global Constraints

- Register only canonical `confluence_<resource>_<action>` Pi tool names.
- Do not register legacy aliases including `confluence_read`, `confluence_create`, `confluence_pages_manipulate`, or `confluence_comments`.
- Standalone `confluence` CLI names and private operation-policy argv builders do not change.
- Batch registration requires exactly `CONFLUENCE_PI_BULK_ACTIONS=true` plus existing protected-write gates.
- Do not read `CONFLUENCE_PI_BULK_PAGE_MANIPULATION` or register `confluence_pages_manipulate`.
- Page batches support `create`, `create-child`, `update`, `move`, and `delete`; comment batches support `create` only.
- Every batch action is normalized and preflighted before one Pi confirmation with `MANIPULATE <count> ACTIONS: <canonical-scope-tokens>`.
- Retry retryable mutation failures three times after the first attempt; do not retry cancellation, preflight/configuration failures, or `UNKNOWN_RESULT`.
- Return `succeeded`, `failed`, `unknown`, and `cancelled` action records; continue after failed or unknown actions and stop after a post-result cancellation.
- Preserve authorization, read-only checks, confirmations, preflight, space checks, file snapshots/path limits, and untrusted-output sanitization.

---

### Task 1: Register only canonical Pi tools

**Files:**
- Modify: `.pi/extensions/confluence-cli.ts:17-25, 315-345, 815-910`
- Modify: `lib/pi/operation-policy.js:1-70, 640-665`
- Modify: `tests/pi-extension-tools.test.js:1-430`
- Modify: `tests/pi-operation-policy.test.js:1-250`
- Modify: `tests/pi-install-registration-smoke.js:45-85`

**Interfaces:**
- Consumes: the existing private operation keys such as `confluence_read` and `confluence_create`.
- Produces: canonical public registrations such as `confluence_page_read` and `confluence_page_create`; no public legacy registrations.

- [ ] **Step 1: Write failing public-surface tests**

Replace the current public-name arrays with literal canonical arrays and assert exact registration order. These are the expected read names:

```js
const CANONICAL_READ_TOOLS = [
  'confluence_page_read', 'confluence_pages_search', 'confluence_page_info',
  'confluence_spaces_list', 'confluence_page_children_list', 'confluence_page_export',
  'confluence_content_convert', 'confluence_page_find', 'confluence_page_versions_list',
  'confluence_page_comments_list', 'confluence_page_attachments_list',
  'confluence_page_properties_list', 'confluence_page_property_get',
];
```

The expected write arrays are:

```js
const CANONICAL_ORDINARY_WRITE_TOOLS = [
  'confluence_page_create', 'confluence_page_child_create', 'confluence_page_update',
  'confluence_page_move', 'confluence_page_delete', 'confluence_page_comment_create',
  'confluence_page_comment_delete', 'confluence_page_property_set',
  'confluence_page_property_delete', 'confluence_page_attachment_upload',
  'confluence_page_attachment_delete', 'confluence_page_version_delete',
];
const CANONICAL_BULK_WRITE_TOOLS = [
  'confluence_page_tree_copy_preview', 'confluence_page_tree_copy',
  'confluence_page_versions_purge_preview', 'confluence_page_versions_purge',
];
```

Then assert:

```js
test('registers only canonical Pi tool names', () => {
  const output = runHarness({ env: VALID_WRITE_ENV });

  expect(output.registered).toEqual([
    ...CANONICAL_READ_TOOLS,
    ...CANONICAL_ORDINARY_WRITE_TOOLS,
    ...CANONICAL_BULK_WRITE_TOOLS,
  ]);
  expect(output.registered).not.toContain('confluence_read');
  expect(output.registered).not.toContain('confluence_create');
  expect(output.registered).not.toContain('confluence_pages_manipulate');
});
```

The exact equality assertion is the regression check for every legacy public name: no old name can remain without changing the expected canonical-only surface.

Add policy assertions that the canonical public name builds the existing fixed argv while `listToolNames()` contains no legacy public name:

```js
expect(buildArgs('confluence_page_create', { title: 'Page', spaceKey: 'ENG', content: 'body' }))
  .toEqual(['--json', 'create', 'Page', 'ENG', '--content', 'body', '--format', 'storage', '--type', 'page']);
expect(listToolNames({ includeWrites: true })).not.toContain('confluence_create');
expect(() => getOperation('confluence_page_raw')).toThrow(/not allowed/i);
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npx jest --runInBand tests/pi-extension-tools.test.js tests/pi-operation-policy.test.js tests/pi-install-registration-smoke.js
```

Expected: legacy aliases still register, so the new public-surface assertions fail.

- [ ] **Step 3: Make the registry canonical-only**

Replace the bidirectional public alias registration with one explicit canonical-to-private-operation mapping. `listToolNames()` returns canonical public entries only; `getOperation()` and `buildArgs()` resolve canonical names to the existing private operation definitions. Keep hidden preflight operations (`confluence_space_lookup`, `confluence_comment_lookup`, and `confluence_attachment_lookup`) private and callable by existing preflight code.

Change extension registration loops to use the canonical name for registration and schema lookup via its private operation. Remove legacy-description deprecation text and all registration of legacy aliases. Keep the existing read/write gates unchanged.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
npx jest --runInBand tests/pi-extension-tools.test.js tests/pi-operation-policy.test.js tests/pi-install-registration-smoke.js
```

Expected: canonical tools register under their existing gates, legacy names are absent, and canonical calls emit the existing CLI argv.

- [ ] **Step 5: Commit**

```bash
git add .pi/extensions/confluence-cli.ts lib/pi/operation-policy.js tests/pi-extension-tools.test.js tests/pi-operation-policy.test.js tests/pi-install-registration-smoke.js
git commit -m "refactor: expose canonical Pi tool names only"
```

### Task 2: Make canonical batches reliable and remove the stale batch API

**Files:**
- Modify: `.pi/extensions/confluence-cli.ts:100-215, 500-780, 870-930`
- Modify: `tests/pi-extension-tools.test.js:30-520`
- Modify: `tests/pi-install-registration-smoke.js:55-85`

**Interfaces:**
- Consumes: Task 1 canonical registration and the existing `invokeMutation()`, preflight, and authorization functions.
- Produces: `confluence_pages_batch` and `confluence_comments_batch` with retry and complete partial-result reporting.

- [ ] **Step 1: Write failing reliable-batch tests**

Extend the harness to supply per-mutation failures and an abort after a mutation. Add these observable behaviors:

```js
test('page batch retries a known failure three times before succeeding', () => {
  const output = runHarness({
    env: { ...VALID_WRITE_ENV, CONFLUENCE_PI_BULK_ACTIONS: 'true' },
    toolName: 'confluence_pages_batch',
    input: { actions: [{ operation: 'update', pageId: '123', title: 'Retry me' }] },
    mutationFailures: { 'confluence_update:123': 3 },
  });

  expect(output.events.filter((event) => event === 'mutation:confluence_update:123')).toHaveLength(4);
  expect(output.result.details.succeeded.map((item) => item.index)).toEqual([0]);
});

test('page batch records an unknown result once and continues later actions', () => {
  const output = runHarness({
    env: { ...VALID_WRITE_ENV, CONFLUENCE_PI_BULK_ACTIONS: 'true' },
    toolName: 'confluence_pages_batch',
    input: { actions: [
      { operation: 'update', pageId: '123', title: 'Unknown' },
      { operation: 'delete', pageId: '789' },
    ] },
    mutationFailures: { 'confluence_update:123': { code: 'UNKNOWN_RESULT' } },
  });

  expect(output.events.filter((event) => event === 'mutation:confluence_update:123')).toHaveLength(1);
  expect(output.result.details.unknown.map((item) => item.index)).toEqual([0]);
  expect(output.result.details.succeeded.map((item) => item.index)).toEqual([1]);
});
```

Add a cancellation-after-success test that expects a `cancelled` record for the next action. Add a registration test that `CONFLUENCE_PI_BULK_PAGE_MANIPULATION=true` never exposes `confluence_pages_manipulate`.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx jest --runInBand tests/pi-extension-tools.test.js -t 'batch|retry|unknown|cancellation'
```

Expected: the current executor does not retry and reports `cancelled: null` after a post-result cancellation; the stale gate behavior is not covered.

- [ ] **Step 3: Implement reliable shared batch execution**

Add `isRetryableMutationFailure()` and `executeWithRetries()` around `invokeMutation()` with four maximum attempts. In the shared batch executor, retain each action's original normalized input for post-confirmation snapshot validation. On cancellation before any result, return `noMutationResult()`. On later cancellation, record `{ index, operation, target, error }`, stop execution, and include it in `details.cancelled`.

For exhausted retryable errors, append a failed record and continue. For `UNKNOWN_RESULT`, append an unknown record without retrying and continue. Include the partial-result warning in returned text when `failed`, `unknown`, or `cancelled` is non-empty.

Register only `confluence_pages_batch` and `confluence_comments_batch` behind `CONFLUENCE_PI_BULK_ACTIONS=true`. Delete the `confluence_pages_manipulate` schema, operation allowlist, executor, registration function, and old gate lookup.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npx jest --runInBand tests/pi-extension-tools.test.js -t 'batch|retry|unknown|cancellation'
```

Expected: retryable failures take four attempts, unknown results take one attempt, partial reports retain all action records, and the old batch API is absent.

- [ ] **Step 5: Commit**

```bash
git add .pi/extensions/confluence-cli.ts tests/pi-extension-tools.test.js tests/pi-install-registration-smoke.js
git commit -m "feat: harden canonical Pi batch execution"
```

### Task 3: Document the breaking canonical-only API

**Files:**
- Modify: `README.md:70-125`
- Modify: `plugins/confluence/skills/confluence/SKILL.md:20-55`
- Modify: `tests/pi-package-manifest.test.js:20-55`

**Interfaces:**
- Consumes: the canonical-only registration and canonical batch names from Tasks 1–2.
- Produces: user documentation that contains no legacy Pi tool or gate names.

- [ ] **Step 1: Write failing documentation contract tests**

Add assertions that the README documents canonical names and the new gate while excluding stale names:

```js
expect(readme).toContain('confluence_page_read');
expect(readme).toContain('confluence_pages_batch');
expect(readme).toContain('CONFLUENCE_PI_BULK_ACTIONS=true');
expect(readme).not.toContain('confluence_pages_manipulate');
expect(readme).not.toContain('CONFLUENCE_PI_BULK_PAGE_MANIPULATION');
expect(readme).not.toContain('legacy names remain available');
```

- [ ] **Step 2: Run documentation tests and verify RED**

Run:

```bash
npx jest --runInBand tests/pi-package-manifest.test.js
```

Expected: the README still promises legacy aliases.

- [ ] **Step 3: Update documentation**

List only canonical Pi tools. Document that this is a breaking Pi-extension API change, show `confluence_pages_batch` and `confluence_comments_batch` examples, name `CONFLUENCE_PI_BULK_ACTIONS=true`, and state that standalone CLI commands remain unchanged. Remove every reference to `confluence_pages_manipulate`, `CONFLUENCE_PI_BULK_PAGE_MANIPULATION`, and temporary legacy aliases from active docs and tests.

- [ ] **Step 4: Run complete verification**

Run:

```bash
npm test -- --runInBand
npm run lint
git diff --check
node tests/pi-install-registration-smoke.js
git grep -nE 'confluence_pages_manipulate|CONFLUENCE_PI_BULK_PAGE_MANIPULATION|legacy names remain available' -- README.md plugins tests .pi || true
```

Expected: all tests and lint pass, smoke registration reports only canonical public tools, whitespace is clean, and the grep prints no active matches.

- [ ] **Step 5: Commit**

```bash
git add README.md plugins/confluence/skills/confluence/SKILL.md tests/pi-package-manifest.test.js
git commit -m "docs: document canonical Pi API migration"
```
