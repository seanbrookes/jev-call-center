// Timezone + time helpers. Node's Intl handles conversions between the IANA
// zone a company/call center declares and UTC, which is how we decide whether
// a call center is "open" right now and how the simulator drives volume.

export function toIsoUtc(date) {
  return date.toISOString()
}

// Format `date` as wall-clock parts in the given IANA zone.
function partsInZone(zone, date = new Date()) {
  return Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
}

// Current wall-clock time (minutes since midnight) in a given IANA zone.
export function minutesInZone(zone, date = new Date()) {
  const parts = partsInZone(zone, date)
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]))
  return Number(map.hour) * 60 + Number(map.minute)
}

// UTC offset (positive = east of UTC) in minutes for a zone at `date`.
export function utcOffsetMinutes(zone, date = new Date()) {
  const parts = partsInZone(zone, date)
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]))
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  )
  return Math.round((asUtc - date.getTime()) / 60000)
}

// Local wall-clock time as an ISO-like string WITHOUT a trailing offset, so
// the caller's local time is preserved losslessly alongside the UTC timestamp.
// Format: YYYY-MM-DDTHH:mm:ss (no Z, no +/-offset).
export function localIsoString(zone, date = new Date()) {
  const parts = partsInZone(zone, date)
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]))
  return [
    map.year,
    `-${map.month}`,
    `-${map.day}`,
    `T${map.hour}`,
    `:${map.minute}`,
    `:${map.second}`,
  ].join('')
}

// ISO weekday (1=Mon..7=Sun) in a given IANA zone.
export function weekdayInZone(zone, date = new Date()) {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
  }).format(date)
  return { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[day]
}

export function isOpen(center, date = new Date()) {
  const days = center.days_of_week.split(',').map(Number)
  if (!days.includes(weekdayInZone(center.timezone, date))) return false
  const now = minutesInZone(center.timezone, date)
  return now >= center.open_time && now < center.close_time
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// Gaussian-ish random with a mean of 0 and standard deviation of 1
// (sum of uniforms is good enough for this purpose).
export function gaussian() {
  let s = 0
  for (let i = 0; i < 6; i++) s += Math.random()
  return s - 3
}

export function randomInt(lo, hi) {
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

// Seconds between `a` and `b` (dates), clamped to >= 0.
export function secondsBetween(a, b) {
  return Math.max(0, Math.round((b - a) / 1000))
}

export { clamp }