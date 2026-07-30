import { cx } from '../../lib/cx'

/**
 * Loading placeholders. The shimmer is a background-position animation, which
 * the global prefers-reduced-motion guard flattens to a static tint.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'block rounded-sm bg-surface-3 bg-[linear-gradient(90deg,var(--color-surface-3)_0%,var(--color-line)_50%,var(--color-surface-3)_100%)]',
        'bg-[length:180%_100%] animate-shimmer',
        className,
      )}
    />
  )
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cx('flex flex-col gap-2', className)} role="status" aria-label="Loading">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={cx('h-3', index === lines - 1 ? 'w-3/5' : 'w-full')}
        />
      ))}
    </div>
  )
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      // shadow-bento so content does not visibly gain elevation on arrival.
      className={cx('rounded-bento border border-line bg-surface p-4 shadow-bento', className)}
      role="status"
      aria-label="Loading"
    >
      <Skeleton className="mb-3 h-3.5 w-32" />
      <SkeletonText lines={3} />
    </div>
  )
}

/** Row placeholders for tables and the map watchlist. */
export function SkeletonRows({
  rows = 6,
  cols = 1,
  className,
}: {
  rows?: number
  cols?: number
  className?: string
}) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-3 py-1.5">
          {Array.from({ length: cols }, (_, colIndex) => (
            <Skeleton
              key={colIndex}
              className={cx('h-3.5', colIndex === 0 ? 'flex-2' : 'flex-1')}
              // Slight width jitter so a loading list doesn't read as a grid.
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Full-screen fallback for React.lazy route boundaries. */
export function ScreenSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1240px] px-6 pt-6 pb-12 lg:px-10" role="status" aria-label="Loading">
      <Skeleton className="mb-2 h-3 w-24" />
      <Skeleton className="mb-6 h-7 w-64" />
      <div className="mb-6 grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-3">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-20" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  )
}
