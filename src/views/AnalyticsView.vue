<script setup>
import { onMounted, ref, reactive, computed, watch } from 'vue'
import { api } from '@/lib/api'
import PlotChart from '@/components/PlotChart.vue'
import ThreeBars from '@/components/ThreeBars.vue'
import ThreeDCallVolume from '@/components/ThreeDCallVolume.vue'

const PALETTE = ['#2563eb', '#16a34a', '#dc2626', '#f59e0b', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#0d9488', '#a855f7', '#14b8a6']

const label = (s) => (s == null ? '' : String(s).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))

const leaderboard = ref([])
const timeseries = ref([])
const topics = ref([])
const outcomes = ref([])
const occupancy = ref([])
const centerId = ref(null)
const loading = ref(false)

const volumeGrid = ref({ rows: [] })
const volumeDays = ref(7)
const volumeBucket = ref('hour')
const volumeLoading = ref(false)

const centers = ref([])
const selectedCenters = ref([])

const volumeRows = computed(() => volumeGrid.value.rows || [])

// Stable color per call center (indexed by sorted id), shared by the 3D view
// and the legend so filtering never changes a center's color.
const centerMeta = computed(() =>
  [...centers.value]
    .sort((a, b) => a.id - b.id)
    .map((c, i) => ({ id: c.id, name: c.name, color: PALETTE[i % PALETTE.length] })),
)
const centerColorById = computed(() =>
  Object.fromEntries(centerMeta.value.map((c) => [c.id, c.color])),
)
const visibleCenters = computed(() =>
  centerMeta.value.filter((c) => selectedCenters.value.includes(c.id)),
)
const filteredVolumeRows = computed(() =>
  volumeRows.value.filter((r) => selectedCenters.value.includes(r.call_center_id)),
)

function toggleAll(checked) {
  selectedCenters.value = checked ? centers.value.map((c) => c.id) : []
}

const selection = ref(null)
const selectedCalls = ref([])
const selectionBusy = ref(false)

async function onSelectCell(payload) {
  selection.value = payload
  selectionBusy.value = true
  selectedCalls.value = []
  try {
    const from = new Date(payload.timeIso)
    const durationMs = (volumeBucket.value === 'day' ? 86400 : 3600) * 1000
    const to = new Date(from.getTime() + durationMs)
    selectedCalls.value = await api.calls(payload.centerId, 500, from.toISOString(), to.toISOString())
    await classifyCalls(selectedCalls.value)
  } catch (err) {
    console.error(err)
  } finally {
    selectionBusy.value = false
  }
}

function fmtDuration(s) {
  if (s == null || Number.isNaN(s)) return '—'
  const total = Math.floor(Number(s))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

const transcript = ref(null) // call record being viewed
const transcriptTurns = ref([])
const transcriptLoading = ref(false)

async function openTranscript(call) {
  transcript.value = call
  transcriptTurns.value = []
  transcriptLoading.value = true
  try {
    const res = await api.transcript(call.id)
    transcriptTurns.value = res.turns
  } catch (err) {
    console.error(err)
  } finally {
    transcriptLoading.value = false
  }
}

function closeTranscript() {
  transcript.value = null
  transcriptTurns.value = []
}

// --- JEV classification of selected calls (helpfulness / satisfaction / defect)
const JEV_PACK = 'agent-quality'
const jevCache = new Map() // call_id -> raw answers (non-reactive)
const jevResults = ref({}) // call_id -> column-ready values
const classifying = ref(false)
const jevError = ref('')

const filterDefect = ref('all') // all | yes | no
const filterSatisfaction = ref('all') // all | high | low
const filterHelpfulness = ref('all') // all | high | low
const sortKey = ref('id')
const sortDir = ref('asc')
const columnPickerOpen = ref(false)

function levelLabel(scoreAnswer) {
  if (!scoreAnswer?.probabilities || !scoreAnswer?.legend) return ''
  let best = null
  let bestP = -1
  for (const [lv, p] of Object.entries(scoreAnswer.probabilities)) {
    if (p > bestP) { bestP = p; best = lv }
  }
  return scoreAnswer.legend[best] ?? ''
}

function transformJev(answers) {
  const h = answers?.helpfulness
  const s = answers?.satisfaction
  const d = answers?.defect
  return {
    helpfulness: h ? { score: Number(h.score), label: levelLabel(h), high: h.score >= 1.5 } : null,
    satisfaction: s ? { score: Number(s.score), label: levelLabel(s), high: s.score >= 2.5 } : null,
    defect: d ? { value: d.noul, isDefect: d.noul > 0.5 } : null,
  }
}

async function classifyCalls(calls) {
  jevError.value = ''
  if (!calls.length) { jevResults.value = {}; return }

  const missing = calls.map((c) => c.id).filter((id) => !jevCache.has(id))
  if (missing.length) {
    classifying.value = true
    try {
      const res = await api.jevAnalyze(missing, JEV_PACK)
      res.results.forEach((r) => jevCache.set(r.call_id, r.answers))
    } catch (err) {
      jevError.value = err.message
    } finally {
      classifying.value = false
    }
  }

  const map = {}
  calls.forEach((c) => {
    const a = jevCache.get(c.id)
    if (a) map[c.id] = transformJev(a)
  })
  jevResults.value = map
}

// --- Column model (built-in + custom JEV questions, session-only) ----------
const baseColumns = [
  { key: 'id', label: 'ID', getValue: (r) => r.call.id, getText: (r) => String(r.call.id), getBadge: () => null },
  { key: 'outcome', label: 'Outcome', getValue: (r) => r.call.outcome, getText: (r) => r.call.outcome, getBadge: (r) => r.call.outcome },
  {
    key: 'helpfulness', label: 'Helpfulness', getValue: (r) => r.j?.helpfulness?.score ?? -1,
    getText: (r) => (r.j?.helpfulness ? `${r.j.helpfulness.score.toFixed(1)} ${r.j.helpfulness.label}` : '—'), getBadge: () => null,
  },
  {
    key: 'satisfaction', label: 'Satisfaction', getValue: (r) => r.j?.satisfaction?.score ?? -1,
    getText: (r) => satisfactionBadge(r.j).text, getBadge: (r) => satisfactionBadge(r.j).cls,
  },
  {
    key: 'defect', label: 'Defect', getValue: (r) => r.j?.defect?.value ?? -1,
    getText: (r) => (r.j?.defect ? `${r.j.defect.isDefect ? 'Yes' : 'No'} (${Math.round(r.j.defect.value * 100)}%)` : '—'),
    getBadge: (r) => (r.j?.defect ? (r.j.defect.isDefect ? 'abandoned' : 'answered') : 'muted'),
  },
  { key: 'wait', label: 'Wait', getValue: (r) => r.call.wait_seconds ?? -1, getText: (r) => fmtDuration(r.call.wait_seconds), getBadge: () => null },
  { key: 'talk', label: 'Talk', getValue: (r) => r.call.talk_seconds ?? -1, getText: (r) => fmtDuration(r.call.talk_seconds), getBadge: () => null },
  { key: 'started', label: 'Started', getValue: (r) => r.call.started_at, getText: (r) => new Date(r.call.started_at).toLocaleString(), getBadge: () => null },
]

const visibleColumns = reactive(Object.fromEntries(baseColumns.map((c) => [c.key, true])))
const customQuestions = ref([]) // { id, label, type, instructions, threshold, payload }
const customResults = reactive({}) // call_id -> { questionId: displayObj }

const customColumns = computed(() =>
  customQuestions.value.map((q) => ({
    key: q.id,
    label: q.label,
    custom: true,
    question: q,
    getValue: (r) => customValue(q, r),
    getText: (r) => customText(q, r),
    getBadge: (r) => customBadge(q, r),
  })),
)

const allColumns = computed(() => [...baseColumns, ...customColumns.value])
const visibleColumnList = computed(() => allColumns.value.filter((c) => visibleColumns[c.key]))

function transformCustom(q, answer) {
  if (!answer) return null
  if (q.type === 'noul') {
    const yes = answer.noul >= (q.threshold ?? 0.5)
    return { value: answer.noul, label: yes ? 'Yes' : 'No', high: yes, pct: Math.round(answer.noul * 100) }
  }
  if (q.type === 'score') {
    const high = q.threshold == null ? null : answer.score >= q.threshold
    return { value: answer.score, label: levelLabel(answer), high, pct: null }
  }
  if (q.type === 'choice') {
    return { value: answer.choice, label: answer.choice, high: null, pct: null }
  }
  return null
}

function customEntry(q, r) {
  return r.custom?.[q.id] || null
}
function customValue(q, r) {
  const e = customEntry(q, r)
  if (!e) return q.type === 'choice' ? '' : -1
  return e.value
}
function customText(q, r) {
  const e = customEntry(q, r)
  if (!e) return '—'
  if (q.type === 'noul') return `${e.label} (${e.pct}%)`
  if (q.type === 'score') return `${e.value.toFixed(1)} ${e.label}`
  return e.label
}
function customBadge(q, r) {
  const e = customEntry(q, r)
  if (!e) return 'muted'
  if (q.type === 'noul') return e.high ? 'answered' : 'abandoned'
  if (q.type === 'score') return e.high == null ? null : e.high ? 'answered' : 'abandoned'
  return 'voicemail'
}

async function runCustom(q) {
  const ids = selectedCalls.value.map((c) => c.id)
  if (!ids.length) return
  classifying.value = true
  try {
    const res = await api.jevAnalyzeWithQuestions(ids, { [q.id]: q.payload })
    res.results.forEach((r) => {
      const ans = r.answers?.[q.id]
      if (!ans) return
      customResults[r.call_id] = { ...customResults[r.call_id], [q.id]: transformCustom(q, ans) }
    })
  } catch (err) {
    jevError.value = err.message
  } finally {
    classifying.value = false
  }
}

const editorOpen = ref(false)
const editingId = ref(null) // null = new, else the question id being edited
const editorDraft = ref({ name: '', type: 'noul', instructions: '', threshold: 0.5, criteria: '' })

function openEditor() {
  editingId.value = null
  editorDraft.value = { name: '', type: 'noul', instructions: '', threshold: 0.5, criteria: '' }
  editorOpen.value = true
}

function criteriaToText(q) {
  if (q.type === 'score' && Array.isArray(q.payload.criteria)) return q.payload.criteria.join('\n')
  if (q.type === 'choice' && q.payload.criteria) {
    return Object.entries(q.payload.criteria).map(([k, v]) => `${k}: ${v}`).join('\n')
  }
  return ''
}

function editQuestion(q) {
  editingId.value = q.id
  editorDraft.value = {
    name: q.label,
    type: q.type,
    instructions: q.instructions,
    threshold: q.threshold ?? 0.5,
    criteria: criteriaToText(q),
  }
  editorOpen.value = true
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

async function saveQuestion() {
  const d = editorDraft.value
  const id = slug(d.name)
  if (!id || !d.instructions.trim()) return

  const payload = { type: d.type, instructions: d.instructions.trim() }
  if (d.type === 'score') {
    const levels = d.criteria.split('\n').map((s) => s.trim()).filter(Boolean)
    if (levels.length) payload.criteria = levels
  } else if (d.type === 'choice') {
    const obj = {}
    d.criteria.split('\n').forEach((line) => {
      const idx = line.indexOf(':')
      if (idx > 0) obj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    })
    if (Object.keys(obj).length) payload.criteria = obj
  }

  let threshold = null
  if (d.type === 'noul') threshold = Number(d.threshold) || 0.5
  else if (d.type === 'score' && d.threshold !== '') threshold = Number(d.threshold)

  const q = { id, label: d.name.trim(), type: d.type, instructions: payload.instructions, threshold, payload }

  const oldId = editingId.value
  if (oldId) {
    // Update the existing question (and drop the old key if renamed).
    customQuestions.value = customQuestions.value.map((c) => (c.id === oldId ? q : c))
    if (oldId !== id) {
      delete visibleColumns[oldId]
    }
  } else {
    if (customQuestions.value.some((c) => c.id === id)) return
    customQuestions.value = [...customQuestions.value, q]
  }

  visibleColumns[id] = true
  editorOpen.value = false
  editingId.value = null
  await runCustom(q)
}

function matchesFilters(r) {
  if (filterDefect.value !== 'all') {
    const isD = r.j?.defect?.isDefect
    if (isD == null) return filterDefect.value === 'no'
    if (filterDefect.value === 'yes' && !isD) return false
    if (filterDefect.value === 'no' && isD) return false
  }
  if (filterSatisfaction.value !== 'all') {
    const high = r.j?.satisfaction?.high
    if (high == null) return filterSatisfaction.value === 'low'
    if (filterSatisfaction.value === 'high' && !high) return false
    if (filterSatisfaction.value === 'low' && high) return false
  }
  if (filterHelpfulness.value !== 'all') {
    const high = r.j?.helpfulness?.high
    if (high == null) return filterHelpfulness.value === 'low'
    if (filterHelpfulness.value === 'high' && !high) return false
    if (filterHelpfulness.value === 'low' && high) return false
  }
  return true
}

const rows = computed(() => {
  const list = selectedCalls.value
    .map((c) => ({ call: c, j: jevResults.value[c.id] || null, custom: customResults[c.id] || {} }))
    .filter(matchesFilters)
  const col = allColumns.value.find((c) => c.key === sortKey.value)
  const dir = sortDir.value === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    if (!col) return 0
    const va = col.getValue(a)
    const vb = col.getValue(b)
    if (typeof va === 'string' && typeof vb === 'string') return va < vb ? -dir : va > vb ? dir : 0
    return ((va ?? -1) - (vb ?? -1)) * dir
  })
})

function toggleSort(key) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = 'asc'
  }
}

const sortArrow = (key) => (sortKey.value === key ? (sortDir.value === 'asc' ? ' ↑' : ' ↓') : '')

function satisfactionBadge(j) {
  if (!j?.satisfaction) return { text: '—', cls: 'muted' }
  if (j.satisfaction.high) return { text: 'High', cls: 'answered' }
  if (j.satisfaction.score < 1.5) return { text: 'Low', cls: 'abandoned' }
  return { text: j.satisfaction.label, cls: 'voicemail' }
}

// --- JEV over time: track a question's answer across calls bucketed by time
const packs = ref([])
const trackQuestionKey = ref('')
const tsBucket = ref('day')
const tsLoading = ref(false)
const tsError = ref('')
const tsResult = ref([])
const tsMeta = ref(null) // { item, sampledPerBucket, from, to }

const trackableQuestions = computed(() => {
  const list = []
  for (const p of packs.value) {
    for (const [qid, q] of Object.entries(p.questions || {})) {
      list.push({
        key: `${p.id}:${qid}`,
        source: p.label,
        label: `${p.label} · ${label(qid)}`,
        qid,
        type: q.type,
        instructions: q.instructions,
        criteria: q.criteria,
      })
    }
  }
  for (const q of customQuestions.value) {
    list.push({
      key: `custom:${q.id}`,
      source: 'Custom',
      label: q.label,
      qid: q.id,
      type: q.type,
      instructions: q.instructions,
      criteria: q.payload.criteria,
    })
  }
  return list
})

const selectedTrackQuestion = computed(() => trackableQuestions.value.find((t) => t.key === trackQuestionKey.value))

async function runTimeseries(sample = 40) {
  const item = selectedTrackQuestion.value
  if (!item) return
  const q = { type: item.type, instructions: item.instructions }
  if (item.criteria) q.criteria = item.criteria

  tsError.value = ''
  tsLoading.value = true
  tsResult.value = []
  try {
    const to = new Date()
    const from = new Date(to.getTime() - 7 * 86400000)
    const res = await api.jevTimeseries(from.toISOString(), to.toISOString(), tsBucket.value, { [item.qid]: q }, sample)
    tsResult.value = res.results
    tsMeta.value = { item, sampledPerBucket: res.sampledPerBucket, from: res.from, to: res.to }
  } catch (err) {
    tsError.value = err.message
  } finally {
    tsLoading.value = false
  }
}

const tsYLabel = computed(() => {
  const t = tsMeta.value?.item
  if (!t) return 'value'
  return t.type === 'noul' ? '% flagged' : t.type === 'score' ? 'avg score' : '% top choice'
})

const tsChartData = computed(() => {
  const item = tsMeta.value?.item
  if (!item) return []
  const qid = item.qid
  return tsResult.value
    .map((b) => ({ time: new Date(b.time), value: b.metrics[qid]?.value ?? 0 }))
    .filter((d) => !Number.isNaN(d.time.getTime()))
})

const timeseriesMapped = computed(() =>
  timeseries.value.map((r) => ({
    time: new Date(r.time),
    calls: r.calls,
    answered: r.answered,
    abandoned: r.abandoned,
    avgWait: r.avg_wait,
  })),
)

const leaderboard3d = computed(() =>
  [...leaderboard.value]
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 15)
    .map((r) => ({
      label: r.call_center,
      value: r.calls,
      color: '#2563eb',
    })),
)

const topicsMapped = computed(() =>
  topics.value.map((r) => ({ key: r.key, value: r.value })),
)
const outcomesMapped = computed(() =>
  outcomes.value.map((r) => ({ key: r.key, value: r.value })),
)
const occupancyMapped = computed(() =>
  occupancy.value.map((r) => ({ key: r.status, value: r.value })),
)

async function load(center) {
  loading.value = true
  try {
    const [l, t, tp, o, oc] = await Promise.all([
      api.leaderboard(),
      api.timeseries(center),
      api.topics(),
      api.outcomes(),
      api.agentOccupancy(),
    ])
    leaderboard.value = l
    timeseries.value = t
    topics.value = tp
    outcomes.value = o
    occupancy.value = oc
  } finally {
    loading.value = false
  }
}

watch(centerId, (v) => load(v || undefined))

async function loadVolume() {
  volumeLoading.value = true
  try {
    volumeGrid.value = await api.volumeGrid(volumeDays.value, volumeBucket.value)
  } finally {
    volumeLoading.value = false
  }
}

watch([volumeDays, volumeBucket], loadVolume)

onMounted(async () => {
  load()
  centers.value = await api.callCenters()
  selectedCenters.value = centers.value.map((c) => c.id)
  loadVolume()
  packs.value = await api.jevQuestionSets()
})
</script>

<template>
  <div class="grid">
    <div class="panel">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px">
        <div>
          <h2>3D Call Volume</h2>
          <p class="muted">
            Each cube is a call — X is time, Y is call count, Z is call center. Drag to
            rotate, scroll to zoom.
          </p>
        </div>
        <div style="display: flex; gap: 10px; align-items: center">
          <label class="muted">days</label>
          <select v-model.number="volumeDays" style="width: 90px">
            <option :value="7">7</option>
            <option :value="14">14</option>
            <option :value="30">30</option>
          </select>
          <select v-model="volumeBucket" style="width: 100px">
            <option value="hour">hourly</option>
            <option value="day">daily</option>
          </select>
        </div>
      </div>

      <div style="display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: center; margin-bottom: 12px">
        <span class="muted" style="margin-right: 4px">Call centers:</span>
        <label style="display: flex; align-items: center; gap: 4px; font-size: 13px; cursor: pointer">
          <input type="checkbox" :checked="selectedCenters.length === centers.length" @change="toggleAll($event.target.checked)" />
          All
        </label>
        <label
          v-for="c in centerMeta"
          :key="c.id"
          style="display: flex; align-items: center; gap: 4px; font-size: 13px; cursor: pointer"
        >
          <input
            type="checkbox"
            :value="c.id"
            v-model="selectedCenters"
          />
          <span :style="{ width: '10px', height: '10px', borderRadius: '2px', background: c.color, display: 'inline-block' }"></span>
          {{ c.name }}
        </label>
      </div>

      <ThreeDCallVolume
        v-if="filteredVolumeRows.length"
        :data="filteredVolumeRows"
        :colors="centerColorById"
        :height="480"
        @select="onSelectCell"
      />
      <p v-else-if="volumeLoading" class="muted">Loading…</p>
      <p v-else class="muted">No call data for the selected centers — run a simulation or seed first.</p>

      <div v-if="selection" class="selection">
        <h3>Selected cell — {{ selection.centerName }} · {{ selection.timeIso }} (UTC)</h3>
        <p class="muted">
          {{ selection.calls }} calls ({{ selection.answered }} answered, {{ selection.abandoned }} abandoned).
          <span v-if="selectionBusy">Loading call rows…</span>
          <span v-else-if="classifying">Classifying with JEV…</span>
        </p>

        <div class="filters">
          <div class="column-picker">
            <button class="secondary sm" @click="columnPickerOpen = !columnPickerOpen">Columns ▾</button>
            <div v-if="columnPickerOpen" class="column-menu">
              <button class="close" @click="columnPickerOpen = false">✕</button>
              <div v-for="col in allColumns" :key="col.key" class="column-row">
                <label>
                  <input type="checkbox" v-model="visibleColumns[col.key]" /> {{ col.label }}
                </label>
                <button v-if="col.custom" class="edit" title="Edit question" @click="editQuestion(col.question)">✎</button>
              </div>
            </div>
          </div>
          <button class="sm" @click="openEditor">＋ New question</button>
          <label class="muted">Defect
            <select v-model="filterDefect">
              <option value="all">All</option>
              <option value="yes">Defect</option>
              <option value="no">No defect</option>
            </select>
          </label>
          <label class="muted">Satisfaction
            <select v-model="filterSatisfaction">
              <option value="all">All</option>
              <option value="high">High</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label class="muted">Helpfulness
            <select v-model="filterHelpfulness">
              <option value="all">All</option>
              <option value="high">High</option>
              <option value="low">Low</option>
            </select>
          </label>
          <span v-if="classifying" class="muted">Classifying with JEV…</span>
        </div>

        <p v-if="jevError" class="muted" style="color: var(--bad)">JEV: {{ jevError }}</p>

        <table v-if="rows.length">
          <thead>
            <tr>
              <th v-for="col in visibleColumnList" :key="col.key" class="sortable" @click="toggleSort(col.key)">
                {{ col.label }}{{ sortArrow(col.key) }}
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.call.id">
              <td v-for="col in visibleColumnList" :key="col.key">
                <span v-if="col.getBadge && col.getBadge(r)" class="badge" :class="col.getBadge(r)">{{ col.getText(r) }}</span>
                <template v-else>{{ col.getText(r) }}</template>
              </td>
              <td><button class="secondary sm" @click="openTranscript(r.call)">Transcript</button></td>
            </tr>
          </tbody>
        </table>
        <p v-else-if="selectionBusy || classifying" class="muted">Loading…</p>
        <p v-else class="muted">No calls matched this time window.</p>
      </div>
    </div>

    <div class="panel">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px">
        <div>
          <h2>JEV Over Time</h2>
          <p class="muted">Track how a JEV question's answer trends across calls over the last 7 days.</p>
        </div>
        <div style="display: flex; gap: 10px; align-items: center">
          <select v-model="trackQuestionKey" style="min-width: 220px">
            <option :value="null" disabled>Choose a question…</option>
            <option v-for="t in trackableQuestions" :key="t.key" :value="t.key">{{ t.label }}</option>
          </select>
          <select v-model="tsBucket" style="width: 90px">
            <option value="day">daily</option>
            <option value="hour">hourly</option>
          </select>
          <button :disabled="tsLoading || !trackQuestionKey" @click="runTimeseries(40)">
            {{ tsLoading ? 'Running…' : 'Run' }}
          </button>
        </div>
      </div>
      <p v-if="tsError" class="muted" style="color: var(--bad)">{{ tsError }}</p>
      <PlotChart v-if="tsChartData.length" type="line" :data="tsChartData" x="time" y="value" :options="{ y: { label: tsYLabel } }" />
      <p v-else-if="tsLoading" class="muted">Processing calls…</p>
      <p v-else class="muted">Select a JEV question and click Run to see its trend over time.</p>
      <p v-if="tsMeta" class="muted" style="font-size: 12px">
        Sampled up to {{ tsMeta.sampledPerBucket }} calls per {{ tsBucket }} bucket.
      </p>
    </div>

    <div class="panel">
      <div style="display: flex; justify-content: space-between; align-items: center">
        <h2>Call Volume Over Time</h2>
        <select v-model="centerId" style="max-width: 240px">
          <option :value="null">All call centers</option>
          <option v-for="r in leaderboard" :key="r.call_center_id" :value="r.call_center_id">
            {{ r.call_center }}
          </option>
        </select>
      </div>
      <p class="muted">Calls answered/abandoned per hour, computed on demand from raw call records.</p>
      <PlotChart
        v-if="timeseriesMapped.length"
        type="line"
        :data="timeseriesMapped"
        x="time"
        y="calls"
        :options="{ y: { label: 'calls' } }"
      />
      <p v-else-if="loading" class="muted">Loading…</p>
      <p v-else class="muted">No call data yet — run a simulation or seed first.</p>
    </div>

    <div class="panel">
      <h2>Answered vs Abandoned</h2>
      <PlotChart
        v-if="timeseriesMapped.length"
        type="bar"
        :data="timeseriesMapped"
        x="time"
        y="abandoned"
        color="var(--bad)"
        :options="{ height: 200 }"
      />
      <p v-else class="muted">No data.</p>
    </div>

    <div class="panel">
      <h2>Call Center Leaderboard</h2>
      <p class="muted">Total calls per call center (with abandonment rate).</p>
      <PlotChart
        v-if="leaderboard.length"
        type="leaderboard"
        :data="leaderboard"
        x="call_center"
        y="calls"
        :options="{ x: { label: 'calls' } }"
      />
      <p v-else class="muted">No data.</p>
    </div>

    <div class="panel">
      <h2>Leaderboard (3D)</h2>
      <p class="muted">Drag to rotate / scroll to zoom.</p>
      <ThreeBars v-if="leaderboard3d.length" :data="leaderboard3d" :height="300" />
      <p v-else class="muted">No data.</p>
    </div>

    <div class="grid" style="grid-template-columns: 1fr 1fr">
      <div class="panel">
        <h2>Call Topics</h2>
        <PlotChart
          v-if="topicsMapped.length"
          type="donut"
          :data="topicsMapped"
          x="key"
          y="value"
        />
        <p v-else class="muted">No data.</p>
      </div>
      <div class="panel">
        <h2>Agent Occupancy (live)</h2>
        <p class="muted">Agents currently in each status (raw agent_status stream).</p>
        <PlotChart
          v-if="occupancyMapped.length"
          type="donut"
          :data="occupancyMapped"
          x="key"
          y="value"
        />
        <p v-else class="muted">No active agents.</p>
      </div>
    </div>

    <div class="panel">
      <h2>Call Outcomes</h2>
      <PlotChart
        v-if="outcomesMapped.length"
        type="donut"
        :data="outcomesMapped"
        x="key"
        y="value"
      />
      <p v-else class="muted">No data.</p>
    </div>
  </div>

  <Teleport to="body">
    <div v-if="transcript" class="backdrop" @click="closeTranscript"></div>
    <aside v-if="transcript" class="drawer">
      <header class="drawer-head">
        <div>
          <div class="drawer-title">Call #{{ transcript.id }} — {{ label(transcript.topic) }}</div>
          <div class="muted" style="font-size: 12px">
            {{ transcript.outcome }} · {{ transcript.mood }} · {{ transcript.persona }} ·
            {{ new Date(transcript.started_at).toLocaleString() }}
          </div>
        </div>
        <button class="secondary sm" @click="closeTranscript">Close</button>
      </header>
      <div class="drawer-body">
        <p v-if="transcriptLoading" class="muted">Loading transcript…</p>
        <div v-else-if="transcriptTurns.length" class="turns">
          <div v-for="t in transcriptTurns" :key="t.seq" class="turn" :class="t.speaker">
            <span class="speaker">{{ t.speaker }}</span>
            <span class="body">{{ t.text }}</span>
          </div>
        </div>
        <p v-else class="muted">No transcript available.</p>
      </div>
    </aside>
  </Teleport>

  <Teleport to="body">
    <div v-if="editorOpen" class="backdrop" @click="editorOpen = false"></div>
    <div v-if="editorOpen" class="editor">
      <h3>New JEV question</h3>
      <label>Column name
        <input v-model="editorDraft.name" placeholder="e.g. Churn risk" />
      </label>
      <label>Type
        <select v-model="editorDraft.type">
          <option value="noul">Noul (yes/no)</option>
          <option value="score">Score</option>
          <option value="choice">Choice</option>
        </select>
      </label>
      <label>Instructions (what to look for)
        <textarea v-model="editorDraft.instructions" rows="3" placeholder="Is the customer at risk of cancelling?"></textarea>
      </label>
      <label v-if="editorDraft.type !== 'choice'">Threshold (high/low cutoff)
        <input v-model.number="editorDraft.threshold" type="number" step="0.1" min="0" max="1" />
      </label>
      <label v-if="editorDraft.type === 'score'">Levels (one per line, low → high)
        <textarea v-model="editorDraft.criteria" rows="4" placeholder="Unhelpful&#10;Helpful&#10;Very helpful"></textarea>
      </label>
      <label v-if="editorDraft.type === 'choice'">Options (one per line, "key: description")
        <textarea v-model="editorDraft.criteria" rows="4" placeholder="billing: payment issues&#10;technical: outages"></textarea>
      </label>
      <div class="editor-actions">
        <button class="secondary" @click="editorOpen = false">Cancel</button>
        <button @click="saveQuestion">Add column</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.selection {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
.selection h3 {
  margin: 0 0 4px;
  font-size: 15px;
}
.selection table {
  margin-top: 10px;
}
.sortable {
  cursor: pointer;
  user-select: none;
}
.sortable:hover {
  color: var(--accent);
}
.filters {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: 10px;
  align-items: flex-end;
}
.filters label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
}
.filters select {
  padding: 5px 8px;
}
.sm {
  font-size: 12px;
  padding: 4px 9px;
}
.column-picker {
  position: relative;
}
.column-menu {
  position: absolute;
  left: 0;
  bottom: 34px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
  padding: 10px 12px;
  min-width: 200px;
  max-height: 320px;
  overflow-y: auto;
  z-index: 50;
  display: grid;
  gap: 6px;
}
.column-menu label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
}
.column-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.column-row .edit {
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 14px;
  padding: 0 2px;
}
.column-row .edit:hover {
  color: var(--accent);
}
.column-menu .close {
  align-self: flex-end;
  background: #e5e7eb;
  color: var(--text);
  font-size: 12px;
  padding: 2px 7px;
}
.editor {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.2);
  z-index: 1100;
  width: 460px;
  max-width: 92vw;
  padding: 20px;
  display: grid;
  gap: 12px;
}
.editor h3 {
  margin: 0;
}
.editor label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}
.editor input,
.editor textarea,
.editor select {
  font: inherit;
  font-size: 14px;
  padding: 7px 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 4px;
}
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(17, 24, 39, 0.35);
  z-index: 1000;
}
.drawer {
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  width: 430px;
  max-width: 90vw;
  background: #fff;
  z-index: 1001;
  box-shadow: -6px 0 24px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
}
.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--border);
}
.drawer-title {
  font-weight: 700;
  font-size: 15px;
}
.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
.turns {
  display: grid;
  gap: 8px;
}
.turn {
  display: flex;
  gap: 8px;
  font-size: 13.5px;
  line-height: 1.45;
}
.turn .speaker {
  font-weight: 700;
  text-transform: capitalize;
  min-width: 46px;
  color: var(--muted);
}
.turn.caller .speaker { color: var(--accent); }
.turn.agent .speaker { color: var(--good); }
</style>