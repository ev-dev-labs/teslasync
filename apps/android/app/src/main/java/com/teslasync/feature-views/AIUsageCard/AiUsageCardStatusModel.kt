// Pure, framework-free model + projection for the operator-grade AiUsageCard feature view — the native
// analogue of every value the web component derives before returning JSX
// (web/src/features/system/components/status/AiUsageCard.tsx). No Compose, no Android UI, no HTTP: every
// declaration here is exercised off-device by the :app:testReleaseUnitTest gate, keeping the composable a
// thin render layer over these pure functions.
//
// This is the operator "spend & volume" card on the system status surface (distinct from the lightweight
// settings AIUsageCard / prompt 0203). It feeds the shared <UsageCard> primitive with three at-a-glance
// bands (Today / Tokens / Cost·latency), a four-cell detail grid, and two top-list breakdowns (By feature
// over 7 days, Recent calls), reading three audit feeds — `/ai/usage/today`, `/ai/usage/by-feature`, and
// `/ai/usage/recent` — exposed by the shared `AiUsageStore` (the cross-platform port of the web `useAiUsage`
// hook domain, P1/S8). The off-mode gate (ADR-015 §I4) renders nothing when `ai_mode == 'off'`.
//
// This file owns the parts the web render derives from those payloads:
//   • the three bands' figures — web `fmtCount`/`fmtInt` token & call counts, the micro-cents → dollars
//     currency cost, and the rounded average latency, each degrading to the long em-dash for a missing /
//     non-finite field exactly as the web `fmtCount` does;
//   • the band error intent — web `error_count/call_count >= 0.05 ? danger : warn : normal`;
//   • the top-feature ordering (web `sort((a,b) => b.call_count - a.call_count).slice(0,5)`);
//   • the recent-call summary `{feature} · {model} · {n} tok · {relativeTime}` + the ✓/✗ status mark, and
//     the web `formatRelativeTime` bucketing (s / m / h / d ago) with the raw-timestamp parse fallback.
//
// Binding (P1/S8): this surface performs NO HTTP. The owning host owns the three `AiUsageStore` feeds and
// threads their cache-then-network `Resource<JsonElement>` down through the [toAiUsage*UiState] adapters, so
// the composable renders every lifecycle state that layer can carry (loading / empty / error / stale /
// offline) without ever fetching — the same host-owns-the-feed contract the sibling AIUsageCard / QuickMetrics
// ports follow. The `fromJson` / `listFromJson` adapters are the cached-payload → typed-projection seams the
// off-device unit gate covers.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/AiUsageCard — the P3 prompt's allowed-files path, which the case-insensitive
// Windows runner folds onto the sibling AIUsageCard directory) cannot form a valid Kotlin package, so the
// package intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.aiusagecardstatus

import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.math.RoundingMode
import java.text.NumberFormat
import java.time.Instant
import java.time.OffsetDateTime
import java.util.Locale
import kotlin.math.roundToLong

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no PII. */
const val AI_USAGE_STATUS_SLUG: String = "AiUsageCard"

/** Long em dash shown for an unrenderable figure — the native mirror of the web `'—'` fallback. */
internal const val AI_USAGE_STATUS_EM_DASH: String = "\u2014"

/** The " · " separator the web joins the recent-call summary parts with (punctuation, language-neutral). */
internal const val AI_USAGE_STATUS_SEPARATOR: String = " \u00B7 "

/** The ✓ status mark for a successful recent call (web `'✓'`). */
internal const val AI_USAGE_STATUS_OK_MARK: String = "\u2713"

/** The ✗ status mark for a failed recent call (web `'✗'`). */
internal const val AI_USAGE_STATUS_ERROR_MARK: String = "\u2717"

/** Default currency symbol — the web `useFormatting` fallback when `settings.currency_symbol` is blank. */
internal const val AI_USAGE_STATUS_DEFAULT_CURRENCY: String = "$"

/** Default decimal precision — the web `useFormatting` global default (`decimal_precision`, floored at 0). */
internal const val AI_USAGE_STATUS_DEFAULT_PRECISION: Int = 2

/** The `ai_mode` value that fully disables AI surfaces (ADR-015 §I4). */
internal const val AI_USAGE_STATUS_MODE_OFF: String = "off"

private const val MICRO_CENTS_PER_DOLLAR: Double = 1_000_000.0
private const val COUNT_DECIMALS: Int = 0
private const val ERROR_RATIO_DANGER: Double = 0.05
private const val TOP_FEATURES_LIMIT: Int = 5
private const val RECENT_LIMIT: Int = 5
private const val MS_PER_SECOND: Double = 1_000.0
private const val MS_PER_MINUTE: Double = 60_000.0
private const val MS_PER_HOUR: Double = 3_600_000.0
private const val MS_PER_DAY: Double = 86_400_000.0
private const val MINUTE_MS: Long = 60_000L
private const val HOUR_MS: Long = 3_600_000L
private const val DAY_MS: Long = 86_400_000L

/** The visual intent the web computes for a figure; mapped to the shared `UsageIntent` at the render edge. */
enum class AiUsageIntent { Normal, Warn, Danger }

/**
 * The relative age bucket the web `formatRelativeTime` resolves a `started_at` timestamp into — pure data
 * (no localized words), so the composable formats it through the i18n facade. A `null` bucket (unparseable
 * timestamp) makes the composable fall back to the raw timestamp string, exactly as the web does.
 */
sealed interface RelativeAge {
    /** The whole-unit magnitude (web `Math.round(ageMs / unit)`), e.g. `30` for "30s ago". */
    val value: Long

    /** `< 60s` bucket — web `${n}s ago` (floored at zero). */
    data class Seconds(
        override val value: Long,
    ) : RelativeAge

    /** `< 60m` bucket — web `${n}m ago`. */
    data class Minutes(
        override val value: Long,
    ) : RelativeAge

    /** `< 24h` bucket — web `${n}h ago`. */
    data class Hours(
        override val value: Long,
    ) : RelativeAge

    /** `>= 24h` bucket — web `${n}d ago`. */
    data class Days(
        override val value: Long,
    ) : RelativeAge
}

/**
 * The slice of `/ai/usage/today` the bands + detail grid read — the native mirror of the web `AiUsageToday`
 * fields the component renders (web/src/api/hooks/useAiUsage.ts). `user_subject` is never shown, so it is
 * deliberately omitted (DRY). Every field is nullable [Double] mirroring the web `Number.isFinite` guards, so
 * a sparse / partial payload never produces `NaN`.
 *
 * @property callCount calls audited today (web `data.call_count`); drives the live-vs-empty gate.
 * @property inputTokens prompt tokens today (web `data.input_tokens`).
 * @property outputTokens completion tokens today (web `data.output_tokens`).
 * @property costMicroCents today's cost in micro-cents (web `data.cost_micro_cents`), pre-conversion.
 * @property errorCount failed calls today (web `data.error_count`); drives the error intent + detail.
 * @property avgLatencyMs mean latency in ms today (web `data.avg_latency_ms`).
 */
data class AiUsageToday(
    val callCount: Double?,
    val inputTokens: Double?,
    val outputTokens: Double?,
    val costMicroCents: Double?,
    val errorCount: Double?,
    val avgLatencyMs: Double?,
) {
    /** Web `data.call_count > 0`: there has been at least one audited call today. */
    val hasUsage: Boolean get() = (callCount ?: 0.0) > 0.0

    /** No usage audited yet (web `!today || today.call_count === 0`) — selects the empty surface. */
    val isEmpty: Boolean get() = !hasUsage

    companion object {
        private const val KEY_CALL_COUNT = "call_count"
        private const val KEY_INPUT_TOKENS = "input_tokens"
        private const val KEY_OUTPUT_TOKENS = "output_tokens"
        private const val KEY_COST_MICRO_CENTS = "cost_micro_cents"
        private const val KEY_ERROR_COUNT = "error_count"
        private const val KEY_AVG_LATENCY_MS = "avg_latency_ms"

        /** The all-zeros payload the server returns when nothing has been audited (web's zero-state). */
        val EMPTY: AiUsageToday =
            AiUsageToday(
                callCount = 0.0,
                inputTokens = 0.0,
                outputTokens = 0.0,
                costMicroCents = 0.0,
                errorCount = 0.0,
                avgLatencyMs = 0.0,
            )

        /** Parses the shared store's raw `/ai/usage/today` element into this typed slice; non-object ⇒ null. */
        fun fromJson(json: JsonElement?): AiUsageToday? {
            val obj = json as? JsonObject ?: return null
            return AiUsageToday(
                callCount = obj.number(KEY_CALL_COUNT),
                inputTokens = obj.number(KEY_INPUT_TOKENS),
                outputTokens = obj.number(KEY_OUTPUT_TOKENS),
                costMicroCents = obj.number(KEY_COST_MICRO_CENTS),
                errorCount = obj.number(KEY_ERROR_COUNT),
                avgLatencyMs = obj.number(KEY_AVG_LATENCY_MS),
            )
        }
    }
}

/**
 * One `/ai/usage/by-feature` row the "By feature" top-list reads — only the two fields the web top-list maps
 * (`feature_id`, `call_count`); the other aggregate fields are never shown, so they are omitted (DRY).
 */
data class AiUsageFeatureRow(
    val featureId: String,
    val callCount: Double?,
) {
    companion object {
        private const val KEY_FEATURE_ID = "feature_id"
        private const val KEY_CALL_COUNT = "call_count"

        /** Parses one feature row; a row with no `feature_id` is skipped (the web key would be undefined). */
        fun fromJson(json: JsonElement?): AiUsageFeatureRow? {
            val obj = json as? JsonObject ?: return null
            return obj.text(KEY_FEATURE_ID)?.let { featureId ->
                AiUsageFeatureRow(featureId = featureId, callCount = obj.number(KEY_CALL_COUNT))
            }
        }

        /** Parses the `rows` array of a `/ai/usage/by-feature` payload; non-object / absent rows ⇒ empty. */
        fun listFromJson(json: JsonElement?): List<AiUsageFeatureRow> = json.rowObjects().mapNotNull { fromJson(it) }
    }
}

/**
 * One `/ai/usage/recent` row the "Recent calls" top-list reads — the fields the web `summarizeRecentRow`
 * consumes (`id`, `feature_id`, `model`, `input_tokens`, `output_tokens`, `started_at`) plus the `error`
 * presence flag that selects the ✓/✗ mark. The redacted digest / request hash / finish reason are never
 * shown, so they are omitted (DRY).
 *
 * @property id the row id (web list key, `String(r.id)`).
 * @property featureId the audited feature (web `row.feature_id`).
 * @property model the provider model (web `row.model`).
 * @property inputTokens prompt tokens (web `row.input_tokens`).
 * @property outputTokens completion tokens (web `row.output_tokens`).
 * @property startedAt the ISO-8601 UTC start timestamp (web `row.started_at`), bucketed for the relative age.
 * @property isError whether the call failed (web `row.error` truthy ⇒ ✗).
 */
data class AiUsageRecentRow(
    val id: Long,
    val featureId: String,
    val model: String,
    val inputTokens: Double?,
    val outputTokens: Double?,
    val startedAt: String,
    val isError: Boolean,
) {
    companion object {
        private const val KEY_ID = "id"
        private const val KEY_FEATURE_ID = "feature_id"
        private const val KEY_MODEL = "model"
        private const val KEY_INPUT_TOKENS = "input_tokens"
        private const val KEY_OUTPUT_TOKENS = "output_tokens"
        private const val KEY_STARTED_AT = "started_at"
        private const val KEY_ERROR = "error"

        /** Parses one recent-call row; absent fields degrade to neutral defaults (the web maps every row). */
        fun fromJson(json: JsonElement?): AiUsageRecentRow? {
            val obj = json as? JsonObject ?: return null
            return AiUsageRecentRow(
                id = (obj[KEY_ID] as? JsonPrimitive)?.longOrNull ?: 0L,
                featureId = obj.text(KEY_FEATURE_ID).orEmpty(),
                model = obj.text(KEY_MODEL).orEmpty(),
                inputTokens = obj.number(KEY_INPUT_TOKENS),
                outputTokens = obj.number(KEY_OUTPUT_TOKENS),
                startedAt = obj.text(KEY_STARTED_AT).orEmpty(),
                isError = !obj.text(KEY_ERROR).isNullOrBlank(),
            )
        }

        /** Parses the `rows` array of a `/ai/usage/recent` payload; non-object / absent rows ⇒ empty. */
        fun listFromJson(json: JsonElement?): List<AiUsageRecentRow> = json.rowObjects().mapNotNull { fromJson(it) }
    }
}

/**
 * The user's currency + decimal preferences this card needs — the native analogue of the web `useFormatting`
 * inputs (`currency_symbol`, `decimal_precision`) plus the `numberFormat` locale.
 *
 * @property currencySymbol the user's preferred symbol (web `useFormatting().currencySymbol`); blank ⇒ "$".
 * @property precision the currency fraction digits (web `useFormatting` `userPrecision`); negative ⇒ 0.
 * @property locale drives the thousands grouping + decimal separators (web `numberFormat` locale).
 */
data class AiUsageStatusFormatting(
    val currencySymbol: String,
    val precision: Int,
    val locale: Locale,
) {
    /** The currency symbol with the web's blank ⇒ "$" fallback applied. */
    val resolvedSymbol: String get() = currencySymbol.ifBlank { AI_USAGE_STATUS_DEFAULT_CURRENCY }

    /** The precision floored at zero (web `Math.max(0, …)`) so a stray negative never breaks formatting. */
    val resolvedPrecision: Int get() = if (precision < 0) 0 else precision

    companion object {
        /** The web-default bundle ("$", 2 dp, en-US) used by previews / tests and before settings load. */
        val DEFAULT: AiUsageStatusFormatting =
            AiUsageStatusFormatting(AI_USAGE_STATUS_DEFAULT_CURRENCY, AI_USAGE_STATUS_DEFAULT_PRECISION, Locale.US)
    }
}

/** One projected "By feature" row — the feature id and its grouped call count. */
data class TopFeatureDisplay(
    val featureId: String,
    val callCount: String,
)

/**
 * One projected "Recent calls" row — the parts the composable assembles into the localized summary plus the
 * pre-resolved status flag.
 *
 * @property featureId the audited feature (data, not localized).
 * @property model the provider model (data, not localized).
 * @property tokens the grouped total-token count (web `${fmtInt(in+out)}`), never the em-dash (always finite).
 * @property age the relative-age bucket, or `null` when the timestamp could not be parsed.
 * @property rawTime the raw `started_at` string the composable shows when [age] is `null` (web fallback).
 * @property isError whether to render the ✗ mark (web `row.error`) instead of ✓.
 */
data class RecentRowDisplay(
    val featureId: String,
    val model: String,
    val tokens: String,
    val age: RelativeAge?,
    val rawTime: String,
    val isError: Boolean,
)

/**
 * The fully projected, render-ready figures — the native analogue of everything the web component computes
 * before returning JSX. Pure strings + intents + ordered rows (no Compose / no localized words), so the whole
 * projection is unit-tested off-device and the composable only resolves i18n labels and draws this.
 *
 * @property callCount the grouped call count (band Today value), or the em-dash for a missing field.
 * @property callIntent the band Today intent (web error-ratio rule).
 * @property errorCount the grouped error count (band Today sub + Errors detail).
 * @property errorCountInt the raw error count (singular/plural selection + Errors-detail intent).
 * @property tokensTotal the grouped total token count (band Tokens value).
 * @property tokensIn the grouped prompt-token count (band Tokens sub + Input detail).
 * @property tokensOut the grouped completion-token count (band Tokens sub + Output detail).
 * @property cost the locale-currency cost (band Cost·latency value); "$0.00" at zero.
 * @property avgLatency the grouped rounded mean latency (band Cost·latency sub + Avg-latency detail).
 * @property topFeatures the top-5 features by call count (web sort+slice), empty when none.
 * @property recentRows the most-recent 5 calls (web slice), empty when none.
 */
@Suppress("LongParameterList") // A resolved-figures DTO: one field per web-derived value the card renders.
data class AiUsageStatusDisplay(
    val callCount: String,
    val callIntent: AiUsageIntent,
    val errorCount: String,
    val errorCountInt: Int,
    val tokensTotal: String,
    val tokensIn: String,
    val tokensOut: String,
    val cost: String,
    val avgLatency: String,
    val topFeatures: List<TopFeatureDisplay>,
    val recentRows: List<RecentRowDisplay>,
)

/**
 * Pure projection from the three audit payloads to the render-ready [AiUsageStatusDisplay] — a 1:1 port of the
 * figure derivations the web component performs inline (`fmtCount` counts, the micro-cents → dollars cost, the
 * rounded latency, the error-ratio intent, the top-feature sort/slice, and the recent-call summary parts).
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object AiUsageStatusProjection {
    /** Projects a present `today` payload (+ the secondary feeds) onto the render-ready figures. */
    fun project(
        today: AiUsageToday,
        byFeature: List<AiUsageFeatureRow>,
        recent: List<AiUsageRecentRow>,
        formatting: AiUsageStatusFormatting,
        now: Long,
    ): AiUsageStatusDisplay {
        val locale = formatting.locale
        val totalTokens = (today.inputTokens ?: 0.0) + (today.outputTokens ?: 0.0)
        return AiUsageStatusDisplay(
            callCount = formatCount(today.callCount, locale),
            callIntent = callIntent(today.errorCount, today.callCount),
            errorCount = formatCount(today.errorCount, locale),
            errorCountInt = (today.errorCount ?: 0.0).toInt(),
            tokensTotal = formatCount(totalTokens, locale),
            tokensIn = formatCount(today.inputTokens, locale),
            tokensOut = formatCount(today.outputTokens, locale),
            cost =
                formatCurrency(
                    microCentsAsDollars(today.costMicroCents),
                    formatting.resolvedSymbol,
                    formatting.resolvedPrecision,
                    locale,
                ),
            avgLatency = formatCount(roundedLatency(today.avgLatencyMs), locale),
            topFeatures = topFeatures(byFeature, locale),
            recentRows = recentRows(recent, locale, now),
        )
    }

    /** Web band-error intent: danger at >=5% error rate, warn for any error, else normal. */
    fun callIntent(
        errorCount: Double?,
        callCount: Double?,
    ): AiUsageIntent {
        val errors = errorCount ?: 0.0
        val calls = callCount ?: 0.0
        return when {
            errors <= 0.0 || calls <= 0.0 -> AiUsageIntent.Normal
            errors / calls >= ERROR_RATIO_DANGER -> AiUsageIntent.Danger
            else -> AiUsageIntent.Warn
        }
    }

    /** Web micro-cents → dollars helper: `mc / 1_000_000`, coercing a null / non-finite input to `0`. */
    fun microCentsAsDollars(microCents: Double?): Double =
        if (microCents == null || !microCents.isFinite()) 0.0 else microCents / MICRO_CENTS_PER_DOLLAR

    /** Web `Math.round(avg_latency_ms)` — rounds to a whole millisecond, preserving null / non-finite. */
    fun roundedLatency(ms: Double?): Double? = if (ms == null || !ms.isFinite()) ms else 1.0 * ms.roundToLong()

    /** Web `fmtCount(n)` == `fmtInt(n)`: grouped integer, or the em-dash for a null / non-finite value. */
    fun formatCount(
        value: Double?,
        locale: Locale,
    ): String {
        if (value == null || !value.isFinite()) return AI_USAGE_STATUS_EM_DASH
        return numberFormat(COUNT_DECIMALS, locale).format(value)
    }

    /** Web `formatCurrency(amount)`: the currency symbol followed by the grouped amount at [precision] dp. */
    fun formatCurrency(
        dollars: Double,
        symbol: String,
        precision: Int,
        locale: Locale,
    ): String = symbol + numberFormat(if (precision < 0) 0 else precision, locale).format(dollars)

    /** Web `[...byFeature].sort((a,b) => b.call_count - a.call_count).slice(0,5)` mapped to display rows. */
    fun topFeatures(
        rows: List<AiUsageFeatureRow>,
        locale: Locale,
    ): List<TopFeatureDisplay> =
        rows
            .sortedByDescending { it.callCount ?: 0.0 }
            .take(TOP_FEATURES_LIMIT)
            .map { TopFeatureDisplay(featureId = it.featureId, callCount = formatCount(it.callCount, locale)) }

    /** Web `recent.slice(0,5).map(summarizeRecentRow)` — the parts the composable assembles + the ✓/✗ flag. */
    fun recentRows(
        rows: List<AiUsageRecentRow>,
        locale: Locale,
        now: Long,
    ): List<RecentRowDisplay> =
        rows.take(RECENT_LIMIT).map { row ->
            val tokens = (row.inputTokens ?: 0.0) + (row.outputTokens ?: 0.0)
            RecentRowDisplay(
                featureId = row.featureId,
                model = row.model,
                tokens = formatCount(tokens, locale),
                age = relativeAge(row.startedAt, now),
                rawTime = row.startedAt,
                isError = row.isError,
            )
        }

    /** Web `formatRelativeTime`: buckets the age of [startedAt] at [now]; `null` when the timestamp won't parse. */
    fun relativeAge(
        startedAt: String,
        now: Long,
    ): RelativeAge? {
        val started = parseEpochMillis(startedAt) ?: return null
        val ageMs = now - started
        return when {
            ageMs < MINUTE_MS -> RelativeAge.Seconds(maxOf(0L, (ageMs / MS_PER_SECOND).roundToLong()))
            ageMs < HOUR_MS -> RelativeAge.Minutes((ageMs / MS_PER_MINUTE).roundToLong())
            ageMs < DAY_MS -> RelativeAge.Hours((ageMs / MS_PER_HOUR).roundToLong())
            else -> RelativeAge.Days((ageMs / MS_PER_DAY).roundToLong())
        }
    }

    // Web `fmtNumber` uses ECMAScript `Intl.NumberFormat` (halfExpand) grouping; HALF_UP matches it rather
    // than Java's default banker's rounding (HALF_EVEN).
    private fun numberFormat(
        decimals: Int,
        locale: Locale,
    ): NumberFormat =
        NumberFormat.getNumberInstance(locale).apply {
            minimumFractionDigits = decimals
            maximumFractionDigits = decimals
            isGroupingUsed = true
            roundingMode = RoundingMode.HALF_UP
        }
}

/**
 * Maps the shared `AiUsageStore.today()` feed's cache-then-network [Resource] onto the Android [UiState] this
 * card binds (`store.today().map { it.toAiUsageTodayUiState() }`). The cached payload is parsed at every
 * emission so a cold-start replay and an offline "last known" value both render real figures; a no-usage
 * payload resolves to the empty phase (web `!today || call_count === 0`).
 */
fun Resource<JsonElement>.toAiUsageTodayUiState(): UiState<AiUsageToday> =
    when (this) {
        is Resource.Loading -> Resource.Loading(AiUsageToday.fromJson(cached), fetchedAt, stale)
        is Resource.Success -> Resource.Success(AiUsageToday.fromJson(data) ?: AiUsageToday.EMPTY, fetchedAt, stale)
        is Resource.Error -> Resource.Error(AiUsageToday.fromJson(cached), fetchedAt, stale, error)
    }.toUiState { it.isEmpty }

/** Maps the shared `AiUsageStore.byFeature()` feed onto a [UiState] of the parsed feature rows. */
fun Resource<JsonElement>.toAiUsageByFeatureUiState(): UiState<List<AiUsageFeatureRow>> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let { AiUsageFeatureRow.listFromJson(it) }, fetchedAt, stale)
        is Resource.Success -> Resource.Success(AiUsageFeatureRow.listFromJson(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let { AiUsageFeatureRow.listFromJson(it) }, fetchedAt, stale, error)
    }.toUiState { it.isEmpty() }

/** Maps the shared `AiUsageStore.recent()` feed onto a [UiState] of the parsed recent-call rows. */
fun Resource<JsonElement>.toAiUsageRecentUiState(): UiState<List<AiUsageRecentRow>> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let { AiUsageRecentRow.listFromJson(it) }, fetchedAt, stale)
        is Resource.Success -> Resource.Success(AiUsageRecentRow.listFromJson(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let { AiUsageRecentRow.listFromJson(it) }, fetchedAt, stale, error)
    }.toUiState { it.isEmpty() }

/** Reads `settings.ai_mode` from the raw settings document (web `useSettings().settings.ai_mode`). */
internal fun aiModeOf(settings: JsonElement?): String? = ((settings as? JsonObject)?.get("ai_mode") as? JsonPrimitive)?.contentOrNull

/**
 * The off-mode gate (ADR-015 §I4) — the web `AiUsageCard()` wrapper renders `null` when settings have not
 * loaded, `ai_mode` is absent, or `ai_mode === 'off'`, so no AI surface ever enters an off-mode app.
 */
fun aiUsageStatusEnabled(aiMode: String?): Boolean = aiMode != null && aiMode != AI_USAGE_STATUS_MODE_OFF

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a token
 * count, a cost, a call count, or a feature id — so a diagnostics line can never leak the user's AI usage.
 */
object AiUsageStatusDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = AI_USAGE_STATUS_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

private fun JsonObject.number(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

private fun JsonElement?.rowObjects(): List<JsonObject> =
    ((this as? JsonObject)?.get("rows") as? JsonArray)?.filterIsInstance<JsonObject>() ?: emptyList()

// Web `Date.parse(iso)` is lenient; try an offset-bearing timestamp first, then a bare `…Z` instant.
private fun parseEpochMillis(iso: String): Long? =
    runCatching { OffsetDateTime.parse(iso).toInstant().toEpochMilli() }.getOrNull()
        ?: runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull()
