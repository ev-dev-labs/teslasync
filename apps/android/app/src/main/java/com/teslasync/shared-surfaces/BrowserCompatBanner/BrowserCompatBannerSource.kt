// The single data port the BrowserCompatBanner shared surface binds to — the native analogue of the web
// detection + dismissal layer the component reads (web/src/lib/browserCompat.ts: `detectMissingFeatures`,
// `isCompatWarningDismissed`, `dismissCompatWarning`; the P1/S8 state-holder boundary). The view never touches
// `PackageManager` or persistence itself, and a test fake stands in for the whole layer so the surface is
// verified off-device.
//
// The web data is SYNCHRONOUS local state (a read-only platform probe + a sticky localStorage flag), not a
// cache-then-network feed — so, exactly like the sibling synchronous surfaces (AiLimitBanner, TourLauncher),
// there is no loading / error / stale / offline lifecycle to model here (covenant: no silent drift). The
// detection DECISION (which probes → which missing capabilities) is the pure [missingCapabilities] in the model,
// unit-tested off-device; this file holds only the thin, untestable platform glue: the `PackageManager` reads
// behind the three probes and the [android.content.SharedPreferences] read/write behind the sticky flag. Every
// probe fails toward "missing" on a throw — a throw is itself evidence the capability is unusable, the same
// defensive stance the web takes when querying a global throws.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/BrowserCompatBanner) cannot form a valid Kotlin package;
// `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed for the co-located adapters + bindings
// alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.browsercompatbanner

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.net.Uri

/** SharedPreferences file backing the sticky dismissal flag (the web localStorage analogue). */
const val BROWSER_COMPAT_PREFS_NAME: String = "teslasync.compat"

/** The Google Play Services package probed for [RequiredCapability.GooglePlayServices]. */
private const val PLAY_SERVICES_PACKAGE = "com.google.android.gms"

/**
 * Known Android System WebView provider packages probed for [RequiredCapability.WebView]. A device exposes the
 * renderer through one of these; if none is installed + enabled the capability is treated as missing.
 */
private val WEBVIEW_PROVIDER_PACKAGES =
    listOf(
        "com.google.android.webview",
        "com.android.webview",
        "com.android.chrome",
    )

/** The probe URL used to detect a browser able to service the OIDC Custom Tabs redirect (any https VIEW target). */
private const val PROBE_BROWSE_URL = "https://teslasync.io"

/**
 * The seam the [BrowserCompatBannerViewModel] binds to so it depends on an abstraction (real adapter ↔ test
 * fake), never on `PackageManager` or concrete persistence. [detectMissing] is the read-only, synchronous
 * platform probe (web `detectMissingFeatures`); [isDismissed] reads the sticky flag (web
 * `isCompatWarningDismissed`); [setDismissed] persists it (web `dismissCompatWarning`). No HTTP touches the view.
 */
interface BrowserCompatSource {
    /** The required capabilities missing on this device, in declaration order (web `detectMissingFeatures()`). */
    fun detectMissing(): List<RequiredCapability>

    /** Whether the warning was previously dismissed on this install (web `isCompatWarningDismissed()`). */
    fun isDismissed(): Boolean

    /** Persists the sticky dismissal so the warning does not reappear (web `dismissCompatWarning()`). */
    fun setDismissed()
}

/**
 * The production [BrowserCompatSource]: a thin, side-effect-only adapter over [PackageManager] (the three
 * capability probes) and [SharedPreferences] (the sticky dismissal). It holds no derived state — all decision
 * logic stays in the off-device-tested [missingCapabilities] + [classify]. Each probe is wrapped so a throw
 * (a locked-down or stripped device that raises rather than returns) collapses to "missing", matching the web's
 * defensive detection.
 */
class AndroidBrowserCompatSource(
    private val packageManager: PackageManager,
    private val prefs: SharedPreferences,
) : BrowserCompatSource {
    override fun detectMissing(): List<RequiredCapability> =
        missingCapabilities(
            hasWebView = anyPackageEnabled(packageManager, WEBVIEW_PROVIDER_PACKAGES),
            hasPlayServices = isPackageEnabled(packageManager, PLAY_SERVICES_PACKAGE),
            hasCustomTabs = canBrowse(packageManager),
        )

    override fun isDismissed(): Boolean =
        runCatching {
            prefs.getString(COMPAT_WARNING_STORAGE_KEY, null) == COMPAT_WARNING_DISMISSED_VALUE
        }.getOrDefault(false)

    override fun setDismissed() {
        runCatching {
            prefs.edit().putString(COMPAT_WARNING_STORAGE_KEY, COMPAT_WARNING_DISMISSED_VALUE).apply()
        }
    }
}

/** True when [pkg] is installed AND enabled; a throw (absent package) or a disabled component reads as `false`. */
private fun isPackageEnabled(
    packageManager: PackageManager,
    pkg: String,
): Boolean = runCatching { packageManager.getApplicationInfo(pkg, 0).enabled }.getOrDefault(false)

/** True when ANY of [packages] is installed + enabled — the WebView-provider probe. */
private fun anyPackageEnabled(
    packageManager: PackageManager,
    packages: List<String>,
): Boolean = packages.any { isPackageEnabled(packageManager, it) }

/** True when some activity can handle an https VIEW intent — i.e. a Custom-Tabs-capable browser is present. */
private fun canBrowse(packageManager: PackageManager): Boolean =
    runCatching {
        packageManager.resolveActivity(Intent(Intent.ACTION_VIEW, Uri.parse(PROBE_BROWSE_URL)), 0) != null
    }.getOrDefault(false)

/**
 * Binds the surface to the production [AndroidBrowserCompatSource] over the app's [PackageManager] + compat
 * preferences — the default the composable's `rememberBrowserCompatSource` uses. Uses the application context so
 * the source never retains an Activity. Tests inject a fake [BrowserCompatSource] via [browserCompatSource].
 */
fun bindBrowserCompatSource(context: Context): BrowserCompatSource {
    val app = context.applicationContext
    return AndroidBrowserCompatSource(
        packageManager = app.packageManager,
        prefs = app.getSharedPreferences(BROWSER_COMPAT_PREFS_NAME, Context.MODE_PRIVATE),
    )
}

/**
 * Builds an in-memory [BrowserCompatSource] from a fixed [missing] set (+ an initial [dismissed] flag) — the
 * native analogue of the web `testHookMissing` seam: it lets the surface be driven into every state
 * deterministically off-device without touching `PackageManager` or real persistence. [setDismissed] flips the
 * in-memory flag so the dismiss → stays-hidden flow is exercised, mirroring the persisted localStorage write.
 */
fun browserCompatSource(
    missing: List<RequiredCapability>,
    dismissed: Boolean = false,
): BrowserCompatSource =
    object : BrowserCompatSource {
        private var dismissedFlag = dismissed

        override fun detectMissing(): List<RequiredCapability> = missing

        override fun isDismissed(): Boolean = dismissedFlag

        override fun setDismissed() {
            dismissedFlag = true
        }
    }
