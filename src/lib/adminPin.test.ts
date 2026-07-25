import { describe, expect, it } from 'vitest'
import { isValidAdminPin, normalizeAdminPin } from './adminPin'

describe('administratorski PIN', () => {
  it('prihvaća samo točno četiri znamenke', () => {
    expect(isValidAdminPin('1234')).toBe(true)
    expect(isValidAdminPin('123')).toBe(false)
    expect(isValidAdminPin('12345')).toBe(false)
    expect(isValidAdminPin('12a4')).toBe(false)
  })

  it('uklanja ostale znakove i ograničava unos na četiri znamenke', () => {
    expect(normalizeAdminPin('1a2-345')).toBe('1234')
  })
})
