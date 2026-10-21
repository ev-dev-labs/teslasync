<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'

const props = defineProps<{ source: string }>()
const svg = ref('')
const id = `mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
let generation = 0
let mounted = false

async function render() {
  const current = ++generation
  svg.value = ''
  try {
    const { default: mermaid } = await import('mermaid')
    await document.fonts.ready
    if (!mounted || current !== generation) return
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      layout: 'dagre',
      theme: 'neutral',
      themeVariables: {
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        primaryColor: '#f5f4f0',
        primaryTextColor: '#1c1917',
        primaryBorderColor: '#e82127',
        lineColor: '#78716c',
        secondaryColor: '#fafaf9',
        tertiaryColor: '#ffffff',
      },
    })
    const result = await mermaid.render(`${id}-${current}`, props.source)
    if (mounted && current === generation) svg.value = result.svg
  } catch (error) {
    // Keep the original diagram readable if a future syntax is unsupported.
    console.error('Documentation diagram could not render', error)
  }
}
onMounted(() => { mounted = true; void render() })
watch(() => props.source, () => { if (mounted) void render() })
onBeforeUnmount(() => { mounted = false; generation++ })
</script>

<template>
  <div v-if="svg" class="mermaid" v-html="svg" />
  <pre v-else class="mermaid-source"><code>{{ source }}</code></pre>
</template>
