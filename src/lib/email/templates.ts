// Brand-styled email templates. Inline styles only — email clients strip
// <style> blocks and external CSS. Colors match UI_DESIGN_CONTEXT.md.

const DARK_BLUE = '#1C3C6E'
const LIGHT_BLUE = '#1E98D5'
const SLATE = '#576671'

type RenderedEmail = { subject: string; html: string; text: string }

function layout(heading: string, bodyHtml: string): string {
  return `
  <div style="margin:0;padding:24px;background:#F4F7F9;font-family:'Outfit',Segoe UI,Arial,sans-serif;color:${DARK_BLUE};">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(28,60,110,0.08);">
      <div style="background:linear-gradient(135deg,${DARK_BLUE} 0%,${LIGHT_BLUE} 100%);padding:28px 32px;">
        <span style="color:#fff;font-size:20px;font-weight:700;">Medical Shipment</span>
        <span style="color:rgba(255,255,255,0.7);font-size:20px;font-weight:400;"> Prometheus</span>
      </div>
      <div style="padding:32px;">
        <h1 style="margin:0 0 16px;font-size:22px;color:${DARK_BLUE};">${heading}</h1>
        ${bodyHtml}
      </div>
      <div style="padding:20px 32px;border-top:1px solid #E4EAEE;color:${SLATE};font-size:12px;">
        Medical Shipment Prometheus — integration hub
      </div>
    </div>
  </div>`
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:${LIGHT_BLUE};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">${label}</a>`
}

export function inviteEmail(params: {
  inviteUrl: string
  roleLabel: string
  inviterName: string
}): RenderedEmail {
  const { inviteUrl, roleLabel, inviterName } = params
  return {
    subject: 'You have been invited to Medical Shipment Prometheus',
    html: layout(
      'You have been invited',
      `<p style="font-size:14px;line-height:1.6;color:${SLATE};">
         ${inviterName} invited you to the Medical Shipment Prometheus dashboard
         as <strong style="color:${DARK_BLUE};">${roleLabel}</strong>.
         Click below to set your password and sign in.
       </p>
       <p style="margin:24px 0;">${button(inviteUrl, 'Accept invite')}</p>
       <p style="font-size:12px;color:${SLATE};">If you weren't expecting this, you can ignore this email.</p>`
    ),
    text: `${inviterName} invited you to Medical Shipment Prometheus as ${roleLabel}. Accept your invite: ${inviteUrl}`,
  }
}

export function twoFactorCodeEmail(params: { code: string; minutes: number }): RenderedEmail {
  const { code, minutes } = params
  return {
    subject: `Your sign-in code: ${code}`,
    html: layout(
      'Your sign-in code',
      `<p style="font-size:14px;line-height:1.6;color:${SLATE};">
         Enter this code to finish signing in. It expires in ${minutes} minutes.
       </p>
       <p style="margin:24px 0;font-size:34px;font-weight:700;letter-spacing:8px;color:${DARK_BLUE};">${code}</p>
       <p style="font-size:12px;color:${SLATE};">If you didn't try to sign in, someone may have your password — change it.</p>`
    ),
    text: `Your Medical Shipment Prometheus sign-in code is ${code}. It expires in ${minutes} minutes.`,
  }
}

export function passwordResetEmail(params: { resetUrl: string; minutes: number }): RenderedEmail {
  const { resetUrl, minutes } = params
  return {
    subject: 'Reset your Prometheus password',
    html: layout(
      'Reset your password',
      `<p style="font-size:14px;line-height:1.6;color:${SLATE};">
         Someone (hopefully you) asked to reset the password for this account.
         Click below to choose a new one. The link expires in ${minutes} minutes
         and works once.
       </p>
       <p style="margin:24px 0;">${button(resetUrl, 'Choose a new password')}</p>
       <p style="font-size:12px;color:${SLATE};">If you didn't ask for this, you can ignore this email — your password is unchanged.</p>`
    ),
    text: `Reset your Medical Shipment Prometheus password (link expires in ${minutes} minutes, single use): ${resetUrl}`,
  }
}

export function roleChangedEmail(params: { roleLabel: string }): RenderedEmail {
  const { roleLabel } = params
  return {
    subject: 'Your access level changed',
    html: layout(
      'Your access level changed',
      `<p style="font-size:14px;line-height:1.6;color:${SLATE};">
         Your role in Medical Shipment Prometheus is now
         <strong style="color:${DARK_BLUE};">${roleLabel}</strong>.
         Sign in again if your available pages don't update.
       </p>`
    ),
    text: `Your Medical Shipment Prometheus role is now ${roleLabel}.`,
  }
}

export function emailTestEmail(params: { appUrl: string }): RenderedEmail {
  return {
    subject: 'Zeus production email test',
    html: layout(
      'Production email is ready',
      `<p style="font-size:14px;line-height:1.6;color:${SLATE};">
         Zeus successfully sent this message through the configured production
         email provider. Invite and password-reset emails use this same path.
       </p>
       <p style="margin:24px 0;">${button(params.appUrl, 'Open Zeus')}</p>`
    ),
    text: `Zeus successfully sent this production email test. Open Zeus: ${params.appUrl}`,
  }
}
