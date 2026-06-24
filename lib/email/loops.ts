type LoopsContactPayload = {
  email: string
  firstName?: string
  source?: string
  userGroup?: string
  company?: string
  role?: string
  branchCount?: string
}

export async function addWaitlistContact(payload: LoopsContactPayload) {
  const apiKey = process.env.LOOPS_API_KEY
  if (!apiKey) {
    console.error("[loops] LOOPS_API_KEY not set")
    return { ok: false }
  }

  try {
    const res = await fetch("https://app.loops.so/api/v1/contacts/create", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: payload.email,
        firstName: payload.firstName,
        source: payload.source ?? "waitlist",
        userGroup: payload.userGroup ?? "waitlist",
        company: payload.company,
        role: payload.role,
        branchCount: payload.branchCount,
      }),
    })

    if (!res.ok) {
      // 409 = contact already exists — acceptable
      if (res.status === 409) return { ok: true, alreadyExists: true }
      const body = await res.text().catch(() => "(unreadable)")
      console.error("[loops] contact create failed:", res.status, body)
      return { ok: false }
    }

    return { ok: true }
  } catch (err) {
    console.error("[loops] contact create error:", err)
    return { ok: false }
  }
}

export async function sendWaitlistConfirmation(email: string, firstName?: string) {
  const apiKey = process.env.LOOPS_API_KEY
  const transactionalId = process.env.LOOPS_WAITLIST_TRANSACTIONAL_ID

  if (!apiKey || !transactionalId) {
    console.error("[loops] LOOPS_API_KEY or LOOPS_WAITLIST_TRANSACTIONAL_ID not set")
    return { ok: false }
  }

  try {
    const res = await fetch("https://app.loops.so/api/v1/transactional", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transactionalId,
        email,
        dataVariables: {
          firstName: firstName ?? "there",
        },
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "(unreadable)")
      console.error("[loops] transactional failed:", res.status, body)
      return { ok: false }
    }

    return { ok: true }
  } catch (err) {
    console.error("[loops] transactional error:", err)
    return { ok: false }
  }
}
