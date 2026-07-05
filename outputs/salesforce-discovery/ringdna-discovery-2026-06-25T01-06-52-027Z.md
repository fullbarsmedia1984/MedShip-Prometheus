# Salesforce RingDNA Discovery

Run: 2026-06-25T01:07:29.873Z
Org: Medical Shipment (Enterprise Edition, IsSandbox=false)

## Safety

- Read-only Salesforce API discovery.
- No Salesforce mutations were attempted.
- No call notes, recording URLs, contact names, account names, credentials, PHI, or shipment/customer-sensitive fields were queried as record data.
- Recording/note fields are inventoried only as metadata and marked unsafe for default dashboard sync.

## RingDNA Objects

| Object | Label | Queryable | Fields | Safe Fields |
| --- | --- | --- | --- | --- |
| Account | Account | true | 16 | 16 |
| AIInsightValue | AI Insight Value | true | 1 | 1 |
| AIRecordInsight | AI Record Insight | true | 1 | 1 |
| Attachment | Attachment | true | 1 | 1 |
| Campaign | Campaign | true | 12 | 12 |
| CollaborationGroupRecord | Group Record | true | 1 | 1 |
| Contact | Contact | true | 24 | 24 |
| ContactRequest | Contact Request | true | 1 | 0 |
| ContentDistribution | Content Delivery | true | 1 | 1 |
| ContentDocumentLink | Content Document Link | true | 1 | 1 |
| ContentVersion | Content Version | true | 1 | 1 |
| DuplicateRecordItem | Duplicate Record Item | true | 1 | 1 |
| EntitySubscription | Entity Subscription | true | 1 | 1 |
| Event | Event | true | 32 | 25 |
| EventRelation | Event Relation | true | 1 | 1 |
| FeedComment | Feed Comment | true | 1 | 1 |
| FeedItem | Feed Item | true | 1 | 1 |
| FlowOrchestrationWorkItem | Orchestration Work Item | true | 1 | 1 |
| FlowRecordRelation | Flow Record Relation | true | 1 | 1 |
| Lead | Lead | true | 24 | 24 |
| Note | Note | true | 1 | 1 |
| Opportunity | Opportunity | true | 16 | 16 |
| ProcessException | Process Exception | true | 1 | 1 |
| ProcessInstance | Process Instance | true | 1 | 1 |
| RecordAction | Record Action | true | 1 | 1 |
| RecordActionHistory | RecordActionHistory | true | 1 | 1 |
| ringdna__Call_Flow__c | Call Flow | true | 1 | 1 |
| ringdna__Call_Flow__Share | Share: Call Flow | true | 1 | 1 |
| ringdna__Call_Flow_Step__c | Call Flow Step | true | 11 | 11 |
| ringdna100__Agent_Stats__c | Agent Stat | true | 10 | 10 |
| ringdna100__Agent_Stats__Share | Share: Agent Stat | true | 1 | 1 |
| ringdna100__Feature_Control__c | Feature Control | true | 1 | 1 |
| Task | Task | true | 32 | 25 |
| TaskRelation | Task Relation | true | 1 | 1 |
| TopicAssignment | Topic Assignment | true | 1 | 1 |
| UserDefinedLabelAssignment | Label Assignment | true | 1 | 1 |
| VideoCall | Video Call | true | 1 | 1 |
| VoiceCall | Voice Call | true | 1 | 1 |

## Task Call Coverage Last 365 Days

| Field | Label | Type | Populated | Total | % |
| --- | --- | --- | --- | --- | --- |
| OwnerId | Assigned To ID | reference | 8324 | 8324 | 100 |
| ActivityDate | Due Date Only | date | 8324 | 8324 | 100 |
| CreatedDate | Created Date | datetime | 8324 | 8324 | 100 |
| LastModifiedDate | Last Modified Date | datetime | 8324 | 8324 | 100 |
| TaskSubtype | Task Subtype | picklist | 8324 | 8324 | 100 |
| CallType | Call Type | picklist | 0 | 8324 | 0 |
| CallDisposition | Call Result | string | 0 | 8324 | 0 |
| CallDurationInSeconds | Call Duration | int | 0 | 8324 | 0 |
| Profile_Call_Type__c | Profile Call Type | picklist | 0 | 8324 | 0 |
| Profile_Call_Outcome__c | Profile Call Outcome | picklist | 0 | 8324 | 0 |
| Products_Discussed__c | Products Discussed | multipicklist | 0 | 8324 | 0 |
| Program_Size__c | Program Size | picklist | 0 | 8324 | 0 |
| Budget_Timeframe__c | Budget Timeframe | picklist | 0 | 8324 | 0 |
| Follow_Up_Date__c | Follow Up Date | date | 0 | 8324 | 0 |
| Converted_to_Opp__c | Converted to Opportunity | boolean | 8324 | 8324 | 100 |
| Related_Opportunity__c | Related Opportunity | reference | 0 | 8324 | 0 |
| ringdna__Call_Direction__c | Direction | picklist | 8324 | 8324 | 100 |
| ringdna__Call_Duration_min__c | Duration (min) | double | 8324 | 8324 | 100 |
| ringdna__Call_Connected__c | Call Connected? | boolean | 8324 | 8324 | 100 |
| ringdna__Call_Rating__c | Rating | double | 8324 | 8324 | 100 |
| ringdna__Voicemail__c | Voicemail | boolean | 8324 | 8324 | 100 |
| ringdna__Keywords__c | Keywords | textarea | 0 | 8324 | 0 |
| ringdna__Call_Start_Time__c | Start Time | datetime | 8324 | 8324 | 100 |
| ringdna__Call_Disposition__c | Disposition | picklist | 0 | 8324 | 0 |

## Event RingDNA Coverage Last 365 Days

| Field | Label | Type | Populated | Total | % |
| --- | --- | --- | --- | --- | --- |
| OwnerId | Assigned To ID | reference | 287 | 287 | 100 |
| ActivityDate | Due Date Only | date | 287 | 287 | 100 |
| CreatedDate | Created Date | datetime | 287 | 287 | 100 |
| LastModifiedDate | Last Modified Date | datetime | 287 | 287 | 100 |
| Profile_Call_Type__c | Profile Call Type | picklist | 0 | 287 | 0 |
| Profile_Call_Outcome__c | Profile Call Outcome | picklist | 0 | 287 | 0 |
| Products_Discussed__c | Products Discussed | multipicklist | 0 | 287 | 0 |
| Program_Size__c | Program Size | picklist | 0 | 287 | 0 |
| Budget_Timeframe__c | Budget Timeframe | picklist | 0 | 287 | 0 |
| Follow_Up_Date__c | Follow Up Date | date | 0 | 287 | 0 |
| Converted_to_Opp__c | Converted to Opportunity | boolean | 287 | 287 | 100 |
| Related_Opportunity__c | Related Opportunity | reference | 0 | 287 | 0 |
| ringdna__Call_Direction__c | Direction | picklist | 0 | 287 | 0 |
| ringdna__Call_Duration_min__c | Duration (min) | double | 287 | 287 | 100 |
| ringdna__Call_Connected__c | Call Connected? | boolean | 287 | 287 | 100 |
| ringdna__Call_Rating__c | Rating | double | 0 | 287 | 0 |
| ringdna__Voicemail__c | Voicemail | boolean | 287 | 287 | 100 |
| ringdna__Keywords__c | Keywords | textarea | 0 | 287 | 0 |
| ringdna__Call_Start_Time__c | Start Time | datetime | 0 | 287 | 0 |
| ringdna__Call_Disposition__c | Disposition | picklist | 0 | 287 | 0 |

## Recommended Prometheus/Zeus Source

- Primary source: `Task` where `TaskSubtype = 'Call'`.
- Secondary source: `Event` rows with RingDNA fields populated.
- Optional enrichment: Profile Call custom fields when populated.
- Default exclusions: notes/free text, recording URLs, contact/account names, and customer/shipment-sensitive fields.
