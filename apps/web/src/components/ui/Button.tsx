import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Loader2, type LucideIcon } from 'lucide-react'
import { cx } from '../../lib/cx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

// Full literal class names — Tailwind cannot see interpolated strings.
const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-white border border-accent hover:bg-accent-hover hover:border-accent-hover',
  secondary:
    'bg-surface text-ink border border-line-strong hover:bg-surface-2 hover:border-faint',
  ghost:
    'bg-transparent text-muted border border-transparent hover:bg-surface-3 hover:text-ink',
  // `--color-danger`, not `err-fg`: that one is a text token and inverts in dark.
  danger:
    'bg-danger text-white border border-danger hover:bg-danger-hover hover:border-danger-hover',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-8.5 px-3.5 text-sm gap-2',
}

/*
 * Radius is a shape decision, not a size one, so it does not live in `SIZE`.
 * Labelled buttons are pills; an icon-only button is square-ish, and a pill
 * around a single 16px glyph reads as a stray dot.
 */
const PILL = 'rounded-full'
const ICON_SHAPE = 'rounded-md'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: LucideIcon
  iconRight?: LucideIcon
  loading?: boolean
  /** Stretch to the container width — common for the primary action in panels. */
  block?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon: Icon,
    iconRight: IconRight,
    loading = false,
    block = false,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  const iconSize = size === 'sm' ? 14 : 16
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center font-medium whitespace-nowrap',
        'transition-[transform,background-color] duration-150 ease-standard',
        variant === 'primary' && 'active:scale-[0.98]',
        'disabled:cursor-not-allowed disabled:opacity-55',
        VARIANT[variant],
        SIZE[size],
        PILL,
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 size={iconSize} strokeWidth={2} className="animate-spin" aria-hidden />
      ) : Icon ? (
        <Icon size={iconSize} strokeWidth={1.75} aria-hidden />
      ) : null}
      {children}
      {IconRight && !loading ? (
        <IconRight size={iconSize} strokeWidth={1.75} aria-hidden />
      ) : null}
    </button>
  )
})

/** Icon-only button. Requires a label — it is the accessible name. */
export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, 'icon' | 'iconRight' | 'children' | 'block'> & {
    icon: LucideIcon
    label: string
  }
>(function IconButton(
  { icon: Icon, label, variant = 'ghost', size = 'md', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex items-center justify-center',
        ICON_SHAPE,
        'transition-colors duration-[120ms] ease-standard',
        'disabled:cursor-not-allowed disabled:opacity-55',
        VARIANT[variant],
        size === 'sm' ? 'h-7 w-7' : 'h-8.5 w-8.5',
        className,
      )}
      {...rest}
    >
      <Icon size={size === 'sm' ? 14 : 16} strokeWidth={1.75} aria-hidden />
    </button>
  )
})
