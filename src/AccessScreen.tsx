import { useMemo, useState } from 'react'
import {
  createPinCredential,
  DEMO_ADMIN_PIN,
  DEMO_SMS_CODE,
  findValidInvitation,
  phoneMatches,
  verifyPin,
} from './lib/demoAuth'
import { loadPortalData, savePortalData, setPortalSession } from './lib/portalStorage'
import { loadSalonData } from './lib/storage'
import './Portal.css'

type AccessMode = 'home' | 'admin' | 'client' | 'invite'
type InviteStage = 'phone' | 'code' | 'pin'

export function AccessScreen() {
  const token = useMemo(() => {
    const match = window.location.hash.match(/^#\/client\/invite\/(.+)$/)
    return match?.[1] ?? ''
  }, [])
  const [mode, setMode] = useState<AccessMode>(token ? 'invite' : 'home')
  const [inviteStage, setInviteStage] = useState<InviteStage>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [pin, setPin] = useState('')
  const [adminPin, setAdminPin] = useState('')
  const [verifiedClientId, setVerifiedClientId] = useState('')
  const [message, setMessage] = useState('')

  function enterAdmin(event: React.FormEvent) {
    event.preventDefault()
    if (adminPin !== DEMO_ADMIN_PIN) {
      setMessage('Pristupni podaci nisu ispravni.')
      return
    }
    setPortalSession({ role: 'administrator' })
  }

  async function beginInvite(event: React.FormEvent) {
    event.preventDefault()
    const portal = loadPortalData()
    const invitation = await findValidInvitation(portal, token)
    const client = invitation
      ? loadSalonData().clients.find((item) => item.id === invitation.clientId)
      : undefined
    if (!invitation || !client || !phoneMatches(client, phone)) {
      setMessage('Podatke nije moguće potvrditi. Provjerite pozivnicu i uneseni broj.')
      return
    }
    setVerifiedClientId(client.id)
    setInviteStage('code')
    setMessage('Demo način: SMS nije poslan. Za nastavak unesite kod 123456.')
  }

  function confirmDemoCode(event: React.FormEvent) {
    event.preventDefault()
    if (code !== DEMO_SMS_CODE) {
      setMessage('Kod nije ispravan ili je istekao.')
      return
    }
    setInviteStage('pin')
    setMessage('Broj je potvrđen. Postavite PIN za sljedeću prijavu.')
  }

  async function savePin(event: React.FormEvent) {
    event.preventDefault()
    if (!/^\d{4,6}$/.test(pin)) {
      setMessage('PIN mora imati od 4 do 6 znamenki.')
      return
    }
    const portal = loadPortalData()
    const invitation = await findValidInvitation(portal, token)
    if (!invitation || invitation.clientId !== verifiedClientId) {
      setMessage('Pozivnica više nije valjana.')
      return
    }
    const credential = await createPinCredential(verifiedClientId, pin)
    savePortalData({
      ...portal,
      invitations: portal.invitations.map((item) =>
        item.id === invitation.id ? { ...item, consumedAt: new Date().toISOString() } : item,
      ),
      credentials: [
        ...portal.credentials.filter((item) => item.clientId !== verifiedClientId),
        credential,
      ],
    })
    setPortalSession({ role: 'client', clientId: verifiedClientId })
  }

  async function loginClient(event: React.FormEvent) {
    event.preventDefault()
    const salon = loadSalonData()
    const portal = loadPortalData()
    const client = salon.clients.find((item) => phoneMatches(item, phone))
    const credential = client
      ? portal.credentials.find((item) => item.clientId === client.id)
      : undefined
    if (!client || !credential || !(await verifyPin(credential, pin))) {
      setMessage('Pristupni podaci nisu ispravni.')
      return
    }
    setPortalSession({ role: 'client', clientId: client.id })
  }

  return (
    <main className="access-page">
      <section className="access-card">
        <div className="portal-brand"><span>K</span><div><strong>Salon Kristina</strong><small>Topla elegancija</small></div></div>
        {mode === 'home' && <>
          <p className="eyebrow">DOBRO DOŠLI</p>
          <h1>Odaberite ulaz</h1>
          <p className="access-intro">Klijentski portal i Kristinin administratorski prostor potpuno su odvojeni.</p>
          <div className="access-choices">
            <button className="primary" onClick={() => setMode('client')}>Ulaz za klijente</button>
            <button className="secondary" onClick={() => setMode('admin')}>Kristinin ulaz</button>
          </div>
        </>}

        {mode === 'admin' && <form onSubmit={enterAdmin}>
          <h1>Kristinin ulaz</h1>
          <p className="demo-banner">Lokalni demo način · PIN: 2468</p>
          <label>Administratorski PIN<input type="password" inputMode="numeric" required value={adminPin} onChange={(event) => setAdminPin(event.target.value)} /></label>
          {message && <p className="form-message" role="alert">{message}</p>}
          <button className="primary" type="submit">Prijavi se</button>
          <button className="link" type="button" onClick={() => { setMode('home'); setMessage('') }}>Natrag</button>
        </form>}

        {mode === 'client' && <form onSubmit={(event) => void loginClient(event)}>
          <h1>Ulaz za klijente</h1>
          <p>Prva prijava moguća je samo osobnim pozivnim linkom salona.</p>
          <label>Broj mobitela<input type="tel" autoComplete="tel" required value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
          <label>PIN<input type="password" inputMode="numeric" autoComplete="current-password" required value={pin} onChange={(event) => setPin(event.target.value)} /></label>
          {message && <p className="form-message" role="alert">{message}</p>}
          <button className="primary" type="submit">Prijavi se</button>
          <button className="link" type="button" onClick={() => { setMode('home'); setMessage('') }}>Natrag</button>
        </form>}

        {mode === 'invite' && <>
          {inviteStage === 'phone' && <form onSubmit={(event) => void beginInvite(event)}>
            <h1>Aktivirajte svoj pristup</h1>
            <p>Unesite broj mobitela povezan s osobnom pozivnicom.</p>
            <label>Broj mobitela<input type="tel" autoComplete="tel" required value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
            {message && <p className="form-message" role="alert">{message}</p>}
            <button className="primary" type="submit">Nastavi</button>
          </form>}
          {inviteStage === 'code' && <form onSubmit={confirmDemoCode}>
            <h1>Potvrdite broj</h1>
            <p className="demo-banner">Demo način: SMS nije poslan. Kod je 123456.</p>
            <label>Jednokratni kod<input inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(event) => setCode(event.target.value)} /></label>
            {message && <p className="form-message">{message}</p>}
            <button className="primary" type="submit">Potvrdi</button>
          </form>}
          {inviteStage === 'pin' && <form onSubmit={(event) => void savePin(event)}>
            <h1>Postavite PIN</h1>
            <p>PIN se sigurnosno izvodi PBKDF2 algoritmom i ne sprema se kao običan tekst.</p>
            <label>Novi PIN<input type="password" inputMode="numeric" autoComplete="new-password" minLength={4} maxLength={6} required value={pin} onChange={(event) => setPin(event.target.value)} /></label>
            {message && <p className="form-message">{message}</p>}
            <button className="primary" type="submit">Aktiviraj portal</button>
          </form>}
        </>}
      </section>
    </main>
  )
}
