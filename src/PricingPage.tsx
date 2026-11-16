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

function downloadCSV() {
  const rows = [
    'Šifra,Naziv usluge,Bazna cijena 10. 9. 2026. (EUR),Cijena od 15. 11. 2026. (EUR)',
    ...officialPrices.map(item => `${item.id},"${item.name.replace(/"/g, '""')}",${item.base},${item.current}`),
  ]
  const blob = new Blob(['\ufeff', rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = 'cjenik-salon-kristina.csv'
  link.click()
  URL.revokeObjectURL(link.href)
}

export function PricingPage({ onClose }: { onClose: () => void }) {
  return <main className="access-page"><section className="access-card" style={{ width: 'min(96vw, 760px)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
      <div><h1>Cjenik frizerskih usluga</h1><p style={{ color: 'var(--muted)', fontSize: '13px' }}>Frizerski salon Kristina · Školska 18, Pušćine</p></div>
      <button type="button" onClick={onClose} aria-label="Zatvori cjenik" style={{ background: 'transparent', border: 0, fontSize: '24px', cursor: 'pointer' }}>✕</button>
    </div>
    <PriceTable />
    <p className="privacy-note">U cijene su uključeni svi porezi.</p>
    <button className="link" type="button" onClick={downloadCSV}>Preuzmi CSV</button>
    <button className="link" type="button" onClick={onClose}>Natrag</button>
  </section></main>
}
