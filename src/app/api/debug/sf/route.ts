// TODO: Remove before production deploy
import { NextRequest, NextResponse } from 'next/server'
import { createSalesforceClient } from '@/lib/salesforce/client'

const VALID_QUERIES = ['org', 'opportunities', 'products', 'users', 'tasks'] as const
type QueryType = (typeof VALID_QUERIES)[number]

function json(body: object, status = 200) {
  return NextResponse.json(body, { status })
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return json({ error: 'Debug endpoints are disabled in production' }, 403)
  }

  const q = request.nextUrl.searchParams.get('q') as QueryType | null

  if (!q || !VALID_QUERIES.includes(q)) {
    return json(
      { error: `Invalid query. Use ?q= with one of: ${VALID_QUERIES.join(', ')}` },
      400
    )
  }

  const client = createSalesforceClient()

  try {
    await client.connect()
    const conn = client.getConnection()
    const start = Date.now()

    const data = await runQuery(conn, q)

    return json({
      query: q,
      count: data.length,
      executionMs: Date.now() - start,
      data,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'

    if (message.includes('INVALID_FIELD') || message.includes('No such column')) {
      const fields = extractMissingFields(message)
      return json(
        {
          error: 'One or more custom fields do not exist in Salesforce',
          missingFields: fields,
          help: 'Create these fields in Salesforce Setup → Object Manager → [Object] → Fields & Relationships → New',
        },
        422
      )
    }

    return json({ error: message }, 500)
  } finally {
    await client.disconnect()
  }
}

async function runQuery(conn: ReturnType<typeof createSalesforceClient>['getConnection'] extends () => infer R ? R : never, q: QueryType) {
  switch (q) {
    case 'org': {
      const result = await conn.query<Record<string, unknown>>(
        'SELECT Id, Name, OrganizationType, IsSandbox, DefaultLocaleSidKey, LanguageLocaleKey FROM Organization LIMIT 1'
      )
      return result.records
    }

    case 'opportunities': {
      const result = await conn.query<Record<string, unknown>>(`
        SELECT Id, Name, StageName, Amount, CloseDate, AccountId, Account.Name,
               Fishbowl_SO_Number__c, Fulfillment_Status__c, Fulfillment_Error__c, Last_Sync_Attempt__c,
               (SELECT Id, Product2Id, Product2.Name, Product2.ProductCode, Quantity, UnitPrice, TotalPrice
                FROM OpportunityLineItems)
        FROM Opportunity
        WHERE StageName = 'Closed Won'
        ORDER BY CloseDate DESC
        LIMIT 20
      `)
      return result.records
    }

    case 'products': {
      const result = await conn.query<Record<string, unknown>>(`
        SELECT Id, Name, ProductCode, IsActive, Family,
               Qty_On_Hand__c, Qty_Available__c, Last_Inventory_Sync__c
        FROM Product2
        ORDER BY LastModifiedDate DESC
        LIMIT 50
      `)
      return result.records
    }

    case 'users': {
      const result = await conn.query<Record<string, unknown>>(`
        SELECT Id, Name, Email, Username
        FROM User
        WHERE IsActive = true AND UserType = 'Standard'
        ORDER BY Name ASC
      `)
      return result.records
    }

    case 'tasks': {
      const result = await conn.query<Record<string, unknown>>(`
        SELECT Id, Subject, ActivityDate, Status, OwnerId, Owner.Name,
               AccountId, Account.Name, WhoId, Who.Name,
               Call_Outcome__c, Call_Duration_Minutes__c, Call_Notes__c,
               Next_Steps__c, Samples_Left__c, Products_Discussed__c
        FROM Task
        WHERE RecordType.DeveloperName = 'Profile_Call'
        ORDER BY ActivityDate DESC
        LIMIT 20
      `)
      return result.records
    }
  }
}

function extractMissingFields(errorMessage: string): string[] {
  // Salesforce INVALID_FIELD errors typically list field names
  const fieldPattern = /No such column '(\w+)' on/g
  const fields: string[] = []
  let match: RegExpExecArray | null
  while ((match = fieldPattern.exec(errorMessage)) !== null) {
    fields.push(match[1])
  }

  // Fallback: extract anything that looks like a custom field
  if (fields.length === 0) {
    const customFieldPattern = /\b(\w+__c)\b/g
    while ((match = customFieldPattern.exec(errorMessage)) !== null) {
      if (!fields.includes(match[1])) {
        fields.push(match[1])
      }
    }
  }

  return fields.length > 0 ? fields : ['Could not parse field names from error — check the error message above']
}
