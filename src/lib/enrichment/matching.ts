import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

const NIL_UUID = '00000000-0000-0000-0000-000000000000'

export type ExactMatchCounts = {
  exact_mpn: number
  exact_gtin: number
  exact_sku_as_mpn: number
  total: number
}

export type FuzzyMatchResult = {
  examined: number
  inserted: number
  /** True when every unlinked competitor product has been examined. */
  done: boolean
}

/**
 * Deterministic identifier matching (MPN / GTIN / SKU-as-MPN) done
 * entirely in SQL. Idempotent; safe to re-run after every crawl.
 */
export async function runExactMatching(): Promise<ExactMatchCounts> {
  const { data, error } = await createAdminClient().rpc('enrichment_match_exact')
  if (error) throw new Error(`enrichment_match_exact failed: ${error.message}`)
  const counts = (data ?? {}) as Partial<ExactMatchCounts>
  return {
    exact_mpn: counts.exact_mpn ?? 0,
    exact_gtin: counts.exact_gtin ?? 0,
    exact_sku_as_mpn: counts.exact_sku_as_mpn ?? 0,
    total: counts.total ?? 0,
  }
}

/**
 * Trigram title matching over competitor products no exact pass
 * linked, walked in keyset batches. Bounded by maxBatches so a
 * finalize step never runs unbounded over the whole set.
 */
export async function runFuzzyMatching(options?: {
  batchSize?: number
  maxBatches?: number
}): Promise<FuzzyMatchResult> {
  // Trigram probes cost ~150-250ms per title against the 748k-item
  // catalog; 15 per RPC call stays safely under the statement timeout.
  const batchSize = options?.batchSize ?? 15
  const maxBatches = options?.maxBatches ?? 20
  const supabase = createAdminClient()

  let cursor = NIL_UUID
  let examined = 0
  let inserted = 0
  let done = false

  for (let i = 0; i < maxBatches; i++) {
    const { data, error } = await supabase.rpc('enrichment_match_fuzzy', {
      p_after: cursor,
      p_limit: batchSize,
    })
    if (error) throw new Error(`enrichment_match_fuzzy failed: ${error.message}`)

    const result = (data ?? {}) as { examined?: number; inserted?: number; last_id?: string | null }
    examined += result.examined ?? 0
    inserted += result.inserted ?? 0

    if (!result.last_id || (result.examined ?? 0) < batchSize) {
      done = true
      break
    }
    cursor = result.last_id
  }

  return { examined, inserted, done }
}
