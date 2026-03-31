import jsforce, { Connection } from 'jsforce'
import type { SFConnectionConfig } from './types'

// Singleton connection instance
let connection: Connection | null = null
let tokenExpiresAt: number = 0

/**
 * Get or create a Salesforce connection with OAuth2 token management
 * Handles automatic token refresh when expired
 */
export async function getSalesforceConnection(): Promise<Connection> {
  const now = Date.now()

  // Return existing connection if token is still valid (with 5 min buffer)
  if (connection && tokenExpiresAt > now + 5 * 60 * 1000) {
    return connection
  }

  // Create new connection
  const config = getConfig()

  connection = new jsforce.Connection({
    loginUrl: config.loginUrl,
    oauth2: {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      loginUrl: config.loginUrl,
    },
  })

  // Login with username/password flow
  // TODO: Implement in Phase 1 - Add OAuth2 web flow for production
  await connection.login(
    config.username,
    config.password + config.securityToken
  )

  // Set token expiry (Salesforce tokens typically last 2 hours)
  tokenExpiresAt = now + 2 * 60 * 60 * 1000

  return connection
}

/**
 * Force refresh the Salesforce connection
 * Call this if you get an authentication error
 */
export async function refreshSalesforceConnection(): Promise<Connection> {
  connection = null
  tokenExpiresAt = 0
  return getSalesforceConnection()
}

/**
 * Get Salesforce configuration from environment variables
 */
function getConfig(): SFConnectionConfig {
  const config: SFConnectionConfig = {
    loginUrl: process.env.SF_LOGIN_URL || 'https://login.salesforce.com',
    clientId: process.env.SF_CLIENT_ID || '',
    clientSecret: process.env.SF_CLIENT_SECRET || '',
    username: process.env.SF_USERNAME || '',
    password: process.env.SF_PASSWORD || '',
    securityToken: process.env.SF_SECURITY_TOKEN || '',
  }

  // Validate required fields
  const required = ['clientId', 'clientSecret', 'username', 'password'] as const
  for (const field of required) {
    if (!config[field]) {
      throw new Error(`Missing Salesforce configuration: SF_${field.toUpperCase()}`)
    }
  }

  return config
}

/**
 * Test Salesforce connection
 * Returns true if connection is successful
 */
export async function testSalesforceConnection(): Promise<{
  success: boolean
  instanceUrl?: string
  error?: string
}> {
  try {
    const conn = await getSalesforceConnection()
    // Test with a simple query
    await conn.query('SELECT Id FROM Organization LIMIT 1')
    return {
      success: true,
      instanceUrl: conn.instanceUrl,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
