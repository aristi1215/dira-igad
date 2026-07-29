import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { cx } from '../../lib/cx'
import { Skeleton } from './Skeleton'
import { EmptyState } from './Notes'

export type Column<T> = {
  key: string
  header: ReactNode
  align?: 'left' | 'right'
  width?: string
  render?: (row: T) => ReactNode
  /** Return a comparable value to enable click-to-sort on this column. */
  sortBy?: (row: T) => number | string | null | undefined
  /** Hidden below the `lg` breakpoint — use for secondary columns. */
  secondary?: boolean
}

type SortState = { key: string; dir: 'asc' | 'desc' } | null

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  onRowClick,
  rowAccent,
  defaultSort,
  loading = false,
  empty,
  className,
  caption,
}: {
  columns: Column<T>[]
  rows: T[]
  getRowId: (row: T) => string
  onRowClick?: (row: T) => void
  /** CSS color for a 3px left edge — usually the row's band color. */
  rowAccent?: (row: T) => string | undefined
  defaultSort?: { key: string; dir: 'asc' | 'desc' }
  loading?: boolean
  empty?: ReactNode
  className?: string
  caption?: string
}) {
  const [sort, setSort] = useState<SortState>(defaultSort ?? null)

  const sortColumn = sort ? columns.find((column) => column.key === sort.key) : undefined
  const sorted = sortColumn?.sortBy
    ? [...rows].sort((a, b) => {
        const result = compare(sortColumn.sortBy!(a), sortColumn.sortBy!(b))
        return sort!.dir === 'asc' ? result : -result
      })
    : rows

  const toggleSort = (column: Column<T>) => {
    if (!column.sortBy) return
    setSort((current) =>
      current?.key === column.key
        ? { key: column.key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key: column.key, dir: 'desc' },
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-4" role="status" aria-label="Loading">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-9" />
        ))}
      </div>
    )
  }

  if (sorted.length === 0) {
    return <>{empty ?? <EmptyState>No matching rows.</EmptyState>}</>
  }

  return (
    <div className={cx('w-full overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-line">
            {columns.map((column) => {
              const active = sort?.key === column.key
              const SortIcon = !active ? ChevronsUpDown : sort!.dir === 'asc' ? ChevronUp : ChevronDown
              return (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cx(
                    'px-3 py-2 text-2xs font-medium tracking-[0.04em] text-muted uppercase',
                    column.align === 'right' ? 'text-right' : 'text-left',
                    column.secondary && 'hidden lg:table-cell',
                  )}
                >
                  {column.sortBy ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column)}
                      className={cx(
                        'inline-flex items-center gap-1 rounded-xs transition-colors duration-[120ms] hover:text-ink',
                        column.align === 'right' && 'flex-row-reverse',
                        active && 'text-ink',
                      )}
                    >
                      {column.header}
                      <SortIcon size={12} strokeWidth={2} aria-hidden className={cx(!active && 'opacity-40')} />
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const accent = rowAccent?.(row)
            return (
              <tr
                key={getRowId(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onRowClick(row)
                        }
                      }
                    : undefined
                }
                className={cx(
                  'border-b border-line last:border-b-0',
                  'transition-colors duration-[120ms] ease-standard',
                  onRowClick && 'cursor-pointer hover:bg-accent-soft focus-visible:bg-accent-soft',
                )}
                style={accent ? { boxShadow: `inset 3px 0 0 ${accent}` } : undefined}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cx(
                      'px-3 py-2.5 text-ink',
                      column.align === 'right' ? 'text-right tabular-nums' : 'text-left',
                      column.secondary && 'hidden lg:table-cell',
                    )}
                  >
                    {column.render ? column.render(row) : String((row as Record<string, unknown>)[column.key] ?? '—')}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
