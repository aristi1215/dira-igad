import type { ReactElement, ReactNode } from 'react'
import { cx } from '../../lib/cx'

export type BentoSpan = 1 | 2 | 3 | 4 | 6
export type BentoTone = 'default' | 'quiet' | 'accent' | 'inverse'

const COL_SPAN: Record<BentoSpan, string> = {
  1: 'col-span-1',
  2: 'col-span-2',
  3: 'col-span-3',
  4: 'col-span-4',
  6: 'col-span-2 md:col-span-4 lg:col-span-6',
}

const ROW_SPAN: Record<1 | 2 | 3, string> = {
  1: 'row-span-1',
  2: 'row-span-2',
  3: 'row-span-3',
}

const TONE: Record<BentoTone, string> = {
  default: 'bg-surface text-ink',
  quiet: 'bg-surface-2 text-ink',
  accent: 'border-accent bg-accent-soft text-ink',
  inverse: 'border-line-strong bg-surface-3 text-ink',
}

export function BentoGrid({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}): ReactElement {
  return <div className={cx('grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6 lg:gap-4', className)}>{children}</div>
}

export type BentoCardProps = {
  span?: BentoSpan
  rowSpan?: 1 | 2 | 3
  eyebrow?: ReactNode
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  tone?: BentoTone
  interactive?: boolean
  padded?: boolean
  className?: string
  children?: ReactNode
}

export function BentoCard({
  span = 2,
  rowSpan = 1,
  eyebrow,
  title,
  subtitle,
  actions,
  footer,
  tone = 'default',
  interactive = false,
  padded = true,
  className,
  children,
}: BentoCardProps): ReactElement {
  const hasHeader = Boolean(eyebrow || title || actions)
  return (
    <article
      className={cx(
        'relative flex min-w-0 flex-col overflow-hidden rounded-bento border border-line shadow-bento transition-[transform,box-shadow] duration-200 ease-entrance',
        COL_SPAN[span],
        ROW_SPAN[rowSpan],
        TONE[tone],
        interactive && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-lg',
        className,
      )}
    >
      {hasHeader ? (
        <header className={cx('flex items-start justify-between gap-3', padded && 'px-5 pt-5')}>
          <div className="min-w-0">
            {eyebrow ? <p className="text-eyebrow uppercase opacity-70">{eyebrow}</p> : null}
            {title ? <h2 className="mt-1 text-md font-semibold tracking-[-0.01em]">{title}</h2> : null}
            {subtitle ? <p className="mt-1 text-sm opacity-70">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cx('min-w-0 flex-1', padded && (hasHeader ? 'px-5 pb-5' : 'p-5'))}>{children}</div>
      {footer ? <footer className={cx('text-xs opacity-70', padded && 'px-5 pb-5')}>{footer}</footer> : null}
    </article>
  )
}
