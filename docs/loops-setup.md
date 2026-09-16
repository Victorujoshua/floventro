# Loops — Transactional Email Setup

Loops (loops.so) is the transactional email provider for Floventro. It sends team invite emails and waitlist confirmations. Email content lives in Loops dashboard templates; code sends a `transactionalId` + data variables.

---

## 1. Create a Loops account and verify your sending domain

1. Sign up at https://loops.so
2. Go to **Settings → Sending Domains** → **Add Domain**
3. Enter `floventro.com`
4. Loops will show you DNS records to add. In your domain registrar, add:

**SPF** (append to an existing SPF record, or create a new one):
| Type | Name | Value |
|------|------|-------|
| `TXT` | `@` | `v=spf1 include:spf.loops.so ~all` |

**DKIM** — Loops generates a unique record per account:
| Type | Name | Value |
|------|------|-------|
| `TXT` | `loopsspf._domainkey` | *(copy exact value from Loops dashboard)* |

**DMARC** (recommended):
| Type | Name | Value |
|------|------|-------|
| `TXT` | `_dmarc` | `v=DMARC1; p=none; rua=mailto:hello@floventro.com` |

Wait 24–48 hours for DNS propagation. Loops will show a green "Verified" badge once records resolve.

---

## 2. Create the Team Invite transactional email

1. Go to **Transactional** → **New Transactional Email**
2. Name: `Team Invite`
3. From address: `hello@floventro.com` · From name: `Floventro`
4. Subject: `You've been invited to join {{ organisationName }} on Floventro`
5. Design the email body. Use these data variables (Loops uses `{{ variable }}` syntax):

| Variable | Description |
|---|---|
| `inviterName` | Full name or email of the person who sent the invite |
| `organisationName` | Name of the organisation being joined |
| `role` | The role assigned (e.g. `Admin`, `Inventory Manager`) |
| `acceptUrl` | The full accept-invite URL (e.g. `https://app.floventro.com/accept-invite/<token>`) |

6. Save and publish the template
7. Copy the **Transactional ID** from the template's URL or settings panel — this is `LOOPS_INVITE_TRANSACTIONAL_ID`

---

## 3. Create the Waitlist Confirmation transactional email (optional)

1. Go to **Transactional** → **New Transactional Email**
2. Name: `Waitlist Confirmation`
3. From address: `hello@floventro.com` · From name: `Floventro`
4. Subject: `You're on the Floventro waitlist.`
5. Data variable: `firstName` (falls back to `"there"` in code if not provided)
6. Copy the **Transactional ID** → this is `LOOPS_WAITLIST_TRANSACTIONAL_ID`

---

## 4. Get your API key

Go to **Settings → API Keys** → **Generate API Key**. This is `LOOPS_API_KEY`.

---

## 5. Set environment variables

### .env.local (local development)

```env
LOOPS_API_KEY=your-loops-api-key
LOOPS_INVITE_TRANSACTIONAL_ID=your-invite-template-id
LOOPS_WAITLIST_TRANSACTIONAL_ID=your-waitlist-template-id
```

### Vercel (production)

Add all three to **Settings → Environment Variables** for Production (and Preview if desired).
`LOOPS_API_KEY` is a server-only secret — never expose it as `NEXT_PUBLIC_*`.

---

## 6. Test

Send a test invite from `/admin/team`. Check:
- Email arrives at the invitee address
- All four variables render correctly (inviter name, org name, role, accept link)
- Accept link points to `app.floventro.com/accept-invite/<token>`

Use **Resend** on a pending invite to re-test without creating a new one.

---

## Notes

- Invite emails are sent best-effort: if Loops fails, the invite row is still created and the UI shows a fallback accept-link. The sender can copy and share it manually.
- Diagnostic logs are emitted on every send attempt — check Vercel function logs for `[loops]` prefixed lines.
- Password-reset and email-confirmation emails are handled by Supabase's built-in SMTP, not Loops.
