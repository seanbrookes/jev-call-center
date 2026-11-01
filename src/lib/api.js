// Thin fetch wrapper around the Express API (proxied by Vite at /api in dev).

async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, options)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Request failed: ${res.status}`)
  }
  return res.json()
}

const post = (path, body) =>
  request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const api = {
  companies: () => request('/companies'),
  createCompany: (body) => post('/companies', body),

  callCenters: (companyId) => request(`/call-centers${companyId ? `?companyId=${companyId}` : ''}`),
  createCallCenter: (body) => post('/call-centers', body),

  queues: (centerId) => request(`/queues${centerId ? `?centerId=${centerId}` : ''}`),

  agents: (centerId) => request(`/agents${centerId ? `?centerId=${centerId}` : ''}`),
  agentCenters: (id) => request(`/agents/${id}/centers`),

  agentStatuses: (centerId, limit) => request(`/agent-statuses${centerId ? `?centerId=${centerId}&` : '?'}limit=${limit || 500}`),

  calls: (centerId, limit, from, to) => {
    const params = new URLSearchParams()
    if (centerId) params.set('centerId', centerId)
    params.set('limit', limit || 500)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    return request(`/calls?${params.toString()}`)
  },
  call: (id) => request(`/calls/${id}`),
  transcript: (id) => request(`/calls/${id}/transcript`),

  scenarioOptions: () => request('/scenario/options'),

  simulate: (from, to, scenario = {}) => post('/simulate', { from, to, scenario }),

  liveStart: (scenario = {}) => post('/simulate/live/start', { scenario }),
  liveStop: () => post('/simulate/live/stop'),
  liveHeartbeat: () => post('/simulate/live/heartbeat'),
  liveState: () => request('/simulate/live/state'),

  leaderboard: () => request('/analytics/leaderboard'),
  timeseries: (centerId, bucket) => request(`/analytics/timeseries?${centerId ? `centerId=${centerId}&` : ''}bucket=${bucket || 'hour'}`),
  topics: () => request('/analytics/topics'),
  outcomes: () => request('/analytics/outcomes'),
  agentOccupancy: () => request('/analytics/agent-occupancy'),
  volumeGrid: (days, bucket) => request(`/analytics/volume-grid?days=${days || 7}&bucket=${bucket || 'hour'}`),

  jevStatus: () => request('/jev/status'),
  jevEvaluate: (state, questions, model) => post('/jev/evaluate', { state, questions, model }),
  jevQuestionSets: () => request('/jev/question-sets'),
  jevAnalyze: (calls, packId) => post('/jev/analyze', { calls, packId }),
  jevAnalyzeWithQuestions: (calls, questions) => post('/jev/analyze', { calls, questions }),
  jevTimeseries: (from, to, bucket, questions, maxPerBucket) => post('/jev/timeseries', { from, to, bucket, questions, maxPerBucket }),
}