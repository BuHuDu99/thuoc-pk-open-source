import whoBmi from './who-bmi.json'
import whoBmiUnder5 from './who-bmi-under5.json'
import cdcBmi from './cdc-bmi.json'
import growthReferenceData from './growth-reference.json'

export type Sex = 'boy' | 'girl'
export type GrowthReference = 'who' | 'cdc'

type LmsRow = [month: number, l: number, m: number, s: number, ...extra: number[]]
type CdcLmsRow = [month: number, l: number, m: number, s: number, p95: number]
type GrowthData = Record<string, Record<Sex, LmsRow[]>>

const whoReferences = whoBmi as Record<Sex, LmsRow[]>
const whoUnder5References = whoBmiUnder5 as Record<Sex, LmsRow[]>
const cdcReferences = cdcBmi as Record<Sex, CdcLmsRow[]>
const growthReferences = growthReferenceData as unknown as { who: GrowthData; cdc: GrowthData }

const normalCdf = (z: number) => {
  const absolute = Math.abs(z)
  const t = 1 / (1 + 0.2316419 * absolute)
  const density = 0.3989423 * Math.exp(-(absolute * absolute) / 2)
  const tail = density * t * (
    0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))
  )
  return z >= 0 ? 1 - tail : tail
}

const whoBmiStatus = (zScore: number, age: number) => {
  if (zScore < -3) return { label: 'Gầy nặng', tone: 'alert' }
  if (zScore < -2) return { label: 'Gầy', tone: 'warning' }
  if (zScore <= 1) return { label: 'Trong giới hạn', tone: 'normal' }
  if (age < 5 && zScore <= 2) return { label: 'Nguy cơ thừa cân', tone: 'warning' }
  if (zScore <= 2) return { label: 'Thừa cân', tone: 'warning' }
  if (age < 5 && zScore <= 3) return { label: 'Thừa cân', tone: 'warning' }
  return { label: 'Béo phì', tone: 'alert' }
}

const nearestRow = (rows: LmsRow[], target: number) => rows.length ? rows.reduce(
  (closest, candidate) => Math.abs(candidate[0] - target) < Math.abs(closest[0] - target) ? candidate : closest,
) : undefined

const scoreFromLms = (value: number, row?: LmsRow) => {
  if (!row) return null
  const [, l, median, variation] = row
  const zScore = l === 0
    ? Math.log(value / median) / variation
    : (((value / median) ** l) - 1) / (l * variation)
  return { zScore, percentile: normalCdf(zScore) * 100 }
}

const metric = (label: string, value: number | null, unit: string, scope: string, row?: LmsRow) => ({
  label,
  value,
  unit,
  scope,
  score: value === null ? null : scoreFromLms(value, row),
})

const cdcBmiStatus = (percentile: number, bmi: number, p95: number) => {
  if (percentile < 5) return { label: 'Thiếu cân', tone: 'warning' }
  if (percentile < 85) return { label: 'Cân nặng khoẻ mạnh', tone: 'normal' }
  if (percentile < 95) return { label: 'Thừa cân', tone: 'warning' }
  if (bmi >= Math.max(p95 * 1.2, 35)) return { label: 'Béo phì nặng', tone: 'alert' }
  return { label: 'Béo phì', tone: 'alert' }
}

export function calculateAnthropometry(weight: number, height: number, age: number, sex: Sex, reference: GrowthReference) {
  if (weight <= 0 || age < 0) return null

  const hasHeight = height > 0
  const bmi = hasHeight ? weight / ((height / 100) ** 2) : null
  const bsa = hasHeight ? Math.sqrt((height * weight) / 3600) : null
  const ageInMonths = age * 12
  const ageInDays = age * 365.25
  let row: LmsRow | CdcLmsRow | undefined
  let referenceLabel = ''

  if (reference === 'who' && age >= 0 && age <= 19) {
    if (age < 5) {
      row = nearestRow(whoUnder5References[sex], ageInDays)
      referenceLabel = 'WHO 2006'
    } else {
      row = nearestRow(whoReferences[sex], ageInMonths)
      referenceLabel = 'WHO 2007'
    }
  } else if (reference === 'cdc' && age >= 0 && age <= 20) {
    if (age < 2) {
      row = nearestRow(whoUnder5References[sex], ageInDays)
      referenceLabel = 'WHO 2006'
    } else {
      row = nearestRow(cdcReferences[sex], ageInMonths)
      referenceLabel = 'CDC 2000'
    }
  }

  if (!row) {
    return {
      bmi,
      bsa,
      zScore: null,
      percentile: null,
      status: null,
      reference,
      referenceLabel: '',
      metrics: [
        metric('BMI theo tuổi', bmi, 'kg/m²', reference === 'who' ? 'WHO · 0–19 tuổi' : 'WHO <2 tuổi · CDC 2–20 tuổi'),
        metric('Cân nặng theo tuổi', weight, 'kg', reference === 'who' ? 'WHO · 0–10 tuổi' : 'WHO <2 tuổi · CDC 2–20 tuổi'),
        metric(age < 2 ? 'Chiều dài theo tuổi' : 'Chiều cao theo tuổi', hasHeight ? height : null, 'cm', reference === 'who' ? 'WHO · 0–19 tuổi' : 'WHO <2 tuổi · CDC 2–20 tuổi'),
        metric(age < 2 ? 'Cân nặng theo chiều dài' : 'Cân nặng theo chiều cao', hasHeight ? weight : null, 'kg', 'WHO/CDC · chủ yếu 0–5 tuổi'),
      ],
    }
  }

  const bmiScore = bmi === null ? null : scoreFromLms(bmi, row)
  const zScore = bmiScore?.zScore ?? null
  const percentile = bmiScore?.percentile ?? null

  let weightAgeRow: LmsRow | undefined
  let heightAgeRow: LmsRow | undefined
  let weightHeightRow: LmsRow | undefined
  let weightAgeScope = ''
  let heightAgeScope = ''
  let weightHeightScope = ''

  if (reference === 'who') {
    weightAgeScope = 'WHO · 0–10 tuổi'
    heightAgeScope = 'WHO · 0–19 tuổi'
    weightHeightScope = age < 2 ? 'WHO · 0–2 tuổi · 45–110 cm' : 'WHO · 2–5 tuổi · 65–120 cm'
    if (age < 5) {
      weightAgeRow = nearestRow(growthReferences.who.weightAgeUnder5[sex], ageInDays)
      heightAgeRow = nearestRow(growthReferences.who.heightAgeUnder5[sex], ageInDays)
    } else {
      if (age <= 10) weightAgeRow = nearestRow(growthReferences.who.weightAgeOlder[sex], ageInMonths)
      if (age <= 19) heightAgeRow = nearestRow(growthReferences.who.heightAgeOlder[sex], ageInMonths)
    }
    if (age < 2 && height >= 45 && height <= 110) weightHeightRow = nearestRow(growthReferences.who.weightLength[sex], height)
    if (age >= 2 && age < 5 && height >= 65 && height <= 120) weightHeightRow = nearestRow(growthReferences.who.weightHeight[sex], height)
  } else {
    weightAgeScope = 'WHO <2 tuổi · CDC 2–20 tuổi'
    heightAgeScope = 'WHO <2 tuổi · CDC 2–20 tuổi'
    weightHeightScope = age < 2 ? 'WHO · 0–2 tuổi · 45–110 cm' : 'CDC · 2–5 tuổi · 77–121,5 cm'
    if (age < 2) {
      weightAgeRow = nearestRow(growthReferences.who.weightAgeUnder5[sex], ageInDays)
      heightAgeRow = nearestRow(growthReferences.who.heightAgeUnder5[sex], ageInDays)
      if (height >= 45 && height <= 110) weightHeightRow = nearestRow(growthReferences.who.weightLength[sex], height)
    } else if (age <= 20) {
      weightAgeRow = nearestRow(growthReferences.cdc.weightAge[sex], ageInMonths)
      heightAgeRow = nearestRow(growthReferences.cdc.heightAge[sex], ageInMonths)
      if (age < 5 && height >= 77 && height <= 121.5) weightHeightRow = nearestRow(growthReferences.cdc.weightHeight[sex], height)
    }
  }

  return {
    bmi,
    bsa,
    zScore,
    percentile,
    status: bmiScore
      ? referenceLabel.startsWith('WHO')
        ? whoBmiStatus(bmiScore.zScore, age)
        : cdcBmiStatus(bmiScore.percentile, bmi!, (row as CdcLmsRow)[4])
      : null,
    reference,
    referenceLabel,
    metrics: [
      metric('BMI theo tuổi', bmi, 'kg/m²', reference === 'who' ? 'WHO · 0–19 tuổi' : 'WHO <2 tuổi · CDC 2–20 tuổi', row),
      metric('Cân nặng theo tuổi', weight, 'kg', weightAgeScope, weightAgeRow),
      metric(age < 2 ? 'Chiều dài theo tuổi' : 'Chiều cao theo tuổi', hasHeight ? height : null, 'cm', heightAgeScope, heightAgeRow),
      metric(age < 2 ? 'Cân nặng theo chiều dài' : 'Cân nặng theo chiều cao', hasHeight ? weight : null, 'kg', weightHeightScope, weightHeightRow),
    ],
  }
}

export function formatPercentile(percentile: number) {
  if (percentile < 1) return '< P1'
  if (percentile > 99) return '> P99'
  return `P${Math.round(percentile)}`
}
