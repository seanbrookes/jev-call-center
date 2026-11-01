<script setup>
// Renders JEV structured answers (noul / choice / score) into readable cards.
// Props:
//   questions : map of id -> { type, instructions, criteria? }
//   answers   : map of id -> answer object

const props = defineProps({
  questions: { type: Object, default: () => ({}) },
  answers: { type: Object, default: () => ({}) },
})

const pct = (n) => `${Math.round((n ?? 0) * 100)}%`

function niceText(label) {
  return label.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
</script>

<template>
  <div class="answers" v-if="answers && Object.keys(answers).length">
    <div v-for="(q, id) in questions" :key="id" class="answer">
      <div class="answer-head">
        <span class="answer-id">{{ niceText(id) }}</span>
        <span v-if="q?.instructions" class="answer-hint muted" :title="q.instructions">
          {{ q.instructions }}
        </span>
      </div>

      <template v-if="answers[id]?.type === 'noul'">
        <div class="noul">
          <div class="noul-bar">
            <div
              class="noul-fill"
              :style="{ width: pct(answers[id].noul), background: answers[id].noul > 0.66 ? 'var(--good)' : answers[id].noul > 0.33 ? 'var(--accent)' : 'var(--bad)' }"
            ></div>
          </div>
          <span class="muted" style="font-size: 12px">{{ pct(answers[id].noul) }} yes</span>
        </div>
      </template>

      <template v-else-if="answers[id]?.type === 'choice'">
        <div class="choice">
          <div class="choice-top">
            <span class="badge answered">{{ niceText(answers[id].choice) }}</span>
            <span class="muted" style="font-size: 12px">confidence {{ pct(answers[id].confidence) }}</span>
          </div>
          <div class="probs">
            <div v-for="(p, label) in answers[id].probabilities" :key="label" class="prob-row">
              <span class="prob-label">{{ niceText(label) }}</span>
              <div class="prob-bar"><div class="prob-fill" :style="{ width: pct(p) }"></div></div>
              <span class="muted" style="font-size: 11px; min-width: 34px; text-align: right">{{ pct(p) }}</span>
            </div>
          </div>
        </div>
      </template>

      <template v-else-if="answers[id]?.type === 'score'">
        <div class="score">
          <div class="score-top">
            <span class="value">{{ Number(answers[id].score).toFixed(2) }}</span>
            <span class="muted" style="font-size: 12px">confidence {{ pct(answers[id].confidence) }}</span>
          </div>
          <div class="probs">
            <div v-for="(label, lv) in answers[id].legend" :key="lv" class="prob-row">
              <span class="prob-label">{{ label }}</span>
              <div class="prob-bar"><div class="prob-fill" :style="{ width: pct(answers[id].probabilities[lv]) }"></div></div>
              <span class="muted" style="font-size: 11px; min-width: 34px; text-align: right">{{ pct(answers[id].probabilities[lv]) }}</span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.answers {
  display: grid;
  gap: 12px;
}
.answer {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
}
.answer-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.answer-id {
  font-weight: 600;
}
.answer-hint {
  font-size: 12px;
}
.noul {
  display: flex;
  align-items: center;
  gap: 10px;
}
.noul-bar {
  flex: 1;
  height: 10px;
  background: #e5e7eb;
  border-radius: 999px;
  overflow: hidden;
}
.noul-fill {
  height: 100%;
  border-radius: 999px;
}
.choice-top,
.score-top {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.value {
  font-size: 22px;
  font-weight: 700;
}
.probs {
  margin-top: 8px;
  display: grid;
  gap: 4px;
}
.prob-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.prob-label {
  min-width: 120px;
  font-size: 12px;
}
.prob-bar {
  flex: 1;
  height: 8px;
  background: #e5e7eb;
  border-radius: 999px;
  overflow: hidden;
}
.prob-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 999px;
}
</style>