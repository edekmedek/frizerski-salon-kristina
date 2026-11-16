// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { officialPrices } from '../src/lib/officialPrices'
import { pricingCsv } from '../src/lib/pricingCsv'
import { preparePriceArchive } from './price-archive.mjs'
import { verifyPricePublication } from './verify-price-publication.mjs'

const temporaryDirs = []
afterEach(async () => {
  for (const dir of temporaryDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('javni CSV i trajna arhiva', () => {
  it('izvozi 64 usluge, tražene stupce i obje cijene u pravilnom redoslijedu', () => {
    const csv = pricingCsv(officialPrices)
    const rows = csv.trimEnd().split('\r\n')
    expect(rows).toHaveLength(65)
    expect(rows[0]).toBe('Naziv usluge;Maloprodajna cijena usluge;Poseban oblik prodaje;Naziv posebnog oblika prodaje;Bazna cijena usluge')
    expect(rows[1]).toBe('Aplikacija boje;5.00;NE;;5.00')
    expect(rows).toContain('Frizura XXL;28.00;NE;;25.00')
    expect(rows.slice(1).every(row => row.split(';')[2] === 'NE' && row.split(';')[3] === '')).toBe(true)
    expect(pricingCsv([{ id: '1', name: 'Usluga; "posebna"', base: 1, current: 2 }]))
      .toContain('"Usluga; ""posebna""";2.00;NE;;1.00')
  })

  it('čuva prethodne verzije, ne stvara kopiju bez promjene i objavljuje stalni URL', async () => {
    const root = await mkdtemp(join(tmpdir(), 'salon-prices-test-'))
    temporaryDirs.push(root)
    const archive = join(root, 'archive')
    const dist = join(root, 'dist')
    const initial = await preparePriceArchive(archive, dist, officialPrices, new Date('2026-11-16T17:15:00Z'))
    const first = initial.current
    expect(first).toBe('90703561_FRIZERSKI_SALON_SKOLSKA_18_PUSCINE_KRISTINA_USLUGE_1_20261116_1815.csv')
    expect(await readFile(join(dist, 'cjenik.csv'), 'utf8')).toBe(pricingCsv(officialPrices))
    const unchanged = await preparePriceArchive(archive, dist, officialPrices, new Date('2026-11-17T09:00:00Z'))
    expect(unchanged.versions).toHaveLength(1)

    const changed = officialPrices.map((price, index) => index === 0 ? { ...price, current: 6 } : price)
    const next = await preparePriceArchive(archive, dist, changed, new Date('2026-11-17T09:00:00Z'))
    expect(next.versions).toHaveLength(2)
    expect(await readFile(join(dist, 'cjenik', first), 'utf8')).toBe(pricingCsv(officialPrices))
    expect(await readFile(join(dist, 'cjenik.csv'), 'utf8')).toBe(pricingCsv(changed))
    expect(await readFile(join(dist, 'cjenik', 'index.html'), 'utf8')).toContain(first)
    expect(await readFile(join(dist, 'cjenik', 'index.html'), 'utf8')).toContain(next.current)

    const later = await preparePriceArchive(archive, dist, changed, new Date('2026-12-19T09:00:00Z'))
    expect(later.versions).toHaveLength(2)
    expect(await readFile(join(dist, 'cjenik', first), 'utf8')).toBe(pricingCsv(officialPrices))

    await writeFile(join(archive, first), 'oštećeno')
    await expect(preparePriceArchive(archive, dist, changed)).rejects.toThrow('Oštećen arhivski cjenik')
  })

  it('bilježi samo vrijeme stvarne potvrde obaju javnih CSV-ova', async () => {
    const root = await mkdtemp(join(tmpdir(), 'salon-prices-test-'))
    temporaryDirs.push(root)
    const archive = join(root, 'archive')
    const dist = join(root, 'dist')
    const prepared = await preparePriceArchive(archive, dist, officialPrices, new Date('2026-11-16T17:17:39Z'))
    const csv = pricingCsv(officialPrices)
    let publicManifest = prepared
    const fetcher = async url => new Response(url.pathname.endsWith('manifest.json') ? JSON.stringify(publicManifest) : csv)
    const verified = await verifyPricePublication(archive, dist, officialPrices, {
      fetcher, now: () => new Date('2026-11-16T17:18:01Z'), attempts: 1,
    })
    expect(verified.versions[0].preparedAt).toBe('2026-11-16T17:17:39.000Z')
    expect(verified.versions[0].firstVerifiedAt).toBe('2026-11-16T17:18:01.000Z')
    expect(JSON.parse(await readFile(join(dist, 'cjenik', 'manifest.json'), 'utf8'))).toEqual(verified)
    publicManifest = verified
    const repeated = await verifyPricePublication(archive, dist, officialPrices, {
      fetcher, now: () => new Date('2026-11-17T17:18:01Z'), attempts: 1,
    })
    expect(repeated.versions[0].firstVerifiedAt).toBe('2026-11-16T17:18:01.000Z')
  })

  it('ne bilježi potvrdu kad se javni CSV razlikuje od izvora', async () => {
    const root = await mkdtemp(join(tmpdir(), 'salon-prices-test-'))
    temporaryDirs.push(root)
    const archive = join(root, 'archive')
    const dist = join(root, 'dist')
    const prepared = await preparePriceArchive(archive, dist, officialPrices)
    const fetcher = async url => new Response(url.pathname.endsWith('manifest.json') ? JSON.stringify(prepared) : 'stari cjenik')
    await expect(verifyPricePublication(archive, dist, officialPrices, { fetcher, attempts: 1 }))
      .rejects.toThrow('Javnu objavu cjenika nije moguće potvrditi')
    expect(JSON.parse(await readFile(join(archive, 'manifest.json'), 'utf8')).versions[0].firstVerifiedAt).toBeUndefined()
  })

  it('odbija zastarjeli javni manifest i zadržava arhivu bez promjene', async () => {
    const root = await mkdtemp(join(tmpdir(), 'salon-prices-test-'))
    temporaryDirs.push(root)
    const archive = join(root, 'archive')
    const dist = join(root, 'dist')
    const prepared = await preparePriceArchive(archive, dist, officialPrices)
    const fetcher = async url => new Response(url.pathname.endsWith('manifest.json')
      ? JSON.stringify({ ...prepared, current: 'stari.csv' }) : pricingCsv(officialPrices))
    await expect(verifyPricePublication(archive, dist, officialPrices, { fetcher, attempts: 1 }))
      .rejects.toThrow('Javnu objavu cjenika nije moguće potvrditi')
    expect(JSON.parse(await readFile(join(archive, 'manifest.json'), 'utf8'))).toEqual(prepared)
  })
})
