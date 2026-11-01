<script setup>
import { onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

// 3D bar visualizer: renders `data` (array of { label, value, color? }) as a
// row of bars. Useful for leaderboard-style comparisons in 3D.

const props = defineProps({
  data: { type: Array, default: () => [] },
  height: { type: Number, default: 300 },
})

const el = ref(null)

let renderer, scene, camera, controls, group
let raf = 0

function buildScene() {
  const rect = el.value.getBoundingClientRect()
  const w = rect.width || 600
  const h = props.height

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setSize(w, h)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  el.value.appendChild(renderer.domElement)

  scene = new THREE.Scene()
  scene.background = null

  camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100)
  camera.position.set(6, 6, 10)
  camera.lookAt(0, 0, 0)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true

  scene.add(new THREE.AmbientLight(0xffffff, 0.8))
  const dir = new THREE.DirectionalLight(0xffffff, 1.2)
  dir.position.set(5, 10, 5)
  scene.add(dir)

  group = new THREE.Group()
  scene.add(group)

  // Ground grid
  const grid = new THREE.GridHelper(12, 12, 0xcccccc, 0xe5e5e5)
  scene.add(grid)
}

function drawBars() {
  if (!group) return
  while (group.children.length) group.remove(group.children[0])

  const n = props.data.length
  if (!n) return
  const max = Math.max(...props.data.map((d) => d.value), 1)
  const spacing = 1.2
  const total = spacing * n

  props.data.forEach((d, i) => {
    const h = (d.value / max) * 6
    const geo = new THREE.BoxGeometry(0.8, h, 0.8)
    const mat = new THREE.MeshStandardMaterial({
      color: d.color || '#2563eb',
      roughness: 0.4,
      metalness: 0.1,
    })
    const bar = new THREE.Mesh(geo, mat)
    bar.position.set(i * spacing - total / 2 + spacing / 2, h / 2, 0)
    group.add(bar)

    // Value label (sprite)
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 64
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#111827'
    ctx.font = 'bold 28px system-ui'
    ctx.textAlign = 'center'
    ctx.fillText(String(d.value), 64, 40)
    const tex = new THREE.CanvasTexture(canvas)
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }))
    sprite.position.set(bar.position.x, h + 0.5, 0)
    sprite.scale.set(1.6, 0.8, 1)
    group.add(sprite)
  })

  camera.position.set(6, 6, 6 + total / 2)
  controls.target.set(0, 1.5, 0)
  controls.update()
}

function animate() {
  raf = requestAnimationFrame(animate)
  controls.update()
  renderer.render(scene, camera)
}

function resize() {
  if (!renderer || !el.value) return
  const w = el.value.getBoundingClientRect().width || 600
  renderer.setSize(w, props.height)
  camera.aspect = w / props.height
  camera.updateProjectionMatrix()
}

onMounted(() => {
  buildScene()
  drawBars()
  animate()
  window.addEventListener('resize', resize)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('resize', resize)
  if (renderer) {
    renderer.dispose()
    if (el.value.contains(renderer.domElement)) el.value.removeChild(renderer.domElement)
  }
})

watch(
  () => props.data,
  () => nextTick(drawBars),
  { deep: true },
)
</script>

<template>
  <div ref="el" class="three-bars"></div>
</template>

<style scoped>
.three-bars {
  width: 100%;
}
.three-bars :deep(canvas) {
  display: block;
}
</style>