import jsforce, { Connection } from 'jsforce'
import type { SFConnectionConfig, ISalesforceClient } from './types'

const INVALID_SESSION_ERROR = 'INVALID_SESSION_ID'

function loadConfig(): SFConnectionConfig {
  const loginUrl = process.env.SF_LOGIN_URL || 'https://login.salesforce.com'
  const clientId = process.env.SF_CLIENT_ID
  const clientSecret = process.env.SF_CLIENT_SECRET
  const username = process.env.SF_USERNAME
  const password = process.env.SF_PASSWORD
  const securityToken = process.env.SF_SECURITY_TOKEN

  if (!username) {
    throw new Error(
      'Missing required environment variable: SF_USERNAME. ' +
        'Set it to your Salesforce username (e.g. user@company.com).'
    )
  }
  if (!password) {
    throw new Error(
      'Missing required environment variable: SF_PASSWORD. ' +
        'Set it to your Salesforce password.'
    )
  }
  if (!securityToken) {
    throw new Error(
      'Missing required environment variable: SF_SECURITY_TOKEN. ' +
        'Get it from Salesforce → Settings → Reset My Security Token.'
    )
  }

  return {
    loginUrl,
    clientId: clientId || undefined,
    clientSecret: clientSecret || undefined,
    username,
    password,
    securityToken,
  }
}

export class SalesforceClient implements ISalesforceClient {
  private connection: Connection | null = null
  private connected = false
  private config: SFConnectionConfig

  constructor() {
    this.config = loadConfig()
  }

  async connect(): Promise<void> {
    const oauthOptions =
      this.config.clientId && this.config.clientSecret
        ? {
            clientId: this.config.clientId,
            clientSecret: this.config.clientSecret,
            loginUrl: this.config.loginUrl,
          }
        : undefined

    this.connection = new jsforce.Connection({
      loginUrl: this.config.loginUrl,
      ...(oauthOptions ? { oauth2: oauthOptions } : {}),
    })

    await this.connection.login(
      this.config.username,
      this.config.password + this.config.securityToken
    )

    this.connected = true
  }

  getConnection(): Connection {
    if (!this.connection || !this.connected) {
      throw new Error(
        'Salesforce client is not connected. Call connect() first.'
      )
    }
    return this.connection
  }

  isConnected(): boolean {
    return this.connected && this.connection !== null
  }

  async testConnection(): Promise<{
    success: boolean
    error?: string
    orgId?: string
  }> {
    try {
      if (!this.isConnected()) {
        await this.connect()
      }
      const conn = this.getConnection()
      const result = await conn.query<{ Id: string }>(
        'SELECT Id FROM Organization LIMIT 1'
      )
      return {
        success: true,
        orgId: result.records[0]?.Id,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      try {
        await this.connection.logout()
      } catch {
        // Ignore logout errors — connection may already be invalid
      }
      this.connection = null
      this.connected = false
    }
  }

  /**
   * Execute a callback with automatic INVALID_SESSION retry.
   * If the callback throws an INVALID_SESSION error, reconnects and retries once.
   */
  async withRetry<T>(fn: (conn: Connection) => Promise<T>): Promise<T> {
    const conn = this.getConnection()
    try {
      return await fn(conn)
    } catch (error: unknown) {
      if (isInvalidSessionError(error)) {
        await this.connect()
        return fn(this.getConnection())
      }
      throw error
    }
  }
}

function isInvalidSessionError(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.message.includes(INVALID_SESSION_ERROR) ||
      error.name === INVALID_SESSION_ERROR
    )
  }
  return false
}

/**
 * Factory function — creates a new SalesforceClient per request.
 * Do NOT use a singleton; Next.js serverless functions need isolated instances.
 */
export function createSalesforceClient(): SalesforceClient {
  return new SalesforceClient()
}
