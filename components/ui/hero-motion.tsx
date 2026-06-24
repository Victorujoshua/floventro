import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion'

const INK = '#151D27'
const INK_MUTED = '#5C6068'
const CREAM = '#F5F1EA'
const BORDER = '#E5E0D6'
const MONO = "'JetBrains Mono', 'Courier New', monospace"
const TOTAL = 240

const OPERATIONS = [
  { op: 'RECEIVED', item: 'Minoxidil 5% 60ml',  loc: 'B01',     qty: '×48' },
  { op: 'TRANSFER', item: 'Face Serum 30ml',     loc: 'B02→B04', qty: '×12' },
  { op: 'SOLD',     item: 'Laser Session',        loc: 'B03',     qty: '×1'  },
  { op: 'REQUEST',  item: 'IV Vitamin C Amp',     loc: '—',       qty: ''    },
  { op: 'APPROVED', item: 'Shampoo Pro 400ml',    loc: 'B01',     qty: '×20' },
]

export function HeroComposition() {
  const frame = useCurrentFrame()

  // Sweeps from above the first row to below the last row over the full 3 s clip.
  // At each loop boundary the scan re-enters from the top — seamless repeat.
  const activePosition = interpolate(
    frame,
    [0, TOTAL],
    [-0.5, OPERATIONS.length + 0.5],
  )

  // Blinking cursor for REQUEST row
  const cursor = Math.floor(frame / 15) % 2 === 0

  return (
    <AbsoluteFill style={{ background: CREAM }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '36px 32px',
          fontFamily: MONO,
        }}
      >
        {/* Eyebrow — mirrors the terminal lines in the left hero column */}
        <div
          style={{
            fontSize: 9,
            letterSpacing: '0.06em',
            color: INK_MUTED,
            marginBottom: 14,
          }}
        >
          &gt; operations
        </div>

        {/* Rule */}
        <div style={{ height: 1, background: BORDER, marginBottom: 12 }} />

        {/* Rows */}
        {OPERATIONS.map((row, i) => {
          // dist = 0 when activePosition is exactly on this row
          const dist = Math.abs(activePosition - i)
          // Bright within ~0.9 rows of center, fully muted beyond ~1.3 rows
          const brightFactor = Math.max(0, 1 - dist / 0.9)
          const opacity = 0.17 + 0.83 * brightFactor
          const dotScale = Math.max(0, 1 - dist / 0.55)
          const isRequest = row.op === 'REQUEST'

          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                height: 36,
                opacity,
                // Subtle row tint that follows the scan
                background: `rgba(21,29,39,${0.04 * brightFactor})`,
                borderBottom:
                  i < OPERATIONS.length - 1
                    ? '1px solid rgba(21,29,39,0.07)'
                    : 'none',
                // Bleed the tint to the horizontal padding edges
                margin: '0 -8px',
                padding: '0 8px',
              }}
            >
              {/* Indicator dot — scales in as scan passes through */}
              <span
                style={{
                  width: 5,
                  height: 5,
                  background: INK,
                  display: 'inline-block',
                  flexShrink: 0,
                  marginRight: 12,
                  opacity: dotScale,
                  transform: `scale(${dotScale})`,
                  transformOrigin: 'center',
                }}
              />

              {/* Operation label */}
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: '0.08em',
                  color: INK,
                  width: 72,
                  flexShrink: 0,
                }}
              >
                {row.op}
              </span>

              {/* Item name */}
              <span
                style={{
                  fontSize: 10,
                  color: INK,
                  flex: 1,
                  whiteSpace: 'nowrap' as const,
                  overflow: 'hidden',
                }}
              >
                {row.item}
              </span>

              {/* Branch / location */}
              <span
                style={{
                  fontSize: 9,
                  color: INK_MUTED,
                  marginLeft: 8,
                  width: 60,
                  textAlign: 'right' as const,
                  flexShrink: 0,
                  letterSpacing: '0.04em',
                }}
              >
                {row.loc}
              </span>

              {/* Quantity — REQUEST shows blinking cursor while scan is near */}
              <span
                style={{
                  fontSize: 9,
                  color: INK,
                  marginLeft: 8,
                  width: 28,
                  textAlign: 'right' as const,
                  flexShrink: 0,
                }}
              >
                {isRequest && dist < 0.5 ? (cursor ? '█' : ' ') : row.qty}
              </span>
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}
