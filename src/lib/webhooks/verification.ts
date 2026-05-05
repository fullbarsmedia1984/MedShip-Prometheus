import { timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'

export function verifySharedSecretHeader(
  request: NextRequest,
  expectedSecret: string
) {
  const providedSecret = getProvidedSecret(request)

  if (!providedSecret) {
    return false
  }

  return safeEqual(providedSecret, expectedSecret)
}

function getProvidedSecret(request: NextRequest) {
  const explicitSecret = request.headers.get('x-webhook-secret')
  if (explicitSecret) {
    return explicitSecret
  }

  const authorization = request.headers.get('authorization')
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length)
  }

  return null
}

function safeEqual(a: string, b: string) {
  const aBuffer = Buffer.from(a)
  const bBuffer = Buffer.from(b)

  if (aBuffer.length !== bBuffer.length) {
    return false
  }

  return timingSafeEqual(aBuffer, bBuffer)
}
