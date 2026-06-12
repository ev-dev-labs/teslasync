// Pure, framework-free model + projection for the AIUsageCard feature view — the native analogue of every
// value the web component derives before returning JSX (web/src/features/settings/components/AIUsageCard.tsx).
// No Compose, no Android UI, no HTTP: every declaration here is exercised off-device by the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer over these pure functions.
//
// AIUsageCard is the lightweight "Usage today" card on the Helix settings panel. The web component reads the
// `/ai/usage/today` aggregate via `useAiUsageToday()` (the `useAiUsage` hook domain) and renders three
// top-line figures — tokens in, tokens out, and the estimated cost in the user's locale currency — over a
// live/empty caption. This file owns the parts the web render derives from that payload:
//   • the three figures — web `formatCount(data.input_tokens)` / `…output_tokens` / the currency-formatted
//     cost (the micro-cents → dollars helper then symbol + grouped amount), each degrading to the long
//     em-dash fallback (`'—'`) for a missing / non-finite field exactly as the web `formatCount` does;
//   • the micro-cents → dollars conversion (web helper, `mc / 1_000_000`);
//   • the caption switch — web `data.call_count > 0 ? '{n} {liveSuffix}' : '{empty caption}'`, surfaced here
//     as the pre-formatted call count plus the [AiUsageDisplay.hasUsage] flag the composable assembles with
//     the localized suffix / empty caption (P1/S10), keeping this file locale-aware but i18n-free.
//
// Binding (P1/S8): this surface performs NO HTTP. The owning Helix-settings host owns the shared
// `AiUsageStore.today()` feed (the cross-platform port of `useAiUsage`, in :core) and threads its
// cache-then-network `Resource<JsonElement>` down through [toAiUsageTodayUiState], so the composable renders
// every lifecycle state that layer can carry (loading / empty / error / stale / offline) without ever
// fetching — the same host-owns-the-feed contract the sibling AcDcStatsPanel / QuickMetrics ports follow.
// [AiUsageToday.fromJson] is the cached-payload → typed-projection data adapter that bridge is unit-tested on.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/AIUsageCard — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.aiusagecard

import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no PII. */
const val AI_USAGE_SLUG: String = "AIUsageCard"

/** Long em dash shown for an unrenderable figure — the native mirror of the web `'—'` fallback. */
internal const val AI_USAGE_EM_DASH: String = "\u2014"

/** Default currency symbol — the web `useFormatting` fallback when `settings.currency_symbol` is blank. */
internal const val AI_USAGE_DEFAULT_CURRENCY: String = "$"

/** Default decimal precision — the web `useFormatting` global default (`decimal_precision`, floored at 0). */
internal const val AI_USAGE_DEFAULT_PRECISION: Int = 2

/** The micro-cents → dollars divisor: 1 dollar == 1_000_000 cost units (web helper, `mc / 1_000_000`). */
private const val MICRO_CENTS_PER_DOLLAR: Double = 1_000_000.0

/** Token / call counts are whole numbers — web `fmtInt` == `fmtNumber(v, 0)`. */
private const val COUNT_DECIMALS: Int = 0

/**
 * The slice of the `/ai/usage/today` aggregate this card actually reads — the native mirror of the four web
 * `AiUsageToday` fields the component renders (web/src/api/hooks/useAiUsage.ts). The full DTO also carries
 * `user_subject`, `error_count`, and `avg_latency_ms`, which this card never shows, so they are deliberately
 * omitted (DRY — the model carries only what the surface renders, like the sibling AcDcBucket port).
 *
 * Every field is nullable [Double] mirroring the web `number | null | undefined` shape the `Number.isFinite`
 * guards defend against, so a sparse / partial payload never produces `NaN`.
 *
 * @property callCount calls audited today (web `data.call_count`); drives the live-vs-empty caption.
 * @property inputTokens prompt tokens today (web `data.input_tokens`).
 * @property outputTokens completion tokens today (web `data.output_tokens`).
 * @property costMicroCents today's cost in micro-cents (web `data.cost_micro_cents`), pre-conversion.
 */
data class AiUsageToday(
    val callCount: Double?,
    val inputTokens: Double?,
    val outputTokens: Double?,
    val costMicroCents: Double?,
) {
    /** Web `data.call_count > 0`: there has been at least one audited call today. */
    val hasUsage: Boolean get() = (callCount ?: 0.0) > 0.0

    /** No usage audited yet — selects the host's [UiState] empty phase + the empty caption. */
    val isEmpty: Boolean get() = !hasUsage

    companion object {
        private const val KEY_CALL_COUNT = "call_count"
        private const val KEY_INPUT_TOKENS = "input_tokens"
        private const val KEY_OUTPUT_TOKENS = "output_tokens"
        private const val KEY_COST_MICRO_CENTS = "cost_micro_cents"

        /** The all-zeros payload the server returns when nothing has been audited (web's zero-state). */
        val EMPTY: AiUsageToday = AiUsageToday(callCount = 0.0, inputTokens = 0.0, outputTokens = 0.0, costMicroCents = 0.0)

        /**
         * Parses the shared store's raw `/ai/usage/today` [JsonElement] into the typed slice this card reads —
         * the data adapter the host plugs into [toAiUsageTodayUiState]. Snake_case keys are read verbatim (the
         * shared `AiUsageRepository` carries the server JSON unchanged); a non-object payload yields `null`.
         */
        fun fromJson(json: JsonElement?): AiUsageToday? {
            val obj = json as? JsonObject ?: return null
            return AiUsageToday(
                callCount = obj.number(KEY_CALL_COUNT),
                inputTokens = obj.number(KEY_INPUT_TOKENS),
                outputTokens = obj.number(KEY_OUTPUT_TOKENS),
                costMicroCents = obj.number(KEY_COST_MICRO_CENTS),
            )
        }

        private fun JsonObject.number(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull
    }
}

/**
 * Maps the shared `AiUsageStore.today()` feed's cache-then-network [Resource] (raw `JsonElement`, P1/S8) onto
 * the Android [UiState] this card binds — the single seam the Helix-settings host wires the surface up with
 * (`store.today().map { it.toAiUsageTodayUiState() }`). The cached payload is parsed through
 * [AiUsageToday.fromJson] at every emission so an instant cold-start cache replay and an offline "last known"
 * value both render real figures, and a no-usage payload resolves to the empty phase.
 */
fun Resource<JsonElement>.toAiUsageTodayUiState(): UiState<AiUsageToday> = mapToAiUsageToday().toUiState { it.isEmpty }

private fun Resource<JsonElement>.mapToAiUsageToday(): Resource<AiUsageToday> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(cached = AiUsageToday.fromJson(cached), fetchedAt = fetchedAt, stale = stale)

        is Resource.Success ->
            Resource.Success(data = AiUsageToday.fromJson(data) ?: AiUsageToday.EMPTY, fetchedAt = fetchedAt, stale = stale)

        is Resource.Error ->
            Resource.Error(cached = AiUsageToday.fromJson(cached), fetchedAt = fetchedAt, stale = stale, error = error)
    }

/**
 * The user's currency + decimal preferences this card needs — the native analogue of the web `useFormatting`
 * inputs (`currency_symbol`, `decimal_precision`) plus the `numberFormat` locale. Resolved once from the
 * shared settings store at the Compose boundary so this projection stays free of any store / Android type.
 *
 * @property currencySymbol the user's preferred symbol (web `useFormatting().currencySymbol`); blank ⇒ "$".
 * @property precision the currency fraction digits (web `useFormatting` `userPrecision`); negative ⇒ 0.
 * @property locale drives the thousands grouping + decimal separators (web `numberFormat` locale).
 */
data class AiUsageFormatting(
    val currencySymbol: String,
    val precision: Int,
    val locale: Locale,
) {
    /** The currency symbol with the web's blank ⇒ "$" fallback applied. */
    val resolvedSymbol: String get() = currencySymbol.ifBlank { AI_USAGE_DEFAULT_CURRENCY }

    /** The precision floored at zero (web `Math.max(0, …)`) so a stray negative never breaks formatting. */
    val resolvedPrecision: Int get() = if (precision < 0) 0 else precision

    companion object {
        /** The web-default bundle ("$", 2 dp, en-US) used by previews / tests and before settings load. */
        val DEFAULT: AiUsageFormatting = AiUsageFormatting(AI_USAGE_DEFAULT_CURRENCY, AI_USAGE_DEFAULT_PRECISION, Locale.US)
    }
}

/**
 * The fully projected, render-ready figures — the native analogue of everything the web component computes
 * before returning JSX. Pure strings (no Compose types) so the projection is fully unit-tested off-device.
 *
 * @property tokensIn the formatted prompt-token count, or the em-dash fallback for a missing field.
 * @property tokensOut the formatted completion-token count, or the em-dash fallback.
 * @property cost the locale-currency cost (web `formatCurrency` of the micro-cents → dollars value); "$0.00"
 *   at zero.
 * @property callCountText the formatted call count for the live caption (web `formatCount(data.call_count)`).
 * @property hasUsage whether to render the live caption (web `data.call_count > 0`) or the empty caption.
 */
data class AiUsageDisplay(
    val tokensIn: String,
    val tokensOut: String,
    val cost: String,
    val callCountText: String,
    val hasUsage: Boolean,
)

/**
 * Pure projection from an [AiUsageToday] payload to its render-ready [AiUsageDisplay] plus the formatters the
 * web component applies inline — a 1:1 port of the figure derivations (`fmtInt` token counts, the
 * micro-cents → dollars cost, and the per-field em-dash fallback). Stateless and side-effect-free so it is
 * fully covered by the off-device unit gate; the composable only resolves localized labels and draws this.
 */
object AiUsageProjection {
    /** Project a present payload onto its render-ready figures; the loading / hard-error no-data branch
     *  (web `!data || isError`) is handled by the composable, which shows the em-dash fallback directly. */
    fun project(
        data: AiUsageToday,
        formatting: AiUsageFormatting,
    ): AiUsageDisplay =
        AiUsageDisplay(
            tokensIn = formatCount(data.inputTokens, formatting.locale),
            tokensOut = formatCount(data.outputTokens, formatting.locale),
            cost =
                formatCurrency(
                    microCentsAsDollars(data.costMicroCents),
                    formatting.resolvedSymbol,
                    formatting.resolvedPrecision,
                    formatting.locale,
                ),
            callCountText = formatCount(data.callCount, formatting.locale),
            hasUsage = data.hasUsage,
        )

    /** Web micro-cents → dollars helper: `mc / 1_000_000`, coercing a null / non-finite input to `0`. */
    fun microCentsAsDollars(microCents: Double?): Double =
        if (microCents == null || !microCents.isFinite()) 0.0 else microCents / MICRO_CENTS_PER_DOLLAR

    /** Web `formatCount(n)` == `fmtInt(n)`: grouped integer, or the em-dash for a null / non-finite value. */
    fun formatCount(
        value: Double?,
        locale: Locale,
    ): String {
        if (value == null || !value.isFinite()) return AI_USAGE_EM_DASH
        return numberFormat(COUNT_DECIMALS, locale).format(value)
    }

    /** Web `formatCurrency(amount)`: the currency symbol followed by the grouped amount at [precision] dp. */
    fun formatCurrency(
        dollars: Double,
        symbol: String,
        precision: Int,
        locale: Locale,
    ): String = symbol + numberFormat(if (precision < 0) 0 else precision, locale).format(dollars)

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
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a token
 * count, a cost, or a call count — so a diagnostics line can never leak the user's Helix usage.
 */
object AiUsageCardDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = AI_USAGE_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
