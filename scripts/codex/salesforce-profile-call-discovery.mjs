import jsforce from 'jsforce'
import fs from 'node:fs'
import path from 'node:path'

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue

    const index = line.indexOf('=')
    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

loadEnvFile(path.resolve(process.cwd(), '.env.local'))
loadEnvFile(path.resolve(process.cwd(), '.env'))

const SF_API_VERSION = process.env.SF_API_VERSION || '60.0'
const requiredEnv = ['SF_USERNAME', 'SF_PASSWORD', 'SF_SECURITY_TOKEN']
const missingEnv = requiredEnv.filter((key) => !process.env[key])

if (missingEnv.length > 0) {
  console.error(JSON.stringify({ ok: false, error: 'missing_env', missingEnv }, null, 2))
  process.exit(2)
}

const loginUrl = process.env.SF_LOGIN_URL || 'https://login.salesforce.com'
const conn = new jsforce.Connection({
  loginUrl,
  version: SF_API_VERSION,
})

const profileCallFields = [
  'Profile_Call_Type__c',
  'Profile_Call_Outcome__c',
  'Products_Discussed__c',
  'Program_Size__c',
  'Current_Supplier__c',
  'Budget_Available__c',
  'Budget_Timeframe__c',
  'Follow_Up_Date__c',
  'Converted_to_Opp__c',
  'Related_Opportunity__c',
  'Call_Notes_Summary__c',
  'Competitor_Intel__c',
  'ringdna__Call_Direction__c',
  'ringdna__Call_Duration_min__c',
  'ringdna__Call_Connected__c',
  'ringdna__Call_Rating__c',
  'ringdna__Call_Recording_URL__c',
  'ringdna__Voicemail__c',
  'ringdna__Keywords__c',
  'ringdna__Call_Start_Time__c',
  'ringdna__Call_Disposition__c',
  'Calendly__IsNoShow__c',
  'Calendly__IsRescheduled__c',
]

const callActivityFields = [
  'Type',
  'TaskSubtype',
  'CallType',
  'CallDisposition',
  'CallDurationInSeconds',
  'ringdna__Call_Direction__c',
  'ringdna__Call_Duration_min__c',
  'ringdna__Call_Connected__c',
  'ringdna__Call_Rating__c',
  'ringdna__Voicemail__c',
  'ringdna__Keywords__c',
  'ringdna__Call_Start_Time__c',
  'ringdna__Call_Disposition__c',
]

const notDashboardSafeByDefault = new Set([
  'Subject',
  'WhoId',
  'Who.Name',
  'AccountId',
  'Account.Name',
  'Call_Notes_Summary__c',
  'Competitor_Intel__c',
  'ringdna__Call_Recording_URL__c',
])

function compactError(error) {
  return {
    name: error?.name,
    message: error?.message || String(error),
  }
}

async function safeQuery(name, soql) {
  try {
    const result = await conn.query(soql)
    return {
      name,
      ok: true,
      totalSize: result.totalSize,
      records: result.records,
    }
  } catch (error) {
    return {
      name,
      ok: false,
      error: compactError(error),
      soql,
    }
  }
}

function summarizeFields(describeResult) {
  const byName = new Map(describeResult.fields.map((field) => [field.name, field]))

  return profileCallFields.map((name) => {
    const field = byName.get(name)

    if (!field) {
      return {
        name,
        exists: false,
        dashboardSafeByDefault: !notDashboardSafeByDefault.has(name),
      }
    }

    return {
      name,
      exists: true,
      label: field.label,
      type: field.type,
      custom: field.custom,
      permissionable: field.permissionable,
      restrictedPicklist: field.restrictedPicklist,
      picklistValues: field.picklistValues
        ?.filter((value) => value.active)
        .map((value) => value.value)
        .slice(0, 50) ?? [],
      dashboardSafeByDefault: !notDashboardSafeByDefault.has(name),
    }
  })
}

function summarizeCallActivityFields(describeResult) {
  const byName = new Map(describeResult.fields.map((field) => [field.name, field]))

  return callActivityFields.map((name) => {
    const field = byName.get(name)

    if (!field) {
      return {
        name,
        exists: false,
        dashboardSafeByDefault: !notDashboardSafeByDefault.has(name),
      }
    }

    return {
      name,
      exists: true,
      label: field.label,
      type: field.type,
      custom: field.custom,
      picklistValues: field.picklistValues
        ?.filter((value) => value.active)
        .map((value) => value.value)
        .slice(0, 50) ?? [],
      dashboardSafeByDefault: !notDashboardSafeByDefault.has(name),
    }
  })
}

function ownerIdsFrom(result) {
  if (!result.ok) return []

  return result.records
    .map((record) => record.ownerId || record.OwnerId)
    .filter(Boolean)
}

async function getOwnerLookup(ownerIds) {
  const uniqueOwnerIds = [...new Set(ownerIds)]
  if (uniqueOwnerIds.length === 0) return []

  const quotedIds = uniqueOwnerIds
    .map((id) => `'${String(id).replace(/'/g, "\\'")}'`)
    .join(',')

  const owners = await safeQuery(
    'ownerLookup',
    `SELECT Id, Name, IsActive FROM User WHERE Id IN (${quotedIds}) LIMIT ${uniqueOwnerIds.length}`
  )

  return owners.ok ? owners.records : owners
}

async function main() {
  await conn.login(process.env.SF_USERNAME, `${process.env.SF_PASSWORD}${process.env.SF_SECURITY_TOKEN}`)

  const [org, taskDescribe, eventDescribe] = await Promise.all([
    safeQuery('org', 'SELECT Id, Name, OrganizationType, IsSandbox FROM Organization LIMIT 1'),
    conn.sobject('Task').describe(),
    conn.sobject('Event').describe(),
  ])

  const taskFields = new Set(taskDescribe.fields.map((field) => field.name))
  const eventFields = new Set(eventDescribe.fields.map((field) => field.name))

  const queries = await Promise.all([
    safeQuery(
      'recordTypes',
      "SELECT Id, SobjectType, DeveloperName, Name, IsActive FROM RecordType WHERE SobjectType IN ('Task','Event') AND DeveloperName = 'Profile_Call' LIMIT 10"
    ),
    safeQuery(
      'activityRecordTypes',
      "SELECT Id, SobjectType, DeveloperName, Name, IsActive FROM RecordType WHERE SobjectType IN ('Task','Event') ORDER BY SobjectType, DeveloperName LIMIT 100"
    ),
    safeQuery(
      'taskTotal',
      "SELECT COUNT() FROM Task WHERE RecordType.DeveloperName = 'Profile_Call'"
    ),
    safeQuery(
      'eventTotal',
      "SELECT COUNT() FROM Event WHERE RecordType.DeveloperName = 'Profile_Call'"
    ),
    safeQuery(
      'taskLast30',
      "SELECT COUNT() FROM Task WHERE RecordType.DeveloperName = 'Profile_Call' AND ActivityDate = LAST_N_DAYS:30"
    ),
    safeQuery(
      'eventLast30',
      "SELECT COUNT() FROM Event WHERE RecordType.DeveloperName = 'Profile_Call' AND ActivityDate = LAST_N_DAYS:30"
    ),
    safeQuery(
      'taskLast90',
      "SELECT COUNT() FROM Task WHERE RecordType.DeveloperName = 'Profile_Call' AND ActivityDate = LAST_N_DAYS:90"
    ),
    safeQuery(
      'eventLast90',
      "SELECT COUNT() FROM Event WHERE RecordType.DeveloperName = 'Profile_Call' AND ActivityDate = LAST_N_DAYS:90"
    ),
    safeQuery(
      'taskAllLast90',
      'SELECT COUNT() FROM Task WHERE ActivityDate = LAST_N_DAYS:90'
    ),
    safeQuery(
      'eventAllLast90',
      'SELECT COUNT() FROM Event WHERE ActivityDate = LAST_N_DAYS:90'
    ),
    safeQuery(
      'taskByRecordTypeLast365',
      'SELECT RecordType.DeveloperName recordType, COUNT(Id) total FROM Task WHERE ActivityDate = LAST_N_DAYS:365 GROUP BY RecordType.DeveloperName ORDER BY COUNT(Id) DESC LIMIT 50'
    ),
    safeQuery(
      'eventByRecordTypeLast365',
      'SELECT RecordType.DeveloperName recordType, COUNT(Id) total FROM Event WHERE ActivityDate = LAST_N_DAYS:365 GROUP BY RecordType.DeveloperName ORDER BY COUNT(Id) DESC LIMIT 50'
    ),
    safeQuery(
      'taskTypeLast365',
      'SELECT Type type, COUNT(Id) total FROM Task WHERE ActivityDate = LAST_N_DAYS:365 GROUP BY Type ORDER BY COUNT(Id) DESC LIMIT 50'
    ),
    safeQuery(
      'taskSubtypeLast365',
      'SELECT TaskSubtype subtype, COUNT(Id) total FROM Task WHERE ActivityDate = LAST_N_DAYS:365 GROUP BY TaskSubtype ORDER BY COUNT(Id) DESC LIMIT 50'
    ),
    safeQuery(
      'taskCallDispositionLast365',
      'SELECT CallDisposition disposition, COUNT(Id) total FROM Task WHERE ActivityDate = LAST_N_DAYS:365 GROUP BY CallDisposition ORDER BY COUNT(Id) DESC LIMIT 50'
    ),
    safeQuery(
      'taskStandardCallCoverageLast365',
      'SELECT COUNT(Id) total, COUNT(CallDurationInSeconds) durationCount, AVG(CallDurationInSeconds) avgDurationSeconds FROM Task WHERE ActivityDate = LAST_N_DAYS:365'
    ),
    safeQuery(
      'taskRingDnaCoverageAllLast365',
      'SELECT COUNT(Id) total, COUNT(ringdna__Call_Duration_min__c) durationCount, AVG(ringdna__Call_Duration_min__c) avgDuration, COUNT(ringdna__Call_Rating__c) ratingCount, AVG(ringdna__Call_Rating__c) avgRating FROM Task WHERE ActivityDate = LAST_N_DAYS:365'
    ),
    safeQuery(
      'eventRingDnaCoverageAllLast365',
      'SELECT COUNT(Id) total, COUNT(ringdna__Call_Duration_min__c) durationCount, AVG(ringdna__Call_Duration_min__c) avgDuration, COUNT(ringdna__Call_Rating__c) ratingCount, AVG(ringdna__Call_Rating__c) avgRating FROM Event WHERE ActivityDate = LAST_N_DAYS:365'
    ),
    safeQuery(
      'taskRingDnaConnectedAllLast365',
      'SELECT COUNT() FROM Task WHERE ActivityDate = LAST_N_DAYS:365 AND ringdna__Call_Connected__c = true'
    ),
    safeQuery(
      'eventRingDnaConnectedAllLast365',
      'SELECT COUNT() FROM Event WHERE ActivityDate = LAST_N_DAYS:365 AND ringdna__Call_Connected__c = true'
    ),
    safeQuery(
      'taskByOwnerAllLast90',
      'SELECT OwnerId ownerId, COUNT(Id) total FROM Task WHERE ActivityDate = LAST_N_DAYS:90 GROUP BY OwnerId ORDER BY COUNT(Id) DESC LIMIT 20'
    ),
    safeQuery(
      'eventByOwnerAllLast90',
      'SELECT OwnerId ownerId, COUNT(Id) total FROM Event WHERE ActivityDate = LAST_N_DAYS:90 GROUP BY OwnerId ORDER BY COUNT(Id) DESC LIMIT 20'
    ),
    safeQuery(
      'taskByOwnerLast90',
      "SELECT OwnerId ownerId, COUNT(Id) total FROM Task WHERE RecordType.DeveloperName = 'Profile_Call' AND ActivityDate = LAST_N_DAYS:90 GROUP BY OwnerId ORDER BY COUNT(Id) DESC LIMIT 20"
    ),
    safeQuery(
      'eventByOwnerLast90',
      "SELECT OwnerId ownerId, COUNT(Id) total FROM Event WHERE RecordType.DeveloperName = 'Profile_Call' AND ActivityDate = LAST_N_DAYS:90 GROUP BY OwnerId ORDER BY COUNT(Id) DESC LIMIT 20"
    ),
    safeQuery(
      'taskOutcomeLast90',
      "SELECT Profile_Call_Outcome__c outcome, COUNT(Id) total FROM Task WHERE RecordType.DeveloperName = 'Profile_Call' AND ActivityDate = LAST_N_DAYS:90 GROUP BY Profile_Call_Outcome__c ORDER BY COUNT(Id) DESC LIMIT 30"
    ),
    safeQuery(
      'eventOutcomeLast90',
      "SELECT Profile_Call_Outcome__c outcome, COUNT(Id) total FROM Event WHERE RecordType.DeveloperName = 'Profile_Call' AND ActivityDate = LAST_N_DAYS:90 GROUP BY Profile_Call_Outcome__c ORDER BY COUNT(Id) DESC LIMIT 30"
    ),
    safeQuery(
      'taskTypeLast90',
      "SELECT Profile_Call_Type__c type, COUNT(Id) total FROM Task WHERE RecordType.DeveloperName = 'Profile_Call' AND ActivityDate = LAST_N_DAYS:90 GROUP BY Profile_Call_Type__c ORDER BY COUNT(Id) DESC LIMIT 30"
    ),
    safeQuery(
      'eventTypeLast90',
      "SELECT Profile_Call_Type__c type, COUNT(Id) total FROM Event WHERE RecordType.DeveloperName = 'Profile_Call' AND ActivityDate = LAST_N_DAYS:90 GROUP BY Profile_Call_Type__c ORDER BY COUNT(Id) DESC LIMIT 30"
    ),
    safeQuery(
      'taskRingDnaCoverageLast90',
      "SELECT COUNT(Id) total, COUNT(ringdna__Call_Duration_min__c) durationCount, AVG(ringdna__Call_Duration_min__c) avgDuration, COUNT(ringdna__Call_Rating__c) ratingCount, AVG(ringdna__Call_Rating__c) avgRating FROM Task WHERE RecordType.DeveloperName = 'Profile_Call' AND ActivityDate = LAST_N_DAYS:90"
    ),
    safeQuery(
      'eventRingDnaCoverageLast90',
      "SELECT COUNT(Id) total, COUNT(ringdna__Call_Duration_min__c) durationCount, AVG(ringdna__Call_Duration_min__c) avgDuration, COUNT(ringdna__Call_Rating__c) ratingCount, AVG(ringdna__Call_Rating__c) avgRating FROM Event WHERE RecordType.DeveloperName = 'Profile_Call' AND ActivityDate = LAST_N_DAYS:90"
    ),
    safeQuery(
      'taskConnectedLast90',
      "SELECT COUNT() FROM Task WHERE RecordType.DeveloperName = 'Profile_Call' AND ActivityDate = LAST_N_DAYS:90 AND ringdna__Call_Connected__c = true"
    ),
    safeQuery(
      'eventConnectedLast90',
      "SELECT COUNT() FROM Event WHERE RecordType.DeveloperName = 'Profile_Call' AND ActivityDate = LAST_N_DAYS:90 AND ringdna__Call_Connected__c = true"
    ),
    safeQuery(
      'taskMonthlyVolume',
      "SELECT CALENDAR_YEAR(ActivityDate) year, CALENDAR_MONTH(ActivityDate) month, COUNT(Id) total FROM Task WHERE RecordType.DeveloperName = 'Profile_Call' AND ActivityDate = LAST_N_DAYS:365 GROUP BY CALENDAR_YEAR(ActivityDate), CALENDAR_MONTH(ActivityDate) ORDER BY CALENDAR_YEAR(ActivityDate), CALENDAR_MONTH(ActivityDate) LIMIT 24"
    ),
    safeQuery(
      'eventMonthlyVolume',
      "SELECT CALENDAR_YEAR(ActivityDate) year, CALENDAR_MONTH(ActivityDate) month, COUNT(Id) total FROM Event WHERE RecordType.DeveloperName = 'Profile_Call' AND ActivityDate = LAST_N_DAYS:365 GROUP BY CALENDAR_YEAR(ActivityDate), CALENDAR_MONTH(ActivityDate) ORDER BY CALENDAR_YEAR(ActivityDate), CALENDAR_MONTH(ActivityDate) LIMIT 24"
    ),
  ])

  const ownerLookup = await getOwnerLookup(queries.flatMap(ownerIdsFrom))

  console.log(JSON.stringify({
    ok: true,
    source: 'Salesforce API via local or Railway-injected environment variables',
    safety: {
      readOnly: true,
      excludedFields: [...notDashboardSafeByDefault],
      note: 'No call notes, recording URLs, account names, contact names, customer fields, shipment fields, credentials, or Salesforce mutations were requested.',
    },
    org,
    objects: {
      task: {
        queryable: taskDescribe.queryable,
        fieldCount: taskDescribe.fields.length,
      },
      event: {
        queryable: eventDescribe.queryable,
        fieldCount: eventDescribe.fields.length,
      },
    },
    fieldDiscovery: {
      taskProfileCallFields: summarizeFields(taskDescribe),
      eventProfileCallFields: summarizeFields(eventDescribe),
      sharedMetricFields: profileCallFields.filter((field) => taskFields.has(field) && eventFields.has(field)),
      taskOnlyMetricFields: profileCallFields.filter((field) => taskFields.has(field) && !eventFields.has(field)),
      eventOnlyMetricFields: profileCallFields.filter((field) => !taskFields.has(field) && eventFields.has(field)),
      taskCallActivityFields: summarizeCallActivityFields(taskDescribe),
      eventCallActivityFields: summarizeCallActivityFields(eventDescribe),
    },
    queries,
    ownerLookup,
  }, null, 2))
}

try {
  await main()
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    source: 'Salesforce API via local or Railway-injected environment variables',
    error: compactError(error),
  }, null, 2))
  process.exit(1)
} finally {
  await conn.logout().catch(() => {})
}
