import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'

/** Card, page and section framing. */
export function Card({
  title,
  subtitle,
  children,
  actions,
  className,
  padded = true,
  /** Band or status color for the 2px header rule. Omit for a neutral card. */
  accent,
}: {
  title?: string
  subtitle?: string
  children: ReactNode
  actions?: ReactNode
  className?: string
  padded?: boolean
  accent?: string
}) {
  return (
    <section
      className={cx(
        'group/card relative flex min-w-0 flex-col overflow-hidden rounded-bento border border-line bg-surface',
        'shadow-bento transition-shadow duration-200 ease-entrance hover:shadow-lg',
        className,
      )}
    >
      {accent ? (
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-0.5"
          style={{ background: accent }}
        />
      ) : null}
      {title || actions ? (
        <div className="flex items-start justify-between gap-3 px-4 pt-4">
          <div className="min-w-0">
            {title ? (
              <h2 className="text-md leading-tight font-semibold tracking-[-0.01em] text-ink">
                {title}
              </h2>
            ) : null}
            {subtitle ? <p className="mt-0.5 text-xs text-faint">{subtitle}</p> : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
      <div className={cx('min-w-0 flex-1', padded && 'p-4')}>{children}</div>
    </section>
  )
}

/**
 * Page title block.
 *
 * The description sits below the title for a calmer reading hierarchy.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
}) {
  /*
   * Tighter than it was. At text-3xl with a text-md description and 24px of
   * margin, the header ate the top fifth of every screen before a single
   * figure appeared — on screens whose entire job is figures.
   */
  return (
    <header className="mb-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {eyebrow ? (
            <Eyebrow className="text-accent-deep">{eyebrow}</Eyebrow>
          ) : null}
          <h1 className="mt-0.5 text-2xl font-semibold tracking-[-0.02em] text-ink">
            {title}
          </h1>
          {description ? (
            <p className="mt-1.5 max-w-[76ch] text-sm leading-relaxed text-faint">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  )
}

export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string
  description?: string
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('mb-3 flex items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="text-md font-semibold tracking-[-0.01em] text-ink">
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-xs text-faint">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/**
 * A titled band of a screen.
 */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  id?: string
}) {
  return (
    <section id={id} className={cx('mb-6', className)}>
      <div className="mb-4 flex items-center gap-3">
        <Eyebrow>{title}</Eyebrow>
        {description ? (
          <p className="shrink-0 text-xs text-faint">{description}</p>
        ) : null}
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

/**
 * Standard scrolling screen container for every non-map route.
 *
 * `wide` is for tables and boards, which were losing ~340px of gutter on each
 * side at 1920. `reading` keeps a comfortable measure for the prose-led screens.
 */
const SCREEN_WIDTH: Record<'default' | 'wide' | 'reading', string> = {
  default: 'max-w-[1240px]',
  wide: 'max-w-[1600px]',
  reading: 'max-w-[1080px]',
}

export function Screen({
  children,
  className,
  width = 'default',
}: {
  children: ReactNode
  className?: string
  width?: 'default' | 'wide' | 'reading'
}) {
  return (
    <div className={cx('mx-auto w-full px-6 pt-6 pb-12 lg:px-10', SCREEN_WIDTH[width], className)}>
      {children}
    </div>
  )
}

export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <span className={cx('text-eyebrow text-faint uppercase', className)}>{children}</span>
}
