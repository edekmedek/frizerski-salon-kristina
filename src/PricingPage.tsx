import { useState } from 'react'
import { officialPrices, formatPrice } from './lib/officialPrices'
import './Portal.css'

export function PriceTable() {
  return <div className="price-table-container">
    <table className="price-table">
      <colgroup><col /><col /><col /></colgroup>
      <thead>
        <tr>
          <th scope="col">Usluga</th>
          <th scope="col">Bazna cijena<br />10. 9. 2026.</th>
          <th scope="col">Cijena od<br />15. 11. 2026.</th>
        </tr>
      </thead>
      <tbody>
        {officialPrices.map(item => <tr key={item.id}>
          <th scope="row">{item.name}</th>
          <td>{formatPrice(item.base)}</td>
          <td>{formatPrice(item.current)}</td>
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

  return <section className="pricing-page">
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
  </section>
}
