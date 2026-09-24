// Marks a session as having been established by a password-reset link.
// Set by /auth/callback after a successful recovery verifyOtp, and required
// by /reset-password so the page can't be reached with an ordinary login
// session. The value is the user id, so a stale cookie can't be reused by a
// different account on the same browser.
export const RECOVERY_COOKIE = "fv_pw_recovery"

export const RECOVERY_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 60 * 15,
  path: "/",
}
