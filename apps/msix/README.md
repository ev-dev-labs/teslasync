# TeslaSync Windows app (MSIX via PWABuilder)

Packages your TeslaSync server's PWA as a native Windows MSIX: Start-menu
entry, taskbar pin, and standalone window. Additional Windows
integrations depend on the generated package and manifest. It runs
on the Edge engine, so login and live updates work like the browser.

Because TeslaSync is self-hosted, the package points at **your** domain:
every owner builds their own. Alternatively, use the generic Electron
app in `apps/desktop`.

Pick one path:

## Path A — PWABuilder.com (easiest, no install)

1. Open <https://www.pwabuilder.com> and enter your server URL
   (`https://teslasync.example.com` — must be HTTPS with a valid cert).
2. Choose the **Windows** platform and download the MSIX.
3. Sign it with a certificate trusted by your device before sideloading,
   or configure your Partner Center identity for Store submission.

## Preflight from the command line

```powershell
# Windows (PowerShell): checks the PWA manifest, then prints the web packaging steps
cd apps\msix
.\package.ps1 https://teslasync.example.com
```

```sh
# Unix-like: same preflight
cd apps/msix
./package.sh https://teslasync.example.com
```

`@pwabuilder/cli` does **not** implement a `package` command. Use
PWABuilder.com for generation; signing and Store identity setup
are required before distributing or installing the package.

## Local smoke test (no deployment)

You can preflight a local PWA with `.\package.ps1
http://localhost:4000`, but a package bound to localhost only talks to
the machine on which it runs. Use a deployed HTTPS URL for distribution.

## Notes

- Rebuilding is only needed to change the icon, name, or package identity.
  Web UI updates ship with the server — no rebuild required.
- The installed window uses your server's theme; title-bar integration
  depends on the generated manifest and browser support.
- First launch asks nothing: it opens your server's login like the browser.
