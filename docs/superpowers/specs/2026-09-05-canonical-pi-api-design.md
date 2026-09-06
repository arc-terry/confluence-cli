# Canonical-only Pi Extension API Design

## Goal

Make the Pi extension expose one consistent, canonical tool name per operation. Remove all legacy Pi tool aliases, including the old page-manipulation batch API, while retaining its safer batch-execution behavior.

## Scope

This changes Pi extension tool names only. Standalone `confluence` CLI commands, their argv, authorization policy, and server behavior remain unchanged.

## Canonical names

Pi exposes only `confluence_<resource>_<action>` names:

- Read tools include `confluence_page_read`, `confluence_pages_search`, `confluence_page_info`, and `confluence_spaces_list`.
- One-page write tools include `confluence_page_create`, `confluence_page_update`, `confluence_page_delete`, and resource-specific canonical names for comments, properties, attachments, versions, and page-tree operations.
- Preview tools retain the `_preview` suffix.
- Collection mutations are `confluence_pages_batch` and `confluence_comments_batch`.

The extension does not register legacy aliases such as `confluence_read`, `confluence_create`, or `confluence_pages_manipulate`.

## Batch API

Both batch tools require all existing protected-write gates plus the exact opt-in:

```text
CONFLUENCE_PI_BULK_ACTIONS=true
```

`confluence_pages_batch` accepts typed `create`, `create-child`, `update`, `move`, and `delete` actions. `confluence_comments_batch` initially accepts typed `create` actions only.

Every action is normalized and preflighted before a single Pi-owned confirmation. The confirmation phrase is:

```text
MANIPULATE <count> ACTIONS: <canonical-scope-tokens>
```

The executor runs actions in input order and returns `succeeded`, `failed`, `unknown`, and `cancelled` records.

## Reliable batch execution

The canonical page batch adopts the prior bulk-page behavior that prevents accidental retries and hides no partial result:

- Retry known, retryable mutation failures up to three times after the first attempt.
- Do not retry cancellations, configuration/preflight failures, or `UNKNOWN_RESULT` mutations.
- Continue later actions after an exhausted known failure or unknown result.
- If cancellation occurs before any mutation, return the existing no-mutation result.
- If cancellation occurs after earlier action results, stop and return the partial report with the cancellation record.

Comment batches share the same confirmation, result-reporting, cancellation, and retry policy.

## Safety

Canonical tools must continue to use the existing write authorization, read-only checks, Pi UI confirmation, preflight, space allowlist, file snapshot/path protections, and untrusted-output sanitization. No raw or generic Pi API tool is added.

## Migration

This is a breaking Pi-extension API change. Users must replace old Pi tool names with canonical names and replace:

```text
confluence_pages_manipulate
CONFLUENCE_PI_BULK_PAGE_MANIPULATION=true
```

with:

```text
confluence_pages_batch
CONFLUENCE_PI_BULK_ACTIONS=true
```

Documentation lists canonical names only and states that standalone CLI commands are unchanged.

## Testing

Tests prove that only canonical names register, old aliases and their environment gate do not register tools, batch actions preflight before one confirmation, and retry/cancellation/unknown-result reports retain all partial-action evidence. Existing full tests, lint, registration smoke tests, and whitespace checks remain required.
