// Pure, framework-free model + surface classifier + dismissal math + diagnostics for the InstallPrompt shared
// surface — the native analogue of every decision the web component makes (web/src/components/feedback/InstallPrompt.tsx)
// before it paints its prompt. No Compose, no Android, no HTTP: every declaration here is unit-tested off-device in
// the :app:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// WHAT THE WEB SOURCE IS (and therefore the COMPLETE branch set this surface reproduces):
//   • A bottom-docked, dismissable PROMOTION inviting the user to install the PWA ("Add to home screen for native
//     experience"). It is gated on three synchronous, side-effect-free checks the web runs at mount:
//       – `isStandaloneMode()` — the app is already installed / running standalone → never show.
//       – `wasDismissedRecently()` — a sticky localStorage timestamp (`teslasync-pwa-install-dismissed`) within the
//         last `DISMISS_DAYS = 14` days → never show.
//       – the browser firing a `beforeinstallprompt` event — the platform is offering an install path → show.
//     Only when an install path exists AND the app is not already installed AND it was not recently dismissed does
//     the prompt become visible (web `setVisible(true)`).
//   • `visible === false` → the web renders nothing (the `AnimatePresence` has no child). Native mirror:
//     [InstallPromptSurface.Hidden]. Otherwise the card is shown. Native mirror: [InstallPromptSurface.Active].
//   • Two actions: INSTALL (web `deferredPrompt.prompt()` → hide on `accepted`) and DISMISS (web persists the sticky
//     timestamp + broadcasts `install.dismissed`, then hides).
//
// HOW THAT MAPS ONTO ANDROID (the honest native analogue — covenant: no scope narrowing, no silent drift). A native
// app is itself "installed", so the faithful analogue of the PWA "add to home screen" affordance is pinning a
// TeslaSync launcher shortcut to the home screen via `ShortcutManagerCompat` (the platform's own "install to home
// screen" path). The three web gates map exactly:
//   • `beforeinstallprompt` available → the launcher supports pin-shortcut requests (an install path exists).
//   • `isStandaloneMode()` (already installed) → the TeslaSync home-screen shortcut is already pinned.
//   • `wasDismissedRecently()` → a `SharedPreferences` timestamp within the same 14-day window.
// The platform I/O lives in [io.teslasync.android.sharedsurfaces.installprompt] InstallPromptSource; the DECISIONS
// (the 14-day window test + the show/hide classification) are the pure functions here, asserted off-device.
//
// WHY THE GENERIC DATA-SURFACE STATES (loading / error / stale / offline) ARE INTENTIONALLY ABSENT: this surface
// fetches NOTHING. Exactly like the sibling synchronous surfaces (BrowserCompatBanner, AiLimitBanner), its inputs are
// a synchronous platform probe plus a local persisted flag — there is no network request, so there is no loading
// spinner, no error/retry, no staleness window and no offline branch to model (inventing them would be drift). The
// surface's REAL, fully-reproduced states are [InstallPromptSurface.Hidden] (already installed, OR dismissed within
// the window, OR no install path) and [InstallPromptSurface.Active] (an install path exists and it was not recently
// dismissed) — each reduced here and asserted off-device.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/InstallPrompt — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.installprompt

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no install-path detail, device
 * model, or any other payload, so a diagnostics line can never leak whether a device can install shortcuts.
 */
const val INSTALL_PROMPT_SLUG: String = "InstallPrompt"

/**
 * The sticky dismissal key — carried verbatim from the web (`teslasync-pwa-install-dismissed`) so the contract is
 * identical across platforms. Persisted by the InstallPromptSource; read once when the surface opens.
 */
const val INSTALL_DISMISS_STORAGE_KEY: String = "teslasync-pwa-install-dismissed"

/** The sticky-dismissal window in days — the web `DISMISS_DAYS = 14`: a dismissed prompt stays hidden this long. */
const val INSTALL_DISMISS_WINDOW_DAYS: Int = 14

/** The dismissal window in milliseconds — the web `DISMISS_DAYS * 86_400_000`. */
const val INSTALL_DISMISS_WINDOW_MS: Long = INSTALL_DISMISS_WINDOW_DAYS * 86_400_000L

/**
 * Whether the prompt was dismissed within the sticky window — a 1:1 port of the web `wasDismissedRecently()`:
 * `Number.isFinite(ts) && Date.now() - ts < DISMISS_DAYS * 86_400_000`. A `null`/absent timestamp (the web's missing
 * or unparseable localStorage value) is "not dismissed"; any stored instant whose age is under [windowMs] keeps the
 * prompt hidden.
 *
 * @param dismissedAtMs the persisted dismissal instant (epoch millis), or `null` when none was stored.
 * @param nowMs the current instant (epoch millis); injected so the window boundary is deterministic off-device.
 * @param windowMs the sticky window; defaults to [INSTALL_DISMISS_WINDOW_MS].
 */
fun wasDismissedRecently(
    dismissedAtMs: Long?,
    nowMs: Long,
    windowMs: Long = INSTALL_DISMISS_WINDOW_MS,
): Boolean = dismissedAtMs != null && nowMs - dismissedAtMs < windowMs

/**
 * The render-ready classification of the prompt — a closed set of mutually-exclusive surfaces the view switches on,
 * so every branch is exhaustively covered and unit-tested off-device. The web `Active` carries no data (its card copy
 * is static), so [Active] is a data object.
 */
sealed interface InstallPromptSurface {
    /** Already installed, OR dismissed within the window, OR no install path → the prompt renders nothing (web `null`). */
    data object Hidden : InstallPromptSurface

    /** An install path exists and the prompt was not recently dismissed → the install card is shown. */
    data object Active : InstallPromptSurface
}

/**
 * Select the render-ready [InstallPromptSurface] for the current probes — a faithful port of the web mount-time gate
 * (`if (isStandaloneMode() || wasDismissedRecently()) return; … setVisible(true)` once an install path appears). The
 * prompt is [InstallPromptSurface.Active] only when an install path is offered AND the app is not already installed
 * AND it was not recently dismissed; every other combination collapses to [InstallPromptSurface.Hidden].
 *
 * @param installSupported the launcher offers a pin-shortcut path (web `beforeinstallprompt` available).
 * @param alreadyInstalled the home-screen shortcut is already pinned (web `isStandaloneMode()`).
 * @param dismissedRecently dismissed within the sticky window (web `wasDismissedRecently()`).
 */
fun classifyInstallPrompt(
    installSupported: Boolean,
    alreadyInstalled: Boolean,
    dismissedRecently: Boolean,
): InstallPromptSurface =
    if (installSupported && !alreadyInstalled && !dismissedRecently) {
        InstallPromptSurface.Active
    } else {
        InstallPromptSurface.Hidden
    }

/**
 * Build the merged accessibility announcement for the prompt from already-localized parts (the view resolves the
 * title + subtitle through the P1/S10 catalog). Kept pure so TalkBack-label presence is unit-tested without a Compose
 * host; the view sets it as the merged content description of the message region so the prompt announces itself
 * politely when it slides in.
 */
fun installPromptAccessibilityLabel(
    title: String,
    subtitle: String,
): String = "$title. $subtitle"

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the install-path
 * state, the device model, or any other payload — so a diagnostics line can never leak a device's capabilities.
 */
object InstallPromptDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = INSTALL_PROMPT_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the surface's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
