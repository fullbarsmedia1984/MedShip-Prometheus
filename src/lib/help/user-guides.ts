/**
 * Per-page user guides, shown from the question-mark button in the header.
 * Guides are matched by route pattern; pages without a guide hide the button.
 * Keep copy plain-English and task-oriented — these double as the operating
 * instructions for non-technical staff.
 */

export type GuideSection = {
  heading: string
  text?: string
  steps?: string[]
}

export type PageGuide = {
  title: string
  intro: string
  sections: GuideSection[]
}

type GuideRoute = {
  pattern: RegExp
  guide: PageGuide
}

const UUID = '[0-9a-fA-F-]{36}'

const PRICING_LANDING: PageGuide = {
  title: 'Pricing workspace',
  intro:
    'This page shows pricing readiness (how trustworthy our pricing data is) and links to the live pricing modules.',
  sections: [
    {
      heading: 'What the gates mean',
      text: 'Each readiness gate tracks one data foundation (product identity, contract costs, COGS, quote lines). Gates must pass before Zeus enforces pricing rules anywhere. Nothing on this page changes data — it is read-only.',
    },
    {
      heading: 'Where to work',
      steps: [
        'Supplier Cost Imports (Live) — import distributor price lists and publish negotiated costs.',
        'Supplier Cost Exceptions (Live) — work the review queue for imported rows that need attention.',
        'Cards marked Coming Soon are planned modules and are not clickable yet.',
      ],
    },
  ],
}

const IMPORTS_LIST: PageGuide = {
  title: 'Supplier Cost Imports',
  intro:
    'Each row is one imported distributor price list (a batch). Batches move through: staged → approved → publishing → published. This is buy-side supplier cost data — customer prices are never touched here.',
  sections: [
    {
      heading: 'Import a new price list',
      steps: [
        'Click Upload Workbook (top right).',
        'Fill in the distributor, contract number, and effective date — these are required.',
        'Follow the mapping and dry-run steps on the next screen, then stage the batch.',
      ],
    },
    {
      heading: 'Work an existing batch',
      steps: [
        'Click a batch row to open it.',
        'Review rows and exceptions, approve, prepare costs, then publish (typed confirmation).',
      ],
    },
  ],
}

const UPLOAD_FORM: PageGuide = {
  title: 'Upload a pricing workbook',
  intro:
    'Upload the distributor’s Excel price list exactly as they sent it. The file is stored privately and analyzed automatically.',
  sections: [
    {
      heading: 'Before you upload',
      steps: [
        'Have the contract number and effective date ready — rows cannot stage without them.',
        'Use the original .xlsx file from the distributor. Do not edit or reformat it first.',
      ],
    },
    {
      heading: 'After you click Upload and Analyze',
      text: 'You will land on the workbook page, where the system shows what it found in the file and suggests how columns map to our pricing fields. You confirm the mapping there.',
    },
  ],
}

const UPLOAD_DETAIL: PageGuide = {
  title: 'Map, dry-run, and stage a workbook',
  intro:
    'This page turns an uploaded price list into a review batch. Three steps: confirm the column mapping, run a dry run, and stage.',
  sections: [
    {
      heading: '1 — Confirm the column mapping',
      steps: [
        'Pick the sheet that holds the pricing table. Zeus pre-selects the sheet that looks most like a price list — if you see "No pricing columns were detected", the selected sheet is probably terms or notes; switch sheets and the suggestions refill automatically.',
        'Check the header row number matches the row with column titles.',
        'For each field, confirm the suggested column or pick the right one. Price is required; map every identifier column the file has (item #, part #, model, UPC).',
        'If the file has no UOM column, type a default (for example EA) in the Default price UOM box.',
        'Click Save Profile. The mapping is saved and reusable for this distributor’s future files.',
      ],
    },
    {
      heading: '2 — Run the dry run',
      steps: [
        'Select your saved profile and click Run Dry Run.',
        'Check the counts: Valid rows will import; Warnings import but get flagged for review; Blocking rows stop staging.',
        'If there are blocking reasons, the list tells you why — usually a mis-mapped column. Fix the mapping, save again (a new version is created), and re-run.',
      ],
    },
    {
      heading: '3 — Stage the batch',
      text: 'When the dry run is clean, click Stage Batch. This creates a review batch — nothing is published or activated by staging. Use the link that appears to open the batch and continue with review and publish.',
    },
  ],
}

const BATCH_DETAIL: PageGuide = {
  title: 'Review and publish an import batch',
  intro:
    'This page is the control room for one imported price list: review its rows, resolve exceptions, link items, and publish the costs. Everything is logged, and publishing is reversible.',
  sections: [
    {
      heading: 'Review and approve',
      steps: [
        'Check the row counts and the staged row table. Work any open exceptions with Ack / Waive / Resolve.',
        'Click Approve once there are no blocking rows and no open exceptions.',
      ],
    },
    {
      heading: 'Item matching (any time)',
      steps: [
        'In the Item Matching card, click Generate Suggestions.',
        'Each suggestion shows your spreadsheet line on the left and the suggested catalog item on the right.',
        'Compare the two part numbers first — a suggestion only appears because they match exactly. The descriptions are just a sanity check; they come from different systems and will not read word-for-word the same.',
        'Approve when the part numbers agree and both descriptions are clearly the same kind of product from the same manufacturer. Reject only when the descriptions clearly disagree (a different kind of product).',
        'Not sure? Leave it open and move on. Unmatched lines are fine — they never block publishing.',
      ],
    },
    {
      heading: 'Publish (makes costs official)',
      steps: [
        'Click Prepare Costs, then check the Publish Preview numbers.',
        'Click Publish, read the impact summary, type PUBLISH, and confirm.',
        'The batch status changes to published — these are now the active negotiated costs in Zeus.',
      ],
    },
    {
      heading: 'If something is wrong after publishing',
      text: 'Click Roll Back and type ROLLBACK. Everything the publish changed is restored, and you can publish again later. Customer sell pricing is never affected by anything on this page.',
    },
  ],
}

const EXCEPTIONS_QUEUE: PageGuide = {
  title: 'Supplier cost exception queue',
  intro:
    'Batches with warning or blocking rows appear here so nothing needing review is missed.',
  sections: [
    {
      heading: 'How to work the queue',
      steps: [
        'Open a batch to see its exceptions with row-level detail.',
        'Acknowledge, waive, or resolve each one — notes are recorded for the audit trail.',
        'Blocking exceptions must be cleared before the batch can be approved.',
      ],
    },
  ],
}

const CONTRACTS_LIST: PageGuide = {
  title: 'Contract Price Manager',
  intro:
    'This is the system of record for negotiated supplier costs. Each row is one supplier contract; open it to work with its cost lines directly — no spreadsheet needed.',
  sections: [
    {
      heading: 'Day to day',
      steps: [
        'Open a contract to view its active cost lines in a table.',
        'Add a line when you negotiate a price outside a formal price list (e.g., by phone or email).',
        'Edit a line to correct a cost, UOM, or date — the old version is kept automatically.',
        'Expire a line when an item is discontinued or the negotiated price ends.',
      ],
    },
    {
      heading: 'Where contracts come from',
      text: 'Contracts are created automatically the first time a distributor price list is imported and prepared for publish. Excel files are a one-time on-ramp per supplier — after that, this table is where pricing lives.',
    },
    {
      heading: 'Search and expiration warnings',
      steps: [
        'Use the search box to find a contract by supplier name or contract number.',
        'An "Expires in Nd" badge appears when a contract is within 60 days of its expiration date; "Expired" means the date has passed — start the renewal conversation with the supplier.',
        'The "Expiring / Expired" counter at the top shows how many contracts need renewal attention.',
      ],
    },
  ],
}

const CONTRACT_DETAIL: PageGuide = {
  title: 'Contract cost lines',
  intro:
    'The table shows this contract’s negotiated costs. Active is what Zeus answers with today; Superseded and other filters show history. Every change here is versioned and audited — nothing is ever silently overwritten.',
  sections: [
    {
      heading: 'Add a cost line',
      steps: [
        'Click Add Line.',
        'Enter at least one identifier (SKU, part number, model, or GTIN), the cost, and the price UOM (usually EA).',
        'Set the effective date (defaults to today). Click Add Cost Line — it becomes active immediately, recorded under your name.',
      ],
    },
    {
      heading: 'Correct a cost line',
      steps: [
        'Click Edit on the line, change what is wrong, and click Save New Version.',
        'The corrected line becomes active and the old one moves to Superseded history — you can always see what the cost used to be.',
      ],
    },
    {
      heading: 'Expire a cost line',
      steps: [
        'Click Expire, then Confirm Expire. The line stops being an active cost but stays in history.',
        'Use this when an item is discontinued or a negotiated price ends without a replacement.',
      ],
    },
    {
      heading: 'Reading the table',
      steps: [
        'Source shows where a cost came from: an imported workbook (file and row) or a manual entry.',
        'Item Link shows whether the line is matched to an internal item or a Hercules catalog item — matching happens on the import batch page.',
        'A "Lapsed" badge on the expiration date means the negotiated window has passed — Zeus no longer answers with that cost even though the line still shows as active. Renew the price or expire the line.',
        'Use the search box to find lines by identifier, description, or manufacturer.',
      ],
    },
  ],
}

const ASKZEUS_GUIDE: PageGuide = {
  title: 'AskZeus',
  intro:
    'AskZeus is a chat assistant that answers questions about orders, customers, revenue, inventory, and warehouse operations using live Zeus data.',
  sections: [
    {
      heading: 'How to ask',
      steps: [
        'Type a question in plain English — for example "How is revenue this month vs last year?" or "Which items are low on stock?"',
        'Watch the activity chips: they show exactly which data AskZeus is looking up before it answers.',
        'Follow up in the same chat — AskZeus remembers the conversation.',
      ],
    },
    {
      heading: 'What it can see',
      text: 'AskZeus only sees data your role allows. Sales reps see their own orders, customers, and quotes; warehouse sees inventory and fulfillment; staff and admins see company-wide metrics. If it says data is outside your role, that is by design.',
    },
    {
      heading: 'Trust but verify',
      text: 'Every number comes from a live lookup, never from memory, but AskZeus can still misread a question. For decisions that matter, confirm the figure on the relevant dashboard page.',
    },
    {
      heading: 'Conversation history',
      steps: [
        'Your chats are saved automatically — reopen them from the list on the left.',
        'Click New chat to start fresh; hover a conversation to delete it.',
      ],
    },
    {
      heading: 'Help it improve',
      steps: [
        'Rate answers with the thumbs under each reply — especially the bad ones. A short note on what was wrong makes the feedback far more useful.',
        'Admins can teach AskZeus standing facts (business rules, vocabulary) via "Teach AskZeus" in the left panel — changes apply to the very next question.',
      ],
    },
  ],
}

const GUIDE_ROUTES: GuideRoute[] = [
  { pattern: new RegExp(`^/dashboard/pricing/contracts/${UUID}$`), guide: CONTRACT_DETAIL },
  { pattern: /^\/dashboard\/pricing\/contracts$/, guide: CONTRACTS_LIST },
  { pattern: /^\/dashboard\/askzeus$/, guide: ASKZEUS_GUIDE },
  { pattern: new RegExp(`^/dashboard/pricing/imports/upload/${UUID}$`), guide: UPLOAD_DETAIL },
  { pattern: /^\/dashboard\/pricing\/imports\/upload$/, guide: UPLOAD_FORM },
  { pattern: new RegExp(`^/dashboard/pricing/imports/${UUID}$`), guide: BATCH_DETAIL },
  { pattern: /^\/dashboard\/pricing\/imports$/, guide: IMPORTS_LIST },
  { pattern: /^\/dashboard\/pricing\/exceptions$/, guide: EXCEPTIONS_QUEUE },
  { pattern: /^\/dashboard\/pricing$/, guide: PRICING_LANDING },
]

export function findGuideForPath(pathname: string): PageGuide | null {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  for (const route of GUIDE_ROUTES) {
    if (route.pattern.test(normalized)) return route.guide
  }
  return null
}
