// Pure, framework-free model + capability taxonomy + surface classifier + diagnostics for the
// BrowserCompatBanner shared surface — the native analogue of every decision the web component makes
// (web/src/components/feedback/BrowserCompatBanner.tsx + web/src/lib/browserCompat.ts) before it paints its
// alert. No Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// WHAT THE WEB SOURCE IS (and therefore the COMPLETE branch set this surface reproduces):
//   • A one-time, dismissable WARNING banner shown when the host platform is missing one or more capabilities
//     TeslaSync depends on. The web checks five web-platform features (BroadcastChannel, ResizeObserver,
//     Intl.RelativeTimeFormat, CSS `:has()`, structuredClone) via `detectMissingFeatures()`; on an unsupported
//     host the SPA otherwise renders a white page with no diagnostic, so the banner gives the user a coherent
//     "update / install the required runtime" message instead of an opaque break.
//   • Detection is SYNCHRONOUS and side-effect-free (it runs once at mount; a host's capabilities cannot change
//     inside a single session). Dismissal is sticky-per-install via a versioned key
//     (`teslasync:compat-warning-dismissed:v1`) so an acknowledged warning does not nag on every navigation.
//   • `dismissed || missing.length === 0` → the web returns `null` (renders nothing). Native mirror:
//     [BrowserCompatSurface.Hidden]. Otherwise the warning is shown with the comma-joined missing-feature list
//     interpolated into the localized body. Native mirror: [BrowserCompatSurface.Active].
//
// HOW THAT MAPS ONTO ANDROID (the honest native analogue — covenant: no scope narrowing, no silent drift). The
// web's "missing web-platform features" become "missing Android platform capabilities the native app genuinely
// depends on", detected read-only + synchronously from `PackageManager`/`Build` by [BrowserCompatSource]:
//   • [RequiredCapability.WebView] — the Android System WebView provider (renders Custom Tabs + any embedded web
//     content); absent on some stripped / de-Googled ROMs.
//   • [RequiredCapability.GooglePlayServices] — Google Play Services (FCM push P3/A6 + the Maps SDK); absent on
//     AOSP / Huawei / de-Googled devices.
//   • [RequiredCapability.CustomTabs] — a browser able to service the OIDC AppAuth redirect (P3/A4); absent when
//     no browser is installed.
// The capability identifiers are stable product/component names carried verbatim into the localized body exactly
// as the web carries its literal feature identifiers ("structuredClone", "CSS :has()") — they are not localized
// copy (Google product names), only interpolation values; all user-facing copy resolves through the P1/S10
// catalog at the render boundary.
//
// WHY THE GENERIC DATA-SURFACE STATES (loading / error / stale / offline) ARE INTENTIONALLY ABSENT: this surface
// fetches NOTHING. Like the sibling synchronous surfaces (AiLimitBanner, TourLauncher), its data is a
// synchronous, side-effect-free platform probe plus a local persisted flag — there is no network request, so
// there is no loading spinner, no error/retry, no staleness window, and no offline branch to model (inventing
// them would be drift). The surface's REAL, fully-reproduced states are [BrowserCompatSurface.Hidden] (the host
// is supported, OR the warning was dismissed) and [BrowserCompatSurface.Active] (one or more required
// capabilities are missing and the warning has not been dismissed) — each reduced here and asserted off-device.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/BrowserCompatBanner — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName`
// is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.browsercompatbanner

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no capability list, device
 * model, or any other payload, so a diagnostics line can never leak which capabilities a device lacks.
 */
const val BROWSER_COMPAT_BANNER_SLUG: String = "BrowserCompatBanner"

/**
 * The sticky dismissal key — carried verbatim from the web (`teslasync:compat-warning-dismissed:v1`) so the
 * versioning contract is identical across platforms: bumping the `:v` suffix re-shows the banner after a new
 * capability requirement ships. Persisted by [BrowserCompatSource]; read once at surface open.
 */
const val COMPAT_WARNING_STORAGE_KEY: String = "teslasync:compat-warning-dismissed:v1"

/** The persisted dismissal value (the web localStorage `'1'`). Any other / absent value means "not dismissed". */
const val COMPAT_WARNING_DISMISSED_VALUE: String = "1"

/**
 * The closed set of Android platform capabilities the native app depends on — the native analogue of the web's
 * required-feature list. Each carries the stable [label] shown in the banner (a product/component identifier,
 * not localized copy, mirroring the web's literal feature names). New requirements MUST get a constant here AND a
 * detection in [BrowserCompatSource]; an unknown one simply never appears in the missing list.
 *
 * @property label the stable identifier interpolated into the localized body's feature list (web `missing[i]`).
 */
enum class RequiredCapability(
    val label: String,
) {
    /** The Android System WebView provider — renders Custom Tabs + embedded web content. */
    WebView("Android System WebView"),

    /** Google Play Services — backs FCM push (P3/A6) and the Maps SDK. */
    GooglePlayServices("Google Play Services"),

    /** A browser able to service the OIDC AppAuth redirect via Custom Tabs (P3/A4). */
    CustomTabs("Chrome Custom Tabs"),
}

/**
 * Join the missing capabilities into the comma-separated feature list the body interpolates — the native mirror
 * of the web `missing.join(', ')`. Stable order (declaration order) so the rendered list is deterministic.
 */
fun joinFeatures(missing: List<RequiredCapability>): String = missing.joinToString(separator = ", ") { it.label }

/**
 * Reduce three presence probes into the ordered list of MISSING capabilities — the pure decision behind
 * [BrowserCompatSource]'s `PackageManager`-backed detection, factored out so it is unit-tested off-device while
 * the adapter keeps only the untestable platform I/O. A capability is missing when its probe is `false` (the web
 * records a feature as missing when its global is `undefined` — or when probing it throws).
 */
fun missingCapabilities(
    hasWebView: Boolean,
    hasPlayServices: Boolean,
    hasCustomTabs: Boolean,
): List<RequiredCapability> =
    buildList {
        if (!hasWebView) add(RequiredCapability.WebView)
        if (!hasPlayServices) add(RequiredCapability.GooglePlayServices)
        if (!hasCustomTabs) add(RequiredCapability.CustomTabs)
    }

/**
 * The render-ready classification of the banner — a closed set of mutually-exclusive surfaces the view switches
 * on, so every branch is exhaustively covered and unit-tested off-device.
 */
sealed interface BrowserCompatSurface {
    /** Host supported OR the warning was dismissed → the banner renders nothing (web returns `null`). */
    data object Hidden : BrowserCompatSurface

    /**
     * One or more required capabilities are missing and the warning has not been dismissed → the warning is
     * shown. Carries the [missing] capabilities; [features] is the comma-joined list the body interpolates.
     */
    data class Active(
        val missing: List<RequiredCapability>,
    ) : BrowserCompatSurface {
        /** The comma-joined missing-feature list interpolated into the localized body (web `featureList`). */
        val features: String get() = joinFeatures(missing)
    }
}

/**
 * Select the render-ready [BrowserCompatSurface] for the current detection + dismissal — a 1:1 port of the web
 * `if (dismissed || missing.length === 0) return null`. A dismissed warning or an empty missing list collapses
 * to [BrowserCompatSurface.Hidden]; otherwise the missing capabilities are carried into
 * [BrowserCompatSurface.Active].
 */
fun classify(
    missing: List<RequiredCapability>,
    dismissed: Boolean,
): BrowserCompatSurface =
    if (dismissed || missing.isEmpty()) {
        BrowserCompatSurface.Hidden
    } else {
        BrowserCompatSurface.Active(missing)
    }

/**
 * Build the merged accessibility announcement for the banner from already-localized parts (the view resolves the
 * title + body through the P1/S10 catalog). Kept pure so TalkBack-label presence is unit-tested without a Compose
 * host; the view sets it as the merged content description of the message region (web `role="status"` content).
 */
fun bannerAccessibilityLabel(
    title: String,
    body: String,
): String = "$title. $body"

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the missing
 * capabilities, the device model, or any other payload — so a diagnostics line can never leak a device's gaps.
 */
object BrowserCompatBannerDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = BROWSER_COMPAT_BANNER_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the surface's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
