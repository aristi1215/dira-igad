import type { ReactNode } from 'react'
import {
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { cx } from '../../lib/cx'
import { SkeletonText } from './Skeleton'

export type CalloutTone = 'info' | 'warning' | 'danger' | 'success'

/*
 * Each tone pairs its own background with its own ink. The body used to be
 * `text-muted`, which reads against the *page*, not against the callout — so
 * inside a `.tone-inverse` plate (where `--color-muted` becomes a light grey)
 * the text landed on pale green and disappeared. The bg/fg status tokens are
 * designed as a pair and flip together, so pairing them is correct in both
 * themes and inside any plate.
 */
const CALLOUT: Record<CalloutTone, { box: string; icon: LucideIcon; ink: string }> = {
  info: { box: 'border-l-accent bg-info-bg', icon: Info, ink: 'text-info-fg' },
  warning: { box: 'border-l-band-elevated bg-warn-bg', icon: TriangleAlert, ink: 'text-warn-fg' },
  danger: { box: 'border-l-band-high bg-err-bg', icon: CircleAlert, ink: 'text-err-fg' },
  success: { box: 'border-l-band-ack bg-ok-bg', icon: CircleCheck, ink: 'text-ok-fg' },
}

export function Callout({
  tone = 'info',
  title,
  icon,
  actions,
  children,
  className,
}: {
  tone?: CalloutTone
  title?: string
  icon?: LucideIcon
  actions?: ReactNode
  children?: ReactNode
  className?: string
}) {
  const config = CALLOUT[tone]
  const Icon = icon ?? config.icon
  return (
    <div
      className={cx(
        'flex items-start gap-3 rounded-md border border-line border-l-[3px] px-3.5 py-3',
        config.box,
        config.ink,
        className,
      )}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title ? <p className="text-sm font-semibold">{title}</p> : null}
        {children ? (
          <div className={cx('text-sm', title && 'mt-0.5')}>{children}</div>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon?: LucideIcon
  title?: string
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex flex-col items-center gap-2 px-4 py-8 text-center', className)}>
      {Icon ? <Icon size={20} strokeWidth={1.5} aria-hidden className="text-line-strong" /> : null}
      {title ? <p className="text-sm font-medium text-muted">{title}</p> : null}
      {children ? <p className="max-w-[46ch] text-sm text-faint">{children}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

/**
 * Superseded by Skeleton for predictable layouts; kept so screens can migrate
 * one at a time. Removed in the final cleanup pass.
 */
export function LoadingNote({ children = 'Loading…' }: { children?: ReactNode }) {
  return (
    <p className="px-1 py-3 text-sm text-faint" role="status">
      {children}
    </p>
  )
}

export function ErrorNote({ error, className }: { error: unknown; className?: string }) {
  const message = error instanceof Error ? error.message : 'Request failed'
  return (
    <Callout tone="danger" className={className}>
      {message}
    </Callout>
  )
}

/** Loading / error / empty in one place, so screens stop hand-rolling all three. */
export function QueryState({
  isLoading,
  error,
  isEmpty,
  empty,
  skeleton,
  children,
}: {
  isLoading: boolean
  error?: unknown
  isEmpty?: boolean
  empty?: ReactNode
  skeleton?: ReactNode
  children: ReactNode
}) {
  if (isLoading) {
    return <>{skeleton ?? <SkeletonText lines={3} />}</>
  }
  if (error) {
    return <ErrorNote error={error} />
  }
  if (isEmpty) {
    return <>{empty ?? <EmptyState>Nothing to show yet.</EmptyState>}</>
  }
  return <>{children}</>
}
