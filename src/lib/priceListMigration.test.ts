/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '20260724_services_price_list.sql'),
  'utf8',
)
const importedBlock = sql.match(/with imported_services[\s\S]*?\)\s*insert into public\.services/i)?.[0] ?? ''
const importedRows = [...importedBlock.matchAll(
  /^\s*\((\d+), '([^']+)', '([^']+)', ([\d.]+), null, true, (true|false), (\d+)\),?$/gm,
)].map(match => ({
  sourceCode: Number(match[1]),
  categoryCode: match[2],
  name: match[3],
  price: Number(match[4]),
  isBookable: match[5] === 'true',
  displayOrder: Number(match[6]),
}))

describe('migracija cjenika', () => {
  it('raspoređuje svih 64 jedinstvenih stavki u 12 kategorija', () => {
    expect(importedRows).toHaveLength(64)
    expect(new Set(importedRows.map(item => item.sourceCode)).size).toBe(64)
    expect(new Set(importedRows.map(item => item.name.toLocaleLowerCase('hr'))).size).toBe(64)
    expect(new Set(importedRows.map(item => item.categoryCode)).size).toBe(12)
    expect(importedRows.map(item => item.displayOrder)).toEqual(Array.from({ length: 64 }, (_, index) => index + 1))
  })

  it('zadržava 49 samostalnih usluga i 15 dodataka', () => {
    expect(importedRows.filter(item => item.isBookable)).toHaveLength(49)
    expect(importedRows.filter(item => !item.isBookable)).toHaveLength(15)
  })

  it('zadržava sva trajanja kao NULL i očekivani raspored kategorija', () => {
    expect((importedBlock.match(/, null, true, (?:true|false),/g) ?? [])).toHaveLength(64)
    const counts = Object.fromEntries(
      [...new Set(importedRows.map(item => item.categoryCode))]
        .map(code => [code, importedRows.filter(item => item.categoryCode === code).length]),
    )
    expect(counts).toEqual({
      'color-addons': 15,
      'brows-lashes': 2,
      botox: 5,
      keratin: 7,
      perms: 3,
      washing: 1,
      formal: 3,
      cuts: 6,
      bridal: 4,
      care: 6,
      styling: 6,
      'cut-styling': 6,
    })
  })
})
