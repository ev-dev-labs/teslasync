export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })

      // Check for updates periodically (every 60 minutes)
      setInterval(() => registration.update(), 60 * 60 * 1000)

      // Detect waiting worker (new version available)
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing
        if (!newWorker) return
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New version available — dispatch custom event for UI
            window.dispatchEvent(new CustomEvent('sw-update-available', { detail: { registration } }))
          }
        })
      })

      // Handle controller change (after skip-waiting) — reload
      let refreshing = false
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return
        refreshing = true
        window.location.reload()
      })
    } catch (err) {
      console.error('SW registration failed:', err)
    }
  })
}
