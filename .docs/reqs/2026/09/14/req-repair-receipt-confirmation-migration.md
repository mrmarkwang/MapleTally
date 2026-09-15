# Repair receipt confirmation migration

## Problem

Databases that applied the original MapleTally migration before receipt approval terminology changed still expose `approve_receipt` and store `approved` / `approved_at`. The current application calls `confirm_receipt` and therefore returns a generic server error when a user confirms a receipt.

## Requirement

Previously initialized databases must be upgraded to the current receipt confirmation contract without losing receipt data or weakening RPC access controls.

## Acceptance Criteria

- [x] Applying pending migrations to a legacy database exposes `confirm_receipt(w, receipt, expected, acknowledge)` and removes the obsolete `approve_receipt` entry point.
- [x] Existing `approved` receipts become `confirmed`, and their approval timestamp remains available as `confirmed_at`.
- [x] Existing export snapshots and records remain byte-for-byte unchanged, while an export-only rendering boundary interprets legacy `approved` and `approved_at` values as `confirmed` and `confirmed_at` without masking obsolete live receipt rows.
- [x] Confirming a review-ready receipt succeeds and returns a receipt in the `confirmed` state.
- [x] Editing a receipt after the upgrade succeeds and clears `confirmed_at` before it can be confirmed again.
- [x] Export completion continues to move matching `confirmed` receipts to `exported`.
- [x] The repaired `edit_receipt`, `confirm_receipt`, and `complete_export_job` RPCs remain executable by `service_role` and unavailable to anonymous or authenticated clients.

## Constraints

- Preserve existing receipt IDs, fields, versions, timestamps, duplicate metadata, jobs, retry schedules, and export records; only live receipt state/timestamp names may change.
- Do not mutate immutable export snapshots or interrupt in-flight export work.
- Deploy backward-compatible export rendering before applying the live schema migration.
- The upgrade must also be safe when the original migration already uses the current confirmation terminology.
- Do not add a runtime fallback to the obsolete RPC name or to obsolete values in live receipt rows; the export-only adapter for immutable historical snapshots is explicitly required.

## Non-Goals

- Changing the receipt confirmation UI.
- Redesigning receipt states or export behavior.
- Adding feature flags, environment variables, or compatibility modes.
