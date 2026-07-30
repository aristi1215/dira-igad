import { motion } from 'motion/react'
import type { Rect } from '../../lib/anchor'
import { EASE } from '../../lib/motion'

const RADIUS = 18

/**
 * The dimming scrim with a hole cut out of it.
 *
 * An SVG mask is used rather than the `box-shadow: 0 0 0 9999px` trick (which
 * cannot animate its shape or radius, and clips at viewport edges) or a
 * clip-path polygon (which animates inconsistently across browsers). A single
 * <rect>'s x/y/width/height/rx animate cleanly on a spring, which is what
 * makes the movement between anchors read as deliberate rather than janky.
 *
 * This layer is purely visual: `pointer-events: none` throughout. Blocking
 * clicks is a separate concern handled by <Blockers>, so an interactive step
 * can let real clicks through while still looking identical.
 */
export function Spotlight({ rect, reduceMotion }: { rect: Rect | null; reduceMotion: boolean }) {
  const transition = reduceMotion ? { duration: 0 } : { duration: 0.3, ease: EASE.entrance }

  // With no anchor yet, dim everything and cut nothing.
  const target = rect ?? { top: -9999, left: -9999, width: 0, height: 0 }

  return (
    <div className="pointer-events-none fixed inset-0 z-tour" aria-hidden>
      <svg className="h-full w-full">
        <defs>
          <mask id="dira-tour-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="#ffffff" />
            <motion.rect
              fill="#000000"
              rx={RADIUS}
              initial={false}
              animate={{
                x: target.left,
                y: target.top,
                width: target.width,
                height: target.height,
              }}
              transition={transition}
            />
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="color-mix(in srgb, var(--color-ink) 55%, transparent)"
          mask="url(#dira-tour-mask)"
        />
      </svg>

      {rect ? (
        <motion.div
          className="absolute rounded-[18px] ring-[1.5px] ring-accent"
          style={{
            boxShadow: '0 0 0 4px color-mix(in srgb, var(--color-accent) 15%, transparent)',
          }}
          initial={false}
          animate={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
          transition={transition}
        />
      ) : null}
    </div>
  )
}

/**
 * Four transparent panes forming a frame around the hole. Keeping them separate
 * from the mask is what lets `interactive` steps simply skip rendering them.
 */
export function Blockers({ rect, onClick }: { rect: Rect | null; onClick: () => void }) {
  if (!rect) {
    return <div className="fixed inset-0 z-tour" onClick={onClick} aria-hidden />
  }

  const panes = [
    { top: 0, left: 0, right: 0, height: Math.max(0, rect.top) },
    {
      top: Math.max(0, rect.top),
      left: 0,
      width: Math.max(0, rect.left),
      height: rect.height,
    },
    {
      top: Math.max(0, rect.top),
      left: rect.left + rect.width,
      right: 0,
      height: rect.height,
    },
    { top: rect.top + rect.height, left: 0, right: 0, bottom: 0 },
  ]

  return (
    <>
      {panes.map((style, index) => (
        <div
          key={index}
          className="fixed z-tour"
          style={style as React.CSSProperties}
          onClick={onClick}
          aria-hidden
        />
      ))}
    </>
  )
}
