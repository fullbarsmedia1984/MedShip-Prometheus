import { NextResponse } from 'next/server'
import { STAFF_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { csvEscape, parseContactListParams } from '@/lib/tam/api'
import { listTamContacts, type TamMailingContactRow } from '@/lib/tam/supabase'

export const dynamic = 'force-dynamic'

const HEADERS = [
  'institution',
  'attn_dept',
  'contact_name',
  'contact_title',
  'contact_role',
  'mail_street',
  'mail_suite',
  'mail_city',
  'mail_state',
  'mail_zip',
  'email',
  'phone',
]

function contactToCsvRow(contact: TamMailingContactRow) {
  return [
    contact.institution.name,
    contact.institution.nursing_dept_name,
    contact.name,
    contact.title,
    contact.role_category,
    contact.institution.mail_street,
    contact.institution.mail_suite,
    contact.institution.mail_city,
    contact.institution.mail_state,
    contact.institution.mail_zip,
    contact.email,
    contact.phone,
  ]
    .map(csvEscape)
    .join(',')
}

export async function GET(request: Request) {
  try {
    const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const params = parseContactListParams(new URL(request.url).searchParams)
    const rows: TamMailingContactRow[] = []
    let page = 1
    let totalItems = 0

    do {
      const payload = await listTamContacts({
        ...params,
        page,
        pageSize: 250,
      })
      rows.push(...payload.data)
      totalItems = payload.totalItems
      page += 1
    } while (rows.length < totalItems)

    const csv = [HEADERS.join(','), ...rows.map(contactToCsvRow)].join('\r\n')

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="tam-mailing-contacts.csv"',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
