import { ForgotPasswordForm } from "./forgot-password-form"

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  return <ForgotPasswordForm linkError={error} />
}
