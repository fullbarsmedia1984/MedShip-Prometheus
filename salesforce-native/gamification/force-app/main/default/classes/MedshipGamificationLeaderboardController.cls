public with sharing class MedshipGamificationLeaderboardController {
    public class LeaderboardRow {
        @AuraEnabled public Id userId;
        @AuraEnabled public String userName;
        @AuraEnabled public Decimal points;
        @AuraEnabled public Decimal opportunityChangeCount;
        @AuraEnabled public Decimal wonOpportunityCount;
        @AuraEnabled public Date periodStart;

        public LeaderboardRow(Medship_Rep_Score__c score) {
            userId = score.User__c;
            userName = score.User__r == null ? null : score.User__r.Name;
            points = score.Points__c;
            opportunityChangeCount = score.Opportunity_Change_Count__c;
            wonOpportunityCount = score.Won_Opportunity_Count__c;
            periodStart = score.Period_Start__c;
        }
    }

    @AuraEnabled(cacheable=true)
    public static List<LeaderboardRow> getCurrentMonthLeaderboard() {
        return getLeaderboardForPeriod(Date.today());
    }

    @TestVisible
    private static List<LeaderboardRow> getLeaderboardForPeriod(Date periodDate) {
        Date periodStart = Date.newInstance(periodDate.year(), periodDate.month(), 1);
        List<LeaderboardRow> rows = new List<LeaderboardRow>();

        for (Medship_Rep_Score__c score : [
            SELECT User__c, User__r.Name, Points__c, Opportunity_Change_Count__c,
                   Won_Opportunity_Count__c, Period_Start__c
            FROM Medship_Rep_Score__c
            WHERE Period_Type__c = 'Month'
              AND Period_Start__c = :periodStart
            ORDER BY Points__c DESC, Won_Opportunity_Count__c DESC, User__r.Name ASC
            LIMIT 50
        ]) {
            rows.add(new LeaderboardRow(score));
        }

        return rows;
    }
}

