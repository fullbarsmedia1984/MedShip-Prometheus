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
const conn = new jsforce.Connection({ loginUrl, version: SF_API_VERSION })

const OUTPUT_DIR = path.resolve(process.cwd(), 'outputs', 'salesforce-discovery')
const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, '-')

const TASK_SAFE_REPORTING_FIELDS = [
  'Id',
  'OwnerId',
  'ActivityDate',
  'CreatedDate',
  'LastModifiedDate',
  'Type',
  'TaskSubtype',
  'CallType',
  'CallDisposition',
  'CallDurationInSeconds',
  'Profile_Call_Type__c',
  'Profile_Call_Outcome__c',
  'Products_Discussed__c',
  'Program_Size__c',
  'Budget_Timeframe__c',
  'Follow_Up_Date__c',
  'Converted_to_Opp__c',
  'Related_Opportunity__c',
  'ringdna__Call_Direction__c',
  'ringdna__Call_Duration_min__c',
  'ringdna__Call_Connected__c',
  'ringdna__Call_Rating__c',
  'ringdna__Voicemail__c',
  'ringdna__Keywords__c',
  'ringdna__Call_Start_Time__c',
  'ringdna__Call_Disposition__c',
]

const EVENT_SAFE_REPORTING_FIELDS = [
  'Id',
  'OwnerId',
  'ActivityDate',
  'CreatedDate',
  'LastModifiedDate',
  'Profile_Call_Type__c',
  'Profile_Call_Outcome__c',
  'Products_Discussed__c',
  'Program_Size__c',
  'Budget_Timeframe__c',
  'Follow_Up_Date__c',
  'Converted_to_Opp__c',
  'Related_Opportunity__c',
  'ringdna__Call_Direction__c',
  'ringdna__Call_Duration_min__c',
  'ringdna__Call_Connected__c',
  'ringdna__Call_Rating__c',
  'ringdna__Voicemail__c',
  'ringdna__Keywords__c',
  'ringdna__Call_Start_Time__c',
  'ringdna__Call_Disposition__c',
]

const EXCLUDED_BY_DEFAULT = new Set([
  'Subject',
  'Description',
  'WhoId',
  'WhatId',
  'AccountId',
  'Call_Notes_Summary__c',
  'Competitor_Intel__c',
  'ringdna__Automated_Voicemail_Link__c',
  'ringdna__Call_Recording__c',
  'ringdna__Call_Recording_URL__c',
  'ringdna__From_Number__c',
  'ringdna__Local_Presence_Num__c',
  'ringdna__Recording_URL__c',
  'ringdna__RecordingUrl__c',
  'ringdna__Supervisor_Notes__c',
  'ringdna__To_Number__c',
])

function compactError(error) {
  return {
    name: error?.name,
    message: error?.message || String(error),
  }
}

function escapeSoqlLiteral(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function quoteList(values) {
  return values.map((value) => `'${escapeSoqlLiteral(value)}'`).join(',')
}

function fieldMatchesRingDna(field) {
  const haystack = [
    field.name,
    field.label,
    field.inlineHelpText,
    field.referenceTo?.join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return haystack.includes('ringdna') || haystack.includes('ringdna__')
}

function fieldSummary(field) {
  return {
    name: field.name,
    label: field.label,
    type: field.type,
    custom: field.custom,
    calculated: field.calculated,
    nillable: field.nillable,
    permissionable: field.permissionable,
    updateable: field.updateable,
    restrictedPicklist: field.restrictedPicklist,
    picklistValues: field.picklistValues
      ?.filter((value) => value.active)
      .map((value) => value.value)
      .slice(0, 100) ?? [],
    dashboardSafeByDefault: !EXCLUDED_BY_DEFAULT.has(field.name),
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

async function withConcurrency(items, limit, worker) {
  const results = []
  let nextIndex = 0

  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

function hasField(describe, fieldName) {
  return describe.fields.some((field) => field.name === fieldName)
}

function objectSupportsDateFilter(describe, fieldName) {
  return hasField(describe, fieldName)
}

function countAlias(fieldName) {
  return `${fieldName.replace(/[^A-Za-z0-9_]/g, '_')}__count`
}

async function fieldCoverage(objectName, fields, whereClause = null) {
  const baseWhere = whereClause ? `(${whereClause})` : null
  const totalQuery = await safeQuery(
    `${objectName}.coverage.total`,
    `SELECT COUNT() FROM ${objectName}${baseWhere ? ` WHERE ${baseWhere}` : ''}`
  )
  const total = totalQuery.ok ? totalQuery.totalSize : null

  const fieldResults = await withConcurrency(fields, 6, async (field) => {
    if (field.type === 'boolean') {
      const [trueQuery, falseQuery] = await Promise.all([
        safeQuery(
          `${objectName}.coverage.${field.name}.true`,
          `SELECT COUNT() FROM ${objectName} WHERE ${baseWhere ? `${baseWhere} AND ` : ''}${field.name} = true`
        ),
        safeQuery(
          `${objectName}.coverage.${field.name}.false`,
          `SELECT COUNT() FROM ${objectName} WHERE ${baseWhere ? `${baseWhere} AND ` : ''}${field.name} = false`
        ),
      ])
      const trueCount = trueQuery.ok ? trueQuery.totalSize : null
      const falseCount = falseQuery.ok ? falseQuery.totalSize : null
      const nonNullCount = trueCount != null && falseCount != null ? trueCount + falseCount : null

      return {
        name: field.name,
        label: field.label,
        type: field.type,
        nonNullCount,
        trueCount,
        falseCount,
        total,
        percentPopulated: total && nonNullCount != null ? Math.round((nonNullCount / total) * 1000) / 10 : null,
        queryOk: trueQuery.ok && falseQuery.ok,
        errors: [trueQuery, falseQuery].filter((query) => !query.ok).map((query) => query.error),
      }
    }

    const fieldQuery = await safeQuery(
      `${objectName}.coverage.${field.name}`,
      `SELECT COUNT() FROM ${objectName} WHERE ${baseWhere ? `${baseWhere} AND ` : ''}${field.name} != null`
    )
    const nonNullCount = fieldQuery.ok ? fieldQuery.totalSize : null

    return {
      name: field.name,
      label: field.label,
      type: field.type,
      nonNullCount,
      total,
      percentPopulated: total && nonNullCount != null ? Math.round((nonNullCount / total) * 1000) / 10 : null,
      queryOk: fieldQuery.ok,
      errors: fieldQuery.ok ? [] : [fieldQuery.error],
    }
  })

  return {
    objectName,
    whereClause,
    total,
    fields: fieldResults,
    queryErrors: [
      ...(totalQuery.ok ? [] : [totalQuery]),
      ...fieldResults.flatMap((field) => field.errors ?? []),
    ],
  }
}

function dateOnly(value) {
  return value.toISOString().slice(0, 10)
}

function monthBuckets(monthsBack = 12) {
  const now = new Date()
  const buckets = []
  for (let offset = monthsBack - 1; offset >= 0; offset -= 1) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset + 1, 1))
    buckets.push({
      label: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
      start: dateOnly(start),
      end: dateOnly(end),
    })
  }
  return buckets
}

async function taskCallMonthlyBuckets() {
  return withConcurrency(monthBuckets(12), 4, async (bucket) => {
    const query = await safeQuery(
      `taskCallMonthly.${bucket.label}`,
      `SELECT COUNT() FROM Task WHERE TaskSubtype = 'Call' AND ActivityDate >= ${bucket.start} AND ActivityDate < ${bucket.end}`
    )

    return {
      ...bucket,
      ok: query.ok,
      total: query.ok ? query.totalSize : null,
      error: query.ok ? null : query.error,
    }
  })
}

async function ownerLookupFromAggregate(queryResult) {
  if (!queryResult.ok) return []
  const ownerIds = queryResult.records
    .map((record) => record.OwnerId || record.ownerId)
    .filter(Boolean)

  const uniqueOwnerIds = [...new Set(ownerIds)]
  if (uniqueOwnerIds.length === 0) return []

  const owners = await safeQuery(
    `${queryResult.name}.owners`,
    `SELECT Id, Name, IsActive FROM User WHERE Id IN (${quoteList(uniqueOwnerIds)}) LIMIT ${uniqueOwnerIds.length}`
  )

  return owners.ok ? owners.records : []
}

function markdownTable(rows, headers) {
  if (rows.length === 0) return '_None found._'

  const headerLine = `| ${headers.join(' | ')} |`
  const separator = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${headers.map((header) => String(row[header] ?? '').replace(/\|/g, '\\|')).join(' | ')} |`)

  return [headerLine, separator, ...body].join('\n')
}

function writeReports(report) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  const jsonPath = path.join(OUTPUT_DIR, `ringdna-discovery-${RUN_STAMP}.json`)
  const mdPath = path.join(OUTPUT_DIR, `ringdna-discovery-${RUN_STAMP}.md`)

  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`)

  const objectRows = report.ringDnaObjects.map((object) => ({
    Object: object.name,
    Label: object.label,
    Queryable: object.queryable,
    Fields: object.ringDnaFields.length,
    'Safe Fields': object.ringDnaFields.filter((field) => field.dashboardSafeByDefault).length,
  }))

  const taskCoverageRows = report.callActivityCoverage.taskCallLast365?.fields
    ?.map((field) => ({
      Field: field.name,
      Label: field.label,
      Type: field.type,
      Populated: field.nonNullCount,
      Total: field.total,
      '%': field.percentPopulated,
    })) ?? []

  const eventCoverageRows = report.callActivityCoverage.eventRingDnaLast365?.fields
    ?.map((field) => ({
      Field: field.name,
      Label: field.label,
      Type: field.type,
      Populated: field.nonNullCount,
      Total: field.total,
      '%': field.percentPopulated,
    })) ?? []

  const md = [
    '# Salesforce RingDNA Discovery',
    '',
    `Run: ${report.generatedAt}`,
    `Org: ${report.orgSummary?.Name ?? 'Unknown'} (${report.orgSummary?.OrganizationType ?? 'unknown'}, IsSandbox=${report.orgSummary?.IsSandbox ?? 'unknown'})`,
    '',
    '## Safety',
    '',
    '- Read-only Salesforce API discovery.',
    '- No Salesforce mutations were attempted.',
    '- No call notes, recording URLs, contact names, account names, credentials, PHI, or shipment/customer-sensitive fields were queried as record data.',
    '- Recording/note fields are inventoried only as metadata and marked unsafe for default dashboard sync.',
    '',
    '## RingDNA Objects',
    '',
    markdownTable(objectRows, ['Object', 'Label', 'Queryable', 'Fields', 'Safe Fields']),
    '',
    '## Task Call Coverage Last 365 Days',
    '',
    markdownTable(taskCoverageRows, ['Field', 'Label', 'Type', 'Populated', 'Total', '%']),
    '',
    '## Event RingDNA Coverage Last 365 Days',
    '',
    markdownTable(eventCoverageRows, ['Field', 'Label', 'Type', 'Populated', 'Total', '%']),
    '',
    '## Recommended Prometheus/Zeus Source',
    '',
    '- Primary source: `Task` where `TaskSubtype = \'Call\'`.',
    '- Secondary source: `Event` rows with RingDNA fields populated.',
    '- Optional enrichment: Profile Call custom fields when populated.',
    '- Default exclusions: notes/free text, recording URLs, contact/account names, and customer/shipment-sensitive fields.',
    '',
  ].join('\n')

  fs.writeFileSync(mdPath, md)
  return { jsonPath, mdPath }
}

async function main() {
  await conn.login(process.env.SF_USERNAME, `${process.env.SF_PASSWORD}${process.env.SF_SECURITY_TOKEN}`)

  const [orgQuery, globalDescribe] = await Promise.all([
    safeQuery('org', 'SELECT Id, Name, OrganizationType, IsSandbox FROM Organization LIMIT 1'),
    conn.describeGlobal(),
  ])

  const describeTargets = globalDescribe.sobjects
    .filter((object) => object.queryable && !object.deprecatedAndHidden)
    .map((object) => object.name)

  const describes = await withConcurrency(describeTargets, 8, async (objectName) => {
    try {
      return { ok: true, objectName, describe: await conn.sobject(objectName).describe() }
    } catch (error) {
      return { ok: false, objectName, error: compactError(error) }
    }
  })

  const successfulDescribes = describes.filter((result) => result.ok)
  const ringDnaObjects = successfulDescribes
    .map((result) => {
      const ringDnaFields = result.describe.fields
        .filter(fieldMatchesRingDna)
        .map(fieldSummary)
        .sort((a, b) => a.name.localeCompare(b.name))

      return {
        name: result.describe.name,
        label: result.describe.label,
        labelPlural: result.describe.labelPlural,
        custom: result.describe.custom,
        queryable: result.describe.queryable,
        createable: result.describe.createable,
        updateable: result.describe.updateable,
        searchable: result.describe.searchable,
        fieldCount: result.describe.fields.length,
        ringDnaFields,
      }
    })
    .filter((object) => object.ringDnaFields.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name))

  const taskDescribe = successfulDescribes.find((result) => result.objectName === 'Task')?.describe
  const eventDescribe = successfulDescribes.find((result) => result.objectName === 'Event')?.describe

  if (!taskDescribe || !eventDescribe) {
    throw new Error('Task/Event describe was not available')
  }

  const taskRingDnaFields = taskDescribe.fields.filter(fieldMatchesRingDna)
  const eventRingDnaFields = eventDescribe.fields.filter(fieldMatchesRingDna)

  const taskSafeReportingFields = TASK_SAFE_REPORTING_FIELDS
    .map((name) => taskDescribe.fields.find((field) => field.name === name))
    .filter(Boolean)
    .map(fieldSummary)

  const eventSafeReportingFields = EVENT_SAFE_REPORTING_FIELDS
    .map((name) => eventDescribe.fields.find((field) => field.name === name))
    .filter(Boolean)
    .map(fieldSummary)

  const anyTaskRingDnaWhere = taskRingDnaFields.length > 0
    ? taskRingDnaFields.map((field) => `${field.name} != null`).join(' OR ')
    : 'Id = null'
  const anyEventRingDnaWhere = eventRingDnaFields.length > 0
    ? eventRingDnaFields.map((field) => `${field.name} != null`).join(' OR ')
    : 'Id = null'

  const queries = await Promise.all([
    safeQuery('taskCallLast365Count', "SELECT COUNT() FROM Task WHERE ActivityDate = LAST_N_DAYS:365 AND TaskSubtype = 'Call'"),
    safeQuery('taskAnyRingDnaLast365Count', `SELECT COUNT() FROM Task WHERE ActivityDate = LAST_N_DAYS:365 AND (${anyTaskRingDnaWhere})`),
    safeQuery('taskCallAnyRingDnaLast365Count', `SELECT COUNT() FROM Task WHERE ActivityDate = LAST_N_DAYS:365 AND TaskSubtype = 'Call' AND (${anyTaskRingDnaWhere})`),
    safeQuery('eventAnyRingDnaLast365Count', `SELECT COUNT() FROM Event WHERE ActivityDate = LAST_N_DAYS:365 AND (${anyEventRingDnaWhere})`),
    safeQuery('taskSubtypeLast365', 'SELECT TaskSubtype, COUNT(Id) total FROM Task WHERE ActivityDate = LAST_N_DAYS:365 GROUP BY TaskSubtype ORDER BY COUNT(Id) DESC LIMIT 25'),
    safeQuery('taskCallByDispositionLast365', "SELECT ringdna__Call_Disposition__c, COUNT(Id) total FROM Task WHERE ActivityDate = LAST_N_DAYS:365 AND TaskSubtype = 'Call' GROUP BY ringdna__Call_Disposition__c ORDER BY COUNT(Id) DESC LIMIT 50"),
    safeQuery('taskCallByDirectionLast365', "SELECT ringdna__Call_Direction__c, COUNT(Id) total FROM Task WHERE ActivityDate = LAST_N_DAYS:365 AND TaskSubtype = 'Call' GROUP BY ringdna__Call_Direction__c ORDER BY COUNT(Id) DESC LIMIT 25"),
    safeQuery('taskCallByConnectedLast365', "SELECT ringdna__Call_Connected__c, COUNT(Id) total FROM Task WHERE ActivityDate = LAST_N_DAYS:365 AND TaskSubtype = 'Call' GROUP BY ringdna__Call_Connected__c ORDER BY COUNT(Id) DESC LIMIT 10"),
    safeQuery('taskCallByVoicemailLast365', "SELECT ringdna__Voicemail__c, COUNT(Id) total FROM Task WHERE ActivityDate = LAST_N_DAYS:365 AND TaskSubtype = 'Call' GROUP BY ringdna__Voicemail__c ORDER BY COUNT(Id) DESC LIMIT 10"),
    safeQuery('taskCallByOwnerLast90', "SELECT OwnerId, COUNT(Id) total FROM Task WHERE ActivityDate = LAST_N_DAYS:90 AND TaskSubtype = 'Call' GROUP BY OwnerId ORDER BY COUNT(Id) DESC LIMIT 25"),
    safeQuery('eventRingDnaByOwnerLast90', `SELECT OwnerId, COUNT(Id) total FROM Event WHERE ActivityDate = LAST_N_DAYS:90 AND (${anyEventRingDnaWhere}) GROUP BY OwnerId ORDER BY COUNT(Id) DESC LIMIT 25`),
  ])

  const taskCallByOwner = queries.find((query) => query.name === 'taskCallByOwnerLast90')
  const eventRingDnaByOwner = queries.find((query) => query.name === 'eventRingDnaByOwnerLast90')
  const ownerLookup = [
    ...(await ownerLookupFromAggregate(taskCallByOwner)),
    ...(await ownerLookupFromAggregate(eventRingDnaByOwner)),
  ].filter((owner, index, owners) => owners.findIndex((candidate) => candidate.Id === owner.Id) === index)

  const callActivityCoverage = {
    taskCallLast365: await fieldCoverage(
      'Task',
      taskSafeReportingFields.filter((field) => !['Id'].includes(field.name)),
      "ActivityDate = LAST_N_DAYS:365 AND TaskSubtype = 'Call'"
    ),
    eventRingDnaLast365: await fieldCoverage(
      'Event',
      eventSafeReportingFields.filter((field) => !['Id'].includes(field.name)),
      `ActivityDate = LAST_N_DAYS:365 AND (${anyEventRingDnaWhere})`
    ),
  }

  const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    source: 'Salesforce API via local environment variables',
    safety: {
      readOnly: true,
      mutationsAttempted: false,
      recordSamplesFetched: false,
      excludedByDefault: [...EXCLUDED_BY_DEFAULT],
      note: 'Record data discovery used aggregate counts only. Metadata includes field names/labels/picklists.',
    },
    orgSummary: orgQuery.ok ? orgQuery.records[0] : null,
    describeStats: {
      totalGlobalObjects: globalDescribe.sobjects.length,
      describedObjects: successfulDescribes.length,
      describeErrors: describes.filter((result) => !result.ok),
    },
    ringDnaObjects,
    callActivityObjects: {
      Task: {
        label: taskDescribe.label,
        ringDnaFields: taskRingDnaFields.map(fieldSummary),
        safeReportingFields: taskSafeReportingFields,
      },
      Event: {
        label: eventDescribe.label,
        ringDnaFields: eventRingDnaFields.map(fieldSummary),
        safeReportingFields: eventSafeReportingFields,
      },
    },
    queries,
    ownerLookup,
    taskCallMonthlyBuckets: await taskCallMonthlyBuckets(),
    callActivityCoverage,
    recommendations: {
      primarySource: "Task WHERE TaskSubtype = 'Call'",
      secondarySource: 'Event rows where RingDNA fields are populated',
      optionalEnrichment: 'Profile_Call_* fields when present/populated',
      defaultExclusions: [...EXCLUDED_BY_DEFAULT],
    },
  }

  const files = writeReports(report)
  console.log(JSON.stringify({
    ok: true,
    generatedAt: report.generatedAt,
    orgSummary: report.orgSummary,
    ringDnaObjectCount: ringDnaObjects.length,
    taskRingDnaFieldCount: taskRingDnaFields.length,
    eventRingDnaFieldCount: eventRingDnaFields.length,
    keyQueries: queries,
    output: files,
  }, null, 2))
}

try {
  await main()
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    source: 'Salesforce API via local environment variables',
    error: compactError(error),
  }, null, 2))
  process.exit(1)
} finally {
  await conn.logout().catch(() => {})
}
