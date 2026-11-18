import type { KeyboardEvent } from 'react'

export function menuItems(pane: HTMLElement | null) {
  return Array.from(pane?.querySelectorAll<HTMLElement>('[data-nav-choice]') ?? [])
}

export function inlineKeys(element: HTMLElement) {
  return getComputedStyle(element).direction === 'rtl'
    ? { forward: 'ArrowLeft', back: 'ArrowRight' }
    : { forward: 'ArrowRight', back: 'ArrowLeft' }
}

export function handleMenuVertical(event: KeyboardEvent<HTMLElement>, columns = 1) {
  const items = menuItems(event.currentTarget)
  const index = items.indexOf(event.target as HTMLElement)
  if (index < 0) return false
  const key = event.key
  const next = key === 'Home' ? 0 : key === 'End' ? items.length - 1
    : key === 'ArrowDown' ? (index + columns < items.length ? index + columns : index % columns)
    : key === 'ArrowUp' ? (index >= columns ? index - columns : index + columns * Math.floor((items.length - 1 - index) / columns))
    : -1
  if (next < 0) return false
  event.preventDefault()
  items[next]?.focus()
  return true
}
