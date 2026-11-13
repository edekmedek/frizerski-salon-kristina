import { useState } from 'react'
import type { pricingData as PricingDataType } from './lib/pricingData'
import { toCsvString } from './lib/pricingData'
import './Portal.css'

interface PricingPageProps {
  onClose: () => void
  pricingData: typeof PricingDataType
}

export function PricingPage({ onClose, pricingData }: PricingPageProps) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(
    pricingData.categories[0]?.id ?? null
  )

  function downloadCSV() {
    const csv = toCsvString()
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'cjenik-salon-kristina.csv'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <main className="access-page">
      <section className="access-card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '24px',
          }}
        >
          <div>
            <h1>Cjenik usluga</h1>
            <p style={{ margin: '8px 0 0 0', color: 'var(--muted)', fontSize: '13px' }}>
              Sve cijene u eurima bez PDV-a
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 0,
              fontSize: '24px',
              color: 'var(--muted)',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            ✕
          </button>
        </div>

        <div className="client-price-accordion">
          {pricingData.categories.map((category: typeof pricingData.categories[number]) => (
            <div key={category.id} className="client-price-category">
              <button
                onClick={() =>
                  setExpandedCategory(expandedCategory === category.id ? null : category.id)
                }
              >
                <strong>{category.name}</strong>
                <span style={{ marginLeft: 'auto' }}>
                  {expandedCategory === category.id ? '−' : '+'}
                </span>
              </button>

              {expandedCategory === category.id && (
                <div className="client-price-list">
                  <p style={{ margin: '8px 0 12px 0', color: 'var(--muted)', fontSize: '13px' }}>
                    {category.description}
                  </p>
                  {category.services.map((service: typeof category.services[number]) => (
                    <div key={service.id}>
                      <span>
                        <strong>{service.name}</strong>
                      </span>
                      <strong>{service.price} €</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ marginTop: '24px', textAlign: 'center', display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <button className="link" onClick={downloadCSV}>
            Preuzmi CSV
          </button>
          <span style={{ color: 'var(--line)' }}>•</span>
          <button className="link" onClick={onClose}>
            Natrag
          </button>
        </div>
      </section>
    </main>
  )
}
