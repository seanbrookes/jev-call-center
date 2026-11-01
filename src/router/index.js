import { createRouter, createWebHistory } from 'vue-router'
import DashboardView from '@/views/DashboardView.vue'
import CallCentersView from '@/views/CallCentersView.vue'
import AnalyticsView from '@/views/AnalyticsView.vue'
import JevView from '@/views/JevView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'dashboard', component: DashboardView },
    { path: '/call-centers', name: 'call-centers', component: CallCentersView },
    { path: '/analytics', name: 'analytics', component: AnalyticsView },
    { path: '/jev', name: 'jev', component: JevView },
  ],
})

export default router