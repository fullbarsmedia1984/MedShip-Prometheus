# MedShip Gamification Salesforce App

Native Salesforce metadata for tracking Opportunity changes and awarding sales gamification points.

## What This Package Adds

- A Lightning app: **MedShip Gamification**
- Custom objects:
  - `Medship_Game_Event__c`: immutable scoring/audit events created from Opportunity changes
  - `Medship_Rep_Score__c`: monthly rollups by rep
- Custom metadata type:
  - `Medship_Gamification_Rule__mdt`: inspectable scoring rules
- Apex:
  - `OpportunityGamificationTrigger`
  - `MedshipOpportunityGamification`
  - `MedshipOpportunityGamificationTest`
- Permission set:
  - `Medship_Gamification_Admin`

## Current Scoring Rules

The default metadata rules award points for:

- Any `StageName` change
- `StageName` changing to `Closed Won`
- `Amount` increases
- `CloseDate` pulled earlier

Rules are intentionally simple and deterministic. No model output is used for scoring.

## Deploy From Repo Root

```powershell
cd salesforce-native/gamification
sf project deploy start --target-org <sandbox-alias> --test-level RunLocalTests
```

Assign the admin permission set:

```powershell
sf org assign permset --name Medship_Gamification_Admin --target-org <sandbox-alias>
```

## Operational Notes

- Deploy to sandbox first.
- Confirm Opportunity automation already in the org does not update scoring objects recursively.
- Keep scoring rules in custom metadata so admins can review and version changes.
- Use `Medship_Game_Event__c.Idempotency_Key__c` as the external ID that prevents duplicate event inserts for the same detected change.
- This package does not require Opportunity Field History Tracking, but enabling field history for the same fields is recommended for admin auditability.

