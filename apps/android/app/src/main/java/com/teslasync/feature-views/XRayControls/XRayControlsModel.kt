// Pure, framework-free model + projection for the Ingest X-Ray controls feature view — the native analogue
// of everything the web component derives before returning JSX
// (web/src/features/admin/components/ingest-xray/XRayControls.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable
// a thin render layer.
//
// The web component is a controlled controls bar: it receives the fleet `vehicles`, the current `vehicleId`,
// `windowSel`, and `bucketSel` plus three change callbacks, and renders three `Select`s constrained to the
// server-accepted literals so a typo never round-trips a 400. The bucket select auto-disables any bucket
// whose span is >= the current window to avoid the server-side "bucket >= window" 400. This file owns the
// pure parts: the window/bucket ladders (verbatim web `ALL_WINDOWS` / `ALL_BUCKETS`) with their second-spans
// (web `WINDOW_SECS` / `BUCKET_SECS`), the vehicle-label fold (web `v.display_name || v.vin || 'Vehicle ${id}'`),
// the option projections (vehicle list with the leading empty-selection row, window list, and bucket list with
// the `tooBig` disable rule), the controlled-value mapping, the `t(key, default)` resolver for the option
// labels the i18n catalog does not define, and the top-level lifecycle classifier the composable switches on so
// each branch is testable.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/XRayControls — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view + dashboard-widget surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.xraycontrols

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object XRayControlsRegistration {
    /** Stable surface id. */
    const val ID: String = "xray-controls"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN / fleet data. */
    const val SLUG: String = "XRayControls"
}

/**
 * Allowed observation windows — the verbatim web `IngestXRayWindow` literals (server rejects anything else
 * with a 400). [wire] is the exact string the API expects; [seconds] is the web `WINDOW_SECS` span used by the
 * bucket-disable rule. Declaration order IS the web `ALL_WINDOWS` order, so [entries] renders the same option
 * sequence.
 */
enum class IngestXRayWindow(
    val wire: String,
    val seconds: Int,
) {
    W5M("5m", 5 * 60),
    W15M("15m", 15 * 60),
    W1H("1h", 60 * 60),
    W6H("6h", 6 * 60 * 60),
    W24H("24h", 24 * 60 * 60),
    ;

    companion object {
        /** The web `IngestXRayWindow` whose literal equals [value], or `null` for an unrecognised token. */
        fun fromWire(value: String): IngestXRayWindow? = entries.firstOrNull { it.wire == value }
    }
}

/**
 * Allowed bucket granularities — the verbatim web `IngestXRayBucket` literals (server rejects anything else
 * with a 400). [wire] is the exact string the API expects; [seconds] is the web `BUCKET_SECS` span compared
 * against the window in the disable rule. Declaration order IS the web `ALL_BUCKETS` order.
 */
enum class IngestXRayBucket(
    val wire: String,
    val seconds: Int,
) {
    B30S("30s", 30),
    B1M("1m", 60),
    B5M("5m", 5 * 60),
    B15M("15m", 15 * 60),
    B1H("1h", 60 * 60),
    ;

    companion object {
        /** The web `IngestXRayBucket` whose literal equals [value], or `null` for an unrecognised token. */
        fun fromWire(value: String): IngestXRayBucket? = entries.firstOrNull { it.wire == value }
    }
}

/** The window option order — the native mirror of the web `ALL_WINDOWS` constant. */
val ALL_WINDOWS: List<IngestXRayWindow> = IngestXRayWindow.entries.toList()

/** The bucket option order — the native mirror of the web `ALL_BUCKETS` constant. */
val ALL_BUCKETS: List<IngestXRayBucket> = IngestXRayBucket.entries.toList()

/**
 * The subset of the API `Vehicle` the controls bar reads — the native mirror of the fields the web
 * `vehicleOptions` map touches (`id`, `display_name`, `vin`). A nullable [displayName] / [vin] reproduces the
 * web optional fields so the label fold can fall back exactly like the source.
 */
data class XRayVehicle(
    val id: Long,
    val displayName: String? = null,
    val vin: String? = null,
)

/**
 * One fully projected, render-ready select option — the native analogue of a single web `SelectOption`
 * (`value` / `label` / `disabled`). Pure data (no Compose types) so the projection is unit-tested without a UI
 * host; [enabled] is the inverse of the web `disabled`, matching the native `Select` contract.
 */
data class XRayOption(
    val value: String,
    val label: String,
    val enabled: Boolean = true,
)

/** The empty-selection option value — the web `<option value="">` that maps to a `null` vehicle id. */
const val VEHICLE_NONE_VALUE: String = ""

/**
 * The three mutually-exclusive top-level surfaces the composable renders. The controls bar has no feed of its
 * own — its `vehicles` arrive as a prop — so a host normally supplies [Ready]; [Loading] and [Error] are the
 * lifecycle chrome the shared feature-view contract (P1/S8) carries while the fleet list is loading or failed,
 * reproduced for full state coverage, never faked from a fetch the view performs itself.
 */
enum class XRayControlsSurfaceState { Loading, Error, Ready }

/**
 * Classifies the host lifecycle flags into the top-level [XRayControlsSurfaceState] — the pure mirror of the
 * composable's `when` (loading first, then hard error, otherwise the ready controls). Kept framework-free so
 * each branch is asserted off-device.
 */
fun xrayControlsSurfaceFor(
    isLoading: Boolean,
    isError: Boolean,
): XRayControlsSurfaceState =
    when {
        isLoading -> XRayControlsSurfaceState.Loading
        isError -> XRayControlsSurfaceState.Error
        else -> XRayControlsSurfaceState.Ready
    }

/**
 * The pure projection the composable renders — the native mirror of the web component's inline option-building
 * (`vehicleOptions`, `windowOptions`, `bucketOptions`). Stateless and side-effect-free so it is fully covered
 * by the off-device unit gate.
 */
object XRayControlsProjection {
    /**
     * Folds a [vehicle] into its display label exactly like the web source's
     * `v.display_name || v.vin || \`Vehicle ${'$'}{v.id}\``: the non-blank display name, else the non-blank VIN,
     * else a `Vehicle <id>` fallback. Blank strings are treated as absent to mirror the empty-string falsiness
     * the web `||` chain relies on.
     */
    fun vehicleLabel(vehicle: XRayVehicle): String =
        vehicle.displayName?.takeIf { it.isNotBlank() }
            ?: vehicle.vin?.takeIf { it.isNotBlank() }
            ?: "Vehicle ${vehicle.id}"

    /**
     * Builds the vehicle select options — the leading empty-selection row labelled [emptySelectionLabel]
     * (web `{ value: '', label: t('admin.xray.controls.selectVehicle', 'Select vehicle…') }`) followed by one
     * option per [vehicles] entry, mapped through [vehicleLabel]. Reproduces the web `vehicleOptions` array.
     */
    fun vehicleOptions(
        vehicles: List<XRayVehicle>,
        emptySelectionLabel: String,
    ): List<XRayOption> =
        buildList {
            add(XRayOption(value = VEHICLE_NONE_VALUE, label = emptySelectionLabel))
            vehicles.forEach { vehicle ->
                add(XRayOption(value = vehicle.id.toString(), label = vehicleLabel(vehicle)))
            }
        }

    /** The controlled vehicle select value — web `value={vehicleId !== null ? String(vehicleId) : ''}`. */
    fun vehicleSelectedValue(vehicleId: Long?): String = vehicleId?.toString() ?: VEHICLE_NONE_VALUE

    /**
     * Maps a chosen vehicle select [value] back to the callback argument — web
     * `onVehicleChange(v ? Number(v) : null)`: a blank (empty-selection) value yields `null`, otherwise the
     * parsed id (an unparseable token also yields `null` rather than crashing).
     */
    fun parseVehicleSelection(value: String): Long? = value.takeIf { it.isNotBlank() }?.toLongOrNull()

    /**
     * Builds the window select options — web `ALL_WINDOWS.map((w) => ({ value: w, label: t(...) }))`. [labelOf]
     * resolves each window's display label (the i18n catalog has no option key, so it falls back to the wire
     * token, mirroring the web `t(\`admin.xray.windowOption.${'$'}{w}\`, w)` default).
     */
    fun windowOptions(labelOf: (IngestXRayWindow) -> String): List<XRayOption> =
        ALL_WINDOWS.map { window -> XRayOption(value = window.wire, label = labelOf(window)) }

    /**
     * Whether [bucket] must be disabled for the current [window] — web `BUCKET_SECS[b] >= WINDOW_SECS[windowSel]`.
     * Disabling buckets whose span is at least the window avoids the server-side "bucket >= window" 400.
     */
    fun bucketDisabled(
        bucket: IngestXRayBucket,
        window: IngestXRayWindow,
    ): Boolean = bucket.seconds >= window.seconds

    /**
     * Builds the bucket select options for the current [window] — web `bucketOptions` with each entry's
     * `disabled` set by [bucketDisabled]. [labelOf] resolves the display label (wire-token fallback, as for
     * windows).
     */
    fun bucketOptions(
        window: IngestXRayWindow,
        labelOf: (IngestXRayBucket) -> String,
    ): List<XRayOption> =
        ALL_BUCKETS.map { bucket ->
            XRayOption(value = bucket.wire, label = labelOf(bucket), enabled = !bucketDisabled(bucket, window))
        }

    /** Whether the fleet has at least one selectable vehicle (drives the always-visible no-vehicles hint). */
    fun hasSelectableVehicles(vehicles: List<XRayVehicle>): Boolean = vehicles.isNotEmpty()
}

/** Resource name for the web `admin.xray.controls.selectVehicle` empty-selection label. */
const val KEY_SELECT_VEHICLE: String = "translation_admin_xray_controls_selectVehicle"

/** Resource name for the web `admin.xray.controls.vehicleAria` accessible name of the vehicle select. */
const val KEY_VEHICLE_ARIA: String = "translation_admin_xray_controls_vehicleAria"

/** Resource name for the web `admin.xray.controls.windowAria` accessible name of the window select. */
const val KEY_WINDOW_ARIA: String = "translation_admin_xray_controls_windowAria"

/** Resource name for the web `admin.xray.controls.bucketAria` accessible name of the bucket select. */
const val KEY_BUCKET_ARIA: String = "translation_admin_xray_controls_bucketAria"

/** Resource name (by-name; absent ⇒ wire token) for a window option label — web `admin.xray.windowOption.<w>`. */
fun windowOptionKey(window: IngestXRayWindow): String = "translation_admin_xray_windowOption_${window.wire}"

/** Resource name (by-name; absent ⇒ wire token) for a bucket option label — web `admin.xray.bucketOption.<b>`. */
fun bucketOptionKey(bucket: IngestXRayBucket): String = "translation_admin_xray_bucketOption_${bucket.wire}"

/** Resource name (by-name; absent ⇒ [XRayControlsDefaults.NO_VEHICLES]) for the no-vehicles hint. */
const val KEY_NO_VEHICLES: String = "translation_admin_xray_controls_noVehicles"

/**
 * Native fallback microcopy. The four control keys exist in the i18n catalog (P1/S10) and resolve at
 * compile time; these defaults back the strings the web renders via `t(key, default)` whose keys the catalog
 * does not define (the per-token option labels) plus the always-visible no-vehicles hint the web has no branch
 * for (it just shows the empty-selection row). They reproduce i18next's "return the default when the key is
 * absent" behaviour exactly.
 */
object XRayControlsDefaults {
    /** Friendly hint shown when the fleet has no selectable vehicles — never a blank box. */
    const val NO_VEHICLES: String = "No vehicles available"
}

/**
 * The already-localized strings the controls bar renders, resolved through the i18n facade (P1/S10) at the
 * Compose boundary and passed in so the surface carries no English literal. [vehicleLabel] / [windowLabel] /
 * [bucketLabel] are the accessible names (web `aria-label`); [selectVehicle] is the empty-selection row label;
 * [noVehicles] is the empty-state hint.
 */
data class XRayControlsStrings(
    val vehicleLabel: String,
    val windowLabel: String,
    val bucketLabel: String,
    val selectVehicle: String,
    val noVehicles: String,
)

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a thin
 * seam over the Android string catalog in production (an optional by-name resource read) and a map in tests, so
 * the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback
