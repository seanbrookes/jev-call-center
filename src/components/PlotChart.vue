<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import * as Plot from '@observablehq/plot'

// Generic Observable Plot chart component.
//
// Props:
//   type     : 'line' | 'bar' | 'leaderboard' | 'donut'
//   data     : array of records (see each builder below for expected shape)
//   x / y    : accessors (field names or functions) for the data channels
//   color    : optional static CSS color (fill/stroke) for marks
//   options  : extra PLOT-LEVEL options (scales, margins, height, style, ...)
//              — merged into Plot.plot(), NOT into the marks. Use `x`/`y`
//              scale configs here (e.g. { y: { label: 'calls' } }), never
//              as data accessors.
//
// Emits nothing; purely presentational. Callers reshape data upstream.

const props = defineProps({
  type: { type: String, default: 'line' },
  data: { type: Array, default: () => [] },
  x: { default: 'x' },
  y: { default: 'y' },
  color: { type: String, default: null },
  options: { type: Object, default: () => ({}) },
  height: { type: Number, default: 240 },
})

const el = ref(null)

const field = (accessor) => (typeof accessor === 'function' ? accessor : (d) => d[accessor])

function build() {
  const { data, options, height } = props
  if (!data.length) return null

  const x = field(props.x)
  const y = field(props.y)
  const color = props.color

  switch (props.type) {
    case 'line': {
      const marks = [
        Plot.lineY(data, { x, y, stroke: color }),
        Plot.dot(data, { x, y, fill: color }),
      ]
      return Plot.plot({ height, marks, ...options })
    }

    case 'bar': {
      const marks = [Plot.rectY(data, { x, y, fill: color ?? 'var(--accent)' })]
      return Plot.plot({
        height,
        marginLeft: 40,
        x: { padding: 0.2 },
        marks,
        ...options,
      })
    }

    case 'leaderboard': {
      // Expects data already sorted descending by `y`.
      const marks = [Plot.barX(data, { y: x, x: y, fill: color ?? 'var(--accent)' })]
      return Plot.plot({
        height: Math.max(height, data.length * 28),
        marginLeft: 120,
        marginRight: 40,
        x: { grid: true },
        marks,
        ...options,
      })
    }

    case 'donut': {
      return donutSvg(data.map((d) => ({ key: x(d), value: y(d) })), height)
    }

    default:
      return null
  }
}

// Observable Plot has no native pie/donut mark, so draw one with plain SVG.
const DONUT_COLORS = [
  '#2563eb', '#16a34a', '#dc2626', '#f59e0b', '#7c3aed', '#0891b2',
  '#db2777', '#65a30d', '#ea580c', '#0d9488',
]

function donutSvg(entries, height) {
  const total = entries.reduce((s, d) => s + d.value, 0) || 1
  const size = Math.min(height, 260)
  const thickness = size * 0.28
  const r = size / 2 - thickness / 2 - 4
  const cx = size / 2
  const cy = size / 2

  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('width', size)
  svg.setAttribute('height', size)
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`)

  let angle = -Math.PI / 2
  entries.forEach((d, i) => {
    const frac = d.value / total
    const a0 = angle
    const a1 = angle + frac * Math.PI * 2
    const large = a1 - a0 > Math.PI ? 1 : 0
    const x0 = cx + r * Math.cos(a0)
    const y0 = cy + r * Math.sin(a0)
    const x1 = cx + r * Math.cos(a1)
    const y1 = cy + r * Math.sin(a1)

    const path = document.createElementNS(ns, 'path')
    path.setAttribute(
      'd',
      `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}` +
        ` L ${cx + (r - thickness) * Math.cos(a1)} ${cy + (r - thickness) * Math.sin(a1)}` +
        ` A ${r - thickness} ${r - thickness} 0 ${large} 0 ${cx + (r - thickness) * Math.cos(a0)} ${cy + (r - thickness) * Math.sin(a0)} Z`,
    )
    path.setAttribute('fill', DONUT_COLORS[i % DONUT_COLORS.length])
    path.setAttribute('stroke', '#fff')
    path.setAttribute('stroke-width', '1')
    svg.appendChild(path)
    angle = a1
  })

  const text = document.createElementNS(ns, 'text')
  text.setAttribute('x', cx)
  text.setAttribute('y', cy)
  text.setAttribute('text-anchor', 'middle')
  text.setAttribute('dominant-baseline', 'middle')
  text.setAttribute('font-size', '20')
  text.setAttribute('font-weight', 'bold')
  text.textContent = String(total)
  svg.appendChild(text)

  const wrap = document.createElement('div')
  wrap.style.display = 'flex'
  wrap.style.gap = '16px'
  wrap.style.alignItems = 'center'
  wrap.style.flexWrap = 'wrap'
  wrap.appendChild(svg)

  const list = document.createElement('ul')
  list.style.listStyle = 'none'
  list.style.margin = '0'
  list.style.padding = '0'
  list.style.fontSize = '13px'
  entries.forEach((d, i) => {
    const li = document.createElement('li')
    li.style.display = 'flex'
    li.style.alignItems = 'center'
    li.style.gap = '6px'
    li.style.marginBottom = '4px'
    const swatch = document.createElement('span')
    swatch.style.width = '10px'
    swatch.style.height = '10px'
    swatch.style.borderRadius = '2px'
    swatch.style.background = DONUT_COLORS[i % DONUT_COLORS.length]
    swatch.style.display = 'inline-block'
    li.appendChild(swatch)
    const label = document.createElement('span')
    label.textContent = `${d.key} (${d.value})`
    li.appendChild(label)
    list.appendChild(li)
  })
  wrap.appendChild(list)

  return wrap
}

function render() {
  const next = build()
  if (!el.value) return
  if (!next) {
    el.value.innerHTML = ''
    return
  }
  if (el.value.firstChild) {
    el.value.removeChild(el.value.firstChild)
  }
  el.value.appendChild(next)
}

onMounted(render)
watch(() => [props.data, props.type, props.options, props.height], render, { deep: true })
onBeforeUnmount(() => {
  if (el.value?.firstChild) el.value.removeChild(el.value.firstChild)
})
</script>

<template>
  <div ref="el" class="plot-chart"></div>
</template>

<style scoped>
.plot-chart :deep(svg) {
  max-width: 100%;
  display: block;
}
</style>