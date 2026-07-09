# Loops — Invite Email Setup

One-time setup to wire up the team-invite transactional email.

## 1. Compile the MJML template

Install the MJML CLI if you don't have it:
```
npm install -g mjml
```

Compile `docs/email-templates/invite.mjml` to HTML:
```
mjml docs/email-templates/invite.mjml -o docs/email-templates/invite.html
```

## 2. Create the transactional email in Loops

1. Go to **Loops → Transactional → New transactional email**.
2. Name it **Floventro Invite** (internal label — won't appear in the email).
3. In the editor, switch to **HTML** mode and paste the compiled `invite.html` output.
4. Add the following **data variables** (Loops requires you to declare them):

   | Variable name      | Example value                                      |
   |--------------------|---------------------------------------------------|
   | `inviterName`      | Victor Okafor                                     |
   | `organisationName` | Acme Distribution Ltd                             |
   | `role`             | inventory                                          |
   | `acceptUrl`        | https://app.floventro.com/accept-invite/abc123def |

   > These names were chosen to avoid collisions with Loops built-in contact
   > properties (`firstName`, `email`, etc.). Do not rename them — they must
   > match exactly what the app sends.

5. Send yourself a test using the test-variables panel to confirm the button
   links to `acceptUrl` and the copy renders correctly.
6. Save and **publish** the transactional email.

## 3. Copy the Transactional ID

After saving, Loops shows the transactional email's ID (a string like
`cm3abc123...`). Copy it.

## 4. Set the env var

**`.env.local`** (local development):
```
LOOPS_INVITE_TRANSACTIONAL_ID=<paste ID here>
```

**Vercel** (production — use the `floventro-app` project, not the marketing site):
1. Go to Vercel → floventro-app → Settings → Environment Variables.
2. Add `LOOPS_INVITE_TRANSACTIONAL_ID` with the same value.
3. Redeploy (or the next deployment picks it up automatically).

## 5. Verify

Send a real invite from the Team page (`/admin/team`). The invitee should
receive the email within seconds. The accept link
`https://app.floventro.com/accept-invite/{token}` should open the accept-invite
page (Task 4.4).
