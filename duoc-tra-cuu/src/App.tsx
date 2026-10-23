import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BookOpenText,
  Bug,
  Calculator,
  ChevronRight,
  HeartPulse,
  Info,
  ImagePlus,
  Mail,
  Search,
  Shield,
  Stethoscope,
  Ruler,
  ExternalLink,
  FileText,
  NotebookPen,
  Pencil,
  Plus,
  Save,
  Send,
  Trash2,
  UserRound,
  Wind,
  X,
} from 'lucide-react'
import drugs from './data/drugs'
import { calculateAnthropometry, formatPercentile } from './data/anthropometry'
import { SdScale } from './SdScale'
import { formatSd } from './sd-format'
import type { GrowthReference, Sex } from './data/anthropometry'
import { calculateHpSchedule, calculators, diseaseGroups } from './data/calculators'
import type { DiseaseGroup, DoseCalculator } from './data/calculators'
import { findPidBand, pidReferenceSections, pidSourceUrl } from './data/pid'
import { isAgeApplicable, isClassificationApplicable, normalValues } from './data/normalValues'
import './App.css'

type View = 'calculator' | 'pid' | 'pedz' | 'normal' | 'drugs' | 'notes'
type Drug = (typeof drugs)[number]
type AgeUnit = 'years' | 'months' | 'days'

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()

const views: { id: View; label: string; icon: typeof Calculator }[] = [
  { id: 'calculator', label: 'Nhóm bệnh', icon: Calculator },
  { id: 'drugs', label: 'Toàn bộ thuốc', icon: BookOpenText },
  { id: 'pedz', label: 'Ped(z)', icon: Ruler },
  { id: 'normal', label: 'Normal values', icon: Activity },
  { id: 'pid', label: 'PID', icon: Shield },
  { id: 'notes', label: 'Ghi chú', icon: NotebookPen },
]

function App() {
  const [weightInput, setWeightInput] = useState('')
  const [ageInput, setAgeInput] = useState('')
  const [ageUnit, setAgeUnit] = useState<AgeUnit>('years')
  const [heightInput, setHeightInput] = useState('')
  const [sex, setSex] = useState<Sex>('boy')
  const [growthReference, setGrowthReference] = useState<GrowthReference>('who')
  const [view, setView] = useState<View>('calculator')
  const [query, setQuery] = useState('')
  const [diseaseGroupId, setDiseaseGroupId] = useState<DiseaseGroup['id']>('respiratory')
  const [sectionId, setSectionId] = useState('pneumonia')
  const [selectedDrug, setSelectedDrug] = useState<Drug | null>(null)

  const weight = weightInput === '' ? 0 : Number(weightInput)
  const age = ageInput === '' ? Number.NaN : Number(ageInput)
  const height = heightInput === '' ? 0 : Number(heightInput)
  const ageYears = ageUnit === 'days' ? age / 365.25 : ageUnit === 'months' ? age / 12 : age
  const ageDays = ageYears * 365.25
  const requiredInputsComplete = weightInput !== '' && ageInput !== ''
  const validInputs = requiredInputsComplete && weight > 0 && ageYears >= 0
  const inputWarning = !requiredInputsComplete
    ? 'Cân nặng và tuổi là hai thông tin bắt buộc.'
    : !validInputs
      ? 'Vui lòng nhập cân nặng lớn hơn 0 và tuổi không âm.'
    : weight > 200 || ageYears > 120 || height > 250
      ? 'Giá trị nằm ngoài phạm vi thường dùng. Hãy kiểm tra lại.'
      : ''

  const changeAgeUnit = (nextUnit: AgeUnit) => {
    if (nextUnit === ageUnit) return
    if (ageInput === '') {
      setAgeUnit(nextUnit)
      return
    }
    const nextValue = nextUnit === 'days' ? ageYears * 365.25 : nextUnit === 'months' ? ageYears * 12 : ageYears
    setAgeInput(nextValue.toFixed(nextUnit === 'years' ? 2 : 1).replace(/\.0+$/, ''))
    setAgeUnit(nextUnit)
  }

  const drugMatches = useMemo(() => {
    const needle = normalize(query.trim())
    if (!needle) return drugs
    return drugs.filter((drug) =>
      normalize(`${drug.name} ${drug.category} ${drug.presentation} ${drug.usage}`).includes(needle),
    )
  }, [query])

  const navigate = (nextView: View) => {
    setView(nextView)
    setQuery('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand-button" type="button" onClick={() => navigate('calculator')} aria-label="Về trang tính liều">
          <span className="brand-mark" aria-hidden="true"><Stethoscope size={22} /></span>
          <span className="brand-copy"><strong>Tra cứu</strong></span>
        </button>

        <nav className="desktop-nav" aria-label="Điều hướng chính">
          {views.map(({ id, label }) => (
            <button key={id} type="button" className={view === id ? 'active' : ''} onClick={() => navigate(id)}>{label}</button>
          ))}
        </nav>

      </header>

      <section className={`workspace${view === 'pedz' ? ' pedz-workspace' : ''}`}>
        <aside className="patient-panel">
          <div className="section-kicker">Thông tin tính liều</div>

          <div className="input-grid">
            <label>
              <span>Cân nặng <b className="required-mark">*</b></span>
              <div className="input-wrap">
                <input required aria-required="true" aria-label="Cân nặng kg, bắt buộc" placeholder="Nhập" type="number" min="0.1" max="300" step="0.1" value={weightInput} onChange={(event) => setWeightInput(event.target.value)} />
                <em>kg</em>
              </div>
            </label>
            <label>
              <span>Tuổi <b className="required-mark">*</b></span>
              <div className="input-wrap age-wrap">
                <input required aria-required="true" aria-label={`Tuổi ${ageUnit === 'years' ? 'năm' : ageUnit === 'months' ? 'tháng' : 'ngày'}, bắt buộc`} placeholder="Nhập" type="number" min="0" max={ageUnit === 'years' ? 130 : ageUnit === 'months' ? 1560 : 47482} step="0.1" value={ageInput} onChange={(event) => setAgeInput(event.target.value)} />
                <select aria-label="Đơn vị tuổi" value={ageUnit} onChange={(event) => changeAgeUnit(event.target.value as AgeUnit)}>
                  <option value="years">năm</option>
                  <option value="months">tháng</option>
                  <option value="days">ngày</option>
                </select>
              </div>
            </label>
            <label>
              <span>{Number.isFinite(ageYears) && ageYears < 2 ? 'Chiều dài nằm' : 'Chiều cao'} <small className="optional-mark">(tùy chọn)</small></span>
              <div className="input-wrap">
                <input aria-label={Number.isFinite(ageYears) && ageYears < 2 ? 'Chiều dài nằm cm, tùy chọn' : 'Chiều cao cm, tùy chọn'} placeholder="Nhập nếu có" type="number" min="20" max="250" step="0.1" value={heightInput} onChange={(event) => setHeightInput(event.target.value)} />
                <em>cm</em>
              </div>
            </label>
            <fieldset className="sex-field">
              <legend>Giới tính</legend>
              <div className="sex-toggle">
                <button type="button" className={sex === 'boy' ? 'active' : ''} onClick={() => setSex('boy')}>Nam</button>
                <button type="button" className={sex === 'girl' ? 'active' : ''} onClick={() => setSex('girl')}>Nữ</button>
              </div>
            </fieldset>
          </div>

          <fieldset className="reference-field">
            <legend>Chuẩn tăng trưởng</legend>
            <div className="reference-toggle">
              <button type="button" className={growthReference === 'who' ? 'active' : ''} onClick={() => setGrowthReference('who')}><strong>WHO</strong><small>0–19 tuổi</small></button>
              <button type="button" className={growthReference === 'cdc' ? 'active' : ''} onClick={() => setGrowthReference('cdc')}><strong>CDC / WHO</strong><small>0–20 tuổi</small></button>
            </div>
          </fieldset>

          {inputWarning ? (
            <div className="input-alert"><AlertTriangle size={17} />{inputWarning}</div>
          ) : (
            <div className="patient-summary"><span>Đang tính cho</span><strong>{sex === 'boy' ? 'Nam' : 'Nữ'} · {weight} kg{height > 0 ? ` · ${height} cm` : ''} · {ageInput} {ageUnit === 'years' ? 'tuổi' : ageUnit === 'months' ? 'tháng' : 'ngày'}</strong></div>
          )}

          <AnthropometryCard weight={weight} height={height} age={ageYears} sex={sex} reference={growthReference} ready={validInputs} />

          <div className="source-note">
            <Info size={17} />
            <p>WHO hỗ trợ từ lúc sinh; lựa chọn CDC/WHO tự dùng WHO dưới 2 tuổi và CDC từ 2 tuổi.</p>
          </div>
        </aside>

        <section className="content-panel">
          {view !== 'notes' && view !== 'pid' && view !== 'pedz' && (
            <div className="search-box">
              <Search size={20} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={view === 'drugs' ? 'Tìm tên, phân loại hoặc cách dùng...' : view === 'normal' ? 'Tìm xét nghiệm, nhóm hoặc mẫu bệnh phẩm...' : 'Tìm thuốc trong bệnh đang chọn...'}
                aria-label={view === 'drugs' ? 'Tìm trong danh mục thuốc' : view === 'normal' ? 'Tìm khoảng tham chiếu' : 'Tìm công thức'}
              />
              {query && <button className="clear-search" type="button" onClick={() => setQuery('')} aria-label="Xoá tìm kiếm"><X size={17} /></button>}
              <kbd>{view === 'drugs' ? `${drugs.length} thuốc` : view === 'normal' ? `${normalValues.length} dòng` : '4 nhóm bệnh'}</kbd>
            </div>
          )}

          {view === 'calculator' && (
            <DiseaseBrowser
              query={query}
              diseaseGroupId={diseaseGroupId}
              sectionId={sectionId}
              onGroupChange={(nextGroupId) => {
                const nextGroup = diseaseGroups.find((item) => item.id === nextGroupId)!
                setDiseaseGroupId(nextGroupId)
                setSectionId(nextGroup.sections[0].id)
                setQuery('')
              }}
              onSectionChange={(nextSectionId) => {
                setSectionId(nextSectionId)
                setQuery('')
              }}
              weight={weight}
              age={ageYears}
              validInputs={validInputs}
            />
          )}

          {view === 'pid' && (ageInput !== '' ? <PidReference ageDays={ageDays} ageLabel={`${ageInput} ${ageUnit === 'years' ? 'tuổi' : ageUnit === 'months' ? 'tháng' : 'ngày'}`} /> : <RequiredAgeState />)}

          {view === 'pedz' && <PedzWindow />}

          {view === 'normal' && (ageInput !== '' ? <NormalValues ageDays={ageDays} ageLabel={`${ageInput} ${ageUnit === 'years' ? 'tuổi' : ageUnit === 'months' ? 'tháng' : 'ngày'}`} sex={sex} query={query} /> : <RequiredAgeState />)}

          {view === 'drugs' && (
            <DrugDirectory items={drugMatches} query={query} onSelect={setSelectedDrug} />
          )}

          {view === 'notes' && <NotesView />}
        </section>
      </section>

      <nav className="mobile-nav" aria-label="Điều hướng di động">
        {views.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className={view === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={20} /><span>{label}</span></button>
        ))}
      </nav>

      {selectedDrug && <DrugDialog drug={selectedDrug} onClose={() => setSelectedDrug(null)} />}
    </main>
  )
}

function AnthropometryCard({ weight, height, age, sex, reference, ready }: { weight: number; height: number; age: number; sex: Sex; reference: GrowthReference; ready: boolean }) {
  const result = ready ? calculateAnthropometry(weight, height, age, sex, reference) : null

  if (!result) {
    return (
      <section className="anthropometry-card waiting">
        <Activity size={19} />
        <div><strong>Đặc điểm sinh trắc</strong><span>Nhập cân nặng và tuổi để bắt đầu. Chiều cao là tùy chọn.</span></div>
      </section>
    )
  }

  return (
    <section className="anthropometry-card" aria-live="polite">
      <div className="anthropometry-heading">
        <div><Activity size={18} /><strong>Đặc điểm sinh trắc</strong></div>
        <div className="anthropometry-badges">
          {result.bsa !== null && <span className="bsa-badge">BSA {result.bsa.toFixed(2)} m²</span>}
          {result.status && <span className={`status-${result.status.tone}`}>{result.status.label}</span>}
        </div>
      </div>
      <div className="anthropometry-metrics">
        {result.metrics.map((item) => (
          <div key={item.label} className={!item.score ? 'metric-unavailable' : ''}>
            <span>{item.label}</span>
            <strong>{item.value === null ? 'Chưa nhập' : item.value.toFixed(1)}</strong>{item.value !== null && <small>{item.unit}</small>}
            {item.value === null
              ? <div className="metric-score"><b>Cần chiều cao</b></div>
              : item.score
              ? <><div className="metric-score"><b>{formatPercentile(item.score.percentile)}</b><i>{formatSd(item.score.zScore)}</i></div><SdScale value={item.score.zScore} label={item.label} /></>
              : <div className="metric-score"><b>Ngoài phạm vi</b></div>}
            <p>{item.scope}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function RequiredAgeState() {
  return <div className="empty-state compact"><AlertTriangle size={26} /><h3>Chưa có tuổi</h3><p>Nhập tuổi ở phần thông tin để hiển thị dữ liệu theo nhóm tuổi.</p></div>
}

function PidReference({ ageDays, ageLabel }: { ageDays: number; ageLabel: string }) {
  return (
    <div className="pid-reference-page">
      <div className="page-heading pid-reference-heading">
        <div>
          <span className="section-kicker">Primary immunodeficiency</span>
          <h2>PID · Khoảng tham chiếu theo tuổi</h2>
          <p>Đang hiển thị kết quả tương ứng với <strong>{ageLabel}</strong>.</p>
        </div>
        <a href={pidSourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Mở file nguồn</a>
      </div>

      <div className="pid-reference-list" aria-live="polite">
        {pidReferenceSections.map((section) => {
          const band = findPidBand(section, ageDays)
          return (
            <section className="pid-reference-card" key={section.id}>
              <div className="pid-reference-title">
                <div><h3>{section.title}</h3><span>{band ? `Nhóm tuổi: ${band.label}` : 'Không có khoảng tham chiếu cho tuổi này trong file'}</span></div>
                {band && <strong>{band.label}</strong>}
              </div>

              {band ? (
                <div className="pid-reference-table" role="table" aria-label={`${section.title}, ${band.label}`}>
                  {section.columns.map((column, index) => (
                    <div className="pid-reference-cell" role="row" key={column}>
                      <span role="columnheader">{column}</span>
                      <strong role="cell">{band.values[index]}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="pid-no-range">Hãy đối chiếu trực tiếp file nguồn hoặc tài liệu chuyên môn phù hợp.</div>
              )}

              <p className="pid-card-source"><b>Nguồn:</b> {section.source}</p>
            </section>
          )
        })}
      </div>

    </div>
  )
}

function NormalValues({ ageDays, ageLabel, sex, query }: { ageDays: number; ageLabel: string; sex: Sex; query: string }) {
  const [category, setCategory] = useState('all')
  const needle = normalize(query.trim())
  const applicableRows = normalValues.filter((row) =>
    isAgeApplicable(row.age, ageDays) && isClassificationApplicable(row.classification, sex),
  )
  const categories = Array.from(new Set(applicableRows.map((row) => row.group)))
  const visibleRows = applicableRows.filter((row) =>
    (category === 'all' || row.group === category) &&
    (!needle || normalize(`${row.test} ${row.group} ${row.sample} ${row.age} ${row.classification} ${row.range} ${row.unit} ${row.note ?? ''}`).includes(needle)),
  )
  const groupedRows = Array.from(visibleRows.reduce((groups, row) => {
    const existing = groups.get(row.test) ?? []
    existing.push(row)
    groups.set(row.test, existing)
    return groups
  }, new Map<string, typeof visibleRows>()))

  return (
    <div className="normal-values-page">
      <div className="page-heading normal-values-heading">
        <div><span className="section-kicker">Khoảng tham chiếu theo tuổi</span><h2>Normal values</h2><p>Đang lọc cho {sex === 'boy' ? 'nam' : 'nữ'}, {ageLabel}.</p></div>
        <span>{visibleRows.length} dòng · {groupedRows.length} xét nghiệm</span>
      </div>

      <div className="normal-category-row" aria-label="Lọc nhóm xét nghiệm">
        <button type="button" className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>Tất cả <span>{applicableRows.length}</span></button>
        {categories.map((item) => {
          const count = applicableRows.filter((row) => row.group === item).length
          return <button type="button" className={category === item ? 'active' : ''} onClick={() => setCategory(item)} key={item}>{item} <span>{count}</span></button>
        })}
      </div>

      {groupedRows.length === 0 ? (
        <div className="empty-state compact"><Search size={26} /><h3>Không có kết quả phù hợp</h3><p>Thử từ khoá khác hoặc chọn lại nhóm xét nghiệm.</p></div>
      ) : (
        <div className="normal-values-list">
          {groupedRows.map(([test, testRows]) => (
            <article className="normal-value-card" key={test}>
              <header><div><span>{testRows[0].group}</span><h3>{test}</h3></div><strong>{testRows.length > 1 ? `${testRows.length} khoảng` : testRows[0].unit}</strong></header>
              <div className="normal-range-list">
                {testRows.map((row, index) => (
                  <section className="normal-range-row" key={`${row.age}-${row.classification}-${row.range}-${index}`}>
                    <div className="normal-range-context"><strong>{row.age}</strong><span>{row.classification}</span><small>{row.sample}</small></div>
                    <div className="normal-range-value"><strong>{row.range}</strong><span>{row.unit}</span></div>
                    <div className="normal-range-source"><span>{row.source} · trang {row.bookPage}</span>{row.note && <p>{row.note}</p>}{row.review !== 'Khớp bản in' && <p className="source-warning">{row.review}</p>}</div>
                  </section>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="normal-values-note">Nguồn: AAP Reference Range Values for Pediatric Care, 2nd ed. · Harriet Lane Handbook, 24th ed.</p>
    </div>
  )
}

function PedzWindow() {
  return <div className="pedz-page"><a href="https://www.pedz.de/de/pedz/main.html" target="_blank" rel="noreferrer">Mở Ped(z) trên trang của tác giả</a></div>
}

const diseaseIcons = {
  respiratory: Wind,
  gastrointestinal: HeartPulse,
  allergy: Shield,
  dermatology: Bug,
}

function HpProtocolPanel({ weight, age }: { weight: number; age: number }) {
  const rows = calculateHpSchedule(weight, age)
  const initialRegimen = age < 8
    ? { ageGroup: 'Trẻ <8 tuổi', code: 'PAMB', drugs: 'PPI + Amox + Metronidazol + Bismuth' }
    : { ageGroup: 'Trẻ ≥8 tuổi', code: 'PTMB', drugs: 'PPI + Tetracyclin + Metronidazol + Bismuth' }
  return (
    <section className="hp-protocol" aria-label="Phác đồ HP theo file nguồn">
      <div className="hp-protocol-heading">
        <div><Stethoscope size={19} /><div><strong>HP (+) · phác đồ khởi đầu</strong></div></div>
        <span className="hp-source-label">Sheet Bệnh tiêu hoá</span>
      </div>

      <div className="hp-initial-regimen" aria-label={`Phác đồ khởi đầu ${initialRegimen.code}`}>
        <span>Phác đồ khởi đầu · {initialRegimen.ageGroup}</span>
        <div><strong>{initialRegimen.code}</strong><p>{initialRegimen.drugs}</p></div>
      </div>

      <div className="hp-schedule" role="table" aria-label="Lịch dùng thuốc HP">
        <div className="hp-schedule-row hp-schedule-head" role="row">
          <span role="columnheader">Thuốc</span><span role="columnheader">Sáng</span><span role="columnheader">Trưa</span><span role="columnheader">Chiều</span><span role="columnheader">Tối</span><span role="columnheader">Ghi chú</span>
        </div>
        {rows.map((row) => (
          <div className="hp-schedule-row" role="row" key={row.drug}>
            <strong role="cell">{row.drug}</strong><span role="cell">{row.morning}</span><span role="cell">{row.noon}</span><span role="cell">{row.afternoon}</span><span role="cell">{row.evening}</span><small role="cell">{row.note || '—'}</small>
          </div>
        ))}
      </div>
    </section>
  )
}

function DiseaseBrowser({ query, diseaseGroupId, sectionId, onGroupChange, onSectionChange, weight, age, validInputs }: {
  query: string
  diseaseGroupId: DiseaseGroup['id']
  sectionId: string
  onGroupChange: (group: DiseaseGroup['id']) => void
  onSectionChange: (section: string) => void
  weight: number
  age: number
  validInputs: boolean
}) {
  const selectedGroup = diseaseGroups.find((item) => item.id === diseaseGroupId) ?? diseaseGroups[0]
  const selectedSection = selectedGroup.sections.find((item) => item.id === sectionId) ?? selectedGroup.sections[0]
  const needle = normalize(query.trim())
  const items = selectedSection.calculatorIds
    .map((id) => calculators.find((item) => item.id === id))
    .filter((item): item is DoseCalculator => Boolean(item))
    .filter((item) => !needle || normalize(`${item.name} ${item.code} ${item.indication}`).includes(needle))

  return (
    <>
      <div className="page-heading">
        <div><span className="section-kicker">Tra cứu có phân cấp</span><h2>Thuốc theo nhóm bệnh</h2></div>
        <span>4 nhóm · {calculators.length} công thức</span>
      </div>

      <div className="disease-grid" aria-label="Chọn nhóm bệnh">
        {diseaseGroups.map((item) => {
          const Icon = diseaseIcons[item.id]
          const count = new Set(item.sections.flatMap((section) => section.calculatorIds)).size
          return (
            <button key={item.id} type="button" className={selectedGroup.id === item.id ? 'active' : ''} onClick={() => onGroupChange(item.id)}>
              <span className="disease-icon"><Icon size={20} /></span>
              <span className="disease-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
              <span className="disease-count">{count || item.sections.length}</span>
            </button>
          )
        })}
      </div>

      <div className="condition-header">
        <div><h3>{selectedGroup.label}</h3></div>
        <small>{selectedGroup.sections.length} nhóm bệnh</small>
      </div>

      <div className="condition-tabs" role="region" tabIndex={0} aria-label={`Các bệnh trong nhóm ${selectedGroup.label}`}>
        {selectedGroup.sections.map((section) => (
          <button key={section.id} type="button" className={selectedSection.id === section.id ? 'active' : ''} onClick={() => onSectionChange(section.id)}>
            {section.label}
            <span>{section.countLabel ?? (section.calculatorIds.length || section.referenceItems?.length || 0)}</span>
          </button>
        ))}
      </div>

      <section className="condition-intro">
        <div><span className="section-kicker">{selectedGroup.label}</span><h3>{selectedSection.label}</h3><p>{selectedSection.description}</p></div>
        <span>{selectedSection.id === 'hp' ? 'Phác đồ theo tuổi' : `${items.length} công thức`}</span>
      </section>

      {!validInputs ? (
        <div className="empty-state"><AlertTriangle size={26} /><h3>Chưa thể tính liều</h3><p>Kiểm tra lại tuổi và cân nặng ở phần thông tin.</p></div>
      ) : selectedSection.id === 'hp' ? (
        <HpProtocolPanel weight={weight} age={age} />
      ) : items.length === 0 ? (
        query ? <div className="empty-state compact"><Search size={26} /><h3>Không tìm thấy thuốc</h3><p>Thử tên khác hoặc chọn một bệnh khác.</p></div> : null
      ) : (
        <div className="calculator-grid">
          {items.map((item) => {
            const result = item.calculate({ weight, age })
            return (
              <article className={`calculator-card${result.warning ? ' needs-review' : ''}`} key={item.id}>
                <div className="card-meta"><span>{item.group}</span><code>{item.code}</code></div>
                <h3>{item.name}</h3>
                <p className="indication">{item.indication}</p>
                <div className="result-block"><strong>{result.primary}</strong>{result.detail && <span>{result.detail}</span>}</div>
                {result.warning && <div className="review-note"><AlertTriangle size={15} />{result.warning}</div>}
              </article>
            )
          })}
        </div>
      )}

      {selectedSection.referenceItems && selectedSection.referenceItems.length > 0 && (
        <section className="reference-medications">
          <div className="reference-heading"><Info size={18} /><div><strong>Thuốc và ghi chú khác</strong><span>Có trong nhóm bệnh này nhưng chưa có công thức tự động riêng.</span></div></div>
          <div className="reference-pills">
            {selectedSection.referenceItems.map((item) => <span key={item}>{item}</span>)}
          </div>
        </section>
      )}
    </>
  )
}

function DrugDirectory({ items, query, onSelect }: { items: Drug[]; query: string; onSelect: (drug: Drug) => void }) {
  return (
    <>
      <div className="page-heading">
        <div><span className="section-kicker">Tra cứu</span><h2>Danh mục thuốc</h2></div>
        <span>{items.length} / {drugs.length} thuốc</span>
      </div>
      {items.length === 0 ? (
        <div className="empty-state"><Search size={26} /><h3>Không tìm thấy thuốc</h3><p>Không có kết quả cho “{query}”. Hãy thử tên hoạt chất hoặc nhóm thuốc.</p></div>
      ) : (
        <div className="drug-list">
          {items.map((drug) => (
            <button className="drug-row" type="button" key={drug.id} onClick={() => onSelect(drug)}>
              <span className="drug-index">{String(drug.id).padStart(3, '0')}</span>
              <span className="drug-main"><strong>{drug.name}</strong><small>{drug.category || 'Chưa phân loại'}</small></span>
              <span className="drug-presentation">{drug.presentation || 'Chưa ghi dạng trình bày'}</span>
              <ChevronRight size={19} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function DrugDialog({ drug, onClose }: { drug: Drug; onClose: () => void }) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="drug-dialog" role="dialog" aria-modal="true" aria-labelledby="drug-dialog-title">
        <button className="dialog-close" type="button" onClick={onClose} aria-label="Đóng"><X size={20} /></button>
        <span className="section-kicker">Chi tiết thuốc</span>
        <h2 id="drug-dialog-title">{drug.name}</h2>
        <div className="category-tag">{drug.category || 'Chưa phân loại'}</div>
        <div className="detail-section"><h3>Trình bày</h3><p>{drug.presentation || 'Chưa có thông tin trong bảng.'}</p></div>
        <div className="detail-section usage"><h3>Cách dùng trong bảng</h3><p>{drug.usage || 'Chưa có thông tin trong bảng.'}</p></div>
        <div className="dialog-warning"><AlertTriangle size={18} /><p>Nội dung dùng để tra cứu cá nhân. Đối chiếu nguồn chuyên môn trước khi áp dụng.</p></div>
      </section>
    </div>
  )
}

type PatientNote = {
  id: string
  patientName: string
  content: string
  contentHtml?: string
  createdAt: string
  updatedAt: string
  emailedAt?: string
}

const NOTES_STORAGE_KEY = 'tra-cuu.patient-notes.v1'
const MAX_NOTE_IMAGES = 2
const MAX_INLINE_IMAGE_CHARACTERS = 1_600_000

const escapeNoteHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;')

const plainTextToNoteHtml = (value: string) => escapeNoteHtml(value).replace(/\n/g, '<br>')

const sanitizeNoteHtml = (html: string) => {
  const source = document.createElement('template')
  const clean = document.createElement('div')
  source.innerHTML = html
  const allowedTags = new Set(['BR', 'DIV', 'P', 'STRONG', 'B', 'EM', 'I', 'UL', 'OL', 'LI', 'IMG'])

  const appendCleanNode = (node: Node, parent: HTMLElement) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.append(document.createTextNode(node.textContent ?? ''))
      return
    }
    if (!(node instanceof HTMLElement)) return
    if (!allowedTags.has(node.tagName)) {
      Array.from(node.childNodes).forEach((child) => appendCleanNode(child, parent))
      return
    }

    const next = document.createElement(node.tagName.toLowerCase())
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') ?? ''
      if (!/^data:image\/(jpeg|png|webp);base64,/i.test(src)) return
      next.setAttribute('src', src)
      next.setAttribute('alt', node.getAttribute('alt') || 'Ảnh trong ghi chú')
    }
    Array.from(node.childNodes).forEach((child) => appendCleanNode(child, next))
    parent.append(next)
  }

  Array.from(source.content.childNodes).forEach((node) => appendCleanNode(node, clean))
  return clean.innerHTML
}

const noteHtmlToText = (html: string) => {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = html.replace(/<br\s*\/?\s*>/gi, '\n')
  return (wrapper.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}

const optimizeNoteImage = (file: File) => new Promise<string>((resolve, reject) => {
  if (!file.type.startsWith('image/')) {
    reject(new Error('Chỉ hỗ trợ tệp hình ảnh.'))
    return
  }
  const reader = new FileReader()
  reader.onerror = () => reject(new Error('Không thể đọc ảnh này.'))
  reader.onload = () => {
    const image = new Image()
    image.onerror = () => reject(new Error('Không thể xử lý ảnh này.'))
    image.onload = () => {
      const scale = Math.min(1, 1200 / Math.max(image.width, image.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('Trình duyệt không thể xử lý ảnh.'))
        return
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', .72))
    }
    image.src = String(reader.result)
  }
  reader.readAsDataURL(file)
})

const loadPatientNotes = (): PatientNote[] => {
  if (typeof window === 'undefined') return []

  try {
    const saved = JSON.parse(window.localStorage.getItem(NOTES_STORAGE_KEY) ?? '[]')
    if (!Array.isArray(saved)) return []

    return saved.filter((note): note is PatientNote =>
      typeof note?.id === 'string' &&
      typeof note?.patientName === 'string' &&
      typeof note?.content === 'string' &&
      typeof note?.createdAt === 'string' &&
      typeof note?.updatedAt === 'string',
    )
  } catch {
    return []
  }
}

const formatNoteTime = (value: string) => new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
}).format(new Date(value))

function NotesView() {
  const [notes, setNotes] = useState<PatientNote[]>(loadPatientNotes)
  const [patientName, setPatientName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [noteQuery, setNoteQuery] = useState('')
  const [message, setMessage] = useState('')
  const [lastSavedId, setLastSavedId] = useState<string | null>(null)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [emailErrors, setEmailErrors] = useState<Record<string, string>>({})
  const [imageMessage, setImageMessage] = useState('')
  const [isDraggingImage, setIsDraggingImage] = useState(false)
  const [storageError, setStorageError] = useState('')
  const editorRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)

  useEffect(() => {
    try {
      window.localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes))
      setStorageError('')
    } catch {
      setStorageError('Bộ nhớ trình duyệt đã đầy. Hãy xoá bớt ghi chú có ảnh trước khi tải lại trang.')
    }
  }, [notes])

  const visibleNotes = useMemo(() => {
    const needle = normalize(noteQuery.trim())
    if (!needle) return notes
    return notes.filter((note) => normalize(`${note.patientName} ${note.content}`).includes(needle))
  }, [noteQuery, notes])

  const resetEditor = () => {
    setPatientName('')
    if (editorRef.current) editorRef.current.innerHTML = ''
    setEditingId(null)
    setMessage('')
    setImageMessage('')
  }

  const saveNote = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextName = patientName.trim()
    const nextHtml = sanitizeNoteHtml(editorRef.current?.innerHTML ?? '')
    const nextContent = noteHtmlToText(nextHtml)
    const hasImage = /<img\b/i.test(nextHtml)

    if (!nextName || (!nextContent && !hasImage)) {
      setMessage('Vui lòng nhập tên bệnh nhân và nội dung ghi chú.')
      return
    }

    const now = new Date().toISOString()
    if (editingId) {
      setNotes((current) => current.map((note) => note.id === editingId
        ? { ...note, patientName: nextName, content: nextContent, contentHtml: nextHtml, updatedAt: now, emailedAt: undefined }
        : note))
      setLastSavedId(editingId)
      setMessage('Đã cập nhật ghi chú.')
    } else {
      const id = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      setNotes((current) => [{ id, patientName: nextName, content: nextContent, contentHtml: nextHtml, createdAt: now, updatedAt: now }, ...current])
      setLastSavedId(id)
      setMessage('Đã lưu ghi chú.')
    }

    setPatientName('')
    if (editorRef.current) editorRef.current.innerHTML = ''
    setEditingId(null)
    setImageMessage('')
  }

  const editNote = (note: PatientNote) => {
    setPatientName(note.patientName)
    if (editorRef.current) editorRef.current.innerHTML = note.contentHtml || plainTextToNoteHtml(note.content)
    setEditingId(note.id)
    setPendingDeleteId(null)
    setMessage('Đang sửa ghi chú đã chọn.')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const addImagesToEditor = async (files: File[], insertionRange?: Range | null) => {
    if (!files.length || !editorRef.current) return

    const currentImages = editorRef.current.querySelectorAll('img').length
    const remainingSlots = MAX_NOTE_IMAGES - currentImages
    if (remainingSlots <= 0) {
      setImageMessage(`Mỗi ghi chú tối đa ${MAX_NOTE_IMAGES} ảnh.`)
      return
    }

    setImageMessage('Đang tối ưu ảnh...')
    try {
      const images = await Promise.all(files.slice(0, remainingSlots).map(optimizeNoteImage))
      const existingCharacters = Array.from(editorRef.current.querySelectorAll('img')).reduce((total, image) => total + (image.getAttribute('src')?.length ?? 0), 0)
      const newCharacters = images.reduce((total, image) => total + image.length, 0)
      if (existingCharacters + newCharacters > MAX_INLINE_IMAGE_CHARACTERS) throw new Error('Tổng dung lượng ảnh quá lớn. Hãy chọn ảnh nhỏ hơn.')

      const fragment = document.createDocumentFragment()
      images.forEach((src) => {
        const block = document.createElement('div')
        const image = document.createElement('img')
        image.src = src
        image.alt = 'Ảnh trong ghi chú'
        block.append(image)
        fragment.append(block, document.createElement('br'))
      })
      if (insertionRange && editorRef.current.contains(insertionRange.commonAncestorContainer)) {
        insertionRange.deleteContents()
        insertionRange.insertNode(fragment)
      } else {
        editorRef.current.append(fragment)
      }
      editorRef.current.focus()
      setImageMessage(`Đã chèn ${images.length} ảnh vào nội dung.`)
    } catch (error) {
      setImageMessage(error instanceof Error ? error.message : 'Không thể chèn ảnh.')
    }
  }

  const insertImages = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    await addImagesToEditor(files)
  }

  const handleImageDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    dragDepthRef.current += 1
    setIsDraggingImage(true)
  }

  const handleImageDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleImageDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsDraggingImage(false)
  }

  const handleImageDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragDepthRef.current = 0
    setIsDraggingImage(false)

    const files = Array.from(event.dataTransfer.files)
    const imageFiles = files.filter((file) => file.type.startsWith('image/'))
    if (!imageFiles.length) {
      setImageMessage('Chỉ có thể kéo và thả tệp hình ảnh vào nội dung.')
      return
    }

    const dropDocument = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
    const insertionRange = dropDocument.caretRangeFromPoint?.(event.clientX, event.clientY) ?? null
    await addImagesToEditor(imageFiles, insertionRange)
  }

  const deleteNote = (id: string) => {
    setNotes((current) => current.filter((note) => note.id !== id))
    if (editingId === id) resetEditor()
    setPendingDeleteId(null)
    setMessage('Đã xoá ghi chú.')
  }

  const sendNoteToGmail = async (note: PatientNote) => {
    if (sendingId) return
    setSendingId(note.id)
    setEmailErrors((current) => ({ ...current, [note.id]: '' }))

    try {
      const response = await fetch('/api/send-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteId: note.id,
          patientName: note.patientName,
          content: note.content,
          contentHtml: note.contentHtml || plainTextToNoteHtml(note.content),
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
        }),
      })
      const result = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) throw new Error(result?.message || 'Không thể gửi email lúc này.')

      const emailedAt = new Date().toISOString()
      setNotes((current) => current.map((item) => item.id === note.id ? { ...item, emailedAt } : item))
      setLastSavedId((current) => current === note.id ? null : current)
      setMessage(`Đã gửi ghi chú về your configured email.`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Không thể gửi email lúc này.'
      setEmailErrors((current) => ({ ...current, [note.id]: errorMessage }))
    } finally {
      setSendingId(null)
    }
  }

  const lastSavedNote = notes.find((note) => note.id === lastSavedId && !note.emailedAt)

  return (
    <div className="notes-page">
      <div className="page-heading notes-heading">
        <div><span className="section-kicker">Sổ ghi chú</span><h2>Ghi chú bệnh nhân</h2></div>
        <span>{notes.length} ghi chú</span>
      </div>

      <section className="note-editor-card">
        <div className="note-editor-title">
          <span className="note-editor-icon"><NotebookPen size={20} /></span>
          <div><h3>{editingId ? 'Sửa ghi chú' : 'Tạo ghi chú mới'}</h3></div>
        </div>

        <form className="note-form" onSubmit={saveNote}>
          <label>
            <span>Tên bệnh nhân</span>
            <div className="note-field"><UserRound size={18} /><input value={patientName} onChange={(event) => setPatientName(event.target.value)} placeholder="Nhập tên bệnh nhân" autoComplete="off" /></div>
          </label>
          <div className="note-content-field">
            <span id="note-content-label">Nội dung ghi chú</span>
            <div className={`rich-note-wrap${isDraggingImage ? ' dragging' : ''}`} onDragEnter={handleImageDragEnter} onDragOver={handleImageDragOver} onDragLeave={handleImageDragLeave} onDrop={handleImageDrop}>
              <div className="rich-note-toolbar"><FileText size={17} /><span>Nhập nội dung hoặc kéo ảnh thả trực tiếp vào bên dưới</span><button type="button" onClick={() => imageInputRef.current?.click()}><ImagePlus size={16} />Chèn ảnh</button></div>
              <div ref={editorRef} className="rich-note-editor" contentEditable role="textbox" aria-multiline="true" aria-labelledby="note-content-label" data-placeholder="Triệu chứng, chẩn đoán, điều trị, lịch hẹn..." suppressContentEditableWarning />
              {isDraggingImage && <div className="drop-image-indicator"><ImagePlus size={24} /><strong>Thả ảnh vào nội dung ghi chú</strong></div>}
            </div>
            {imageMessage && <small className="image-message">{imageMessage}</small>}
            <input ref={imageInputRef} className="note-image-input" type="file" accept="image/*" multiple onChange={insertImages} tabIndex={-1} aria-hidden="true" />
          </div>
          <div className="note-form-footer">
            <p className={message.includes('Vui lòng') ? 'note-message error' : 'note-message'} aria-live="polite">{message}</p>
            <div className="note-form-actions">
              {editingId && <button className="secondary-button" type="button" onClick={resetEditor}>Huỷ sửa</button>}
              <button className="primary-button" type="submit">{editingId ? <Save size={17} /> : <Plus size={17} />}{editingId ? 'Lưu thay đổi' : 'Lưu ghi chú'}</button>
            </div>
          </div>
        </form>
      </section>

      {lastSavedNote && (
        <section className="email-ready-banner" aria-live="polite">
          <span><Mail size={19} /></span>
          <div><strong>Ghi chú đã được lưu</strong><p>Bạn có muốn gửi ghi chú này về your configured email?</p></div>
          <button type="button" disabled={sendingId === lastSavedNote.id} onClick={() => sendNoteToGmail(lastSavedNote)}><Send size={16} />{sendingId === lastSavedNote.id ? 'Đang gửi...' : 'Gửi Gmail'}</button>
        </section>
      )}

      <section className="saved-notes-section">
        <div className="saved-notes-toolbar">
          <div><h3>Ghi chú đã lưu</h3><p>Có thể tìm theo tên bệnh nhân hoặc nội dung.</p></div>
          <div className="note-search"><Search size={17} /><input value={noteQuery} onChange={(event) => setNoteQuery(event.target.value)} placeholder="Tìm ghi chú..." aria-label="Tìm ghi chú" />{noteQuery && <button type="button" onClick={() => setNoteQuery('')} aria-label="Xoá tìm kiếm"><X size={15} /></button>}</div>
        </div>

        {visibleNotes.length === 0 ? (
          <div className="empty-notes"><NotebookPen size={28} /><h3>{notes.length ? 'Không tìm thấy ghi chú' : 'Chưa có ghi chú nào'}</h3><p>{notes.length ? 'Thử một từ khoá khác.' : 'Ghi chú mới sau khi lưu sẽ xuất hiện tại đây.'}</p></div>
        ) : (
          <div className="saved-notes-list">
            {visibleNotes.map((note) => (
              <article className="saved-note-card" key={note.id}>
                <header><div className="saved-note-person"><span><UserRound size={17} /></span><div><h3>{note.patientName}</h3><time dateTime={note.updatedAt}>{note.updatedAt === note.createdAt ? 'Tạo' : 'Cập nhật'} {formatNoteTime(note.updatedAt)}</time></div></div><div className="saved-note-actions"><button type="button" onClick={() => editNote(note)} aria-label={`Sửa ghi chú của ${note.patientName}`}><Pencil size={16} /></button><button className="delete-note-button" type="button" onClick={() => setPendingDeleteId(note.id)} aria-label={`Xoá ghi chú của ${note.patientName}`}><Trash2 size={16} /></button></div></header>
                <div className="saved-note-content" dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(note.contentHtml || plainTextToNoteHtml(note.content)) }} />
                <div className="note-email-row">
                  {note.emailedAt ? (
                    <span className="email-sent-status"><Mail size={15} />Đã gửi Gmail · {formatNoteTime(note.emailedAt)}</span>
                  ) : (
                    <button className="send-note-button" type="button" disabled={sendingId === note.id} onClick={() => sendNoteToGmail(note)}><Send size={15} />{sendingId === note.id ? 'Đang gửi...' : emailErrors[note.id] ? 'Thử gửi lại' : 'Gửi về Gmail'}</button>
                  )}
                  {emailErrors[note.id] && <span className="email-error" role="alert">{emailErrors[note.id]}</span>}
                </div>
                {pendingDeleteId === note.id && <div className="delete-confirm" role="alert"><span>Xoá ghi chú này?</span><button type="button" onClick={() => setPendingDeleteId(null)}>Không</button><button className="confirm-delete" type="button" onClick={() => deleteNote(note.id)}>Xoá</button></div>}
              </article>
            ))}
          </div>
        )}
      </section>

      {storageError && <p className="notes-storage-note storage-error" role="alert">{storageError}</p>}
      <p className="notes-storage-note">Ghi chú và ảnh mặc định lưu trong trình duyệt hiện tại. Chỉ khi bấm “Gửi về Gmail”, một bản sao mới được gửi đến your configured email.</p>
    </div>
  )
}

export default App
