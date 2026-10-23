import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { calculators } from '../src/data/calculators.ts'

const drug = calculators.find((item) => item.id === 'diosmec')

test('Smecta powder 3 g: never suggests a sachet dose below age 2', () => {
  for (const age of [0, 0.5, 1, 1.5, 2 - 1 / 365.25]) {
    const result = drug.calculate({ weight: 12, age })
    assert.match(result.primary, /Không khuyến cáo dưới 2 tuổi/)
    assert.doesNotMatch(result.primary, /gói/)
    assert.match(result.detail, /ORS/)
  }
})

test('age 2 is included; pediatric acute diarrhea has both phases independent of weight', () => {
  for (const age of [2, 2 + 1 / 365.25, 6, 17.99]) {
    for (const weight of [10, 20, 60]) {
      const result = drug.calculate({ weight, age })
      assert.equal(result.primary, '4 gói/ngày × 3 ngày')
      assert.match(result.detail, /2 gói\/ngày × 4 ngày/)
      assert.match(result.detail, /ORS/)
    }
  }
})

test('adult group starts at 18 and uses the standard adult course without automatic doubling', () => {
  for (const age of [18, 40, 80]) {
    assert.equal(drug.calculate({ weight: 60, age }).primary, '3 gói/ngày × 7 ngày')
  }
})

test('directory no longer supplies infant doses and explicitly identifies powder formulation', () => {
  const directory = JSON.parse(readFileSync(new URL('../src/data/drugs.json', import.meta.url), 'utf8'))
  const entry = directory.find((item) => item.id === 72)
  assert.match(entry.presentation, /bột.*3 g/)
  assert.match(entry.usage, /dưới 2 tuổi: không khuyến cáo/)
  assert.doesNotMatch(entry.usage, /Trẻ < 1 tuổi|Trẻ từ 1-2 tuổi/)
  assert.match(entry.usage, /4 gói\/ngày trong 3 ngày đầu, sau đó 2 gói\/ngày trong 4 ngày/)
  assert.match(entry.usage, /3 gói\/ngày trong 7 ngày/)
  assert.match(entry.usage, /Không áp dụng hướng dẫn này cho Smecta Go/)
})
