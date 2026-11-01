import { defineStore } from 'pinia'
import { api } from '@/lib/api'

export const useCallCenterStore = defineStore('callCenter', {
  state: () => ({
    companies: [],
    callCenters: [],
    queues: [],
    agents: [],
    agentStatuses: [],
    calls: [],
    loading: false,
    error: null,
  }),

  actions: {
    async loadCompanies() {
      this.companies = await api.companies()
    },
    async loadCallCenters(companyId) {
      this.callCenters = await api.callCenters(companyId)
    },
    async loadQueues(centerId) {
      this.queues = await api.queues(centerId)
    },
    async loadAgents(centerId) {
      this.agents = await api.agents(centerId)
    },
    async loadAgentStatuses(centerId, limit) {
      this.agentStatuses = await api.agentStatuses(centerId, limit)
    },
    async loadCalls(centerId, limit) {
      this.calls = await api.calls(centerId, limit)
    },
    async createCompany(body) {
      await api.createCompany(body)
      await this.loadCompanies()
    },
    async createCallCenter(body) {
      await api.createCallCenter(body)
      await this.loadCallCenters()
    },
    async loadAll() {
      this.loading = true
      this.error = null
      try {
        await Promise.all([
          this.loadCompanies(),
          this.loadCallCenters(),
          this.loadQueues(),
          this.loadAgents(),
          this.loadAgentStatuses(),
        ])
      } catch (err) {
        this.error = err.message
      } finally {
        this.loading = false
      }
    },
  },
})