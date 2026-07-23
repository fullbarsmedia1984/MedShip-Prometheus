# Zeus production email

Zeus sends invitations, password resets, email 2FA codes, role-change notices,
and operational email alerts directly through Resend. Supabase Auth generates
single-use recovery tokens, but it does not deliver Zeus invite messages.

## Production requirements

Set these variables on the Railway service that runs Zeus:

```text
RESEND_API_KEY=<Resend API key with send access>
EMAIL_FROM=Zeus <no-reply@medicalshipment.com>
NEXT_PUBLIC_APP_URL=https://zeus.medicalshipment.com
```

Production code rejects a sender outside `@medicalshipment.com` and rejects a
non-HTTPS application URL. Never place the API key in source control.

In the Resend Domains dashboard, `medicalshipment.com` must show as verified
for sending. Its Resend-provided DKIM record and the SPF TXT and MX records on
`send.medicalshipment.com` must all resolve publicly. DMARC should also remain
published for the root domain. Copy the exact record names and values from the
Resend dashboard; do not reuse example values from this document.

## Go-live check

1. Deploy the three Railway variables above.
2. Open **Settings → User Management** as an admin.
3. Confirm the email card shows the corporate sender and production Zeus URL.
4. Click **Send test to me** and confirm the message arrives with the expected
   `From` address and working **Open Zeus** link.
5. Send the first real invite. If delivery fails, the account remains created
   and the UI shows the provider error; correct the provider/DNS setting and use
   **Resend invite** on that user.

The production test and invite use the same Resend client, sender, and runtime
environment, so a received test is the release gate for invite delivery.
