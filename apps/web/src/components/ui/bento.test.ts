import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `BentoGrid` is 2 columns, 4 at `md`, 6 at `lg`. A span that does not declare
 * all three breakpoints inherits its base value upward or downward into a grid
 * that cannot hold it — a bare `col-span-4` asks a two-column grid for four
 * tracks, and the browser silently synthesises the missing columns, which is
 * how the reskin shipped rows that blew out at small widths.
 *
 * The failure is invisible: no build error, no runtime warning, just a wrong
 * layout at one breakpoint. So the record is asserted rather than reviewed.
 *
 * Read as source text because the module imports React components, and the
 * test runner is `environment: 'node'` with no DOM.
 */
const source = readFileSync(fileURLToPath(new URL('./Bento.tsx', import.meta.url)), 'utf-8')

const block = source.match(/const COL_SPAN: Record<BentoSpan, string> = \{([\s\S]*?)\n\}/)?.[1]
const entries = [...(block ?? '').matchAll(/^\s*(\d+): '([^']+)',/gm)].map(
  ([, span, classes]) => [Number(span), classes] as const,
)

const GRID_COLUMNS = { base: 2, md: 4, lg: 6 } as const

function spanAt(classes: string, breakpoint: 'base' | 'md' | 'lg'): number | null {
  const prefix = breakpoint === 'base' ? '' : `${breakpoint}:`
  const found = classes
    .split(' ')
    .filter((c) => (breakpoint === 'base' ? !c.includes(':') : c.startsWith(prefix)))
    .map((c) => Number(c.replace(prefix, '').replace('col-span-', '')))
  return found.length > 0 ? found[found.length - 1] : null
}

describe('BentoCard column spans', () => {
  it('parses every entry in the record', () => {
    expect(entries.map(([span]) => span)).toEqual([1, 2, 3, 4, 6])
  })

  it.each(entries)('span=%i declares a value at every breakpoint', (_span, classes) => {
    for (const breakpoint of ['base', 'md', 'lg'] as const) {
      expect(spanAt(classes, breakpoint), `${breakpoint} of "${classes}"`).not.toBeNull()
    }
  })

  it.each(entries)('span=%i never exceeds the columns available', (_span, classes) => {
    for (const [breakpoint, columns] of Object.entries(GRID_COLUMNS)) {
      const value = spanAt(classes, breakpoint as 'base' | 'md' | 'lg')
      expect(value, `${breakpoint} of "${classes}"`).toBeLessThanOrEqual(columns)
      expect(value).toBeGreaterThanOrEqual(1)
    }
  })

  it('is monotonic — a wider viewport never narrows a tile', () => {
    for (const [span, classes] of entries) {
      const base = spanAt(classes, 'base')!
      const md = spanAt(classes, 'md')!
      const lg = spanAt(classes, 'lg')!
      expect(md / GRID_COLUMNS.md, `span=${span}`).toBeLessThanOrEqual(base / GRID_COLUMNS.base)
      expect(lg / GRID_COLUMNS.lg, `span=${span}`).toBeLessThanOrEqual(md / GRID_COLUMNS.md)
    }
  })

  it('keeps the lg span equal to the requested span', () => {
    for (const [span, classes] of entries) {
      expect(spanAt(classes, 'lg'), `span=${span}`).toBe(span)
    }
  })
})
