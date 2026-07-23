import 'server-only'
import { sendEmail, type EmailResult } from './client'
import {
  inviteEmail,
  twoFactorCodeEmail,
  roleChangedEmail,
  passwordResetEmail,
  emailTestEmail,
} from './templates'
import type { AppRole } from '@/lib/auth'

export { sendEmail } from './client'
export type { EmailResult, SendEmailInput } from './client'
export { getEmailConfiguration, PRODUCTION_EMAIL_DOMAIN } from './config'

const ROLE_LABELS: Record<AppRole, string> = {
  superadmin: 'Superadmin',
  admin: 'Admin',
  staff: 'Administrative Staff',
  sales_rep: 'Sales Rep',
  sales_manager: 'Sales Manager',
  warehouse: 'Warehouse / Logistics',
}

export function roleLabel(role: AppRole): string {
  return ROLE_LABELS[role]
}

export async function sendInviteEmail(params: {
  to: string
  inviteUrl: string
  role: AppRole
  inviterName: string
}): Promise<EmailResult> {
  const { subject, html, text } = inviteEmail({
    inviteUrl: params.inviteUrl,
    roleLabel: ROLE_LABELS[params.role],
    inviterName: params.inviterName,
  })
  return sendEmail({ to: params.to, subject, html, text })
}

export async function sendTwoFactorCodeEmail(params: {
  to: string
  code: string
  minutes: number
}): Promise<EmailResult> {
  const { subject, html, text } = twoFactorCodeEmail({
    code: params.code,
    minutes: params.minutes,
  })
  return sendEmail({ to: params.to, subject, html, text })
}

export async function sendPasswordResetEmail(params: {
  to: string
  resetUrl: string
  minutes: number
}): Promise<EmailResult> {
  const { subject, html, text } = passwordResetEmail({
    resetUrl: params.resetUrl,
    minutes: params.minutes,
  })
  return sendEmail({ to: params.to, subject, html, text })
}

export async function sendRoleChangedEmail(params: {
  to: string
  role: AppRole
}): Promise<EmailResult> {
  const { subject, html, text } = roleChangedEmail({
    roleLabel: ROLE_LABELS[params.role],
  })
  return sendEmail({ to: params.to, subject, html, text })
}

export async function sendEmailTest(params: {
  to: string
  appUrl: string
}): Promise<EmailResult> {
  const { subject, html, text } = emailTestEmail({ appUrl: params.appUrl })
  return sendEmail({ to: params.to, subject, html, text })
}
