export type PidReferenceBand = {
  label: string
  minDays: number
  maxDays?: number
  values: string[]
}

export type PidReferenceSection = {
  id: string
  title: string
  columns: string[]
  bands: PidReferenceBand[]
  source: string
}


export const pidSourceUrl = 'https://docs.google.com/spreadsheets/'

export const pidReferenceSections: PidReferenceSection[] = []

export const findPidBand = (section: PidReferenceSection, ageDays: number) =>
  section.bands.find((band) => ageDays >= band.minDays && (band.maxDays === undefined || ageDays < band.maxDays))
