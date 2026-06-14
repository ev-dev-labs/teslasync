// Pure, framework-free model + projection for the Vehicle Hero dashboard widget — the native analogue of
// everything the web widget derives before delegating to the presentational hero
// (web/src/features/dashboard/widgets/VehicleHeroWidget.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web widget is itself a thin wrapper — it loads the vehicle (`useVehicles`), its last-known state
// (`useVehicleState`), and its live signals (`useVehicleLive`), resolves the firmware string, and renders
// `<WidgetShell><VehicleHero …/></WidgetShell>`. This file owns the parts the web widget derives before that
// hand-off: the registry metadata (id / category / slug / grid footprint), the live-firmware value object,
// and the firmware-fallback resolution. The actual gauges / charging banner / stat grid / asleep card are the
// shared `VehicleHero` feature view's responsibility (web `../components/VehicleHero`), which this widget
// composes — so they are intentionally NOT re-derived here (DRY; the web widget imports the same component).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/VehicleHeroWidget — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path, exactly as the sibling VehicleHeroCardWidget surface does.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.vehiclehero

import io.teslasync.shared.core.api.generated.VehicleState

/** Em dash shown wherever a value is unknown — the web `'\u2014'` empty marker. */
internal const val VEHICLE_HERO_WIDGET_EM_DASH: String = "\u2014"

/**
 * The Tesla live-signal field names the web `useVehicleLive` hook reads for firmware (`parseSignals`):
 * the active running build (`Version`) and the staged OTA build (`SoftwareUpdateVersion`).
 */
internal const val LIVE_VERSION_KEY: String = "Version"
internal const val LIVE_SW_UPDATE_VERSION_KEY: String = "SoftwareUpdateVersion"

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The web
 * `VehicleHeroWidget` does not branch its layout on the footprint (it renders the responsive `VehicleHero`
 * regardless), so this type only carries the registry metadata + clamp the dashboard grid host honours.
 */
data class VehicleHeroWidgetSize(
    val cols: Int,
    val rows: Int,
)

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/vehicle.ts (`vehicle-hero`). A dashboard grid host binds this
 * surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay in
 * lockstep.
 */
object VehicleHeroWidgetRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "vehicle-hero"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "vehicle"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "VehicleHeroWidget"

    /** Default footprint: 2 columns × 9 rows (web `defaultSize`). */
    val defaultSize: VehicleHeroWidgetSize = VehicleHeroWidgetSize(cols = 2, rows = 9)

    /** Minimum footprint: 2 columns × 4 rows (web `minSize`). */
    val minSize: VehicleHeroWidgetSize = VehicleHeroWidgetSize(cols = 2, rows = 4)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize: VehicleHeroWidgetSize = VehicleHeroWidgetSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: VehicleHeroWidgetSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: VehicleHeroWidgetSize): VehicleHeroWidgetSize =
        VehicleHeroWidgetSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * The two firmware-bearing live signals the web `useVehicleLive` hook surfaces: the running build [version]
 * (`Version`) and the staged OTA build [swUpdateVersion] (`SoftwareUpdateVersion`). Both default to the empty
 * string (the web `EMPTY_STATE`), which the firmware resolver treats as "absent" so it falls through to the
 * last-known state's software version.
 */
data class LiveFirmware(
    val version: String,
    val swUpdateVersion: String,
) {
    companion object {
        /** The pre-stream live firmware (no signals seen yet) — both fields blank. */
        val Empty: LiveFirmware = LiveFirmware(version = "", swUpdateVersion = "")
    }
}

/**
 * Resolves the firmware string the web widget passes to `VehicleHero`, reproducing the web
 * `live.version || live.swUpdateVersion || stateData?.state?.software_version || '\u2014'` chain verbatim:
 * the live running build wins, then the staged OTA build, then the last-known state's software version, then
 * the em dash. JS `||` treats the empty string as falsy, so each candidate is taken only when non-empty.
 */
fun resolveFirmwareVersion(
    live: LiveFirmware,
    state: VehicleState?,
): String =
    sequenceOf(live.version, live.swUpdateVersion, state?.softwareVersion.orEmpty())
        .firstOrNull { it.isNotEmpty() }
        ?: VEHICLE_HERO_WIDGET_EM_DASH
