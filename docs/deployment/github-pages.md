# GitHub Pages Docs Deployment

The documentation site is built with VitePress from the `docs/` directory.

## Local build

```bash
cd docs
npm install
npm run docs:build
```

The static output is written to `docs/.vitepress/dist`.

## Base path

The VitePress config currently uses:

```ts
base: '/teslasync/'
```

That is appropriate for GitHub Pages project hosting such as:

```text
https://ev-dev-labs.github.io/teslasync/
```

If you deploy docs at a custom domain root, change the base path accordingly.

## Assets and formatting

The docs theme includes:

- custom CSS from `.vitepress/theme/custom.css`
- clickable Mermaid/image zoom overlay in `.vitepress/theme/index.ts`
- animated homepage SVG in `docs/index.md`
- static assets under `docs/public`

Keep those pieces when rewriting docs content.

## CI outline

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20
- run: npm ci
  working-directory: docs
- run: npm run docs:build
  working-directory: docs
```

Publish `docs/.vitepress/dist` to Pages or your static host.