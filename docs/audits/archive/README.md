# Archived audits

Reports and report-only generators that have been **superseded by executable,
thresholded gates**, or whose premise no longer matches the architecture.

Nothing here runs in CI. Files are kept (not deleted) so the historical
measurement and the reason it stopped being authoritative stay auditable.

CLEAN-08 policy: an audit may only be archived when a *stronger* check already
enforces the same property in CI. Deleting a check to make a build green is
never an acceptable outcome — see `web/scripts/audit-registry.json`, whose gate
proves every retained audit is executable, thresholded and wired.

---

## `icon-audit.md`, `lucide-direct-imports.txt`, `../../../scripts/archive/icon-audit.ps1`

**Archived because the premise inverted.**

The audit measured "files importing directly from `lucide-react`" (450 files,
1852 imports as of 2026-05-01) and treated the number as debt to be migrated
into a central `Icons` registry re-export.

That migration is now known to be a **cold-start regression**, not an
improvement. A central icon barrel makes every importer reach every icon
module, which is the same shape as naming `lucide-react` in Vite's
`manualChunks`: it hoists the entire icon set into a chunk the shell statically
imports, so icons only a lazy route ever renders are downloaded before first
paint. Removing the force-grouped `vendor-icons` chunk is what brought startup
JS to 388.4 KB gzip under the 400 KB budget.

Per-file direct imports are therefore the **required** pattern: they let Rollup
place each icon in the chunk of the route that actually renders it.

Superseded by (all executable, all in CI):

| Property | Gate |
| --- | --- |
| Icons must not be hoisted into the startup closure | `web/scripts/check-bundle-size.mjs --strict` — `BUNDLE_STARTUP_ICON_SHARE_LIMIT`, measured from production source maps |
| `manualChunks` must not force-group `lucide-react` | `web/src/__tests__/viteChunking.test.ts` |
| Arbitrary pixel icon sizing | `npm run audit:typography`, `npm run audit:touch-target` |

Startup icon locality is owned entirely by `check-bundle-size.mjs`.
`check-duplicate-modules.mjs` is deliberately NOT listed: it checks that a
package reaches the bundle through one physical copy, which is a different
property from where the icons land, and an earlier version of this file claimed
otherwise.

`docs/ICON_GUIDELINES.md` carries the corrected policy.
