import { describe, expect, it } from 'vitest'
import { syncStatusLabel } from './syncStatus'

describe('status sinkronizacije', () => {
  it('razlikuje uspjeh, pogrešku i namjerni lokalni način', () => {
    expect(syncStatusLabel('synced')).toBe('Sinkronizirano')
    expect(syncStatusLabel('error')).toBe('Nije sinkronizirano')
    expect(syncStatusLabel('local')).toBe('Lokalno spremljeno')
  })
})
