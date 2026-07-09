import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { emptyImportCounters } from './importer'
import type {
  HerculesImportJobCounters,
  HerculesIngestionCheckpoint,
  HerculesIngestionReject,
  HerculesIngestionRepository,
  HerculesIngestionResource,
  HerculesIngestionRunRecord,
  HerculesIngestionRunStatus,
  HerculesIngestionRunType,
  JsonObject,
} from './types'

type DbRow = Record<string, unknown>

function assertNoError(error: unknown) {
  if (error) {
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : 'Unknown Supabase error'
    throw new Error(message)
  }
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toNumberOrNull(value: unknown) {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toCounters(value: unknown): HerculesImportJobCounters {
  const base = emptyImportCounters()
  if (typeof value !== 'object' || value === null) return base
  const raw = value as Record<string, unknown>
  for (const key of Object.keys(base) as (keyof HerculesImportJobCounters)[]) {
    base[key] = toNumber(raw[key], 0)
  }
  return base
}

function toRun(row: DbRow): HerculesIngestionRunRecord {
  return {
    id: String(row.id),
    resource: row.resource as HerculesIngestionResource,
    runType: row.run_type as HerculesIngestionRunType,
    status: row.status as HerculesIngestionRunStatus,
    pageSize: toNumber(row.page_size, 500),
    nextOffset: toNumber(row.next_offset, 0),
    pagesFetched: toNumber(row.pages_fetched, 0),
    totalRemote: toNumberOrNull(row.total_remote),
    itemsSeen: toNumber(row.items_seen, 0),
    itemsInserted: toNumber(row.items_inserted, 0),
    itemsUpdated: toNumber(row.items_updated, 0),
    itemsRejected: toNumber(row.items_rejected, 0),
    counters: toCounters(row.counters_json),
    updatedSince: (row.updated_since as string | null) ?? null,
    maxSourceUpdatedAt: (row.max_source_updated_at as string | null) ?? null,
    importJobId: (row.import_job_id as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    rateLimitSnapshot: (row.rate_limit_snapshot as JsonObject | null) ?? null,
    triggeredBy: (row.triggered_by as string | null) ?? null,
    startedAt: String(row.started_at),
    completedAt: (row.completed_at as string | null) ?? null,
  }
}

export class SupabaseHerculesIngestionRepository implements HerculesIngestionRepository {
  private readonly supabase = createAdminClient()

  async createRun(input: {
    resource: HerculesIngestionResource
    runType: HerculesIngestionRunType
    pageSize: number
    updatedSince: string | null
    importJobId: string | null
    triggeredBy: string | null
  }) {
    const { data, error } = await this.supabase
      .from('hercules_ingestion_runs')
      .insert({
        resource: input.resource,
        run_type: input.runType,
        page_size: input.pageSize,
        updated_since: input.updatedSince,
        import_job_id: input.importJobId,
        triggered_by: input.triggeredBy,
        status: 'running',
        counters_json: emptyImportCounters(),
      })
      .select('*')
      .single()

    assertNoError(error)
    return toRun(data as DbRow)
  }

  async getRun(id: string) {
    const { data, error } = await this.supabase
      .from('hercules_ingestion_runs')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    assertNoError(error)
    return data ? toRun(data as DbRow) : null
  }

  async getActiveRun(resource: HerculesIngestionResource) {
    const { data, error } = await this.supabase
      .from('hercules_ingestion_runs')
      .select('*')
      .eq('resource', resource)
      .eq('status', 'running')
      .maybeSingle()

    assertNoError(error)
    return data ? toRun(data as DbRow) : null
  }

  async checkpointRun(id: string, checkpoint: HerculesIngestionCheckpoint) {
    const now = new Date().toISOString()
    const { error } = await this.supabase
      .from('hercules_ingestion_runs')
      .update({
        next_offset: checkpoint.nextOffset,
        pages_fetched: checkpoint.pagesFetched,
        total_remote: checkpoint.totalRemote,
        items_seen: checkpoint.counters.rowsSeen,
        items_inserted: checkpoint.counters.rowsInserted,
        items_updated: checkpoint.counters.rowsUpdated,
        items_rejected: checkpoint.counters.rowsRejected,
        counters_json: checkpoint.counters,
        max_source_updated_at: checkpoint.maxSourceUpdatedAt,
        rate_limit_snapshot: checkpoint.rateLimitSnapshot,
        last_activity_at: now,
        updated_at: now,
      })
      .eq('id', id)

    assertNoError(error)
  }

  async completeRun(
    id: string,
    input: {
      status: Exclude<HerculesIngestionRunStatus, 'running'>
      lastError?: string | null
    }
  ) {
    const now = new Date().toISOString()
    const { error } = await this.supabase
      .from('hercules_ingestion_runs')
      .update({
        status: input.status,
        last_error: input.lastError ?? null,
        completed_at: now,
        last_activity_at: now,
        updated_at: now,
      })
      .eq('id', id)

    assertNoError(error)
  }

  async recordReject(reject: HerculesIngestionReject) {
    const { error } = await this.supabase.from('hercules_ingestion_rejects').insert({
      run_id: reject.runId,
      page_offset: reject.pageOffset,
      record_index: reject.recordIndex,
      hercules_item_id: reject.herculesItemId,
      error_message: reject.errorMessage,
      raw_payload: reject.rawPayload,
    })

    assertNoError(error)
  }

  async getSyncWatermark(resource: HerculesIngestionResource) {
    const { data, error } = await this.supabase
      .from('hercules_sync_state')
      .select('last_sync_watermark')
      .eq('resource', resource)
      .maybeSingle()

    assertNoError(error)
    return (data?.last_sync_watermark as string | null) ?? null
  }

  async setSyncWatermark(
    resource: HerculesIngestionResource,
    watermark: string,
    lastCompletedRunId: string
  ) {
    const { error } = await this.supabase.from('hercules_sync_state').upsert(
      {
        resource,
        last_sync_watermark: watermark,
        last_completed_run_id: lastCompletedRunId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'resource' }
    )

    assertNoError(error)
  }

  async listRecentRuns(limit = 10): Promise<HerculesIngestionRunRecord[]> {
    const { data, error } = await this.supabase
      .from('hercules_ingestion_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit)

    assertNoError(error)
    return ((data ?? []) as DbRow[]).map(toRun)
  }
}
