// Pure, framework-free model + projection for the Energy Flow dashboard widget — the native analogue of
// the data the web component derives via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/EnergyFlowWidget.tsx). No Compose, no Android framework, no HTTP:
// every type here is unit-tested off device in the :app:testReleaseUnitTest gate, keeping the composable
// a thin render layer. The web reads `state.power` / `state.charger_power` verbatim as kW and
// `state.battery_level` as a percent (it performs no SI conversion in this widget), so this projection
// reproduces those exact reads to mirror the web's observable output — the same approach the sibling
// ChargeStatusLiveWidget takes for charger power.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/EnergyFlowWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling ChargeStatusLiveWidget does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.energyflow

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import java.util.Locale
import kotlin.math.abs

/** Em dash shown for a missing/zero motor reading — the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** Power readouts render as "{n.n} kW" (web `${fmtNumber(_, 1)} kW`). */
private const val POWER_UNIT: String = " kW"
private const val PERCENT_UNIT: String = "%"

/**
 * The widget grid footprint (columns × rows). The web `EnergyFlowWidget` destructures only `vehicleId`
 * from `WidgetProps` and never reads `size`, so the surface renders identically at every footprint; this
 * type exists to mirror the registry's size contract (consumed by the grid host), not to branch layout.
 */
data class EnergyFlowSize(
    val cols: Int,
    val rows: Int,
)

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/battery.ts (`energy-flow`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object EnergyFlowRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "energy-flow"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "battery"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "EnergyFlowWidget"

    /** Default footprint: 2 columns × 4 rows. */
    val DEFAULT_SIZE: EnergyFlowSize = EnergyFlowSize(cols = 2, rows = 4)

    /** Minimum footprint: 2 columns × 4 rows. */
    val MIN_SIZE: EnergyFlowSize = EnergyFlowSize(cols = 2, rows = 4)

    /** Maximum footprint: 4 columns × 40 rows. */
    val MAX_SIZE: EnergyFlowSize = EnergyFlowSize(cols = 4, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: EnergyFlowSize): Boolean =
        size.cols in MIN_SIZE.cols..MAX_SIZE.cols && size.rows in MIN_SIZE.rows..MAX_SIZE.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: EnergyFlowSize): EnergyFlowSize =
        EnergyFlowSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/** A node's identity (web `FlowNode.id`); the render layer resolves its glyph + tint from this. */
enum class EnergyFlowNode { Battery, Motor, Charger }

/**
 * Where a node sits on the diagram (web `FlowNode.position`). Energy Flow uses only these three anchors:
 * Battery on the [Left], Motor on the [Right], and the Charger on [Top] when charging.
 */
enum class EnergyFlowAnchor { Left, Right, Top }

/**
 * The localized label a node shows — the render layer resolves the i18n string. The motor's label is
 * dynamic (web `isConsuming ? 'Consuming' : isRegen ? 'Regenerating' : 'Standby'`).
 */
enum class EnergyFlowLabel { Battery, Consuming, Regenerating, Standby, Charger }

/** Arrow hue family (web `text-cyan-400` / `text-emerald-400` / `text-amber-400`); mapped to a token color at render. */
enum class EnergyFlowHue { Cyan, Emerald, Amber }

/**
 * A node placed on the flow diagram — the native analogue of the web `FlowNode`.
 *
 * @property node which node this is (drives glyph + tint at the render boundary).
 * @property anchor where it sits on the diagram.
 * @property label the localized label kind (Battery / Consuming / Regenerating / Standby / Charger).
 * @property value the raw number the diagram animates (web `AnimatedNumber value={node.value}`):
 *   battery percent, |power| (kW), or charger power (kW).
 * @property formattedValue the unit-suffixed value used for the accessible description (web
 *   `FlowNode.formattedValue`): "82%", "12.3 kW", or the em dash for a standby motor.
 */
data class EnergyFlowNodeModel(
    val node: EnergyFlowNode,
    val anchor: EnergyFlowAnchor,
    val label: EnergyFlowLabel,
    val value: Double,
    val formattedValue: String,
)

/**
 * A directional flow arrow between two nodes — the native analogue of the web `FlowArrow`.
 *
 * @property from source node id.
 * @property to destination node id.
 * @property value the flow magnitude (0 when inactive — web sets `value: 0` for the unused direction).
 * @property active whether energy is flowing along this arrow (animated when true, web `arrow.active`).
 * @property hue the color family for an active arrow.
 */
data class EnergyFlowArrowModel(
    val from: EnergyFlowNode,
    val to: EnergyFlowNode,
    val value: Double,
    val active: Boolean,
    val hue: EnergyFlowHue,
)

/**
 * The fully projected, render-ready view of the energy flow surface — everything the web component
 * computes before returning JSX. Pure data (no Compose types) so every branch is unit-tested directly.
 *
 * @property hasState whether a vehicle state was decoded (web `state` truthy); when false the surface
 *   renders its empty state instead of the diagram.
 * @property nodes the ordered diagram nodes (Battery, Motor, and Charger when charging).
 * @property arrows the ordered flow arrows (Battery→Motor, Motor→Battery, and Charger→Battery when charging).
 */
data class EnergyFlowDisplay(
    val hasState: Boolean,
    val nodes: List<EnergyFlowNodeModel>,
    val arrows: List<EnergyFlowArrowModel>,
) {
    companion object {
        /** The no-state projection (web `state == null`): the surface shows its empty state. */
        val EMPTY: EnergyFlowDisplay = EnergyFlowDisplay(hasState = false, nodes = emptyList(), arrows = emptyList())
    }
}

/**
 * Pure projection from a decoded [VehicleState] to the render-ready [EnergyFlowDisplay] — the native
 * port of the `nodes` / `arrows` memos in `EnergyFlowWidget.tsx`. A `null` state yields
 * [EnergyFlowDisplay.EMPTY] (the web `state ? <WidgetFlowDiagram> : <EmptyState>` gate). Power and
 * charger power are read verbatim as kW and battery level as a percent, exactly as the web reads them
 * (no SI conversion in this widget).
 */
object EnergyFlowProjection {
    /** Power/animated-number fraction digits (web `AnimatedNumber decimals={1}` / `fmtNumber(_, 1)`). */
    const val POWER_PRECISION: Int = 1

    /** Minimum/maximum arrow stroke in web SVG units (web `MIN_STROKE` / `MAX_STROKE`). */
    const val MIN_STROKE: Float = 1f
    const val MAX_STROKE: Float = 4f

    /**
     * Project [state] into the diagram model. Reproduces the web derivations exactly:
     * `power = state.power ?? 0`, `isConsuming = power > 0`, `isRegen = power < 0`,
     * `absPower = |power|`, `isCharging = state.is_charging ?? false`,
     * `chargerPower = state.charger_power ?? 0`, `batteryLevel = state.battery_level ?? 0`.
     */
    fun project(state: VehicleState?): EnergyFlowDisplay {
        if (state == null) return EnergyFlowDisplay.EMPTY
        val power = safe(state.power)
        return EnergyFlowDisplay(
            hasState = true,
            nodes = buildNodes(state, power),
            arrows = buildArrows(state, power),
        )
    }

    /** The Battery + Motor nodes (web `nodes` memo), plus the Charger node while charging. */
    private fun buildNodes(
        state: VehicleState,
        power: Double,
    ): List<EnergyFlowNodeModel> {
        val absPower = abs(power)
        return buildList {
            add(
                EnergyFlowNodeModel(
                    node = EnergyFlowNode.Battery,
                    anchor = EnergyFlowAnchor.Left,
                    label = EnergyFlowLabel.Battery,
                    value = state.batteryLevel * 1.0,
                    formattedValue = "${state.batteryLevel}$PERCENT_UNIT",
                ),
            )
            add(
                EnergyFlowNodeModel(
                    node = EnergyFlowNode.Motor,
                    anchor = EnergyFlowAnchor.Right,
                    label = motorLabel(power > 0.0, power < 0.0),
                    value = absPower,
                    formattedValue = if (absPower > 0.0) formatPower(absPower) else EM_DASH,
                ),
            )
            if (state.isCharging) {
                add(
                    EnergyFlowNodeModel(
                        node = EnergyFlowNode.Charger,
                        anchor = EnergyFlowAnchor.Top,
                        label = EnergyFlowLabel.Charger,
                        value = safe(state.chargerPower),
                        formattedValue = formatPower(safe(state.chargerPower)),
                    ),
                )
            }
        }
    }

    /** The Consuming + Regen arrows (web `arrows` memo), plus the Charger arrow while charging. */
    private fun buildArrows(
        state: VehicleState,
        power: Double,
    ): List<EnergyFlowArrowModel> {
        val absPower = abs(power)
        val isConsuming = power > 0.0
        val isRegen = power < 0.0
        return buildList {
            add(
                EnergyFlowArrowModel(
                    from = EnergyFlowNode.Battery,
                    to = EnergyFlowNode.Motor,
                    value = if (isConsuming) absPower else 0.0,
                    active = isConsuming,
                    hue = EnergyFlowHue.Cyan,
                ),
            )
            add(
                EnergyFlowArrowModel(
                    from = EnergyFlowNode.Motor,
                    to = EnergyFlowNode.Battery,
                    value = if (isRegen) absPower else 0.0,
                    active = isRegen,
                    hue = EnergyFlowHue.Emerald,
                ),
            )
            if (state.isCharging) {
                add(
                    EnergyFlowArrowModel(
                        from = EnergyFlowNode.Charger,
                        to = EnergyFlowNode.Battery,
                        value = safe(state.chargerPower),
                        active = true,
                        hue = EnergyFlowHue.Amber,
                    ),
                )
            }
        }
    }

    /** True when [state] carries no vehicle state (web `state` falsy) → render the empty state. */
    fun isEmptyState(state: VehicleState?): Boolean = state == null

    /** The motor label (web `isConsuming ? 'Consuming' : isRegen ? 'Regenerating' : 'Standby'`). */
    fun motorLabel(
        isConsuming: Boolean,
        isRegen: Boolean,
    ): EnergyFlowLabel =
        when {
            isConsuming -> EnergyFlowLabel.Consuming
            isRegen -> EnergyFlowLabel.Regenerating
            else -> EnergyFlowLabel.Standby
        }

    /** Format a kW power value as "{n.n} kW" (web `${fmtNumber(value, 1)} kW`). */
    fun formatPower(valueKw: Double): String = "${formatNumber(valueKw, POWER_PRECISION)}$POWER_UNIT"

    /**
     * Locale-stable decimal formatter (web `fmtNumber` → `toLocaleString` with fixed fraction digits):
     * en-US grouping + fixed digits, so the projected strings are deterministic regardless of device
     * locale — matching the sibling ChargeStatusLiveWidget's `formatNumber`.
     */
    fun formatNumber(
        value: Double,
        decimals: Int,
    ): String = String.format(Locale.US, "%,.${decimals}f", safe(value))

    /**
     * The denominator the web uses to scale stroke widths: `Math.max(...arrows.map(|value|), 1)`. Never
     * below 1 so a diagram with only zero-valued arrows still scales to the minimum stroke.
     */
    fun maxArrowValue(arrows: List<EnergyFlowArrowModel>): Double = (arrows.maxOfOrNull { abs(it.value) } ?: 0.0).coerceAtLeast(1.0)

    /**
     * Web `strokeForValue`: `MIN_STROKE + (|value| / maxValue) * (MAX_STROKE - MIN_STROKE)`, clamped to
     * the [MIN_STROKE]..[MAX_STROKE] band. Returns SVG-unit width; the render layer scales it to dp.
     */
    fun strokeScale(
        value: Double,
        maxValue: Double,
    ): Float {
        if (maxValue <= 0.0) return MIN_STROKE
        val ratio = (abs(value) / maxValue).toFloat().coerceIn(0f, 1f)
        return MIN_STROKE + ratio * (MAX_STROKE - MIN_STROKE)
    }

    private fun safe(value: Double): Double = if (value.isFinite()) value else 0.0
}

/**
 * The active vehicle id the widget reads state for — the native port of the web
 * `id = vehicleId ?? vehicles?.[0]?.id ?? 0`. A positive [preferredVehicleId] wins; otherwise the first
 * enrolled vehicle is used; `null` means neither is available (the surface shows its empty state).
 */
fun resolveVehicleId(
    preferredVehicleId: Long?,
    vehicles: List<Vehicle>?,
): Long? = preferredVehicleId?.takeIf { it > 0L } ?: firstVehicleId(vehicles)

/** The first enrolled vehicle's id, or `null` when the fleet list is absent or empty. */
fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id?.takeIf { it > 0L }
