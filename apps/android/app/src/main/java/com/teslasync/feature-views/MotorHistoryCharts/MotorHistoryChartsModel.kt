// Pure, framework-free model + projection for the Motor History charts feature view — the native analogue
// of everything the web component reads before returning JSX
// (web/src/features/driving/components/driving-dynamics/MotorHistoryCharts.tsx). No Compose, no Android, no
// HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the
// composable stays a thin render layer over these pure functions.
//
// The web component is purely presentational. From its `motorHistory: MotorSnapshot[]` prop it builds three
// flat chart-data arrays — each `{ time: formatTime(s.ts), … }` — and renders three independent
// `ChartContainer`s: a Power-over-time AreaChart (`power` = `s.power_kw`, `regen` = `s.regen_kw`), a Torque
// LineChart (`front` = `s.torque_nm_front`, `rear` = `s.torque_nm_rear`) and an RPM LineChart
// (`front` = `s.motor_rpm_front`, `rear` = `s.motor_rpm_rear`). Each chart shows its data when
// `chartData.length > 0`, otherwise the `dynamics.awaitingData` empty state. This file owns that mapping and
// the `length > 0` content/empty boundary.
//
// Units (web parity; SI note): the web reads the already-display-unit motor-pivot fields verbatim — kW
// (`power_kw` / `regen_kw`), Nm (`torque_nm_*`) and RPM (`motor_rpm_*`) — and applies NO `useUnits()`
// conversion to them (its `toSpeedDisplay` / `speedUnit` props are unused in the body). The axis units are
// the web's fixed `" kW"` / `" Nm"` / `" RPM"` literals. Reproducing the web's observable output therefore
// means reading these fields as-is with those fixed units; introducing a conversion the web does not perform
// would be a silent drift. The x-axis time label is the host's concern, exactly as in the sibling
// StatorTempChart port (the web parent's `formatTime(s.ts)` fills `time`), so [MotorHistorySample.time] is
// already a formatted label.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/MotorHistoryCharts — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.motorhistorycharts

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Power / regen display precision — one-decimal kW (the web `" kW"` axis magnitude). */
internal const val POWER_DECIMALS: Int = 1

/** Torque display precision — whole newton-metres (torque magnitudes are hundreds of Nm). */
internal const val TORQUE_DECIMALS: Int = 0

/** RPM display precision — whole revolutions per minute (RPM magnitudes are thousands). */
internal const val RPM_DECIMALS: Int = 0

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object MotorHistoryChartsRegistration {
    /** Stable surface id. */
    const val ID: String = "motor-history-charts"

    /**
     * The web `useHiddenSeries('motor-power-history')` persistence key for the interactive Power-chart
     * legend; the native legend persists the hidden set via `rememberSaveable` keyed by this id.
     */
    const val POWER_HIDDEN_KEY: String = "motor-power-history"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no telemetry data. */
    const val SLUG: String = "MotorHistoryCharts"
}

/**
 * One motor-history sample reduced to exactly the fields the web `MotorHistoryCharts` reads from each
 * `MotorSnapshot` — the native mirror of that prop slice. Temperature / inverter / heat-sink fields belong to
 * the sibling drivetrain charts (StatorTempChart, …) and are intentionally omitted.
 *
 * @property time the already-formatted x-axis label (the web parent's `formatTime(s.ts)`); rendered verbatim
 *   as the bottom-axis tick on all three charts.
 * @property powerKw drive power in kW (web `s.power_kw`); `null` is a gap the line connects across.
 * @property regenKw regen power in kW (web `s.regen_kw`).
 * @property torqueFront front-axle torque in Nm (web `s.torque_nm_front`).
 * @property torqueRear rear-axle torque in Nm (web `s.torque_nm_rear`).
 * @property rpmFront front motor speed in RPM (web `s.motor_rpm_front`).
 * @property rpmRear rear motor speed in RPM (web `s.motor_rpm_rear`).
 */
data class MotorHistorySample(
    val time: String,
    val powerKw: Double?,
    val regenKw: Double?,
    val torqueFront: Double?,
    val torqueRear: Double?,
    val rpmFront: Double?,
    val rpmRear: Double?,
)

/**
 * The already-localized chart microcopy the composable reads from the i18n catalog (P1/S10) — the
 * `dynamics.*` keys the web component resolves via `t(...)`. The lifecycle-chrome strings
 * (empty / error / retry / offline / freshness) and the fixed `kW` / `Nm` / `RPM` axis units are resolved
 * inline at the Compose boundary, not here, so this holder stays a thin content carrier.
 *
 * @property powerTitle / powerSubtitle / powerAria the Power chart's title, subtitle and screen-reader
 *   description (web `dynamics.powerOverTime` / `…Desc` / `…aria`; the aria key is catalog-absent ⇒ resolved
 *   via [resolveOptional]).
 * @property torqueTitle / torqueSubtitle / torqueAria the Torque chart strings (web `dynamics.torqueHistory`).
 * @property rpmTitle / rpmSubtitle / rpmAria the RPM chart strings (web `dynamics.rpmHistory`).
 * @property powerLabel / regenLabel the Power chart series names (web `dynamics.power` / `dynamics.regen`).
 * @property torqueFrontLabel / torqueRearLabel the Torque series names (web `dynamics.torqueFront` / `…Rear`).
 * @property rpmFrontLabel / rpmRearLabel the RPM series names (web `dynamics.rpmFront` / `dynamics.rpmRear`).
 * @property timeColumn the accessible data-table's first-column header (shared `drivetrain.col.time`).
 */
data class MotorHistoryChartsStrings(
    val powerTitle: String,
    val powerSubtitle: String,
    val powerAria: String,
    val torqueTitle: String,
    val torqueSubtitle: String,
    val torqueAria: String,
    val rpmTitle: String,
    val rpmSubtitle: String,
    val rpmAria: String,
    val powerLabel: String,
    val regenLabel: String,
    val torqueFrontLabel: String,
    val torqueRearLabel: String,
    val rpmFrontLabel: String,
    val rpmRearLabel: String,
    val timeColumn: String,
)

/**
 * The fully projected, render-ready inputs for all three charts — the native analogue of the web component's
 * `powerChartData` / `torqueChartData` / `rpmChartData` maps plus each `ChartContainer`'s accessible table.
 * Pure data (no Compose types) so the projection is unit-tested without a UI host: the composable wraps the
 * `*Values` lists into `ChartSeries`, feeds [times] to the bottom axis, and renders the `*TableRows` as the
 * accessible fallback tables.
 *
 * [isEmpty] is the web `chartData.length > 0` boundary, negated — true projects the `dynamics.awaitingData`
 * empty surface for every chart and omits the plots. All three charts derive from the same sample list, so
 * they share one [times] axis and one [isEmpty] gate.
 */
data class MotorHistoryChartsProjectionResult(
    val times: List<String>,
    val powerValues: List<Double?>,
    val regenValues: List<Double?>,
    val torqueFrontValues: List<Double?>,
    val torqueRearValues: List<Double?>,
    val rpmFrontValues: List<Double?>,
    val rpmRearValues: List<Double?>,
    val powerTableRows: List<List<String>>,
    val torqueTableRows: List<List<String>>,
    val rpmTableRows: List<List<String>>,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — a 1:1 port of the web component's three `motorHistory.map`
 * builds and their chart/table bindings. Stateless and side-effect-free so it is fully covered by the
 * off-device unit gate; the composable only resolves localized strings, palette colors, the hidden-series
 * state, and freshness chrome.
 */
object MotorHistoryChartsProjection {
    /**
     * Projects [points] into render-ready chart inputs, preserving the received order (the web maps each
     * array in source order). [times] feed every chart's X axis (web `time`); the six `*Values` lists become
     * the chart series (web `power` / `regen` / `front` / `rear`), and each sample contributes one
     * accessible-table row per chart. Injecting the three formatters keeps the projection locale-deterministic
     * for tests; the composable supplies the real locale-aware kW / Nm / RPM formatters. Sets
     * [MotorHistoryChartsProjectionResult.isEmpty] for the web `chartData.length > 0` boundary (negated).
     */
    fun project(
        points: List<MotorHistorySample>,
        formatPower: (Double?) -> String,
        formatTorque: (Double?) -> String,
        formatRpm: (Double?) -> String,
    ): MotorHistoryChartsProjectionResult =
        MotorHistoryChartsProjectionResult(
            times = points.map { it.time },
            powerValues = points.map { it.powerKw },
            regenValues = points.map { it.regenKw },
            torqueFrontValues = points.map { it.torqueFront },
            torqueRearValues = points.map { it.torqueRear },
            rpmFrontValues = points.map { it.rpmFront },
            rpmRearValues = points.map { it.rpmRear },
            powerTableRows = points.map { listOf(it.time, formatPower(it.powerKw), formatPower(it.regenKw)) },
            torqueTableRows = points.map { listOf(it.time, formatTorque(it.torqueFront), formatTorque(it.torqueRear)) },
            rpmTableRows = points.map { listOf(it.time, formatRpm(it.rpmFront), formatRpm(it.rpmRear)) },
            isEmpty = points.isEmpty(),
        )

    /** Locale-aware one-decimal kW formatting; `null` / non-finite renders as the shared em dash gap. */
    fun formatPower(
        value: Double?,
        locale: Locale = Locale.getDefault(),
    ): String = ChartFormat.number(value, POWER_DECIMALS, locale)

    /** Locale-aware whole-number Nm formatting; `null` / non-finite renders as the shared em dash gap. */
    fun formatTorque(
        value: Double?,
        locale: Locale = Locale.getDefault(),
    ): String = ChartFormat.number(value, TORQUE_DECIMALS, locale)

    /** Locale-aware whole-number RPM formatting; `null` / non-finite renders as the shared em dash gap. */
    fun formatRpm(
        value: Double?,
        locale: Locale = Locale.getDefault(),
    ): String = ChartFormat.number(value, RPM_DECIMALS, locale)
}

/** Resource name (by-name; absent ⇒ [MotorHistoryChartsDefaults.POWER_ARIA]) for web `dynamics.powerOverTime.aria`. */
const val KEY_POWER_ARIA: String = "translation_dynamics_powerOverTime_aria"

/** Resource name (by-name; absent ⇒ [MotorHistoryChartsDefaults.TORQUE_ARIA]) for web `dynamics.torqueHistory.aria`. */
const val KEY_TORQUE_ARIA: String = "translation_dynamics_torqueHistory_aria"

/** Resource name (by-name; absent ⇒ [MotorHistoryChartsDefaults.RPM_ARIA]) for web `dynamics.rpmHistory.aria`. */
const val KEY_RPM_ARIA: String = "translation_dynamics_rpmHistory_aria"

/**
 * Native fallback microcopy. The visible title / subtitle / series / empty keys (`dynamics.powerOverTime`,
 * `dynamics.powerOverTimeDesc`, `dynamics.power`, `dynamics.regen`, `dynamics.torqueHistory`,
 * `dynamics.torqueFront`, … and `dynamics.awaitingData`) exist in the i18n catalog (P1/S10) and resolve at
 * compile time. These defaults back the three strings the catalog does not define: each chart's accessible
 * description (web `t('dynamics.*.aria', …)`). They reproduce i18next's "return the default when the key is
 * absent" behaviour, so the surface still carries the web's English fallback verbatim while routing through
 * the i18n facade. (strings.xml is not in this surface's allowed files, so the keys cannot be added here.)
 */
object MotorHistoryChartsDefaults {
    /** Web `t('dynamics.powerOverTime.aria', '…')` default. */
    const val POWER_ARIA: String = "Motor power and regen over time area chart"

    /** Web `t('dynamics.torqueHistory.aria', '…')` default. */
    const val TORQUE_ARIA: String = "Front and rear motor torque over time line chart"

    /** Web `t('dynamics.rpmHistory.aria', '…')` default. */
    const val RPM_ARIA: String = "Front and rear motor RPM over time line chart"
}

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a thin
 * seam over the Android string catalog in production (an optional by-name resource read) and a map in tests,
 * so the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [MotorHistoryChartsRegistration.SLUG]
 * (P1/S11). Carries only the slug — never a power / torque / RPM figure or timestamp — so a diagnostics line
 * can never leak the vehicle's drive telemetry. Kept free of Compose so it is unit-tested with a recording
 * [Logger]; the composable calls it from its first-composition effect.
 */
fun recordMotorHistoryChartsOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to MotorHistoryChartsRegistration.SLUG))
}
