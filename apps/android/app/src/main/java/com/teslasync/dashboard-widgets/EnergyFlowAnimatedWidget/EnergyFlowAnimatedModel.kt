// Pure, framework-free model + projection for the Energy Flow Animated dashboard widget — the native
// analogue of the data the web component derives before returning JSX
// (web/src/features/dashboard/widgets/EnergyFlowAnimatedWidget.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. Power and charger-power arrive as kW and battery as a percent and are
// read verbatim the way the web reads them (`state.power`, `state.charger_power`, `state.battery_level`)
// so the native surface reproduces the web's observable output without any unit conversion.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/EnergyFlowAnimatedWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier),
// so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.energyflowanimated

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.api.generated.VehicleState
import java.util.Locale

private const val EM_DASH = "\u2014"
private const val COMMA_SPACE = ", "
private const val SPACE = " "
private const val KW_SUFFIX = " kW"
private const val PERCENT = "%"

/**
 * The widget's grid footprint (columns x rows). Mirrors the web `WidgetProps.size` plus the
 * `isCompact` rule in the web source: below two columns the compact battery hero renders, otherwise the
 * animated flow diagram.
 */
data class EnergyFlowAnimatedSize(
    val cols: Int,
    val rows: Int,
) {
    /** True below two columns (web `size.cols < 2`): show the compact battery hero instead of the diagram. */
    val isCompact: Boolean get() = cols < 2
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/energy.ts (`energy-flow-animated`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object EnergyFlowAnimatedRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "energy-flow-animated"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "energy"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "EnergyFlowAnimatedWidget"

    /** Default footprint: 2 columns x 4 rows. */
    val defaultSize = EnergyFlowAnimatedSize(cols = 2, rows = 4)

    /** Minimum footprint: 2 columns x 4 rows. */
    val minSize = EnergyFlowAnimatedSize(cols = 2, rows = 4)

    /** Maximum footprint: 3 columns x 40 rows. */
    val maxSize = EnergyFlowAnimatedSize(cols = 3, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: EnergyFlowAnimatedSize): Boolean =
        size.cols in minSize.cols..maxSize.cols && size.rows in minSize.rows..maxSize.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: EnergyFlowAnimatedSize): EnergyFlowAnimatedSize =
        EnergyFlowAnimatedSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/** Glyph family for a node / compact-row icon; mapped to a concrete `ImageVector` at the render boundary. */
enum class EnergyFlowGlyph { Battery, Zap, Plug }

/** Anchor position of a flow node; mapped to a fractional coordinate at the render boundary. */
enum class EnergyFlowPosition { Top, Bottom, Left, Right, Center }

/**
 * Semantic flow color, decoupled from the chart-token names so the render boundary can map each to the
 * nearest design-token hue (web `text-cyan-400` / `text-emerald-400` / `text-amber-400`).
 */
enum class EnergyFlowTint { Drive, Regen, Charger, Neutral }

/**
 * One node of the flow diagram — the native counterpart of the web `FlowNode`. [value] is the numeric
 * readout the animated badge counts up to (web renders `AnimatedNumber value={node.value} decimals={1}`),
 * [formattedValue] is the unit-bearing string folded into the [contentDescription] for TalkBack.
 */
data class EnergyFlowNode(
    val id: String,
    val label: String,
    val value: Double,
    val formattedValue: String,
    val glyph: EnergyFlowGlyph,
    val position: EnergyFlowPosition,
    val contentDescription: String,
)

/**
 * One directed flow between two nodes — the native counterpart of the web `FlowArrow`. [active] drives
 * the animated dash (web `strokeDasharray` + `dashFlow`), [magnitude] scales the stroke width.
 */
data class EnergyFlowArrow(
    val fromId: String,
    val toId: String,
    val magnitude: Double,
    val active: Boolean,
    val tint: EnergyFlowTint,
)

/**
 * One compact-hero row — a colored glyph + a localized kW readout (web's `isCharging` / `isConsuming` /
 * `isRegen` rows in `CompactView`). [contentDescription] folds the [label] and [valueText] for TalkBack.
 */
data class EnergyFlowCompactRow(
    val glyph: EnergyFlowGlyph,
    val label: String,
    val valueText: String,
    val tint: EnergyFlowTint,
    val contentDescription: String,
)

/**
 * The combined live snapshot the view-model projects — the native analogue of the web component's single
 * `useVehicleState` read. A `null` [state] models `stateData?.state` being undefined (the surface shows
 * its empty state). Pure data so the projection is unit-tested without a UI host.
 */
data class EnergyFlowAnimatedSnapshot(
    val state: VehicleState?,
)

/**
 * The fully projected, render-ready view of the energy-flow surface for one footprint — the native
 * analogue of everything the web component computes before returning JSX (the `nodes`/`arrows` memos and
 * the compact / diagram composition flags). Pure data so the projection is unit-tested without a UI host.
 */
data class EnergyFlowAnimatedDisplay(
    val isCompact: Boolean,
    val nodes: List<EnergyFlowNode>,
    val arrows: List<EnergyFlowArrow>,
    val batteryPercentText: String,
    val compactRows: List<EnergyFlowCompactRow>,
    val compactIsIdle: Boolean,
    val idleText: String,
    val compactContentDescription: String,
)

/**
 * Localized labels + the relative-time formatter the surface folds into its output. The pure
 * [EnergyFlowAnimatedProjection] reads the node / compact-row labels + the idle word; the composable
 * chrome additionally reads [title] / [emptyMessage] / [refreshLabel] / [refreshingLabel] /
 * [offlineLabel] / [formatRelative]. Keeping i18n out of the projection lets it stay a pure,
 * locale-stable function.
 */
data class EnergyFlowAnimatedStrings(
    val title: String,
    val emptyMessage: String,
    val battery: String,
    val drive: String,
    val regen: String,
    val charger: String,
    val idle: String,
    val refreshLabel: String,
    val refreshingLabel: String,
    val offlineLabel: String,
    val formatRelative: (FreshnessAge) -> String,
)

/**
 * Pure projection from a decoded [VehicleState] to the [EnergyFlowAnimatedDisplay] — the native port of
 * the web component's `nodes` + `arrows` memos and its `CompactView`. Power and charger power are read
 * verbatim as kW and battery as a percent, exactly as the web reads them; non-finite figures collapse to
 * zero so the formatted output is deterministic.
 */
object EnergyFlowAnimatedProjection {
    /** Drive/regen activation threshold (web `power > 0.5` / `power < -0.5`). */
    const val ACTIVE_THRESHOLD = 0.5

    /** Node + compact-row readout fraction digits (web `AnimatedNumber decimals={1}` / `fmtNumber(..,1)`). */
    const val VALUE_PRECISION = 1

    /** Charger-node readout fraction digits (web `fmtNumber(chargerPower, 0)`). */
    const val CHARGER_NODE_PRECISION = 0

    /** Stable node identifiers (match the web `FlowNode.id`s). */
    const val NODE_BATTERY = "battery"
    const val NODE_DRIVE = "drive"
    const val NODE_CHARGER = "charger"

    /** Project [state] for [size] using the localized [strings]. */
    fun project(
        state: VehicleState,
        size: EnergyFlowAnimatedSize,
        strings: EnergyFlowAnimatedStrings,
    ): EnergyFlowAnimatedDisplay {
        val power = safe(state.power)
        val chargerPower = safe(state.chargerPower)
        val batteryLevel = state.batteryLevel
        val isCharging = state.isCharging
        val isConsuming = power > ACTIVE_THRESHOLD
        val isRegen = power < -ACTIVE_THRESHOLD
        val absPower = kotlin.math.abs(power)
        val batteryPercentText = "$batteryLevel$PERCENT"

        return EnergyFlowAnimatedDisplay(
            isCompact = size.isCompact,
            nodes = nodes(batteryLevel, batteryPercentText, absPower, chargerPower, isConsuming, isRegen, isCharging, strings),
            arrows = arrows(absPower, chargerPower, isConsuming, isRegen, isCharging),
            batteryPercentText = batteryPercentText,
            compactRows = compactRows(power, absPower, chargerPower, isConsuming, isRegen, isCharging, strings),
            compactIsIdle = !isConsuming && !isRegen && !isCharging,
            idleText = strings.idle,
            compactContentDescription =
                compactDescription(batteryPercentText, power, absPower, chargerPower, isConsuming, isRegen, isCharging, strings),
        )
    }

    @Suppress("LongParameterList")
    private fun nodes(
        batteryLevel: Long,
        batteryPercentText: String,
        absPower: Double,
        chargerPower: Double,
        isConsuming: Boolean,
        isRegen: Boolean,
        isCharging: Boolean,
        strings: EnergyFlowAnimatedStrings,
    ): List<EnergyFlowNode> {
        val driveLabel =
            when {
                isConsuming -> strings.drive
                isRegen -> strings.regen
                else -> strings.idle
            }
        val driveFormatted = if (isConsuming || isRegen) "${formatNumber(absPower, VALUE_PRECISION)}$KW_SUFFIX" else EM_DASH
        val chargerFormatted = if (isCharging) "${formatNumber(chargerPower, CHARGER_NODE_PRECISION)}$KW_SUFFIX" else EM_DASH
        return listOf(
            node(
                id = NODE_BATTERY,
                label = strings.battery,
                value = batteryLevel * 1.0,
                formattedValue = batteryPercentText,
                glyph = EnergyFlowGlyph.Battery,
                position = EnergyFlowPosition.Left,
            ),
            node(
                id = NODE_DRIVE,
                label = driveLabel,
                value = absPower,
                formattedValue = driveFormatted,
                glyph = EnergyFlowGlyph.Zap,
                position = EnergyFlowPosition.Right,
            ),
            node(
                id = NODE_CHARGER,
                label = strings.charger,
                value = chargerPower,
                formattedValue = chargerFormatted,
                glyph = EnergyFlowGlyph.Plug,
                position = EnergyFlowPosition.Top,
            ),
        )
    }

    private fun arrows(
        absPower: Double,
        chargerPower: Double,
        isConsuming: Boolean,
        isRegen: Boolean,
        isCharging: Boolean,
    ): List<EnergyFlowArrow> =
        listOf(
            EnergyFlowArrow(NODE_BATTERY, NODE_DRIVE, if (isConsuming) absPower else 0.0, isConsuming, EnergyFlowTint.Drive),
            EnergyFlowArrow(NODE_DRIVE, NODE_BATTERY, if (isRegen) absPower else 0.0, isRegen, EnergyFlowTint.Regen),
            EnergyFlowArrow(NODE_CHARGER, NODE_BATTERY, if (isCharging) chargerPower else 0.0, isCharging, EnergyFlowTint.Charger),
        )

    @Suppress("LongParameterList")
    private fun compactRows(
        power: Double,
        absPower: Double,
        chargerPower: Double,
        isConsuming: Boolean,
        isRegen: Boolean,
        isCharging: Boolean,
        strings: EnergyFlowAnimatedStrings,
    ): List<EnergyFlowCompactRow> =
        buildList {
            if (isCharging) add(compactRow(EnergyFlowGlyph.Plug, strings.charger, chargerPower, EnergyFlowTint.Charger))
            if (isConsuming) add(compactRow(EnergyFlowGlyph.Zap, strings.drive, power, EnergyFlowTint.Drive))
            if (isRegen) add(compactRow(EnergyFlowGlyph.Battery, strings.regen, absPower, EnergyFlowTint.Regen))
        }

    @Suppress("LongParameterList")
    private fun compactDescription(
        batteryPercentText: String,
        power: Double,
        absPower: Double,
        chargerPower: Double,
        isConsuming: Boolean,
        isRegen: Boolean,
        isCharging: Boolean,
        strings: EnergyFlowAnimatedStrings,
    ): String =
        buildList {
            add(batteryPercentText)
            if (isCharging) add("${strings.charger}$SPACE${kw(chargerPower)}")
            if (isConsuming) add("${strings.drive}$SPACE${kw(power)}")
            if (isRegen) add("${strings.regen}$SPACE${kw(absPower)}")
            if (!isConsuming && !isRegen && !isCharging) add(strings.idle)
        }.joinToString(COMMA_SPACE)

    @Suppress("LongParameterList")
    private fun node(
        id: String,
        label: String,
        value: Double,
        formattedValue: String,
        glyph: EnergyFlowGlyph,
        position: EnergyFlowPosition,
    ): EnergyFlowNode = EnergyFlowNode(id, label, value, formattedValue, glyph, position, "$label$SPACE$formattedValue")

    private fun compactRow(
        glyph: EnergyFlowGlyph,
        label: String,
        value: Double,
        tint: EnergyFlowTint,
    ): EnergyFlowCompactRow {
        val valueText = kw(value)
        return EnergyFlowCompactRow(glyph, label, valueText, tint, "$label$SPACE$valueText")
    }

    /** Format a kW figure exactly as the web `CompactView` (`${fmtNumber(value, 1)} kW`). */
    fun kw(value: Double): String = "${formatNumber(kotlin.math.abs(safe(value)), VALUE_PRECISION)}$KW_SUFFIX"

    /**
     * Locale-stable decimal formatter (web `fmtNumber`): en-US grouping + fixed fraction digits with
     * round-half-up, matching `Intl.NumberFormat` / the shared `ChartFormat.number` the animated readout
     * uses, so the projected strings are deterministic regardless of device locale.
     */
    fun formatNumber(
        value: Double,
        decimals: Int,
    ): String = String.format(Locale.US, "%,.${decimals}f", safe(value))

    private fun safe(value: Double): Double = if (value.isFinite()) value else 0.0
}
