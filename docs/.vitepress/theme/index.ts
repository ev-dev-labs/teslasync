import DefaultTheme from 'vitepress/theme'
import './custom.css'

let homeObserver: MutationObserver | null = null
const wiredCounters = new WeakSet<Element>()
const wiredCells = new WeakSet<Element>()
let wiredHero = false
let countIO: IntersectionObserver | null = null

function ensureCountObserver(reduce: boolean): IntersectionObserver {
  if (countIO) return countIO
  countIO = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      const el = entry.target as HTMLElement
      if (el.dataset.counted === '1') return
      el.dataset.counted = '1'
      const target = parseInt(el.dataset.count || '0', 10)
      const suffix = el.dataset.suffix || ''
      if (reduce || !Number.isFinite(target) || target <= 0) {
        el.textContent = target + suffix
        countIO!.unobserve(el)
        return
      }
      const duration = Math.min(1600, 600 + target * 6)
      const start = performance.now()
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration)
        const eased = 1 - Math.pow(1 - t, 3)
        const value = Math.round(target * eased)
        el.textContent = value + suffix
        if (t < 1) requestAnimationFrame(step)
        else {
          el.textContent = target + suffix
          countIO!.unobserve(el)
        }
      }
      requestAnimationFrame(step)
    })
  }, { threshold: 0.25, rootMargin: '0px 0px -10% 0px' })
  return countIO
}

function wireHomeNodes() {
  if (!document.querySelector('.ts-home')) return false

  document.body.classList.add('ts-home-active')

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const hero = document.querySelector('.ts-home .ts-hero') as HTMLElement | null
  if (hero && !wiredHero) {
    wiredHero = true
    const onMove = (e: PointerEvent) => {
      const rect = hero.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * 100
      const y = ((e.clientY - rect.top) / rect.height) * 100
      hero.style.setProperty('--mx', x + '%')
      hero.style.setProperty('--my', y + '%')
    }
    const onLeave = () => {
      hero.style.setProperty('--mx', '50%')
      hero.style.setProperty('--my', '40%')
    }
    hero.addEventListener('pointermove', onMove)
    hero.addEventListener('pointerleave', onLeave)
  }

  const io = ensureCountObserver(reduce)
  const counters = document.querySelectorAll<HTMLElement>('.ts-home .ts-stat-num[data-count], .ts-home .ts-hero-kpi-num[data-count]')
  counters.forEach((c) => {
    if (wiredCounters.has(c)) return
    wiredCounters.add(c)
    io.observe(c)
  })

  const stackCells = document.querySelectorAll<HTMLElement>('.ts-home .ts-stack-cell')
  stackCells.forEach((cell) => {
    if (wiredCells.has(cell)) return
    wiredCells.add(cell)
    cell.addEventListener('pointermove', (e) => {
      const rect = cell.getBoundingClientRect()
      cell.style.setProperty('--cx', ((e.clientX - rect.left) / rect.width * 100) + '%')
      cell.style.setProperty('--cy', ((e.clientY - rect.top) / rect.height * 100) + '%')
    })
  })

  return counters.length > 0 || !!hero
}

function initHomeAnimations() {
  wireHomeNodes()

  if (homeObserver) homeObserver.disconnect()
  homeObserver = new MutationObserver(() => {
    wireHomeNodes()
  })
  homeObserver.observe(document.body, { childList: true, subtree: true })

  // Belt-and-braces retries in case the markdown hydrates after enhanceApp.
  let tries = 0
  const retry = () => {
    tries += 1
    wireHomeNodes()
    if (tries < 10) setTimeout(retry, 200)
  }
  setTimeout(retry, 100)
}

function teardownHomeAnimations() {
  document.body.classList.remove('ts-home-active')
  if (homeObserver) {
    homeObserver.disconnect()
    homeObserver = null
  }
  if (countIO) {
    countIO.disconnect()
    countIO = null
  }
  wiredHero = false
}

export default {
  extends: DefaultTheme,
  enhanceApp({ router }: { router: any }) {
    if (typeof window === 'undefined') return

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

    const tryInit = () => {
      if (document.querySelector('.ts-home')) {
        initHomeAnimations()
      } else {
        teardownHomeAnimations()
      }
    }
    tryInit()
    if (router) {
      const prev = router.onAfterRouteChanged
      router.onAfterRouteChanged = (to: any) => {
        try { prev && prev(to) } catch (_) {}
        setTimeout(tryInit, 50)
      }
    }
  },
}
