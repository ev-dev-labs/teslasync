# Deploying Docs to GitHub Pages

The TeslaSync documentation site is built with [VitePress](https://vitepress.dev/) and deployed to GitHub Pages using GitHub Actions.

## How It Works

1. A push to `main` that modifies files in the `docs/` directory triggers the workflow.
2. GitHub Actions builds the VitePress site.
3. The built static files are deployed to GitHub Pages.
4. The docs are available at `https://ev-dev-labs.github.io/TeslaSync/`.

## GitHub Actions Workflow

The deployment is automated via `.github/workflows/docs.yml`:

```yaml
name: Deploy Docs to GitHub Pages

on:
  push:
    branches: [main]
    paths:
      - 'docs/**'

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pages: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: docs/package-lock.json
      - run: cd docs && npm ci && npm run docs:build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: docs/.vitepress/dist
      - uses: actions/deploy-pages@v4
```

## Manual Deployment

You can also build and deploy the docs manually.

### Build Locally

```bash
cd docs
npm install
npm run docs:build
```

The built site is output to `docs/.vitepress/dist/`.

### Preview Locally

```bash
cd docs
npm run docs:dev
```

This starts a local dev server at `http://localhost:5173/TeslaSync/` with hot reload.

### Preview the Production Build

```bash
cd docs
npm run docs:build
npm run docs:preview
```

## Setting Up GitHub Pages

### 1. Enable GitHub Pages

1. Go to your repository **Settings** → **Pages**.
2. Under **Build and deployment**, select **GitHub Actions** as the source.
3. The workflow will handle deployments automatically.

### 2. Configure the Base Path

The VitePress config (`docs/.vitepress/config.ts`) sets the base path:

```ts
export default defineConfig({
  base: '/TeslaSync/',
  // ...
})
```

This ensures all assets and links work correctly when served from `https://ev-dev-labs.github.io/TeslaSync/`.

::: tip Custom Domain
If you're using a custom domain (e.g., `docs.teslasync.com`), set `base: '/'` and configure the domain in your GitHub Pages settings.
:::

### 3. Verify the Deployment

After pushing changes to `docs/`:

1. Go to the **Actions** tab in your repository.
2. Find the "Deploy Docs" workflow run.
3. Once it completes, visit `https://ev-dev-labs.github.io/TeslaSync/`.

## Adding New Pages

1. Create a new `.md` file in the appropriate directory under `docs/`.
2. Add the page to the sidebar in `docs/.vitepress/config.ts`.
3. Write your content using standard Markdown + VitePress extensions.
4. Commit and push — the docs will deploy automatically.

### VitePress Markdown Features

VitePress supports several extensions beyond standard Markdown:

**Custom containers:**

```md
::: info
This is an informational note.
:::

::: tip
This is a helpful tip.
:::

::: warning
This is a warning.
:::

::: danger
This is a dangerous action.
:::
```

**Code groups:**

````md
::: code-group
```bash [npm]
npm install
```
```bash [yarn]
yarn install
```
```bash [pnpm]
pnpm install
```
:::
````

**Line highlighting in code blocks:**

````md
```ts{2,4-5}
const config = {
  title: 'TeslaSync',  // highlighted
  description: 'Docs',
  base: '/TeslaSync/',  // highlighted
  themeConfig: {},       // highlighted
}
```
````

## Troubleshooting

### Build Fails

```bash
# Check for errors locally
cd docs
npm run docs:build

# Common issues:
# - Broken links between pages
# - Missing frontmatter
# - Invalid config.ts syntax
```

### Pages Not Updating

1. Check the Actions tab for workflow failures.
2. Ensure the workflow has `pages: write` and `id-token: write` permissions.
3. Verify GitHub Pages is set to deploy from **GitHub Actions** (not a branch).

### 404 on Subpages

Ensure the `base` option in `config.ts` matches your repository name:

```ts
// For https://ev-dev-labs.github.io/TeslaSync/
base: '/TeslaSync/'

// For a custom domain like docs.teslasync.com
base: '/'
```
