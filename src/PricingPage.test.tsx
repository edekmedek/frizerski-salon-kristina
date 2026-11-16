import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PriceTable, PricingPage } from './PricingPage'
import { formatPrice, officialPrices } from './lib/officialPrices'

afterEach(cleanup)

describe('službeni cjenik', () => {
  it('prikazuje svih 64 usluga s obje cijene bez grupa', () => {
    render(<PriceTable />)
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(65)
    expect(within(table).getByRole('columnheader', { name: /10\. 9\. 2026/ })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: /15\. 11\. 2026/ })).toBeInTheDocument()
    for (const service of officialPrices) {
      const row = within(table).getByRole('rowheader', { name: service.name }).closest('tr')
      expect(row).not.toBeNull()
      const cells = within(row!).getAllByRole('cell')
      expect(cells[0].textContent).toBe(formatPrice(service.base))
      expect(cells[1].textContent).toBe(formatPrice(service.current))
    }
    expect(within(table).getByRole('rowheader', { name: 'Frizura XXL' }).parentElement).toHaveTextContent(/25,00.*28,00/)
  })

  it('javni prikaz koristi istu tablicu i omogućuje povratak', () => {
    const onClose = vi.fn()
    render(<PricingPage onClose={onClose} />)
    expect(screen.getAllByRole('row')).toHaveLength(65)
    expect(screen.getByRole('button', { name: 'Preuzmi CSV' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Natrag' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
