import { useThemeStore, type Theme } from '../stores/theme'

/**
 * Chart *chrome* — gridlines, axis ink, legend ink, empty cells, the halo
 * around a mark. Unlike the band, IPC and categorical hues in `CHART`, none of
 * this carries meaning, so all of it has to follow the theme. It used to be
 * hardcoded light hex inside `CHART` and `charts.tsx`, which is why a dark
 * dashboard rendered near-white gridlines and bright empty heatmap cells.
 *
 * recharts consumes these through several different paths — SVG presentation
 * attributes, `wrapperStyle`, `activeDot`, tooltip cursors — not all of which
 * resolve a `var()`. A plain hex resolved in JS works everywhere, and is
 * testable under the `environment: 'node'` runner.
 *
 * Every value below is a token from `index.css`. `chartChrome.test.ts` reads
 * that file and asserts the mirror, so the two cannot drift.
 */
export type ChartChrome = {
  /** --color-line */
  grid: string
  /** --color-faint */
  axisInk: string
  /** --color-muted */
  legendInk: string
  /** --color-surface-3 — a cell with no observation. */
  nullFill: string
  /** --color-surface — the halo that separates a mark from what is behind it. */
  markStroke: string
  /** --color-surface-2 — tooltip and popover plate. */
  tooltipBg: string
}

export const CHART_CHROME: Record<Theme, ChartChrome> = {
  light: {
    grid: '#e5e5ea',
    axisInk: '#6e6e73',
    legendInk: '#3a3a3c',
    nullFill: '#f0f0f3',
    markStroke: '#ffffff',
    tooltipBg: '#fbfbfd',
  },
  dark: {
    grid: '#34343d',
    axisInk: '#9696a1',
    legendInk: '#c7c7cf',
    nullFill: '#24242b',
    markStroke: '#141418',
    tooltipBg: '#1b1b20',
  },
}

export function useChartChrome(): ChartChrome {
  return CHART_CHROME[useThemeStore((state) => state.theme)]
}

/**
 * The diverging ramp with its neutral midpoint swapped for the themed surface.
 * The midpoint means "at parity", so it has to read as *absence of signal* —
 * which is the page background, not a fixed light grey.
 */
export function divergingScale(chrome: ChartChrome, ramp: readonly string[]): string[] {
  const middle = Math.floor(ramp.length / 2)
  return ramp.map((color, index) => (index === middle ? chrome.nullFill : color))
}
