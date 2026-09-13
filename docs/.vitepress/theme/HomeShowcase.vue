<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { withBase } from 'vitepress'

const steps = [
  { n: '01', t: 'Consent once', d: 'Fleet API + virtual key. Then the car talks to you, not a portal.' },
  { n: '02', t: 'One ingest', d: 'MQTT in. ProcessAtomics. SI out. No second pipeline, no “just this table”.' },
  { n: '03', t: 'Ship the console', d: 'Go API, React SPA, workers. You already run worse stacks for fun.' },
]
const forDevs = [
  'Go 1.25, Chi, pgx, zerolog — not a mystery framework.',
  'VitePress docs with Copy for LLM. Paste the page into the agent.',
  'Feature catalogue generated from the real sidebar. If it is in the app, it is in the docs.',
]

const egg = ref('')
const ludicrous = ref(false)
let photoClicks = 0
let kickerClicks = 0
let seq: string[] = []
const konami = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a']
const typed: string[] = []

function toast(msg: string) {
  egg.value = msg
  window.setTimeout(() => { if (egg.value === msg) egg.value = '' }, 4200)
}

function onPhotoClick() {
  photoClicks += 1
  if (photoClicks === 3) {
    photoClicks = 0
    toast('Range anxiety is a homelab skill issue.')
  }
}

function onKickerClick() {
  kickerClicks += 1
  if (kickerClicks === 7) {
    kickerClicks = 0
    toast('You named the VLAN “cars”. We knew.')
  }
}

function onKey(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
  seq.push(e.key)
  if (seq.length > konami.length) seq.shift()
  if (konami.every((k, i) => seq[i] === k)) {
    seq = []
    ludicrous.value = !ludicrous.value
    toast(ludicrous.value ? 'Ludicrous mode. ProcessAtomics is THE one ingest.' : 'Chill mode. Redis can be dramatic again.')
    document.documentElement.classList.toggle('hs-ludicrous', ludicrous.value)
  }
  typed.push(e.key.toLowerCase())
  if (typed.length > 16) typed.shift()
  const s = typed.join('')
  if (s.endsWith('wh')) toast('Watt-hours on disk. kWh is a display problem.')
  if (s.endsWith('mqtt')) toast('If the broker is down, the car is just a very expensive Bluetooth speaker.')
  if (s.endsWith('si')) toast('Meters. Seconds. Watts. Not miles, not vibes.')
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  document.documentElement.classList.remove('hs-ludicrous')
})
</script>

<template>
  <section class="hs" :class="{ 'is-ludicrous': ludicrous }">
    <div class="hs-product">
      <div class="hs-copy">
        <p class="hs-kicker" @click="onKickerClick">For operators who already named a VLAN “cars”</p>
        <h2>A Tesla console that belongs next to Prometheus, not in a browser tab you rent.</h2>
        <p>Built by people who would rather debug MQTT than click “export CSV” forever.</p>
        <ul class="hs-steps">
          <li v-for="s in steps" :key="s.n">
            <span>{{ s.n }}</span>
            <div>
              <strong>{{ s.t }}</strong>
              <em>{{ s.d }}</em>
            </div>
          </li>
        </ul>
      </div>
      <figure class="hs-visual" title="">
        <img :src="withBase('/hero/model3.jpg')" alt="" @click="onPhotoClick" />
      </figure>
    </div>
    <div class="hs-devs">
      <p class="hs-kicker">For the people who will actually install it</p>
      <ul>
        <li v-for="line in forDevs" :key="line">{{ line }}</li>
      </ul>
    </div>
    <p v-if="egg" class="hs-egg" role="status">{{ egg }}</p>
  </section>
</template>
