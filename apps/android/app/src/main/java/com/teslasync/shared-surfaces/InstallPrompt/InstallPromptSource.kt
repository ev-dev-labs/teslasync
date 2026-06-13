// The single data port the InstallPrompt shared surface binds to — the native analogue of the install-path detection
// + sticky-dismissal layer the web component reads (web/src/components/feedback/InstallPrompt.tsx: the
// `beforeinstallprompt`/`isStandaloneMode()` probes, the `wasDismissedRecently()`/`handleDismiss` localStorage flag,
// and the `deferredPrompt.prompt()` install trigger; the P1/S8 state-holder boundary). The view never touches
// `ShortcutManagerCompat` or persistence itself, and a test fake stands in for the whole layer so the surface is
// verified off-device.
//
// The web data is SYNCHRONOUS local state (read-only platform probes + a sticky localStorage timestamp), not a
// cache-then-network feed — so, exactly like the sibling synchronous surfaces (BrowserCompatBanner, AiLimitBanner),
// there is no loading / error / stale / offline lifecycle to model here (covenant: no silent drift). The DECISIONS
// (the 14-day window test + the show/hide classification) are pure functions in the model, unit-tested off-device;
// this file holds only the thin, untestable platform glue: the `ShortcutManagerCompat` pin-shortcut probes and the
// [android.content.SharedPreferences] read/write behind the sticky flag. Every probe is wrapped so a throw (a
// locked-down launcher that raises rather than returns) collapses toward the safe answer — the same defensive stance
// the web takes when querying a browser global throws.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/InstallPrompt) cannot form a valid Kotlin package; `ktlint:standard:filename` /
// `MatchingDeclarationName` are suppressed for the co-located adapters + bindings alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.installprompt

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import io.teslasync.android.R

/** SharedPreferences file backing the sticky dismissal timestamp (the web localStorage analogue). */
const val INSTALL_PROMPT_PREFS_NAME: String = "teslasync.install"

/**
 * The stable id of the TeslaSync home-screen shortcut this prompt offers to pin — the native analogue of the PWA the
 * web prompt installs. Used both to request the pin and to detect that it is already pinned ("already installed").
 */
const val INSTALL_SHORTCUT_ID: String = "teslasync-home-shortcut"

/** The sentinel returned by [SharedPreferences.getLong] when no dismissal has been stored. */
private const val NO_DISMISSAL: Long = -1L

/**
 * The seam the InstallPromptViewModel binds to so it depends on an abstraction (real adapter ↔ test fake), never on
 * `ShortcutManagerCompat` or concrete persistence. [isInstallSupported] mirrors the web `beforeinstallprompt`
 * availability; [isAlreadyInstalled] mirrors `isStandaloneMode()`; [dismissedAtMs]/[markDismissed] mirror the sticky
 * localStorage timestamp; [requestInstall] mirrors `deferredPrompt.prompt()`. No HTTP touches the view.
 */
interface InstallPromptSource {
    /** Whether the launcher offers a pin-shortcut path (web: a `beforeinstallprompt` event is available). */
    fun isInstallSupported(): Boolean

    /** Whether the TeslaSync home-screen shortcut is already pinned (web `isStandaloneMode()`). */
    fun isAlreadyInstalled(): Boolean

    /** The persisted dismissal instant (epoch millis), or `null` when none was stored (web localStorage read). */
    fun dismissedAtMs(): Long?

    /** Persists [nowMs] as the dismissal instant so the prompt stays hidden for the window (web `handleDismiss`). */
    fun markDismissed(nowMs: Long)

    /** Requests the pin-shortcut install; returns `true` when the launcher accepted the request (web `prompt()`). */
    fun requestInstall(): Boolean
}

/**
 * The production [InstallPromptSource]: a thin, side-effect-only adapter over [ShortcutManagerCompat] (the install
 * path + already-pinned probe + the pin request) and [SharedPreferences] (the sticky dismissal). It holds no derived
 * state — all decision logic stays in the off-device-tested [classifyInstallPrompt] + [wasDismissedRecently]. Each
 * platform call is wrapped so a throw (a stripped or locked-down launcher) collapses to the safe answer, matching the
 * web's defensive detection.
 */
class AndroidInstallPromptSource(
    private val context: Context,
    private val prefs: SharedPreferences,
) : InstallPromptSource {
    override fun isInstallSupported(): Boolean =
        runCatching { ShortcutManagerCompat.isRequestPinShortcutSupported(context) }.getOrDefault(false)

    override fun isAlreadyInstalled(): Boolean =
        runCatching {
            ShortcutManagerCompat
                .getShortcuts(context, ShortcutManagerCompat.FLAG_MATCH_PINNED)
                .any { it.id == INSTALL_SHORTCUT_ID }
        }.getOrDefault(false)

    override fun dismissedAtMs(): Long? =
        runCatching {
            prefs.getLong(INSTALL_DISMISS_STORAGE_KEY, NO_DISMISSAL).takeIf { it != NO_DISMISSAL }
        }.getOrNull()

    override fun markDismissed(nowMs: Long) {
        runCatching { prefs.edit().putLong(INSTALL_DISMISS_STORAGE_KEY, nowMs).apply() }
    }

    override fun requestInstall(): Boolean =
        runCatching {
            ShortcutManagerCompat.isRequestPinShortcutSupported(context) &&
                ShortcutManagerCompat.requestPinShortcut(context, buildShortcut(context), null)
        }.getOrDefault(false)
}

/**
 * Build the TeslaSync home-screen [ShortcutInfoCompat] the install request pins. The label resolves through the
 * P1/S10 catalog (no hardcoded English), the icon is the app's own launcher icon, and the intent re-opens the app —
 * a pinned shortcut's intent must carry an action, which the package launch intent already sets.
 */
private fun buildShortcut(context: Context): ShortcutInfoCompat {
    val launch =
        context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?: Intent(Intent.ACTION_MAIN).setPackage(context.packageName)
    launch.action = launch.action ?: Intent.ACTION_MAIN
    return ShortcutInfoCompat
        .Builder(context, INSTALL_SHORTCUT_ID)
        .setShortLabel(context.getString(R.string.translation_installPrompt_title))
        .setLongLabel(context.getString(R.string.translation_installPrompt_subtitle))
        .setIcon(IconCompat.createWithResource(context, context.applicationInfo.icon))
        .setIntent(launch)
        .build()
}

/**
 * Binds the surface to the production [AndroidInstallPromptSource] over the app's launcher + install preferences — the
 * default the composable's `rememberInstallPromptSource` uses. Uses the application context so the source never
 * retains an Activity. Tests inject a fake [InstallPromptSource] via [installPromptSource].
 */
fun bindInstallPromptSource(context: Context): InstallPromptSource {
    val app = context.applicationContext
    return AndroidInstallPromptSource(
        context = app,
        prefs = app.getSharedPreferences(INSTALL_PROMPT_PREFS_NAME, Context.MODE_PRIVATE),
    )
}

/**
 * Builds an in-memory [InstallPromptSource] from fixed probe answers — the native analogue of the web test seam: it
 * lets the surface be driven into every state deterministically off-device without touching `ShortcutManagerCompat`
 * or real persistence. [markDismissed] records the in-memory timestamp (so the dismiss → stays-hidden flow is
 * exercised) and [requestInstall] returns [installLaunches], mirroring the launcher accepting or rejecting the pin.
 *
 * @param installSupported web `beforeinstallprompt` available.
 * @param alreadyInstalled web `isStandaloneMode()`.
 * @param dismissedAtMs the seeded sticky timestamp, or `null` for none.
 * @param installLaunches what [requestInstall] returns (the launcher accepting the pin request).
 */
fun installPromptSource(
    installSupported: Boolean = true,
    alreadyInstalled: Boolean = false,
    dismissedAtMs: Long? = null,
    installLaunches: Boolean = true,
): InstallPromptSource =
    object : InstallPromptSource {
        private var dismissedAt: Long? = dismissedAtMs

        override fun isInstallSupported(): Boolean = installSupported

        override fun isAlreadyInstalled(): Boolean = alreadyInstalled

        override fun dismissedAtMs(): Long? = dismissedAt

        override fun markDismissed(nowMs: Long) {
            dismissedAt = nowMs
        }

        override fun requestInstall(): Boolean = installLaunches
    }
