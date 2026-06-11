// Pure, framework-free model + projection for the Cron Parser feature view — the native analogue of the
// data + composition the web component derives before returning JSX
// (web/src/features/admin/components/devtools/tools/CronParser.tsx, whose cron logic lives in
// web/src/features/admin/components/devtools/helpers.ts: describeCron + getNextCronRuns). No Compose, no
// Android, no HTTP: every type here is unit-tested off-device in the :android:testReleaseUnitTest gate,
// keeping the composable a thin render layer.
//
// The web source is an interactive client-side dev tool. It binds NO data feed (its only hook is
// useTranslation) and performs no async work, so there is no loading / error / stale / offline branch in
// the source to reproduce. Its real, input-driven states are the ones modelled here: an empty/invalid
// expression (fewer than five whitespace-separated fields) yields no description and no next runs, while a
// valid five-field expression yields a human-readable description and the upcoming run timestamps — exactly
// the web `parts.length === 5 ? … : …` + `{description && …}` / `{nextRuns.length > 0 && …}` contract.
//
// The cron field-matcher reproduces the web helper's JavaScript number semantics precisely (parseInt's
// leading-digit parse and Number's strict whole-string parse differ, and the web relies on both), so a
// drifting interpretation can never silently change which runs are shown. The describe() output is the
// web helper's computed English phrasing verbatim (the web does not localize describeCron's result), so it
// is reproduced as-is rather than routed through the i18n catalog; only the surrounding chrome labels
// (title, description, the field label, "Description"/"Next Runs", and the five preset labels) are i18n.
//
// i18n note (web parity): the web reads its chrome through natural-language i18next keys —
// t('Cron Parser'), t('Cron Expression'), t('Next Runs'), t('Every Minute'), … Of these only
// `Description` exists in the generated neutral catalog (apps/shared/i18n/catalog → translation.Description);
// the rest are absent, so i18next returns the key string itself (the English text) at runtime today. The
// catalog is generated and drift-checked (ADR-014) so it must not be hand-authored. This model therefore
// mirrors the QuickNav / ReferenceLinksSection precedent's resolveOptional(key, default) shape: the
// composable first attempts the canonical catalog key by name (so the proper localized string renders the
// moment the catalog ever generates it — resolving through the P1/S10 facade exactly as required), and
// otherwise falls back to the web's effective string, which for these natural-language keys IS the key
// text. The fallback therefore equals what the web renders today, so parity is exact and documented.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/CronParser — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package identifier (a hyphen and PascalCase segments are illegal), so the package intentionally diverges
// from the path. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.cronparser

import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Canonical metadata for this surface. There is no web dashboard-registry entry to mirror (the web
 * `CronParserTool` is a composed tool inside the devtools page, not a draggable widget), so this object
 * carries only the cross-cutting concerns every surface owes: the diagnostics surface [SLUG] emitted with
 * the one-shot `view.opened` event (P1/S11) and the default count of upcoming runs to compute (web
 * `getNextCronRuns(parts, 5)`).
 */
object CronParserRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "CronParser"

    /** Number of upcoming runs the tool projects — web `getNextCronRuns(parts, 5)`. */
    const val DEFAULT_RUN_COUNT = 5
}

/**
 * The chrome strings the surface folds in, each tied to the verbatim web i18next key it reads
 * (`t('Cron Parser')`, `t('Cron Expression')`, …). The [androidResourceName] is the catalog key folded to
 * an Android resource name (see [foldCatalogKey]); the composable resolves it by name through the i18n
 * facade and otherwise falls back to [webKey] — which, for these natural-language keys, is exactly the
 * string i18next returns when the catalog lacks the key (the web's effective rendered text today).
 */
enum class CronParserText(
    val webKey: String,
) {
    /** Web `t('Cron Parser')` — the tool card title. */
    Title("Cron Parser"),

    /** Web `t('Cron Parser Desc')` — the tool card subtitle. */
    ToolDescription("Cron Parser Desc"),

    /** Web `t('Cron Expression')` — the input field label. */
    ExpressionLabel("Cron Expression"),

    /** Web `t('Description')` — exists in the catalog (translation.Description), so it resolves live. */
    DescriptionLabel("Description"),

    /** Web `t('Next Runs')` — the upcoming-runs section label. */
    NextRunsLabel("Next Runs"),

    /** Web preset `t('Every Minute')` → `* * * * *`. */
    EveryMinute("Every Minute"),

    /** Web preset `t('Every Hour')` → `0 * * * *`. */
    EveryHour("Every Hour"),

    /** Web preset `t('Every Day')` → `0 0 * * *`. */
    EveryDay("Every Day"),

    /** Web preset `t('Every Week')` → `0 0 * * 0`. */
    EveryWeek("Every Week"),

    /** Web preset `t('Every Month')` → `0 0 1 * *`. */
    EveryMonth("Every Month"),
    ;

    /** The generated-catalog resource name for [webKey] (see [foldCatalogKey]). */
    val androidResourceName: String get() = foldCatalogKey(webKey)
}

/**
 * Folds an i18next key into the Android string-resource name the generated catalog uses: the `translation.`
 * namespace prefix with the dot separator and every other non-identifier character replaced by an
 * underscore. Verified against the real `translation_Description` resource generated from
 * `translation.Description`; for the space-bearing natural-language keys (absent from the catalog) it yields
 * a valid identifier that simply resolves to nothing, so the documented fallback renders.
 */
fun foldCatalogKey(webKey: String): String = "translation_" + webKey.replace(NON_IDENTIFIER, "_").trim('_')

private val NON_IDENTIFIER = Regex("[^A-Za-z0-9]+")

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a
 * thin seam over the Android string catalog in production (an optional by-name resource read) and a map in
 * tests, so the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * The localized chrome strings the composable hands the renderer; tests pass a deterministic instance.
 * [labelFor] maps a [CronPreset] onto its localized button label in web render order.
 */
data class CronParserStrings(
    val title: String,
    val toolDescription: String,
    val expressionLabel: String,
    val descriptionLabel: String,
    val nextRunsLabel: String,
    val everyMinute: String,
    val everyHour: String,
    val everyDay: String,
    val everyWeek: String,
    val everyMonth: String,
) {
    /** The localized label for [preset], in web render order. */
    fun labelFor(preset: CronPreset): String =
        when (preset) {
            CronPreset.EveryMinute -> everyMinute
            CronPreset.EveryHour -> everyHour
            CronPreset.EveryDay -> everyDay
            CronPreset.EveryWeek -> everyWeek
            CronPreset.EveryMonth -> everyMonth
        }
}

/**
 * Builds the localized [CronParserStrings] from a by-name string [lookup] (the i18n facade in production,
 * a map in tests). Every field routes through [resolveOptional] so it resolves live from the catalog when
 * present (e.g. `Description`) and falls back to the web's natural-language key text otherwise.
 */
fun buildCronParserStrings(lookup: (String) -> String?): CronParserStrings =
    CronParserStrings(
        title = resolveText(lookup, CronParserText.Title),
        toolDescription = resolveText(lookup, CronParserText.ToolDescription),
        expressionLabel = resolveText(lookup, CronParserText.ExpressionLabel),
        descriptionLabel = resolveText(lookup, CronParserText.DescriptionLabel),
        nextRunsLabel = resolveText(lookup, CronParserText.NextRunsLabel),
        everyMinute = resolveText(lookup, CronParserText.EveryMinute),
        everyHour = resolveText(lookup, CronParserText.EveryHour),
        everyDay = resolveText(lookup, CronParserText.EveryDay),
        everyWeek = resolveText(lookup, CronParserText.EveryWeek),
        everyMonth = resolveText(lookup, CronParserText.EveryMonth),
    )

private fun resolveText(
    lookup: (String) -> String?,
    text: CronParserText,
): String = resolveOptional(lookup, text.androidResourceName, text.webKey)

/**
 * One of the five quick-fill presets, in web render order, each carrying the cron expression it fills the
 * input with (web `presets` array `value`). The localized label comes from [CronParserStrings.labelFor].
 */
enum class CronPreset(
    val expression: String,
) {
    /** Web `{ label: t('Every Minute'), value: '* * * * *' }`. */
    EveryMinute("* * * * *"),

    /** Web `{ label: t('Every Hour'), value: '0 * * * *' }`. */
    EveryHour("0 * * * *"),

    /** Web `{ label: t('Every Day'), value: '0 0 * * *' }`. */
    EveryDay("0 0 * * *"),

    /** Web `{ label: t('Every Week'), value: '0 0 * * 0' }`. */
    EveryWeek("0 0 * * 0"),

    /** Web `{ label: t('Every Month'), value: '0 0 1 * *' }`. */
    EveryMonth("0 0 1 * *"),
}

/** One render-ready preset chip: the [preset], its localized [label], and the [expression] it fills. */
data class CronPresetItem(
    val preset: CronPreset,
    val label: String,
    val expression: String,
)

/** One render-ready upcoming run: its 1-based [position], the [badge] text, and the formatted [time]. */
data class CronNextRun(
    val position: Int,
    val badge: String,
    val time: String,
)

/**
 * The projection of one cron expression: the human-readable [description] (null when the expression is not
 * the required five fields — web `{description && …}`) and the upcoming [nextRuns] (empty when there are
 * none to show — web `{nextRuns.length > 0 && …}`).
 */
data class CronParseResult(
    val description: String?,
    val nextRuns: List<CronNextRun>,
)

/**
 * The pure cron engine — a faithful Kotlin port of the web `describeCron` + `getNextCronRuns` helpers,
 * including their exact JavaScript number semantics. Framework-free so the whole engine is JVM-unit-tested.
 */
object CronExpression {
    /** A standard cron line has five whitespace-separated fields (minute hour day-of-month month day-of-week). */
    const val FIELD_COUNT = 5

    // Upper bound on the minute-by-minute search — minutes in a year, matching the web helper's `safety`.
    private const val SAFETY_LIMIT = 525_960

    private val WHITESPACE = Regex("\\s+")

    /** Splits an expression the way the web does (`expr.trim().split(/\s+/)`); "" yields a single "" entry. */
    fun fields(expr: String): List<String> = expr.trim().split(WHITESPACE)

    /** True when [expr] has exactly [FIELD_COUNT] fields — the gate the web uses before describing/scheduling. */
    fun isValid(expr: String): Boolean = fields(expr).size == FIELD_COUNT

    /**
     * Human-readable description of a five-field cron, reproducing web `describeCron` verbatim (including its
     * "Invalid cron expression" guard and the Sun..Sat day-of-week table). The web does not localize this
     * computed phrasing, so neither does the native surface.
     */
    fun describe(parts: List<String>): String {
        if (parts.size != FIELD_COUNT) return "Invalid cron expression"
        val minute = parts[0]
        val hour = parts[1]
        val dayOfMonth = parts[2]
        val month = parts[3]
        val dayOfWeek = parts[4]
        val pieces = mutableListOf(describeTime(minute, hour))
        if (dayOfMonth != "*") pieces.add("on day $dayOfMonth")
        if (month != "*") pieces.add("in month $month")
        if (dayOfWeek != "*") pieces.add("on ${dayOfWeekName(dayOfWeek)}")
        return pieces.joinToString(" ")
    }

    private fun describeTime(
        minute: String,
        hour: String,
    ): String =
        when {
            minute == "*" && hour == "*" -> "Every minute"
            minute != "*" && hour == "*" -> "At minute $minute of every hour"
            minute != "*" && hour != "*" -> "At ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}"
            else -> "Every minute of hour $hour"
        }

    private fun dayOfWeekName(field: String): String {
        val names = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
        return jsParseInt(field)?.let { names.getOrNull(it) } ?: field
    }

    /**
     * The next [count] times the five-field [parts] fire at or after [now], reproducing web `getNextCronRuns`:
     * start at the next whole minute and step minute-by-minute, collecting matches up to [count] or the
     * one-year safety bound. Returns an empty list for a non-five-field expression.
     */
    fun nextRuns(
        parts: List<String>,
        count: Int,
        now: LocalDateTime,
    ): List<LocalDateTime> {
        if (parts.size != FIELD_COUNT) return emptyList()
        val results = mutableListOf<LocalDateTime>()
        var check = now.withSecond(0).withNano(0).plusMinutes(1)
        var safety = 0
        while (results.size < count && safety < SAFETY_LIMIT) {
            safety++
            if (matchesAll(parts, check)) results.add(check)
            check = check.plusMinutes(1)
        }
        return results
    }

    private fun matchesAll(
        parts: List<String>,
        moment: LocalDateTime,
    ): Boolean {
        val checks =
            listOf(
                parts[0] to moment.minute,
                parts[1] to moment.hour,
                parts[2] to moment.dayOfMonth,
                parts[3] to moment.monthValue,
                // JS getDay(): Sunday=0..Saturday=6. java.time: MONDAY=1..SUNDAY=7, so % 7 maps SUNDAY→0.
                parts[4] to (moment.dayOfWeek.value % 7),
            )
        return checks.all { (field, value) -> matchField(field, value) }
    }

    /**
     * True when a single cron [field] matches [value], reproducing web `matchField`: `*` matches all; a
     * `/`-step matches multiples of the step; a `,`-list matches membership; a `-`-range matches inclusively;
     * otherwise an exact integer match. The branch order and the parseInt-vs-Number split mirror the web.
     */
    fun matchField(
        field: String,
        value: Int,
    ): Boolean =
        when {
            field == "*" -> true
            field.contains('/') -> matchStep(field, value)
            field.contains(',') -> matchList(field, value)
            field.contains('-') -> matchRange(field, value)
            else -> jsParseInt(field) == value
        }

    private fun matchStep(
        field: String,
        value: Int,
    ): Boolean {
        // Web: value % parseInt(field.split('/')[1]) === 0. A NaN or zero step never equals 0 (and avoids
        // dividing by zero), so it matches nothing.
        val step = jsParseInt(field.substringAfter('/'))
        return if (step == null || step == 0) false else value % step == 0
    }

    // Web: field.split(',').map(Number).includes(value). Number() (not parseInt) parses the whole token.
    private fun matchList(
        field: String,
        value: Int,
    ): Boolean {
        val target = value + 0.0
        return field.split(',').any { jsNumber(it) == target }
    }

    private fun matchRange(
        field: String,
        value: Int,
    ): Boolean {
        // Web: const [lo, hi] = field.split('-').map(Number); value >= lo && value <= hi. A NaN bound makes
        // both comparisons false in JS, so a non-numeric bound matches nothing.
        val parts = field.split('-')
        val low = jsNumber(parts.getOrElse(0) { "" })
        val high = jsNumber(parts.getOrElse(1) { "" })
        return if (low == null || high == null) false else value >= low && value <= high
    }

    /**
     * Mirrors JavaScript `parseInt(s, 10)`: skip leading whitespace, an optional sign, then consume decimal
     * digits, returning the leading-digit integer or `null` (JS `NaN`) when no digits are present (or the
     * run overflows an `Int`, which for cron's small fields can never equal a real field value anyway).
     */
    fun jsParseInt(s: String): Int? {
        var i = 0
        while (i < s.length && s[i].isWhitespace()) i++
        var sign = 1
        if (i < s.length && (s[i] == '+' || s[i] == '-')) {
            if (s[i] == '-') sign = -1
            i++
        }
        val start = i
        while (i < s.length && s[i] in '0'..'9') i++
        return s.substring(start, i).toIntOrNull()?.let { sign * it }
    }

    /**
     * Mirrors JavaScript `Number(s)`: a blank token is `0`, otherwise the whole trimmed token must parse as a
     * number or the result is `NaN` (returned here as `null`). Unlike [jsParseInt], a trailing non-digit makes
     * the whole token `NaN` — the web relies on this difference in its `,`-list and `-`-range branches.
     */
    fun jsNumber(s: String): Double? {
        val trimmed = s.trim()
        if (trimmed.isEmpty()) return 0.0
        return trimmed.toDoubleOrNull() // parity:allow Kotlin stdlib numeric parser API
    }
}

/**
 * Display-boundary formatter for a run timestamp, reproducing the web `formatDateTime` shape
 * ("Apr 4, 2026, 02:30 AM": numeric year, short month, numeric day, 2-digit 12-hour clock). Kept here so the
 * pattern is unit-tested; the composable supplies the device [Locale].
 */
object CronTimeFormat {
    private const val PATTERN = "MMM d, yyyy, hh:mm a"

    fun format(
        dateTime: LocalDateTime,
        locale: Locale,
    ): String = dateTime.format(DateTimeFormatter.ofPattern(PATTERN, locale))
}

/**
 * Pure projection from a typed expression + localized [CronParserStrings] to the render-ready surface model.
 * Owns the preset list (web render order) and the parse that mirrors the web `useMemo` chain: a non-five-field
 * expression produces no description and no runs; a five-field expression produces the computed description and
 * the upcoming runs formatted via [formatTime]. [now] is injected so the projection is deterministic under test.
 */
object CronParserProjection {
    /** The five quick-fill presets in web render order, with localized labels. */
    fun presets(strings: CronParserStrings): List<CronPresetItem> =
        CronPreset.entries.map { preset ->
            CronPresetItem(preset = preset, label = strings.labelFor(preset), expression = preset.expression)
        }

    /**
     * Parses [expr] into the render-ready [CronParseResult]. Mirrors the web component's derived state:
     * `description = parts.length === 5 ? describeCron(parts) : ''` (shown only when non-empty) and
     * `nextRuns = parts.length === 5 ? getNextCronRuns(parts, 5) : []`.
     */
    fun parse(
        expr: String,
        now: LocalDateTime,
        formatTime: (LocalDateTime) -> String,
        count: Int = CronParserRegistration.DEFAULT_RUN_COUNT,
    ): CronParseResult {
        val parts = CronExpression.fields(expr)
        if (parts.size != CronExpression.FIELD_COUNT) {
            return CronParseResult(description = null, nextRuns = emptyList())
        }
        val description = CronExpression.describe(parts).takeIf { it.isNotEmpty() }
        val runs =
            CronExpression.nextRuns(parts, count, now).mapIndexed { index, dateTime ->
                CronNextRun(position = index + 1, badge = (index + 1).toString(), time = formatTime(dateTime))
            }
        return CronParseResult(description = description, nextRuns = runs)
    }
}
