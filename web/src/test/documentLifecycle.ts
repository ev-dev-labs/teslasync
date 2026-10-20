import { vi } from 'vitest'

/** Invoke registered lifecycle callbacks as the browser would (isTrusted=true).
 * dispatchEvent deliberately produces untrusted events, which are not navigation.
 */
export function documentLifecycleDriver() {
  const add = vi.spyOn(window, 'addEventListener')
  return (type: 'beforeunload' | 'pagehide' | 'pageshow') => {
    const event = new Event(type, { cancelable: true })
    const trusted = new Proxy(event, {
      get(target, property) {
        if (property === 'isTrusted') return true
        const value = Reflect.get(target, property, target) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    for (const [name, listener] of add.mock.calls) {
      if (name !== type || !listener) continue
      if (typeof listener === 'function') listener.call(window, trusted)
      else listener.handleEvent(trusted)
    }
  }
}
