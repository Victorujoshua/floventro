import { cn } from "@/lib/utils"

interface ContainerProps {
  className?: string
  children: React.ReactNode
}

export function Container({ className, children }: ContainerProps) {
  return (
    <div className={cn("mx-auto w-full max-w-content px-6 md:px-12", className)}>
      {children}
    </div>
  )
}
