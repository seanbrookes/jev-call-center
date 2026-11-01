<script setup>
import { onMounted, onBeforeUnmount, computed, ref } from 'vue'
import { useCallCenterStore } from '@/stores/callCenter'
import { api } from '@/lib/api'

const store = useCallCenterStore()
const simulating = ref(false)
const generated = ref(null)

const live = ref(null)
const livePoll = ref(null)
let lastHeartbeatAt = 0

const options = ref({ topics: [], moods: [], personas: [], products: [] })
const scenario = ref({ topic: '', mood: '', persona: '', product: '' })

const fmt = (n, digits = 0) =>
  n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: digits })

const label = (s) => s.toString().replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

// Only include dimensions the user actually selected (blank = random).
const cleanScenario = computed(() => {
  const s = {}
  for (const [k, v] of Object.entries(scenario.value)) {
    if (v !== '' && v !== null && v !== undefined) s[k] = v
  }
  return s
})

const stats = computed(() => [
  { label: 'Companies', value: fmt(store.companies.length) },
  { label: 'Call Centers', value: fmt(store.callCenters.length) },
  { label: 'Agents', value: fmt(store.agents.length) },
])

async function simulate(days = 1) {
  simulating.value = true
  generated.value = null
  try {
    const to = new Date()
    const from = new Date(to.getTime() - days * 24 * 3600 * 1000)
    const res = await api.simulate(from.toISOString(), to.toISOString(), cleanScenario.value)
    generated.value = res.generated
    await store.loadAll()
  } finally {
    simulating.value = false
  }
}

// --- Live simulation controls ---

async function startLive() {
  live.value = await api.liveStart(cleanScenario.value)
  beginPolling()
}

async function stopLive() {
  stopPolling()
  live.value = await api.liveStop()
}

// Heartbeat: only sent on actual user activity (throttled), so the server's
// idle kill switch counts "no user input" — not "page open".
function onActivity() {
  const now = Date.now()
  if (now - lastHeartbeatAt < 30000) return
  lastHeartbeatAt = now
  api.liveHeartbeat().catch(() => {})
}

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart']

function beginPolling() {
  stopPolling()
  livePoll.value = setInterval(async () => {
    live.value = await api.liveState()
    if (live.value && !live.value.running) stopPolling()
  }, 2000)
  ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity))
}

function stopPolling() {
  if (livePoll.value) clearInterval(livePoll.value)
  livePoll.value = null
  ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity))
}

onMounted(async () => {
  await store.loadAll()
  options.value = await api.scenarioOptions()
  live.value = await api.liveState()
  if (live.value?.running) beginPolling()
})

onBeforeUnmount(() => {
  stopPolling()
})
</script>

<template>
  <div class="grid">
    <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(160px, 1fr))">
      <div v-for="s in stats" :key="s.label" class="stat">
        <div class="label">{{ s.label }}</div>
        <div class="value">{{ s.value }}</div>
      </div>
    </div>

    <div class="panel">
      <h2>Scenario Configuration</h2>
      <p class="muted">
        Fix any dimension to shape the kinds of calls (and transcripts) generated.
        Leave a field on "Random" to let the simulator choose. Applies to both
        historical and live simulation.
      </p>
      <div style="display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))">
        <label>
          <span class="muted">Topic</span>
          <select v-model="scenario.topic" style="width: 100%">
            <option value="">Random</option>
            <option v-for="t in options.topics" :key="t" :value="t">{{ label(t) }}</option>
          </select>
        </label>
        <label>
          <span class="muted">Caller mood</span>
          <select v-model="scenario.mood" style="width: 100%">
            <option value="">Random</option>
            <option v-for="m in options.moods" :key="m.key" :value="m.key">{{ m.label }}</option>
          </select>
        </label>
        <label>
          <span class="muted">Agent persona</span>
          <select v-model="scenario.persona" style="width: 100%">
            <option value="">Random</option>
            <option v-for="p in options.personas" :key="p.key" :value="p.key">{{ p.label }}</option>
          </select>
        </label>
        <label>
          <span class="muted">Product</span>
          <select v-model="scenario.product" style="width: 100%">
            <option value="">Random</option>
            <option v-for="p in options.products" :key="p" :value="p">{{ p }}</option>
          </select>
        </label>
      </div>
    </div>

    <div class="panel">
      <h2>Historical Simulation</h2>
      <p class="muted">
        Backfill mock call traffic for all open call centers over a time window,
        honoring each center's timezone, operating hours, and volume. Writes raw
        call + agent-status records.
      </p>
      <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap">
        <button :disabled="simulating" @click="simulate(1)">
          {{ simulating ? 'Simulating…' : 'Simulate last 24h' }}
        </button>
        <button :disabled="simulating" @click="simulate(7)">Simulate last 7 days</button>
        <span v-if="generated != null" class="muted">
          Generated <strong>{{ generated }}</strong> calls.
        </span>
      </div>
    </div>

    <div class="panel">
      <div style="display: flex; justify-content: space-between; align-items: center">
        <h2>Live Simulation</h2>
        <span v-if="live?.running" class="badge answered">Running</span>
        <span v-else class="badge abandoned">Stopped</span>
      </div>
      <p class="muted">
        Runs on the server, generating live calls + agent-status events as long as
        it's running. Stops automatically 1 hour after the last user activity on
        this page (mouse/keyboard input keeps it alive).
      </p>
      <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap">
        <button v-if="!live?.running" @click="startLive">Start</button>
        <button v-else class="secondary" @click="stopLive">Stop</button>
        <span class="muted" v-if="live">
          calls: <strong>{{ live.calls }}</strong> · ticks: {{ live.ticks }}
        </span>
        <span class="muted" v-if="live?.reason === 'idle-timeout'">
          (stopped by idle timeout)
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
label span.muted {
  display: block;
  margin-bottom: 4px;
}
</style>