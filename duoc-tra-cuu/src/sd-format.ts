export function formatSd(value: number) {
  return `${value < -2 ? '← ' : ''}${value > 0 ? '+' : ''}${value.toFixed(2)} SD${value > 2 ? ' →' : ''}`
}
