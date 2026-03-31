import type { FBConnectionConfig, FBApiResponse } from './types'

// Singleton token storage
let authToken: string | null = null
let tokenExpiresAt: number = 0

/**
 * Fishbowl REST API client
 * Handles authentication and base URL configuration
 */
class FishbowlClient {
  private baseUrl: string
  private username: string
  private password: string

  constructor() {
    const config = this.getConfig()
    this.baseUrl = config.apiUrl.replace(/\/$/, '') // Remove trailing slash
    this.username = config.username
    this.password = config.password
  }

  private getConfig(): FBConnectionConfig {
    const config: FBConnectionConfig = {
      apiUrl: process.env.FISHBOWL_API_URL || '',
      username: process.env.FISHBOWL_USERNAME || '',
      password: process.env.FISHBOWL_PASSWORD || '',
    }

    if (!config.apiUrl) {
      throw new Error('Missing Fishbowl configuration: FISHBOWL_API_URL')
    }

    return config
  }

  /**
   * Authenticate with Fishbowl and get bearer token
   */
  private async authenticate(): Promise<string> {
    // TODO: Implement in Phase 1 - actual Fishbowl auth endpoint
    const response = await fetch(`${this.baseUrl}/api/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: this.username,
        password: this.password,
      }),
    })

    if (!response.ok) {
      throw new Error(`Fishbowl authentication failed: ${response.statusText}`)
    }

    const data = await response.json()
    authToken = data.token as string
    // Token typically valid for 24 hours
    tokenExpiresAt = Date.now() + 24 * 60 * 60 * 1000

    return authToken
  }

  /**
   * Get valid auth token, refreshing if needed
   */
  private async getToken(): Promise<string> {
    const now = Date.now()

    // Refresh if token is expired or expiring in 5 minutes
    if (!authToken || tokenExpiresAt < now + 5 * 60 * 1000) {
      await this.authenticate()
    }

    return authToken!
  }

  /**
   * Make authenticated request to Fishbowl API
   */
  async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<FBApiResponse<T>> {
    try {
      const token = await this.getToken()
      const url = `${this.baseUrl}${endpoint}`

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      })

      if (!response.ok) {
        // Handle token expiry
        if (response.status === 401) {
          authToken = null
          tokenExpiresAt = 0
          // Retry once with fresh token
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
      return {
        success: true,
        data: data as T,
      }
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
   * GET request helper
   */
  async get<T>(endpoint: string): Promise<FBApiResponse<T>> {
    return this.request<T>('GET', endpoint)
  }

  /**
   * POST request helper
   */
  async post<T>(endpoint: string, body: unknown): Promise<FBApiResponse<T>> {
    return this.request<T>('POST', endpoint, body)
  }

  /**
   * PUT request helper
   */
  async put<T>(endpoint: string, body: unknown): Promise<FBApiResponse<T>> {
    return this.request<T>('PUT', endpoint, body)
  }
}

// Export singleton instance
let clientInstance: FishbowlClient | null = null

export function getFishbowlClient(): FishbowlClient {
  if (!clientInstance) {
    clientInstance = new FishbowlClient()
  }
  return clientInstance
}

/**
 * Test Fishbowl connection
 */
export async function testFishbowlConnection(): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const client = getFishbowlClient()
    // Test with a simple inventory query
    const result = await client.get('/api/parts/inventory?limit=1')
    return {
      success: result.success,
      error: result.error?.message,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
