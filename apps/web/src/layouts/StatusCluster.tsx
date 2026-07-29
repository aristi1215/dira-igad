import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Activity, Database, Radio, RefreshCw } from 'lucide-react'
import { cx } from '../lib/cx'
import { T } from '../lib/motion'

/**
 * "Cycle 2026-D21 · SEEDED · Live" used to be three bare chips — precise, and
 * completely undecodable to anyone seeing the app for the first time. They are
 * collapsed into one trigger that explains each in a sentence on demand, so the
 * detail stays available without being noise.
 */
export function StatusCluster({
  cycle,
  dataMode,
  degraded,
}: {
  cycle: string | null
  dataMode: string | null
  degraded: boolean
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const isLive = dataMode === 'live'

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        className={cx(
          'flex h-7 items-center gap-2 rounded-full border border-line bg-surface pr-2.5 pl-2',
          'text-2xs text-muted transition-colors duration-[120ms] ease-standard',
          'hover:border-line-strong hover:text-ink',
        )}
      >
        <span
          aria-hidden
          className={cx(
            'size-1.5 rounded-full',
            degraded ? 'bg-band-watch' : 'bg-band-ack',
          )}
        />
        <span className="font-medium">{degraded ? 'Polling' : 'Live'}</span>
        {cycle ? (
          <>
            <span aria-hidden className="h-3 w-px bg-line" />
            <span className="font-mono tabular-nums">{cycle}</span>
          </>
        ) : null}
        {dataMode ? (
          <>
            <span aria-hidden className="h-3 w-px bg-line" />
            <span className={cx('font-medium', isLive ? 'text-ok-fg' : 'text-faint')}>
              {isLive ? 'Live data' : 'Demo data'}
            </span>
          </>
        ) : null}
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            role="dialog"
            aria-label="System status"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={T.fast}
            className="absolute top-full right-0 z-header mt-2 w-80 rounded-lg border border-line bg-surface p-3 shadow-panel"
          >
            <ul className="flex flex-col gap-3">
              <StatusRow
                icon={degraded ? RefreshCw : Radio}
                title={degraded ? 'Polling every 5 seconds' : 'Live updates'}
                body={
                  degraded
                    ? 'The live connection dropped, so screens refresh on a timer instead. Data is still current, just a few seconds behind.'
                    : 'Changes stream in as they happen — new assessments, approvals, and call acknowledgements appear without a refresh.'
                }
              />
              {cycle ? (
                <StatusRow
                  icon={Activity}
                  title={`Cycle ${cycle}`}
                  body="Assessments are produced every 10 days. This is the most recent cycle — every score on screen comes from it."
                />
              ) : null}
              {dataMode ? (
                <StatusRow
                  icon={Database}
                  title={isLive ? 'Connected to live sources' : 'Running on demo data'}
                  body={
                    isLive
                      ? 'Conflict, climate, and humanitarian feeds are being read from their live endpoints.'
                      : 'Fixed sample data, so the demo behaves identically every run. No calls are placed and no live feeds are read.'
                  }
                />
              ) : null}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function StatusRow({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Activity
  title: string
  body: string
}) {
  return (
    <li className="flex gap-2.5">
      <Icon size={15} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-accent" />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{body}</p>
      </div>
    </li>
  )
}
