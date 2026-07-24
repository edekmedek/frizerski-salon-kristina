import { describe, expect, it } from 'vitest'
import { LocalDemoClientCredentialProvider } from './clientCredentialProvider'
import { createPinCredential, isValidTemporaryPin, verifyPin } from './demoAuth'

describe('privremeni PIN klijentskog portala', () => {
  it('odbija PIN koji nema točno četiri znamenke', async () => {
    const provider = new LocalDemoClientCredentialProvider()

    expect(isValidTemporaryPin('1234')).toBe(true)
    expect(isValidTemporaryPin('123')).toBe(false)
    expect(isValidTemporaryPin('12a4')).toBe(false)
    await expect(provider.setTemporaryPin('client-1', '12345')).rejects.toThrow(
      'PIN mora imati točno četiri znamenke.',
    )
  })

  it('sprema samo salt i hash novog PIN-a', async () => {
    const provider = new LocalDemoClientCredentialProvider()
    const credential = await provider.setTemporaryPin('client-1', '4826')
    const serialized = JSON.stringify(credential)

    expect(credential.pinHash).toBeTruthy()
    expect(credential.pinSalt).toBeTruthy()
    expect(serialized).not.toContain('4826')
    expect(await verifyPin(credential, '4826')).toBe(true)
  })

  it('stari PIN više ne vrijedi nakon zamjene vjerodajnice', async () => {
    const oldCredential = await createPinCredential('client-1', '1111')
    const provider = new LocalDemoClientCredentialProvider()
    const newCredential = await provider.setTemporaryPin('client-1', '2222')

    expect(await verifyPin(oldCredential, '1111')).toBe(true)
    expect(await verifyPin(newCredential, '1111')).toBe(false)
    expect(await verifyPin(newCredential, '2222')).toBe(true)
  })
})
