# Rules for every task

Repo: D:\repos\teslasync (Windows, PowerShell). Branch: next-upgrades.

## Working style
- Work autonomously. Never ask questions. Never stop to summarize.
- Do ONE task per session: the first `todo` task in STATUS.md.
- If a command fails, read the error, fix the cause, rerun.
- Failing tests are normal while working: fix them.
- Find code with `git grep` (works everywhere), e.g.
  `git grep -n -E 'pattern' -- web/src | Select-Object -First 20`.
  Read existing similar code and copy its style.
- Commands run in PowerShell. Set env vars like `$env:CI='true'`.
- Long output goes to a file; read only the end, e.g.
  `npx tsc --noEmit *> $env:TEMP\tsc.log; Get-Content $env:TEMP\tsc.log -Tail 30`
- Long Playwright runs: add `--global-timeout=1200000` (20 minutes).

## Git
- Stage only the files the task names or the files you changed for it.
  Never `git add -A`, `git add .` or `git commit -a`.
- Keep each file's existing line endings (don't convert LF/CRLF).
- Never commit logs, temp files, or anything under `docs/widget-redesign/`.
- If `git push` says "no upstream branch": `git push -u origin next-upgrades`.
- Never merge any PR. Never push to main.

## Code rules
- All user-facing text through `t()` with keys in `web/src/i18n/en.json`,
  then in `web`: `node scripts/split-i18n-catalog.mjs`.
- Use the shared helpers for units (useUnits / unitConversion), dates and
  time zones (the shared date layer), numbers, colors (palette tokens in
  web/src/lib/colors.ts), icons (web/src/lib/icons.ts).
- Never weaken, skip or delete tests. No eslint-disable, ts-ignore or
  exception-marker comments.
- Never fabricate data. Missing data shows the standard "unavailable"
  state. Simulated data says "Demo"; projected data says "Estimate".
- Licensing: never use Tesla images, renders, logos or 3D models, or
  assets ripped from games/apps. Only CC0/CC-BY or self-made assets;
  record source and license in docs/experiments.md.
- Every experiment page is lazy-loaded (its own chunk). The startup
  bundle budget must not grow (checked by `npm run build`).
- npm install only when a task says so, exact versions at least 2 weeks
  old (`npm install --save-exact --legacy-peer-deps <pkg>@<version>`).
- Respect prefers-reduced-motion. Light and dark mode must look right.
  Pages must work on mobile (390px).
- Freshness indicator: always the existing FreshnessDot component.

## Standard verify commands (run in D:\repos\teslasync\web)
- `npx tsc --noEmit`
- `npm run lint`
- `node scripts/split-i18n-catalog.mjs --check`
- `node scripts/generate-route-registry.mjs --check`
- tests for changed files: `npx vitest run <paths> --maxWorkers=2`
- `npm run build` (includes the bundle budget)
- targeted e2e (hermetic mock build, no backend running):
  `$env:E2E_MOCKS='1'; npm run e2e:build` once, then
  `$env:E2E_REUSE_BUILD='1'; $env:CI='true'; $env:TZ='UTC'; npx playwright test <spec> --project=chromium-smoke --global-timeout=1200000`
- CI's quality/a11y/performance/firefox/webkit jobs run on Linux. If
  something passes on Windows but fails in CI, check case-sensitive file
  paths and line endings.

## Marking a task done
In STATUS.md set the task to `done`, add the commit hash and one short
note. Commit STATUS.md with message `docs(tasks): mark NN done` and push.
If you truly cannot make Verify pass, set it to `blocked` with the exact
error, commit, push, and end.
