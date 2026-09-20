# ZeptoMail Setup — Team Invites

This covers the ZeptoMail configuration needed for `lib/email/zeptomail.ts`, which sends
team-invite emails (`sendInviteEmail`, used by `inviteMemberAction` and `resendInviteAction`
in `lib/db/actions/team.ts`).

> The waitlist feature has been removed from the product — there is no waitlist confirmation
> email to configure.

## How this implementation works

Unlike Loops (or ZeptoMail's own template editor), this client does **not** use a
dashboard-stored template or a template key. The invite email's HTML and plain-text bodies
are built directly in `lib/email/zeptomail.ts` (`buildInviteHtml` / `buildInviteText`) and
sent as a raw `htmlbody`/`textbody` payload to ZeptoMail's `/v1/email` send endpoint. There
is nothing to create in the ZeptoMail dashboard beyond the Mail Agent and a verified sender
domain — you do not need to build a template or copy a template key.

## 1. Create a Mail Agent

1. Log in to the [ZeptoMail dashboard](https://www.zoho.com/zeptomail/).
2. Go to **Mail Agents** → create one (or use an existing one) for Floventro.
3. Under the Mail Agent, go to **Setup → Domains** and verify a sending domain
   (SPF/DKIM records with your DNS provider). Sends will fail until the domain is verified.

## 2. Get the Send Mail Token

1. In the Mail Agent, go to **Setup → SMTP/API → API**.
2. Copy the **Send Mail Token** (starts with `Zoho-enczapikey ...` — the client adds that
   prefix itself, so store only the token value). This is `ZEPTOMAIL_TOKEN`.

## 3. Required env vars

```env
ZEPTOMAIL_TOKEN=your-send-mail-token
ZEPTOMAIL_FROM=hello@floventro.com
ZEPTOMAIL_FROM_NAME=Floventro
```

- `ZEPTOMAIL_TOKEN` and `ZEPTOMAIL_FROM` are required — `sendInviteEmail` returns
  `{ok:false, error:"not_configured"}` if either is missing.
- `ZEPTOMAIL_FROM` must be an address on the domain verified in step 1.
- `ZEPTOMAIL_FROM_NAME` is optional and defaults to `"Floventro"`.
- `ZEPTOMAIL_TOKEN` is a server-only secret — never expose it as `NEXT_PUBLIC_*`.

## 4. Verify

Trigger a team invite from `/admin/team` (owner/admin role required) and confirm the email
arrives. Failures are logged server-side with the `[zeptomail]` prefix and surface in the
invite modal as "Email couldn't be sent" (or "isn't configured yet" if env vars are missing),
with a fallback accept link the admin can share directly either way.
