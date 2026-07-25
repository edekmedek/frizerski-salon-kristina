import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const testDataDirectory = join(process.cwd(), 'supabase', 'test_data')
const seed = readFileSync(join(testDataDirectory, '20260725_schedule_test_seed.sql'), 'utf8')
const repair = readFileSync(join(testDataDirectory, '20260725_schedule_test_utf8_repair.sql'), 'utf8')
const cleanup = readFileSync(join(testDataDirectory, '20260725_schedule_test_cleanup.sql'), 'utf8')

describe('UTF-8 TEST podaci', () => {
  it('koristi ASCII-sigurne PostgreSQL Unicode escapeove za hrvatska imena', () => {
    expect(seed).toContain("U&'Radi\\0107'")
    expect(seed).toContain("U&'\\0160ari\\0107'")
    expect(seed).toContain("U&'[TEST] Probni termin \\2013 kristina_schedule_seed_v1'")
  })

  it('popravak i cleanup ciljaju samo precizni TEST marker', () => {
    expect(repair).toContain("where test_seed_tag = 'kristina_schedule_seed_v1'")
    expect(cleanup).toContain("where test_seed_tag = 'kristina_schedule_seed_v1'")
    expect(cleanup.toLocaleLowerCase('en')).not.toContain('truncate')
    expect(cleanup.toLocaleLowerCase('en')).not.toContain('where starts_at')
  })

  it('SQL popravak ostaje potpuno ASCII-siguran za Windows međuspremnik', () => {
    expect([...repair].every(character => character.codePointAt(0)! <= 0x7f)).toBe(true)
  })
})
