// Pure, framework-free model + projection for the SummaryHeroCards feature view — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/analytics/components/weekly-digest/SummaryHeroCards.tsx). No Compose, no Android UI, no
// HTTP: every declaration here is exercised off-device by the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// SummaryHeroCards is a presentational surface — the web component takes `metrics: DigestMetrics` and
// `funFact: FunFact | undefined` as props from the owning Weekly Digest page (which owns the TanStack queries
// in `useWeeklyDigest`), and reads two context hooks for display: `useTranslation` (labels, P1/S10) and
// `useFormatting` (currency symbol + precision, the native binding of the S8 SettingsStore). It renders five
// always-present HighlightCards (Total Distance, Total Drives, Energy Used, Charging Cost, CO2 Saved) plus a
// sixth optional Fun Fact card, each card carrying a label, a number-with-unit value, an optional
// week-over-week trend (the web `trendFor` badge), and a glow color.
//
// Following the sibling DrivingPerformanceCards port, the owning page threads the week summary in through the
// shared cache-then-network state-holder layer (P1/S8) as a [UiState]; the [projectUiState] adapter lets the
// composable render every lifecycle state that layer can carry — loading skeletons, a hard error with retry,
// a friendly empty state, content, and stale/offline "last known" — without ever fetching. The content branch
// reproduces the web card composition exactly, including the optional Fun Fact card and the per-metric
// `trendFor` inversion (energy and cost treat an increase as negative).
//
// Number formatting goes through the golden-pinned shared [ChartFormat.number], the native mirror of the web
// `fmtNumber`/`fmtInt`. The km / kWh / kg unit suffixes are appended verbatim exactly as the web source does
// (it hard-codes them rather than converting through `useUnits`), mirroring how the sibling HeroGauges port
// carries its `kWh` / `kg` unit constants. The Fun Fact subtitle (web `t('…funFactDesc', '≈ {{times}}×
// {{from}} → {{to}}', …)`) is assembled from the same symbol glyphs + data: the `funFactDesc` key is absent
// from the i18n catalog on every platform (the web relies on react-i18next's inline default), and the
// template carries no translatable English — only the ≈ / × / → symbols and the city/multiplier data — so it
// is composed here from symbol constants, never an English literal.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SummaryHeroCards — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.summaryherocards

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.util.Locale
import kotlin.math.abs

// ── Web-parity constants ────────────────────────────────────────────────────────────────────────────

/** Web `fmtNumber(metrics.totalDistance, 1)` / energy / CO2 precision (one fraction digit). */
private const val ONE_DECIMAL = 1

/** Web `fmtInt(metrics.totalDrives)` precision (zero fraction digits, locale grouping). */
private const val INT_DECIMALS = 0

/** Web `formatCurrency(metrics.chargingCost, 2)` precision (two fraction digits). */
private const val COST_DECIMALS = 2

/** Web `trendFor` percentage precision (`fmtNumber(pct, 1)`). */
private const val PCT_DECIMALS = 1

/** Web `trendFor` flat cutoff (`Math.abs(diff) < 0.01` → "0%", treated as a positive/neutral change). */
private const val FLAT_EPSILON = 0.01

/** Web `pctChange` divide-by-zero fallback magnitude (`previous === 0` → 100 when current > 0). */
private const val FULL_PERCENT = 100.0

/** Distance unit suffix, hard-coded by the web source (`… km`), not converted through `useUnits`. */
private const val DISTANCE_UNIT = "km"

/** Energy unit suffix, hard-coded by the web source (`… kWh`). */
private const val ENERGY_UNIT = "kWh"

/** CO2 unit suffix, hard-coded by the web source (`… kg`). */
private const val CO2_UNIT = "kg"

/** Multiplication sign appended to the Fun Fact value (web `${funFact.times}×`). U+00D7. */
private const val MULTIPLICATION_SIGN = "\u00D7"

/** Approximately-equals prefix of the Fun Fact subtitle (web `≈ …`). U+2248 + space. */
private const val APPROX_PREFIX = "\u2248 "

/** Rightwards-arrow separator of the Fun Fact subtitle (web `… → …`). Space + U+2192 + space. */
private const val ARROW_SEPARATOR = " \u2192 "

/** Web `trendFor` "0%" flat badge (a number + percent sign, no translatable text). */
private const val FLAT_PERCENT = "0%"

/** Leading sign the web `trendFor` prepends to a positive change (`${isUp ? '+' : ''}`). */
private const val PLUS_SIGN = "+"

/** Trailing percent sign of a `trendFor` badge value. */
private const val PERCENT_SIGN = "%"

private const val DEFAULT_CURRENCY = "$"
private const val DEFAULT_PRECISION = 2
private const val DEFAULT_LOCALE_TAG = "en-US"
private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

// ── Inputs ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The ten `DigestMetrics` fields the web SummaryHeroCards reads off its `metrics` prop — the five current
 * values and their previous-week counterparts the `trendFor` badges compare against. All are doubles to
 * mirror the web `number` shape (drive counts included, since the web reads them with `fmtInt`); the owning
 * page computes them as finite sums, so no NaN/Infinity guard is needed here.
 *
 * @property totalDistance kilometres driven this week (web `metrics.totalDistance`).
 * @property prevDistance kilometres driven the previous week (web `metrics.prevDistance`).
 * @property totalDrives drive count this week (web `metrics.totalDrives`).
 * @property prevDriveCount drive count the previous week (web `metrics.prevDriveCount`).
 * @property energyUsed energy used this week, kWh (web `metrics.energyUsed`).
 * @property prevEnergy energy used the previous week, kWh (web `metrics.prevEnergy`).
 * @property chargingCost charging cost this week (web `metrics.chargingCost`).
 * @property prevChargingCost charging cost the previous week (web `metrics.prevChargingCost`).
 * @property co2Saved CO2 saved this week, kg (web `metrics.co2Saved`).
 * @property prevCo2 CO2 saved the previous week, kg (web `metrics.prevCo2`).
 */
data class WeekSummaryMetrics(
    val totalDistance: Double,
    val prevDistance: Double,
    val totalDrives: Double,
    val prevDriveCount: Double,
    val energyUsed: Double,
    val prevEnergy: Double,
    val chargingCost: Double,
    val prevChargingCost: Double,
    val co2Saved: Double,
    val prevCo2: Double,
)

/**
 * The Fun Fact the owning page passes alongside the metrics (web `FunFact | undefined`). All three fields are
 * already strings on the web — `times` is pre-formatted by `useWeeklyDigest` (`fmtNumber(times, 1)`) and
 * `from` / `to` are city names — so this carries them verbatim.
 *
 * @property from origin city label (web `funFact.from`).
 * @property to destination city label (web `funFact.to`).
 * @property times the pre-formatted multiplier string (web `funFact.times`).
 */
data class FunFactSummary(
    val from: String,
    val to: String,
    val times: String,
)

/**
 * The full week summary the owning page threads into this surface — the web component's `metrics` prop plus
 * its optional `funFact` prop, grouped so the host has a single value to carry through the [UiState].
 *
 * @property metrics the ten current/previous figures the five metric cards render.
 * @property funFact the optional sixth card's data, or `null` when the week has no fun fact (web `funFact`
 *   undefined → the card is omitted).
 */
data class WeekSummarySnapshot(
    val metrics: WeekSummaryMetrics,
    val funFact: FunFactSummary?,
)

// ── Render-ready projection types ──────────────────────────────────────────────────────────────────

/** The web HighlightCard `color` prop — selects the card's glow accent. */
enum class SummaryHeroColor { Cyan, Green, Purple, Amber }

/** Which authored lucide glyph a card carries (web `icon`), resolved to an ImageVector in the composable. */
enum class SummaryHeroIcon { Distance, Drives, Energy, Cost, Co2, FunFact }

/** The direction a [TrendBadge] points — web `trendFor` `direction` ('up' | 'down' | 'flat'). */
enum class TrendDirection { Up, Down, Flat }

/**
 * One week-over-week change badge — the native analogue of the web `trendFor` result `{ direction, value,
 * positive }`. The web HighlightCard keys both the arrow glyph and the tone color off [positive] (a green
 * up-arrow / a red down-arrow), so this surface reproduces that verbatim, including the inverted-metric
 * quirk where a value like "+5.0%" can carry a red down-arrow when [positive] is false.
 *
 * @property direction the arrow's logical direction; rendered via [positive] like the web source.
 * @property value the already-formatted, signed percentage string (e.g. "+12.3%", "-5.0%", or "0%").
 * @property positive whether the change is good (drives the emerald-vs-rose tone and the up-vs-down arrow).
 */
data class TrendBadge(
    val direction: TrendDirection,
    val value: String,
    val positive: Boolean,
)

/**
 * One fully resolved highlight card — the native analogue of a single web `<HighlightCard>` invocation. Pure
 * data (no Compose types) so the whole projection is asserted off-device. The label is already localized
 * (resolved from the i18n catalog at the Compose boundary and handed in via [SummaryHeroStrings]).
 *
 * @property label the localized card label.
 * @property value the formatted primary value, unit suffix included (web `value` prop).
 * @property trend the week-over-week change badge, or `null` for the Fun Fact card (web `change` omitted).
 * @property subtitle the secondary line, or `null` for the metric cards (web `subtitle`, Fun Fact only).
 * @property color the glow accent (web `color`).
 * @property icon the glyph slot (web `icon`).
 */
data class SummaryHeroCard(
    val label: String,
    val value: String,
    val trend: TrendBadge?,
    val subtitle: String?,
    val color: SummaryHeroColor,
    val icon: SummaryHeroIcon,
)

/**
 * The six localized card labels the composable resolves once (P1/S10) and threads into the projection so the
 * render-ready [SummaryHeroCard.label]s carry no English literal. Keys map 1:1 to the web
 * `t('analytics.weeklyDigest.*')` calls.
 */
data class SummaryHeroStrings(
    val totalDistance: String,
    val totalDrives: String,
    val energyUsed: String,
    val chargingCost: String,
    val co2Saved: String,
    val funFact: String,
)

/**
 * The display preferences this surface resolves from the live `/settings` document — the native union of the
 * web `useFormatting` reads (currency symbol + precision) and the locale that drives number grouping (web
 * `fmtNumber`'s global locale). Resolved from one settings document, mirroring the web hooks which both
 * derive from `useSettings`.
 *
 * @property currencySymbol the resolved currency symbol with the web blank/whitespace → "$" fallback applied.
 * @property precision the default fraction digits (web `useFormatting` `userPrecision`: finite, non-negative,
 *   floored, else 2). SummaryHeroCards overrides it with 2 for the cost card, matching the web call.
 * @property locale the BCP-47 locale driving number grouping/separators (web `fmtNumber` global locale).
 */
data class SummaryHeroDisplayPrefs(
    val currencySymbol: String,
    val precision: Int,
    val locale: Locale,
) {
    companion object {
        /** The "$", 2-dp, en-US defaults applied before settings load (web cold-start defaults). */
        val DEFAULT: SummaryHeroDisplayPrefs = from(null)

        /** Resolves the currency + precision + locale preferences from one `/settings` document. */
        fun from(settings: JsonElement?): SummaryHeroDisplayPrefs {
            val unitPref = UnitPreferences.fromSettings(settings)
            val rawSymbol = (settings as? JsonObject).stringOrNull(KEY_CURRENCY_SYMBOL)
            return SummaryHeroDisplayPrefs(
                currencySymbol = if (!rawSymbol.isNullOrBlank()) rawSymbol else DEFAULT_CURRENCY,
                precision = unitPref.precision ?: DEFAULT_PRECISION,
                locale = localeFor(unitPref.locale),
            )
        }

        private fun localeFor(tag: String?): Locale = Locale.forLanguageTag(tag?.takeIf { it.isNotBlank() } ?: DEFAULT_LOCALE_TAG)
    }
}

// ── Projection ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Pure projection from the surface's prop + display preferences to its render-ready cards — a 1:1 port of the
 * derivations the web component performs. The composable resolves [SummaryHeroStrings] and
 * [SummaryHeroDisplayPrefs] from the i18n catalog and the live settings, then hands them here.
 */
object SummaryHeroCardsProjection {
    /**
     * Maps the host's `(snapshot, isLoading)` onto the shared cache-then-network [UiState] (P1/S8): loading
     * wins outright (skeleton chrome), a present snapshot renders [UiPhase.Content], and an absent snapshot
     * renders [UiPhase.Empty] (a friendly no-data state). The host's stateful binding can additionally carry
     * refreshing/stale/offline/error; the composable renders those too — mirroring the sibling
     * DrivingPerformanceCards adapter.
     */
    fun projectUiState(
        snapshot: WeekSummarySnapshot?,
        isLoading: Boolean,
    ): UiState<WeekSummarySnapshot> =
        when {
            isLoading -> UiState.loading()
            snapshot != null -> UiState(phase = UiPhase.Content, data = snapshot)
            else -> UiState(phase = UiPhase.Empty)
        }

    /**
     * The cards in web source order: the five always-present metric cards, then the Fun Fact card when
     * [WeekSummarySnapshot.funFact] is present (web `funFact && <HighlightCard … />`). Each metric card's
     * value is formatted for [prefs] (locale grouping + the user's currency for cost), with the verbatim km /
     * kWh / kg unit suffix the web hard-codes; its trend is the [trendFor] badge with the web inversion (a
     * larger energy/cost figure is a negative change). The Fun Fact card has no trend and carries the
     * symbol-only subtitle.
     */
    fun cards(
        snapshot: WeekSummarySnapshot,
        prefs: SummaryHeroDisplayPrefs,
        strings: SummaryHeroStrings,
    ): List<SummaryHeroCard> {
        val m = snapshot.metrics
        val locale = prefs.locale
        val metricCards =
            listOf(
                SummaryHeroCard(
                    label = strings.totalDistance,
                    value = ChartFormat.number(m.totalDistance, ONE_DECIMAL, locale) + " " + DISTANCE_UNIT,
                    trend = trendFor(m.totalDistance, m.prevDistance, invertPositive = false, locale = locale),
                    subtitle = null,
                    color = SummaryHeroColor.Cyan,
                    icon = SummaryHeroIcon.Distance,
                ),
                SummaryHeroCard(
                    label = strings.totalDrives,
                    value = ChartFormat.number(m.totalDrives, INT_DECIMALS, locale),
                    trend = trendFor(m.totalDrives, m.prevDriveCount, invertPositive = false, locale = locale),
                    subtitle = null,
                    color = SummaryHeroColor.Green,
                    icon = SummaryHeroIcon.Drives,
                ),
                SummaryHeroCard(
                    label = strings.energyUsed,
                    value = ChartFormat.number(m.energyUsed, ONE_DECIMAL, locale) + " " + ENERGY_UNIT,
                    trend = trendFor(m.energyUsed, m.prevEnergy, invertPositive = true, locale = locale),
                    subtitle = null,
                    color = SummaryHeroColor.Purple,
                    icon = SummaryHeroIcon.Energy,
                ),
                SummaryHeroCard(
                    label = strings.chargingCost,
                    value = formatCurrency(m.chargingCost, prefs, COST_DECIMALS, locale),
                    trend = trendFor(m.chargingCost, m.prevChargingCost, invertPositive = true, locale = locale),
                    subtitle = null,
                    color = SummaryHeroColor.Amber,
                    icon = SummaryHeroIcon.Cost,
                ),
                SummaryHeroCard(
                    label = strings.co2Saved,
                    value = ChartFormat.number(m.co2Saved, ONE_DECIMAL, locale) + " " + CO2_UNIT,
                    trend = trendFor(m.co2Saved, m.prevCo2, invertPositive = false, locale = locale),
                    subtitle = null,
                    color = SummaryHeroColor.Green,
                    icon = SummaryHeroIcon.Co2,
                ),
            )
        val funFact = snapshot.funFact ?: return metricCards
        return metricCards + funFactCard(funFact, strings)
    }

    /**
     * The optional sixth card (web `funFact && <HighlightCard … />`) — the `${times}×` value and the
     * symbol-only [funFactSubtitle], with no trend badge and the cyan glow.
     */
    private fun funFactCard(
        funFact: FunFactSummary,
        strings: SummaryHeroStrings,
    ): SummaryHeroCard =
        SummaryHeroCard(
            label = strings.funFact,
            value = funFact.times + MULTIPLICATION_SIGN,
            trend = null,
            subtitle = funFactSubtitle(funFact),
            color = SummaryHeroColor.Cyan,
            icon = SummaryHeroIcon.FunFact,
        )

    /**
     * The week-over-week change badge — a verbatim port of the web `trendFor(current, previous,
     * invertPositive)`: a sub-[FLAT_EPSILON] difference is the flat "0%" (positive/neutral); otherwise the
     * value is the signed percentage (`+` prepended only when rising, the minus coming from the negative
     * number itself), and [TrendBadge.positive] flips for an inverted metric so a rising energy/cost reads as
     * a bad change.
     */
    fun trendFor(
        current: Double,
        previous: Double,
        invertPositive: Boolean,
        locale: Locale = Locale.getDefault(),
    ): TrendBadge {
        val diff = current - previous
        if (abs(diff) < FLAT_EPSILON) {
            return TrendBadge(direction = TrendDirection.Flat, value = FLAT_PERCENT, positive = true)
        }
        val isUp = diff > 0.0
        val pct = pctChange(current, previous)
        val sign = if (isUp) PLUS_SIGN else ""
        return TrendBadge(
            direction = if (isUp) TrendDirection.Up else TrendDirection.Down,
            value = sign + ChartFormat.number(pct, PCT_DECIMALS, locale) + PERCENT_SIGN,
            positive = if (invertPositive) !isUp else isUp,
        )
    }

    /**
     * Percentage change from [previous] to [current] — the web `pctChange`: a zero baseline yields 100 when
     * the current value is positive (else 0), otherwise the signed relative change over the magnitude of the
     * baseline.
     */
    fun pctChange(
        current: Double,
        previous: Double,
    ): Double {
        if (previous == 0.0) return if (current > 0.0) FULL_PERCENT else 0.0
        return ((current - previous) / abs(previous)) * FULL_PERCENT
    }

    /**
     * Formats a currency [amount] the way the web `useFormatting().formatCurrency` does — the resolved
     * [SummaryHeroDisplayPrefs.currencySymbol] followed by a grouped number via the shared
     * [ChartFormat.number]. [decimals] defaults to the user's precision; SummaryHeroCards passes 2 for the
     * cost card (web `formatCurrency(metrics.chargingCost, 2)`).
     */
    fun formatCurrency(
        amount: Double,
        prefs: SummaryHeroDisplayPrefs,
        decimals: Int = prefs.precision,
        locale: Locale = prefs.locale,
    ): String = prefs.currencySymbol + ChartFormat.number(amount, decimals.coerceAtLeast(0), locale)

    /**
     * Assembles the Fun Fact subtitle the way the web `t('…funFactDesc', '≈ {{times}}× {{from}} → {{to}}',
     * …)` does. The `funFactDesc` key is absent from the i18n catalog on every platform (the web relies on
     * react-i18next's inline default), and the template holds no translatable English — only the ≈ / × / →
     * symbols and the pre-formatted multiplier + city data — so it is composed from symbol constants rather
     * than a localized resource, exactly mirroring the web's effective inline default.
     */
    private fun funFactSubtitle(funFact: FunFactSummary): String =
        APPROX_PREFIX + funFact.times + MULTIPLICATION_SIGN + " " + funFact.from + ARROW_SEPARATOR + funFact.to
}

// ── Diagnostics (P1/S11) ─────────────────────────────────────────────────────────────────────────────

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a
 * distance, drive count, energy, cost, CO2 figure, or fun fact — so a diagnostics line can never leak fleet
 * usage or owner movement.
 */
object SummaryHeroCardsDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "SummaryHeroCards"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

// ── JSON decode helper (web blank/whitespace → "$" parity) ────────────────────────────────────────────

private fun JsonObject?.stringOrNull(key: String): String? = (this?.get(key) as? JsonPrimitive)?.contentOrNull
