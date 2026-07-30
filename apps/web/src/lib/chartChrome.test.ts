import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CHART_CHROME } from './chartChrome'

/**
 * Same guard philosophy as `tokens.test.ts`: the chart chrome exists twice, in
 * `@theme` for Tailwind and here as raw hex for recharts, and nothing but this
 * test connects them. Unlike the band and IPC palettes, these values *must*
 * differ between themes — a gridline that stays `#e0e0e0` on a near-black
 * surface is the defect this module was written to remove.
 */
const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf-8')
const themeBlock = css.match(/@theme\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
const darkBlock = css.match(/html\.dark\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''

function token(block: string, name: string): string | undefined {
  return block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8});`))?.[1]?.toLowerCase()
}

const PAIRS: [keyof (typeof CHART_CHROME)['light'], string][] = [
  ['grid', 'color-line'],
  ['axisInk', 'color-faint'],
  ['legendInk', 'color-muted'],
  ['nullFill', 'color-surface-3'],
  ['markStroke', 'color-surface'],
  ['tooltipBg', 'color-surface-2'],
]

describe('chart chrome mirrors the CSS tokens', () => {
  it.each(PAIRS)('light %s matches --%s', (key, name) => {
    expect(CHART_CHROME.light[key]).toBe(token(themeBlock, name))
  })

  it.each(PAIRS)('dark %s matches the html.dark --%s override', (key, name) => {
    expect(CHART_CHROME.dark[key]).toBe(token(darkBlock, name))
  })

  it('actually differs between themes', () => {
    for (const [key] of PAIRS) {
      expect(CHART_CHROME.dark[key]).not.toBe(CHART_CHROME.light[key])
    }
  })
})
