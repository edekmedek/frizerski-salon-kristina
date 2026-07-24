import type { ClientCredential, ClientInvitation, PortalData } from '../portalTypes'
import type { Client } from '../types'

export const DEMO_SMS_CODE = '123456'
export const DEMO_ADMIN_PIN = '2468'
const INVITE_HOURS = 24

function bytesToBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return bytesToBase64(new Uint8Array(digest))
}

export async function createClientInvitation(clientId: string): Promise<{
  token: string
  invitation: ClientInvitation
}> {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`
  return {
    token,
    invitation: {
      id: crypto.randomUUID(),
      clientId,
      tokenHash: await sha256(token),
      expiresAt: new Date(Date.now() + INVITE_HOURS * 60 * 60 * 1000).toISOString(),
    },
  }
}

export async function findValidInvitation(data: PortalData, token: string) {
  const hash = await sha256(token)
  return data.invitations.find(
    (item) =>
      item.tokenHash === hash &&
      !item.consumedAt &&
      new Date(item.expiresAt).getTime() > Date.now(),
  )
}

export function phoneMatches(client: Client, phone: string) {
  const normalize = (value: string) => value.replace(/\D/g, '').replace(/^385/, '0')
  return normalize(client.phone) === normalize(phone)
}

export async function createPinCredential(
  clientId: string,
  pin: string,
  phoneVerifiedAt = new Date().toISOString(),
): Promise<ClientCredential> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 120_000 },
    key,
    256,
  )
  return {
    clientId,
    phoneVerifiedAt,
    pinSalt: bytesToBase64(salt),
    pinHash: bytesToBase64(new Uint8Array(derived)),
  }
}

export async function verifyPin(credential: ClientCredential, pin: string) {
  if (!credential.pinHash || !credential.pinSalt) return false
  const saltString = atob(credential.pinSalt)
  const salt = Uint8Array.from(saltString, (character) => character.charCodeAt(0))
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 120_000 },
    key,
    256,
  )
  return bytesToBase64(new Uint8Array(derived)) === credential.pinHash
}
