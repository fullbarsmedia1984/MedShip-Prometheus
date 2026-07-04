@IsTest
private class MedshipOpportunityGamificationTest {
    @TestSetup
    static void setupData() {
        Account account = new Account(Name = 'Gamification Test Account');
        insert account;

        Opportunity opportunity = new Opportunity(
            Name = 'Gamification Test Opportunity',
            AccountId = account.Id,
            StageName = 'Prospecting',
            CloseDate = Date.today().addDays(30),
            Amount = 1000
        );
        insert opportunity;
    }

    @IsTest
    static void awardsPointsForTrackedOpportunityChanges() {
        Opportunity opportunity = [
            SELECT Id, StageName, CloseDate, Amount
            FROM Opportunity
            LIMIT 1
        ];

        opportunity.StageName = 'Closed Won';
        opportunity.Amount = 1250;
        opportunity.CloseDate = Date.today().addDays(10);

        Test.startTest();
        update opportunity;
        Test.stopTest();

        List<Medship_Game_Event__c> events = [
            SELECT Rule_Key__c, Points__c, Field_API_Name__c, Change_Type__c
            FROM Medship_Game_Event__c
            WHERE Opportunity__c = :opportunity.Id
        ];

        System.assertEquals(4, events.size(), 'Expected one event per matching default scoring rule.');

        Decimal totalPoints = 0;
        Set<String> ruleKeys = new Set<String>();
        for (Medship_Game_Event__c eventRecord : events) {
            totalPoints += eventRecord.Points__c;
            ruleKeys.add(eventRecord.Rule_Key__c);
        }

        System.assertEquals(true, ruleKeys.contains('Stage_Changed'));
        System.assertEquals(true, ruleKeys.contains('Closed_Won'));
        System.assertEquals(true, ruleKeys.contains('Amount_Increase'));
        System.assertEquals(true, ruleKeys.contains('Close_Date_Pulled_In'));
        System.assertEquals(Decimal.valueOf('70'), totalPoints);

        Medship_Rep_Score__c score = [
            SELECT Points__c, Opportunity_Change_Count__c, Won_Opportunity_Count__c
            FROM Medship_Rep_Score__c
            LIMIT 1
        ];

        System.assertEquals(Decimal.valueOf('70'), score.Points__c);
        System.assertEquals(Decimal.valueOf('4'), score.Opportunity_Change_Count__c);
        System.assertEquals(Decimal.valueOf('1'), score.Won_Opportunity_Count__c);

        List<MedshipGamificationLeaderboardController.LeaderboardRow> leaderboard =
            MedshipGamificationLeaderboardController.getLeaderboardForPeriod(Date.today());

        System.assertEquals(1, leaderboard.size());
        System.assertEquals(Decimal.valueOf('70'), leaderboard[0].points);
    }

    @IsTest
    static void ignoresUntrackedOpportunityChanges() {
        Opportunity opportunity = [
            SELECT Id, NextStep
            FROM Opportunity
            LIMIT 1
        ];

        opportunity.NextStep = 'Send follow-up';

        Test.startTest();
        update opportunity;
        Test.stopTest();

        System.assertEquals(0, [SELECT COUNT() FROM Medship_Game_Event__c]);
        System.assertEquals(0, [SELECT COUNT() FROM Medship_Rep_Score__c]);
    }
}
