import { describe, expect, it } from 'vitest'
import { cx } from './cx'

/**
 * `cx` runs tailwind-merge over a custom Tailwind v4 scale that is declared in
 * `index.css` and invisible to the library. Every custom token needs an entry
 * in the `extendTailwindMerge` config, and a missing one fails *silently* — the
 * class is misclassified and dropped, with no build error and no runtime
 * warning. These cases are the tripwire for that.
 */
describe('cx', () => {
  it('drops falsy entries', () => {
    expect(cx('a', false, null, undefined, 'b')).toBe('a b')
  })

  /*
   * The dangerous case. Without the `font-size` group entry, tailwind-merge
   * reads `text-eyebrow` as a text *color*, sees `text-faint` as a second one,
   * and keeps only the latter — silently unstyling every eyebrow in the app.
   */
  it('keeps a custom font-size alongside a text color', () => {
    expect(cx('text-eyebrow text-faint uppercase')).toBe('text-eyebrow text-faint uppercase')
    expect(cx('text-metric tabular-nums text-ink')).toBe('text-metric tabular-nums text-ink')
  })

  it.each([
    ['col-span-4', 'col-span-2', 'col-span-2'],
    ['rounded-bento', 'rounded-md', 'rounded-md'],
    ['rounded-md', 'rounded-bento', 'rounded-bento'],
    ['shadow-bento', 'shadow-lg', 'shadow-lg'],
    ['shadow-lg', 'shadow-panel', 'shadow-panel'],
    ['z-map-panel', 'z-header', 'z-header'],
    ['ease-entrance', 'ease-standard', 'ease-standard'],
    ['text-metric', 'text-2xl', 'text-2xl'],
    ['text-2xs', 'text-md', 'text-md'],
    ['bg-surface', 'bg-ink', 'bg-ink'],
    ['text-faint', 'text-accent-deep', 'text-accent-deep'],
    ['border-line', 'border-accent', 'border-accent'],
  ])('resolves %s + %s to %s', (first, second, expected) => {
    expect(cx(first, second)).toBe(expected)
  })

  it('lets a shorthand override the longhands it covers', () => {
    expect(cx('px-4 py-4', 'p-5')).toBe('p-5')
  })

  /*
   * Responsive variants are separate buckets, so both survive. This is why
   * `className="lg:col-span-7"` on a `span={4}` BentoCard was a real bug rather
   * than something the merge could have absorbed — the override has to be
   * removed at the call site.
   */
  it('keeps a responsive variant and its unprefixed base', () => {
    expect(cx('col-span-4', 'lg:col-span-2')).toBe('col-span-4 lg:col-span-2')
  })
})
