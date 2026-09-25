<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

const soc = ref(67.2)
const power = ref(11.24)
const charged = ref(24.61)
const t0 = ref('--:--:--')
const t1 = ref('--:--:--')
const t2 = ref('--:--:--')

let timer: ReturnType<typeof setInterval> | null = null

function fmt(d: Date) {
  return d.toTimeString().slice(0, 8)
}

onMounted(() => {
  const now = Date.now()
  t0.value = fmt(new Date(now - 4000))
  t1.value = fmt(new Date(now - 2000))
  t2.value = fmt(new Date(now))
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  timer = setInterval(() => {
    soc.value = soc.value >= 68 ? 67.2 : Math.round((soc.value + 0.1) * 10) / 10
    power.value = Math.round((11.1 + Math.random() * 0.3) * 100) / 100
    charged.value = Math.round((charged.value + 0.01) * 100) / 100
    t0.value = t1.value
    t1.value = t2.value
    t2.value = fmt(new Date())
  }, 2000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="console" role="img" aria-label="Terminal showing TeslaSync starting with docker compose and streaming vehicle telemetry">
    <div class="console__bar">
      <span class="console__live"><i></i>teslasync — compose</span>
      <span class="console__mqtt">mqtt · live</span>
    </div>
    <div class="console__body">
      <p class="console__line" style="--d: 0.05s"><span class="p">$</span> docker compose up -d</p>
      <p class="console__line" style="--d: 0.14s"><span class="ok">✓</span> api healthy · 4.1s</p>
      <p class="console__line" style="--d: 0.23s"><span class="ok">✓</span> mqtt connected · telemetry streaming</p>
      <p class="console__line" style="--d: 0.32s"><span class="ok">✓</span> console ready · <span class="hl">all systems go</span></p>
      <p class="console__line dim" style="--d: 0.41s">{{ t0 }}&nbsp;&nbsp;soc 67.0% · 11.31 kW · +24.59 kWh</p>
      <p class="console__line dim" style="--d: 0.5s">{{ t1 }}&nbsp;&nbsp;soc 67.1% · 11.18 kW · +24.60 kWh</p>
      <p class="console__line live" style="--d: 0.59s">
        {{ t2 }}&nbsp;&nbsp;soc {{ soc.toFixed(1) }}% · {{ power.toFixed(2) }} kW · +{{ charged.toFixed(2) }} kWh<span class="caret"></span>
      </p>
    </div>
  </div>
</template>

<style scoped>
.console {
  background: #141412;
  border: 1px solid #2b2b27;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.28);
  font-family: var(--ts-font-mono);
}

.console__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 16px;
  border-bottom: 1px solid #2b2b27;
  font-size: 12px;
  letter-spacing: 0.04em;
  color: #8f8c83;
}

.console__live {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.console__live i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #34d399;
  box-shadow: 0 0 10px rgba(52, 211, 153, 0.7);
  animation: blink 2.4s ease-in-out infinite;
}

@keyframes blink {
  0%,
  100% { opacity: 1; }
  50% { opacity: 0.45; }
}

.console__mqtt {
  color: #5c5a52;
}

.console__body {
  padding: 18px 18px 20px;
  font-size: 13.5px;
  line-height: 2;
}

.console__line {
  margin: 0;
  color: #e8e6df;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  animation: rise 0.45s ease both;
  animation-delay: var(--d, 0s);
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(5px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.console__line .p {
  color: #7c7970;
  margin-right: 8px;
}

.console__line .ok {
  color: #34d399;
  margin-right: 8px;
}

.console__line .hl {
  color: #f2555a;
  font-weight: 600;
}

.console__line.dim {
  color: #9a978e;
}

.console__line.live {
  color: #d6d3c8;
}

.caret {
  display: inline-block;
  width: 8px;
  height: 15px;
  margin-left: 8px;
  vertical-align: -2px;
  background: #f2555a;
  animation: blink 1.1s steps(1) infinite;
}

@media (max-width: 560px) {
  .console__body {
    font-size: 11px;
    padding: 14px 12px;
    line-height: 2.1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .console__line {
    animation: none;
  }
  .console__live i,
  .caret {
    animation: none;
  }
}
</style>
