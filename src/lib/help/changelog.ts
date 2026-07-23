/**
 * Deployment changelog shown to users as a "What's new" popup.
 *
 * Entries ship with the code: every PR that changes a page or workflow adds
 * an entry here (newest first, stable unique ids). Per-user seen state lives
 * in localStorage, so each user sees a popup once per new entry.
 */

export type ChangelogEntry = {
  /** Stable unique id — never reuse or rename once shipped. */
  id: string
  /** ISO date of the deploy. */
  date: string
  title: string
  summary: string
  details?: string[]
  /** Pages/workflows this change touches, with links. */
  areas: Array<{ label: string; href: string }>
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: '2026-07-23-contract-price-manager',
    date: '2026-07-23',
    title: 'Manage contract pricing directly in a table',
    summary:
      'New Contract Price Manager: open any supplier contract and work with its cost lines directly — add a negotiated price, correct a line, or expire one. Excel files are now only a one-time on-ramp per supplier.',
    details: [
      'Find it on the Pricing page: the Contract Price Manager card is now live.',
      'Edits never overwrite history — a correction creates a new version and keeps the old one.',
      'Expiring a line keeps it in history; it just stops being the active cost.',
      'Every change is recorded with who made it and when.',
    ],
    areas: [{ label: 'Contract Price Manager', href: '/dashboard/pricing/contracts' }],
  },
  {
    id: '2026-07-16-match-review-side-by-side',
    date: '2026-07-16',
    title: 'Clearer item match review',
    summary:
      'Match suggestions now show your spreadsheet line and the suggested catalog item side by side — full descriptions, both part numbers, and the manufacturer — so you can compare them directly instead of reading a cut-off sentence.',
    details: [
      'Compare the two part numbers first; the suggestion exists because they match exactly.',
      'Approve when the part numbers agree and the descriptions are clearly the same kind of product.',
      'Not sure? Leave it open — unmatched lines never block publishing.',
    ],
    areas: [{ label: 'Supplier Cost Imports', href: '/dashboard/pricing/imports' }],
  },
  {
    id: '2026-07-15-guides-and-changelog',
    date: '2026-07-15',
    title: 'In-app page guides and update notices',
    summary:
      'Every pricing page now has a question-mark button in the header with a step-by-step guide, and this popup will let you know whenever a page or workflow changes.',
    details: [
      'Click the ? icon in the top bar for instructions specific to the page you are on.',
      'The "What’s new" popup appears once per update — reopen it any time from a page guide.',
    ],
    areas: [{ label: 'Pricing', href: '/dashboard/pricing' }],
  },
  {
    id: '2026-07-15-native-workbook-upload',
    date: '2026-07-15',
    title: 'Upload pricing workbooks directly in Zeus',
    summary:
      'Distributor price lists no longer need any offline tooling. Upload the Excel file, confirm the suggested column mapping, dry-run, and stage it for review — all in the browser.',
    details: [
      'New Upload Workbook button on the Supplier Cost Imports page.',
      'Contract number and effective date are captured at upload and required before staging.',
      'The system suggests column mappings automatically; a person confirms every field.',
      'Dry runs show valid / warning / blocking counts before anything is staged.',
    ],
    areas: [
      { label: 'Supplier Cost Imports', href: '/dashboard/pricing/imports' },
      { label: 'Upload Workbook', href: '/dashboard/pricing/imports/upload' },
    ],
  },
  {
    id: '2026-07-15-item-matching',
    date: '2026-07-15',
    title: 'Item matching for supplier cost lines',
    summary:
      'Imported cost lines can now be linked to catalog items. The system suggests exact matches (GTIN, SKU, part number, model); you approve or reject each one.',
    details: [
      'New Item Matching card on every import batch page.',
      'Suggestions are deterministic — nothing links without your approval.',
      'Unmatched lines are allowed and never block publishing.',
    ],
    areas: [{ label: 'Supplier Cost Imports', href: '/dashboard/pricing/imports' }],
  },
  {
    id: '2026-07-15-final-publish-rollback',
    date: '2026-07-15',
    title: 'Final publish and rollback for supplier costs',
    summary:
      'Approved import batches can now be published: their cost lines become the active negotiated costs in Zeus, replacing prior versions. Every publish requires typed confirmation and can be rolled back.',
    details: [
      'Publish is only available after approval and cost preparation, and asks you to type PUBLISH.',
      'Roll Back restores exactly what a publish replaced.',
      'Customer sell pricing is never touched — these are supplier costs only.',
    ],
    areas: [{ label: 'Supplier Cost Imports', href: '/dashboard/pricing/imports' }],
  },
]

const STORAGE_KEY = 'ms-changelog-seen-v1'

export function getSeenChangelogIds(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.map(String) : [])
  } catch {
    return new Set()
  }
}

export function getUnseenChangelogEntries(): ChangelogEntry[] {
  const seen = getSeenChangelogIds()
  return CHANGELOG.filter((entry) => !seen.has(entry.id))
}

export function markChangelogSeen(ids: string[]): void {
  if (typeof window === 'undefined') return
  try {
    const seen = getSeenChangelogIds()
    for (const id of ids) seen.add(id)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]))
  } catch {
    /* private-mode storage failures are non-fatal */
  }
}

/** Custom event name used to reopen the changelog from anywhere in the app. */
export const OPEN_CHANGELOG_EVENT = 'ms-open-changelog'
