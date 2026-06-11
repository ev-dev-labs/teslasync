// Pure, framework-free model + projection for the Software Update Status dashboard widget — the native
// analogue of the data the web component derives before returning JSX
// (web/src/features/dashboard/widgets/SoftwareUpdateStatusWidget.tsx). No Compose, no Android framework,
// no HTTP: every type here is unit-tested off device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/SoftwareUpdateStatusWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so
// the package intentionally diverges from the path — exactly as the sibling ClimateStatusWidget does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.softwareupdatestatus

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlin.math.floor

/** Em dash shown for a missing value — the web `'—'` fallback (`version || '—'`). */
internal const val EM_DASH: String = "\u2014"

/** Percent suffix the web appends to the download/install progress (`${pct}%`). */
internal const val PERCENT_SUFFIX: String = "%"

// Vehicle-config snapshot field names read off `/vehicle-config/latest` (web `VehicleConfigSnapshot`).
private const val FIELD_UPDATE_VERSION = "software_update_version"
private const val FIELD_DOWNLOAD_PCT = "software_update_download_pct"
private const val FIELD_INSTALL_PCT = "software_update_install_pct"
private const val FIELD_EXPECTED_DURATION = "software_update_expected_duration"
private const val FIELD_SCHEDULED_START = "software_update_scheduled_start"

// Progress thresholds mirroring the web `updateStatus` useMemo (`> 0 && < 100`, `=== 100`).
private const val PCT_MIN = 0.0
private const val PCT_MAX = 100.0

/**
 * The widget grid footprint (columns × rows) — the Android port of the web `WidgetProps.size`. The web
 * widget switches to a centered tile when `size.cols <= 1 && size.rows <= 1` ([isCompact]) and reveals the
 * estimated-time / scheduled-start detail rows only when `size.rows >= 2` ([isTall]).
 */
data class SoftwareUpdateStatusSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at the 1×1 footprint (web `isCompact = size.cols <= 1 && size.rows <= 1`): the centered tile. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_DIM && rows <= COMPACT_MAX_DIM

    /** True at two rows or more (web `isTall = size.rows >= 2`): show the est-time / scheduled rows. */
    val isTall: Boolean get() = rows >= TALL_MIN_ROWS

    private companion object {
        const val COMPACT_MAX_DIM = 1
        const val TALL_MIN_ROWS = 2
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/vehicle.ts (`software-update-status`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web grids
 * stay in lockstep.
 */
object SoftwareUpdateStatusRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "software-update-status"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "vehicle"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SoftwareUpdateStatusWidget"

    /** Default footprint: 2 columns × 2 rows. */
    val DEFAULT_SIZE: SoftwareUpdateStatusSize = SoftwareUpdateStatusSize(cols = 2, rows = 2)

    /** Minimum footprint: 1 column × 2 rows. */
    val MIN_SIZE: SoftwareUpdateStatusSize = SoftwareUpdateStatusSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows. */
    val MAX_SIZE: SoftwareUpdateStatusSize = SoftwareUpdateStatusSize(cols = 4, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: SoftwareUpdateStatusSize): Boolean =
        size.cols in MIN_SIZE.cols..MAX_SIZE.cols && size.rows in MIN_SIZE.rows..MAX_SIZE.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: SoftwareUpdateStatusSize): SoftwareUpdateStatusSize =
        SoftwareUpdateStatusSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * The update lifecycle phase — the native analogue of the web `updateStatus` string union. The render
 * layer resolves each kind's localized status-chip label + tone and which progress affordance to draw.
 */
enum class UpdateStatus {
    /** No pending update (web `'up-to-date'`): success tone + the "Up to date" footer. */
    UpToDate,

    /** An update exists but download has not started (web `'available'`): info tone. */
    Available,

    /** Download in progress, `0 < pct < 100` (web `'downloading'`): warning tone + the download bar. */
    Downloading,

    /** Download complete, ready to install, `downloadPct === 100` (web `'ready'`): info tone + ready row. */
    Ready,

    /** Install in progress, `0 < pct < 100` (web `'installing'`): warning tone + the install bar. */
    Installing,

    /** Install complete, `installPct === 100` (web `'installed'`): success tone. */
    Installed,
}

/**
 * The cache-then-network snapshot folded from the active vehicle's state + latest config — the native port
 * of the web `state` + `configData` reads in `SoftwareUpdateStatusWidget.tsx`. Pure data (no Compose), so
 * the field reads and the `updateStatus` derivation are unit-tested directly. Reads are null-tolerant so a
 * partial config row never throws (web `?? null` parity).
 *
 * @property hasState whether the vehicle-state envelope decoded a state object (web `state` truthy); when
 *   false the surface renders its "No software data" empty state.
 * @property currentVersion the installed firmware version (web `state?.software_version`), or `null` when no
 *   state; may be blank (the render resolves the em dash, web `version || '—'`).
 * @property updateVersion the available target version (web `software_update_version`), blank/absent ⇒ null
 *   (web treats a falsy version as "no update").
 * @property downloadPct the download progress 0–100 (web `software_update_download_pct`), or `null`.
 * @property installPct the install progress 0–100 (web `software_update_install_pct`), or `null`.
 * @property expectedDuration the estimated install duration in minutes (web
 *   `software_update_expected_duration`), or `null`.
 * @property scheduledStart the scheduled-start label (web `software_update_scheduled_start`), or `null`.
 */
data class SoftwareUpdateSnapshot(
    val hasState: Boolean,
    val currentVersion: String?,
    val updateVersion: String?,
    val downloadPct: Double?,
    val installPct: Double?,
    val expectedDuration: Double?,
    val scheduledStart: String?,
) {
    companion object {
        /** The no-state snapshot (web `state` falsy): the surface shows its empty state. */
        val EMPTY: SoftwareUpdateSnapshot =
            SoftwareUpdateSnapshot(
                hasState = false,
                currentVersion = null,
                updateVersion = null,
                downloadPct = null,
                installPct = null,
                expectedDuration = null,
                scheduledStart = null,
            )

        /**
         * Folds the active vehicle's [state] envelope and latest-config [config] document into a snapshot —
         * the native port of `currentVersion = state?.software_version ?? '—'` plus the five
         * `configData?.software_update_*` reads. A `null`/`JsonNull`/non-object [config] yields all-null
         * update fields (web `configData` undefined ⇒ "up to date"), and a `null` state ⇒ [hasState] false.
         */
        fun from(
            state: VehicleStateEnvelope?,
            config: JsonElement?,
        ): SoftwareUpdateSnapshot {
            val vehicleState = state?.state
            val obj = config as? JsonObject
            return SoftwareUpdateSnapshot(
                hasState = vehicleState != null,
                currentVersion = vehicleState?.softwareVersion,
                updateVersion = obj?.stringField(FIELD_UPDATE_VERSION)?.takeIf { it.isNotBlank() },
                downloadPct = obj?.doubleField(FIELD_DOWNLOAD_PCT),
                installPct = obj?.doubleField(FIELD_INSTALL_PCT),
                expectedDuration = obj?.doubleField(FIELD_EXPECTED_DURATION),
                scheduledStart = obj?.stringField(FIELD_SCHEDULED_START)?.takeIf { it.isNotBlank() },
            )
        }
    }
}

/**
 * The fully projected, render-ready view of the software-update state for one footprint — the native
 * analogue of everything `SoftwareUpdateStatusWidget.tsx` computes before returning JSX (the `updateStatus`
 * useMemo, `isCompact`, `isTall`, and every conditional render branch). Pure data (no Compose types) with
 * the per-branch `show*` flags exposed as derived properties, so every branch is unit-tested directly.
 *
 * @property hasState whether a vehicle state decoded (web `state` truthy); drives the empty surface.
 * @property currentVersionText the installed version resolved to the em dash when blank (web `version || '—'`).
 * @property updateVersion the available target version, or `null` when up to date.
 * @property status the derived [UpdateStatus] (web `updateStatus`).
 * @property downloadPct / [installPct] the progress values 0–100, or `null`.
 * @property expectedDuration the estimated install minutes, or `null`.
 * @property scheduledStart the scheduled-start label, or `null` when absent/blank.
 * @property isCompact the 1×1 footprint flag (centered tile).
 * @property isTall the ≥2-row footprint flag (reveals the est-time / scheduled rows).
 */
data class SoftwareUpdateDisplay(
    val hasState: Boolean,
    val currentVersionText: String,
    val updateVersion: String?,
    val status: UpdateStatus,
    val downloadPct: Double?,
    val installPct: Double?,
    val expectedDuration: Double?,
    val scheduledStart: String?,
    val isCompact: Boolean,
    val isTall: Boolean,
) {
    /** Show the update block (web `updateVersion && updateStatus !== 'up-to-date'`). */
    val showUpdateSection: Boolean get() = updateVersion != null && status != UpdateStatus.UpToDate

    /** Show the download progress bar (web `updateStatus === 'downloading' && downloadPct != null`). */
    val showDownloadBar: Boolean get() = status == UpdateStatus.Downloading && downloadPct != null

    /** Show the install progress bar (web `updateStatus === 'installing' && installPct != null`). */
    val showInstallBar: Boolean get() = status == UpdateStatus.Installing && installPct != null

    /** Show the "Ready to install" row (web `updateStatus === 'ready'`). */
    val showReady: Boolean get() = status == UpdateStatus.Ready

    /** Show the estimated-time row (web `isTall && expectedDuration != null && expectedDuration > 0`). */
    val showExpectedDuration: Boolean
        get() = showUpdateSection && isTall && (expectedDuration ?: 0.0) > 0.0

    /** Show the scheduled-start row (web `isTall && scheduledStart`). */
    val showScheduled: Boolean get() = showUpdateSection && isTall && !scheduledStart.isNullOrBlank()

    /** Show the "Up to date" footer (web `updateStatus === 'up-to-date'`). */
    val showUpToDate: Boolean get() = status == UpdateStatus.UpToDate
}

/**
 * Pure projection from a decoded [SoftwareUpdateSnapshot] to the render-ready [SoftwareUpdateDisplay] — the
 * native port of the `updateStatus` useMemo and the compact/tall branches in
 * `SoftwareUpdateStatusWidget.tsx`. Side-effect-free so the gate unit-tests it without a device.
 */
object SoftwareUpdateProjection {
    /** Project [snapshot] for [size] into the render model. */
    fun project(
        snapshot: SoftwareUpdateSnapshot,
        size: SoftwareUpdateStatusSize,
    ): SoftwareUpdateDisplay =
        SoftwareUpdateDisplay(
            hasState = snapshot.hasState,
            currentVersionText = snapshot.currentVersion?.takeIf { it.isNotBlank() } ?: EM_DASH,
            updateVersion = snapshot.updateVersion,
            status = status(snapshot.updateVersion, snapshot.downloadPct, snapshot.installPct),
            downloadPct = snapshot.downloadPct,
            installPct = snapshot.installPct,
            expectedDuration = snapshot.expectedDuration,
            scheduledStart = snapshot.scheduledStart?.takeIf { it.isNotBlank() },
            isCompact = size.isCompact,
            isTall = size.isTall,
        )

    /**
     * Derives the [UpdateStatus] — verbatim parity with the web `updateStatus` useMemo: no version ⇒
     * up-to-date; an in-flight install (`0 < pct < 100`) wins over an in-flight download; a completed
     * install/download maps to installed/ready; otherwise the update is merely available.
     */
    fun status(
        updateVersion: String?,
        downloadPct: Double?,
        installPct: Double?,
    ): UpdateStatus =
        when {
            updateVersion == null -> UpdateStatus.UpToDate
            installPct != null && installPct > PCT_MIN && installPct < PCT_MAX -> UpdateStatus.Installing
            downloadPct != null && downloadPct > PCT_MIN && downloadPct < PCT_MAX -> UpdateStatus.Downloading
            installPct == PCT_MAX -> UpdateStatus.Installed
            downloadPct == PCT_MAX -> UpdateStatus.Ready
            else -> UpdateStatus.Available
        }
}

/** Render-layer number formatting for the dimensionless progress / duration values (no SI conversion). */
object SoftwareUpdateFormat {
    /** Formats a progress value as the web does (`${pct}%`): a whole number drops its fractional part. */
    fun percent(value: Double): String = trimZero(value) + PERCENT_SUFFIX

    /** Formats the estimated duration as the web does (`~{expectedDuration}`): the bare number. */
    fun duration(value: Double): String = trimZero(value)

    private fun trimZero(value: Double): String =
        if (value.isFinite() && value == floor(value)) value.toLong().toString() else value.toString()
}

/** Read a numeric field, or `null` when absent / `JsonNull` / not a JSON number (web typed `number`). */
private fun JsonObject.doubleField(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

/** Read a JSON string field, or `null` when absent / `JsonNull` / not a quoted string (web typed `string`). */
private fun JsonObject.stringField(key: String): String? =
    (this[key] as? JsonPrimitive)?.let { if (it.isString) it.contentOrNull else null }

/**
 * The active vehicle id the widget reads state + config for — the native port of the web
 * `id = vehicleId ?? vehicles?.[0]?.id ?? 0`. A positive [preferredVehicleId] wins; otherwise the first
 * enrolled vehicle is used; `null` means neither is available (the surface shows its empty state).
 */
fun resolveVehicleId(
    preferredVehicleId: Long?,
    vehicles: List<Vehicle>?,
): Long? = preferredVehicleId?.takeIf { it > 0L } ?: firstVehicleId(vehicles)

/** The first enrolled vehicle's id, or `null` when the fleet list is absent or empty. */
fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id?.takeIf { it > 0L }
