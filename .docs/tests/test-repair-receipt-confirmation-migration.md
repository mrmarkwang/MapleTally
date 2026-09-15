# Receipt confirmation migration scenarios

## Scenario: upgrade a legacy database

1. Given a database initialized before the approval-to-confirmation terminology change
2. And it contains an `approved` receipt with an `approved_at` timestamp
3. When the receipt confirmation repair migration is applied
4. Then the receipt state is `confirmed`
5. And the original timestamp is available as `confirmed_at`
6. And receipt IDs, fields, versions, creation/update timestamps, duplicate metadata, and export records are otherwise unchanged
7. And queued, processing, failed, and complete export snapshots and records remain unchanged
9. And new writes of the obsolete `approved` state are rejected
10. And `confirm_receipt(w, receipt, expected, acknowledge)` is available
11. And `approve_receipt` is no longer available

## Scenario: render an immutable legacy export after upgrade

1. Given an export snapshot captured with `approved` and `approved_at`
2. When the repair migration is applied
3. Then the snapshot, export record, job status, attempt count, run time, lease, and error context are unchanged
4. And when a current worker renders the snapshot through the export-only view, its public row uses `confirmed` and `confirmed_at`
5. And presenting the same value through the ordinary live API view does not hide its obsolete live state
6. And the export can complete and move the unchanged matching live receipt from `confirmed` to `exported`

## Scenario: edit and reconfirm after upgrade

1. Given an upgraded database with a confirmed receipt
2. When the receipt is edited
3. Then the edit succeeds and clears `confirmed_at`
4. And when the receipt is confirmed again using its new version
5. Then its state is `confirmed` and it has a new `confirmed_at` timestamp

## Scenario: confirm a review-ready receipt after upgrade

1. Given an upgraded database and a receipt in `needs_review`
2. When the user selects **Confirm receipt**
3. Then the request succeeds
4. And the receipt status becomes `confirmed`
5. And no generic request error is shown

## Scenario: export a confirmed receipt after upgrade

1. Given an upgraded database with a confirmed receipt in a queued export snapshot
2. When the export job completes with its active lease token
3. Then the export is marked complete
4. And the unchanged matching receipt becomes `exported`

## Scenario: preserve RPC access boundaries

1. Given an upgraded database
2. When an authenticated or anonymous role attempts to invoke `edit_receipt`, `confirm_receipt`, or `complete_export_job`
3. Then permission is denied
4. And PostgreSQL privilege checks show the service role retains execute permission on each repaired signature
