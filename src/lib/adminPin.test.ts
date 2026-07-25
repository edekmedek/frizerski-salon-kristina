import { describe, expect, it } from 'vitest'
import { createEmptyAdminPinFields, isValidAdminPin, isValidCurrentAdminPin, normalizeAdminPin, normalizeCurrentAdminPin } from './adminPin'

describe('administratorski PIN', () => {
  it('svaki obrazac otvara sa stvarno praznim PIN poljima', () => {
    expect(createEmptyAdminPinFields()).toEqual({ current: '', next: '', confirmation: '' })
  })

  it('prihvaća samo točno četiri znamenke', () => {
    expect(isValidAdminPin('1234')).toBe(true)
    expect(isValidAdminPin('123')).toBe(false)
    expect(isValidAdminPin('12345')).toBe(false)
    expect(isValidAdminPin('12a4')).toBe(false)
  })

  it('uklanja ostale znakove i ograničava unos na četiri znamenke', () => {
    expect(normalizeAdminPin('1a2-345')).toBe('1234')
  })

  it('prijelazno prihvaća postojeći PIN od četiri do šest znamenki', () => {
    expect(isValidCurrentAdminPin('1234')).toBe(true)
    expect(isValidCurrentAdminPin('123456')).toBe(true)
    expect(isValidCurrentAdminPin('123')).toBe(false)
    expect(isValidCurrentAdminPin('1234567')).toBe(false)
    expect(normalizeCurrentAdminPin('12-34a56')).toBe('123456')
  })
})
