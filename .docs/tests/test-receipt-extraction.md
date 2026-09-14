# Receipt extraction E2E scenarios

## Scenario: successful automatic extraction

Given the user is authenticated, the worker/provider contract is configured, and the uploaded receipt is accepted
When the user uploads the receipt and opens the review screen
Then the receipt may initially show queued/processing state
And after the worker result is available, refreshing/reopening the receipt shows the extracted merchant, date, amounts, currency, category, confidence, and any warnings
And the original receipt remains available for review.

## Scenario: extraction unavailable or fails

Given the user uploads a valid receipt but the extraction worker/provider cannot complete
When the receipt reaches its terminal failure state
Then the screen shows an actionable error
And the receipt remains editable manually
And retry is available only when the existing retry contract permits it.
