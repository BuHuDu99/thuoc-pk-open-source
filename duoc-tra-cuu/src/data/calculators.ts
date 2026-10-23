export type DoseInputs = { weight: number; age: number }
export type DoseResult = { primary: string; detail?: string; warning?: string }
export type DoseCalculator = {
  id: string
  group: 'Hô hấp' | 'Tiêu hoá' | 'Dị ứng & ho' | 'Khác'
  name: string
  code: string
  indication: string
  calculate: (inputs: DoseInputs) => DoseResult
}

export type DiseaseSection = {
  id: string
  label: string
  description: string
  calculatorIds: string[]
  countLabel?: string
  referenceItems?: string[]
}

export type DiseaseGroup = {
  id: 'respiratory' | 'gastrointestinal' | 'allergy' | 'dermatology'
  label: string
  sourceSheet: string
  description: string
  sections: DiseaseSection[]
}

const n = (value: number, digits = 1) =>
  new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(value)

const mg = (value: number) => `${n(value)} mg`

const oseltamivirDose = ({ weight, age }: DoseInputs) => {
  if (age < 0.75) return 3 * weight
  if (age < 1) return 3.5 * weight
  if (weight <= 15) return 30
  if (weight <= 23) return 45
  if (weight <= 40) return 60
  return 75
}

const hpBand = (weight: number, values: [number, number, number, number]) => {
  if (weight < 15) return null
  if (weight <= 24) return values[0]
  if (weight <= 34) return values[1]
  if (weight <= 49) return values[2]
  return values[3]
}

export type HpScheduleRow = {
  drug: string
  morning: string
  noon: string
  afternoon: string
  evening: string
  note?: string
}

export const calculateHpSchedule = (weight: number, age: number): HpScheduleRow[] => {
  const outside = weight < 15
  const fixed = (value: number | null) => outside || value === null ? 'Ngoài phạm vi' : `${value} mg`
  const amoxicillin = hpBand(weight, [500, 750, 1000, 1000])
  const metronidazole = hpBand(weight, [250, 250, 500, 750])
  const ppi = hpBand(weight, [20, 30, 40, 40])
  const bismuthSubsalicylate = `${age < 10 ? 262 : 524} mg`
  const tetracyclineDose = `${n(Math.min(weight * 50, 3000) / 4)} mg`

  const ppiRow: HpScheduleRow = {
    drug: 'PPI', morning: fixed(ppi), noon: '—', afternoon: fixed(ppi), evening: '—',
    note: '2 lần/ngày',
  }
  const metronidazoleRow: HpScheduleRow = {
    drug: 'Metronidazol', morning: fixed(metronidazole), noon: '—', afternoon: fixed(metronidazole), evening: '—',
    note: '2 lần/ngày',
  }
  const bismuthRow: HpScheduleRow = {
    drug: 'Bismuth subsalicylate', morning: bismuthSubsalicylate, noon: bismuthSubsalicylate,
    afternoon: bismuthSubsalicylate, evening: bismuthSubsalicylate, note: '4 lần/ngày · mỗi 6 giờ',
  }

  if (age < 8) return [
    ppiRow,
    { drug: 'Amoxicillin', morning: fixed(amoxicillin), noon: fixed(amoxicillin), afternoon: fixed(amoxicillin), evening: '—', note: '3 lần/ngày' },
    metronidazoleRow,
    bismuthRow,
  ]

  return [
    ppiRow,
    { drug: 'Tetracyclin', morning: tetracyclineDose, noon: tetracyclineDose, afternoon: tetracyclineDose, evening: tetracyclineDose, note: '4 lần/ngày · mỗi 6 giờ' },
    metronidazoleRow,
    bismuthRow,
  ]
}

export const calculators: DoseCalculator[] = [
  {
    id: 'para15', group: 'Hô hấp', name: 'Paracetamol', code: 'PARA15', indication: 'Hạ sốt, giảm đau',
    calculate: ({ weight }) => ({ primary: `${mg(weight * 15)}/lần`, detail: '15 mg/kg/lần' }),
  },
  {
    id: 'aug90', group: 'Hô hấp', name: 'Amoxicillin–clavulanate', code: 'AUG90', indication: 'Viêm phổi / viêm tai giữa',
    calculate: ({ weight }) => ({ primary: `${mg(weight * 90)}/ngày`, detail: 'Chia 2–3 lần' }),
  },
  {
    id: 'azi10-resp', group: 'Hô hấp', name: 'Azithromycin', code: 'AZI10', indication: 'Nhiễm khuẩn hô hấp',
    calculate: ({ weight }) => ({ primary: `${mg(weight * 10)}/ngày`, detail: 'Theo bảng: 10 mg/kg/ngày' }),
  },
  {
    id: 'clari15', group: 'Hô hấp', name: 'Clarithromycin', code: 'CLARI15', indication: 'Nhiễm khuẩn hô hấp',
    calculate: ({ weight }) => ({ primary: `${mg(weight * 15)}/ngày`, detail: 'Chia 2 lần' }),
  },
  {
    id: 'cefu25', group: 'Hô hấp', name: 'Cefuroxime', code: 'CEFU25', indication: 'Viêm phổi',
    calculate: ({ weight }) => ({ primary: `${mg(weight * 25)}/ngày`, detail: 'Chia 2 lần' }),
  },
  {
    id: 'levo', group: 'Hô hấp', name: 'Levofloxacin', code: 'LEVO', indication: 'Theo nhóm tuổi trong bảng',
    calculate: ({ weight, age }) => age < 0.5 || age > 16
      ? { primary: 'Ngoài phạm vi', warning: 'Bảng chỉ có công thức cho 6 tháng–16 tuổi.' }
      : age < 5
        ? { primary: `${mg(weight * 20)}/ngày`, detail: 'Chia 2 lần' }
        : { primary: `${mg(weight * 10)}/ngày`, detail: '1 lần/ngày' },
  },
  {
    id: 'oseltamivir-treat', group: 'Hô hấp', name: 'Oseltamivir – điều trị', code: 'OSELTAMIVIR', indication: 'Cúm',
    calculate: (input) => {
      const dose = oseltamivirDose(input)
      return dose >= 75
        ? { primary: '75 mg/lần', detail: '2 lần/ngày × 5 ngày' }
        : { primary: `${mg(dose)}/lần`, detail: `2 lần/ngày × 5 ngày · tương đương ${n(dose / 6)} mL/lần theo cách pha trong bảng` }
    },
  },
  {
    id: 'oseltamivir-prophylaxis', group: 'Hô hấp', name: 'Oseltamivir – dự phòng', code: 'OSELTAMIVIR', indication: 'Dự phòng cúm',
    calculate: (input) => input.age < 0.25
      ? { primary: 'Không khuyến cáo thường quy', detail: 'Trẻ dưới 3 tháng theo bảng gốc' }
      : { primary: `${mg(oseltamivirDose(input))}/lần`, detail: '1 lần/ngày × 7 ngày' },
  },
  {
    id: 'dexa015', group: 'Hô hấp', name: 'Dexamethasone', code: 'DEXA0.15', indication: 'Viêm thanh khí nhẹ',
    calculate: ({ weight }) => ({ primary: `${mg(Math.min(weight * 0.15, 16))}`, detail: 'Liều duy nhất · tối đa 16 mg' }),
  },
  {
    id: 'pred1', group: 'Hô hấp', name: 'Prednisolone', code: 'PRED1', indication: 'Viêm thanh khí',
    calculate: ({ weight }) => ({ primary: `${mg(Math.min(weight, 60))}/ngày`, detail: 'Theo bảng: 2–3 ngày · tối đa 60 mg' }),
  },
  {
    id: 'salbu', group: 'Hô hấp', name: 'Salbutamol', code: 'SALBU', indication: 'Suyễn nhẹ',
    calculate: ({ weight, age }) => ({ primary: `${n(weight < 20 && age < 5 ? 2.5 : 5)} mg`, detail: 'Theo mốc cân nặng và tuổi trong bảng' }),
  },
  {
    id: 'pred-asthma', group: 'Hô hấp', name: 'Prednisolone', code: 'PRED1–4', indication: 'Suyễn',
    calculate: ({ weight }) => ({ primary: `${mg(weight)}–${mg(weight * 4)}/ngày`, detail: 'Chia 2 lần × 3–5 ngày' }),
  },
  {
    id: 'methylpred', group: 'Hô hấp', name: 'Methylprednisolone', code: 'METHYLPRED', indication: 'Suyễn',
    calculate: ({ weight }) => ({ primary: `${mg(weight)}–${mg(weight * 4)}/ngày`, detail: 'Chia 3 lần × 3–10 ngày' }),
  },
  {
    id: 'montelukast', group: 'Hô hấp', name: 'Montelukast', code: 'MONTE', indication: 'Ngắn ngày theo bảng',
    calculate: ({ age }) => ({ primary: `${age > 5 ? 5 : 4} mg`, detail: 'Buổi tối · tối đa 14 ngày theo ghi chú gốc', warning: 'Bảng gốc còn ghi chú chưa xác định rõ chỉ định duy trì/phòng ngừa.' }),
  },
  {
    id: 'aug50', group: 'Hô hấp', name: 'Amoxicillin–clavulanate', code: 'AUG50', indication: 'Viêm mũi xoang / viêm họng',
    calculate: ({ weight }) => ({ primary: `${mg(weight * 50)}/ngày`, detail: 'Chia 2–3 lần; thời gian tùy nhóm trong bảng' }),
  },
  {
    id: 'eryth50', group: 'Hô hấp', name: 'Erythromycin', code: 'ERYTH50', indication: 'Viêm mũi xoang / viêm họng',
    calculate: ({ weight }) => ({ primary: `${mg(weight * 50)}/ngày`, detail: 'Theo bảng: 50 mg/kg/ngày' }),
  },
  {
    id: 'cefu30', group: 'Hô hấp', name: 'Cefuroxime', code: 'CEFU30', indication: 'Viêm mũi xoang / viêm họng',
    calculate: ({ weight }) => ({ primary: `${mg(weight * 30)}/ngày`, detail: 'Chia 2 lần × 5–7 ngày theo bảng' }),
  },
  {
    id: 'cefpo10', group: 'Hô hấp', name: 'Cefpodoxime', code: 'CEFPO10', indication: 'Viêm mũi xoang',
    calculate: ({ weight }) => ({ primary: `${mg(weight * 10)}/ngày`, detail: 'Theo bảng: 10 mg/kg/ngày' }),
  },
  {
    id: 'cefixime8', group: 'Tiêu hoá', name: 'Cefixime', code: 'CEFIXIME8', indication: 'Viêm ruột',
    calculate: ({ weight }) => ({ primary: `${mg(Math.ceil(Math.min(weight * 8, 400)))}/ngày`, detail: '1 lần/ngày · tối đa 400 mg' }),
  },
  {
    id: 'cipro20', group: 'Tiêu hoá', name: 'Ciprofloxacin', code: 'CIPRO20', indication: 'Viêm ruột',
    calculate: ({ weight, age }) => age < 2
      ? { primary: 'Không dùng theo bảng', warning: 'Công thức gốc trả về 0 khi tuổi dưới 2.' }
      : { primary: `${mg(Math.min(weight * 20, 1000))}/ngày`, detail: 'Chia 2 lần/ngày × 5 ngày · tối đa 1.000 mg' },
  },
  {
    id: 'azi10-gi', group: 'Tiêu hoá', name: 'Azithromycin', code: 'AZITH10', indication: 'Viêm ruột',
    calculate: ({ weight }) => ({ primary: `${mg(weight * 10)}/ngày`, detail: '1 lần/ngày' }),
  },
  {
    id: 'zinc', group: 'Tiêu hoá', name: 'Kẽm', code: 'ZINC14N', indication: 'Rối loạn tiêu hoá / viêm ruột',
    calculate: ({ age }) => ({ primary: `${age <= 0.5 ? 10 : 20} mg/ngày`, detail: '14 ngày theo mã ghi trong bảng' }),
  },
  {
    id: 'racecadotril', group: 'Tiêu hoá', name: 'Racecadotril', code: 'RACE1,5', indication: 'Tiêu chảy',
    calculate: ({ weight }) => {
      const raw = Math.ceil(1.5 * weight)
      const rounded = raw % 10 < 5 ? raw - (raw % 5) + 5 : raw - (raw % 10) + 10
      return { primary: `${mg(rounded)}/lần`, detail: '3 lần/ngày · làm tròn đúng theo công thức bảng' }
    },
  },
  {
    id: 'diosmec', group: 'Tiêu hoá', name: 'Diosmectite', code: 'DIOSMEC', indication: 'Tiêu chảy cấp · gói bột 3 g',
    // Smecta 3 g: ANSM RCP §4.2 explicitly includes children from age 2.
    // Sources and the adult age convention are recorded in audit/diosmectite-review-2026-10-17.md.
    calculate: ({ age }) => age < 2
      ? { primary: 'Không khuyến cáo dưới 2 tuổi', detail: 'Ưu tiên bù nước và điện giải bằng ORS.' }
      : age < 18
        ? { primary: '4 gói/ngày × 3 ngày', detail: 'Sau đó 2 gói/ngày × 4 ngày · kết hợp ORS.' }
        : { primary: '3 gói/ngày × 7 ngày', detail: 'Liều trung bình người lớn · bù nước và điện giải khi cần.' },
  },
  {
    id: 'simethicone', group: 'Tiêu hoá', name: 'Simethicone', code: 'SIMETHICONE', indication: 'Đầy hơi',
    calculate: ({ age }) => ({ primary: `${age < 2 ? 20 : 40} mg/lần`, detail: '4 lần/ngày' }),
  },
  {
    id: 'ondansetron', group: 'Tiêu hoá', name: 'Ondansetron', code: 'ONDANSETRON', indication: 'Nôn',
    calculate: ({ weight, age }) => weight <= 8 || age < 0.5
      ? { primary: 'Không dùng theo bảng' }
      : { primary: `${weight <= 15 ? 2 : weight <= 30 ? 4 : 8} mg/lần`, detail: 'Một lần; bảng ghi có thể mỗi 8 giờ nếu nôn nhiều' },
  },
  {
    id: 'duphalac', group: 'Tiêu hoá', name: 'Lactulose (Duphalac)', code: 'DUPHALAC', indication: 'Táo bón',
    calculate: ({ age }) => ({ primary: age < 1 ? '<4 mL' : age < 7 ? '5–10 mL' : age < 15 ? '15 mL' : '15–45 mL', detail: 'Mức liều theo tuổi trong bảng' }),
  },
  {
    id: 'esomeprazole', group: 'Tiêu hoá', name: 'Esomeprazole', code: 'ESO', indication: 'GERD',
    calculate: ({ weight }) => ({ primary: `${weight < 20 ? 10 : 20} mg`, detail: 'Mỗi 24 giờ' }),
  },
  {
    id: 'omeprazole', group: 'Tiêu hoá', name: 'Omeprazole', code: 'OME', indication: 'GERD',
    calculate: ({ weight }) => ({ primary: `${mg(weight)}–${mg(weight * 4)}`, detail: 'Mỗi 24 giờ theo công thức gốc' }),
  },
  {
    id: 'hp-amox', group: 'Tiêu hoá', name: 'Amoxicillin – phác đồ HP', code: 'HP AMOX', indication: 'HP (+), cân nặng ≥15 kg',
    calculate: ({ weight }) => {
      const value = hpBand(weight, [500, 750, 1000, 1000])
      return value ? { primary: `${value} mg/lần`, detail: '3 lần/ngày' } : { primary: 'Ngoài phạm vi', warning: 'File chỉ có mức liều từ 15 kg.' }
    },
  },
  {
    id: 'hp-metro', group: 'Tiêu hoá', name: 'Metronidazole – phác đồ HP', code: 'HP METRO', indication: 'HP (+), cân nặng ≥15 kg',
    calculate: ({ weight }) => {
      const value = hpBand(weight, [250, 250, 500, 750])
      return value ? { primary: `${value} mg/lần`, detail: '2 lần/ngày' } : { primary: 'Ngoài phạm vi', warning: 'File chỉ có mức liều từ 15 kg.' }
    },
  },
  {
    id: 'hp-ppi', group: 'Tiêu hoá', name: 'PPI – phác đồ HP', code: 'HP PPI', indication: 'HP (+), cân nặng ≥15 kg',
    calculate: ({ weight }) => {
      const value = hpBand(weight, [20, 30, 40, 40])
      return value ? { primary: `${value} mg/lần`, detail: '2 lần/ngày' } : { primary: 'Ngoài phạm vi', warning: 'File chỉ có mức liều từ 15 kg.' }
    },
  },
  {
    id: 'hp-bismuth-salicylate', group: 'Tiêu hoá', name: 'Bismuth subsalicylate – phác đồ HP', code: 'HP BIS-SAL', indication: 'Mức liều theo tuổi trong file',
    calculate: ({ age }) => ({ primary: `${age < 10 ? 262 : 524} mg/lần`, detail: 'Mỗi 6 giờ · 4 lần/ngày' }),
  },
  {
    id: 'hp-tetracycline', group: 'Tiêu hoá', name: 'Tetracyclin – phác đồ HP', code: 'HP TET', indication: 'HP (+), phác đồ PTMB',
    calculate: ({ weight, age }) => age < 8
      ? { primary: 'Không dùng <8 tuổi', warning: 'Theo mốc tuổi của phác đồ khởi đầu đã chọn.' }
      : { primary: `${mg(Math.min(weight * 50, 3000))}/ngày`, detail: 'Chia 4, mỗi 6 giờ' },
  },
  {
    id: 'cetirizine', group: 'Dị ứng & ho', name: 'Cetirizine', code: 'CETIRIZINE', indication: 'Viêm mũi dị ứng, mề đay',
    calculate: ({ age }) => age < 0.5 ? { primary: 'Chống chỉ định theo bảng' } : age < 6 ? { primary: '2,5 mg', detail: 'Tối đa 5 mg' } : age < 12 ? { primary: '5 mg' } : { primary: '10 mg' },
  },
  {
    id: 'levocetirizine', group: 'Dị ứng & ho', name: 'Levocetirizine', code: 'LEVOCETIRIZINE', indication: 'Mề đay, viêm mũi dị ứng',
    calculate: ({ age }) => age < 0.5 ? { primary: 'Chống chỉ định theo bảng' } : age < 6 ? { primary: '1,25 mg', detail: 'Tối đa 1,25 mg' } : age < 12 ? { primary: '2,5 mg', detail: 'Tối đa 2,5 mg' } : { primary: '5 mg', detail: 'Tối đa 5 mg' },
  },
  {
    id: 'loratadine', group: 'Dị ứng & ho', name: 'Loratadine', code: 'LORATADINE', indication: 'Viêm mũi dị ứng, mề đay',
    calculate: ({ age }) => age < 2 ? { primary: 'Chống chỉ định theo bảng' } : { primary: `${age < 6 ? 5 : 10} mg` },
  },
  {
    id: 'desloratadine', group: 'Dị ứng & ho', name: 'Desloratadine', code: 'DESLORATADINE', indication: 'Mề đay, viêm mũi dị ứng quanh năm',
    calculate: ({ age }) => age < 0.5 ? { primary: 'Chống chỉ định theo bảng' } : age < 1 ? { primary: '2 mL (1 mg)' } : age < 6 ? { primary: '2,5 mL (1,25 mg)' } : age < 12 ? { primary: '5 mL (2,5 mg)' } : { primary: '5 mg' },
  },
  {
    id: 'fexofenadine', group: 'Dị ứng & ho', name: 'Fexofenadine – siro', code: 'FEXOFENADINE', indication: 'Viêm mũi dị ứng',
    calculate: ({ age }) => age < 0.5 ? { primary: 'Chống chỉ định theo bảng' } : age < 2 ? { primary: '15 mg mỗi 12 giờ', warning: 'Công thức gốc có một nhánh mốc 10,5 không thể đạt khi tuổi tính theo năm; cần kiểm tra lại.' } : age < 12 ? { primary: '30 mg mỗi 12 giờ', detail: 'Tối đa 60 mg/ngày' } : { primary: '60 mg mỗi 12 giờ', detail: 'Tối đa 120 mg/ngày theo dòng này' },
  },
  {
    id: 'chlorpheniramine', group: 'Dị ứng & ho', name: 'Chlorpheniramine', code: 'CHLORPHENIRAMINE', indication: 'Viêm mũi dị ứng, cảm thường',
    calculate: ({ age }) => age < 1 / 12 ? { primary: 'Không dùng theo bảng' } : age < 2 ? { primary: '1 mg mỗi 12 giờ', detail: 'Hạn chế' } : age < 6 ? { primary: '1 mg mỗi 4–6 giờ', detail: 'Hạn chế' } : age < 12 ? { primary: '2 mg mỗi 4–6 giờ', detail: 'Tối đa 12 mg/ngày' } : { primary: '4 mg mỗi 4–6 giờ', detail: 'Tối đa 24 mg/ngày' },
  },
  {
    id: 'dextromethorphan', group: 'Dị ứng & ho', name: 'Dextromethorphan', code: 'DEXTROMETHORPHAN', indication: 'Ho khan',
    calculate: ({ age }) => age < 6 ? { primary: 'Chống chỉ định theo bảng' } : { primary: `${age >= 12 ? 20 : 10} mg/lần`, detail: 'Tối đa 6 lần/ngày theo ghi chú' },
  },
  {
    id: 'nac', group: 'Dị ứng & ho', name: 'Acetylcysteine (NAC)', code: 'NAC', indication: 'Ho có đờm',
    calculate: ({ age }) => age < 2 ? { primary: 'Chống chỉ định theo bảng' } : age < 8 ? { primary: '200 mg × 2 lần/ngày' } : { primary: '200 mg × 3 lần/ngày' },
  },
  {
    id: 'ambroxol', group: 'Dị ứng & ho', name: 'Ambroxol', code: 'AMBROXOL', indication: 'Ho có đờm',
    calculate: ({ age }) => age < 2 ? { primary: 'Chống chỉ định theo bảng' } : age < 6 ? { primary: '7,5–15 mg/lần', detail: 'Mỗi 8 giờ' } : age <= 12 ? { primary: '15–30 mg/lần', detail: 'Mỗi 8–12 giờ' } : { primary: '60–120 mg/lần', detail: 'Mỗi 8–12 giờ' },
  },
  {
    id: 'bromhexine', group: 'Dị ứng & ho', name: 'Bromhexine', code: 'BROMHEXINE', indication: 'Ho có đờm',
    calculate: ({ age }) => age < 2 ? { primary: 'Chống chỉ định theo bảng' } : age < 6 ? { primary: '4 mg/lần', detail: 'Mỗi 12 giờ · tối đa 8 mg/ngày' } : age < 12 ? { primary: '4–8 mg/lần', detail: 'Mỗi 8 giờ · tối đa 24 mg/ngày' } : { primary: '8–16 mg/lần', detail: 'Mỗi 8 giờ · tối đa 48 mg/ngày' },
  },
  {
    id: 'guaifenesin', group: 'Dị ứng & ho', name: 'Guaifenesin', code: 'GUAIFENESIN', indication: 'Ho có đờm',
    calculate: ({ age }) => age < 2 ? { primary: 'Chống chỉ định theo bảng' } : age < 6 ? { primary: '50–100 mg/lần', detail: 'Mỗi 4 giờ · tối đa 6 liều/ngày' } : age < 12 ? { primary: '100–200 mg/lần', detail: 'Mỗi 4 giờ · tối đa 6 liều/ngày' } : { primary: '200–400 mg/lần', detail: 'Mỗi 4 giờ · tối đa 6 liều/ngày' },
  },
  {
    id: 'fluticasone', group: 'Dị ứng & ho', name: 'Fluticasone propionate', code: '50 µg/nhát', indication: 'Viêm mũi dị ứng',
    calculate: ({ age }) => age < 4 ? { primary: 'Chống chỉ định theo bảng' } : { primary: '1–2 nhát mỗi bên', detail: '1 lần/ngày' },
  },
  {
    id: 'albendazole', group: 'Khác', name: 'Albendazole', code: 'ALBENDAZOLE', indication: 'Xổ giun',
    calculate: ({ age }) => age < 1 ? { primary: 'Ngoài phạm vi bảng' } : age < 2 ? { primary: '200 mg liều duy nhất' } : { primary: '400 mg liều duy nhất' },
  },
  {
    id: 'mebendazole', group: 'Khác', name: 'Mebendazole', code: 'MEBENDAZOLE', indication: 'Xổ giun',
    calculate: ({ age }) => age < 1 ? { primary: 'Ngoài phạm vi bảng' } : { primary: '500 mg liều duy nhất' },
  },
]

export const diseaseGroups: DiseaseGroup[] = [
  {
    id: 'respiratory',
    label: 'Hô hấp',
    sourceSheet: 'Resp',
    description: 'Viêm phổi, cúm, viêm thanh khí, suyễn và bệnh lý tai mũi họng',
    sections: [
      {
        id: 'pneumonia',
        label: 'Viêm phổi',
        description: 'Các công thức được đặt dưới mục VP trong bảng Resp.',
        calculatorIds: ['aug90', 'azi10-resp', 'clari15', 'cefu25', 'levo'],
      },
      {
        id: 'flu',
        label: 'Cúm',
        description: 'Điều trị và dự phòng bằng oseltamivir.',
        calculatorIds: ['oseltamivir-treat', 'oseltamivir-prophylaxis'],
      },
      {
        id: 'croup',
        label: 'Viêm thanh khí',
        description: 'Nhóm viêm thanh khí nhẹ trong bảng.',
        calculatorIds: ['dexa015', 'pred1', 'para15'],
      },
      {
        id: 'asthma',
        label: 'Suyễn',
        description: 'Nhóm suyễn nhẹ và thuốc corticosteroid đi kèm.',
        calculatorIds: ['salbu', 'pred-asthma', 'methylpred', 'montelukast'],
      },
      {
        id: 'rhinosinusitis',
        label: 'Viêm mũi xoang',
        description: 'Các lựa chọn được ghi tại mục viêm mũi xoang.',
        calculatorIds: ['aug50', 'eryth50', 'cefu30', 'cefpo10'],
      },
    ],
  },
  {
    id: 'gastrointestinal',
    label: 'Tiêu hoá',
    sourceSheet: 'Bệnh tiêu hoá',
    description: 'Rối loạn tiêu hoá, viêm ruột, GERD và phác đồ HP',
    sections: [
      {
        id: 'digestive-disorder',
        label: 'Rối loạn tiêu hoá',
        description: 'Nhóm thuốc dưới mục RLTH trong bảng.',
        calculatorIds: ['zinc', 'racecadotril', 'diosmec', 'simethicone', 'ondansetron', 'duphalac'],
        referenceItems: ['Men tiêu hoá: Nomagut 250 mg', 'Bioflora / Micezym 100 mg', 'ORS', 'Trimebutin 3–5 mg/kg, chia 3'],
      },
      {
        id: 'enteritis',
        label: 'Viêm ruột',
        description: 'Kháng sinh và thuốc hỗ trợ được ghi trong mục viêm ruột.',
        calculatorIds: ['cipro20', 'azi10-gi', 'cefixime8', 'zinc'],
        referenceItems: ['ORS', 'Men tiêu hoá dùng xa kháng sinh'],
      },
      {
        id: 'gerd',
        label: 'GERD',
        description: 'Nhóm thuốc ức chế tiết acid trong bảng.',
        calculatorIds: ['esomeprazole', 'omeprazole'],
      },
      {
        id: 'hp',
        label: 'HP (+)',
        description: 'Phác đồ khởi đầu PAMB hoặc PTMB theo tuổi trong bảng HP (+).',
        countLabel: 'Theo tuổi',
        calculatorIds: ['hp-amox', 'hp-metro', 'hp-ppi', 'hp-bismuth-salicylate', 'hp-tetracycline'],
      },
    ],
  },
  {
    id: 'allergy',
    label: 'Dị ứng & ho',
    sourceSheet: 'Antihistamine',
    description: 'Viêm mũi dị ứng, mề đay và thuốc ho',
    sections: [
      {
        id: 'allergic-rhinitis',
        label: 'Viêm mũi dị ứng',
        description: 'Kháng histamine và thuốc xịt mũi theo tuổi.',
        calculatorIds: ['cetirizine', 'levocetirizine', 'loratadine', 'desloratadine', 'fexofenadine', 'chlorpheniramine', 'fluticasone'],
      },
      {
        id: 'urticaria',
        label: 'Mề đay',
        description: 'Các thuốc được ghi chỉ định mề đay trong bảng.',
        calculatorIds: ['cetirizine', 'levocetirizine', 'loratadine', 'desloratadine'],
      },
      {
        id: 'dry-cough',
        label: 'Ho khan',
        description: 'Thuốc ho tác động trung ương và ghi chú liên quan.',
        calculatorIds: ['dextromethorphan', 'chlorpheniramine'],
      },
      {
        id: 'productive-cough',
        label: 'Ho có đờm',
        description: 'Nhóm tiêu đàm và thuốc ho tác động ngoại biên.',
        calculatorIds: ['nac', 'ambroxol', 'bromhexine', 'guaifenesin'],
      },
    ],
  },
  {
    id: 'dermatology',
    label: 'Da liễu & ký sinh',
    sourceSheet: 'Bệnh khác',
    description: 'Chàm da, ghẻ, xổ giun và chốc',
    sections: [
      {
        id: 'eczema',
        label: 'Chàm da',
        description: 'Thuốc được ghi theo vị trí và tình trạng tổn thương.',
        calculatorIds: [],
        referenceItems: ['Mặt: Tacrolimus 0,03 hoặc Hydrocorticoid', 'Vùng da dày: Fucicort', 'Chảy nước: thuốc tím hoặc chọn thuốc dạng gel'],
      },
      {
        id: 'scabies',
        label: 'Ghẻ',
        description: 'Ghi chú điều trị trong bảng Bệnh khác.',
        calculatorIds: [],
        referenceItems: ['Permethrin — kèm tư vấn', 'Ivermectin — nguồn đang để dạng câu hỏi “Khi nào cho?”'],
      },
      {
        id: 'deworming',
        label: 'Xổ giun',
        description: 'Liều theo tuổi được ghi trong bảng.',
        calculatorIds: ['albendazole', 'mebendazole'],
      },
      {
        id: 'impetigo',
        label: 'Chốc',
        description: 'Các thuốc bôi và ghi chú đi kèm trong nguồn.',
        calculatorIds: [],
        referenceItems: ['Mupirocin', 'Acid fusidic', '± Amoxicillin', 'Ghi chú nguồn: tắm nước chè xanh'],
      },
    ],
  },
]
