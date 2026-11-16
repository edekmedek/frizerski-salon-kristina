import type { OfficialPrice } from './officialPrices'

function csvCell(value: string) {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function pricingCsv(prices: readonly OfficialPrice[]) {
  const header = 'Naziv usluge;Maloprodajna cijena usluge;Poseban oblik prodaje;Naziv posebnog oblika prodaje;Bazna cijena usluge'
  const rows = prices.map(price =>
    [csvCell(price.name), price.current.toFixed(2), 'NE', '', price.base.toFixed(2)].join(';')
  )
  return [header, ...rows].join('\r\n') + '\r\n'
}
