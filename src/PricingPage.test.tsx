import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PriceTable, PricingPage } from './PricingPage'
import { formatPrice, officialPrices } from './lib/officialPrices'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

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

  it('preuzima stvarno objavljenu verziju s propisanim nazivom', async () => {
    const filename = '90703561_FRIZERSKI_SALON_SKOLSKA_18_PUSCINE_KRISTINA_USLUGE_1_20261116_1815.csv'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ current: filename }) }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.getAttribute('href')).toBe(`/cjenik/${filename}`)
      expect(this.download).toBe(filename)
    })
    render(<PricingPage onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preuzmi CSV' }))
    await waitFor(() => expect(click).toHaveBeenCalledOnce())
  })

  it('prijavljuje neuspješno preuzimanje', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<PricingPage onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preuzmi CSV' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Cjenik nije moguće preuzeti')
  })
})
