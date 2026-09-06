# Pi Extension API Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a consistent Pi-only API with explicit resource/action names, temporary backward-compatible aliases, and one-confirmation batch APIs for pages and comments.

**Architecture:** Keep the existing CLI commands and internal operation-policy names as the execution layer. Add a canonical Pi tool-name registry that maps canonical names and legacy aliases to the same schemas and executors, then add typed page/comment batch executors behind one shared bulk-action gate. Existing authorization, preflight, path protection, and untrusted-output handling remain the only mutation paths.

**Tech Stack:** TypeScript Pi extension, TypeBox schemas, existing JavaScript operation policy/preflight/authorization modules, Jest.

**Spec:** `docs/superpowers/specs/2026-09-04-pi-api-consistency-design.md`

## Global Constraints

- Canonical names use `confluence_<resource>_<action>`.
- Use singular resources for one-item operations, plural resources for collection operations, and `batch` for one-call multi-action tools.
- Preview/execution pairs keep the `_preview` suffix on the preview tool.
- The bulk gate is exactly `CONFLUENCE_PI_BULK_ACTIONS=true`.
- Existing public tool names remain aliases for one deprecation window.
- Alias and canonical tools share schema, authorization, operation policy, output, and error behavior.
- Standalone CLI command names do not change.
- Batch page actions are `create`, `create-child`, `update`, `move`, and `delete`.
- Batch comment actions initially support `create`.
- No mutation may bypass existing write gates, read-only checks, Pi UI confirmation, preflight, space allowlist, file/path protections, or output sanitization.

---

### Task 1: Add canonical tool names and backward-compatible aliases

**Files:**
- Modify: `.pi/extensions/confluence-cli.ts:90-320, 820-910`
- Modify: `lib/pi/operation-policy.js:1-25, 120-620`
- Modify: `tests/pi-extension-tools.test.js:1-330`
- Modify: `tests/pi-operation-policy.test.js`
- Modify: `tests/pi-package-manifest.test.js`

**Interfaces:**
- Produces a canonical-to-legacy mapping for all existing upstream Pi tools.
- Canonical and legacy registrations call the same executor with the same internal operation name.
- Keeps `listToolNames()` and `getOperation()` policy behavior explicit and rejects arbitrary names.

- [ ] **Step 1: Write failing alias registration and policy tests**

Add literal expectations for representative canonical names and all legacy aliases:

```js
test('registers canonical resource-action names and legacy aliases together', () => {
  const output = runHarness({ env: VALID_WRITE_ENV });
  expect(output.registered).toContain('confluence_page_read');
  expect(output.registered).toContain('confluence_read');
  expect(output.registered).toContain('confluence_page_create');
  expect(output.registered).toContain('confluence_create');
  expect(output.registered).toContain('confluence_page_comment_create');
  expect(output.registered).toContain('confluence_comment_create');
});
```

Add policy assertions that canonical names resolve to the same fixed operation metadata and that unknown names remain rejected:

```js
expect(getOperation('confluence_page_create').toolName).toBe('confluence_create');
expect(getOperation('confluence_page_delete').risk).toBe(RISK.DESTRUCTIVE);
expect(() => getOperation('confluence_page_raw')).toThrow(/not allowed/i);
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx jest --runInBand tests/pi-extension-tools.test.js tests/pi-operation-policy.test.js tests/pi-package-manifest.test.js
```

Expected: canonical registration and policy tests fail because only legacy names exist.

- [ ] **Step 3: Implement the canonical registry and aliases**

Create one explicit mapping rather than deriving names heuristically:

```js
const CANONICAL_TO_LEGACY = Object.freeze({
  confluence_page_read: 'confluence_read',
  confluence_pages_search: 'confluence_search',
  confluence_page_info: 'confluence_info',
  confluence_spaces_list: 'confluence_spaces',
  confluence_page_children_list: 'confluence_children',
  confluence_page_export: 'confluence_export',
  confluence_content_convert: 'confluence_convert',
  confluence_page_find: 'confluence_find',
  confluence_page_versions_list: 'confluence_versions',
  confluence_page_comments_list: 'confluence_comments',
  confluence_page_attachments_list: 'confluence_attachments',
  confluence_page_properties_list: 'confluence_property_list',
  confluence_page_property_get: 'confluence_property_get',
  confluence_page_create: 'confluence_create',
  confluence_page_child_create: 'confluence_create_child',
  confluence_page_update: 'confluence_update',
  confluence_page_move: 'confluence_move',
  confluence_page_delete: 'confluence_delete',
  confluence_page_comment_create: 'confluence_comment_create',
  confluence_page_comment_delete: 'confluence_comment_delete',
  confluence_page_property_set: 'confluence_property_set',
  confluence_page_property_delete: 'confluence_property_delete',
  confluence_page_attachment_upload: 'confluence_attachment_upload',
  confluence_page_attachment_delete: 'confluence_attachment_delete',
  confluence_page_version_delete: 'confluence_version_delete',
  confluence_page_tree_copy_preview: 'confluence_copy_tree_preview',
  confluence_page_tree_copy: 'confluence_copy_tree',
  confluence_page_versions_purge_preview: 'confluence_versions_purge_preview',
  confluence_page_versions_purge: 'confluence_versions_purge',
});
```

Register both names from the same schema/executor and add a deprecation marker only to the legacy description. Add matching canonical policy entries that delegate to the existing fixed argv builder and risk metadata. Do not change standalone CLI argv or risk classifications.

- [ ] **Step 4: Run focused tests and verify GREEN**

```bash
npx jest --runInBand tests/pi-extension-tools.test.js tests/pi-operation-policy.test.js tests/pi-package-manifest.test.js
```

Expected: canonical and legacy tools register under the same gates; unknown names remain rejected.

- [ ] **Step 5: Commit**

```bash
git add .pi/extensions/confluence-cli.ts lib/pi/operation-policy.js tests/pi-extension-tools.test.js tests/pi-operation-policy.test.js tests/pi-package-manifest.test.js
git commit -m "feat: add canonical Pi tool names"
```

---

### Task 2: Add one-confirmation page batch API

**Files:**
- Modify: `.pi/extensions/confluence-cli.ts:100-215, 680-900`
- Modify: `tests/pi-extension-tools.test.js:330-760`
- Modify: `tests/pi-install-registration-smoke.js`

**Interfaces:**
- Produces `confluence_pages_batch({ actions })` behind exact `CONFLUENCE_PI_BULK_ACTIONS=true` plus existing write/space gates.
- Uses the Task 1 canonical/legacy executor registry without changing single-operation behavior.
- Returns structured `{ succeeded, failed, unknown, cancelled }` details.

- [ ] **Step 1: Write failing page-batch tests**

Add tests for registration, mixed action preflight, one confirmation, ordered mutation, invalid actions, and duplicate delete targets:

```js
test('page batch performs mixed page actions under one confirmation', () => {
  const output = runHarness({
    env: { ...VALID_WRITE_ENV, CONFLUENCE_PI_BULK_ACTIONS: 'true' },
    toolName: 'confluence_pages_batch',
    input: { actions: [
      { operation: 'create', title: 'New', spaceKey: 'ENG', content: 'body' },
      { operation: 'update', pageId: '123', title: 'Updated' },
      { operation: 'move', pageId: '123', newParentId: '456' },
      { operation: 'delete', pageId: '789' },
    ] },
    recordInputMessage: true,
  });

  expect(output.error).toBeNull();
  expect(output.events.filter((event) => event.startsWith('input-message:'))).toHaveLength(1);
  expect(output.events.filter((event) => event.startsWith('preflight:'))).toEqual([
    'preflight:confluence_space_lookup:ENG',
    'preflight:confluence_info:123',
    'preflight:confluence_info:123',
    'preflight:confluence_info:456',
    'preflight:confluence_info:789',
  ]);
  expect(output.result.details.succeeded.map((item) => item.index)).toEqual([0, 1, 2, 3]);
});
```

Add a gate test proving `CONFLUENCE_PI_BULK_ACTIONS=false` does not register the tool and a duplicate-delete test proving no confirmation or mutation starts.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx jest --runInBand tests/pi-extension-tools.test.js -t 'page batch|bulk actions'
```

Expected: the new tool is absent and the execution tests fail.

- [ ] **Step 3: Implement the typed page batch executor**

Add a `confluence_pages_batch` schema whose `actions` array is a union of the existing create, create-child, update, move, and delete fields with an `operation` discriminator. For each action, run existing payload normalization and `runPreflight()` before any mutation. Aggregate summaries and targets into one exact confirmation phrase:

```text
MANIPULATE <count> ACTIONS: <canonical-scope-tokens>
```

Allow repeated page IDs across different operations, but reject duplicate canonical IDs among delete actions. Re-check configuration, file snapshots, and spaces after confirmation. Execute in input order through the existing mutation runner.

- [ ] **Step 4: Run focused tests and verify GREEN**

```bash
npx jest --runInBand tests/pi-extension-tools.test.js -t 'page batch|bulk actions'
```

Expected: all page actions preflight before one confirmation and execute in order.

- [ ] **Step 5: Commit**

```bash
git add .pi/extensions/confluence-cli.ts tests/pi-extension-tools.test.js tests/pi-install-registration-smoke.js
git commit -m "feat: add one-confirmation page batch"
```

---

### Task 3: Add one-confirmation comment batch API

**Files:**
- Modify: `.pi/extensions/confluence-cli.ts:100-215, 680-900`
- Modify: `tests/pi-extension-tools.test.js:760-900`
- Modify: `tests/pi-install-registration-smoke.js`

**Interfaces:**
- Produces `confluence_comments_batch({ actions })` behind `CONFLUENCE_PI_BULK_ACTIONS=true` plus existing write/space gates.
- Initially supports only `{ operation: 'create', pageId, content/contentFile, ... }`.
- Uses the same one-confirmation, preflight, snapshot, and structured-result contract as page batches.

- [ ] **Step 1: Write failing comment-batch tests**

```js
test('comment batch creates multiple comments with one confirmation', () => {
  const output = runHarness({
    env: { ...VALID_WRITE_ENV, CONFLUENCE_PI_BULK_ACTIONS: 'true' },
    toolName: 'confluence_comments_batch',
    input: { actions: [
      { operation: 'create', pageId: '123', content: 'First' },
      { operation: 'create', pageId: '789', content: 'Second' },
    ] },
    recordInputMessage: true,
  });

  expect(output.error).toBeNull();
  expect(output.events.filter((event) => event.startsWith('input-message:'))).toHaveLength(1);
  expect(output.result.details.succeeded.map((item) => item.index)).toEqual([0, 1]);
});
```

Add tests proving unsupported comment operations fail before confirmation and that the shared gate is required.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx jest --runInBand tests/pi-extension-tools.test.js -t 'comment batch'
```

Expected: the comment batch tool is absent and the new behavior test fails.

- [ ] **Step 3: Implement the comment batch schema and executor**

Reuse the page-batch confirmation/reporting helper where the input contract is identical, but keep a separate comment action schema and operation allowlist. Preflight each `confluence_comment_create`, including canonical page title/ID/space and content size, then request one confirmation covering all comments. Execute in order and leave future delete/update comment actions unsupported until explicitly added to the schema.

- [ ] **Step 4: Run focused tests and verify GREEN**

```bash
npx jest --runInBand tests/pi-extension-tools.test.js -t 'comment batch'
```

Expected: multiple comment creates use one confirmation and unsupported actions fail closed.

- [ ] **Step 5: Commit**

```bash
git add .pi/extensions/confluence-cli.ts tests/pi-extension-tools.test.js tests/pi-install-registration-smoke.js
git commit -m "feat: add one-confirmation comment batch"
```

---

### Task 4: Update documentation, deprecation guidance, and final verification

**Files:**
- Modify: `README.md:70-125`
- Modify: `plugins/confluence/skills/confluence/SKILL.md:20-55`
- Modify: `tests/pi-package-manifest.test.js`
- Modify: `tests/pi-install-registration-smoke.js`

**Interfaces:**
- Documents canonical names, aliases, deprecation window, `CONFLUENCE_PI_BULK_ACTIONS=true`, and both batch tools.
- Does not document feature-branch-only names from excluded commits.

- [ ] **Step 1: Write failing documentation contract tests**

```js
expect(readme).toContain('CONFLUENCE_PI_BULK_ACTIONS=true');
expect(readme).toContain('confluence_pages_batch');
expect(readme).toContain('confluence_comments_batch');
expect(readme).toContain('legacy names remain available');
```

- [ ] **Step 2: Run the documentation tests and verify RED**

```bash
npx jest --runInBand tests/pi-package-manifest.test.js
```

Expected: documentation contract assertions fail because the new canonical API is not documented.

- [ ] **Step 3: Update user-facing documentation**

Document the canonical names first, legacy aliases second, and clearly state that aliases are temporary. Include one page-batch and one comment-batch example, the exact bulk gate, one-confirmation behavior, and the supported operation discriminators. State that standalone CLI names are unchanged.

- [ ] **Step 4: Run complete verification**

```bash
npm test -- --runInBand
npm run lint
git diff --check
node tests/pi-install-registration-smoke.js
```

Expected: all tests pass, lint is clean, smoke registration reports the canonical and legacy tools, and no diff whitespace errors exist.

- [ ] **Step 5: Inspect and commit documentation**

```bash
git grep -nE 'CONFLUENCE_PI_BULK_PAGE_MANIPULATION|confluence_pages_manipulate' -- README.md plugins tests .pi || true
git add README.md plugins/confluence/skills/confluence/SKILL.md tests/pi-package-manifest.test.js tests/pi-install-registration-smoke.js
git commit -m "docs: document consistent Pi extension API"
```

Expected: no excluded feature-branch names remain in active docs or tests.
