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
    <button type="button" class="doc-tools__btn" @click="copyForLlm">
      {{ copied ? 'Copied' : 'Copy for LLM' }}
    </button>
    <button type="button" class="doc-tools__btn" @click="viewMarkdown">
      View as Markdown
    </button>
  </div>
</template>
