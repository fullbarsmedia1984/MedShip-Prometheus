import test from 'node:test'
import assert from 'node:assert/strict'

const { getEmailConfiguration, senderAddress } = await import(
  new URL('../config.ts', import.meta.url).href
)

test('extracts a sender address with or without a display name', () => {
  assert.equal(senderAddress('Zeus <no-reply@medicalshipment.com>'), 'no-reply@medicalshipment.com')
  assert.equal(senderAddress('admin@medicalshipment.com'), 'admin@medicalshipment.com')
  assert.equal(senderAddress('not an email'), null)
})

test('accepts a complete production Zeus email configuration', () => {
  const result = getEmailConfiguration({
    NODE_ENV: 'production',
    RESEND_API_KEY: 'redacted-test-key',
    EMAIL_FROM: 'Zeus <no-reply@medicalshipment.com>',
    NEXT_PUBLIC_APP_URL: 'https://zeus.medicalshipment.com/',
  })

  assert.equal(result.ready, true)
  assert.equal(result.senderDomain, 'medicalshipment.com')
  assert.equal(result.appUrl, 'https://zeus.medicalshipment.com')
  assert.deepEqual(result.issues, [])
})

test('rejects a non-corporate production sender and insecure links', () => {
  const result = getEmailConfiguration({
    NODE_ENV: 'production',
    RESEND_API_KEY: 'redacted-test-key',
    EMAIL_FROM: 'Zeus <no-reply@example.com>',
    NEXT_PUBLIC_APP_URL: 'http://zeus.medicalshipment.com',
  })

  assert.equal(result.ready, false)
  assert.ok(result.issues.some((issue) => issue.includes('@medicalshipment.com')))
  assert.ok(result.issues.some((issue) => issue.includes('HTTPS')))
})

test('reports every missing setting without exposing secrets', () => {
  const result = getEmailConfiguration({ NODE_ENV: 'production' })

  assert.equal(result.configured, false)
  assert.equal(result.ready, false)
  assert.equal(result.issues.length, 3)
})
