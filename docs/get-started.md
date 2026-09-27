---
title: Get started
description: Install TeslaSync, connect Tesla, enable streaming, then find any screen in the app.
---

<script setup>
import { withBase } from 'vitepress'
</script>

<p class="docs-kicker">TeslaSync documentation</p>

# Get started

Self-hosted Tesla intelligence. Install it, connect a vehicle, then use the catalogue to find every screen.

<div class="docs-card-grid">
<a class="docs-card" :href="withBase('/guide/getting-started')">
<strong>1. Install</strong>
<span>Docker Compose on a trusted host. No Go or Node required for a trial.</span>
</a>
<a class="docs-card" :href="withBase('/guide/tesla-fleet-api')">
<strong>2. Connect Tesla</strong>
<span>Fleet API application, scopes, redirect URI, and owner consent.</span>
</a>
<a class="docs-card" :href="withBase('/guide/fleet-telemetry')">
<strong>3. Enable streaming</strong>
<span>Fleet Telemetry receiver, TLS, virtual key, and signed config.</span>
</a>
<a class="docs-card" :href="withBase('/features/catalogue')">
<strong>4. Find a screen</strong>
<span>Every route grouped like the app sidebar, with empty-state notes.</span>
</a>
</div>

## Common paths

<div class="docs-card-grid">
<a class="docs-card" :href="withBase('/deployment/docker')">
<strong>Deploy with Docker</strong>
<span>Compose, ports, secrets, and a local trial vs a public host.</span>
</a>
<a class="docs-card" :href="withBase('/deployment/kubernetes')">
<strong>Deploy with Kubernetes</strong>
<span>Helm chart, values, and homelab-sized recovery.</span>
</a>
<a class="docs-card" :href="withBase('/guide/configuration')">
<strong>Configuration</strong>
<span>Environment variables that must stay in sync across Compose and Helm.</span>
</a>
<a class="docs-card" :href="withBase('/guide/troubleshooting')">
<strong>Troubleshooting</strong>
<span>No data, MQTT, auth, and telemetry gaps.</span>
</a>
<a class="docs-card" :href="withBase('/features/catalogue-charging')">
<strong>Charging in the app</strong>
<span>Sessions, Tesla billing history, Wait Oracle, curves.</span>
</a>
<a class="docs-card" :href="withBase('/features/catalogue-driving')">
<strong>Driving in the app</strong>
<span>Drives, FSD, trips, Ghost Racing, drive detail.</span>
</a>
</div>

## Operate and contribute

<div class="docs-card-grid">
<a class="docs-card" :href="withBase('/operations/release-verification')">
<strong>Release verification</strong>
<span>What to check before you roll a build.</span>
</a>
<a class="docs-card" :href="withBase('/operations/secret-management')">
<strong>Secrets</strong>
<span>Tokens, encryption, and rotation.</span>
</a>
<a class="docs-card" :href="withBase('/CONTRIBUTING')">
<strong>Contribute</strong>
<span>Code structure, adding features, API notes.</span>
</a>
<a class="docs-card" :href="withBase('/guide/faq')">
<strong>FAQ</strong>
<span>Requirements, Tesla constraints, what we do not promise.</span>
</a>
</div>

::: warning Before you expose anything
A local trial is not a public deployment. Add TLS, an authenticating proxy, strong secrets, and backups before you expose the API.
:::

## See also

- [Architecture](/guide/architecture)
- [Feature catalogue](/features/catalogue)
- [Remote commands](/guide/remote-commands)
- [Local development](/guide/local-development)
