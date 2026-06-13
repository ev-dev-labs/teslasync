// Pure, framework-free model + projection + diagnostics for the MaintenanceBanner shared surface — the native
// analogue of every value the web component derives before returning JSX
// (web/src/components/feedback/MaintenanceBanner.tsx). No Compose, no Android framework, no HTTP: every
// declaration here is exercised off-device by the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer over these pure functions.
//
// WHAT THE WEB SOURCE IS (and therefore the COMPLETE branch set this surface reproduces). The web file is a
// sticky top-of-app banner that polls `/api/v1/system/health` (via `useSystemHealth`) and renders when the
// resolved service `mode` is `degraded` or `maintenance`. It carries a title, a body (the operator message or
// a per-mode default), a live one-second countdown to `maintenance_until`, and a per-snapshot dismiss control
// keyed on a fingerprint of `maintenance_updated_at` (or mode/message/until when updated_at is absent) so a
// dismissal sticks for THAT banner state but a freshly-pushed operator banner re-surfaces. When `mode === 'ok'`
// or the health read has not resolved (`!data`) the web returns `null` — the banner is simply absent.
//
// HOW THAT MAPS ONTO THE NATIVE WIRED STATE (P1/S8, ADR-002/013). `useSystemHealth` is the shared
// `AdminStore.systemHealth()` feed — the `/system/health` cache-then-network `Resource` every native Admin
// surface already shares (the same feed `SystemHealthWidget` binds). [MaintenanceBannerSnapshot.fromJson] is
// the cached-payload → typed-projection data adapter the source plugs in, and [MaintenanceBannerProjection]
// folds that snapshot together with the current clock and the per-snapshot dismissal into the exact branch the
// banner renders. The data-envelope states the web hides behind `!data` are reproduced honestly through the
// ADR-013 freshness contract: a cold load with nothing cached and a hard failure with nothing cached both keep
// the banner absent (web `!data`), while an active window served from a stale cache or after a failed refresh
// keeps the banner visible with an explicit "Stale" chip (offline / last-known) rather than presenting stale
// state as live.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/MaintenanceBanner — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment is illegal in a package identifier), so the package intentionally diverges
// from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.maintenancebanner

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.time.Instant

/**
 * Canonical registry metadata for the MaintenanceBanner surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`MaintenanceBanner`);
 * [ID] is the stable `viewModel` key the host binds the surface with.
 */
object MaintenanceBannerRegistration {
    /** Stable surface id (also the `viewModel` key the host binds the surface with). */
    const val ID: String = "maintenance-banner"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "MaintenanceBanner"
}

/**
 * The resolved service-mode bucket the banner keys its variant off — the native port of the web
 * `data?.mode` values:
 *  - [Ok] — the banner is hidden (web `mode === 'ok'`, plus the absent / unknown read);
 *  - [Degraded] — the sky-toned "Service is degraded" variant;
 *  - [Maintenance] — the amber-toned "Scheduled maintenance" variant.
 */
enum class ServiceMode {
    Ok,
    Degraded,
    Maintenance,
    ;

    companion object {
        /** The `ok` wire value — banner hidden (web `mode === 'ok'`). */
        const val RAW_OK: String = "ok"

        /** The `degraded` wire value — the sky-toned variant. */
        const val RAW_DEGRADED: String = "degraded"

        /** The `maintenance` wire value — the amber-toned variant. */
        const val RAW_MAINTENANCE: String = "maintenance"

        /**
         * Maps the raw `/system/health` `mode` string onto the typed bucket; anything that is not an explicit
         * `degraded` / `maintenance` (including `ok`, `null`, and any unknown value) collapses to [Ok] — the
         * banner-hidden default (web `data?.mode ?? 'ok'`).
         */
        fun fromRaw(raw: String?): ServiceMode =
            when (raw) {
                RAW_MAINTENANCE -> Maintenance
                RAW_DEGRADED -> Degraded
                else -> Ok
            }
    }
}

/**
 * The slice of the `/system/health` document this banner reads — the native mirror of the four `SystemHealth`
 * fields the web component touches (web/src/types/admin.ts). The full DTO also carries `status`, `components`,
 * `databaseSize`, `tableCount`, and `source`, none of which the banner renders (those back the separate
 * SystemHealthWidget), so they are deliberately omitted (DRY — the model carries only what the surface renders).
 *
 * @property rawMode the raw `mode` string (`ok` default); kept verbatim because the dismissal [fingerprint]
 *   hashes it exactly as the web does, and [mode] resolves it to the typed bucket.
 * @property message the operator banner text (web `maintenance_message`); blank/absent falls back at render.
 * @property untilIso the ISO-8601 auto-clear instant (web `maintenance_until`), or `""` for none.
 * @property updatedAtIso the ISO-8601 snapshot stamp (web `maintenance_updated_at`); the primary dismissal key.
 * @property present whether the `/system/health` read resolved to an object at all — distinguishes a cold load
 *   / hard failure with nothing cached (web `!data` → banner absent) from a resolved `ok` snapshot.
 */
data class MaintenanceBannerSnapshot(
    val rawMode: String,
    val message: String,
    val untilIso: String,
    val updatedAtIso: String,
    val present: Boolean,
) {
    /** The resolved service-mode bucket (web `data?.mode ?? 'ok'`). */
    val mode: ServiceMode get() = ServiceMode.fromRaw(rawMode)

    /** Whether this snapshot drives a visible banner variant (web `mode !== 'ok'`), given the read resolved. */
    val isActive: Boolean get() = present && mode != ServiceMode.Ok

    companion object {
        private const val KEY_MODE = "mode"
        private const val KEY_MESSAGE = "maintenance_message"
        private const val KEY_UNTIL = "maintenance_until"
        private const val KEY_UPDATED_AT = "maintenance_updated_at"

        /** The pre-resolution snapshot: no read yet (web `!data`); the banner stays absent. */
        val ABSENT: MaintenanceBannerSnapshot =
            MaintenanceBannerSnapshot(rawMode = ServiceMode.RAW_OK, message = "", untilIso = "", updatedAtIso = "", present = false)

        /**
         * Parses the shared store's raw `/system/health` [json] into the typed slice this banner reads — the
         * data adapter the source plugs into the feed. Snake_case keys are read verbatim (the shared
         * `AdminRepository` carries the server JSON unchanged); a missing `mode` defaults to `ok` (banner
         * hidden), absent string fields collapse to `""`, and a non-object payload yields `null` so a
         * `Resource.Loading` with no cache stays a first-load (web `!data`) rather than a resolved snapshot.
         */
        fun fromJson(json: JsonElement?): MaintenanceBannerSnapshot? {
            val obj = json as? JsonObject ?: return null
            return MaintenanceBannerSnapshot(
                rawMode = obj.string(KEY_MODE) ?: ServiceMode.RAW_OK,
                message = obj.string(KEY_MESSAGE) ?: "",
                untilIso = obj.string(KEY_UNTIL) ?: "",
                updatedAtIso = obj.string(KEY_UPDATED_AT) ?: "",
                present = true,
            )
        }

        private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull
    }
}

/**
 * The localized-at-the-boundary countdown line the banner shows under the body — the native mirror of the web
 * `countdown` ternary. Carries only the locale-stable formatted duration ([EndsIn.formatted]); the surrounding
 * "Ends in {time}" / "Ending now" / "Window has ended…" copy resolves through the P1/S10 catalog at render.
 */
sealed interface Countdown {
    /** A still-running window (web `remaining > 1000`): "Ends in {formatted}" where [formatted] is e.g. "29m 59s". */
    data class EndsIn(
        val formatted: String,
    ) : Countdown

    /** The imminent edge (web `remaining > -1000`): "Ending now". */
    data object EndingNow : Countdown

    /** The window's end instant is already in the past (web else branch): "Window has ended; refresh to confirm.". */
    data object Ended : Countdown
}

/**
 * The fully-resolved, render-ready view of the banner — the native analogue of everything the web component
 * computes before returning JSX. It folds the `/system/health` snapshot, the current clock, the dismissal, and
 * the feed-freshness envelope into the exact branch decisions the composable renders, so the surface stays a
 * thin render layer and each rule has one test-pinned definition.
 *
 * @property visible whether the banner renders at all (web `!data || mode === 'ok' ? null` plus the dismissal).
 * @property maintenance the amber maintenance variant (web `isMaintenance`); else the sky degraded variant.
 * @property message the operator banner text, or `null`/blank to fall back to the per-mode default at render.
 * @property countdown the resolved countdown line, or `null` when there is no parseable `maintenance_until`.
 * @property stale whether the rendered window is served stale / last-known (offline) — drives the "Stale" chip.
 * @property currentKey the dismissal fingerprint of this snapshot; the composable hands it back on dismiss.
 */
data class MaintenanceBannerRender(
    val visible: Boolean,
    val maintenance: Boolean,
    val message: String?,
    val countdown: Countdown?,
    val stale: Boolean,
    val currentKey: String,
) {
    /** The sky degraded variant (web `!isMaintenance`); the complement of [maintenance], for symmetric reads. */
    val degraded: Boolean get() = !maintenance

    /** Whether the freshness "Stale" chip should render — a visible, stale, last-known window (ADR-013). */
    val showStaleChip: Boolean get() = visible && stale
}

/**
 * Pure projection of a [MaintenanceBannerSnapshot] (plus the clock, dismissal, and freshness envelope) into the
 * [MaintenanceBannerRender] — the native mirror of every branch the web component takes. Framework-free so the
 * whole contract is covered by the JVM unit gate without a Compose host.
 */
object MaintenanceBannerProjection {
    /** Below this many ms remaining the line reads "Ending now" rather than a duration (web `remaining > 1000`). */
    private const val ENDS_IN_THRESHOLD_MS: Long = 1_000L

    /** Below this many ms remaining (i.e. >1s past the end) the line reads "ended" (web `remaining > -1000`). */
    private const val ENDING_NOW_FLOOR_MS: Long = -1_000L

    private const val MILLIS_PER_SECOND: Long = 1_000L
    private const val SECONDS_PER_MINUTE: Long = 60L
    private const val SECONDS_PER_HOUR: Long = 3_600L
    private const val PAD_WIDTH: Int = 2

    /**
     * The per-snapshot dismissal fingerprint — a 1:1 port of the web `fingerprint(mode, message, until,
     * updatedAt)`: a present `updated_at` is the authoritative key (`u:<stamp>`), otherwise a deterministic
     * hash of the mode / message / until content (`s:<mode>|<message>|<until>`). This keeps an operator's
     * "I just pushed a new banner" workflow honest — any change to the snapshot yields a new key, so a prior
     * dismissal does not swallow a fresh announcement.
     */
    fun fingerprint(snapshot: MaintenanceBannerSnapshot): String =
        if (snapshot.updatedAtIso.isNotEmpty()) {
            "u:${snapshot.updatedAtIso}"
        } else {
            "s:${snapshot.rawMode}|${snapshot.message}|${snapshot.untilIso}"
        }

    /**
     * Folds the [snapshot], the current [nowMs], the [dismissedKey], and the feed-freshness flags into the
     * render state. Mirrors the web visibility gate (`!data || mode === 'ok'` → hidden, plus the
     * `dismissedKey === currentKey` → hidden), the maintenance/degraded variant split, the message → per-mode
     * default fallback, and the countdown ternary. [stale] is the ADR-013 offline / last-known flag (the web
     * banner has no such chip; native discloses it rather than presenting stale state as live).
     */
    fun render(
        snapshot: MaintenanceBannerSnapshot,
        nowMs: Long,
        dismissedKey: String?,
        stale: Boolean = false,
    ): MaintenanceBannerRender {
        val key = fingerprint(snapshot)
        val dismissed = dismissedKey != null && dismissedKey == key
        val visible = snapshot.isActive && !dismissed
        return MaintenanceBannerRender(
            visible = visible,
            maintenance = snapshot.mode == ServiceMode.Maintenance,
            message = snapshot.message.trim().ifBlank { null },
            countdown = countdownFor(parseUntil(snapshot.untilIso), nowMs),
            stale = stale,
            currentKey = key,
        )
    }

    /**
     * Resolves the countdown line from the parsed end instant [untilMs] and the current [nowMs] — the native
     * port of the web `remaining` ternary: a future end → [Countdown.EndsIn] with the short duration, the
     * sub-second edge → [Countdown.EndingNow], a past end → [Countdown.Ended], and no end → `null`.
     */
    fun countdownFor(
        untilMs: Long?,
        nowMs: Long,
    ): Countdown? {
        if (untilMs == null) return null
        val remaining = untilMs - nowMs
        return when {
            remaining > ENDS_IN_THRESHOLD_MS -> Countdown.EndsIn(formatRemaining(remaining))
            remaining > ENDING_NOW_FLOOR_MS -> Countdown.EndingNow
            else -> Countdown.Ended
        }
    }

    /**
     * Renders a positive [ms] duration as the web's zero-padded short form: "Hh MMm" above an hour, "Mm SSs"
     * above a minute, else "Ss". Locale-stable (no grouping separators), so it lives in the pure model and the
     * surrounding localized template ("Ends in {time}") is applied at the render boundary.
     */
    fun formatRemaining(ms: Long): String {
        val total = (ms / MILLIS_PER_SECOND).coerceAtLeast(0L)
        val hours = total / SECONDS_PER_HOUR
        val minutes = (total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE
        val seconds = total % SECONDS_PER_MINUTE
        return when {
            hours > 0L -> "${hours}h ${minutes.pad()}m"
            minutes > 0L -> "${minutes}m ${seconds.pad()}s"
            else -> "${seconds}s"
        }
    }

    /**
     * Parses an ISO-8601 `maintenance_until` [raw] to epoch millis — the native port of the web
     * `Date.parse(maintenance_until)` with its `Number.isFinite` guard: a blank or unparseable value yields
     * `null` (the web `null` branch), so the countdown affordance is simply not shown.
     */
    fun parseUntil(raw: String): Long? =
        if (raw.isBlank()) {
            null
        } else {
            runCatching { Instant.parse(raw).toEpochMilli() }.getOrNull()
        }

    private fun Long.pad(): String = toString().padStart(PAD_WIDTH, '0')
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [MaintenanceBannerRegistration.SLUG]
 * (P1/S11) — never the maintenance message, mode, or end time — so a diagnostics line can never leak the
 * fleet's operational posture. Kept free of Compose so it is unit-tested with a recording [Logger]; the
 * ViewModel calls it once per surface open.
 */
fun recordMaintenanceBannerOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to MaintenanceBannerRegistration.SLUG))
}
