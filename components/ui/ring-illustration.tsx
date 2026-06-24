// TODO(illustration) — placeholder ring of boxes. Replace when final illustration is commissioned.

interface RingIllustrationProps {
  className?: string
  count?: number
}

export function RingIllustration({ className, count = 14 }: RingIllustrationProps) {
  const cx = 240
  const cy = 240
  const radius = 150
  const bw = 26
  const bh = 14

  return (
    <svg
      viewBox="0 0 480 480"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      {Array.from({ length: count }, (_, i) => {
        const angle = (i * 360) / count
        // Place each box at top of ring, then rotate around center
        return (
          <g key={i} transform={`rotate(${angle}, ${cx}, ${cy})`}>
            {/* Box outline */}
            <rect
              x={cx - bw / 2}
              y={cy - radius - bh / 2}
              width={bw}
              height={bh}
              rx={2.5}
              stroke="currentColor"
              strokeWidth={1.5}
            />
            {/* Box depth hint — small vertical line on right edge */}
            <line
              x1={cx + bw / 2}
              y1={cy - radius - bh / 2}
              x2={cx + bw / 2 + 4}
              y2={cy - radius - bh / 2 + 6}
              stroke="currentColor"
              strokeWidth={1}
              strokeOpacity={0.4}
            />
            <line
              x1={cx + bw / 2}
              y1={cy - radius + bh / 2}
              x2={cx + bw / 2 + 4}
              y2={cy - radius + bh / 2 + 6}
              stroke="currentColor"
              strokeWidth={1}
              strokeOpacity={0.4}
            />
            <line
              x1={cx + bw / 2 + 4}
              y1={cy - radius - bh / 2 + 6}
              x2={cx + bw / 2 + 4}
              y2={cy - radius + bh / 2 + 6}
              stroke="currentColor"
              strokeWidth={1}
              strokeOpacity={0.4}
            />
          </g>
        )
      })}
    </svg>
  )
}
