<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useData, withBase } from 'vitepress'
import HeroConsole from './HeroConsole.vue'
import SignalStrip from './SignalStrip.vue'

const { isDark } = useData()

const steps = [
  {
    n: '01',
    t: 'Install',
    d: 'Docker Compose on a trusted host. No Go or Node required for a trial.',
    link: '/guide/getting-started',
  },
  {
    n: '02',
    t: 'Connect Tesla',
    d: 'Fleet API application, six scopes, redirect URI, owner consent.',
    link: '/guide/tesla-fleet-api',
  },
  {
    n: '03',
    t: 'Enable streaming',
    d: 'Fleet Telemetry receiver, TLS, virtual key, signed config.',
    link: '/guide/fleet-telemetry',
  },
  {
    n: '04',
    t: 'Find a screen',
    d: 'Every route grouped like the app sidebar, with empty-state notes.',
    link: '/features/catalogue',
  },
]

const ownerRows = [
  {
    t: 'Every drive, kept',
    d: 'Route, energy, cost, and FSD share — recorded automatically.',
    link: '/features/catalogue-driving',
  },
  {
    t: 'Charging without surprises',
    d: 'Session kWh checked against Tesla\u2019s own receipts.',
    link: '/features/catalogue-charging',
  },
  {
    t: 'Battery, honestly',
    d: 'Health and degradation from your history, not a forum rumor.',
    link: '/features/catalogue-battery',
  },
]

const devRows = [
  {
    t: '$ docker compose up',
    d: 'Four containers. No account, no cloud, no phone-home.',
    link: '/deployment/docker',
    mono: true,
  },
  {
    t: 'MQTT in, SI out',
    d: 'One ingest — ProcessAtomics into TimescaleDB.',
    link: '/guide/fleet-telemetry',
    mono: false,
  },
  {
    t: 'API + console',
    d: 'Go backend, typed endpoints, generated catalogue.',
    link: '/guide/api-endpoints',
    mono: false,
  },
]

const flow = ['Vehicle', 'Fleet Telemetry', 'MQTT', 'ProcessAtomics', 'TimescaleDB', 'Go API', 'Console']

const shots = [
  { name: 'automations', alt: 'Current TeslaSync automation templates for schedules and vehicle events', cap: 'Automations · ready-to-use templates' },
  { name: 'catalogue', alt: 'Current TeslaSync feature catalogue with categories and search', cap: 'Explore · find every feature' },
  { name: 'appearance', alt: 'Current TeslaSync appearance controls with the Tesla Red accent selected', cap: 'Appearance · choose your theme' },
]

function screenshot(name: string) {
  return withBase(`/screenshots/current-${name}-red-${isDark.value ? 'dark' : 'light'}.png`)
}

const sitemap = [
  {
    h: 'Start',
    links: [
      { t: 'Overview', link: '/get-started' },
      { t: 'Install', link: '/guide/getting-started' },
      { t: 'Connect Tesla', link: '/guide/tesla-fleet-api' },
      { t: 'Enable streaming', link: '/guide/fleet-telemetry' },
    ],
  },
  {
    h: 'Console',
    links: [
      { t: 'Catalogue', link: '/features/catalogue' },
      { t: 'Driving', link: '/features/catalogue-driving' },
      { t: 'Charging', link: '/features/catalogue-charging' },
      { t: 'Automations', link: '/features/automations' },
    ],
  },
  {
    h: 'Deploy',
    links: [
      { t: 'Docker', link: '/deployment/docker' },
      { t: 'Kubernetes', link: '/deployment/kubernetes' },
      { t: 'Release verification', link: '/operations/release-verification' },
      { t: 'Fleet API budget', link: '/operations/fleet-api-budget' },
    ],
  },
  {
    h: 'Project',
    links: [
      { t: 'Contributing', link: '/CONTRIBUTING' },
      { t: 'Code structure', link: '/contributing/code-structure' },
      { t: 'API endpoints', link: '/guide/api-endpoints' },
      { t: 'Roadmap', link: '/guide/roadmap' },
    ],
  },
]

function onScroll() {
  document.body.classList.toggle('ts-scrolled', window.scrollY > 40)
}

onMounted(() => {
  document.body.classList.add('ts-landing')
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})

onUnmounted(() => {
  document.body.classList.remove('ts-landing', 'ts-scrolled')
  window.removeEventListener('scroll', onScroll)
})
</script>

<template>
  <div class="ts-home">
    <!-- Cinematic hero -->
    <section class="hero">
      <div class="hero__bg" aria-hidden="true">
        <img :src="withBase('/hero/model3.jpg')" alt="" fetchpriority="high" />
      </div>
      <div class="hero__inner">
        <p class="hero__status"><i></i>Open source · self-hosted · MIT</p>
        <h1>Your Tesla knows everything.<br />Now you do too.</h1>
        <p class="hero__lede">
          TeslaSync is the self-hosted console for your car — every drive,
          charge, and watt, streamed live to infrastructure you own.
        </p>
        <div class="hero__actions">
          <a class="btn btn--primary" :href="withBase('/get-started')">Get started</a>
          <a class="btn btn--glass" href="#console">See the console</a>
        </div>
        <dl class="hero__stats">
          <div>
            <dt>Ingest pipelines</dt>
            <dd>1</dd>
          </div>
          <div>
            <dt>Automations</dt>
            <dd>40+</dd>
          </div>
          <div>
            <dt>SaaS tax</dt>
            <dd>$0</dd>
          </div>
        </dl>
      </div>
      <p class="hero__cue" aria-hidden="true"><span>Scroll</span></p>
    </section>

    <!-- Telemetry ticker -->
    <SignalStrip class="bleed" />

    <!-- Start here -->
    <section class="section steps">
      <div class="section__head">
        <h2>Start here</h2>
        <a :href="withBase('/get-started')">Full overview →</a>
      </div>
      <ol>
        <li v-for="s in steps" :key="s.n">
          <a :href="withBase(s.link)">
            <span class="steps__n">{{ s.n }}</span>
            <span class="steps__t">{{ s.t }}</span>
            <span class="steps__d">{{ s.d }}</span>
            <span class="steps__arrow" aria-hidden="true">→</span>
          </a>
        </li>
      </ol>
    </section>

    <!-- Owners -->
    <section id="owners" class="section split">
      <div class="split__copy">
        <h2>Know every mile.</h2>
        <p class="section__lead">
          You already drive the data. TeslaSync keeps it — every trip,
          every charge, every battery cycle — and turns it into answers.
        </p>
        <ul class="check">
          <li v-for="r in ownerRows" :key="r.t">
            <a :href="withBase(r.link)">
              <strong>{{ r.t }}</strong>
              <span>{{ r.d }}</span>
            </a>
          </li>
        </ul>
      </div>
      <figure class="split__media" data-enlarge tabindex="0" role="button" aria-label="Enlarge screenshot: driving feature catalogue">
        <img
          :src="screenshot('driving')"
          alt="Current TeslaSync driving catalogue with navigation and trip analysis tools"
          loading="lazy"
        />
        <figcaption>Driving · the tools behind every journey</figcaption>
      </figure>
    </section>

    <!-- Devs -->
    <section id="iron" class="section split split--flip">
      <div class="split__copy">
        <h2>Your data, on your iron.</h2>
        <p class="section__lead">
          Fleet Telemetry on your MQTT. SI units in your Timescale.
          If you can docker compose, you can ship this tonight.
        </p>
        <ul class="check">
          <li v-for="r in devRows" :key="r.t">
            <a :href="withBase(r.link)">
              <strong :class="{ mono: r.mono }">{{ r.t }}</strong>
              <span>{{ r.d }}</span>
            </a>
          </li>
        </ul>
      </div>
      <div class="split__media">
        <HeroConsole />
      </div>
    </section>

    <!-- Gallery -->
    <section id="console" class="section gallery">
      <h2>The console.</h2>
      <p class="section__lead">
        Screens from the current app in matching light and dark modes with the Tesla Red accent.
        Captured on an unconnected local install — no vehicle history or live metrics are shown.
        Click any shot to inspect it.
      </p>
      <figure class="gallery__main" data-enlarge tabindex="0" role="button" aria-label="Enlarge screenshot: automation schedule builder">
        <img
          :src="screenshot('automation-builder')"
          alt="Current TeslaSync automation builder with a schedule trigger and readiness checklist"
          loading="eager"
        />
        <figcaption>Automation builder · configure a schedule without saving it</figcaption>
      </figure>
      <div class="gallery__row">
        <figure v-for="shot in shots" :key="shot.name" data-enlarge tabindex="0" role="button" :aria-label="'Enlarge screenshot: ' + shot.cap">
          <img :src="screenshot(shot.name)" :alt="shot.alt" loading="eager" />
          <figcaption>{{ shot.cap }}</figcaption>
        </figure>
      </div>
    </section>

    <!-- Pipeline -->
    <section class="section flow">
      <h2>One pipeline.</h2>
      <ol class="flow__track" aria-label="Data pipeline from vehicle to console">
        <li v-for="node in flow" :key="node">{{ node }}</li>
      </ol>
      <p class="flow__note">
        Meters, watts, seconds on disk. Display units are a UI problem —
        <em>as it should be.</em>
      </p>
    </section>

    <!-- Cinematic band -->
    <section class="band bleed">
      <div class="band__bg" aria-hidden="true">
        <img :src="withBase('/hero/modely.jpg')" alt="" loading="eager" />
      </div>
      <div class="band__inner">
        <h2>Stop renting the story<br />of your own car.</h2>
        <p>If you can docker compose, you can ship this tonight.</p>
        <div class="hero__actions">
          <a class="btn btn--primary" :href="withBase('/get-started')">Get started</a>
          <a class="btn btn--glass" :href="withBase('/guide/tesla-fleet-api')">Connect Tesla</a>
        </div>
      </div>
    </section>

    <!-- Audiences -->
    <section class="section ways">
      <div class="ways__panel">
        <h3>Run it</h3>
        <p>You operate infrastructure and want the car on it. Compose or Helm, budgets and backups included.</p>
        <ul>
          <li><a :href="withBase('/deployment/docker')">Docker deploy</a></li>
          <li><a :href="withBase('/deployment/kubernetes')">Kubernetes + Helm</a></li>
          <li><a :href="withBase('/operations/release-verification')">Release verification</a></li>
          <li><a :href="withBase('/operations/fleet-api-budget')">Fleet API budget</a></li>
        </ul>
      </div>
      <div class="ways__panel">
        <h3>Extend it</h3>
        <p>Go API, React SPA, one ingest to learn. The catalogue is generated from the real sidebar.</p>
        <ul>
          <li><a :href="withBase('/contributing/code-structure')">Code structure</a></li>
          <li><a :href="withBase('/contributing/adding-features')">Adding features</a></li>
          <li><a :href="withBase('/guide/api-endpoints')">API endpoints</a></li>
          <li><a :href="withBase('/CONTRIBUTING')">Contributing</a></li>
        </ul>
      </div>
    </section>

    <!-- Sitemap -->
    <footer class="sitemap">
      <div class="sitemap__inner">
        <div class="sitemap__brand">
          <p class="sitemap__logo">
            <svg viewBox="0 0 64 64" aria-hidden="true">
              <rect width="64" height="64" rx="14" fill="#e82127" />
              <path d="M37.5 8 17 34.6h11.4L25 56l20.5-26.6H34.2z" fill="#fff" />
            </svg>
            TeslaSync
          </p>
          <p>Self-hosted Tesla intelligence.<br />MIT licensed. Your car, your iron.</p>
          <a class="sitemap__github" href="https://github.com/ev-dev-labs/teslasync" target="_blank" rel="noreferrer">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.2.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
            </svg>
            Star on GitHub
          </a>
        </div>
        <nav class="sitemap__cols" aria-label="Docs sections">
          <div v-for="col in sitemap" :key="col.h" class="sitemap__col">
            <h4>{{ col.h }}</h4>
            <ul>
              <li v-for="l in col.links" :key="l.t">
                <a :href="withBase(l.link)">{{ l.t }}</a>
              </li>
            </ul>
          </div>
        </nav>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* Dark is the cinematic default; the light palette follows the docs switch. */
.ts-home {
  --vp-c-bg: #131311;
  --vp-c-bg-alt: #1a1a17;
  --vp-c-bg-soft: #22221e;
  --vp-c-bg-elv: #1e1e1b;
  --vp-c-text-1: #f4f3ee;
  --vp-c-text-2: #b3b0a6;
  --vp-c-text-3: #7c7970;
  --vp-c-brand-1: #f2555a;
  --vp-c-brand-2: #ff7a7e;
  --vp-c-brand-soft: rgba(242, 85, 90, 0.12);
  --vp-c-border: #2b2b27;
  --vp-c-divider: #242421;
  --vp-code-color: #fca5a5;
  --vp-code-bg: rgba(242, 85, 90, 0.12);
  --ts-red: #f2555a;
  overflow-x: clip;
  background: #101010;
  color: #f4f3ee;
}

[data-enlarge]:focus-visible {
  outline: 2px solid #f2555a;
  outline-offset: 6px;
  border-radius: 12px;
}

/* ── Cinematic hero ───────────────────────────────── */

.hero {
  position: relative;
  min-height: max(640px, 94vh);
  display: flex;
  align-items: flex-end;
  margin-top: calc(var(--vp-nav-height) * -1);
  isolation: isolate;
}

.hero__bg {
  position: absolute;
  inset: 0;
  z-index: -2;
  background: #0b0b09;
}

.hero__bg img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 68% 50%;
}

.hero::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background:
    linear-gradient(to top, rgba(10, 10, 8, 0.94) 0%, rgba(10, 10, 8, 0.55) 34%, rgba(10, 10, 8, 0.18) 62%, rgba(10, 10, 8, 0.32) 100%),
    linear-gradient(to right, rgba(10, 10, 8, 0.72) 0%, rgba(10, 10, 8, 0.25) 55%, transparent 100%);
}

.hero__inner {
  width: 100%;
  max-width: 1152px;
  margin: 0 auto;
  padding: 120px 32px 72px;
}

.hero__status {
  display: flex;
  align-items: center;
  gap: 9px;
  font-family: var(--ts-font-mono);
  font-size: 12.5px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.72);
  margin: 0 0 22px;
}

.hero__status i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 10px rgba(34, 197, 94, 0.8);
  flex: none;
}

.hero h1 {
  font-family: var(--ts-font-display);
  font-size: clamp(2.8rem, 6.4vw, 5rem);
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1.0;
  margin: 0 0 20px;
  color: #fff;
  text-wrap: balance;
}

.hero__lede {
  font-size: 1.14rem;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.78);
  max-width: 36rem;
  margin: 0 0 32px;
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 44px;
}

.btn {
  display: inline-flex;
  align-items: center;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  padding: 13px 24px;
  border-radius: 8px;
  text-decoration: none;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.btn--primary {
  background: #e82127;
  color: #fff;
  border: 1px solid #e82127;
}

.btn--primary:hover {
  background: #f04444;
  border-color: #f04444;
  color: #fff;
}

.btn--glass {
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: #fff;
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(8px);
}

.btn--glass:hover {
  border-color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.1);
}

.btn--ghost {
  border: 1px solid var(--vp-c-border);
  color: var(--vp-c-text-1);
  background: transparent;
}

.btn--ghost:hover {
  border-color: var(--vp-c-text-3);
  background: var(--vp-c-bg-alt);
}

.hero__stats {
  display: flex;
  margin: 0;
  padding: 0;
}

.hero__stats div {
  padding: 0 28px;
  border-left: 1px solid rgba(255, 255, 255, 0.16);
}

.hero__stats div:first-child {
  padding-left: 0;
  border-left: none;
}

.hero__stats dt {
  font-family: var(--ts-font-mono);
  font-size: 11.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
  margin-bottom: 4px;
}

.hero__stats dd {
  font-family: var(--ts-font-display);
  font-size: 1.7rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: #fff;
  margin: 0;
}

.hero__cue {
  position: absolute;
  right: 36px;
  bottom: 0;
  margin: 0;
  writing-mode: vertical-rl;
  font-family: var(--ts-font-mono);
  font-size: 11px;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.45);
  display: flex;
  align-items: center;
  gap: 12px;
}

.hero__cue::after {
  content: "";
  width: 1px;
  height: 64px;
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0.45), transparent);
  animation: cue 2.2s ease-in-out infinite;
}

@keyframes cue {
  0%, 100% { transform: scaleY(0.6); transform-origin: top; opacity: 0.5; }
  50% { transform: scaleY(1); transform-origin: top; opacity: 1; }
}

/* ── Sections ─────────────────────────────────────── */

.section {
  max-width: 1152px;
  margin: 0 auto;
  padding: 88px 32px 8px;
  scroll-margin-top: 72px;
}

.section h2 {
  font-family: var(--ts-font-display);
  font-size: clamp(1.9rem, 3.4vw, 2.6rem);
  font-weight: 800;
  letter-spacing: -0.03em;
  margin: 0;
  color: #f4f3ee;
}

.section__lead {
  color: #b3b0a6;
  font-size: 1.05rem;
  line-height: 1.65;
  max-width: 38rem;
  margin: 14px 0 0;
}

.section__lead code {
  font-family: var(--vp-font-family-mono);
  font-size: 0.86em;
  color: #fca5a5;
  background: rgba(242, 85, 90, 0.12);
  border-radius: 6px;
  padding: 0.15em 0.4em;
}

.section__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 8px;
}

.section__head a {
  font-size: 14.5px;
  font-weight: 600;
  color: #f2555a;
  text-decoration: none;
  white-space: nowrap;
}

.section__head a:hover {
  text-decoration: underline;
}

/* ── Steps ────────────────────────────────────────── */

.steps ol {
  list-style: none;
  margin: 24px 0 0;
  padding: 0;
}

.steps li {
  border-top: 1px solid #242421;
}

.steps li:last-child {
  border-bottom: 1px solid #242421;
}

.steps a {
  display: grid;
  grid-template-columns: 48px 180px 1fr 32px;
  gap: 20px;
  align-items: baseline;
  padding: 22px 4px;
  text-decoration: none;
  color: inherit;
}

.steps__n {
  font-family: var(--ts-font-mono);
  font-size: 13px;
  color: #f2555a;
  font-weight: 600;
}

.steps__t {
  font-size: 1.12rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #f4f3ee;
}

.steps__d {
  font-size: 0.95rem;
  color: #b3b0a6;
  line-height: 1.55;
}

.steps__arrow {
  text-align: right;
  color: #7c7970;
  transition: color 0.15s ease, transform 0.15s ease;
}

.steps a:hover .steps__t {
  color: #f2555a;
}

.steps a:hover .steps__arrow {
  color: #f2555a;
  transform: translateX(4px);
}

/* ── Splits ───────────────────────────────────────── */

.split {
  display: grid;
  grid-template-columns: 0.95fr 1.05fr;
  gap: 64px;
  align-items: center;
}

.split--flip {
  grid-template-columns: 1.05fr 0.95fr;
}

.split--flip .split__copy {
  order: 2;
}

.split--flip .split__media {
  order: 1;
}

.check {
  list-style: none;
  margin: 30px 0 0;
  padding: 0;
  display: grid;
}

.check li {
  border-top: 1px solid #242421;
}

.check li:last-child {
  border-bottom: 1px solid #242421;
}

.check a {
  display: grid;
  grid-template-columns: 1fr 24px;
  grid-template-rows: auto auto;
  gap: 4px 12px;
  padding: 18px 4px;
  text-decoration: none;
  color: inherit;
}

.check strong {
  grid-column: 1;
  grid-row: 1;
}

.check span {
  grid-column: 1;
  grid-row: 2;
}

.check a::after {
  content: "→";
  grid-column: 2;
  grid-row: 1 / 3;
  align-self: center;
  text-align: right;
  color: #7c7970;
  transition: color 0.15s ease, transform 0.15s ease;
}

.check a:hover::after {
  color: #f2555a;
  transform: translateX(4px);
}

.check strong {
  font-size: 1.02rem;
  font-weight: 700;
  letter-spacing: -0.015em;
  color: #f4f3ee;
}

.check strong.mono {
  font-family: var(--ts-font-mono);
  font-size: 0.95rem;
  font-weight: 600;
}

.check a:hover strong {
  color: #f2555a;
}

.check span {
  font-size: 0.92rem;
  color: #b3b0a6;
  line-height: 1.5;
}

.split__media {
  margin: 0;
  min-width: 0;
}

figure.split__media {
  cursor: zoom-in;
}

.split__media img {
  display: block;
  width: 100%;
  border: 1px solid #2b2b27;
  border-radius: 12px;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  object-position: top;
  transition: border-color 0.15s ease;
}

figure.split__media:hover img {
  border-color: #7c7970;
}

.split__media figcaption {
  font-family: var(--ts-font-mono);
  font-size: 12px;
  letter-spacing: 0.03em;
  color: #7c7970;
  margin-top: 10px;
}

/* ── Gallery ──────────────────────────────────────── */

.gallery__main {
  margin: 28px 0 0;
  cursor: zoom-in;
}

.gallery__main img,
.gallery__row img {
  display: block;
  width: 100%;
  border: 1px solid #2b2b27;
  border-radius: 12px;
  background: #1a1a17;
}

.gallery__main img {
  aspect-ratio: 16 / 8.2;
  object-fit: cover;
  object-position: top;
}

.gallery figure {
  margin-left: 0;
  margin-right: 0;
}

.gallery figcaption {
  font-family: var(--ts-font-mono);
  font-size: 12px;
  letter-spacing: 0.03em;
  color: #7c7970;
  margin-top: 10px;
}

.gallery__row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  margin-top: 24px;
}

.gallery__row figure {
  margin: 0;
  cursor: zoom-in;
}

.gallery__row img {
  aspect-ratio: 16 / 10;
  object-fit: cover;
  object-position: top;
  transition: border-color 0.15s ease;
}

.gallery__main img {
  transition: border-color 0.15s ease;
}

.gallery figure:hover img {
  border-color: #7c7970;
}

/* ── Pipeline ─────────────────────────────────────── */

.flow__track {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  margin: 26px 0 0;
  padding: 0;
}

.flow__track li {
  font-family: var(--ts-font-mono);
  font-size: 13px;
  font-weight: 500;
  color: #f4f3ee;
  background: #1a1a17;
  border: 1px solid #2b2b27;
  border-radius: 999px;
  padding: 8px 16px;
  white-space: nowrap;
}

.flow__track li + li {
  margin-left: 30px;
  position: relative;
}

.flow__track li + li::before {
  content: "→";
  position: absolute;
  left: -27px;
  top: 50%;
  transform: translateY(-50%);
  color: #f2555a;
  font-weight: 600;
}

.flow__track li:nth-child(4) {
  border-color: #f2555a;
  color: #f2555a;
  font-weight: 600;
}

.flow__note {
  color: #b3b0a6;
  font-size: 0.98rem;
  margin: 18px 0 0;
}

.flow__note em {
  color: #f4f3ee;
}

/* ── Cinematic band ───────────────────────────────── */

.band {
  position: relative;
  margin-top: 88px;
  isolation: isolate;
  overflow: clip;
}

.band__bg {
  position: absolute;
  inset: 0;
  z-index: -2;
  background: #0b0b09;
}

.band__bg img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 60%;
}

.band::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background:
    linear-gradient(to top, rgba(10, 10, 8, 0.9) 0%, rgba(10, 10, 8, 0.55) 50%, rgba(10, 10, 8, 0.75) 100%),
    linear-gradient(to right, rgba(10, 10, 8, 0.7) 0%, rgba(10, 10, 8, 0.2) 60%, transparent 100%);
}

.band__inner {
  max-width: 1152px;
  margin: 0 auto;
  padding: 120px 32px;
}

.band__inner h2 {
  font-size: clamp(2.2rem, 4.6vw, 3.4rem);
  line-height: 1.04;
  color: #fff;
}

.band__inner p {
  color: rgba(255, 255, 255, 0.75);
  font-size: 1.1rem;
  margin: 16px 0 30px;
}

.band .hero__actions {
  margin-bottom: 0;
}

/* ── Audiences ────────────────────────────────────── */

.ways {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.ways__panel {
  border: 1px solid #2b2b27;
  border-radius: 14px;
  padding: 30px 30px 26px;
  background: #131311;
}

.ways__panel h3 {
  font-family: var(--ts-font-display);
  font-size: 1.35rem;
  font-weight: 800;
  letter-spacing: -0.025em;
  margin: 0 0 8px;
  color: #f4f3ee;
}

.ways__panel p {
  font-size: 0.95rem;
  line-height: 1.6;
  color: #b3b0a6;
  margin: 0 0 18px;
}

.ways__panel ul {
  list-style: none;
  margin: 0;
  padding: 18px 0 0;
  border-top: 1px solid #242421;
  display: grid;
  gap: 10px;
}

.ways__panel a {
  font-size: 14.5px;
  font-weight: 600;
  color: #f4f3ee;
  text-decoration: none;
}

.ways__panel a::after {
  content: " →";
  color: #f2555a;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.ways__panel a:hover {
  color: #f2555a;
}

.ways__panel a:hover::after {
  opacity: 1;
}

/* ── Full-bleed ───────────────────────────────────── */

.bleed {
  width: 100vw;
  margin-left: calc(50% - 50vw);
}

/* ── Sitemap ──────────────────────────────────────── */

.sitemap {
  margin-top: 88px;
  border-top: 1px solid #242421;
}

.sitemap__inner {
  max-width: 1152px;
  margin: 0 auto;
  padding: 56px 32px 64px;
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 48px;
}

.sitemap__logo {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--ts-font-display);
  font-size: 17px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #f4f3ee;
  margin: 0 0 12px;
}

.sitemap__logo svg {
  width: 26px;
  height: 26px;
  border-radius: 7px;
}

.sitemap__brand > p {
  font-size: 0.92rem;
  line-height: 1.6;
  color: #7c7970;
  margin: 0 0 20px;
}

.sitemap__github {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #f4f3ee;
  text-decoration: none;
  border: 1px solid #2b2b27;
  border-radius: 8px;
  padding: 9px 16px;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.sitemap__github svg {
  width: 16px;
  height: 16px;
}

.sitemap__github:hover {
  border-color: #7c7970;
  background: #1a1a17;
}

.sitemap__cols {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 24px;
}

.sitemap__col h4 {
  font-family: var(--ts-font-mono);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #7c7970;
  margin: 0 0 14px;
}

.sitemap__col ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}

.sitemap__col a {
  font-size: 14px;
  color: #b3b0a6;
  text-decoration: none;
}

.sitemap__col a:hover {
  color: #fff;
}

/* ── Responsive ───────────────────────────────────── */

@media (max-width: 960px) {
  .hero {
    min-height: 92vh;
  }

  .hero__bg img {
    object-position: 72% 50%;
  }

  .hero__cue {
    display: none;
  }

  .split {
    grid-template-columns: 1fr;
    gap: 36px;
  }

  .split--flip .split__copy {
    order: 0;
  }

  .steps a {
    grid-template-columns: 40px 1fr 24px;
    grid-template-areas:
      "n t arrow"
      "n d arrow";
    row-gap: 4px;
  }

  .steps__n { grid-area: n; }
  .steps__t { grid-area: t; }
  .steps__d { grid-area: d; }
  .steps__arrow { grid-area: arrow; }

  .gallery__row {
    grid-template-columns: 1fr;
  }

  .ways {
    grid-template-columns: 1fr;
  }

  .sitemap__inner {
    grid-template-columns: 1fr;
    gap: 36px;
  }

  .sitemap__cols {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 560px) {
  .hero__inner {
    padding: 120px 20px 56px;
  }

  .section {
    padding: 64px 20px 8px;
  }

  .hero__stats div {
    padding: 0 16px;
  }

  .hero__stats dd {
    font-size: 1.35rem;
  }

  .band__inner {
    padding: 88px 20px;
  }

  .sitemap__inner {
    padding: 48px 20px 56px;
  }

  .flow__track li + li {
    margin-left: 22px;
  }

  .flow__track li + li::before {
    left: -19px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero__cue::after {
    animation: none;
  }
}
</style>
