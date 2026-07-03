# Salesforce-Native Opportunity Gamification Research

## Recommendation

Build the first version as a native Salesforce metadata package with an after-update Opportunity trigger, custom objects for event and score storage, and custom metadata for scoring rules.

This keeps scoring deterministic, reviewable, and deployable without Prometheus/Supabase being online.

## Platform Options Reviewed

| Option | Fit | Notes |
|---|---|---|
| Apex trigger on Opportunity | Best for v1 | Runs in the same transaction, can compare `Trigger.oldMap` to `Trigger.new`, and can create native score records immediately. |
| Opportunity Field History Tracking | Audit companion | Useful admin audit trail, but limited to selected fields and not a scoring engine. |
| Change Data Capture | Integration option | Good for streaming changes out of Salesforce, but adds event delivery, replay, and subscription operations. Better for syncing scores elsewhere later. |
| Flow | Possible but brittle | Admin-friendly, but complex field-diff and idempotent scoring logic gets hard to inspect and test. |

## Dependencies

- Salesforce org with Opportunity object access.
- Deployable Apex triggers/classes.
- Custom objects and custom metadata deployment rights.
- Permission set assignment for admins or sales operations users.
- Agreement on tracked Opportunity fields and scoring rules.
- Sandbox validation against existing Opportunity automation.

## Blockers And Risks

- Existing Opportunity triggers/flows can cause extra updates or recursion. Sandbox regression testing is required.
- Opportunity stage names vary by org. The default `Closed Won` rule assumes the standard value.
- If multi-currency is enabled, Amount-based rules may need currency normalization before leaderboard comparisons.
- If territory ownership differs from Opportunity `OwnerId`, score ownership rules need to be refined.
- Field History Tracking is optional but, if desired, must be configured for the same tracked fields and can have field-count limits.
- CDC is not required for v1. If later used, replay ID handling and event retention become operational dependencies.

## Sources

- Salesforce Apex trigger documentation: https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers.htm
- Salesforce Opportunity object reference: https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_opportunity.htm
- Salesforce Opportunity field history object reference: https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_opportunityfieldhistory.htm
- Salesforce Change Data Capture overview: https://developer.salesforce.com/docs/atlas.en-us.change_data_capture.meta/change_data_capture/cdc_intro.htm

