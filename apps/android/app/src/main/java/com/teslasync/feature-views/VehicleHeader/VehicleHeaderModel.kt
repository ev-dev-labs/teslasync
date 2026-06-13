// Pure, framework-free model + projection + diagnostics for the VehicleHeader feature view — the native
// analogue of everything the web component derives from its props before returning JSX
// (web/src/features/vehicles/components/vehicle-detail/VehicleHeader.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// VehicleHeader is a presentational detail-page header — the web component renders a back affordance, a status
// chip (a colored dot beside the raw status token), a neutral chip carrying "model trim", the monospace VIN,
// and a Wake action. Its ONLY web hook is `useTranslation`; it binds NO data hook and performs NO fetch (the
// loaded `vehicle`, the derived `status`, the `onWake` callback, and the `waking` flag all arrive as props from
// the owning page). As in the sibling DriveDetailHeader port (the other zero-data-source presentational header),
// there is therefore no cache-then-network loading / error / stale / offline lifecycle of its own to model —
// inventing those states would fabricate behaviour the web spec does not have (honesty covenant: no silent
// drift). What the surface genuinely varies, and what this pure file owns, are the web component's real
// conditional branches:
//   • the status chip variant — the web `statusVariant(status)` lookup over `VEHICLE_STATE_ENTRIES`
//     (web/src/types/fsm/vehicle.ts), reproduced verbatim here as [VehicleHeaderProjection.statusTone] with the
//     same `?? danger` fall-through for the offline state and any unrecognized token;
//   • the descriptor chip — the web `${vehicle?.model ?? ''} ${vehicle?.trim_badging ?? ''}` join, exposed as a
//     nullable [VehicleHeaderUiModel.descriptor] (null ⇒ the composable omits the chip rather than render a
//     blank one when no vehicle is loaded yet);
//   • the VIN line — the web `vehicle?.vin ?? ''`, exposed as a nullable [VehicleHeaderUiModel.vin] (null ⇒ the
//     composable omits the line). The back affordance, the status chip, and the Wake action always render, so
//     the header is never a blank box even before the vehicle resolves.
//
// The status TOKEN itself is rendered raw, exactly as the web renders `{status}` with no `t()` call — it is a
// derived FSM token (e.g. `online`, `charging`), not prose, and the P1/S10 catalog carries no key for it (the
// only i18n key this surface uses is `common.wakeUp`). Localizing it would be drift, matching how the sibling
// helpers port keeps its raw status tokens un-translated.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/VehicleHeader — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen segment is illegal in a package identifier), so the package intentionally diverges from the
// path — exactly as the sibling DriveDetailHeader / VehicleHero surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehicleheader

import io.teslasync.shared.core.diagnostics.Logger

/**
 * The semantic status tone the status chip is painted with — the framework-free native analogue of the web
 * `BadgeVariant` that `statusVariant` returns. Kept out of the `components.ui` layer so this model stays pure
 * (the composable maps each tone onto a `BadgeVariant`), mirroring the sibling helpers port's `StatusKind`.
 */
enum class VehicleStatusTone { Info, Success, Warning, Danger, Neutral }

/**
 * The raw header inputs — the native analogue of the web `VehicleHeaderProps`. Pure data so the projection is
 * fully covered by the off-device unit gate; every vehicle-derived field is nullable and tolerated, exactly as
 * the web reads `vehicle?.model` / `vehicle?.trim_badging` / `vehicle?.vin` defensively for the not-yet-loaded
 * vehicle.
 *
 * @property model the vehicle model name, or null/blank until the vehicle loads (web `vehicle?.model`).
 * @property trimBadging the trim badge, or null/blank until the vehicle loads (web `vehicle?.trim_badging`).
 * @property vin the vehicle VIN, or null/blank until the vehicle loads (web `vehicle?.vin`).
 * @property status the derived FSM status token (web `status`), rendered raw and mapped to a tone.
 */
data class VehicleHeaderData(
    val model: String?,
    val trimBadging: String?,
    val vin: String?,
    val status: String,
)

/**
 * The fully projected, render-ready header — the native analogue of the values the web component computes
 * inline before returning JSX. Pure data (no Compose/Android types) so it is asserted directly in the unit
 * gate; the composable only resolves the i18n Wake label, maps [statusTone] to a chip variant, and paints
 * these strings.
 *
 * @property statusLabel the raw status token shown in the status chip (web `{status}`), trimmed.
 * @property statusTone the chip tone for [statusLabel] (web `statusVariant(status)`).
 * @property descriptor the "model trim" chip text, or null when no vehicle is loaded so the composable omits
 *   the chip (web `${model ?? ''} ${trim ?? ''}` collapsed to nothing).
 * @property vin the VIN line text, or null when no vehicle is loaded so the composable omits the line.
 */
data class VehicleHeaderUiModel(
    val statusLabel: String,
    val statusTone: VehicleStatusTone,
    val descriptor: String?,
    val vin: String?,
) {
    /**
     * True when there is no vehicle-identity content to show (no descriptor AND no VIN) — a not-yet-loaded
     * vehicle. The composable still renders the back affordance, the status chip, and the Wake action, so the
     * surface is never a blank box; this flag just records that the identity block collapsed to the chip alone.
     */
    val isEmpty: Boolean get() = descriptor == null && vin == null
}

/**
 * Pure projection from the raw [VehicleHeaderData] to the render-ready [VehicleHeaderUiModel] — the native port
 * of the web component's inline prop derivation. Every branch is deterministic and tolerates null/blank input,
 * matching the web's defensive `?? ''` reads for the vehicle that has not loaded yet.
 */
object VehicleHeaderProjection {
    /** Project [data] into the render-ready model. */
    fun project(data: VehicleHeaderData): VehicleHeaderUiModel =
        VehicleHeaderUiModel(
            statusLabel = statusLabel(data.status),
            statusTone = statusTone(data.status),
            descriptor = descriptor(data.model, data.trimBadging),
            vin = vin(data.vin),
        )

    /** The raw status token shown in the chip (web `{status}`), trimmed of incidental whitespace. */
    fun statusLabel(status: String): String = status.trim()

    /**
     * Map an FSM status token to its chip tone — the native port of web `statusVariant(status)`, which looks the
     * token up in `VEHICLE_STATE_ENTRIES` and falls back to `danger`. The mapping is reproduced verbatim:
     * `online`/`driving` ⇒ success, `charging` ⇒ warning, `parked`/`updating` ⇒ info, `asleep` ⇒ neutral, and
     * `offline` together with any unrecognized token ⇒ danger (web `entry?.variant ?? 'danger'`). Comparison is
     * locale-invariant (`lowercase()` uses Locale.ROOT) to match the ASCII tokens the backend emits.
     */
    fun statusTone(status: String): VehicleStatusTone =
        when (status.trim().lowercase()) {
            "online", "driving" -> VehicleStatusTone.Success
            "charging" -> VehicleStatusTone.Warning
            "parked", "updating" -> VehicleStatusTone.Info
            "asleep" -> VehicleStatusTone.Neutral
            else -> VehicleStatusTone.Danger
        }

    /**
     * The "model trim" descriptor chip text — web `${vehicle?.model ?? ''} ${vehicle?.trim_badging ?? ''}`. Each
     * part is trimmed and empty parts are dropped, so a vehicle with only a model (or only a trim) yields a clean
     * single word and a not-yet-loaded vehicle yields null (the composable then omits the chip rather than show
     * a blank one).
     */
    fun descriptor(
        model: String?,
        trimBadging: String?,
    ): String? {
        val parts = listOfNotNull(model?.trim(), trimBadging?.trim()).filter { it.isNotEmpty() }
        return parts.joinToString(" ").ifEmpty { null }
    }

    /** The VIN line — web `vehicle?.vin ?? ''`, trimmed; null/blank collapses to null so the composable omits it. */
    fun vin(raw: String?): String? = raw?.trim()?.ifEmpty { null }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the VIN, the
 * model, or the status — so a diagnostics line can never leak anything about the user or their vehicle.
 */
object VehicleHeaderDiagnostics {
    /** Stable registry id for the surface. */
    const val ID: String = "vehicle-header"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "VehicleHeader"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
