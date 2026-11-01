<script setup>
import { onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

// 3D call-volume view: each call is a rectangular mark, tiled in a mosaic.
//   X = time (left→right), Z = call center (one lane per center)
// Day boundaries are striped along X; call-center lanes carry large floating
// labels; hovering highlights a cell and shows a tooltip; clicking emits `select`.
//
// data: rows of { time, call_center_id, call_center, calls, answered, abandoned }

const props = defineProps({
  data: { type: Array, default: () => [] },
  colors: { type: Object, default: null },
  height: { type: Number, default: 520 },
})
const emit = defineEmits(['select'])

const el = ref(null)
const tooltipEl = ref(null)

let renderer, scene, camera, controls, group, mesh, base, highlight
let raycaster, pointer
let raf = 0
let instanceCell = [] // instanceId -> cell object
let hoverKey = null

const X_SPACING = 2.0
const Z_SPACING = 12.0
const CUBE = 1.0
const CUBE_H = 0.4
const PALETTE = ['#2563eb', '#16a34a', '#dc2626', '#f59e0b', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#0d9488', '#a855f7', '#14b8a6']
const STRIPE_A = 0xffffff
const STRIPE_B = 0xe7ebf0

const tooltip = ref({ visible: false, x: 0, y: 0, title: '', lines: [] })

function dayOf(iso) { return iso.slice(0, 10) }

function shortDate(iso) {
  const m = iso.match(/^\d{4}-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}` : iso
}

function hourLabel(iso) {
  const m = iso.match(/T(\d{2}):00:00Z$/)
  return m ? `${m[1]}:00` : iso.slice(11, 16)
}

function makeLabel(text, opts = {}) {
  const w = opts.w ?? 512
  const h = opts.h ?? 128
  const fs = opts.fontSize ?? 64
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')

  if (opts.pill) {
    ctx.fillStyle = 'rgba(255,255,255,0.88)'
    const r = h * 0.3
    if (ctx.roundRect) {
      ctx.beginPath()
      ctx.roundRect(4, 4, w - 8, h - 8, r)
      ctx.fill()
    } else {
      ctx.fillRect(4, 4, w - 8, h - 8)
    }
  }
  ctx.fillStyle = opts.color ?? '#111827'
  ctx.font = `700 ${fs}px system-ui, sans-serif`
  ctx.textAlign = opts.align ?? 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, w / 2, h / 2)

  const tex = new THREE.CanvasTexture(canvas)
  tex.minFilter = THREE.LinearFilter
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false })
  const spr = new THREE.Sprite(mat)
  const aspect = w / h
  const worldH = opts.worldH ?? 2.4
  spr.scale.set(worldH * aspect, worldH, 1)
  return spr
}

function buildScene() {
  const rect = el.value.getBoundingClientRect()
  const w = rect.width || 800
  const h = props.height

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setSize(w, h)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  el.value.appendChild(renderer.domElement)

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf3f5f8)

  camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 4000)
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true

  scene.add(new THREE.AmbientLight(0xffffff, 0.95))
  const dir = new THREE.DirectionalLight(0xffffff, 1.1)
  dir.position.set(120, 200, 160)
  scene.add(dir)

  group = new THREE.Group()
  scene.add(group)

  // Highlight box (hidden until hover) — light orange, taller than the column.
  highlight = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.22, depthWrite: false }),
  )
  highlight.visible = false
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(highlight.geometry),
    new THREE.LineBasicMaterial({ color: 0xffa033, transparent: true, opacity: 0.9 }),
  )
  highlight.add(edges)
  scene.add(highlight)

  raycaster = new THREE.Raycaster()
  pointer = new THREE.Vector2()

  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('pointerleave', onPointerLeave)
  renderer.domElement.addEventListener('click', onClick)
}

function buildCells(times, centers, timeIdx, centerIdx) {
  const cols = Math.max(1, Math.floor(X_SPACING / CUBE))
  const rows = Math.max(1, Math.floor(Z_SPACING / CUBE))
  const perLayer = cols * rows
  const cells = []
  const cellByKey = new Map()

  for (const row of props.data) {
    const ti = timeIdx.get(row.time)
    const ci = centerIdx.get(row.call_center_id)
    const layers = Math.ceil(row.calls / perLayer)
    const cell = {
      key: `${ti}:${ci}`,
      timeIso: row.time,
      centerId: row.call_center_id,
      centerName: row.call_center,
      calls: row.calls,
      answered: row.answered,
      abandoned: row.abandoned,
      x0: ti * X_SPACING,
      z0: ci * Z_SPACING,
      width: X_SPACING,
      depth: Z_SPACING,
      height: layers * CUBE_H,
    }
    cells.push(cell)
    cellByKey.set(cell.key, cell)
  }
  return { cols, rows, perLayer, cellByKey }
}

function draw() {
  if (!group) return
  while (group.children.length) group.remove(group.children[0])
  if (mesh) { mesh.geometry.dispose(); mesh.material.dispose() }
  if (base) { scene.remove(base); base.geometry.dispose() }

  const times = [...new Set(props.data.map((d) => d.time))].sort()
  const centerMap = new Map()
  props.data.forEach((d) => centerMap.set(d.call_center_id, d.call_center))
  const centers = [...centerMap.entries()].sort((a, b) => a[0] - b[0])
  const timeIdx = new Map(times.map((t, i) => [t, i]))
  const centerIdx = new Map(centers.map(([id], i) => [id, i]))

  if (!times.length) return

  const { cols, rows, perLayer, cellByKey } = buildCells(times, centers, timeIdx, centerIdx)

  // Instances.
  const instances = []
  instanceCell = []
  for (const row of props.data) {
    const ti = timeIdx.get(row.time)
    const ci = centerIdx.get(row.call_center_id)
    const x0 = ti * X_SPACING
    const z0 = ci * Z_SPACING
    const cell = cellByKey.get(`${ti}:${ci}`)
    for (let k = 0; k < row.calls; k++) {
      const layer = Math.floor(k / perLayer)
      const idx = k % perLayer
      const col = idx % cols
      const r = Math.floor(idx / cols)
      instances.push({ x: x0 + col * CUBE + CUBE / 2, y: layer, z: z0 + r * CUBE + CUBE / 2, cid: row.call_center_id, cell })
    }
  }

  if (instances.length) {
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff })
    mesh = new THREE.InstancedMesh(geo, mat, instances.length)
    const dummy = new THREE.Object3D()
    const color = new THREE.Color()
    instances.forEach((inst, i) => {
      dummy.position.set(inst.x, inst.y * CUBE_H + CUBE_H / 2, inst.z)
      dummy.scale.set(CUBE, CUBE_H, CUBE)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      const hex = (props.colors && props.colors[inst.cid]) || PALETTE[centerIdx.get(inst.cid) % PALETTE.length]
      color.set(hex)
      mesh.setColorAt(i, color)
      instanceCell[i] = inst.cell
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    group.add(mesh)
  }

  const width = times.length * X_SPACING
  const nz = centers.length * Z_SPACING

  // Base plane.
  base = new THREE.Mesh(
    new THREE.PlaneGeometry(width + 8, nz + 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
  )
  base.rotation.x = -Math.PI / 2
  base.position.set(width / 2, -0.52, nz / 2)
  base.renderOrder = -2
  scene.add(base)

  // Day striping along X: contiguous day ranges, alternating stripe colors.
  const dayRanges = []
  times.forEach((t, i) => {
    const day = dayOf(t)
    if (!dayRanges.length || dayRanges[dayRanges.length - 1].day !== day) {
      dayRanges.push({ day, start: i, end: i })
    } else {
      dayRanges[dayRanges.length - 1].end = i
    }
  })
  dayRanges.forEach((r, idx) => {
    const x0 = r.start * X_SPACING
    const x1 = (r.end + 1) * X_SPACING
    const stripe = new THREE.Mesh(
      new THREE.PlaneGeometry(x1 - x0, nz + 8),
      new THREE.MeshBasicMaterial({ color: idx % 2 === 0 ? STRIPE_A : STRIPE_B, side: THREE.DoubleSide }),
    )
    stripe.rotation.x = -Math.PI / 2
    stripe.position.set((x0 + x1) / 2, -0.51, nz / 2)
    stripe.renderOrder = -1
    scene.add(stripe)
  })

  // Floating call-center labels (large, camera-facing, at the left of each lane).
  centers.forEach(([id, name], i) => {
    const spr = makeLabel(name, { pill: true, w: 512, h: 96, fontSize: 44, worldH: 4.5 })
    spr.position.set(-3, CUBE_H * 1.5, i * Z_SPACING)
    group.add(spr)
  })

  // Day labels along the bottom X axis.
  const dayX = new Map()
  times.forEach((t, i) => {
    const day = shortDate(t)
    if (!dayX.has(day)) dayX.set(day, i)
  })
  dayX.forEach((x, day) => {
    const spr = makeLabel(day, { w: 256, h: 64, fontSize: 40, worldH: 3.2 })
    spr.position.set(x * X_SPACING, -3, nz + 3)
    group.add(spr)
  })

  // Camera fit.
  const maxLayer = instances.length ? Math.max(...instances.map((i) => i.y)) : 0
  const heightUnits = (maxLayer + 1) * CUBE_H
  controls.target.set(width / 2, heightUnits / 2, nz / 2)
  camera.position.set(width / 2 + width * 0.35, heightUnits * 1.4 + 10, nz / 2 + width * 0.7)
  camera.far = Math.max(4000, width * 12)
  camera.updateProjectionMatrix()
  controls.update()
}

function pickCell(event) {
  if (!mesh) return null
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  const hits = raycaster.intersectObject(mesh, false)
  if (!hits.length) return null
  const id = hits[0].instanceId
  return instanceCell[id] || null
}

function moveHighlight(cell) {
  if (!cell) { highlight.visible = false; return }
  highlight.visible = true
  const h = Math.max(cell.height, 0.3) * 3
  highlight.scale.set(cell.width, h, cell.depth)
  highlight.position.set(cell.x0 + cell.width / 2, h / 2, cell.z0 + cell.depth / 2)
}

function onPointerMove(event) {
  const cell = pickCell(event)
  if (cell) {
    hoverKey = cell.key
    moveHighlight(cell)
    const rect = el.value.getBoundingClientRect()
    tooltip.value = {
      visible: true,
      x: event.clientX - rect.left + 14,
      y: event.clientY - rect.top + 14,
      title: cell.centerName,
      lines: [
        `${shortDate(cell.timeIso)} ${hourLabel(cell.timeIso)} (UTC)`,
        `Calls: ${cell.calls} · answered ${cell.answered} · abandoned ${cell.abandoned}`,
        'Click for call details',
      ],
    }
  } else {
    hoverKey = null
    moveHighlight(null)
    tooltip.value = { ...tooltip.value, visible: false }
  }
}

function onPointerLeave() {
  hoverKey = null
  moveHighlight(null)
  tooltip.value = { ...tooltip.value, visible: false }
}

function onClick(event) {
  const cell = pickCell(event)
  if (cell) {
    emit('select', {
      centerId: cell.centerId,
      centerName: cell.centerName,
      timeIso: cell.timeIso,
      calls: cell.calls,
      answered: cell.answered,
      abandoned: cell.abandoned,
    })
  }
}

function animate() {
  raf = requestAnimationFrame(animate)
  controls.update()
  renderer.render(scene, camera)
}

function resize() {
  if (!renderer || !el.value) return
  const w = el.value.getBoundingClientRect().width || 800
  renderer.setSize(w, props.height)
  camera.aspect = w / props.height
  camera.updateProjectionMatrix()
}

onMounted(() => {
  buildScene()
  draw()
  animate()
  window.addEventListener('resize', resize)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('resize', resize)
  if (renderer) {
    renderer.domElement.removeEventListener('pointermove', onPointerMove)
    renderer.domElement.removeEventListener('pointerleave', onPointerLeave)
    renderer.domElement.removeEventListener('click', onClick)
    renderer.dispose()
    if (el.value?.contains(renderer.domElement)) el.value.removeChild(renderer.domElement)
  }
})

watch(() => [props.data, props.colors], () => nextTick(draw), { deep: true })
</script>

<template>
  <div class="three-volume">
    <div ref="el" class="mount"></div>
    <div
      v-show="tooltip.visible"
      ref="tooltipEl"
      class="tooltip"
      :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
    >
      <div class="tooltip-title">{{ tooltip.title }}</div>
      <div v-for="l in tooltip.lines" :key="l" class="tooltip-line">{{ l }}</div>
    </div>
  </div>
</template>

<style scoped>
.three-volume {
  position: relative;
  width: 100%;
}
.mount {
  width: 100%;
}
.mount :deep(canvas) {
  display: block;
}
.tooltip {
  position: absolute;
  pointer-events: none;
  background: rgba(17, 24, 39, 0.92);
  color: #fff;
  padding: 8px 11px;
  border-radius: 8px;
  font-size: 12.5px;
  line-height: 1.4;
  max-width: 260px;
  z-index: 10;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
}
.tooltip-title {
  font-weight: 700;
  margin-bottom: 2px;
}
.tooltip-line {
  opacity: 0.85;
}
</style>