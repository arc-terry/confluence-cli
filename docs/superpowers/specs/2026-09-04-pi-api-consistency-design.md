# Pi Extension API Consistency Design

## Goal

Make the Pi extension API use explicit, predictable resource-and-action names while preserving existing tool names for one deprecation window.

## Scope

This change applies only to the Pi extension API based on `upstream/main` (`e06eb35`). Standalone CLI command names are unchanged. Existing behavior, authorization, payloads, and operation policy remain unchanged unless required to register an alias.

## Naming Convention

Canonical names use:

```text
confluence_<resource>_<action>
```

Use singular resources for one-item operations, plural resources for collection operations, and `batch` for one-call multi-action tools. Preview/execution pairs keep the `_preview` suffix on the preview tool.

## Canonical API

Read tools:

- `confluence_page_read`
- `confluence_pages_search`
- `confluence_page_info`
- `confluence_spaces_list`
- `confluence_page_children_list`
- `confluence_page_export`
- `confluence_content_convert`
- `confluence_page_find`
- `confluence_page_versions_list`
- `confluence_page_comments_list`
- `confluence_page_attachments_list`
- `confluence_page_properties_list`
- `confluence_page_property_get`

Write tools:

- `confluence_page_create`
- `confluence_page_child_create`
- `confluence_page_update`
- `confluence_page_move`
- `confluence_page_delete`
- `confluence_page_comment_create`
- `confluence_page_comment_delete`
- `confluence_page_property_set`
- `confluence_page_property_delete`
- `confluence_page_attachment_upload`
- `confluence_page_attachment_delete`
- `confluence_page_version_delete`
- `confluence_page_tree_copy_preview`
- `confluence_page_tree_copy`
- `confluence_page_versions_purge_preview`
- `confluence_page_versions_purge`

New batch tools:

- `confluence_pages_batch`
- `confluence_comments_batch`

Both batch tools require the single opt-in environment variable:

```text
CONFLUENCE_PI_BULK_ACTIONS=true
```

The batch tools accept a typed, non-empty `actions` list. Page actions are `create`, `create-child`, `update`, `move`, and `delete`. Comment actions initially support `create`, with the schema extensible for future comment operations.

## Backward Compatibility

For one deprecation window, register each existing public tool as an alias to its canonical implementation. The alias and canonical tool must share the same parameter schema, authorization path, operation policy, output shape, and error behavior. Mark aliases deprecated in descriptions and documentation. Do not silently register generic or raw API tools.

The old names are removed only in a later major release after the deprecation window. No standalone CLI rename is included.

## Registration and Authorization

Canonical and legacy aliases are registered under the same existing read/write gates. Write aliases do not weaken `CONFLUENCE_PI_WRITES`, `CONFLUENCE_PI_WRITE_SPACES`, `CONFLUENCE_READ_ONLY`, Pi UI confirmation, preflight, or file/path protections. Batch tools additionally require the exact opt-in `CONFLUENCE_PI_BULK_ACTIONS=true` and use one confirmation per batch call.

## Testing

Add tests that verify:

- every canonical name is registered with the expected type;
- every legacy name remains available as an alias during the deprecation window;
- canonical and alias tools use equivalent schemas and execution behavior;
- no aliases are registered when their existing read/write gate is unavailable;
- batch page/comment tools use the same typed action naming convention;
- standalone CLI command names and existing operation policy remain unchanged.
