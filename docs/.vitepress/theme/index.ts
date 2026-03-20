import DefaultTheme from 'vitepress/theme'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp() {
    if (typeof window !== 'undefined') {
      // Click-to-enlarge for Mermaid diagrams and images
      document.addEventListener('click', function (e) {
        const target = e.target as HTMLElement
        const mermaid = target.closest('.mermaid') as HTMLElement
        const img = target.closest('.vp-doc img') as HTMLImageElement

        const el = mermaid || img
        if (!el) return

        // If already in overlay, close it
        if (el.closest('.diagram-overlay')) {
          el.closest('.diagram-overlay')!.remove()
          return
        }

        const overlay = document.createElement('div')
        overlay.className = 'diagram-overlay'
        overlay.style.cssText = `
          position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;
          background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);
          display:flex;align-items:center;justify-content:center;
          cursor:zoom-out;padding:24px;
        `
        const clone = el.cloneNode(true) as HTMLElement
        clone.style.cssText = `
          max-width:95vw;max-height:90vh;overflow:auto;
          background:var(--vp-c-bg);border-radius:12px;padding:24px;
          box-shadow:0 24px 80px rgba(0,0,0,0.5);
        `
        if (clone instanceof HTMLImageElement) {
          clone.style.maxWidth = '95vw'
          clone.style.maxHeight = '85vh'
          clone.style.objectFit = 'contain'
          clone.style.padding = '0'
        }
        // Close hint
        const hint = document.createElement('div')
        hint.textContent = 'Click anywhere or press Esc to close'
        hint.style.cssText = `
          position:absolute;top:16px;right:24px;
          color:rgba(255,255,255,0.6);font-size:13px;
        `
        overlay.appendChild(clone)
        overlay.appendChild(hint)
        overlay.addEventListener('click', function () { overlay.remove() })
        document.addEventListener('keydown', function handler(ev) {
          if (ev.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', handler) }
        })
        document.body.appendChild(overlay)
      })
    }
  },
}
