import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const upsertSelectMock = vi.fn()
const updateEqMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      upsert: () => ({ select: upsertSelectMock }),
      update: () => ({ eq: updateEqMock }),
    }),
  }),
}))

vi.mock('@/lib/utils/notifications', () => ({
  sendAlertEmail: vi.fn(async () => ({ sent: true, provider: 'resend' })),
}))

import { buildBellMessage, sendIncentiveBellWebhook, ringBell, type BellCandidate } from '../bell'
import { sendAlertEmail } from '@/lib/utils/notifications'

const candidate: BellCandidate = {
  canonicalKey: 'id:9999',
  soNumber: '12345',
  rep: 'Mike Franzese',
  institution: 'Example Nursing College',
  amount: 4321.5,
}

const originalEnv = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  upsertSelectMock.mockResolvedValue({ data: [{ canonical_key: candidate.canonicalKey }], error: null })
  updateEqMock.mockResolvedValue({ data: null, error: null })
})

afterEach(() => {
  process.env = { ...originalEnv }
  vi.unstubAllGlobals()
})

describe('buildBellMessage', () => {
  it('includes institution, SO number, amount, and rep', () => {
    const message = buildBellMessage(candidate)
    expect(message).toContain('Example Nursing College')
    expect(message).toContain('SO 12345')
    expect(message).toContain('$4,322') // formatUsd rounds to whole dollars
    expect(message).toContain('Mike Franzese')
    expect(message.startsWith('🔔')).toBe(true)
  })
})

describe('sendIncentiveBellWebhook', () => {
  it('POSTs { text } to INCENTIVE_BELL_WEBHOOK_URL', async () => {
    process.env.INCENTIVE_BELL_WEBHOOK_URL = 'https://hooks.slack.com/services/T000/B000/XXX'
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendIncentiveBellWebhook(candidate)
    expect(result).toEqual({ sent: true, provider: 'incentive-webhook' })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://hooks.slack.com/services/T000/B000/XXX')
    const body = JSON.parse(String(init.body))
    expect(Object.keys(body)).toEqual(['text'])
    expect(body.text).toContain('Example Nursing College')
  })

  it('reports non-2xx responses as failures', async () => {
    process.env.INCENTIVE_BELL_WEBHOOK_URL = 'https://hooks.slack.com/services/T000/B000/XXX'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no_service', { status: 404 })))

    const result = await sendIncentiveBellWebhook(candidate)
    expect(result.sent).toBe(false)
    expect(result.error).toContain('404')
  })

  it('falls back to sendAlertEmail when the env var is unset', async () => {
    delete process.env.INCENTIVE_BELL_WEBHOOK_URL
    const result = await sendIncentiveBellWebhook(candidate)
    expect(sendAlertEmail).toHaveBeenCalledOnce()
    expect(result).toEqual({ sent: true, provider: 'resend' })
  })
})

describe('ringBell', () => {
  it('rings and sends the webhook when the insert writes a row', async () => {
    process.env.INCENTIVE_BELL_WEBHOOK_URL = 'https://hooks.slack.com/services/T000/B000/XXX'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })))

    const result = await ringBell(candidate)
    expect(result.rung).toBe(true)
    expect(result.webhook?.sent).toBe(true)
    expect(updateEqMock).toHaveBeenCalled() // webhook status written back
  })

  it('skips the webhook entirely when the customer already rang (conflict)', async () => {
    upsertSelectMock.mockResolvedValue({ data: [], error: null })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await ringBell(candidate)
    expect(result).toEqual({ rung: false, webhook: null })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sendAlertEmail).not.toHaveBeenCalled()
  })
})
