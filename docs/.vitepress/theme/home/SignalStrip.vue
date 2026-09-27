<script setup lang="ts">
const items = [
  'fleet telemetry · live',
  'soc 67.2%',
  'charge 11.2 kW',
  'session +24.6 kWh',
  'odo 48 212 km',
  'trip replay',
  'every drive kept',
  'one ingest',
  'si on disk',
  'saas tax $0',
]
</script>

<template>
  <div class="strip" aria-label="Live telemetry summary">
    <div class="strip__track">
      <div class="strip__row">
        <span v-for="item in items" :key="item" class="strip__item">{{ item }}</span>
      </div>
      <div class="strip__row" aria-hidden="true">
        <span v-for="item in items" :key="item" class="strip__item">{{ item }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.strip {
  border-top: 1px solid var(--vp-c-divider);
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-alt);
  overflow: hidden;
}

.strip__track {
  display: flex;
  width: max-content;
  animation: scroll 46s linear infinite;
}

.strip:hover .strip__track {
  animation-play-state: paused;
}

@keyframes scroll {
  to {
    transform: translateX(-50%);
  }
}

.strip__row {
  display: flex;
  flex: none;
}

.strip__item {
  font-family: var(--ts-font-mono);
  font-size: 12.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
  color: var(--vp-c-text-2);
  padding: 13px 0;
}

.strip__item::after {
  content: "·";
  margin: 0 22px;
  color: var(--ts-red);
  font-weight: 600;
}

@media (prefers-reduced-motion: reduce) {
  .strip__track {
    animation: none;
  }
}
</style>
