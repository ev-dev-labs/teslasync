import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import './stripe.css'
import DocTools from './DocTools.vue'
import HomeShowcase from './HomeShowcase.vue'

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'doc-before': () => h(DocTools),
      'home-features-after': () => h(HomeShowcase),
    })
  },
  enhanceApp() {
    if (typeof window === 'undefined') return
    // eslint-disable-next-line no-console
    console.log(
      '%cTeslaSync%c  If you are reading this, clone the repo and grep ProcessAtomics. There is only one ingest.',
      'background:#0a5cff;color:#fff;padding:2px 8px;border-radius:4px;font-weight:700',
      'color:#425466;padding-left:8px',
    )
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement
      const mermaid = target.closest('.mermaid') as HTMLElement | null
      const img = target.closest('.vp-doc img') as HTMLImageElement | null
      const el = mermaid || img
      if (!el) return
      if (el.closest('.diagram-overlay')) {
        el.closest('.diagram-overlay')!.remove()
        return
      }
      const overlay = document.createElement('div')
      overlay.className = 'diagram-overlay'
      overlay.addEventListener('click', () => overlay.remove())
      if (mermaid) {
        const svg = mermaid.querySelector('svg')
        overlay.appendChild((svg ?? mermaid).cloneNode(true))
      } else if (img) {
        const clone = document.createElement('img')
        clone.src = img.src
        clone.alt = img.alt || ''
        overlay.appendChild(clone)
      }
      document.body.appendChild(overlay)
    })
  },
}
