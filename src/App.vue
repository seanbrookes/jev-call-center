<script setup>
import { RouterView } from 'vue-router'
</script>

<template>
  <div class="app">
    <header class="topbar">
      <nav class="nav">
        <span class="brand">JEV Call Center</span>
        <RouterLink to="/">Dashboard</RouterLink>
        <RouterLink to="/call-centers">Call Centers</RouterLink>
        <RouterLink to="/analytics">Analytics</RouterLink>
        <RouterLink to="/jev">JEV</RouterLink>
      </nav>
    </header>
    <main class="content">
      <RouterView />
    </main>
  </div>
</template>