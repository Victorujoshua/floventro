const ZEPTOMAIL_API = "https://api.zeptomail.com/v1.1/email/template"

type EmailResult = { ok: boolean }

export async function sendWaitlistConfirmation(
  email: string,
  fullName?: string,
): Promise<EmailResult> {
  const token = process.env.ZEPTOMAIL_API_TOKEN
  const fromAddress = process.env.ZEPTOMAIL_FROM_ADDRESS ?? "hello@floventro.com"
  const fromName = process.env.ZEPTOMAIL_FROM_NAME ?? "Floventro"
  const templateAlias = process.env.ZEPTOMAIL_WAITLIST_TEMPLATE_ALIAS ?? "waitlist-confirmation"

  if (!token) {
    console.error("[zeptomail] ZEPTOMAIL_API_TOKEN is not set")
    return { ok: false }
  }

  const firstName = fullName?.split(" ")[0] ?? "there"

  let response: Response
  try {
    response = await fetch(ZEPTOMAIL_API, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Zoho-enczapikey ${token}`,
      },
      body: JSON.stringify({
        mail_template_key: templateAlias,
        from: { address: fromAddress, name: fromName },
        to: [{ email_address: { address: email, name: fullName ?? email } }],
        merge_info: { first_name: firstName },
      }),
    })
  } catch (err) {
    console.error("[zeptomail] fetch error:", err)
    return { ok: false }
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)")
    console.error(`[zeptomail] non-2xx ${response.status}:`, body)
    return { ok: false }
  }

  return { ok: true }
}
