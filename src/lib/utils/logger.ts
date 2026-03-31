import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

export type SyncStatus = 'pending' | 'running' | 'success' | 'failed' | 'retrying' | 'dismissed'
export type Automation =
  | 'P1_OPP_TO_SO'
  | 'P2_INVENTORY_SYNC'
  | 'P3_QB_INVOICE_SYNC'
  | 'P4_SHIPMENT_TRACKING'
  | 'P5_QUOTE_PDF'
  | 'P6_LOW_STOCK_CHECK'

export type SystemName = 'salesforce' | 'fishbowl' | 'quickbooks' | 'easypost' | 'prometheus'

export interface SyncEvent {
  id?: string
  created_at?: string
  automation: Automation
  source_system: SystemName
  target_system: SystemName
  source_record_id?: string
  target_record_id?: string
  status: SyncStatus
  payload?: Record<string, unknown>
  response?: Record<string, unknown>
  error_message?: string
  retry_count?: number
  max_retries?: number
  next_retry_at?: string
  completed_at?: string
  idempotency_key?: string
}

/**
 * Structured logger that writes to sync_events table
 */
class Logger {
  private _supabase: SupabaseClient | null = null

  // Lazy initialization to prevent build-time errors
  private get supabase(): SupabaseClient {
    if (!this._supabase) {
      this._supabase = createAdminClient()
    }
    return this._supabase
  }

  /**
   * Create a new sync event log entry
   */
  async createEvent(event: Omit<SyncEvent, 'id' | 'created_at'>): Promise<string> {
    const { data, error } = await this.supabase
      .from('sync_events')
      .insert({
        automation: event.automation,
        source_system: event.source_system,
        target_system: event.target_system,
        source_record_id: event.source_record_id,
        target_record_id: event.target_record_id,
        status: event.status,
        payload: event.payload,
        response: event.response,
        error_message: event.error_message,
        retry_count: event.retry_count ?? 0,
        max_retries: event.max_retries ?? 4,
        next_retry_at: event.next_retry_at,
        completed_at: event.completed_at,
        idempotency_key: event.idempotency_key,
      })
      .select('id')
      .single()

    if (error) {
      console.error('Failed to create sync event:', error)
      throw error
    }

    return data.id
  }

  /**
   * Update an existing sync event
   */
  async updateEvent(
    eventId: string,
    updates: Partial<SyncEvent>
  ): Promise<void> {
    const { error } = await this.supabase
      .from('sync_events')
      .update({
        ...updates,
        ...(updates.status === 'success' || updates.status === 'failed'
          ? { completed_at: new Date().toISOString() }
          : {}),
      })
      .eq('id', eventId)

    if (error) {
      console.error('Failed to update sync event:', error)
      throw error
    }
  }

  /**
   * Mark event as successful
   */
  async success(
    eventId: string,
    response?: Record<string, unknown>,
    targetRecordId?: string
  ): Promise<void> {
    await this.updateEvent(eventId, {
      status: 'success',
      response,
      target_record_id: targetRecordId,
    })
  }

  /**
   * Mark event as failed
   */
  async fail(
    eventId: string,
    errorMessage: string,
    response?: Record<string, unknown>
  ): Promise<void> {
    await this.updateEvent(eventId, {
      status: 'failed',
      error_message: errorMessage,
      response,
    })
  }

  /**
   * Mark event for retry
   */
  async retry(
    eventId: string,
    retryCount: number,
    nextRetryAt: Date,
    errorMessage?: string
  ): Promise<void> {
    await this.updateEvent(eventId, {
      status: 'retrying',
      retry_count: retryCount,
      next_retry_at: nextRetryAt.toISOString(),
      error_message: errorMessage,
    })
  }

  /**
   * Check if an idempotency key has been processed
   */
  async checkIdempotency(key: string): Promise<SyncEvent | null> {
    const { data, error } = await this.supabase
      .from('sync_events')
      .select('*')
      .eq('idempotency_key', key)
      .single()

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows returned
      console.error('Failed to check idempotency:', error)
    }

    return data
  }

  /**
   * Get failed events for an automation (for retry queue)
   */
  async getFailedEvents(automation: Automation): Promise<SyncEvent[]> {
    const { data, error } = await this.supabase
      .from('sync_events')
      .select('*')
      .eq('automation', automation)
      .eq('status', 'failed')
      .lt('retry_count', 4)
      .order('created_at', { ascending: true })
      .limit(100)

    if (error) {
      console.error('Failed to get failed events:', error)
      return []
    }

    return data || []
  }

  /**
   * Get events ready for retry
   */
  async getRetryableEvents(): Promise<SyncEvent[]> {
    const now = new Date().toISOString()

    const { data, error } = await this.supabase
      .from('sync_events')
      .select('*')
      .eq('status', 'retrying')
      .lte('next_retry_at', now)
      .order('next_retry_at', { ascending: true })
      .limit(50)

    if (error) {
      console.error('Failed to get retryable events:', error)
      return []
    }

    return data || []
  }

  /**
   * Simple console log with structured format
   */
  log(
    level: 'info' | 'warn' | 'error',
    automation: Automation,
    message: string,
    meta?: Record<string, unknown>
  ): void {
    const timestamp = new Date().toISOString()
    const logMessage = {
      timestamp,
      level,
      automation,
      message,
      ...meta,
    }

    if (level === 'error') {
      console.error(JSON.stringify(logMessage))
    } else if (level === 'warn') {
      console.warn(JSON.stringify(logMessage))
    } else {
      console.log(JSON.stringify(logMessage))
    }
  }
}

// Export singleton instance
export const logger = new Logger()

// --- Standalone function exports for Inngest functions ---

/**
 * Create a new sync event log entry.
 * Returns the created event ID.
 */
export async function logSyncEvent(input: {
  automation: Automation;
  sourceSystem: SystemName;
  targetSystem: SystemName;
  sourceRecordId?: string;
  targetRecordId?: string;
  status: SyncStatus;
  payload?: Record<string, unknown>;
  response?: Record<string, unknown>;
  errorMessage?: string;
  idempotencyKey?: string;
}): Promise<string> {
  try {
    return await logger.createEvent({
      automation: input.automation,
      source_system: input.sourceSystem,
      target_system: input.targetSystem,
      source_record_id: input.sourceRecordId,
      target_record_id: input.targetRecordId,
      status: input.status,
      payload: input.payload,
      response: input.response,
      error_message: input.errorMessage,
      idempotency_key: input.idempotencyKey,
    })
  } catch (error) {
    console.error('logSyncEvent failed, returning placeholder ID:', error)
    return `fallback-${Date.now()}`
  }
}

/**
 * Update an existing sync event (e.g., mark as success after completion).
 */
export async function updateSyncEvent(
  eventId: string,
  updates: {
    status?: SyncStatus;
    targetRecordId?: string;
    response?: Record<string, unknown>;
    errorMessage?: string;
    completedAt?: string;
    retryCount?: number;
    nextRetryAt?: string | null;
  }
): Promise<void> {
  try {
    await logger.updateEvent(eventId, {
      status: updates.status,
      target_record_id: updates.targetRecordId,
      response: updates.response,
      error_message: updates.errorMessage,
      completed_at: updates.completedAt,
      retry_count: updates.retryCount,
      next_retry_at: updates.nextRetryAt ?? undefined,
    })
  } catch (error) {
    console.error('updateSyncEvent failed:', error)
  }
}

/**
 * Check if a sync event with this idempotency key already succeeded.
 * Used by P1 to prevent duplicate SO creation.
 */
export async function hasSuccessfulSync(idempotencyKey: string): Promise<boolean> {
  try {
    const existing = await logger.checkIdempotency(idempotencyKey)
    return existing?.status === 'success'
  } catch (error) {
    console.error('hasSuccessfulSync check failed:', error)
    return false
  }
}

/**
 * Get failed events that are ready for retry.
 * (status = 'retrying', next_retry_at <= now)
 */
export async function getRetryableEvents(): Promise<SyncEvent[]> {
  try {
    return await logger.getRetryableEvents()
  } catch (error) {
    console.error('getRetryableEvents failed:', error)
    return []
  }
}

/**
 * Update sync schedule after a run completes.
 */
export async function updateSyncSchedule(
  automation: string,
  data: {
    lastRunAt: string;
    lastRunStatus: string;
    lastRunDurationMs: number;
    recordsProcessed: number;
  }
): Promise<void> {
  try {
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('sync_schedules')
      .update({
        last_run_at: data.lastRunAt,
        last_run_status: data.lastRunStatus,
        last_run_duration_ms: data.lastRunDurationMs,
        records_processed: data.recordsProcessed,
      })
      .eq('automation', automation)

    if (error) {
      console.error('updateSyncSchedule failed:', error)
    }
  } catch (error) {
    console.error('updateSyncSchedule failed:', error)
  }
}
