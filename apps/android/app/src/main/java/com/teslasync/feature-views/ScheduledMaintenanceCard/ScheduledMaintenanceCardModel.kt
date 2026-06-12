// Pure, framework-free model + projection backing the Compose [ScheduledMaintenanceCard] feature view — the
// native analogue of every value the web component derives before returning JSX
// (web/src/features/system/components/status/ScheduledMaintenanceCard.tsx). No Compose, no Android UI, no
// HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer over these pure functions.
//
// ScheduledMaintenanceCard is the operator control on /system-status that surfaces the active maintenance
// window (when the system mode is `maintenance`) and lets the operator schedule a new window or clear the
// active one inline. The web component reads `/admin/maintenance` via `useMaintenanceState()` and writes via
// `useUpdateMaintenance()` (the `useAdmin` hook domain). This file owns the parts the web render derives from
// that payload, with nothing to do with Compose:
//   • the active branch — web `state?.mode === 'maintenance'`;
//   • the parsed `maintenance_until` epoch + the whole-minutes-remaining (web `minutesToStart`);
//   • the "within 24h" amber heads-up — web `isActive && untilTs - now <= ONE_DAY_MS && untilTs - now > 0`;
//   • the ended / ending-now edge of the countdown the web folds into its "Active until …" line;
//   • the typed toast set the two mutations raise.
//
// Binding (P1/S8): this surface performs NO HTTP. The owning host wires the shared
// `AdminStore.maintenanceState()` feed (the cross-platform port of `useMaintenanceState`, in :core) into the
// [ScheduledMaintenanceCardViewModel] through [ScheduledMaintenanceSource]; the write routes through
// `AdminStore.updateMaintenance` (the port of `useUpdateMaintenance`), which refreshes both the maintenance
// and system-health feeds exactly as the web hook invalidates both query keys. [MaintenanceSnapshot.fromJson]
// is the cached-payload → typed-projection data adapter that bridge is unit-tested on.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ScheduledMaintenanceCard — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.scheduledmaintenancecard

import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.time.Instant

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no operator payload. */
const val SCHEDULED_MAINTENANCE_SLUG: String = "ScheduledMaintenanceCard"

/** The `maintenance` system mode — web `state?.mode === 'maintenance'` marks the window active. */
internal const val MAINTENANCE_MODE: String = "maintenance"

/** The `ok` system mode — clearing a window writes this (web `handleClear` → `{ mode: 'ok' }`). */
internal const val OK_MODE: String = "ok"

/**
 * The slice of the `/admin/maintenance` document this card reads — the native mirror of the three
 * `MaintenanceState` fields the web component renders (web/src/types/admin.ts). The full DTO also carries
 * `updated_at`, `updated_by`, `source`, and `env_override_mode`, which the ScheduledMaintenanceCard never
 * shows (those back the separate ServiceMode admin panel), so they are deliberately omitted (DRY — the model
 * carries only what the surface renders, like the sibling FrontendErrorsCard port).
 *
 * @property mode the system mode (`ok` / `degraded` / `maintenance`); `maintenance` marks the window active.
 * @property message the operator banner text (web `maintenance_message`); blank/absent falls back at render.
 * @property untilIso the ISO-8601 auto-clear instant (web `maintenance_until`), or `null` for none.
 */
data class MaintenanceSnapshot(
    val mode: String,
    val message: String?,
    val untilIso: String?,
) {
    /** Web `state?.mode === 'maintenance'`: a window is active right now. */
    val isActive: Boolean get() = mode == MAINTENANCE_MODE

    companion object {
        private const val KEY_MODE = "mode"
        private const val KEY_MESSAGE = "maintenance_message"
        private const val KEY_UNTIL = "maintenance_until"

        /** The friendly default the card resolves to when the read replays an unexpected (non-object) payload. */
        val DEFAULT: MaintenanceSnapshot = MaintenanceSnapshot(mode = OK_MODE, message = null, untilIso = null)

        /**
         * Parses the shared store's raw `/admin/maintenance` [JsonElement] into the typed slice this card
         * reads — the data adapter the host plugs into [toMaintenanceUiState]. Snake_case keys are read
         * verbatim (the shared `AdminRepository` carries the server JSON unchanged); a non-object payload
         * yields `null`, a missing `mode` defaults to `ok` (banner hidden), and an explicit JSON `null`
         * `maintenance_until` collapses to `null` (web `maintenance_until: string | null`).
         */
        fun fromJson(json: JsonElement?): MaintenanceSnapshot? {
            val obj = json as? JsonObject ?: return null
            return MaintenanceSnapshot(
                mode = obj.string(KEY_MODE) ?: OK_MODE,
                message = obj.string(KEY_MESSAGE),
                untilIso = obj.string(KEY_UNTIL),
            )
        }

        private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull
    }
}

/**
 * The fully projected, render-ready view of the maintenance window — the native analogue of everything the
 * web component computes before returning JSX. It folds the `/admin/maintenance` read together with the
 * current time into the exact branch decisions the card renders, so the composable stays a thin render layer
 * and the rule has one test-pinned definition.
 *
 * @property active the window is active right now (web `isActive`).
 * @property message the operator banner text, or `null`/blank to fall back to the default copy at render.
 * @property untilMillis the parsed auto-clear instant as epoch millis, or `null` when absent/unparseable.
 * @property minutesRemaining whole minutes until the window ends (web `minutesToStart`), or `null` when the
 *   window is inactive or has no parseable end; floored at the wire value (can be `<= 0` when already past).
 * @property within24h the amber heads-up condition — active with an end inside the next 24h (web `within24h`).
 * @property ended the window is active but its end instant is already in the past (web "Until …" fallthrough).
 * @property endingNow the window ends in under a minute — the imminent edge of the countdown.
 */
data class ScheduledMaintenanceView(
    val active: Boolean,
    val message: String?,
    val untilMillis: Long?,
    val minutesRemaining: Long?,
    val within24h: Boolean,
    val ended: Boolean,
    val endingNow: Boolean,
) {
    companion object {
        /** Milliseconds in a day — the web `ONE_DAY_MS` constant for the 24h heads-up window. */
        const val ONE_DAY_MS: Long = 24L * 60L * 60L * 1000L

        /** Milliseconds in a minute — the divisor for the whole-minutes-remaining floor (web `/ 60_000`). */
        const val MINUTE_MS: Long = 60_000L

        /** Under this many whole minutes remaining, the countdown reads "Ending now" rather than a duration. */
        const val ENDING_NOW_MINUTES: Long = 1L

        /**
         * Projects the [snapshot] and the current time [nowMs] onto the render-ready [ScheduledMaintenanceView]
         * — the data adapter the composable renders and the unit test drives directly (snapshot → projection).
         * Mirrors the web component's `isActive` / `untilTs` / `minutesToStart` / `within24h` derivations.
         */
        fun from(
            snapshot: MaintenanceSnapshot,
            nowMs: Long,
        ): ScheduledMaintenanceView {
            val active = snapshot.isActive
            val untilMillis = parseUntil(snapshot.untilIso)
            val remaining = minutesRemaining(active, untilMillis, nowMs)
            val deltaMs = if (active && untilMillis != null) untilMillis - nowMs else null
            return ScheduledMaintenanceView(
                active = active,
                message = snapshot.message,
                untilMillis = untilMillis,
                minutesRemaining = remaining,
                within24h = deltaMs != null && deltaMs > 0L && deltaMs <= ONE_DAY_MS,
                ended = active && untilMillis != null && (deltaMs ?: 0L) <= 0L,
                endingNow = remaining != null && remaining in ENDING_NOW_GAP,
            )
        }

        /**
         * Whole minutes until [untilMillis], floored (web `Math.floor((untilTs - now) / 60_000)`); `null`
         * unless the window is [active] with a parseable end. Can be `<= 0` once the end instant is past.
         */
        fun minutesRemaining(
            active: Boolean,
            untilMillis: Long?,
            nowMs: Long,
        ): Long? {
            if (!active || untilMillis == null) return null
            return Math.floorDiv(untilMillis - nowMs, MINUTE_MS)
        }

        /**
         * Parses an ISO-8601 `maintenance_until` [raw] to epoch millis — the native port of the web
         * `Date.parse(maintenance_until)` with its `Number.isFinite` guard: a blank or unparseable value
         * yields `null` (the web `null` branch) so the "ends" affordances are simply not shown.
         */
        fun parseUntil(raw: String?): Long? =
            if (raw.isNullOrBlank()) {
                null
            } else {
                runCatching { Instant.parse(raw).toEpochMilli() }.getOrNull()
            }

        // 0 <= remaining < ENDING_NOW_MINUTES → "Ending now": a sub-minute positive gap floors to 0, which is
        // the imminent edge we flag distinctly from a still-counting duration and from an already-ended window.
        private val ENDING_NOW_GAP = 0L until ENDING_NOW_MINUTES
    }
}

/**
 * The typed, localized-at-the-boundary toasts the surface raises for its mutations — the native analogue of
 * the web component's `useToast` calls. The web raises distinct success copy for schedule vs clear, but the
 * P1/S10 catalog carries one maintenance success key (`toast.admin.maintenance.success`) and one failure key
 * (`toast.admin.maintenance.error`), so both writes fold onto [Saved] / [Failed] — the same string the shared
 * catalog already ships, so a write is never silent and no English literal lives in code.
 */
sealed interface MaintenanceToast {
    /** A schedule or clear write succeeded — web `toast.success(...)`; catalog `toast.admin.maintenance.success`. */
    data object Saved : MaintenanceToast

    /** A schedule or clear write failed — web `toast.error(...)`; catalog `toast.admin.maintenance.error`. */
    data object Failed : MaintenanceToast
}

/**
 * Maps the shared `AdminStore.maintenanceState()` feed's cache-then-network [Resource] (raw `JsonElement`,
 * P1/S8) onto the Android [UiState] this card binds — the single seam the host wires the surface up with
 * (`store.maintenanceState().map { it.toMaintenanceUiState() }`). The cached payload is parsed through
 * [MaintenanceSnapshot.fromJson] at every emission so an instant cold-start cache replay and an offline "last
 * known" value both render the real window, and a present-but-unparseable success falls back to the friendly
 * default (mode `ok` → the scheduler). The emptiness predicate is `false`: the maintenance state always
 * resolves to a mode, so the panel always renders content (web parity — the scheduler IS the friendly
 * not-active content), never an empty box.
 */
fun Resource<JsonElement>.toMaintenanceUiState(): UiState<MaintenanceSnapshot> = mapToSnapshot().toUiState { false }

private fun Resource<JsonElement>.mapToSnapshot(): Resource<MaintenanceSnapshot> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(cached = MaintenanceSnapshot.fromJson(cached), fetchedAt = fetchedAt, stale = stale)

        is Resource.Success ->
            Resource.Success(
                data = MaintenanceSnapshot.fromJson(data) ?: MaintenanceSnapshot.DEFAULT,
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Error ->
            Resource.Error(cached = MaintenanceSnapshot.fromJson(cached), fetchedAt = fetchedAt, stale = stale, error = error)
    }

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * maintenance message, mode, or end time — so a diagnostics line can never leak the fleet's operational
 * posture.
 */
object ScheduledMaintenanceCardDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = SCHEDULED_MAINTENANCE_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the holder's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
