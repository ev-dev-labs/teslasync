export interface PageContext {
  path: string
  title: string
  text: string
}

export function capturePageContext(doc: Document, path: string): PageContext {
  const main = doc.getElementById('main-content')
  return {
    path: path.slice(0, 256),
    title: doc.title.slice(0, 160),
    // innerText excludes CSS-hidden content and form values; never serialize HTML.
    text: (main?.innerText ?? '').trim().slice(0, 2000),
  }
}
