import { NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth'
import { csvEscape, parseInstitutionListParams } from '@/lib/tam/api'
import { listTamInstitutions, type TamInstitutionListRow } from '@/lib/tam/supabase'

export const dynamic = 'force-dynamic'

const HEADERS = [
  'institution_id',
  'unitid',
  'institution',
  'city',
  'state',
  'control',
  'program_tiers',
  'estimated_enrollment',
  'contact_names',
  'contact_roles',
  'contact_emails',
]

export async function GET(request: Request) {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    const params = parseInstitutionListParams(new URL(request.url).searchParams)
    const rows: TamInstitutionListRow[] = []
    let page = 1
    let totalItems = 0

    do {
      const payload = await listTamInstitutions({
        ...params,
        page,
        pageSize: 250,
      })
      rows.push(...payload.data)
      totalItems = payload.totalItems
      page += 1
    } while (rows.length < totalItems)

    const csv = [
      HEADERS.join(','),
      ...rows.map((row) =>
        [
          row.id,
          row.unitid,
          row.name,
          row.city,
          row.state,
          row.control,
          row.programs.map((program) => program.tier).join('; '),
          row.programs
            .reduce(
              (sum, program) => sum + (program.est_annual_enrollment ?? 0),
              0
            )
            .toString(),
          row.contacts.map((contact) => contact.name).join('; '),
          row.contacts.map((contact) => contact.role_category).join('; '),
          row.contacts.map((contact) => contact.email).filter(Boolean).join('; '),
        ]
          .map(csvEscape)
          .join(',')
      ),
    ].join('\r\n')

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="tam-institutions.csv"',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
