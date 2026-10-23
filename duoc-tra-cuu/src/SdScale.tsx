import { formatSd } from './sd-format'

const ticks = [-2, -1, 0, 1, 2]

export function SdScale({ value, label }: { value: number; label: string }) {
  if (!Number.isFinite(value)) return null
  const position = (Math.max(-2, Math.min(2, value)) + 2) / 4 * 100
  return (
    <div className="sd-scale" role="img" aria-label={`${label}: ${formatSd(value)}. Thang từ −2 SD đến +2 SD; 0 ở giữa.`}>
      <div className="sd-track" aria-hidden="true">
        {ticks.map((tick) => (
          <span className={`sd-tick${tick === 0 ? ' sd-zero' : ''}`} key={tick} style={{ left: `${(tick + 2) / 4 * 100}%` }}>
            <span className="sd-tick-label">{tick > 0 ? '+' : tick < 0 ? '−' : ''}{Math.abs(tick)}</span>
          </span>
        ))}
        <span className={`sd-marker${value < -2 ? ' sd-below' : value > 2 ? ' sd-above' : ''}`} style={{ left: `${position}%` }} />
      </div>
    </div>
  )
}
