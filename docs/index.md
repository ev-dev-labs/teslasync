---
layout: home
title: TeslaSync
description: Self-hosted Tesla intelligence. Own every drive and charge — on your iron.
hero:
  name: TeslaSync
  text: Stop renting the story of your own car.
  tagline: Fleet Telemetry on your MQTT. SI in your Timescale. 213 screens, zero SaaS tax. If you can docker compose, you can ship this tonight.
  actions:
    - theme: brand
      text: Get started
      link: /get-started
    - theme: alt
      text: docker compose up
      link: /guide/getting-started
    - theme: alt
      text: Feature catalogue
      link: /features/catalogue
features:
  - title: Race your yesterday
    details: Ghost Racing, FSD mix, route replay. The car already logged it — we just refuse to throw it away.
    link: /features/catalogue-driving
    linkText: Driving
  - title: Bills that can't gaslight you
    details: Session kWh vs Tesla receipts. Wait Oracle from your Supercharger history, not a crowded-lot rumor.
    link: /features/catalogue-charging
    linkText: Charging
  - title: YAML is the product
    details: Compose or Helm. One ingest pipeline. Meters, watts, seconds on disk. Display units are a UI problem — as it should be.
    link: /deployment/docker
    linkText: Deploy
  - title: Automate, then sleep
    details: 40+ rule templates, geofence routines, Comfort calendars. History before a remote command. Homelab, not a pager.
    link: /features/automations
    linkText: Automations
---

<div class="mkt-docs">

## Docs that assume you can read a compose file

<div class="docs-card-grid">
<a class="docs-card" href="/teslasync/get-started">
<strong>Get started</strong>
<span>Install, connect Tesla, enable streaming, then open the catalogue.</span>
</a>
<a class="docs-card" href="/teslasync/guide/tesla-fleet-api">
<strong>Connect Tesla</strong>
<span>Fleet API application, scopes, redirect URI, owner consent.</span>
</a>
<a class="docs-card" href="/teslasync/guide/fleet-telemetry">
<strong>Enable streaming</strong>
<span>Fleet Telemetry receiver, TLS, virtual key, signed config.</span>
</a>
<a class="docs-card" href="/teslasync/features/catalogue">
<strong>Find a screen</strong>
<span>213 routes grouped like the app sidebar.</span>
</a>
<a class="docs-card" href="/teslasync/deployment/docker">
<strong>Docker</strong>
<span>Compose, ports, secrets, local trial vs public host.</span>
</a>
<a class="docs-card" href="/teslasync/operations/release-verification">
<strong>Operate</strong>
<span>Release verification, secrets, Fleet API budget.</span>
</a>
</div>

</div>
