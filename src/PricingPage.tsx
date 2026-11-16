import { useState } from 'react'
import { officialPrices, formatPrice } from './lib/officialPrices'
import './Portal.css'

export function PriceTable() {
  return <div style={{ overflowX: 'auto' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
      <thead>
        <tr>
          <th scope="col" style={{ textAlign: 'left', padding: '10px 5px' }}>Usluga</th>
          <th scope="col" style={{ textAlign: 'right', padding: '10px 5px' }}>Bazna cijena<br />10. 9. 2026.</th>
          <th scope="col" style={{ textAlign: 'right', padding: '10px 5px' }}>Cijena od<br />15. 11. 2026.</th>
        </tr>
      </thead>
      <tbody>
        {officialPrices.map(item => <tr key={item.id} style={{ borderTop: '1px solid var(--line)' }}>
          <th scope="row" style={{ textAlign: 'left', padding: '8px 5px' }}>{item.name}</th>
          <td style={{ textAlign: 'right', padding: '8px 5px', whiteSpace: 'nowrap' }}>{formatPrice(item.base)}</td>
          <td style={{ textAlign: 'right', padding: '8px 5px', whiteSpace: 'nowrap', fontWeight: 700 }}>{formatPrice(item.current)}</td>
        </tr>)}
      </tbody>
    </table>
  </div>
}

export function PricingPage({ onClose }: { onClose: () => void }) {
  const [downloadError, setDownloadError] = useState('')

  async function downloadCSV() {
    setDownloadError('')
    try {
      const response = await fetch('/cjenik/manifest.json', { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const manifest: unknown = await response.json()
      if (typeof manifest !== 'object' || manifest === null || !('current' in manifest) ||
          typeof manifest.current !== 'string' || !/^[A-Z0-9_]+\.csv$/.test(manifest.current)) {
        throw new Error('Neispravan zapis objavljenog cjenika.')
      }
      const link = document.createElement('a')
      link.href = `/cjenik/${manifest.current}`
      link.download = manifest.current
      link.click()
    } catch (error) {
      console.error('Preuzimanje cjenika nije uspjelo.', error)
      setDownloadError('Cjenik nije moguće preuzeti. Pokušajte ponovno.')
    }
  }

  return <main className="access-page"><section className="access-card" style={{ width: 'min(96vw, 760px)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
      <div><h1>Cjenik frizerskih usluga</h1><p style={{ color: 'var(--muted)', fontSize: '13px' }}>Frizerski salon Kristina · Školska 18, Pušćine</p></div>
      <button type="button" onClick={onClose} aria-label="Zatvori cjenik" style={{ background: 'transparent', border: 0, fontSize: '24px', cursor: 'pointer' }}>✕</button>
    </div>
    <PriceTable />
    <p className="privacy-note">U cijene su uključeni svi porezi.</p>
    <button className="link" type="button" onClick={() => void downloadCSV()}>Preuzmi CSV</button>
    {downloadError && <p className="form-message" role="alert">{downloadError}</p>}
    <a className="link" href="/cjenik/">Arhiva cjenika</a>
    <button className="link" type="button" onClick={onClose}>Natrag</button>
  </section></main>
}
