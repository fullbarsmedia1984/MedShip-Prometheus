import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Fishbowl salesperson aliases belonging to a user, resolved through their
 * profile. Fishbowl user id is the canonical rep identity (decision 2);
 * sf_user_id is the transitional fallback until Fishbowl ids are populated.
 * Returns [] when the user has no rep linkage — a rep with no aliases sees
 * no orders, which is the correct fail-closed default.
 */
export async function getRepAliases(userId: string): Promise<string[]> {
  const supabase = createAdminClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('fishbowl_user_id, sf_user_id')
    .eq('id', userId)
    .maybeSingle()

  if (!profile?.fishbowl_user_id && !profile?.sf_user_id) return []

  let query = supabase
    .from('fishbowl_salesperson_aliases')
    .select('fishbowl_salesperson, fishbowl_user_id, sf_user_id')

  if (profile.fishbowl_user_id && profile.sf_user_id) {
    query = query.or(
      `fishbowl_user_id.eq.${profile.fishbowl_user_id},sf_user_id.eq.${profile.sf_user_id}`
    )
  } else if (profile.fishbowl_user_id) {
    query = query.eq('fishbowl_user_id', profile.fishbowl_user_id)
  } else {
    query = query.eq('sf_user_id', profile.sf_user_id)
  }

  const { data } = await query
  return (data ?? []).map((row) => row.fishbowl_salesperson)
}
