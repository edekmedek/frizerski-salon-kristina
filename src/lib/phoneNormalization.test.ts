import { describe, expect, it } from 'vitest'
import { normalizePhone } from './phoneNormalization'

describe('normalizacija broja klijenta', () => {
  it('normalizira sva četiri formata u isti broj', () => {
    expect(normalizePhone('0953941292')).toBe('0953941292')
    expect(normalizePhone('+385953941292')).toBe('0953941292')
    expect(normalizePhone('00385953941292')).toBe('0953941292')
    expect(normalizePhone('0385953941292')).toBe('0953941292')
  })
})
