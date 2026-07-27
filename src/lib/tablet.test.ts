import { describe, expect, it } from 'vitest'
import { isTabletViewport } from './tablet'

describe('tablet dashboard detection', () => {
  it('selects the tablet dashboard for a coarse tablet viewport', () => {
    expect(isTabletViewport(() => ({ matches: true }))).toBe(true)
  })

  it('keeps the existing start screen on other devices', () => {
    expect(isTabletViewport(() => ({ matches: false }))).toBe(false)
  })
})
