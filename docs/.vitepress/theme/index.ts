import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import './theme.css'
import DocTools from './DocTools.vue'
import HomePage from './home/HomePage.vue'

function installConsoleNote() {
  // eslint-disable-next-line no-console
  console.log(
    '%cTeslaSync%c  If you are reading this, clone the repo and grep ProcessAtomics. There is only one ingest.',
    'background:#e82127;color:#fff;padding:2px 8px;border-radius:4px;font-weight:700',
    'color:#78716c;padding-left:8px',
  )
}

/** Click (or Enter on) a mermaid diagram or image to inspect it large. */
function installDiagramOverlay() {
  let opener: HTMLElement | null = null

  function close(overlay: HTMLElement) {
    overlay.remove()
    if (opener) {
      opener.focus({ preventScroll: true })
      opener = null
    }
  }

  function open(el: HTMLElement) {
    if (el.closest('.diagram-overlay')) {
      el.closest('.diagram-overlay')!.remove()
      return
    }
    opener = el
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        close(overlay)
        document.removeEventListener('keydown', onKey)
      }
    }
    const overlay = document.createElement('div')
    overlay.className = 'diagram-overlay'
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.setAttribute('aria-label', 'Enlarged diagram')
    overlay.addEventListener('click', () => {
      close(overlay)
      document.removeEventListener('keydown', onKey)
    })
    document.addEventListener('keydown', onKey)
    const mermaid = el.classList.contains('mermaid') ? el : null
    const shot = el.hasAttribute('data-enlarge') ? el : null
    if (mermaid) {
      const svg = mermaid.querySelector('svg')
      overlay.appendChild((svg ?? mermaid).cloneNode(true))
    } else {
      const source = shot ? shot.querySelector('img') : (el as HTMLImageElement)
      if (source) {
        const clone = document.createElement('img')
        clone.src = source.currentSrc || source.src
        clone.alt = source.alt || ''
        overlay.appendChild(clone)
      }
    }
    document.body.appendChild(overlay)
  }

  function targetFrom(node: HTMLElement): HTMLElement | null {
    return node.closest('.mermaid, [data-enlarge], .vp-doc img') as HTMLElement | null
  }

  document.addEventListener('click', (e) => {
    const el = targetFrom(e.target as HTMLElement)
    if (el) open(el)
  })

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const el = targetFrom(e.target as HTMLElement)
    if (!el || el.closest('.diagram-overlay')) return
    e.preventDefault()
    open(el)
  })

  // Mermaid nodes render async: make them keyboard-focusable when they land.
  const tag = () => {
    document.querySelectorAll('.mermaid:not([tabindex])').forEach((node) => {
      node.setAttribute('tabindex', '0')
      node.setAttribute('role', 'button')
      node.setAttribute('aria-label', 'Enlarge diagram')
    })
  }
  tag()
  new MutationObserver(tag).observe(document.documentElement, { childList: true, subtree: true })
}

/** Thin scroll-progress hairline on doc pages. Pure scroll listener. */
function installScrollProgress() {
  const bar = document.createElement('div')
  bar.id = 'ts-progress'
  bar.setAttribute('aria-hidden', 'true')
  document.body.appendChild(bar)
  let ticking = false
  const update = () => {
    ticking = false
    const doc = document.querySelector('.VPDoc')
    if (!doc) {
      bar.style.opacity = '0'
      return
    }
    const max = document.documentElement.scrollHeight - window.innerHeight
    const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
    bar.style.opacity = ratio > 0.02 ? '1' : '0'
    bar.style.transform = `scaleX(${ratio})`
  }
  window.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        ticking = true
        requestAnimationFrame(update)
      }
    },
    { passive: true },
  )
  update()
}

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'doc-before': () => h(DocTools),
    })
  },
  enhanceApp({ app }: { app: { component: (name: string, comp: unknown) => void } }) {
    app.component('HomePage', HomePage)
    if (typeof window === 'undefined') return
    installConsoleNote()
    installDiagramOverlay()
    installScrollProgress()
  },
}
