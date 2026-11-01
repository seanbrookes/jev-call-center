<script setup>
import { onMounted, ref } from 'vue'
import { useCallCenterStore } from '@/stores/callCenter'

const store = useCallCenterStore()

const newCenter = ref({
  company_id: null,
  name: '',
  timezone: 'UTC',
  open_time: 540,
  close_time: 1020,
  base_calls_per_hour: 30,
  days_of_week: '1,2,3,4,5',
})

const minutesToLabel = (m) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

const companyName = (id) => store.companies.find((c) => c.id === id)?.name || '—'

async function createCenter() {
  await store.createCallCenter(newCenter.value)
}

onMounted(async () => {
  await store.loadCompanies()
  await store.loadCallCenters()
})
</script>

<template>
  <div class="grid">
    <div class="panel">
      <h2>Companies</h2>
      <table>
        <thead>
          <tr><th>Name</th><th>Timezone</th><th>Centers</th></tr>
        </thead>
        <tbody>
          <tr v-for="c in store.companies" :key="c.id">
            <td>{{ c.name }}</td>
            <td>{{ c.timezone }}</td>
            <td>{{ store.callCenters.filter((cc) => cc.company_id === c.id).length }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="panel">
      <h2>Call Centers</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th><th>Company</th><th>Timezone</th>
            <th>Hours</th><th>Calls/hr</th><th>Days</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="cc in store.callCenters" :key="cc.id">
            <td>{{ cc.name }}</td>
            <td>{{ companyName(cc.company_id) }}</td>
            <td>{{ cc.timezone }}</td>
            <td>{{ minutesToLabel(cc.open_time) }}–{{ minutesToLabel(cc.close_time) }}</td>
            <td>{{ cc.base_calls_per_hour }}</td>
            <td>{{ cc.days_of_week }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="panel">
      <h2>Add Call Center</h2>
      <div style="display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))">
        <select v-model="newCenter.company_id">
          <option :value="null" disabled>Select company…</option>
          <option v-for="c in store.companies" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <input v-model="newCenter.name" placeholder="Center name" />
        <input v-model="newCenter.timezone" placeholder="Timezone (IANA)" />
        <input v-model.number="newCenter.open_time" type="number" placeholder="Open (min)" />
        <input v-model.number="newCenter.close_time" type="number" placeholder="Close (min)" />
        <input v-model.number="newCenter.base_calls_per_hour" type="number" placeholder="Calls/hr" />
        <input v-model="newCenter.days_of_week" placeholder="Days (1,2,3…)" />
      </div>
      <button style="margin-top: 12px" @click="createCenter">Create</button>
    </div>
  </div>
</template>