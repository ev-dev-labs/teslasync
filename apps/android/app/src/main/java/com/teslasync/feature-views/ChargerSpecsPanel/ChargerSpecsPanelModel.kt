// Pure, framework-free model + projection for the ChargerSpecsPanel feature view — the native analogue of
// everything the web component derives from its `specs` prop before returning JSX
// (web/src/features/charging/components/charging-list/ChargerSpecsPanel.tsx). No Compose, no Android, no
// HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer over these pure functions.
//
// The web component is purely presentational — its parent computes a `ChargerSpecsData` (helpers.ts
// `computeChargerSpecs`) and passes it down; the only web hook is `useTranslation`. The component renders a
// titled `GlassPanel` holding either a four-column breakdown grid (By Voltage / By Phase / By Cable /
// By Brand, the Brand column showing average power) or, when there is no data, a friendly `EmptyState`. Each
// column independently renders its own empty message when it has no rows. This file owns exactly those
// derivations: the `hasData` gate (web `specs && (voltage||cable||brand).length`), the per-column row
// projection, the Brand-only "{int} kW avg" vs "{energy} kWh" branch (web `showAvgPower && avgPower != null`),
// the "{count} sessions · {value}" summary composition, and the PII-safe `view.opened` diagnostic.
//
// SI on the wire, display units at the boundary: [SpecEntry] carries energy in watt-hours ([energyWh]) and
// the per-charger average power in watts ([avgPowerW]) exactly as the SI-canonical API serves them; the
// kWh / kW conversion is a display-only `/1000` performed in [ChargerSpecsPanelProjection.project] (web
// `convertEnergyFromSI(_, 'kWh')` / `convertPowerFromSI(_, 'kW')`), never a stored unit-suffixed field.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ChargerSpecsPanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.chargerspecspanel

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger

/** Middot separating the session count from the metric in a summary line — the web `·` literal. */
internal const val MIDDOT: String = "\u00B7"

/** Display divisor: watt-hours→kilowatt-hours and watts→kilowatts both divide by 1000 (web `/ 1000`). */
private const val PER_KILO: Double = 1_000.0

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, location, or
 * actor, so a diagnostics line can never leak vehicle identity or owner movement from this panel.
 */
const val CHARGER_SPECS_PANEL_SLUG: String = "ChargerSpecsPanel"

/**
 * Which breakdown column an entry belongs to — the stable, locale-independent identity of the web
 * component's four `SpecColumn`s, in source order. Only [Brand] shows average power (web `showAvgPower`);
 * the localized label, the line glyph, and the empty message are resolved at the render boundary (P1/S9 +
 * S10), keeping this enum free of any English literal or Android dependency.
 */
enum class SpecColumnKind {
    /** Web "By Voltage" column. */
    Voltage,

    /** Web "By Phase" column. */
    Phase,

    /** Web "By Cable" column. */
    Cable,

    /** Web "By Brand" column — the only column that shows "{avgPower} kW avg" when a value is present. */
    Brand,
}

/**
 * One grouped charger-spec entry — the native mirror of the web `SpecEntry` the component reads
 * (`{ name, count, energy, avgPower }`), with SI units instead of pre-converted display units. [name] is the
 * group label (charger brand / cable type / …), [count] the number of sessions, [energyWh] the summed energy
 * added in watt-hours (SI; web `energy`, pre-converted to kWh), and [avgPowerW] the average peak power in
 * watts (SI; web `avgPower`, pre-converted to kW), `null` when the group had no power samples.
 */
data class SpecEntry(
    val name: String,
    val count: Long,
    val energyWh: Double,
    val avgPowerW: Double?,
)

/**
 * The four grouped breakdowns the panel renders — the native mirror of the web `ChargerSpecsData`
 * (`{ voltage, phase, cable, brand }`). Each list is already grouped + sorted by the parent
 * (`computeChargerSpecs`); this surface only renders it.
 */
data class ChargerSpecsData(
    val voltage: List<SpecEntry>,
    val phase: List<SpecEntry>,
    val cable: List<SpecEntry>,
    val brand: List<SpecEntry>,
)

/**
 * The already-localized strings the panel renders, resolved through the P1/S10 i18n facade at the Compose
 * boundary and passed down so the surface holds no English literal. Carries the title, the four column
 * labels + their empty messages, the panel-level no-data message, and the unit words composed into each
 * summary line (`sessions`, `kW`, `kWh`, `avg`).
 */
data class ChargerSpecsStrings(
    val title: String,
    val byVoltage: String,
    val byPhase: String,
    val byCable: String,
    val byBrand: String,
    val noVoltage: String,
    val noPhase: String,
    val noCable: String,
    val noBrand: String,
    val noData: String,
    val sessions: String,
    val kw: String,
    val kwh: String,
    val avg: String,
)

/**
 * The locale-bound number formatters the projection injects so it stays deterministic and UI-free under
 * test (the native analogue of the web `fmtInt` / `fmtWithUnit` calls). [count] formats a raw session count
 * (web renders `{v.count}` verbatim, ungrouped); [energyKwh] formats a kWh value (web
 * `fmtWithUnit(energy, 'kWh')`, grouped, two fraction digits); [powerKw] formats a kW value (web
 * `fmtInt(avgPower)`, grouped integer). Each receives the already-converted display value.
 */
data class ChargerSpecsFormatters(
    val count: (Long) -> String,
    val energyKwh: (Double) -> String,
    val powerKw: (Double) -> String,
)

/** One render-ready row: the group [name] (left) and the composed [summary] line (right). */
data class ChargerSpecsRow(
    val name: String,
    val summary: String,
)

/**
 * One render-ready breakdown column — its [kind], its localized [label], the localized [emptyMessage] shown
 * when it has no [rows] (web `SpecColumn`'s own `EmptyState`), and its projected [rows].
 */
data class ChargerSpecsColumn(
    val kind: SpecColumnKind,
    val label: String,
    val emptyMessage: String,
    val rows: List<ChargerSpecsRow>,
) {
    /** True when this column has no rows — render its [emptyMessage] instead, never a blank gap. */
    val isEmpty: Boolean get() = rows.isEmpty()
}

/**
 * The fully projected, render-ready inputs — the four [columns] (always present, in web source order) and
 * the [hasData] gate that decides whether the grid or the panel-level empty state shows.
 */
data class ChargerSpecsProjectionResult(
    val columns: List<ChargerSpecsColumn>,
    val hasData: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's `hasData` gate,
 * its four `SpecColumn`s, and each column's row formatting. Stateless and side-effect-free so it is fully
 * covered by the off-device unit gate; the composable only resolves localized strings/glyphs/formatters and
 * draws what these return.
 */
object ChargerSpecsPanelProjection {
    /**
     * Whether the panel shows the breakdown grid (vs the panel-level empty state) — a faithful mirror of the
     * web `specs && (specs.voltage.length || specs.cable.length || specs.brand.length)`. Phase is
     * intentionally excluded, exactly as the web gate omits it (the web `computeChargerSpecs` never
     * populates `voltage`/`phase`, but the component's gate references `voltage`, `cable`, `brand`).
     */
    fun hasData(specs: ChargerSpecsData?): Boolean =
        specs != null && (specs.voltage.isNotEmpty() || specs.cable.isNotEmpty() || specs.brand.isNotEmpty())

    /**
     * Maps the web `specs` prop onto the shared cache-then-network [UiState] (P1/S8), reproducing the web
     * component's two outcomes: a populated breakdown → [UiPhase.Content]; missing/empty data →
     * [UiPhase.Empty] (the web panel-level `EmptyState`). The host's stateful binding can additionally carry
     * loading/refreshing/stale/offline/error; the composable renders those too. This parity adapter only
     * produces the states the web `specs` prop can express.
     */
    fun projectUiState(specs: ChargerSpecsData?): UiState<ChargerSpecsData> =
        if (hasData(specs)) {
            UiState(phase = UiPhase.Content, data = specs)
        } else {
            UiState(phase = UiPhase.Empty, data = specs)
        }

    /**
     * Projects [specs] into the four render-ready [ChargerSpecsColumn]s (always in web source order) plus the
     * [hasData] gate, formatting each row via the injected [formatters] and labeling via [strings]. A `null`
     * or empty group yields an empty column carrying its localized empty message.
     */
    fun project(
        specs: ChargerSpecsData?,
        strings: ChargerSpecsStrings,
        formatters: ChargerSpecsFormatters,
    ): ChargerSpecsProjectionResult {
        val columns =
            SpecColumnKind.entries.map { kind ->
                buildColumn(kind, specs?.entriesFor(kind), strings, formatters)
            }
        return ChargerSpecsProjectionResult(columns = columns, hasData = hasData(specs))
    }

    private fun buildColumn(
        kind: SpecColumnKind,
        entries: List<SpecEntry>?,
        strings: ChargerSpecsStrings,
        formatters: ChargerSpecsFormatters,
    ): ChargerSpecsColumn =
        ChargerSpecsColumn(
            kind = kind,
            label = strings.label(kind),
            emptyMessage = strings.emptyMessage(kind),
            rows = (entries ?: emptyList()).map { entry -> projectRow(kind, entry, strings, formatters) },
        )

    /**
     * Builds one row's summary — the native mirror of the web
     * `{v.count} sessions · {showAvgPower && v.avgPower != null ? `${fmtInt(v.avgPower)} kW avg` :
     * fmtWithUnit(v.energy, 'kWh')}`. Only the [SpecColumnKind.Brand] column shows average power, and only
     * when [SpecEntry.avgPowerW] is present; every other case shows the energy in kWh. kWh / kW are the
     * display `/1000` of the SI watt-hour / watt inputs.
     */
    private fun projectRow(
        kind: SpecColumnKind,
        entry: SpecEntry,
        strings: ChargerSpecsStrings,
        formatters: ChargerSpecsFormatters,
    ): ChargerSpecsRow {
        val showAvgPower = kind == SpecColumnKind.Brand
        val avgPowerKw = entry.avgPowerW?.div(PER_KILO)
        val valuePart =
            if (showAvgPower && avgPowerKw != null) {
                "${formatters.powerKw(avgPowerKw)} ${strings.kw} ${strings.avg}"
            } else {
                "${formatters.energyKwh(entry.energyWh / PER_KILO)} ${strings.kwh}"
            }
        val summary = "${formatters.count(entry.count)} ${strings.sessions} $MIDDOT $valuePart"
        return ChargerSpecsRow(name = entry.name, summary = summary)
    }

    private fun ChargerSpecsData.entriesFor(kind: SpecColumnKind): List<SpecEntry> =
        when (kind) {
            SpecColumnKind.Voltage -> voltage
            SpecColumnKind.Phase -> phase
            SpecColumnKind.Cable -> cable
            SpecColumnKind.Brand -> brand
        }

    private fun ChargerSpecsStrings.label(kind: SpecColumnKind): String =
        when (kind) {
            SpecColumnKind.Voltage -> byVoltage
            SpecColumnKind.Phase -> byPhase
            SpecColumnKind.Cable -> byCable
            SpecColumnKind.Brand -> byBrand
        }

    private fun ChargerSpecsStrings.emptyMessage(kind: SpecColumnKind): String =
        when (kind) {
            SpecColumnKind.Voltage -> noVoltage
            SpecColumnKind.Phase -> noPhase
            SpecColumnKind.Cable -> noCable
            SpecColumnKind.Brand -> noBrand
        }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [CHARGER_SPECS_PANEL_SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordChargerSpecsPanelOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to CHARGER_SPECS_PANEL_SLUG))
}
