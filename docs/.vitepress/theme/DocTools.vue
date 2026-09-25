<script setup lang="ts">
import { computed, ref } from 'vue'
import { useData } from 'vitepress'

const sources = import.meta.glob('../../**/*.md', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>

const { page } = useData()
const copied = ref(false)

const sourceLoader = computed(() => {
  const rel = page.value.relativePath.replace(/\\/g, '/')
  const key = Object.keys(sources).find((k) => k.replace(/\\/g, '/').endsWith('/' + rel) || k.endsWith(rel))
  return key ? sources[key] : null
})

const githubRaw = computed(
  () =>
    `https://raw.githubusercontent.com/ev-dev-labs/teslasync/main/docs/${page.value.relativePath.replace(/\\/g, '/')}`,
)

async function loadMarkdown(): Promise<string> {
  if (sourceLoader.value) return sourceLoader.value()
  const res = await fetch(githubRaw.value)
  if (!res.ok) throw new Error('markdown unavailable')
  return res.text()
}

async function copyForLlm() {
  const md = await loadMarkdown()
  const header = `# ${page.value.title}\n\nSource: ${page.value.relativePath}\n\n`
  await navigator.clipboard.writeText(header + md)
  copied.value = true
  window.setTimeout(() => {
    copied.value = false
  }, 1600)
}

async function viewMarkdown() {
  const md = await loadMarkdown()
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener')
}
</script>

<template>
  <div class="doc-tools" role="toolbar" aria-label="Page actions">
    <button type="button" class="doc-tools__btn" :class="{ 'is-copied': copied }" @click="copyForLlm">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <rect x="5" y="5" width="9" height="9" rx="2" />
        <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
      </svg>
      {{ copied ? 'Copied' : 'Copy for LLM' }}
    </button>
    <button type="button" class="doc-tools__btn" @click="viewMarkdown">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5z" />
        <path d="M5 6l-1.2 2L5 10M11 6l1.2 2L11 10M8.7 4.5l-1.4 7" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      View as Markdown
    </button>
  </div>
</template>
