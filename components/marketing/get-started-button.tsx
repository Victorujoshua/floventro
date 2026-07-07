import Link from "next/link"

type Props = {
  variant?: "primary" | "outline" | "primary-on-dark"
  children?: React.ReactNode
}

export function GetStartedButton({ variant = "primary", children }: Props) {
  const styles = {
    primary:
      "bg-ink text-cream rounded-md px-5 h-11 text-sm font-medium hover:bg-ink/90 active:scale-[0.98] transition-all duration-150 inline-flex items-center",
    outline:
      "border border-ink/20 text-ink rounded-md px-5 h-11 text-sm font-medium hover:bg-ink/5 active:scale-[0.98] transition-all duration-150 inline-flex items-center",
    "primary-on-dark":
      "bg-cream text-ink rounded-md px-5 h-11 text-sm font-medium hover:bg-white active:scale-[0.98] transition-all duration-150 inline-flex items-center",
  }

  return (
    <Link href="https://app.floventro.com" className={styles[variant]}>
      {children ?? "Get started →"}
    </Link>
  )
}
