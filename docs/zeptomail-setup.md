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
4. Once verified, set `ZEPTOMAIL_FROM_ADDRESS=hello@floventro.com`

---

## 3. Create the invite email template

1. Go to **Email Templates** → **Add Template**
2. Name: `Floventro Invite`
3. Paste in the compiled HTML from `docs/email-templates/invite.mjml`
   - Compile MJML to HTML first: `npx mjml docs/email-templates/invite.mjml -o /tmp/invite.html`
   - Paste the output HTML into ZeptoMail's template editor
4. Register merge tags — ZeptoMail uses `{{variable}}` double-brace syntax, which matches the template exactly:
   | Merge tag | Description |
   |-----------|-------------|
   | `{{inviterName}}` | Full name of the person who sent the invite |
   | `{{organisationName}}` | Name of the organisation being joined |
   | `{{role}}` | Role assigned (e.g. Inventory Manager) |
   | `{{acceptUrl}}` | Full URL to the accept-invite page |
5. Save and publish the template
6. Copy the **Template Key** — this is `ZEPTOMAIL_INVITE_TEMPLATE_KEY`

---

## 4. Set environment variables

### .env.local (local development)

```env
ZEPTOMAIL_TOKEN=Zoho-enczapikey <your-token>
ZEPTOMAIL_FROM_ADDRESS=hello@floventro.com
ZEPTOMAIL_FROM_NAME=Floventro
ZEPTOMAIL_INVITE_TEMPLATE_KEY=<your-template-key>
```

### Vercel (production)

Set the same four variables in the **floventro-app** Vercel project:
**Settings → Environment Variables** — add for Production (and optionally Preview).

Do not prefix the token value with `Zoho-enczapikey` in the env var — the code adds that prefix when building the `Authorization` header.

---

## 5. Test

Send a test invite from `/admin/team`. Check:
- Email arrives at the invitee address
- All four merge tags render correctly (inviter name, org, role, accept link)
- Accept link points to the correct domain (`app.floventro.com`)

---

## Notes

- The waitlist confirmation email (`sendWaitlistConfirmation` in `lib/email/loops.ts`) is not yet migrated — the waitlist modal is removed from the UI and the `/api/waitlist` route is currently dead code. If the waitlist is re-enabled, create a second ZeptoMail template and add `sendWaitlistConfirmation` to `lib/email/zeptomail.ts` following the same pattern.
- `lib/email/loops.ts` is kept in place until ZeptoMail is confirmed working in production. Delete it once the first successful invite email is sent via ZeptoMail.
