import { describe, expect, it } from 'vitest'
import { capturePageContext } from './pageContext'

describe('capturePageContext', () => {
  it('captures only visible main text, without form values or unrelated chrome', () => {
    document.body.innerHTML = '<main id="main-content"><h1>Drives</h1><p>12 km</p><input value="private entry"></main><aside>Other panel</aside>'
    Object.defineProperty(document.getElementById('main-content'), 'innerText', {
      configurable: true,
      value: 'Drives\n12 km',
    })
    document.title = 'TeslaSync | Drives'
    expect(capturePageContext(document, '/drives')).toEqual({
      path: '/drives',
      title: 'TeslaSync | Drives',
      text: 'Drives\n12 km',
    })
  })

  it('bounds the snapshot and handles routes without main content', () => {
    document.body.innerHTML = ''
    expect(capturePageContext(document, '/drives').text).toBe('')
    document.body.innerHTML = '<main id="main-content"></main>'
    Object.defineProperty(document.getElementById('main-content'), 'innerText', {
      configurable: true,
      value: 'x'.repeat(9000),
    })
    expect(capturePageContext(document, '/drives').text).toHaveLength(2000)
  })
})
