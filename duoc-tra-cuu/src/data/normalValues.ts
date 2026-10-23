import rows from './normal-values'

export type NormalValue = (typeof rows)[number]

const DAY = 1
const WEEK = 7 * DAY
const MONTH = 365.25 / 12
const YEAR = 365.25

const unitInDays = (unit: string) => {
  if (unit.startsWith('phút')) return DAY / 1440
  if (unit.startsWith('giờ')) return DAY / 24
  if (unit.startsWith('ngày')) return DAY
  if (unit.startsWith('tuần')) return WEEK
  if (unit.startsWith('tháng')) return MONTH
  if (unit.startsWith('tuổi')) return YEAR
  return null
}

type AgeToken = { value: number; unit: number; comparator: string }

const parseToken = (raw: string, fallbackUnit?: number): AgeToken | null => {
  const match = raw.trim().match(/^([<>≤≥]?)\s*(\d+(?:[.,]\d+)?)\s*(phút|giờ|ngày|tuần|tháng|tuổi)?$/i)
  if (!match) return null
  const unit = match[3] ? unitInDays(match[3].toLowerCase()) : fallbackUnit
  if (!unit) return null
  return { value: Number(match[2].replace(',', '.')), unit, comparator: match[1] }
}

const inclusiveUpper = (token: AgeToken) => (token.value + 1) * token.unit

export function isAgeApplicable(label: string, ageDays: number) {
  const value = label.trim().toLowerCase().replace(/–/g, '-')

  if (['mọi tuổi', 'không theo tuổi', 'không nêu tuổi', 'trẻ em hoặc người lớn', 'trẻ em/vị thành niên/người lớn'].includes(value)) return true
  if (value === 'máu cuống rốn' || value === 'lúc sinh') return ageDays < DAY
  if (value === 'sơ sinh' || value === 'thời kỳ sơ sinh' || value === 'sơ sinh non tháng' || value === 'sơ sinh đủ tháng') return ageDays < 28 * DAY
  if (value === 'không phải sơ sinh') return ageDays >= 28 * DAY
  if (value === 'nhũ nhi') return ageDays < YEAR
  if (value.startsWith('tuổi thai ') || value.startsWith('non tháng ')) return ageDays < 28 * DAY
  if (value === 'người lớn dùng thuốc tránh thai uống') return ageDays >= 18 * YEAR
  if (value === 'thời thơ ấu') return ageDays >= 28 * DAY && ageDays < 18 * YEAR
  if (value === 'trẻ em' || value === 'trẻ em/vị thành niên') return ageDays < 19 * YEAR
  if (value === 'người lớn') return ageDays >= 18 * YEAR

  const adultRange = value.match(/^người lớn\s*\((.+)\)$/)
  const rangeValue = adultRange ? adultRange[1] : value

  if (rangeValue.endsWith('-người lớn')) {
    const start = parseToken(rangeValue.replace(/-người lớn$/, ''))
    return start ? ageDays >= start.value * start.unit : true
  }

  const rangeParts = rangeValue.split('-')
  if (rangeParts.length === 2) {
    const upperWithUnit = parseToken(rangeParts[1])
    const lower = parseToken(rangeParts[0], upperWithUnit?.unit)
    const upper = upperWithUnit ?? parseToken(rangeParts[1], lower?.unit)
    if (!lower || !upper) return true
    const min = lower.value * lower.unit + (lower.comparator === '>' ? Number.EPSILON : 0)
    const max = upper.comparator === '<'
      ? upper.value * upper.unit
      : inclusiveUpper(upper)
    return ageDays >= min && ageDays < max
  }

  const token = parseToken(rangeValue)
  if (!token) return true
  if (token.comparator === '<' || token.comparator === '≤') {
    const max = token.comparator === '<' ? token.value * token.unit : inclusiveUpper(token)
    return ageDays < max
  }
  if (token.comparator === '>' || token.comparator === '≥') {
    const min = token.value * token.unit + (token.comparator === '>' ? Number.EPSILON : 0)
    return ageDays >= min
  }
  return ageDays >= token.value * token.unit && ageDays < inclusiveUpper(token)
}

export function isClassificationApplicable(classification: string, sex: 'boy' | 'girl') {
  if (classification === 'Nam' || classification.startsWith('Nam;')) return sex === 'boy'
  if (classification === 'Nữ' || classification.startsWith('Nữ;')) return sex === 'girl'
  return true
}

export const normalValues = rows
