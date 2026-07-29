import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'

export function Card({
  title,
  subtitle,
  children,
  actions,
  className,
  padded = true,
}: {
  title?: string
  subtitle?: string
  children: ReactNode
  actions?: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <section
      className={cx(
        'flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface',
        'transition-shadow duration-[180ms] ease-standard hover:shadow-sm',
        className,
      )}
    >
      {title || actions ? (
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title ? (
              <h2 className="text-md leading-tight font-semibold text-ink">{title}</h2>
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
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-2xs font-semibold tracking-[0.08em] text-accent uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl leading-tight font-semibold tracking-[-0.015em] text-ink">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-[62ch] text-base text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
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
        <h2 className="text-md font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-faint">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/** Standard scrolling screen container for every non-map route. */
export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('mx-auto w-full max-w-[1240px] px-6 pt-6 pb-12', className)}>
      {children}
    </div>
  )
}
