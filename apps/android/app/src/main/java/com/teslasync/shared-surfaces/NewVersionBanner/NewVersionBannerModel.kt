// Pure, framework-free model + projection + diagnostics for the NewVersionBanner shared surface — the native
// analogue of web/src/components/feedback/NewVersionBanner.tsx and its web/src/hooks/useVersionWatcher.ts data
// hook. No Compose, no Android framework, no HTTP: every declaration here is exercised off-device in the
// :app:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// WHAT THE WEB SOURCE IS (and therefore the COMPLETE branch set this surface reproduces). The banner watches the
// backend deployment identity: `useVersionWatcher` captures the `app_version` reported by GET /system/version on
// the first poll after boot ([VersionWatcherState.bootVersion]) and the most recent value
// ([VersionWatcherState.latestVersion]); when they diverge ([VersionWatcherState.newVersionAvailable]) the SPA was
// redeployed under the running client. The web component renders a soft bottom-right banner ONLY while
// `newVersionAvailable && dismissedVersion !== latestVersion` and otherwise returns null. "Reload" hard-reloads
// the page (pulling fresh chunk hashes ahead of a ChunkLoadError); "Later" dismisses the banner FOR THAT version
// (sessionStorage), and a still-newer deploy re-surfaces it because the dismissal is keyed on `latestVersion`.
//
// HOW THAT MAPS ONTO THE NATIVE WIRED STATE (P1/S8, ADR-002/005/013). The deployment identity is bound to the
// shared S8 SettingsStore `versionInfo()` cache-then-network feed (the same `useVersionInfo` envelope the
// dashboard VersionInfoWidget reads). The shared `VersionInfo` contract does not surface `app_version`, so the
// adapter derives a stable DEPLOY FINGERPRINT from its identity fields (chart_version|go_version|os|arch) — any
// redeploy changes it, reproducing the web's redeploy-detection intent (see NewVersionBannerSource). The web
// hides itself with `return null` during loading / when up to date / after a deferral; this surface instead
// renders EVERY state as a non-blank region (the platform "no hidden surfaces" contract, exactly as the sibling
// CookieConsentBanner does for the web `if (!data) return null` guard):
//   • [NewVersionPhase.Loading]  — the version feed is loading with nothing cached (skeleton chrome);
//   • [NewVersionPhase.Error]    — the version feed hard-failed with no cache (a retry affordance);
//   • [NewVersionPhase.Prompt]   — newVersionAvailable && not deferred → the active reload banner (web's only
//     rendered state);
//   • [NewVersionPhase.Resolved] — up to date OR deferred → a friendly recorded panel (the native form of the web
//     `return null`).
// Two freshness chips ride orthogonally over Prompt/Resolved: [NewVersionRender.showStaleChip] (TTL-stale, a
// refresh in flight over the last-known identity) and [NewVersionRender.showOfflineChip] (the identity served
// from cache after a failed refresh — "last known + retry").
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/NewVersionBanner — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen segment is illegal in a package identifier), so the package intentionally diverges from the
// path — exactly as the sibling shared surfaces do. `MatchingDeclarationName` is suppressed for the co-located
// supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.newversionbanner

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the NewVersionBanner surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`NewVersionBanner`); [ID] is
 * the stable `viewModel` key the host binds the surface with.
 */
object NewVersionBannerRegistration {
    /** Stable surface id (also the `viewModel` key the host binds the surface with). */
    const val ID: String = "new-version-banner"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "NewVersionBanner"
}

/**
 * The native port of the web `useVersionWatcher` return shape (web/src/hooks/useVersionWatcher.ts). The watcher
 * captures the deployment identity once at boot ([bootVersion]) and tracks the most recent value
 * ([latestVersion]); [newVersionAvailable] is true exactly when both are known and diverge — i.e. the backend was
 * redeployed under the running client.
 *
 * @property bootVersion the deployment identity captured on the first known emission; `null` until it resolves.
 * @property latestVersion the most recent deployment identity; `null` until the first known emission.
 * @property newVersionAvailable `true` iff boot + latest are both known and `latestVersion != bootVersion`.
 */
data class VersionWatcherState(
    val bootVersion: String?,
    val latestVersion: String?,
    val newVersionAvailable: Boolean,
) {
    /**
     * Re-baselines the watcher onto the current [latestVersion] — the native effect of the web "Reload": once the
     * client is reloaded onto the new deployment, boot and latest are aligned again so the banner clears. A no-op
     * before any identity is known.
     */
    fun rebaselined(): VersionWatcherState =
        if (latestVersion == null) {
            this
        } else {
            VersionWatcherState(bootVersion = latestVersion, latestVersion = latestVersion, newVersionAvailable = false)
        }

    companion object {
        /** The pre-resolution state: no identity known yet (the web pre-boot-probe state). */
        val Initial: VersionWatcherState =
            VersionWatcherState(bootVersion = null, latestVersion = null, newVersionAvailable = false)
    }
}

/**
 * Pure fold of a newly observed deployment identity into the running [VersionWatcherState] — the native mirror of
 * the web hook's boot-capture + latest-tracking. Framework-free so the redeploy-detection contract is covered by
 * the JVM gate without a coroutine/UI host.
 */
object VersionWatch {
    /**
     * Folds an observed [version] into [previous]:
     *  - a `null` / blank identity (nothing known yet) leaves the state unchanged (the web "swallow + retry");
     *  - the FIRST known identity seeds [VersionWatcherState.bootVersion] (web boot probe, captured once);
     *  - every known identity updates [VersionWatcherState.latestVersion], and the divergence from the captured
     *    boot identity sets [VersionWatcherState.newVersionAvailable] (web `latestVersion !== bootVersion`).
     */
    fun fold(
        previous: VersionWatcherState,
        version: String?,
    ): VersionWatcherState {
        if (version.isNullOrBlank()) return previous
        val boot = previous.bootVersion ?: version
        return VersionWatcherState(
            bootVersion = boot,
            latestVersion = version,
            newVersionAvailable = boot != version,
        )
    }
}

/**
 * The mutually-exclusive primary region the surface paints. The web renders only [Prompt] (and otherwise `null`);
 * the native surface renders every phase as a non-blank region per the platform contract:
 *  - [Loading] — the version feed is loading with nothing cached (skeleton chrome);
 *  - [Error] — the version feed hard-failed with no cached fallback (retry affordance);
 *  - [Prompt] — newVersionAvailable && not deferred (the active web banner);
 *  - [Resolved] — up to date, or the active version was deferred (the native form of the web `return null`).
 */
enum class NewVersionPhase {
    Loading,
    Error,
    Prompt,
    Resolved,
}

/**
 * Why the surface resolved to [NewVersionPhase.Resolved] — selects the recorded-state copy:
 *  - [UpToDate] — no new deployment is available (web `if (!newVersionAvailable) return null`);
 *  - [Deferred] — a new deployment IS available but the user chose "Later" for it (web dismissed-for-version).
 */
enum class ResolvedReason {
    UpToDate,
    Deferred,
}

/**
 * The fully-resolved render state the composable paints — the native mirror of everything the web component
 * decides before returning JSX (or null). Pure data (no Compose types) so the projection is unit-tested without a
 * UI host; the composable only resolves colours + localized strings from it.
 *
 * @property phase the primary region to render.
 * @property watcher the deployment-identity watcher (drives [Prompt] vs [Resolved] and the [resolvedReason]).
 * @property dismissedVersion the identity the user deferred via "Later", if any (web sessionStorage value).
 * @property stale whether a refresh is in flight over the last-known identity (TTL-stale) — a "Stale" chip.
 * @property offline whether the identity is served from cache after a failed refresh — an "offline / last known"
 *   chip with a retry affordance.
 * @property errorKind the classification of the version-feed failure, when any.
 */
data class NewVersionRender(
    val phase: NewVersionPhase,
    val watcher: VersionWatcherState,
    val dismissedVersion: String?,
    val stale: Boolean,
    val offline: Boolean,
    val errorKind: ErrorKind?,
) {
    /** The active reload banner (web's only rendered state). */
    val showPrompt: Boolean get() = phase == NewVersionPhase.Prompt

    /** The resolved recorded-state panel (the native form of the web `return null`). */
    val showResolved: Boolean get() = phase == NewVersionPhase.Resolved

    /** The cold-start skeleton chrome (version feed loading, nothing cached). */
    val showLoading: Boolean get() = phase == NewVersionPhase.Loading

    /** The hard-error panel with a retry affordance (version feed failed, nothing cached). */
    val showError: Boolean get() = phase == NewVersionPhase.Error

    /** Whether the "Stale" freshness chip should render (TTL-stale, not offline, over a rendered identity). */
    val showStaleChip: Boolean get() = stale && !offline && (showPrompt || showResolved)

    /** Whether the "offline / last known" chip + retry should render over a rendered identity. */
    val showOfflineChip: Boolean get() = offline && (showPrompt || showResolved)

    /** Which recorded-state copy the [Resolved] panel shows (the web `return null` reason). */
    val resolvedReason: ResolvedReason
        get() =
            if (watcher.newVersionAvailable && dismissedVersion != null && dismissedVersion == watcher.latestVersion) {
                ResolvedReason.Deferred
            } else {
                ResolvedReason.UpToDate
            }
}

/**
 * Pure projection from the wired version feed + watcher + the local deferral into the render-ready
 * [NewVersionRender] — the native mirror of the branching the web component performs before returning JSX.
 * Framework-free so the whole contract is covered by the JVM unit gate without a Compose host.
 */
object NewVersionBannerProjection {
    /**
     * Folds the deployment-identity [versionState] (web `useVersionInfo` lifecycle) + the [watcher]
     * (web `useVersionWatcher`) + the local [dismissedVersion] (web sessionStorage) into the render. Phase
     * resolution honours both the web's binary show/hide and the feed's freshness lifecycle:
     *  - feed loading with nothing cached → [NewVersionPhase.Loading];
     *  - feed hard-failed with no cache → [NewVersionPhase.Error];
     *  - newVersionAvailable && not deferred → [NewVersionPhase.Prompt] (the active web banner);
     *  - otherwise → [NewVersionPhase.Resolved] (up to date, or deferred).
     * The freshness chips are derived from the feed's [UiState.stale] / [UiState.hasError]: a stale flag with no
     * error is TTL-stale (refresh in flight); a stale flag WITH an error is the offline "last known" surface.
     */
    fun render(
        versionState: UiState<String>,
        watcher: VersionWatcherState,
        dismissedVersion: String?,
    ): NewVersionRender {
        val offline = versionState.hasData && versionState.stale && versionState.hasError
        val stale = versionState.hasData && versionState.stale && !versionState.hasError
        val deferred = watcher.newVersionAvailable && dismissedVersion != null && dismissedVersion == watcher.latestVersion
        val phase =
            when {
                versionState.isLoading -> NewVersionPhase.Loading
                versionState.isError -> NewVersionPhase.Error
                watcher.newVersionAvailable && !deferred -> NewVersionPhase.Prompt
                else -> NewVersionPhase.Resolved
            }
        return NewVersionRender(
            phase = phase,
            watcher = watcher,
            dismissedVersion = dismissedVersion,
            stale = stale,
            offline = offline,
            errorKind = versionState.errorKind,
        )
    }

    /** The cold-start render before any feed emission — the loading surface (web hidden during load). */
    fun loading(
        watcher: VersionWatcherState = VersionWatcherState.Initial,
        dismissedVersion: String? = null,
    ): NewVersionRender = render(UiState.loading(), watcher, dismissedVersion)
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [NewVersionBannerRegistration.SLUG]
 * (P1/S11) — never the deployment identity nor any version string, so a diagnostics line can never leak the
 * server's build details. Kept free of Compose so it is unit-tested with a recording [Logger]; the ViewModel
 * calls it once per surface open.
 */
fun recordNewVersionOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to NewVersionBannerRegistration.SLUG))
}
