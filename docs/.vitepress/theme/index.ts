import DefaultTheme from 'vitepress/theme'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp() {
    if (typeof window !== 'undefined') {
      document.addEventListener('click', function (e) {
        const target = e.target as HTMLElement
        const mermaid = target.closest('.mermaid') as HTMLElement
        const img = target.closest('.vp-doc img') as HTMLImageElement

        const el = mermaid || img
        if (!el) return
        if (el.closest('.diagram-overlay')) {
          el.closest('.diagram-overlay')!.remove()
          return
        }

        const overlay = document.createElement('div')
        overlay.className = 'diagram-overlay'
        overlay.style.cssText = `
          position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;
          background:rgba(0,0,0,0.9);backdrop-filter:blur(12px);
          display:flex;align-items:center;justify-content:center;
          cursor:zoom-out;padding:20px;flex-direction:column;
        `

        const wrapper = document.createElement('div')
        wrapper.style.cssText = `
          background:var(--vp-c-bg, #0a0a1a);border-radius:16px;padding:32px;
          box-shadow:0 24px 80px rgba(0,0,0,0.6);
          max-width:95vw;max-height:85vh;overflow:auto;
          display:flex;align-items:center;justify-content:center;
        `

        if (mermaid) {
          const svg = mermaid.querySelector('svg')
          if (svg) {
            const clone = svg.cloneNode(true) as SVGElement
            clone.removeAttribute('width')
            clone.removeAttribute('height')
            clone.style.cssText = 'width:90vw;height:auto;max-height:80vh;display:block;'
            const vb = svg.getAttribute('viewBox')
            if (!vb) {
              const bb = svg.getBoundingClientRect()
              clone.setAttribute('viewBox', `0 0 ${bb.width} ${bb.height}`)
            }
            wrapper.appendChild(clone)
          } else {
            const clone = mermaid.cloneNode(true) as HTMLElement
            clone.style.cssText = 'transform:scale(2);transform-origin:center;'
            wrapper.appendChild(clone)
          }
        } else if (img) {
          const clone = document.createElement('img')
          clone.src = img.src
          clone.alt = img.alt || ''
          clone.style.cssText = 'max-width:90vw;max-height:80vh;object-fit:contain;display:block;'
          wrapper.appendChild(clone)
        }

        const hint = document.createElement('div')
        hint.textContent = '✕ Click anywhere or press Esc to close'
        hint.style.cssText = `
          color:rgba(255,255,255,0.5);font-size:13px;
          margin-top:16px;text-align:center;
        `

        overlay.appendChild(wrapper)
        overlay.appendChild(hint)
        overlay.addEventListener('click', function (ev) {
          if (ev.target === overlay || ev.target === hint) overlay.remove()
        })
        document.addEventListener('keydown', function handler(ev) {
          if (ev.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', handler) }
        })
        document.body.appendChild(overlay)
      })
    }
  },
}
