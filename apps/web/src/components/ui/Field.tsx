import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { cx } from '../../lib/cx'

const CONTROL = cx(
  'h-8.5 w-full rounded-sm border border-line-strong bg-surface px-2.5 text-sm text-ink',
  'transition-colors duration-[120ms] ease-standard',
  'placeholder:text-faint hover:border-faint',
  'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring',
  'disabled:cursor-not-allowed disabled:opacity-55',
)

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string
  hint?: ReactNode
  error?: ReactNode
  htmlFor?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className="font-condensed text-2xs font-semibold tracking-[0.09em] text-muted uppercase"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-err-fg">{error}</p>
      ) : hint ? (
        <p className="text-xs text-faint">{hint}</p>
      ) : null}
    </div>
  )
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...rest }, ref) {
    return <input ref={ref} className={cx(CONTROL, className)} {...rest} />
  },
)

/** Native <select> with an overlaid chevron — keyboard and a11y behaviour for free. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cx(CONTROL, 'cursor-pointer appearance-none pr-8', className)}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown
          size={14}
          strokeWidth={1.75}
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-faint"
        />
      </div>
    )
  },
)

export function SearchInput({
  className,
  label = 'Search',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const id = useId()
  return (
    <div className={cx('relative', className)}>
      <Search
        size={14}
        strokeWidth={1.75}
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint"
      />
      <input id={id} type="search" aria-label={label} className={cx(CONTROL, 'pl-8')} {...rest} />
    </div>
  )
}
