import { useEffect, useMemo, useState } from 'react'
import { setPortalSession } from './lib/portalStorage'
import { supabase } from './lib/supabase'
import { adminLoginErrorMessage, adminRecoveryRedirect, adminRoleErrorMessage } from './lib/adminAuth'
import { pricingData } from './lib/pricingData'
import { PricingPage } from './PricingPage'
import './Portal.css'

type AccessMode = 'home' | 'home-redesigned' | 'pricing' | 'admin' | 'admin-recovery' | 'admin-reset-password' | 'client' | 'activate' | 'change-pin' | 'register'

interface LoginResult {
  client_id: string | null
  must_change_pin: boolean
  authenticated: boolean
  phone_registered?: boolean
  registration_pending?: boolean
}

async function ensureAnonymousSession(forceNew = false) {
  if (!supabase) throw new Error('Supabase nije konfiguriran.')
  const { data: current } = await supabase.auth.getSession()
  if (!forceNew && current.session?.user.is_anonymous) return current.session
  if (current.session) await supabase.auth.signOut()
  const { data, error } = await supabase.auth.signInAnonymously()
  if (error || !data.session) throw error ?? new Error('Anonimna sesija nije dostupna.')
  return data.session
}

export function AccessScreen() {
  const accessToken = useMemo(() => {
    const match = window.location.hash.match(/^#\/client\/access\/([a-f0-9]+)$/i)
    return match?.[1] ?? ''
  }, [])
  const recoveryRequested = useMemo(() => new URLSearchParams(window.location.search).get('admin-recovery') === '1', [])
  const [mode, setMode] = useState<AccessMode>(recoveryRequested ? 'admin-reset-password' : accessToken ? 'client' : 'home-redesigned')
  const [phone, setPhone] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [registerOffer, setRegisterOffer] = useState(false)
  const [temporaryPin, setTemporaryPin] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [clientId, setClientId] = useState('')
  const [message, setMessage] = useState('')
  const [working, setWorking] = useState(false)
  const [recoveryReady, setRecoveryReady] = useState(false)

  useEffect(() => {
    if (!supabase || !recoveryRequested) return
    let active = true
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        setRecoveryReady(true)
        setMessage('')
      }
    })
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (data.session) setRecoveryReady(true)
      else if (error) setMessage('Poveznicu za promjenu lozinke nije moguće potvrditi.')
    })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [recoveryRequested])

  function validPinsMatch() {
    if (!/^\d{4}$/.test(pin)) {
      setMessage('PIN mora imati točno četiri znamenke.')
      return false
    }
    if ((mode === 'activate' || mode === 'change-pin') && pin !== pinConfirm) {
      setMessage('Uneseni PIN-ovi nisu jednaki.')
      return false
    }
    return true
  }

  async function enterAdmin(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase) return setMessage('Supabase nije konfiguriran.')
    setWorking(true)
    setMessage('')
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: adminEmail,
        password: adminPassword,
      })
      if (error) {
        setMessage(adminLoginErrorMessage(error))
        return
      }
      if (!data.user) {
        setMessage('Supabase nije vratio prijavljenog korisnika.')
        return
      }
      const { data: role, error: roleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', data.user.id)
        .maybeSingle()
      const roleMessage = adminRoleErrorMessage(role?.role, Boolean(roleError))
      if (roleMessage) {
        await supabase.auth.signOut()
        setMessage(roleMessage)
        return
      }
      setPortalSession({ role: 'administrator' })
    } catch (error) {
      setMessage(adminLoginErrorMessage(error instanceof Error ? error : {}))
    } finally {
      setWorking(false)
    }
  }

  async function requestAdminRecovery(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase) return setMessage('Supabase nije konfiguriran.')
    setWorking(true)
    setMessage('')
    const redirectTo = adminRecoveryRedirect(window.location.origin, import.meta.env.BASE_URL)
    const { error } = await supabase.auth.resetPasswordForEmail(adminEmail.trim(), { redirectTo })
    setWorking(false)
    setMessage(error
      ? adminLoginErrorMessage(error)
      : 'Ako račun postoji, poslana je poveznica za postavljanje nove lozinke.')
  }

  async function setRecoveredPassword(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase || !recoveryReady) {
      setMessage('Poveznica za promjenu lozinke nije valjana ili je istekla.')
      return
    }
    if (adminPassword.length < 8) {
      setMessage('Nova lozinka mora imati najmanje osam znakova.')
      return
    }
    if (adminPassword !== pinConfirm) {
      setMessage('Lozinke nisu jednake.')
      return
    }
    setWorking(true)
    const { error } = await supabase.auth.updateUser({ password: adminPassword })
    if (error) {
      setMessage(adminLoginErrorMessage(error))
      setWorking(false)
      return
    }
    await supabase.auth.signOut()
    window.history.replaceState({}, '', import.meta.env.BASE_URL)
    setAdminPassword('')
    setPinConfirm('')
    setMode('admin')
    setRecoveryReady(false)
    setMessage('Lozinka je promijenjena. Sada se prijavite novom lozinkom.')
    setWorking(false)
  }

  async function activatePortal(event: React.FormEvent) {
    event.preventDefault()
    if (!validPinsMatch() || !supabase) return
    setWorking(true)
    setMessage('')
    try {
       await ensureAnonymousSession()
      const { data, error } = await supabase.rpc('activate_client_portal', {
        access_token: accessToken,
        phone_value: phone,
        permanent_pin: pin,
      })
      const result = (data as { client_id: string; must_change_pin: boolean }[] | null)?.[0]
      if (error || !result?.client_id) throw error ?? new Error('Aktivacija nije uspjela.')
      setPortalSession({ role: 'client', clientId: result.client_id })
    } catch {
      setMessage('Pristup nije moguće potvrditi. Provjerite adresu i broj telefona.')
    } finally {
      setWorking(false)
    }
  }

  async function loginClient(event: React.FormEvent) {
    event.preventDefault()
    if (!/^\d{4}$/.test(pin) || !supabase) {
      setMessage('Pristupni podaci nisu ispravni.')
      return
    }
    setWorking(true)
    setMessage('')
     try {
       await ensureAnonymousSession()
       const { data, error } = await supabase.rpc('login_client_portal', {
        phone_value: phone,
        pin_value: pin,
      })
      const result = (data as LoginResult[] | null)?.[0]
      if (error) throw error
      if (result?.authenticated && result.client_id) {
        if (result.must_change_pin) {
          setClientId(result.client_id)
          setTemporaryPin(pin)
          setPin('')
          setPinConfirm('')
          setMode('change-pin')
          setMessage('Privremeni PIN vrijedi samo za ovaj ulazak. Postavite novi stalni PIN.')
          return
        }
        setPortalSession({ role: 'client', clientId: result.client_id })
        return
      }
      if (result?.registration_pending) {
        setRegisterOffer(false)
        setMessage('Zahtjev za registraciju je poslan i čeka Kristinino odobrenje.')
        return
      }
      if (result?.phone_registered === false) {
        setRegisterOffer(true)
        setMessage('Klijent s ovim brojem ne postoji')
        return
      }
      throw new Error('Prijava nije uspjela.')
    } catch (error) {
      const detail = error instanceof Error ? error.message : ''
      setMessage(detail
        ? `Prijava nije uspjela: ${detail}`
        : 'Pristupni podaci nisu ispravni ili je pristup privremeno blokiran.')
    } finally {
      setWorking(false)
    }
  }

  async function registerClient(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase) return setMessage('Supabase nije konfiguriran.')
    if (!firstName.trim() || !lastName.trim()) {
      setMessage('Unesite ime i prezime.')
      return
    }
    if (!/^\d{4}$/.test(pin) || pin !== pinConfirm) {
      setMessage('PIN mora imati točno četiri znamenke i PIN-ovi moraju biti jednaki.')
      return
    }
    setWorking(true)
    setMessage('')
    try {
       await ensureAnonymousSession()
      const { data, error } = await supabase.rpc('register_client_portal', {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone_value: phone,
        pin_value: pin,
      })
      const result = (data as { client_id: string | null; registered: boolean }[] | null)?.[0]
      if (error || !result?.registered || !result.client_id) {
        throw error ?? new Error('Registracija nije uspjela.')
      }
      setRegisterOffer(false)
      setFirstName('')
      setLastName('')
      setPhone('')
      setPin('')
      setPinConfirm('')
      setMode('client')
      setMessage('Zahtjev za registraciju je poslan. Pristup postaje dostupan nakon Kristinine odobrenje.')
    } catch (error) {
      const detail = error instanceof Error ? error.message : ''
      setMessage(detail ? `Registracija nije uspjela: ${detail}` : 'Registracija nije moguća. Ako već imate račun, prijavite se.')
    } finally {
      setWorking(false)
    }
  }

  async function changeTemporaryPin(event: React.FormEvent) {
    event.preventDefault()
    if (!validPinsMatch() || !supabase || !clientId) return
    setWorking(true)
    try {
      if (!temporaryPin) throw new Error('Privremeni PIN nije dostupan.')
      const { error } = await supabase.rpc('change_client_portal_pin', {
        current_pin: temporaryPin,
        new_permanent_pin: pin,
      })
      if (error) throw error
      const verification = await supabase.rpc('login_client_portal', {
        phone_value: phone,
        pin_value: pin,
      })
      const verified = (verification.data as LoginResult[] | null)?.[0]
      if (verification.error || !verified?.authenticated || verified.client_id !== clientId) {
        throw verification.error ?? new Error('Novi PIN nije potvrđen.')
      }
      setTemporaryPin('')
      setPortalSession({ role: 'client', clientId })
    } catch {
      setMessage('PIN nije bilo moguće promijeniti. Prijavite se ponovno.')
    } finally {
      setWorking(false)
    }
  }

  return <main className={`access-page${mode === 'home-redesigned' ? ' salon-redesigned-page' : ''}`}><section className={`access-card${mode === 'home-redesigned' ? ' salon-home' : ''}`}>
    <div className="portal-brand"><span>K</span><div><strong>Salon Kristina</strong>{mode !== 'home-redesigned' && <small>Topla elegancija</small>}</div></div>
    {mode === 'home-redesigned' && <div className="salon-redesigned-content">
      <section className="redesigned-hero">
        <div className="redesigned-hero-overlay"></div>
        <div className="redesigned-hero-content">
          <h1>Frizerski salon Kristina</h1>
          <p>Mjesto posvećeno lijepoj, njegovanoj kosi i frizuri u kojoj ćete se osjećati kao svoji.</p>
          <button className="redesigned-booking-button" onClick={() => setMode('client')}>
            Rezerviraj termin
          </button>
        </div>
      </section>

      <section className="redesigned-content-section">
        <h2>Termini prema dogovoru</h2>
        <p>
          Salon Kristina ne funkcionira prema fiksnom radnom vremenu. Svaki termin dogovara se individualno
          prema vašim potrebama i mogućnostima. Pošaljite nam zahtjev za željeni termin, a mi ćemo vam se odgovoriti
          što je prije moguće.
        </p>
      </section>

      <section className="redesigned-content-section">
        <h2>O salonu</h2>
        <p>
          Sa iskustvom i strašću za frizurskom uslugom, Salon Kristina nudi personalizirane tretmane
          koji su prilagođeni vašim potrebama. Naš tim stručnjaka čini sve da vam pružimo najbolje iskustvo
          i rezultate od kojih ćete biti zadovoljni.
        </p>
      </section>

      <footer className="redesigned-footer">
        <strong>Salon Kristina</strong>
        <p>Školska 18, Pušćine, 40305 Nedelišće</p>
        <div className="redesigned-footer-links">
          <button onClick={() => setMode('pricing')}>Cjenik</button>
          <span>•</span>
          <button onClick={() => setMode('admin')}>Administracija</button>
        </div>
      </footer>
    </div>}
    {mode === 'pricing' && <PricingPage pricingData={pricingData} onClose={() => setMode('home-redesigned')} />}
    {mode === 'admin' && <form onSubmit={event => void enterAdmin(event)}><h1>Kristinin ulaz</h1><label>E-mail<input type="email" autoComplete="username" required value={adminEmail} onChange={event => setAdminEmail(event.target.value)}/></label><label>Lozinka<input type="password" autoComplete="current-password" required value={adminPassword} onChange={event => setAdminPassword(event.target.value)}/></label>{message&&<p className="form-message" role="alert">{message}</p>}<button className="primary" disabled={working} type="submit">{working?'Prijava…':'Prijavi se'}</button><button className="link" type="button" onClick={()=>{setMode('admin-recovery');setMessage('');setAdminPassword('')}}>Zaboravljena lozinka?</button>    <button className="link" type="button" onClick={() => {setMode('home-redesigned');setMessage('')}}>Natrag</button></form>}
    {mode === 'admin-recovery' && <form onSubmit={event=>void requestAdminRecovery(event)}><h1>Nova administratorska lozinka</h1><p>Upišite e-mail računa. Poslat ćemo sigurnu poveznicu za postavljanje nove lozinke.</p><label>E-mail<input type="email" autoComplete="email" required value={adminEmail} onChange={event=>setAdminEmail(event.target.value)}/></label>{message&&<p className="form-message" role="alert">{message}</p>}<button className="primary" disabled={working} type="submit">{working?'Slanje…':'Pošalji poveznicu'}</button><button className="link" type="button" onClick={()=>{setMode('admin');setMessage('')}}>Natrag na prijavu</button></form>}
    {mode === 'admin-reset-password' && <form onSubmit={event=>void setRecoveredPassword(event)}><h1>Postavite novu lozinku</h1>{!recoveryReady&&<p className="important-note">Provjera sigurnosne poveznice…</p>}<label>Nova lozinka<input type="password" autoComplete="new-password" minLength={8} required disabled={!recoveryReady} value={adminPassword} onChange={event=>setAdminPassword(event.target.value)}/></label><label>Ponovite novu lozinku<input type="password" autoComplete="new-password" minLength={8} required disabled={!recoveryReady} value={pinConfirm} onChange={event=>setPinConfirm(event.target.value)}/></label>{message&&<p className="form-message" role="alert">{message}</p>}<button className="primary" disabled={working||!recoveryReady} type="submit">{working?'Spremanje…':'Spremi novu lozinku'}</button></form>}
    {mode === 'client' && <form onSubmit={event=>void loginClient(event)}><h1>Ulaz za klijente</h1><p>Prijavite se brojem mobitela i četveroznamenkastim PIN-om.</p><label>Broj mobitela<input type="tel" inputMode="tel" autoComplete="tel" required value={phone} onChange={event=>setPhone(event.target.value)}/></label><label>PIN<input type="password" inputMode="numeric" autoComplete="current-password" pattern="[0-9]{4}" maxLength={4} required value={pin} onChange={event=>setPin(event.target.value.replace(/\\D/g,'').slice(0,4))}/></label>{message&&<p className="form-message" role="alert">{message}</p>}{registerOffer&&<div className="registration-offer"><button className="link" type="button" onClick={()=>{setMode('register');setRegisterOffer(false);setMessage('')}}>Registriraj se</button><button className="link" type="button" onClick={()=>{setRegisterOffer(false);setPin('');setMessage('Ispravite broj mobitela.')}}>Ispravi broj</button><button className="link" type="button" onClick={()=>{setMode('home-redesigned');setRegisterOffer(false);setMessage('');setPhone('');setPin('')}}>Povratak na prijavu</button></div>}<button className="primary" disabled={working} type="submit">{working?'Prijava…':'Prijavi se'}</button><button className="link" type="button" onClick={()=>{setMode('register');setRegisterOffer(false);setMessage('')}}>Registriraj se</button><button className="link" type="button" onClick={()=>{setMode('home-redesigned');setMessage('');setRegisterOffer(false)}}>Natrag</button></form>}
    {mode === 'activate' && <form onSubmit={event=>void activatePortal(event)}><h1>Aktivirajte pristup</h1><p>Unesite svoj broj mobitela i odaberite stalni četveroznamenkasti PIN.</p><label>Broj mobitela<input type="tel" inputMode="tel" autoComplete="tel" required value={phone} onChange={event=>setPhone(event.target.value)}/></label><label>Novi PIN<input type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4}" maxLength={4} required value={pin} onChange={event=>setPin(event.target.value.replace(/\D/g,'').slice(0,4))}/></label><label>Potvrdite PIN<input type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4}" maxLength={4} required value={pinConfirm} onChange={event=>setPinConfirm(event.target.value.replace(/\D/g,'').slice(0,4))}/></label>{message&&<p className="form-message" role="alert">{message}</p>}<button className="primary" disabled={working} type="submit">{working?'Aktivacija…':'Aktiviraj portal'}</button></form>}
    {mode === 'change-pin' && <form onSubmit={event=>void changeTemporaryPin(event)}><h1>Postavite stalni PIN</h1><p className="important-note">Prije nastavka morate zamijeniti privremeni PIN.</p><label>Novi stalni PIN<input type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4}" maxLength={4} required value={pin} onChange={event=>setPin(event.target.value.replace(/\\D/g,'').slice(0,4))}/></label><label>Potvrdite PIN<input type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4}" maxLength={4} required value={pinConfirm} onChange={event=>setPinConfirm(event.target.value.replace(/\\D/g,'').slice(0,4))}/></label>{message&&<p className="form-message" role="alert">{message}</p>}<button className="primary" disabled={working} type="submit">{working?'Spremanje…':'Spremi stalni PIN'}</button></form>}
    {mode === 'register' && <form onSubmit={event=>void registerClient(event)}><h1>Registracija klijenta</h1><p>Registrirajte se imenom, prezimenom, brojem mobitela i četveroznamenkastim PIN-om.</p><label>Ime<input type="text" autoComplete="given-name" required value={firstName} onChange={event=>setFirstName(event.target.value)}/></label><label>Prezime<input type="text" autoComplete="family-name" required value={lastName} onChange={event=>setLastName(event.target.value)}/></label><label>Broj mobitela<input type="tel" inputMode="tel" autoComplete="tel" required value={phone} onChange={event=>setPhone(event.target.value)}/></label><label>PIN<input type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4}" maxLength={4} required value={pin} onChange={event=>setPin(event.target.value.replace(/\\D/g,'').slice(0,4))}/></label><label>Potvrdite PIN<input type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4}" maxLength={4} required value={pinConfirm} onChange={event=>setPinConfirm(event.target.value.replace(/\\D/g,'').slice(0,4))}/></label>{message&&<p className="form-message" role="alert">{message}</p>}<button className="primary" disabled={working} type="submit">{working?'Registracija…':'Registriraj se'}</button><button className="link" type="button" onClick={()=>{setMode('client');setMessage('');setRegisterOffer(false)}}>Natrag na prijavu</button></form>}
  </section></main>
}
