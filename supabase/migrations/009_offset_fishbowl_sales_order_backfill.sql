-- Keep Fishbowl automations from competing for the single Fishbowl session lock.
-- P2 remains on the 0/15/30/45 minute boundary; P7 runs five minutes later.

UPDATE sync_schedules
SET cron_expression = '5,20,35,50 * * * *'
WHERE automation = 'P7_FB_SO_SYNC';

UPDATE sync_schedules
SET cron_expression = '*/15 * * * *'
WHERE automation = 'P1_OPP_TO_SO';
