# Deploying the docs to GitHub Pages

The TeslaSync user docs are a [VitePress](https://vitepress.dev) site under `docs/`. The published site at `ev-dev-labs.github.io/teslasync` is a build artefact, not something you edit on the live server. This page describes how that pipeline works end to end so you can preview locally, ship safely, and debug when it breaks.

## What you're publishing

Only the **user-facing docs** ship. Internal-only material — audits, runbooks, observability notes, architecture ADRs, signal audits, dev guidelines like `A11Y_GUIDELINES.md` — stays in the repo for contributors but is excluded from the built site.

The exclusion list lives in `docs/.vitepress/config.ts` under `srcExclude`. Anything matched there is skipped during build. If you add a new internal-only doc, add it to the list. If you want a previously-internal doc to be published, remove it from the list **and** verify it renders cleanly (some internal docs contain Vue-interpolation-confusing characters that need escaping for VitePress to parse them).

## Preview locally

```bash
cd docs
npm install
npm run docs:dev
```

VitePress watches the markdown files and reloads instantly on save. The dev server is at `http://localhost:5173` (port may shift if 5173 is busy).

Build a production bundle locally before pushing if you've made structural changes:

```bash
npm run docs:build
```

This runs the same code path as CI. If it succeeds locally, it succeeds on GitHub Actions.

Preview the production bundle:

```bash
npm run docs:preview
```

This serves `docs/.vitepress/dist` at `http://localhost:4173`. Use this to verify the production base path and asset URLs work — that's where the most common Pages-specific bugs show up.

## How the production build differs from dev

VitePress builds for a specific base path. The site is deployed at `https://ev-dev-labs.github.io/teslasync/`, not the root of a domain, so every asset URL needs the `/teslasync/` prefix.

`docs/.vitepress/config.ts` sets:

```ts
base: '/teslasync/',
```

If you change the repo name or fork to a different org, change this value to match. A wrong base path produces a site that loads `index.html` but 404s on every JS, CSS, and image asset.

## What ships in `dist`

After a build:

```
docs/.vitepress/dist/
├── assets/             # hashed JS, CSS, fonts
├── images/             # static images from docs/public/images
├── logo.svg            # static asset from docs/public
├── index.html          # generated home
├── guide/              # generated per-page HTML
├── features/
├── deployment/
├── contributing/
└── 404.html
```

Anything in `docs/public/` is copied verbatim to the root of `dist`. Anything in `docs/.vitepress/theme/` participates in the VitePress build pipeline. Don't put runtime-fetched data in `docs/` — the docs are static.

## The CI pipeline

The workflow lives in `.github/workflows/docs.yml`. The shape is:

1. Trigger on push to `main` (the published branch) and on pull request (for preview-checks only — pull requests do not deploy).
2. Set up Node.
3. `cd docs && npm ci`.
4. `npm run docs:build`.
5. Upload `docs/.vitepress/dist` as a Pages artefact.
6. Deploy the artefact to the `github-pages` environment.

The repo's Pages settings (Settings → Pages in GitHub) must be configured to deploy from **GitHub Actions**, not from a branch. Branch-based Pages is the legacy mode and will fight the workflow.

## Triggering a deploy

A deploy happens when:

- Anyone merges to `main` with changes under `docs/`
- A maintainer manually re-runs the workflow from the Actions tab (e.g., to re-publish after a Pages settings change)

Pull requests do not deploy. They run the build for verification but don't push anything. This is intentional — preview deployments for every PR would generate a lot of noise and consume a lot of build minutes.

## Custom domain

If you're forking and want to publish on a custom domain:

1. Create a `CNAME` file in `docs/public/` containing your domain (e.g., `docs.example.com`).
2. Update `base` in `docs/.vitepress/config.ts` to `/` (custom domains serve from the root).
3. Configure your DNS provider with the CNAME / A records GitHub Pages requires.
4. Add the custom domain in Settings → Pages and wait for the TLS certificate to provision (a few minutes).

The bundled `CNAME` keeps GitHub Pages from clearing your custom-domain setting on every deploy.

## Theme overrides

VitePress uses Vue Single-File Components for theme customisation. `docs/.vitepress/theme/` is the override directory. We currently use the default theme with a small amount of CSS tuning; if you add component overrides, keep them additive — extend the default theme rather than replacing it, so future VitePress upgrades don't break your customisations.

## Common things that go wrong

| Symptom                                              | Likely cause                                              | Fix                                                       |
| ---------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------- |
| Build fails with `Element is missing end tag`        | A markdown file has Vue-style double-brace interpolation outside a fenced code block | Wrap the offending example in a fenced code block, or add the file to `srcExclude` |
| Site loads but every page is 404                     | `base` is wrong for where you're publishing               | Set `base: '/<repo-name>/'` (or `'/'` for custom domain)   |
| Assets 404 in production but work in dev             | Same as above — base path mismatch                        | Same fix                                                  |
| Search returns nothing                               | The local-search index didn't build (corrupt cache)        | Delete `docs/.vitepress/cache/` and rebuild               |
| Build "succeeds" but the workflow fails              | Pages settings aren't set to deploy from Actions          | Settings → Pages → Source: GitHub Actions                 |
| Deploy succeeds but the URL still shows the old site | Cloudflare / CDN cache between you and Pages              | Purge the cache, or wait it out (usually ~5 minutes)      |
| `npm ci` fails in CI but works locally               | Lockfile drift                                            | Commit the regenerated `package-lock.json` from CI's diff |

## Excluding files mid-stream

If a doc breaks the build and you need to ship without it temporarily, add the path to `srcExclude` in `docs/.vitepress/config.ts`. The file stays in the repo for editors but is omitted from the production site until you fix it.

This is the mechanism the project uses for the development-guideline docs (`A11Y_GUIDELINES.md`, `FORM_GUIDELINES.md`, etc.) that contain Vue-interpolation-conflicting examples like double-brace expressions outside fenced code blocks.

## Verifying before you push docs changes

The pre-push baseline for docs is:

```bash
cd docs
npm run docs:build
```

If this exits 0, the production build will succeed. If it errors, fix the error locally — debugging from CI logs is slower.

## Where to learn more

- [VitePress docs](https://vitepress.dev) for the upstream feature reference
- [Contributing → Code Structure](/contributing/code-structure) for where docs sit in the broader repo
- The `.github/workflows/docs.yml` file for the canonical CI definition
