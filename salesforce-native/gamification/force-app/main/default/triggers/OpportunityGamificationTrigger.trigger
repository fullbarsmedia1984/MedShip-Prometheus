trigger OpportunityGamificationTrigger on Opportunity (after update) {
    MedshipOpportunityGamification.handleAfterUpdate(Trigger.new, Trigger.oldMap);
}

