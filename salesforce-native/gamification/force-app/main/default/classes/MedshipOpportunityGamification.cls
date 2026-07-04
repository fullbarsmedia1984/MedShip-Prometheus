public with sharing class MedshipOpportunityGamification {
    private static Boolean isRunning = false;

    public class Rule {
        public String key;
        public String fieldApiName;
        public String fromValue;
        public String toValue;
        public String direction;
        public Integer points;
        public String changeType;

        public Rule(Medship_Gamification_Rule__mdt metadataRule) {
            key = metadataRule.DeveloperName;
            fieldApiName = metadataRule.Field_API_Name__c;
            fromValue = metadataRule.From_Value__c;
            toValue = metadataRule.To_Value__c;
            direction = metadataRule.Direction__c;
            points = metadataRule.Points__c == null ? 0 : metadataRule.Points__c.intValue();
            changeType = metadataRule.Change_Type__c;
        }

        public Boolean matches(Opportunity newRecord, Opportunity oldRecord) {
            if (String.isBlank(fieldApiName) || points == null || points == 0) return false;
            if (!Opportunity.SObjectType.getDescribe().fields.getMap().containsKey(fieldApiName)) return false;

            Object newRaw = newRecord.get(fieldApiName);
            Object oldRaw = oldRecord.get(fieldApiName);
            if (!hasChanged(newRaw, oldRaw)) return false;

            if (direction == 'Increase') return compareDecimals(newRaw, oldRaw) > 0;
            if (direction == 'Decrease') return compareDecimals(newRaw, oldRaw) < 0;
            if (direction == 'Date Pulled In') return compareDates(newRaw, oldRaw) < 0;
            if (direction == 'Date Pushed Out') return compareDates(newRaw, oldRaw) > 0;
            if (direction == 'Value Match') return valueMatches(oldRaw, fromValue) && valueMatches(newRaw, toValue);

            return true;
        }
    }

    public static void handleAfterUpdate(List<Opportunity> newRecords, Map<Id, Opportunity> oldMap) {
        if (isRunning) return;
        isRunning = true;

        try {
            applyRules(newRecords, oldMap, loadActiveRules());
        } finally {
            isRunning = false;
        }
    }

    @TestVisible
    private static List<Rule> loadActiveRules() {
        List<Rule> rules = new List<Rule>();
        for (Medship_Gamification_Rule__mdt rule : [
            SELECT DeveloperName, Active__c, Field_API_Name__c, From_Value__c, To_Value__c,
                   Direction__c, Points__c, Change_Type__c
            FROM Medship_Gamification_Rule__mdt
            WHERE Active__c = true
        ]) {
            rules.add(new Rule(rule));
        }
        return rules;
    }

    @TestVisible
    private static void applyRules(List<Opportunity> newRecords, Map<Id, Opportunity> oldMap, List<Rule> rules) {
        if (newRecords.isEmpty() || oldMap.isEmpty() || rules.isEmpty()) return;

        DateTime occurredOn = System.now();
        List<Medship_Game_Event__c> candidateEvents = new List<Medship_Game_Event__c>();

        for (Opportunity newRecord : newRecords) {
            Opportunity oldRecord = oldMap.get(newRecord.Id);
            if (oldRecord == null || newRecord.OwnerId == null) continue;

            for (Rule rule : rules) {
                if (!rule.matches(newRecord, oldRecord)) continue;

                Object oldRaw = oldRecord.get(rule.fieldApiName);
                Object newRaw = newRecord.get(rule.fieldApiName);
                String rawKey = String.join(new List<String>{
                    String.valueOf(newRecord.Id),
                    rule.key,
                    rule.fieldApiName,
                    valueToText(oldRaw),
                    valueToText(newRaw),
                    String.valueOf(newRecord.LastModifiedDate)
                }, '|');

                candidateEvents.add(new Medship_Game_Event__c(
                    Opportunity__c = newRecord.Id,
                    User__c = newRecord.OwnerId,
                    Rule_Key__c = rule.key,
                    Points__c = rule.points,
                    Field_API_Name__c = rule.fieldApiName,
                    Old_Value__c = valueToText(oldRaw),
                    New_Value__c = valueToText(newRaw),
                    Change_Type__c = rule.changeType,
                    Occurred_On__c = occurredOn,
                    Idempotency_Key__c = hashKey(rawKey)
                ));
            }
        }

        persistEventsAndScores(candidateEvents, occurredOn.date());
    }

    private static void persistEventsAndScores(List<Medship_Game_Event__c> candidateEvents, Date scoreDate) {
        if (candidateEvents.isEmpty()) return;

        Schema.SObjectField idempotencyField = Medship_Game_Event__c.Fields.Idempotency_Key__c;
        Database.UpsertResult[] results = Database.upsert(candidateEvents, idempotencyField, false);

        List<Medship_Game_Event__c> createdEvents = new List<Medship_Game_Event__c>();
        for (Integer index = 0; index < results.size(); index++) {
            if (results[index].isSuccess() && results[index].isCreated()) {
                createdEvents.add(candidateEvents[index]);
            }
        }

        if (createdEvents.isEmpty()) return;
        rollUpScores(createdEvents, scoreDate);
    }

    private static void rollUpScores(List<Medship_Game_Event__c> events, Date scoreDate) {
        Date periodStart = Date.newInstance(scoreDate.year(), scoreDate.month(), 1);
        Set<String> scoreKeys = new Set<String>();

        for (Medship_Game_Event__c eventRecord : events) {
            scoreKeys.add(buildScoreKey(eventRecord.User__c, periodStart));
        }

        Map<String, Medship_Rep_Score__c> scoresByKey = new Map<String, Medship_Rep_Score__c>();
        for (Medship_Rep_Score__c score : [
            SELECT Id, Score_Key__c, Points__c, Opportunity_Change_Count__c, Won_Opportunity_Count__c
            FROM Medship_Rep_Score__c
            WHERE Score_Key__c IN :scoreKeys
        ]) {
            scoresByKey.put(score.Score_Key__c, score);
        }

        for (Medship_Game_Event__c eventRecord : events) {
            String scoreKey = buildScoreKey(eventRecord.User__c, periodStart);
            Medship_Rep_Score__c score = scoresByKey.get(scoreKey);

            if (score == null) {
                score = new Medship_Rep_Score__c(
                    Score_Key__c = scoreKey,
                    User__c = eventRecord.User__c,
                    Period_Type__c = 'Month',
                    Period_Start__c = periodStart,
                    Points__c = 0,
                    Opportunity_Change_Count__c = 0,
                    Won_Opportunity_Count__c = 0
                );
                scoresByKey.put(scoreKey, score);
            }

            score.Points__c = nullToZero(score.Points__c) + nullToZero(eventRecord.Points__c);
            score.Opportunity_Change_Count__c = nullToZero(score.Opportunity_Change_Count__c) + 1;
            if (eventRecord.Change_Type__c == 'Closed Won') {
                score.Won_Opportunity_Count__c = nullToZero(score.Won_Opportunity_Count__c) + 1;
            }
        }

        Schema.SObjectField scoreKeyField = Medship_Rep_Score__c.Fields.Score_Key__c;
        Database.upsert(scoresByKey.values(), scoreKeyField, false);
    }

    private static String buildScoreKey(Id userId, Date periodStart) {
        return String.valueOf(userId) + '|Month|' + String.valueOf(periodStart);
    }

    private static String hashKey(String rawKey) {
        return EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256', Blob.valueOf(rawKey)));
    }

    private static Integer compareDecimals(Object newRaw, Object oldRaw) {
        if (newRaw == null || oldRaw == null) return 0;
        Decimal newValue = (Decimal)newRaw;
        Decimal oldValue = (Decimal)oldRaw;
        if (newValue == oldValue) return 0;
        return newValue > oldValue ? 1 : -1;
    }

    private static Integer compareDates(Object newRaw, Object oldRaw) {
        if (newRaw == null || oldRaw == null) return 0;
        Date newValue = (Date)newRaw;
        Date oldValue = (Date)oldRaw;
        if (newValue == oldValue) return 0;
        return newValue > oldValue ? 1 : -1;
    }

    private static Boolean hasChanged(Object newRaw, Object oldRaw) {
        if (newRaw == null && oldRaw == null) return false;
        if (newRaw == null || oldRaw == null) return true;
        return valueToText(newRaw) != valueToText(oldRaw);
    }

    private static Boolean valueMatches(Object rawValue, String expected) {
        return String.isBlank(expected) || valueToText(rawValue) == expected;
    }

    private static String valueToText(Object rawValue) {
        return rawValue == null ? null : String.valueOf(rawValue);
    }

    private static Decimal nullToZero(Decimal value) {
        return value == null ? 0 : value;
    }
}
