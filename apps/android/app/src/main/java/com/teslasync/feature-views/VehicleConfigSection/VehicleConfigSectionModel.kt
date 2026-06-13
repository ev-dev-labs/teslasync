// Pure, framework-free model + projection for the VehicleConfigSection feature view — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/vehicles/components/vehicle-detail/VehicleConfigSection.tsx). No Compose, no Android, no
// HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the
// composable stays a thin render layer over these pure functions.
//
// The web component is purely presentational — the Vehicle Detail page holds the config + vehicle-state
// queries and passes a `vehicleConfig: VehicleConfigSnapshot | null | undefined` plus a `softwareVersion`
// scalar down. From those props it renders one glass panel: a "Vehicle Configuration" header (a `Settings`
// gear glyph + title) over a two-column `KVList` of twelve rows — Car Type, Trim, Exterior Color, Wheels,
// Roof Color, Charge Port, Right-Hand Drive, Europe Vehicle, Offroad Lightbar, Rear Seat Heaters, Sunroof,
// and Software — falling back to a loading `Skeleton` while `vehicleConfig` is still null. This file owns the
// only logic the web expresses inline: the twelve-row projection (each string field `?? '—'`, each boolean
// field `!= null ? (v ? Yes : No) : '—'`, and the Software fallback chain
// `software_update_version ?? softwareVersion ?? '—'`), and the lifecycle projection onto the shared
// cache-then-network [UiState] so the surface renders every state the P1/S8 layer can carry.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/VehicleConfigSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehicleconfigsection

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger

/** The web `'—'` empty-value fallback (em dash, U+2014) — used for every missing string/boolean field. */
internal const val EM_DASH: String = "\u2014"

/**
 * The subset of the web `VehicleConfigSnapshot` (web/src/api/types.ts) that this surface renders. The web
 * component reads exactly these twelve fields; carrying only them keeps the projection honest about its
 * inputs and lets the off-device test build a vehicle config without the full API model. Every field is
 * optional, mirroring the web snapshot's `?:` properties — a `null` reads as the `'—'` fallback.
 *
 * @property carType web `car_type` (e.g. `models2`).
 * @property trim web `trim` (e.g. `P100D`).
 * @property exteriorColor web `exterior_color`.
 * @property wheelType web `wheel_type` (the "Wheels" row).
 * @property roofColor web `roof_color`.
 * @property chargePort web `charge_port`.
 * @property rightHandDrive web `right_hand_drive` — rendered Yes/No, or `'—'` when absent.
 * @property europeVehicle web `europe_vehicle` — rendered Yes/No, or `'—'` when absent.
 * @property offroadLightbarPresent web `offroad_lightbar_present` — rendered Yes/No, or `'—'` when absent.
 * @property rearSeatHeaters web `rear_seat_heaters`.
 * @property sunroofInstalled web `sunroof_installed` (the "Sunroof" row).
 * @property softwareUpdateVersion web `software_update_version` — the first source for the Software row.
 */
data class VehicleConfigData(
    val carType: String? = null,
    val trim: String? = null,
    val exteriorColor: String? = null,
    val wheelType: String? = null,
    val roofColor: String? = null,
    val chargePort: String? = null,
    val rightHandDrive: Boolean? = null,
    val europeVehicle: Boolean? = null,
    val offroadLightbarPresent: Boolean? = null,
    val rearSeatHeaters: String? = null,
    val sunroofInstalled: String? = null,
    val softwareUpdateVersion: String? = null,
)

/**
 * The already-localized strings the panel renders. The web component is anonymous — it resolves every label
 * through `useTranslation` — so these arrive through the P1/S10 i18n facade at the Compose boundary and are
 * passed down, keeping the surface free of any English literal.
 *
 * @property title web `vehicles.detail.vehicleConfig` ("Vehicle Configuration").
 * @property carType web `vehicles.detail.carType` ("Car Type").
 * @property trim web `vehicles.detail.trim` ("Trim").
 * @property exteriorColor web `vehicles.detail.color` ("Exterior Color").
 * @property wheels web `vehicles.detail.wheels` ("Wheels").
 * @property roofColor web `vehicles.detail.roofColor` ("Roof Color").
 * @property chargePort web `vehicles.detail.chargePort` ("Charge Port").
 * @property rightHandDrive web `vehicles.detail.rhd` ("Right-Hand Drive").
 * @property europeVehicle web `vehicles.detail.europeVehicle` ("Europe Vehicle").
 * @property offroadLightbar web `vehicles.detail.offroadLightbar` ("Offroad Lightbar").
 * @property rearSeatHeaters web `vehicles.detail.rearSeatHeaters` ("Rear Seat Heaters").
 * @property sunroof web `vehicles.detail.sunroofInstalled` ("Sunroof").
 * @property software web `vehicles.detail.softwareVersion` ("Software").
 * @property yes web `common.yes` ("Yes").
 * @property no web `common.no` ("No").
 * @property noData the empty-state message (web shows a Skeleton; the native empty phase shows this).
 */
data class VehicleConfigSectionStrings(
    val title: String,
    val carType: String,
    val trim: String,
    val exteriorColor: String,
    val wheels: String,
    val roofColor: String,
    val chargePort: String,
    val rightHandDrive: String,
    val europeVehicle: String,
    val offroadLightbar: String,
    val rearSeatHeaters: String,
    val sunroof: String,
    val software: String,
    val yes: String,
    val no: String,
    val noData: String,
)

/**
 * One projected, render-ready label/value row — the native analogue of a web `KVList` item. Both fields are
 * pre-formatted Strings (no Compose types), so the projection is unit-tested without a UI host; the composable
 * maps each row onto the shared `KVList`.
 */
data class VehicleConfigRow(
    val label: String,
    val value: String,
)

/**
 * Pure projection from a [VehicleConfigData] + `softwareVersion` to its render-ready rows — a 1:1 port of the
 * web component's inline `configItems` array. Stateless and side-effect-free so it is fully covered by the
 * off-device unit gate; the composable only resolves localized strings and draws what these return.
 */
object VehicleConfigSectionProjection {
    /**
     * Maps the panel's `(vehicleConfig, isLoading)` props onto the shared cache-then-network [UiState]
     * (P1/S8). The web component itself has no loading/error surface (its parent owns those, and it shows a
     * `Skeleton` whenever `vehicleConfig` is null); this adapter adds the lifecycle states the host's feed can
     * carry while preserving web precedence: loading → [UiPhase.Loading] (the web `Skeleton`); a present
     * config → [UiPhase.Content] (the panel renders its rows); a resolved-absent config → [UiPhase.Empty] (the
     * panel still renders, with a friendly "no data" body rather than an endless skeleton — never a blank box).
     */
    fun projectUiState(
        config: VehicleConfigData?,
        isLoading: Boolean,
    ): UiState<VehicleConfigData> =
        when {
            isLoading -> UiState.loading()
            config != null -> UiState(phase = UiPhase.Content, data = config)
            else -> UiState(phase = UiPhase.Empty)
        }

    /**
     * The ordered, render-ready rows for [config] — a 1:1 port of the web component's `configItems`. Every row
     * is always present (the web array always builds all twelve entries when `vehicleConfig` is non-null), so
     * the surface never hides a field; a missing value reads as the `'—'` fallback. String fields use the web
     * `?? '—'`; boolean fields use the web `v != null ? (v ? Yes : No) : '—'`; and the Software row reproduces
     * the web fallback chain `software_update_version ?? softwareVersion ?? '—'`. [strings] supplies the
     * localized labels and the Yes/No words.
     */
    fun rows(
        config: VehicleConfigData,
        softwareVersion: String?,
        strings: VehicleConfigSectionStrings,
    ): List<VehicleConfigRow> =
        listOf(
            VehicleConfigRow(strings.carType, config.carType.orDash()),
            VehicleConfigRow(strings.trim, config.trim.orDash()),
            VehicleConfigRow(strings.exteriorColor, config.exteriorColor.orDash()),
            VehicleConfigRow(strings.wheels, config.wheelType.orDash()),
            VehicleConfigRow(strings.roofColor, config.roofColor.orDash()),
            VehicleConfigRow(strings.chargePort, config.chargePort.orDash()),
            VehicleConfigRow(strings.rightHandDrive, boolLabel(config.rightHandDrive, strings)),
            VehicleConfigRow(strings.europeVehicle, boolLabel(config.europeVehicle, strings)),
            VehicleConfigRow(strings.offroadLightbar, boolLabel(config.offroadLightbarPresent, strings)),
            VehicleConfigRow(strings.rearSeatHeaters, config.rearSeatHeaters.orDash()),
            VehicleConfigRow(strings.sunroof, config.sunroofInstalled.orDash()),
            VehicleConfigRow(strings.software, (config.softwareUpdateVersion ?: softwareVersion).orDash()),
        )

    /**
     * A boolean field's rendered value — the web `v != null ? (v ? t('common.yes') : t('common.no')) : '—'`.
     * A `null` reads as the `'—'` fallback; otherwise the localized Yes/No word.
     */
    fun boolLabel(
        value: Boolean?,
        strings: VehicleConfigSectionStrings,
    ): String =
        when (value) {
            null -> EM_DASH
            true -> strings.yes
            false -> strings.no
        }

    /** The web `value ?? '—'` — a `null` (the web `undefined`) reads as the em-dash fallback. */
    private fun String?.orDash(): String = this ?: EM_DASH
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never any
 * vehicle field — so a diagnostics line can never leak a user's vehicle configuration.
 */
object VehicleConfigSectionDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "VehicleConfigSection"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
