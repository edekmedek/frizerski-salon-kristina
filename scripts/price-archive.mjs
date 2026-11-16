import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { officialPrices } from '../src/lib/officialPrices.ts'
import { pricingCsv } from '../src/lib/pricingCsv.ts'

const filenamePattern = /^90703561_FRIZERSKI_SALON_SKOLSKA_18_PUSCINE_KRISTINA_USLUGE_\d+_\d{8}_\d{4}\.csv$/
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex')

function timestamp(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Zagreb', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const get = type => parts.find(part => part.type === type).value
  return `${get('year')}${get('month')}${get('day')}_${get('hour')}${get('minute')}`
}

export async function preparePriceArchive(archiveDir, distDir, prices, now = new Date()) {
  if (!prices.length || prices.some(price => !price.name || !Number.isFinite(price.base) ||
      !Number.isFinite(price.current) || price.base < 0 || price.current < 0)) {
    throw new Error('Službeni cjenik sadrži neispravne podatke.')
  }
  await mkdir(archiveDir, { recursive: true })
  const manifestPath = join(archiveDir, 'manifest.json')
  const entries = await readdir(archiveDir)
  let manifest
  if (entries.length === 0) {
    manifest = { current: '', versions: [] }
    await writeFile(join(archiveDir, '.gitattributes'), '*.csv -text\n', 'utf8')
  } else {
    if ((await readFile(join(archiveDir, '.gitattributes'), 'utf8')).replace(/\r\n/g, '\n') !== '*.csv -text\n') {
      throw new Error('Neispravne Git postavke arhivskih CSV datoteka.')
    }
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (!Array.isArray(manifest.versions) || !manifest.versions.length ||
        manifest.current !== manifest.versions.at(-1).filename) {
      throw new Error('Neispravan popis arhiviranih cjenika.')
    }
    const names = new Set()
    for (const [index, version] of manifest.versions.entries()) {
      if (typeof version.filename !== 'string' || !filenamePattern.test(version.filename) ||
          version.sequence !== index + 1 || names.has(version.filename)) {
        throw new Error('Neispravna verzija arhiviranog cjenika.')
      }
      names.add(version.filename)
      const contents = await readFile(join(archiveDir, version.filename), 'utf8')
      if (hash(contents) !== version.sha256) throw new Error(`Oštećen arhivski cjenik: ${version.filename}`)
    }
    if (entries.some(name => name !== 'manifest.json' && name !== '.gitattributes' && !names.has(name))) {
      throw new Error('Arhiva sadrži datoteke koje nisu u popisu verzija.')
    }
  }

  const csv = pricingCsv(prices)
  const digest = hash(csv)
  if (!manifest.versions.length || manifest.versions.at(-1).sha256 !== digest) {
    const sequence = manifest.versions.length + 1
    const filename = `90703561_FRIZERSKI_SALON_SKOLSKA_18_PUSCINE_KRISTINA_USLUGE_${sequence}_${timestamp(now)}.csv`
    await writeFile(join(archiveDir, filename), csv, { encoding: 'utf8', flag: 'wx' })
    manifest.versions.push({ filename, sequence, sha256: digest, preparedAt: now.toISOString() })
    manifest.current = filename
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  }

  const publicDir = join(distDir, 'cjenik')
  await mkdir(publicDir, { recursive: true })
  await copyFile(manifestPath, join(publicDir, 'manifest.json'))
  for (const version of manifest.versions) {
    await copyFile(join(archiveDir, version.filename), join(publicDir, version.filename))
  }
  await copyFile(join(archiveDir, manifest.current), join(distDir, 'cjenik.csv'))
  const links = [...manifest.versions].reverse().map(version =>
    `<li><a href="${version.filename}">${version.filename}</a></li>`
  ).join('\n')
  await writeFile(join(publicDir, 'index.html'),
    `<!doctype html><html lang="hr"><head><meta charset="utf-8"><title>Cjenik salona Kristina</title></head><body><h1>Cjenik salona Kristina</h1><p><a href="/cjenik.csv">Aktualni CSV na stalnoj adresi</a></p><h2>Objavljene verzije</h2><ul>${links}</ul></body></html>\n`,
    'utf8')
  return manifest
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 4) throw new Error('Uporaba: price-archive.mjs <arhiva> <dist>')
  await preparePriceArchive(process.argv[2], process.argv[3], officialPrices)
}
