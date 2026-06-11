// Pure, framework-free model + projection for the Warranty Status dashboard widget — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/WarrantyStatusWidget.tsx). No Compose, no Android, no HTTP: every type
// here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin
// render layer. The warranty envelope arrives as a raw `JsonElement` (`GET /tesla/warranty`, web
// `useWarrantyDetails`), so this file owns the `envelope?.data` unwrap, the web `asString`/`asNumber`
// null-safe reads, the defensive multi-key probing (`a ?? b ?? c`), the `daysUntil`/`statusVariant` math, and
// the display-boundary distance conversion + date formatting (Phase-48 SI-canonical rule; web `useUnits`/
// `useDateFormat`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/WarrantyStatusWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling Subscriptions/MaintenanceTracker
// widgets do. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.warrantystatus

import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.formatDistance
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.max

/** Em dash shown for a missing reading — the web `'—'` fallback for an absent date / count. */
internal const val EM_DASH: String = "\u2014"

/** Distance renders as whole units — web `fmtNumber(convertDistanceFromSI(...), 0)` (0 fraction digits). */
private const val DISTANCE_DECIMALS: Int = 0

/** Warning threshold (days): web `statusVariant` warns at or below 90 days remaining. */
private const val WARNING_DAYS: Int = 90

/** Mileage urgency thresholds — web mileage-bar color: > 0.9 red, > 0.75 amber, else green. */
private const val MILEAGE_DANGER_RATIO: Double = 0.9
private const val MILEAGE_WARNING_RATIO: Double = 0.75

/** Milliseconds in a calendar day — the web `1000 * 60 * 60 * 24` divisor in `daysUntil`/`totalDays`. */
private const val MILLIS_PER_DAY: Double = 86_400_000.0

/** Milliseconds in a second — scales a bare `yyyy-MM-dd` epoch-second to the epoch-milli the parsers yield. */
private const val MILLIS_PER_SECOND: Long = 1_000L

/** Length of the leading `yyyy-MM-dd` slice of an ISO date / date-time string. */
private const val ISO_DATE_PREFIX_LENGTH: Int = 10

/** Locale-stable short month abbreviations — the en-US `toLocaleDateString` output the web `formatDate` and
 * the coverage `Intl.DateTimeFormat({ month: 'short' })` produce by default. */
private val SHORT_MONTHS: List<String> =
    listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

/** Envelope key carrying the stored warranty document (web `infoResponse?.data`). */
private const val ENVELOPE_DATA_KEY: String = "data"

// Expiry / mileage / start probing keys — the exact `a ?? b ?? c` fallback chains the web component reads.
private val EXPIRY_KEYS = arrayOf("warranty_expiry_date", "expiry_date", "basic_expiry_date")
private val MILEAGE_LIMIT_KEYS = arrayOf("mileage_limit_mi", "mileage_limit", "basic_mileage_limit_mi")
private val CURRENT_MILEAGE_KEYS = arrayOf("current_mileage_mi", "odometer_mi", "current_odometer_mi")
private val START_KEYS = arrayOf("warranty_start_date", "start_date", "in_service_date")

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The web
 * component reads `size.cols` to choose the compact (days-remaining hero) vs standard (progress bars +
 * coverage rows) layout, so this type carries the same axis the registry constrains.
 */
data class WarrantyStatusSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `size.cols <= 1`): render the compact days-remaining hero. */
    val isCompact: Boolean get() = cols <= 1
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/vehicle.ts (`warranty-status`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay in
 * lockstep.
 */
object WarrantyStatusRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "warranty-status"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "vehicle"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "WarrantyStatusWidget"

    /** Default footprint: 2 columns × 2 rows (web `defaultSize`). */
    val DEFAULT_SIZE: WarrantyStatusSize = WarrantyStatusSize(cols = 2, rows = 2)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val MIN_SIZE: WarrantyStatusSize = WarrantyStatusSize(cols = 1, rows = 2)

    /** Maximum footprint: 3 columns × 40 rows (web `maxSize`). */
    val MAX_SIZE: WarrantyStatusSize = WarrantyStatusSize(cols = 3, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: WarrantyStatusSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: WarrantyStatusSize): WarrantyStatusSize =
        WarrantyStatusSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` (distance unit)
 * + `useDateFormat` (locale) reads from the `/settings` document. Carries the full [unitPref] (distance unit
 * + locale for the mileage figures); the date formatting is locale-stable en-US (the web `formatDate`
 * default), matching the sibling widgets.
 */
data class WarrantyStatusDisplayPrefs(
    val unitPref: UnitPref,
) {
    companion object {
        /** Metric defaults used before settings load (matches the web cold-start defaults). */
        val METRIC_DEFAULT: WarrantyStatusDisplayPrefs =
            WarrantyStatusDisplayPrefs(UnitPreferences.fromSettings(null))

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`). */
        fun fromSettings(settings: JsonElement?): WarrantyStatusDisplayPrefs =
            WarrantyStatusDisplayPrefs(UnitPreferences.fromSettings(settings))
    }
}

/**
 * One known warranty coverage type to extract from the data document — the native mirror of an entry in the
 * web `COVERAGE_TYPES` array. [dataKey] is the snake_case document flag (web `data[cov.key]`), [resourceKey]
 * is the i18n catalog resource name the composable resolves the display label from, and [fallback] is the
 * literal used when the key is absent from the catalog (web `t(cov.labelKey, cov.fallback)` — these label
 * keys ship only as fallbacks, exactly as on web).
 */
data class CoverageTypeSpec(
    val dataKey: String,
    val resourceKey: String,
    val fallback: String,
)

/**
 * The five known coverage types, in the web `COVERAGE_TYPES` order. The composable resolves each
 * [CoverageTypeSpec.resourceKey] against the S10 catalog (falling back to [CoverageTypeSpec.fallback] when
 * absent — the catalog ships these as fallback-only, matching the web) and folds the resolved labels into
 * [WarrantyStatusStrings.coverageLabels].
 */
val COVERAGE_TYPES: List<CoverageTypeSpec> =
    listOf(
        CoverageTypeSpec("basic", "translation_widget_warranty_basic", "Basic"),
        CoverageTypeSpec("battery_drive_unit", "translation_widget_warranty_batteryDrive", "Battery/Drive Unit"),
        CoverageTypeSpec("corrosion", "translation_widget_warranty_corrosion", "Corrosion"),
        CoverageTypeSpec("emissions", "translation_widget_warranty_emissions", "Emissions"),
        CoverageTypeSpec("body", "translation_widget_warranty_body", "Body"),
    )

/**
 * Localized labels the surface folds into its output — the fourteen web `t('widget.warranty.*')` chrome keys
 * plus the resolved [coverageLabels] (web `COVERAGE_TYPES[*].label`, keyed by [CoverageTypeSpec.dataKey]). The
 * pure [WarrantyStatusProjection] reads these to assemble each visible string + TalkBack content description;
 * the composable builds this from `stringResource` + the i18n fallback resolver, while tests pass a
 * deterministic instance.
 */
data class WarrantyStatusStrings(
    val title: String,
    val expired: String,
    val active: String,
    val expiryDate: String,
    val daysRemaining: String,
    val mileageLimit: String,
    val currentMileage: String,
    val included: String,
    val covered: String,
    val daysLeft: String,
    val noData: String,
    val timeRemaining: String,
    val daysUnit: String,
    val mileageRemaining: String,
    val coverageLabels: Map<String, String>,
)

/**
 * The three status tiers the web derives. `statusVariant` resolves Success / Warning / Danger from the
 * days-remaining figure (web `'success' | 'warning' | 'error'`, where `'error'` renders as the danger badge
 * variant and the red bar color); the mileage bar resolves the same tiers from the used/limit ratio. The
 * render layer maps a tier to a Badge variant + a status color token.
 */
enum class WarrantyStatusTier { Success, Warning, Danger }

/**
 * A projected status chip — the native analogue of a web `Badge`. Carries the already-localized [text] and
 * its [tier] (the render layer maps it to a Badge variant + color).
 */
data class WarrantyBadge(
    val text: String,
    val tier: WarrantyStatusTier,
)

/**
 * A projected, render-ready progress bar — the native analogue of a web `MetricBar`. Carries the raw numeric
 * [value]/[max] (already converted to the user's distance unit for the mileage bar; raw days for the time
 * bar), the color [tier], the localized [label], and the formatted [sublabel] (right-aligned figure).
 */
data class WarrantyMetricBar(
    val value: Double,
    val max: Double,
    val tier: WarrantyStatusTier,
    val label: String,
    val sublabel: String,
)

/**
 * One projected detail row — the native analogue of a web `DetailEntry` rendered by `WidgetDetailCard`.
 * Carries the resolved [label], the already-formatted [value] (em-dash when absent — web `entry.value ??
 * '—'`), an optional [badge] (the expiry status + coverage chips), and whether the value renders [mono]
 * (monospace, web `entry.mono`).
 */
data class WarrantyDetailRow(
    val label: String,
    val value: String,
    val badge: WarrantyBadge?,
    val mono: Boolean,
)

/**
 * The fully projected, render-ready view of the warranty status — the native analogue of everything the web
 * component computes before returning JSX. Pure data (no Compose types) so the projection is unit-tested
 * without a UI host. Carries both the compact-hero fields and the standard-layout fields; the composable
 * renders one set per [WarrantyStatusSize.isCompact].
 *
 * @property hasData web `warrantyData != null` — false ⇒ both layouts show the friendly empty state.
 * @property compactDaysText the days-remaining figure for the compact hero (web `fmtInt(max(days,0))` or `—`).
 * @property compactBadge the Active/Expired status chip for the compact hero.
 * @property compactContentDescription folded TalkBack phrase for the compact hero.
 * @property timeBar the time-remaining progress bar, or `null` when start/expiry are not both parseable (web
 *   `totalDays != null && daysUsed != null`).
 * @property mileageBar the mileage-remaining progress bar, or `null` when limit/current are not both present
 *   (web `mileageLimitMi != null && currentMileageMi != null`).
 * @property detailRows the expiry/days/mileage/coverage rows (web `WidgetDetailCard` entries); always carries
 *   at least the Expiry Date + Days Remaining rows when [hasData].
 */
data class WarrantyStatusDisplay(
    val hasData: Boolean,
    val compactDaysText: String,
    val compactBadge: WarrantyBadge,
    val compactContentDescription: String,
    val timeBar: WarrantyMetricBar?,
    val mileageBar: WarrantyMetricBar?,
    val detailRows: List<WarrantyDetailRow>,
)

/**
 * Reads the `data` document out of the raw `/tesla/warranty` [envelope] (web `infoResponse?.data ?? null`). A
 * non-object response, or a `data` that is absent / JSON-null, yields `null` (no warranty to render).
 */
fun warrantyData(envelope: JsonElement?): JsonObject? = (envelope as? JsonObject)?.get(ENVELOPE_DATA_KEY) as? JsonObject

/**
 * Whether the warranty envelope carries a renderable `data` object (web `warrantyData != null`). Drives the
 * view-model empty classification so a `JsonNull`/dataless envelope still shows the friendly empty state.
 */
fun hasWarrantyData(envelope: JsonElement?): Boolean = warrantyData(envelope) != null

/**
 * Whole days until [dateStr] relative to [nowMillis] — the web `daysUntil` (`Math.ceil((expiry - now) /
 * msPerDay)`). `null` when [dateStr] is null/blank or unparseable (web `isNaN` guard).
 */
fun daysUntil(
    dateStr: String?,
    nowMillis: Long,
): Int? {
    val expiry = parseDateMillis(dateStr) ?: return null
    return ceil((expiry - nowMillis) / MILLIS_PER_DAY).toInt()
}

/**
 * Whole days between [startStr] and [endStr] — the web `totalDays` memo (`Math.ceil((end - start) /
 * msPerDay)`). `null` when either bound is null/blank or unparseable (web `isNaN` guard ⇒ no time bar).
 */
fun totalDaysBetween(
    startStr: String?,
    endStr: String?,
): Int? {
    val start = parseDateMillis(startStr)
    val end = parseDateMillis(endStr)
    return if (start != null && end != null) ceil((end - start) / MILLIS_PER_DAY).toInt() else null
}

/**
 * Parses an ISO date / date-time / instant [dateStr] to epoch milliseconds, mirroring the breadth of the web
 * `new Date(dateStr)`. Tries an instant (with `Z`/offset), an offset date-time, a zoneless date-time (read as
 * UTC for determinism), then a bare `yyyy-MM-dd` (UTC midnight, matching `new Date("2025-06-01")`). `null`
 * for a null/blank/unparseable value.
 */
internal fun parseDateMillis(dateStr: String?): Long? {
    val raw = dateStr?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    return runCatching { Instant.parse(raw).toEpochMilli() }
        .recoverCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
        .recoverCatching { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC).toEpochMilli() }
        .recoverCatching { LocalDate.parse(raw).atStartOfDay(ZoneOffset.UTC).toEpochSecond() * MILLIS_PER_SECOND }
        .getOrNull()
}

/**
 * Safely coerces a JSON value to a non-empty string — the native analogue of the web `asString`: a non-empty
 * string yields itself, a number yields its textual form, and everything else (boolean, object, array, null,
 * JSON-null, empty string) yields `null`.
 */
internal fun asString(element: JsonElement?): String? =
    when (val primitive = element as? JsonPrimitive) {
        null, JsonNull -> null
        else ->
            when {
                primitive.isString -> primitive.content.takeIf { it.isNotEmpty() }
                primitive.doubleOrNull != null -> primitive.content
                else -> null
            }
    }

/**
 * Safely coerces a JSON value to a finite number — the native analogue of the web `asNumber`: a finite JSON
 * number (or a numeric string) yields its value, everything else yields `null`.
 */
internal fun asNumber(element: JsonElement?): Double? = (element as? JsonPrimitive)?.doubleOrNull?.takeIf { it.isFinite() }

/**
 * The first present value across [keys] — the native analogue of the web `a ?? b ?? c` chain. Returns the
 * value of the first key that exists and is not JSON-null (JS `??` skips only `null`/`undefined`, so a `0` /
 * `false` / `""` flag still wins); `null` when every candidate is absent or JSON-null.
 */
private fun JsonObject.firstPresent(keys: Array<String>): JsonElement? {
    for (key in keys) {
        val value = this[key]
        if (value != null && value !is JsonNull) return value
    }
    return null
}

/** Web present-flag filter (coverage loop): skip when the flag is null/JSON-null, boolean `false`, or `""`. */
private fun isPresentFlag(element: JsonElement?): Boolean =
    when {
        element == null || element is JsonNull -> false
        element !is JsonPrimitive -> true
        element.booleanOrNull == false -> false
        element.isString && element.content.isEmpty() -> false
        else -> true
    }

/** Widens an integer day count to the Double axis the progress bar expects, via arithmetic. */
private fun Int.asBarAxis(): Double = this * 1.0

/**
 * Pure projection for the Warranty Status surface — the native port of the inline `useMemo` derivations + JSX
 * formatting in `WarrantyStatusWidget.tsx`. [projectEnvelope] unwraps the raw `/tesla/warranty` envelope and
 * projects the contained document into the render-ready [WarrantyStatusDisplay].
 */
object WarrantyStatusProjection {
    /** Unwraps [envelope] (`envelope?.data`) then [project]s it — the convenience the composable + tests drive. */
    fun projectEnvelope(
        envelope: JsonElement?,
        prefs: WarrantyStatusDisplayPrefs,
        strings: WarrantyStatusStrings,
        nowMillis: Long,
    ): WarrantyStatusDisplay = project(warrantyData(envelope), prefs, strings, nowMillis)

    /**
     * Projects the decoded warranty [data] document using the user's [prefs] and the localized [strings].
     * Reproduces the web reads verbatim against the snake_case wire contract: the `a ?? b ?? c` expiry /
     * mileage / start probing, the `daysUntil`/`statusVariant` math, the SI→display mileage conversion, and
     * the coverage badges. A `null` document (web `!warrantyData`) yields the empty display both layouts show.
     */
    fun project(
        data: JsonObject?,
        prefs: WarrantyStatusDisplayPrefs,
        strings: WarrantyStatusStrings,
        nowMillis: Long,
    ): WarrantyStatusDisplay {
        if (data == null) return emptyDisplay(strings)

        val unit = prefs.unitPref

        val expiryDate = asString(data.firstPresent(EXPIRY_KEYS))
        val daysRemaining = daysUntil(expiryDate, nowMillis)
        val variant = statusVariant(daysRemaining)
        val statusText = statusLabel(daysRemaining, strings)

        val mileageLimit = asNumber(data.firstPresent(MILEAGE_LIMIT_KEYS))
        val currentMileage = asNumber(data.firstPresent(CURRENT_MILEAGE_KEYS))
        val startDate = asString(data.firstPresent(START_KEYS))

        val totalDays = totalDaysBetween(startDate, expiryDate)
        val daysUsed =
            if (totalDays != null && daysRemaining != null) max(totalDays - daysRemaining, 0) else null

        val compactDaysText = if (daysRemaining != null) formatInt(max(daysRemaining, 0)) else EM_DASH
        val compactBadge = WarrantyBadge(statusText, variant)

        return WarrantyStatusDisplay(
            hasData = true,
            compactDaysText = compactDaysText,
            compactBadge = compactBadge,
            compactContentDescription = "${strings.title}: $compactDaysText ${strings.daysLeft}, $statusText",
            timeBar = timeBar(totalDays, daysUsed, daysRemaining, variant, strings),
            mileageBar = mileageBar(mileageLimit, currentMileage, unit, strings),
            detailRows =
                detailRows(
                    data = data,
                    expiryDate = expiryDate,
                    daysRemaining = daysRemaining,
                    variant = variant,
                    statusText = statusText,
                    mileageLimit = mileageLimit,
                    currentMileage = currentMileage,
                    unit = unit,
                    strings = strings,
                    nowMillis = nowMillis,
                ),
        )
    }

    /** The web `statusVariant`: null/≤0 days ⇒ Danger (red/`'error'`), ≤90 ⇒ Warning, else Success. */
    fun statusVariant(daysRemaining: Int?): WarrantyStatusTier =
        when {
            daysRemaining == null || daysRemaining <= 0 -> WarrantyStatusTier.Danger
            daysRemaining <= WARNING_DAYS -> WarrantyStatusTier.Warning
            else -> WarrantyStatusTier.Success
        }

    /** The web `statusLabel`: null/≤0 days ⇒ "Expired", else "Active". */
    fun statusLabel(
        daysRemaining: Int?,
        strings: WarrantyStatusStrings,
    ): String = if (daysRemaining == null || daysRemaining <= 0) strings.expired else strings.active

    /**
     * Formats a `yyyy-MM-dd[...]` date as the web `formatDate` does by default — `MMM d, yyyy` (en-US short
     * month, numeric day + year), e.g. `Jan 15, 2024`. A null/blank/unparseable value yields the em dash (web
     * `if (!iso || isNaN) return '—'`). Locale-stable + API-safe (no java.time formatting locale dependence).
     */
    fun formatExpiryDate(date: String?): String {
        val parts = date?.takeIf { it.isNotBlank() }?.take(ISO_DATE_PREFIX_LENGTH)?.split("-")
        if (parts == null || parts.size != 3) return EM_DASH
        val year = parts[0].toIntOrNull()
        val day = parts[2].toIntOrNull()
        val month = parts[1].toIntOrNull()?.let { SHORT_MONTHS.getOrNull(it - 1) }
        return if (year != null && day != null && month != null) "$month $day, $year" else EM_DASH
    }

    /**
     * Formats a `yyyy-MM[...]` date as the web coverage row's `Intl.DateTimeFormat({ month: 'short', year:
     * 'numeric' })` does — `MMM yyyy` (en-US short month + numeric year), e.g. `Jan 2024`. A
     * null/blank/unparseable value yields the em dash.
     */
    fun formatMonthYear(date: String?): String {
        val parts = date?.takeIf { it.isNotBlank() }?.take(ISO_DATE_PREFIX_LENGTH)?.split("-")
        if (parts == null || parts.size < 2) return EM_DASH
        val year = parts[0].toIntOrNull()
        val month = parts[1].toIntOrNull()?.let { SHORT_MONTHS.getOrNull(it - 1) }
        return if (year != null && month != null) "$month $year" else EM_DASH
    }

    /** Locale-stable grouped integer formatter (web `fmtInt`). */
    fun formatInt(value: Int): String = DecimalFormat("#,##0", DecimalFormatSymbols(Locale.US)).format(value.toLong())

    private fun timeBar(
        totalDays: Int?,
        daysUsed: Int?,
        daysRemaining: Int?,
        variant: WarrantyStatusTier,
        strings: WarrantyStatusStrings,
    ): WarrantyMetricBar? {
        if (totalDays == null || daysUsed == null) return null
        val sublabel =
            if (daysRemaining != null) "${formatInt(max(daysRemaining, 0))} ${strings.daysUnit}" else EM_DASH
        return WarrantyMetricBar(
            value = daysUsed.asBarAxis(),
            max = totalDays.asBarAxis(),
            tier = variant,
            label = strings.timeRemaining,
            sublabel = sublabel,
        )
    }

    private fun mileageBar(
        mileageLimit: Double?,
        currentMileage: Double?,
        unit: UnitPref,
        strings: WarrantyStatusStrings,
    ): WarrantyMetricBar? {
        if (mileageLimit == null || currentMileage == null) return null
        val ratio = currentMileage / mileageLimit
        val tier =
            when {
                ratio > MILEAGE_DANGER_RATIO -> WarrantyStatusTier.Danger
                ratio > MILEAGE_WARNING_RATIO -> WarrantyStatusTier.Warning
                else -> WarrantyStatusTier.Success
            }
        return WarrantyMetricBar(
            value = convertDistanceFromSI(currentMileage, unit.distance),
            max = convertDistanceFromSI(mileageLimit, unit.distance),
            tier = tier,
            label = strings.mileageRemaining,
            sublabel = formatDistance(mileageLimit - currentMileage, unit, DISTANCE_DECIMALS),
        )
    }

    @Suppress("LongParameterList")
    private fun detailRows(
        data: JsonObject,
        expiryDate: String?,
        daysRemaining: Int?,
        variant: WarrantyStatusTier,
        statusText: String,
        mileageLimit: Double?,
        currentMileage: Double?,
        unit: UnitPref,
        strings: WarrantyStatusStrings,
        nowMillis: Long,
    ): List<WarrantyDetailRow> =
        buildList {
            add(
                WarrantyDetailRow(
                    label = strings.expiryDate,
                    value = expiryDate?.let { formatExpiryDate(it) } ?: EM_DASH,
                    badge = WarrantyBadge(statusText, variant),
                    mono = false,
                ),
            )
            add(
                WarrantyDetailRow(
                    label = strings.daysRemaining,
                    value = if (daysRemaining != null) formatInt(max(daysRemaining, 0)) else EM_DASH,
                    badge = null,
                    mono = true,
                ),
            )
            if (mileageLimit != null) {
                add(
                    WarrantyDetailRow(
                        label = strings.mileageLimit,
                        value = formatDistance(mileageLimit, unit, DISTANCE_DECIMALS),
                        badge = null,
                        mono = true,
                    ),
                )
            }
            if (currentMileage != null) {
                add(
                    WarrantyDetailRow(
                        label = strings.currentMileage,
                        value = formatDistance(currentMileage, unit, DISTANCE_DECIMALS),
                        badge = null,
                        mono = true,
                    ),
                )
            }
            addCoverageRows(data, strings, nowMillis)
        }

    private fun MutableList<WarrantyDetailRow>.addCoverageRows(
        data: JsonObject,
        strings: WarrantyStatusStrings,
        nowMillis: Long,
    ) {
        for (cov in COVERAGE_TYPES) {
            if (!isPresentFlag(data[cov.dataKey])) continue
            val covExpiry = asString(data["${cov.dataKey}_expiry_date"])
            val covDays = daysUntil(covExpiry, nowMillis)
            val covActive = if (covExpiry != null) covDays != null && covDays > 0 else true
            add(
                WarrantyDetailRow(
                    label = strings.coverageLabels[cov.dataKey] ?: cov.fallback,
                    value = if (covExpiry != null) formatMonthYear(covExpiry) else strings.included,
                    badge =
                        WarrantyBadge(
                            text = if (covActive) strings.covered else strings.expired,
                            tier = if (covActive) WarrantyStatusTier.Success else WarrantyStatusTier.Danger,
                        ),
                    mono = false,
                ),
            )
        }
    }

    private fun emptyDisplay(strings: WarrantyStatusStrings): WarrantyStatusDisplay =
        WarrantyStatusDisplay(
            hasData = false,
            compactDaysText = EM_DASH,
            compactBadge = WarrantyBadge(strings.expired, WarrantyStatusTier.Danger),
            compactContentDescription = strings.noData,
            timeBar = null,
            mileageBar = null,
            detailRows = emptyList(),
        )
}
