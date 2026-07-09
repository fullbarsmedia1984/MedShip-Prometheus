/**
 * Query-side synonym expansion for catalog search.
 *
 * Hercules descriptions mix full words and terse supplier abbreviations
 * ("GLOVE, EXAM NITRL 2XLG"). Expanding known pairs in BOTH directions
 * lets a rep typing "nitrile exam" hit "NITRL EXM" rows and vice versa.
 * The expanded string feeds only the full-text branch (websearch OR
 * syntax); part-number matching always uses the raw query.
 *
 * Curated from observed catalog text + zero-result search logs
 * (hercules_search_log). Keep entries unambiguous — a bad synonym is
 * worse than a missing one.
 */

const SYNONYM_GROUPS: string[][] = [
  ['nitrile', 'nitrl'],
  ['exam', 'exm'],
  ['glove', 'glv'],
  ['gloves', 'glvs'],
  ['sterile', 'strl'],
  ['surgical', 'surg'],
  ['latex', 'ltx'],
  ['powder', 'pwdr'],
  ['medium', 'med'],
  ['large', 'lg'],
  ['small', 'sm'],
  ['syringe', 'syr'],
  ['catheter', 'cath'],
  ['wheelchair', 'whlchr'],
  ['stainless', 'ss'],
  ['disposable', 'disp'],
]

const EXPANSIONS = new Map<string, string[]>()
for (const group of SYNONYM_GROUPS) {
  for (const term of group) {
    EXPANSIONS.set(
      term,
      group.filter((other) => other !== term)
    )
  }
}

/**
 * Returns a websearch-syntax expansion of the query, or null when no
 * expansion applies (caller then passes the raw query through).
 * Queries using explicit operators (quotes, minus) are left untouched —
 * the user is being precise.
 */
export function expandSearchQuery(q: string): string | null {
  const trimmed = q.trim()
  if (!trimmed || /["\-]/.test(trimmed)) return null

  let changed = false
  const expanded = trimmed
    .split(/\s+/)
    .map((token) => {
      const synonyms = EXPANSIONS.get(token.toLowerCase())
      if (!synonyms || synonyms.length === 0) return token
      changed = true
      return `(${[token, ...synonyms].join(' OR ')})`
    })
    .join(' ')

  return changed ? expanded : null
}
