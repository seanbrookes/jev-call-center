<script setup>
import { onMounted, ref, computed } from 'vue'
import { api } from '@/lib/api'
import JevAnswers from '@/components/JevAnswers.vue'

const status = ref({ configured: false, baseUrl: null, model: null })
const packs = ref([])
const packId = ref('call-quality')

// Single-call inspector
const recentCalls = ref([])
const selectedCallId = ref(null)
const call = ref(null)
const turns = ref([])
const singleResult = ref(null)
const singleBusy = ref(false)
const singleError = ref('')

// Batch
const batchCenterId = ref(null)
const batchCount = ref(20)
const batchBusy = ref(false)
const batchError = ref('')
const batchResult = ref(null)
const centers = ref([])

const currentPack = computed(() => packs.value.find((p) => p.id === packId.value) || { questions: {} })
const currentQuestions = computed(() => currentPack.value.questions || {})

const label = (s) => String(s).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
const fmtTime = (iso) => iso ? new Date(iso).toLocaleString() : ''

async function loadRecentCalls() {
  recentCalls.value = await api.calls(null, 200)
}

async function selectCall(id) {
  selectedCallId.value = id
  singleResult.value = null
  singleError.value = ''
  call.value = await api.call(id)
  const t = await api.transcript(id)
  turns.value = t.turns
}

async function analyzeSingle() {
  singleBusy.value = true
  singleError.value = ''
  singleResult.value = null
  try {
    const res = await api.jevAnalyze([selectedCallId.value], packId.value)
    singleResult.value = res.results[0]?.answers || {}
  } catch (err) {
    singleError.value = err.message
  } finally {
    singleBusy.value = false
  }
}

async function runBatch(targetCenter) {
  batchBusy.value = true
  batchError.value = ''
  batchResult.value = null
  try {
    const calls = await api.calls(targetCenter || null, batchCount.value)
    if (!calls.length) {
      batchError.value = 'No calls to analyze.'
      return
    }
    const res = await api.jevAnalyze(calls.map((c) => c.id), packId.value)
    batchResult.value = aggregate(res.results, currentQuestions.value)
  } catch (err) {
    batchError.value = err.message
  } finally {
    batchBusy.value = false
  }
}

function aggregate(results, questions) {
  const ids = Object.keys(questions)
  const out = { count: results.length, byQuestion: {} }
  for (const id of ids) {
    const q = questions[id]
    const answers = results.map((r) => r.answers?.[id]).filter(Boolean)
    if (!answers.length) continue
    if (q.type === 'noul') {
      const vals = answers.map((a) => a.noul)
      out.byQuestion[id] = {
        type: 'noul',
        count: vals.length,
        avg: vals.reduce((s, v) => s + v, 0) / vals.length,
        yesPct: vals.filter((v) => v > 0.5).length / vals.length,
      }
    } else if (q.type === 'choice') {
      const counts = {}
      answers.forEach((a) => { counts[a.choice] = (counts[a.choice] || 0) + 1 })
      out.byQuestion[id] = { type: 'choice', count: answers.length, counts }
    } else if (q.type === 'score') {
      out.byQuestion[id] = {
        type: 'score',
        count: answers.length,
        avg: answers.reduce((s, a) => s + a.score, 0) / answers.length,
        avgConf: answers.reduce((s, a) => s + a.confidence, 0) / answers.length,
      }
    }
  }
  return out
}

onMounted(async () => {
  status.value = await api.jevStatus()
  packs.value = await api.jevQuestionSets()
  centers.value = await api.callCenters()
  await loadRecentCalls()
})
</script>

<template>
  <div class="grid">
    <div class="panel">
      <h2>JEV Connection</h2>
      <p>
        Status:
        <span v-if="status.configured" class="badge answered">Configured</span>
        <span v-else class="badge abandoned">Not configured</span>
      </p>
      <p class="muted">Base URL: {{ status.baseUrl }}</p>
      <p class="muted">Model: {{ status.model }}</p>
      <p class="muted">
        Set <code>TYPESAFE_API_KEY</code> in <code>.env</code> to enable analysis.
      </p>

      <label style="display: block; margin-top: 12px">
        <span class="muted">Analysis pack</span>
        <select v-model="packId" style="width: 100%">
          <option v-for="p in packs" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
      </label>
      <p class="muted" style="margin-top: 6px">{{ currentPack.description }}</p>
    </div>

    <div class="panel">
      <h2>Analyze a Single Call</h2>
      <p class="muted">Pick a recent call, review its transcript, and score it with JEV.</p>

      <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap">
        <select v-model="selectedCallId" @change="selectCall(selectedCallId)" style="min-width: 260px; flex: 1">
          <option :value="null" disabled>Select a call…</option>
          <option v-for="c in recentCalls" :key="c.id" :value="c.id">
            #{{ c.id }} · {{ label(c.topic) }} · {{ c.mood }}
          </option>
        </select>
        <button :disabled="singleBusy || !selectedCallId" @click="analyzeSingle">
          {{ singleBusy ? 'Analyzing…' : 'Analyze' }}
        </button>
      </div>

      <div v-if="call" class="call-meta" style="margin-top: 12px">
        <span class="badge answered">{{ call.outcome }}</span>
        <span class="muted">topic: {{ label(call.topic) }}</span>
        <span class="muted">mood: {{ call.mood }}</span>
        <span class="muted">persona: {{ call.persona }}</span>
        <span class="muted">{{ fmtTime(call.started_at) }}</span>
      </div>

      <div v-if="turns.length" class="transcript" style="margin-top: 12px">
        <div v-for="t in turns" :key="t.seq" class="turn" :class="t.speaker">
          <span class="speaker">{{ t.speaker }}</span>
          <span class="body">{{ t.text }}</span>
        </div>
      </div>

      <p v-if="singleError" class="muted" style="color: var(--bad)">{{ singleError }}</p>
      <JevAnswers v-if="singleResult" :questions="currentQuestions" :answers="singleResult" />
    </div>

    <div class="panel">
      <h2>Batch Analysis</h2>
      <p class="muted">
        Run the pack across a set of calls and see aggregate signals (averages,
        distributions) per question.
      </p>
      <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap">
        <select v-model="batchCenterId" style="min-width: 200px">
          <option :value="null">All call centers</option>
          <option v-for="c in centers" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <label class="muted">calls</label>
        <input v-model.number="batchCount" type="number" min="1" max="100" style="width: 80px" />
        <button :disabled="batchBusy" @click="runBatch(batchCenterId)">
          {{ batchBusy ? 'Running…' : 'Run batch' }}
        </button>
      </div>

      <p v-if="batchError" class="muted" style="color: var(--bad)">{{ batchError }}</p>

      <div v-if="batchResult" style="margin-top: 12px">
        <p class="muted">Analyzed <strong>{{ batchResult.count }}</strong> calls.</p>
        <div v-for="(q, id) in currentQuestions" :key="id" class="batch-q">
          <strong>{{ label(id) }}</strong>
          <div v-if="batchResult.byQuestion[id]?.type === 'noul'">
            <div class="prob-bar"><div class="prob-fill" :style="{ width: (batchResult.byQuestion[id].yesPct * 100) + '%' }"></div></div>
            <span class="muted" style="font-size: 12px">
              {{ Math.round(batchResult.byQuestion[id].yesPct * 100) }}% yes · avg {{ batchResult.byQuestion[id].avg.toFixed(2) }}
            </span>
          </div>
          <div v-else-if="batchResult.byQuestion[id]?.type === 'choice'" class="batch-choice">
            <span v-for="(n, label) in batchResult.byQuestion[id].counts" :key="label" class="muted" style="font-size: 12px; margin-right: 10px">
              {{ label }}: {{ n }}
            </span>
          </div>
          <div v-else-if="batchResult.byQuestion[id]?.type === 'score'" class="muted" style="font-size: 12px">
            avg score {{ batchResult.byQuestion[id].avg.toFixed(2) }} · avg confidence {{ Math.round(batchResult.byQuestion[id].avgConf * 100) }}%
          </div>
          <div v-else class="muted" style="font-size: 12px">no results</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.call-meta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
  font-size: 13px;
}
.transcript {
  display: grid;
  gap: 6px;
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
  background: #fafafa;
}
.turn {
  display: flex;
  gap: 8px;
  font-size: 13px;
}
.turn .speaker {
  font-weight: 600;
  text-transform: capitalize;
  min-width: 52px;
}
.turn.caller .speaker { color: var(--accent); }
.turn.agent .speaker { color: var(--good); }
.turn.ivr .speaker { color: var(--muted); }
.batch-q {
  border-top: 1px solid var(--border);
  padding: 8px 0;
}
.prob-bar {
  flex: 1;
  height: 8px;
  background: #e5e7eb;
  border-radius: 999px;
  overflow: hidden;
  margin: 4px 0;
}
.prob-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 999px;
}
.batch-choice {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
</style>