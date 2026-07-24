import type { ClientCredential } from '../portalTypes'
import { createPinCredential, isValidTemporaryPin } from './demoAuth'

export interface ClientCredentialProvider {
  setTemporaryPin(clientId: string, pin: string): Promise<ClientCredential>
}

export class LocalDemoClientCredentialProvider implements ClientCredentialProvider {
  async setTemporaryPin(clientId: string, pin: string) {
    if (!isValidTemporaryPin(pin)) {
      throw new Error('PIN mora imati točno četiri znamenke.')
    }
    return createPinCredential(clientId, pin)
  }
}

export const localDemoClientCredentialProvider = new LocalDemoClientCredentialProvider()
