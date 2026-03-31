import type { QBConnectionConfig, QBApiResponse, QBInvoice, QBPayment } from './types'

// Token storage
let accessToken: string | null = null
let refreshToken: string | null = null
let tokenExpiresAt: number = 0

/**
 * QuickBooks Online REST API client
 * TODO: Implement in Phase 3
 */
class QuickBooksClient {
  private baseUrl: string
  private realmId: string
  private clientId: string
  private clientSecret: string

  constructor() {
    const config = this.getConfig()
    this.baseUrl =
      config.environment === 'production'
        ? 'https://quickbooks.api.intuit.com'
        : 'https://sandbox-quickbooks.api.intuit.com'
    this.realmId = config.realmId
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
  }

  private getConfig(): QBConnectionConfig {
    return {
      environment: (process.env.QB_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox',
      clientId: process.env.QB_CLIENT_ID || '',
      clientSecret: process.env.QB_CLIENT_SECRET || '',
      realmId: process.env.QB_REALM_ID || '',
    }
  }

  /**
   * Refresh OAuth2 token
   * TODO: Implement in Phase 3
   */
  private async refreshAccessToken(): Promise<void> {
    // TODO: Implement in Phase 3
    throw new Error('QuickBooks OAuth2 refresh not implemented')
  }

  /**
   * Get valid access token
   */
  private async getToken(): Promise<string> {
    const now = Date.now()

    if (!accessToken || tokenExpiresAt < now + 5 * 60 * 1000) {
      await this.refreshAccessToken()
    }

    return accessToken!
  }

  /**
   * Make authenticated request to QuickBooks API
   * TODO: Implement in Phase 3
   */
  async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<QBApiResponse<T>> {
    // TODO: Implement in Phase 3
    try {
      const token = await this.getToken()
      const url = `${this.baseUrl}/v3/company/${this.realmId}${endpoint}`

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      })

      if (!response.ok) {
        if (response.status === 401) {
          accessToken = null
          await this.refreshAccessToken()
          return this.request(method, endpoint, body)
        }

        const errorText = await response.text()
        return {
          success: false,
          error: {
            code: response.status.toString(),
            message: errorText || response.statusText,
          },
        }
      }

      const data = await response.json()
      return { success: true, data: data as T }
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      }
    }
  }

  /**
   * Query invoices
   * TODO: Implement in Phase 3
   */
  async getInvoices(sinceDate?: Date): Promise<QBApiResponse<QBInvoice[]>> {
    // TODO: Implement in Phase 3
    let query = "SELECT * FROM Invoice WHERE Balance > '0'"
    if (sinceDate) {
      query += ` AND MetaData.LastUpdatedTime > '${sinceDate.toISOString()}'`
    }

    return this.request<QBInvoice[]>('GET', `/query?query=${encodeURIComponent(query)}`)
  }

  /**
   * Query payments
   * TODO: Implement in Phase 3
   */
  async getPayments(sinceDate?: Date): Promise<QBApiResponse<QBPayment[]>> {
    // TODO: Implement in Phase 3
    let query = 'SELECT * FROM Payment'
    if (sinceDate) {
      query += ` WHERE MetaData.LastUpdatedTime > '${sinceDate.toISOString()}'`
    }

    return this.request<QBPayment[]>('GET', `/query?query=${encodeURIComponent(query)}`)
  }
}

// Export singleton instance
let clientInstance: QuickBooksClient | null = null

export function getQuickBooksClient(): QuickBooksClient {
  if (!clientInstance) {
    clientInstance = new QuickBooksClient()
  }
  return clientInstance
}

/**
 * Test QuickBooks connection
 * TODO: Implement in Phase 3
 */
export async function testQuickBooksConnection(): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const client = getQuickBooksClient()
    await client.getInvoices()
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'QuickBooks not configured',
    }
  }
}
