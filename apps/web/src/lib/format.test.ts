import { describe, expect, it } from 'vitest'
import { BAND_GUIDANCE, BAND_LABELS } from './format'

describe('band copy', () => {
  it('labels quiet zones as Stable with clear OK guidance', () => {
    expect(BAND_LABELS.low).toBe('Stable')
    expect(BAND_GUIDANCE.low).toMatch(/not detecting danger/i)
    expect(BAND_GUIDANCE.none).toMatch(/Not yet assessed/i)
  })
})
