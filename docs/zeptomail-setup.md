# ZeptoMail Setup

ZeptoMail (by Zoho) is our transactional email provider. It sends invite emails only — no marketing.

---

## 1. Create a Mail Agent

1. Log in at https://zeptomail.zoho.com
2. Go to **Mail Agents** → **Add Mail Agent**
3. Name it `Floventro App`
4. Copy the **Send Mail Token** — this is `ZEPTOMAIL_TOKEN`

---

## 2. Verify your sending domain

1. In the Mail Agent, go to **Email Addresses** → **Add Email Address**
2. Enter `hello@floventro.com` (or whichever address you use)
3. Follow the DNS verification steps (SPF, DKIM records)
4. Once verified, set `ZEPTOMAIL_FROM=hello@floventro.com`

> No template setup required — invite emails are sent as raw HTML generated in code
> (`lib/email/zeptomail.ts`). The design lives in `docs/email-templates/invite.mjml`
> for reference; it does not need to be compiled or uploaded.

---

## 3. Set environment variables

### .env.local (local development)

```env
ZEPTOMAIL_TOKEN=your-send-mail-token
ZEPTOMAIL_FROM=hello@floventro.com
ZEPTOMAIL_FROM_NAME=Floventro
```

### Vercel (production)

Set the same variables in the **floventro-app** Vercel project:
**Settings → Environment Variables** — add for Production (and optionally Preview).

Do not prefix the token value with `Zoho-enczapikey` in the env var — the code adds that prefix.

---

## 4. Test

Send a test invite from `/admin/team`. Check:
- Email arrives at the invitee address
- Inviter name, org name, role, and accept link all render correctly
- Accept link points to the correct domain (`app.floventro.com`)

Use **Resend** on an existing pending invite to re-test without creating a new one.

---

## Notes

- `lib/email/loops.ts` is kept in place (waitlist signup logic). Delete it only if the
  waitlist is permanently retired.
- Password-reset email is handled by Supabase's built-in SMTP configuration, not ZeptoMail.
- In-app notifications (past-due invoices, low stock, pending requests) are computed at
  render time and shown in the app header only — no email delivery yet.
