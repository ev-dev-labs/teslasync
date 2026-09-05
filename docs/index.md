---
layout: page
title: TeslaSync — Your Tesla has a story. Own it.
description: Open-source Tesla intelligence on your infrastructure. Start with installation, connect your vehicle, and explore your driving and charging history.
---

<div class="ts-home">
<section class="ts-tile ts-hero">
  <div class="ts-hero-orb ts-hero-orb-1" aria-hidden="true"></div>
  <div class="ts-hero-orb ts-hero-orb-2" aria-hidden="true"></div>
  <div class="ts-tile-inner ts-center">
    <p class="ts-eyebrow">TeslaSync</p>
    <h1 class="ts-title">
      <span class="ts-line">Your Tesla</span>
      <span class="ts-line">has a story.</span>
      <span class="ts-line ts-shimmer">Own it.</span>
    </h1>
    <p class="ts-subtitle">Open-source Tesla intelligence, on your infrastructure. Turn vehicle data into driving insights, charging history, battery trends, and useful automations.</p>
    <p class="ts-cta-row">
      <a class="ts-pill ts-pill-primary" href="/teslasync/guide/getting-started">Get started <span class="ts-chev">›</span></a>
      <a class="ts-pill ts-pill-ghost" href="/teslasync/features/vehicle-tracking">Explore the features <span class="ts-chev">›</span></a>
    </p>
    <div class="ts-hero-preview">
      <img src="/screenshots/dashboard.png" alt="TeslaSync dashboard with vehicle navigation and customizable widgets" loading="eager" decoding="async" />
    </div>
  </div>
</section>

<section class="ts-tile ts-dark" id="start">
  <div class="ts-tile-inner ts-center">
    <p class="ts-eyebrow">Start here</p>
    <h2 class="ts-title-xl">From installation<br/>to your first insight.</h2>
    <p class="ts-subtitle">Install with Docker Compose, connect your Tesla account in Settings → Fleet Setup, then confirm data arrives from your selected vehicle. Streaming needs a separate receiver, public TLS, and Tesla-side setup; starting containers is only the first step.</p>
    <p class="ts-cta-row">
      <a class="ts-link" href="/teslasync/guide/getting-started">1. Install TeslaSync <span class="ts-chev">›</span></a>
      <a class="ts-link" href="/teslasync/guide/tesla-fleet-api">2. Connect to Tesla <span class="ts-chev">›</span></a>
      <a class="ts-link" href="/teslasync/guide/fleet-telemetry">3. Enable streaming <span class="ts-chev">›</span></a>
    </p>
    <p class="ts-subtitle">A local trial is not a public deployment. Review authentication, TLS, secrets, and backups before exposing your installation.</p>
    <p class="ts-cta-row">
      <a class="ts-link" href="/teslasync/deployment/docker">Deployment checklist <span class="ts-chev">›</span></a>
      <a class="ts-link" href="/teslasync/guide/faq">Requirements &amp; FAQ <span class="ts-chev">›</span></a>
    </p>
  </div>
</section>

<section class="ts-tile ts-mid">
  <div class="ts-tile-inner ts-center">
    <p class="ts-eyebrow">Driving &amp; charging</p>
    <h2 class="ts-title-xl ts-grad-history">Make sense of<br/>the miles between.</h2>
    <p class="ts-subtitle">Explore recorded drives, replay routes, compare charging sessions, and follow energy use over time. Available detail depends on your vehicle, permissions, configured signals, and the data actually received.</p>
    <div class="ts-screenshot-duo">
      <figure><img src="/screenshots/drive-detail.png" alt="Recorded drive with route and driving statistics" loading="lazy" /><figcaption>Understand a drive</figcaption></figure>
      <figure><img src="/screenshots/charging-detail.png" alt="Charging session with battery and charging statistics" loading="lazy" /><figcaption>Review a charging session</figcaption></figure>
    </div>
    <p class="ts-cta-row">
      <a class="ts-link" href="/teslasync/features/vehicle-tracking">Vehicle history <span class="ts-chev">›</span></a>
      <a class="ts-link" href="/teslasync/features/analytics">Analytics &amp; charts <span class="ts-chev">›</span></a>
      <a class="ts-link" href="/teslasync/features/dashboard">Build your dashboard <span class="ts-chev">›</span></a>
    </p>
  </div>
</section>

<section class="ts-tile ts-dark">
  <div class="ts-tile-inner ts-split">
    <div class="ts-split-text">
      <p class="ts-eyebrow">Alerts &amp; automations</p>
      <h2 class="ts-title-xl ts-grad-automation">Less checking.<br/>More context.</h2>
      <p class="ts-subtitle">Create alerts and automations around the vehicle events that matter to you. Review conditions and actions before enabling them, and inspect execution history. Remote-command availability depends on Tesla permissions, vehicle capability, connectivity, and signing setup.</p>
      <p class="ts-cta-row">
        <a class="ts-link" href="/teslasync/features/automations">Build an automation <span class="ts-chev">›</span></a>
        <a class="ts-link" href="/teslasync/features/alerts">Configure alerts <span class="ts-chev">›</span></a>
        <a class="ts-link" href="/teslasync/guide/remote-commands">Command prerequisites <span class="ts-chev">›</span></a>
      </p>
    </div>
    <div class="ts-split-visual"><img src="/screenshots/automation-builder.png" alt="Automation builder with triggers, conditions, and actions" loading="lazy" /></div>
  </div>
</section>

<section class="ts-tile ts-mid" id="helix">
  <div class="ts-tile-inner ts-center">
    <p class="ts-eyebrow ts-eyebrow-helix">Optional Helix AI</p>
    <h2 class="ts-title-xl">Ask questions.<br/>Explore your data.</h2>
    <p class="ts-subtitle">Helix adds fleet-aware chat, explanations, summaries, and natural-language drafting. AI features are opt-in; TeslaSync does not require an AI provider. Choose a hosted provider or local Ollama, and review generated suggestions before applying them.</p>
    <p class="ts-subtitle">Self-hosted does not mean offline. Tesla connectivity uses Tesla services, and configured external providers may receive request context and incur charges. AI output is not a substitute for vehicle diagnostics or professional advice.</p>
    <p class="ts-cta-row"><a class="ts-link" href="/teslasync/guide/helix-ai">Providers, privacy &amp; controls <span class="ts-chev">›</span></a></p>
  </div>
</section>

<section class="ts-tile ts-dark">
  <div class="ts-tile-inner ts-center">
    <p class="ts-eyebrow">Own the deployment. Join the project.</p>
    <h2 class="ts-title-xl">Keep it useful.<br/>Help make it better.</h2>
    <p class="ts-subtitle">Operate your installation with deliberate retention and tested backups. Report problems, improve a guide, or contribute code — start with the contributor walkthrough and choose a focused change.</p>
    <p class="ts-cta-row">
      <a class="ts-link" href="/teslasync/guide/configuration">Configuration <span class="ts-chev">›</span></a>
      <a class="ts-link" href="/teslasync/features/backup-restore">Backups <span class="ts-chev">›</span></a>
      <a class="ts-link" href="/teslasync/guide/troubleshooting">Troubleshooting <span class="ts-chev">›</span></a>
      <a class="ts-link" href="/teslasync/CONTRIBUTING.html">Contribute <span class="ts-chev">›</span></a>
      <a class="ts-link" href="https://github.com/ev-dev-labs/teslasync">Source on GitHub <span class="ts-chev">›</span></a>
    </p>
  </div>
</section>
</div>
