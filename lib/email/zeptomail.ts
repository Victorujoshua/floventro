type ZeptoResult = { ok: true } | { ok: false; error: string }

async function sendTemplatedEmail(params: {
  templateKey: string
  to: { address: string; name?: string }
  mergeInfo: Record<string, string>
}): Promise<ZeptoResult> {
  const token = process.env.ZEPTOMAIL_TOKEN
  const fromAddress = process.env.ZEPTOMAIL_FROM_ADDRESS
  const fromName = process.env.ZEPTOMAIL_FROM_NAME ?? "Floventro"

  if (!token || !fromAddress) {
    console.error("[zeptomail] ZEPTOMAIL_TOKEN or ZEPTOMAIL_FROM_ADDRESS not set")
    return { ok: false, error: "not_configured" }
  }

  try {
    const res = await fetch("https://api.zeptomail.com/v1.1/email/template", {
      method: "POST",
      headers: {
        Authorization: `Zoho-enczapikey ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        template_key: params.templateKey,
        from: { address: fromAddress, name: fromName },
        to: [
          {
            email_address: {
              address: params.to.address,
              name: params.to.name ?? "",
            },
          },
        ],
        merge_info: params.mergeInfo,
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "(unreadable)")
      console.error("[zeptomail] send failed:", res.status, body)
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
  const templateKey = process.env.ZEPTOMAIL_INVITE_TEMPLATE_KEY
  if (!templateKey) {
    console.error("[zeptomail] ZEPTOMAIL_INVITE_TEMPLATE_KEY not set")
    return { ok: false, error: "not_configured" }
  }

  return sendTemplatedEmail({
    templateKey,
    to: { address: params.email },
    mergeInfo: {
      inviterName: params.inviterName,
      organisationName: params.organisationName,
      role: params.role,
      acceptUrl: params.acceptUrl,
    },
  })
}
