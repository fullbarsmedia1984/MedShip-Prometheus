import assert from 'node:assert'
import { describe, it, mock, beforeEach } from 'node:test'

// We test the client module by mocking jsforce at the import level.
// Since the client reads env vars at construction time, we set/clear them per test.

describe('SalesforceClient', () => {
  beforeEach(() => {
    // Clear SF env vars so each test controls its own state
    delete process.env.SF_LOGIN_URL
    delete process.env.SF_CLIENT_ID
    delete process.env.SF_CLIENT_SECRET
    delete process.env.SF_USERNAME
    delete process.env.SF_PASSWORD
    delete process.env.SF_SECURITY_TOKEN
  })

  it('throws descriptive error when SF_USERNAME is missing', () => {
    process.env.SF_PASSWORD = 'pass'
    process.env.SF_SECURITY_TOKEN = 'tok'

    assert.throws(
      () => {
        // Dynamic import won't work here; we re-require to trigger constructor
        const { SalesforceClient } = require('../client')
        new SalesforceClient()
      },
      (err: Error) => {
        assert.ok(err.message.includes('SF_USERNAME'), `Expected error about SF_USERNAME, got: ${err.message}`)
        return true
      }
    )
  })

  it('throws descriptive error when SF_PASSWORD is missing', () => {
    process.env.SF_USERNAME = 'user@test.com'
    process.env.SF_SECURITY_TOKEN = 'tok'

    assert.throws(
      () => {
        const { SalesforceClient } = require('../client')
        new SalesforceClient()
      },
      (err: Error) => {
        assert.ok(err.message.includes('SF_PASSWORD'), `Expected error about SF_PASSWORD, got: ${err.message}`)
        return true
      }
    )
  })

  it('throws descriptive error when SF_SECURITY_TOKEN is missing', () => {
    process.env.SF_USERNAME = 'user@test.com'
    process.env.SF_PASSWORD = 'pass'

    assert.throws(
      () => {
        const { SalesforceClient } = require('../client')
        new SalesforceClient()
      },
      (err: Error) => {
        assert.ok(err.message.includes('SF_SECURITY_TOKEN'), `Expected error about SF_SECURITY_TOKEN, got: ${err.message}`)
        return true
      }
    )
  })

  it('creates client successfully when all env vars are set', () => {
    process.env.SF_USERNAME = 'user@test.com'
    process.env.SF_PASSWORD = 'pass'
    process.env.SF_SECURITY_TOKEN = 'tok'

    const { SalesforceClient } = require('../client')
    const client = new SalesforceClient()

    assert.strictEqual(client.isConnected(), false)
  })

  it('getConnection() throws when not connected', () => {
    process.env.SF_USERNAME = 'user@test.com'
    process.env.SF_PASSWORD = 'pass'
    process.env.SF_SECURITY_TOKEN = 'tok'

    const { SalesforceClient } = require('../client')
    const client = new SalesforceClient()

    assert.throws(
      () => client.getConnection(),
      (err: Error) => {
        assert.ok(err.message.includes('not connected'))
        return true
      }
    )
  })
})

describe('SalesforceClient - withRetry', () => {
  beforeEach(() => {
    process.env.SF_USERNAME = 'user@test.com'
    process.env.SF_PASSWORD = 'pass'
    process.env.SF_SECURITY_TOKEN = 'tok'
  })

  it('retries once on INVALID_SESSION_ID error', async () => {
    const { SalesforceClient } = require('../client')
    const client = new SalesforceClient()

    // Manually set up a mock connection to simulate connected state
    let callCount = 0
    const mockQuery = mock.fn(async () => {
      callCount++
      if (callCount === 1) {
        const err = new Error('INVALID_SESSION_ID: Session expired')
        err.name = 'INVALID_SESSION_ID'
        throw err
      }
      return { records: [{ Id: 'org123' }] }
    })

    const mockLogin = mock.fn(async () => ({}))

    // Inject mock connection
    const mockConn = { query: mockQuery, login: mockLogin, logout: mock.fn() }
    ;(client as Record<string, unknown>)['connection'] = mockConn
    ;(client as Record<string, unknown>)['connected'] = true

    // Override connect to simulate re-auth
    client.connect = async () => {
      ;(client as Record<string, unknown>)['connection'] = mockConn
      ;(client as Record<string, unknown>)['connected'] = true
    }

    const result = await client.withRetry(async (conn: { query: typeof mockQuery }) => {
      return conn.query('SELECT Id FROM Organization LIMIT 1')
    })

    assert.strictEqual(callCount, 2, 'Should have called query twice (initial + retry)')
    assert.deepStrictEqual(result, { records: [{ Id: 'org123' }] })
  })

  it('does not retry on non-session errors', async () => {
    const { SalesforceClient } = require('../client')
    const client = new SalesforceClient()

    const mockQuery = mock.fn(async () => {
      throw new Error('INVALID_FIELD: No such column Foo__c')
    })

    const mockConn = { query: mockQuery, logout: mock.fn() }
    ;(client as Record<string, unknown>)['connection'] = mockConn
    ;(client as Record<string, unknown>)['connected'] = true

    await assert.rejects(
      () =>
        client.withRetry(async (conn: { query: typeof mockQuery }) => {
          return conn.query('SELECT Foo__c FROM Opportunity')
        }),
      (err: Error) => {
        assert.ok(err.message.includes('INVALID_FIELD'))
        return true
      }
    )

    assert.strictEqual(mockQuery.mock.callCount(), 1, 'Should only call once — no retry for non-session errors')
  })
})
