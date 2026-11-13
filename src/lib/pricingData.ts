/**
 * Salon Kristina - Pricing Data
 * Data from: Cjenik aktualni.xlsx (aktualna cijena od 01.10.2026.)
 * This data structure contains all salon services and prices
 * Used for public pricing page and CSV export
 * NOTE: Names match Excel exactly, including spacing and typos
 */

export const pricingData = {
  generated_at: new Date().toISOString(),
  currency: 'EUR',
  vat_status: 'Sve cijene uključuju PDV',
  price_date: '2026-10-01',
  categories: [
    {
      id: 'sisanje',
      name: 'Šišanje',
      description: 'Profesionalne usluge šišanja',
      services: [
        { id: '54', name: 'Šišanje i oblikovanje', price: 15 },
        { id: '55', name: 'Šišanje i pranje kose', price: 14 },
        { id: '56', name: 'Šišanje kose', price: 10 },
        { id: '57', name: 'Šišanje kose mašinica', price: 7 },
        { id: '58', name: 'Šišanje šiški', price: 4 },
        { id: '59', name: 'Šišanje pranje i oblikovanje', price: 18 },
      ],
    },
    {
      id: 'bojanje',
      name: 'Bojanje i detalji',
      description: 'Bojanje i posebne tehnike',
      services: [
        { id: '2', name: ' Aplikacija boje', price: 5 },
        { id: '11', name: 'Bojenje obrva', price: 3 },
        { id: '13', name: 'Bojenje trepavica', price: 4 },
      ],
    },
    {
      id: 'tretmani',
      name: 'Tretmani - Botox i Keratin',
      description: 'Profesionalni tretmani za koso',
      services: [
        { id: '14', name: 'Botox 1', price: 60 },
        { id: '15', name: 'Botox 2', price: 70 },
        { id: '16', name: 'Botox 3', price: 80 },
        { id: '17', name: 'Botox 4', price: 90 },
        { id: '18', name: 'Botox 5', price: 100 },
        { id: '22', name: 'Keratin 1', price: 70 },
        { id: '23', name: 'Keratin 2', price: 90 },
        { id: '24', name: 'Keratin 3', price: 110 },
        { id: '25', name: 'Keratin 4', price: 130 },
        { id: '26', name: 'Keratin 5', price: 150 },
        { id: '27', name: 'Keratin 6', price: 170 },
        { id: '28', name: 'Keratin 7', price: 190 },
      ],
    },
    {
      id: 'minival',
      name: 'Minival',
      description: 'Brze kose prema duljini',
      services: [
        { id: '30', name: 'Minival srednja kosa', price: 55 },
        { id: '31', name: 'Minival kratka kosa', price: 45 },
        { id: '32', name: 'Minival duga kosa', price: 85 },
      ],
    },
    {
      id: 'frizure',
      name: 'Frizure',
      description: 'Svečane, vjenčane i posebne frizure',
      services: [
        { id: '40', name: 'Pranje kose', price: 5 },
        { id: '47', name: 'Svečana frizura duga kosa', price: 50 },
        { id: '48', name: 'Svečana frizura srednja kosa ', price: 30 },
        { id: '49', name: 'Svečana frizura kratka kosa ', price: 25 },
        { id: '63', name: 'Vjenčana frizura duga kosa', price: 70 },
        { id: '64', name: 'Vjenčana frizura srednjaa kosa', price: 60 },
        { id: '65', name: 'Vjenčana frizura kratka kosa', price: 50 },
        { id: '66', name: 'Češljanje', price: 4 },
      ],
    },
  ],
}

/**
 * Get all services as a flat list
 */
export function getAllServices() {
  return pricingData.categories.flatMap(cat =>
    cat.services.map(svc => ({
      ...svc,
      category: cat.name,
      categoryId: cat.id,
    }))
  )
}

/**
 * Export data as CSV string
 * Format: Service Code, Service Name, Price (EUR)
 */
export function toCsvString() {
  const lines = [
    'Šifra,Naziv usluge,Cijena (EUR)',
  ]

  getAllServices().forEach(svc => {
    const name = svc.name.replace(/"/g, '""')
    const line = [
      svc.id,
      `"${name}"`,
      svc.price.toString(),
    ].join(',')
    lines.push(line)
  })

  return lines.join('\n')
}
