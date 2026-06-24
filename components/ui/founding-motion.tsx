import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion'

const CREAM = '#F5F1EA'
const DARK = '#0A0A0A'
const MONO = "'JetBrains Mono', 'Courier New', monospace"

const TOTAL = 360   // 12 s @ 30 fps — very slow loop
const DRAW_END = 300 // border finishes drawing at 10 s, holds for 2 s
const BOX_W = 252
const BOX_H = 148
const PERIMETER = 2 * (BOX_W + BOX_H)

export function FoundingComposition() {
  const frame = useCurrentFrame()

  // Border draws with a gentle ease-out over the first 10 s
  const drawProgress = interpolate(frame, [0, DRAW_END], [0, 1], {
    extrapolateRight: 'clamp',
    easing: (t) => 1 - Math.pow(1 - t, 1.5),
  })
  const dashOffset = PERIMETER * (1 - drawProgress)

  // "100" fades in over the first 40 frames
  const numOpacity = interpolate(frame, [0, 40], [0.15, 1], {
    extrapolateRight: 'clamp',
  })

  // After the border completes, a slow breath-pulse on the number
  const pulse =
    frame >= DRAW_END
      ? 0.88 + 0.12 * Math.sin(((frame - DRAW_END) / 45) * Math.PI)
      : numOpacity

  return (
    <AbsoluteFill
      style={{
        background: DARK,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: MONO,
      }}
    >
      {/* Eyebrow label */}
      <p
        style={{
          fontSize: 9,
          letterSpacing: '0.12em',
          color: 'rgba(245,241,234,0.32)',
          marginBottom: 28,
          textTransform: 'uppercase' as const,
        }}
      >
        founding members
      </p>

      {/* Box: SVG border + number */}
      <div style={{ position: 'relative', width: BOX_W, height: BOX_H }}>
        <svg
          width={BOX_W + 2}
          height={BOX_H + 2}
          style={{ position: 'absolute', top: -1, left: -1 }}
        >
          <rect
            x={1}
            y={1}
            width={BOX_W}
            height={BOX_H}
            fill="none"
            stroke="rgba(245,241,234,0.5)"
            strokeWidth={1}
            strokeDasharray={PERIMETER}
            strokeDashoffset={dashOffset}
          />
        </svg>

        <div
          style={{
            width: BOX_W,
            height: BOX_H,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 96,
            letterSpacing: '-0.03em',
            color: CREAM,
            opacity: pulse,
            lineHeight: 1,
          }}
        >
          100
        </div>
      </div>

      {/* Sub-label */}
      <p
        style={{
          fontSize: 9,
          letterSpacing: '0.1em',
          color: 'rgba(245,241,234,0.22)',
          marginTop: 24,
          textTransform: 'uppercase' as const,
        }}
      >
        slots · early access
      </p>
    </AbsoluteFill>
  )
}
