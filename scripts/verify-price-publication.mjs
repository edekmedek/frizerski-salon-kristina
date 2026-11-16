import { createHash, randomUUID } from 'node:crypto'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { officialPrices } from '../src/lib/officialPrices.ts'
import { pricingCsv } from '../src/lib/pricingCsv.ts'

export async function verifyPricePublication(archiveDir, distDir, prices, options = {}) {
  const { baseUrl = 'https://frizerskisalonkristina.hr', fetcher = fetch, now = () => new Date(), attempts = 12, delayMs = 5000 } = options
  const manifestPath = join(archiveDir, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const version = manifest.versions?.at(-1)
  if (!version || manifest.current !== version.filename ||
      !/^90703561_FRIZERSKI_SALON_SKOLSKA_18_PUSCINE_KRISTINA_USLUGE_\d+_\d{8}_\d{4}\.csv$/.test(version.filename)) {
    throw new Error('Neispravan popis arhiviranih cjenika.')
  }
  const expected = pricingCsv(prices)
  const archived = await readFile(join(archiveDir, version.filename), 'utf8')
  const digest = createHash('sha256').update(expected, 'utf8').digest('hex')
  if (archived !== expected || version.sha256 !== digest) {
    throw new Error('Arhivski cjenik ne odgovara službenom izvoru.')
  }

  const token = randomUUID()
  async function get(path) {
    const url = new URL(path, baseUrl)
    url.searchParams.set('provjera', token)
    const response = await fetcher(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
    return response.text()
  }

  let lastError
  let verified = false
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const [current, named, publishedManifest] = await Promise.all([
        get('/cjenik.csv'), get(`/cjenik/${version.filename}`), get('/cjenik/manifest.json'),
      ])
      const publicManifest = JSON.parse(publishedManifest)
      const publicVersion = publicManifest.versions?.at(-1)
      if (current !== expected || named !== expected || publicManifest.current !== version.filename ||
          publicVersion?.filename !== version.filename || publicVersion.sha256 !== digest ||
          (version.firstVerifiedAt && publicVersion.firstVerifiedAt !== version.firstVerifiedAt)) {
        throw new Error('Javni cjenik ili manifest još ne odgovara novoj verziji.')
      }
      verified = true
      break
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        console.warn(`Provjera javne objave ${attempt}/${attempts} nije uspjela:`, error)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
  }
  if (!verified) throw new Error('Javnu objavu cjenika nije moguće potvrditi.', { cause: lastError })

  if (!version.firstVerifiedAt) {
    version.firstVerifiedAt = now().toISOString()
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  }
  await copyFile(manifestPath, join(distDir, 'cjenik', 'manifest.json'))
  console.info(`Javni cjenik potvrđen; prva potvrda ${version.firstVerifiedAt}; oznaka naziva označuje pripremu ${version.preparedAt}.`)
  return manifest
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 4) throw new Error('Uporaba: verify-price-publication.mjs <arhiva> <dist>')
  await verifyPricePublication(process.argv[2], process.argv[3], officialPrices)
}
