type ZeptoResult = { ok: true } | { ok: false; error: "not_configured" | "send_failed" | "network" }

export async function sendEmail(params: {
  to: { address: string; name?: string }
  subject: string
  htmlBody: string
  textBody?: string
}): Promise<ZeptoResult> {
  const token = process.env.ZEPTOMAIL_TOKEN
  const fromAddress = process.env.ZEPTOMAIL_FROM
  const fromName = process.env.ZEPTOMAIL_FROM_NAME ?? "Floventro"

  if (!token || !fromAddress) {
    const missing = [!token && "ZEPTOMAIL_TOKEN", !fromAddress && "ZEPTOMAIL_FROM"]
      .filter(Boolean)
      .join(", ")
    console.error(`[zeptomail] missing env var(s): ${missing}`)
    return { ok: false, error: "not_configured" }
  }

  try {
    const apiHost = process.env.ZEPTOMAIL_API_HOST ?? "api.zeptomail.com"
    const res = await fetch(`https://${apiHost}/v1.1/email`, {
      method: "POST",
      headers: {
        Authorization: `Zoho-enczapikey ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        from: { address: fromAddress, name: fromName },
        to: [
          {
            email_address: {
              address: params.to.address,
              name: params.to.name ?? "",
            },
          },
        ],
        subject: params.subject,
        htmlbody: params.htmlBody,
        ...(params.textBody ? { textbody: params.textBody } : {}),
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "(unreadable)")
      console.error("[zeptomail] send failed | status:", res.status, "| body:", body)
      return { ok: false, error: "send_failed" }
    }

    return { ok: true }
  } catch (err) {
    console.error("[zeptomail] network error:", err)
    return { ok: false, error: "network" }
  }
}

export async function sendInviteEmail(params: {
  email: string
  inviterName: string
  organisationName: string
  role: string
  acceptUrl: string
}): Promise<ZeptoResult> {
  return sendEmail({
    to: { address: params.email },
    subject: `You're invited to join ${params.organisationName} on Floventro`,
    htmlBody: buildInviteHtml(params),
    textBody: buildInviteText(params),
  })
}

export async function sendPasswordResetEmail(params: {
  email: string
  resetUrl: string
}): Promise<ZeptoResult> {
  return sendEmail({
    to: { address: params.email },
    subject: "Reset your Floventro password",
    htmlBody: buildPasswordResetHtml(params),
    textBody: buildPasswordResetText(params),
  })
}

// Escapes user-supplied strings for safe HTML embedding.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function buildInviteHtml(p: {
  inviterName: string
  organisationName: string
  role: string
  acceptUrl: string
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>You're invited to join ${esc(p.organisationName)} on Floventro</title>
</head>
<body style="margin:0;padding:0;background-color:#F5F1EA;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F5F1EA;">
  <tr><td align="center" style="padding:32px 16px 40px;">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td style="padding-bottom:24px;">
        <img src="https://i.ibb.co/sdFSCTnS/Frame-1-4.png" alt="Floventro" width="140" style="display:block;border:0;">
      </td></tr>
      <tr><td style="border-bottom:1px solid #E5E0D6;padding-bottom:24px;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td height="24"></td></tr>
      <tr><td style="background:#FFFFFF;border-radius:12px;padding:40px 40px 32px;">
        <h1 style="margin:0 0 16px;font-size:24px;font-weight:600;line-height:1.2;color:#151D27;font-family:Arial,sans-serif;">
          You&rsquo;re invited to ${esc(p.organisationName)}
        </h1>
        <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#5C6068;font-family:Arial,sans-serif;">Hi there,</p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#5C6068;font-family:Arial,sans-serif;">
          <strong style="color:#151D27;">${esc(p.inviterName)}</strong> has invited you to join
          <strong style="color:#151D27;">${esc(p.organisationName)}</strong> on Floventro as
          <strong style="color:#151D27;">${esc(p.role)}</strong>.
        </p>
        <a href="${esc(p.acceptUrl)}"
           style="display:inline-block;background-color:#4A02C8;color:#FFFFFF;font-size:14px;font-weight:500;text-decoration:none;border-radius:8px;padding:12px 24px;font-family:Arial,sans-serif;">
          Accept invitation &#8594;
        </a>
        <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#9BA0A8;font-family:Arial,sans-serif;">
          This invite expires in 7&nbsp;days. If you weren&rsquo;t expecting this, you can safely
          ignore this email &mdash; no account will be created without your action.
        </p>
      </td></tr>
      <tr><td style="padding:32px 0 0;">
        <p style="margin:0;font-size:14px;color:#5C6068;font-family:Arial,sans-serif;">&mdash; The Floventro Team</p>
      </td></tr>
      <tr><td style="border-bottom:1px solid #E5E0D6;padding:24px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td style="padding-top:20px;">
        <p style="margin:0;font-size:12px;line-height:1.5;color:#9BA0A8;font-family:Arial,sans-serif;">
          Floventro &middot; hello@floventro.com<br>
          You received this email because someone invited you to join their workspace.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}

function buildInviteText(p: {
  inviterName: string
  organisationName: string
  role: string
  acceptUrl: string
}): string {
  return `You're invited to join ${p.organisationName} on Floventro

Hi there,

${p.inviterName} has invited you to join ${p.organisationName} on Floventro as ${p.role}.

Accept your invitation:
${p.acceptUrl}

This invite expires in 7 days. If you weren't expecting this, you can safely ignore this email — no account will be created without your action.

— The Floventro Team`
}

function buildPasswordResetHtml(p: { resetUrl: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reset your Floventro password</title>
</head>
<body style="margin:0;padding:0;background-color:#F5F1EA;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F5F1EA;">
  <tr><td align="center" style="padding:32px 16px 40px;">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td style="padding-bottom:24px;">
        <img src="https://i.ibb.co/sdFSCTnS/Frame-1-4.png" alt="Floventro" width="140" style="display:block;border:0;">
      </td></tr>
      <tr><td style="border-bottom:1px solid #E5E0D6;padding-bottom:24px;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td height="24"></td></tr>
      <tr><td style="background:#FFFFFF;border-radius:12px;padding:40px 40px 32px;">
        <h1 style="margin:0 0 16px;font-size:24px;font-weight:600;line-height:1.2;color:#151D27;font-family:Arial,sans-serif;">
          Reset your password
        </h1>
        <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#5C6068;font-family:Arial,sans-serif;">Hi there,</p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#5C6068;font-family:Arial,sans-serif;">
          We received a request to reset the password for your Floventro account.
          Click the button below to choose a new one.
        </p>
        <a href="${esc(p.resetUrl)}"
           style="display:inline-block;background-color:#4A02C8;color:#FFFFFF;font-size:14px;font-weight:500;text-decoration:none;border-radius:8px;padding:12px 24px;font-family:Arial,sans-serif;">
          Reset password &#8594;
        </a>
        <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#9BA0A8;font-family:Arial,sans-serif;">
          This link expires in 1&nbsp;hour and can only be used once. If you didn&rsquo;t ask to reset
          your password, you can safely ignore this email &mdash; your password won&rsquo;t change.
        </p>
      </td></tr>
      <tr><td style="padding:32px 0 0;">
        <p style="margin:0;font-size:14px;color:#5C6068;font-family:Arial,sans-serif;">&mdash; The Floventro Team</p>
      </td></tr>
      <tr><td style="border-bottom:1px solid #E5E0D6;padding:24px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td style="padding-top:20px;">
        <p style="margin:0;font-size:12px;line-height:1.5;color:#9BA0A8;font-family:Arial,sans-serif;">
          Floventro &middot; hello@floventro.com<br>
          You received this email because a password reset was requested for your account.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}

function buildPasswordResetText(p: { resetUrl: string }): string {
  return `Reset your Floventro password

Hi there,

We received a request to reset the password for your Floventro account. Open the link below to choose a new one:
${p.resetUrl}

This link expires in 1 hour and can only be used once. If you didn't ask to reset your password, you can safely ignore this email — your password won't change.

— The Floventro Team`
}
