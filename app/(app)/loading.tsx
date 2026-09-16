export default function AppLoading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-7 w-44 rounded-md bg-neutral-100" />
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-10 w-full rounded-md bg-neutral-100" />
        ))}
      </div>
    </div>
  )
}
