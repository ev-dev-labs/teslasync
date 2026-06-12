// Pure, framework-light model + projection for the AISettings feature view — the native analogue of
// everything the web component derives before returning JSX (web/src/features/settings/components/AISettings.tsx).
// Every declaration here is exercised off-device by the `:android:testReleaseUnitTest` gate, keeping the
// composable a thin render layer that only collects state and renders.
//
// The web component is the Settings → Helix opt-in surface (ADR-015 AI-Off Contract): a mode picker
// (off / local / cloud), an off banner, the live "today's spend" cost-cap bar (the `AICostCapSpendBar`
// co-located in the same file), and the save button. The per-provider section, per-feature toggle list,
// archive-restore panel, and usage card are SEPARATE web components (`AIProviderSection`,
// `AIFeatureToggleList`, `AIRestorePanel`, `AIUsageCard`) with their own P3 prompts, so they are out of
// scope here — this surface owns exactly the mode/save/cost-cap chrome AISettings.tsx itself renders.
//
// This file owns the parity-critical derivations that have nothing to do with Compose: the three-way mode
// classification (web `isAiMode`), the settings-document projection (web `serverMode` + `cost_cap_cents`
// reads), the cost-cap spend math (web `AICostCapSpendBar`: micro-cents → dollars, pct, ok/warn/critical
// level), the save-patch builder (web `handleSave`: the off-branch clears `ai_features`), and the PII-safe
// `view.opened` diagnostic (P1/S11).
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed because the mandated
// surface directory (com/teslasync/feature-views/AISettings — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package and hosts several co-located declarations, exactly as the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration", "ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.featureviews.aisettings

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.util.Locale
import kotlin.math.min
import kotlin.math.roundToInt

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object AISettingsViewRegistration {
    /** Stable surface id. */
    const val ID: String = "ai-settings"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AISettings"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AISettingsViewRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it
 * from the first-composition effect. It carries no provider name, API key, or spend figure, so a
 * diagnostics line can never leak what a user has configured (ADR-015 §I9 / ADR-016).
 */
fun recordAISettingsViewOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AISettingsViewRegistration.SLUG))
}

/**
 * The three canonical Helix modes — the type-safe replacement for the web `'off' | 'local' | 'cloud'`
 * union. [wire] is the backend discriminator string (web `ai_mode`); [from] classifies a raw value,
 * defaulting to [Off] for `null`/legacy-empty/unknown payloads exactly like the web `isAiMode` guard
 * (`isAiMode(settings?.ai_mode) ? … : 'off'`).
 */
enum class HelixMode(
    val wire: String,
) {
    Off("off"),
    Local("local"),
    Cloud("cloud"),
    ;

    companion object {
        /** Classifies a raw wire mode; `null`/legacy-empty/unknown falls back to [Off] (web `isAiMode`). */
        fun from(raw: String?): HelixMode = entries.firstOrNull { it.wire == raw } ?: Off
    }
}

/**
 * The settings-document projection this surface renders — the native mirror of the slice of the web
 * `useSettings` document AISettings.tsx reads. [mode] is the server's `ai_mode` (defaulted to [HelixMode.Off]
 * per the AI-Off Contract), [costCapCents] the `ai_cost_cap_cents` whole-cent daily cap (gates the spend bar
 * with [HelixMode.Cloud]), and [present] whether the document actually resolved to a non-empty object (a blank
 * or absent document renders the empty surface instead of a misleading default-off panel).
 */
data class AiSettingsProjection(
    val mode: HelixMode,
    val costCapCents: Long,
    val present: Boolean,
)

/** The today-usage projection — the single field the cost-cap bar reads from `GET /ai/usage/today`. */
data class AiUsageToday(
    val costMicroCents: Long,
)

/**
 * Cost-cap severity — the native mirror of the web `AICostCapSpendBar` `level` (`ok`/`warn`/`critical`)
 * computed from the spend percentage. [Warn] matches the backend `BannerLevel:"warn"` 80% threshold; at or
 * above 100% the cap is reached and new calls are rejected ([Critical]).
 */
enum class SpendLevel {
    Ok,
    Warn,
    Critical,
}

/**
 * The fully-derived cost-cap spend view — everything the bar renders, computed off-device so the composable
 * only paints it. [spent]/[cap] are the pre-formatted USD strings (web `todayDollars.toFixed(2)` /
 * `capDollars.toFixed(2)`), [fraction] the 0..1 bar fill (web `pct/100`, capped at 100%), [percent] the
 * rounded 0..100 value for the progress-bar accessibility node (web `Math.round(pct)`), and [level] the color
 * band.
 */
data class CostCapSpend(
    val spent: String,
    val cap: String,
    val fraction: Float,
    val percent: Int,
    val level: SpendLevel,
)

/**
 * Projects the raw `GET /settings` document onto [AiSettingsProjection]. Reads `ai_mode` (defaulted to
 * [HelixMode.Off] when absent/legacy/unknown — web `isAiMode`) and `ai_cost_cap_cents` (clamped ≥ 0). A
 * `null`/`JsonNull`/non-object/empty-object document yields `present = false` so the view renders an honest
 * empty state rather than a default-off panel that looks like real data.
 */
fun projectAiSettings(document: JsonElement?): AiSettingsProjection {
    val obj = document as? JsonObject
    val present = obj != null && obj.isNotEmpty()
    val mode = HelixMode.from((obj?.get("ai_mode") as? JsonPrimitive)?.contentOrNull)
    val capCents = (obj?.get("ai_cost_cap_cents") as? JsonPrimitive).asLong().coerceAtLeast(0L)
    return AiSettingsProjection(mode = mode, costCapCents = capCents, present = present)
}

/**
 * Projects the raw `GET /ai/usage/today` document onto [AiUsageToday], reading `cost_micro_cents` (web
 * `data?.cost_micro_cents ?? 0`). An all-zeros / absent payload yields `0`, so the bar renders empty rather
 * than blank (web parity: no rows ⇒ `cost_micro_cents` is 0).
 */
fun projectAiUsageToday(document: JsonElement?): AiUsageToday {
    val obj = document as? JsonObject
    val micros = (obj?.get("cost_micro_cents") as? JsonPrimitive).asLong().coerceAtLeast(0L)
    return AiUsageToday(costMicroCents = micros)
}

/**
 * Computes the cost-cap spend view from today's [todayMicroCents] and the whole-cent [capCents] — the exact
 * web `AICostCapSpendBar` math: cap → micro-cents (×10 000), pct = min(100, today/cap×100), level by the
 * 80/100 thresholds, and both figures rendered in dollars. When the cap is 0 the percentage is 0 (no division
 * by zero), matching the parent gate that only shows the bar when the cap is positive.
 */
fun projectCostCapSpend(
    todayMicroCents: Long,
    capCents: Long,
): CostCapSpend {
    val capMicroCents = capCents * MICRO_CENTS_PER_CENT
    val pct = if (capMicroCents > 0L) min(MAX_PCT, todayMicroCents * MAX_PCT / capMicroCents) else 0.0
    val level =
        when {
            pct >= MAX_PCT -> SpendLevel.Critical
            pct >= WARN_PCT -> SpendLevel.Warn
            else -> SpendLevel.Ok
        }
    return CostCapSpend(
        spent = formatUsd(todayMicroCents / MICRO_CENTS_PER_DOLLAR),
        cap = formatUsd(capCents / CENTS_PER_DOLLAR),
        fraction = (pct / MAX_PCT).toFloat(),
        percent = pct.roundToInt(),
        level = level,
    )
}

/** Formats a dollar amount with two fixed decimals, locale-independent (web `Number.toFixed(2)`). */
fun formatUsd(value: Double): String = String.format(Locale.US, "%.2f", value)

/**
 * Builds the AI-settings save patch for the chosen [mode] — the native mirror of the web `handleSave`. The
 * off branch sends `ai_mode:"off"` plus an empty `ai_features` map so the backend's redaction + archive path
 * runs (web sends `{ ai_mode:'off', ai_features:{} }`); local/cloud send only `ai_mode`, leaving the
 * per-feature and per-provider sub-trees (owned by the sibling surfaces, not this one) untouched so the
 * repository's shallow-merge over the cached document preserves them.
 */
fun buildSavePatch(mode: HelixMode): JsonObject =
    buildJsonObject {
        put("ai_mode", mode.wire)
        if (mode == HelixMode.Off) {
            put("ai_features", JsonObject(emptyMap()))
        }
    }

/**
 * Transforms a cache-then-network [Resource] payload while preserving its freshness envelope — used to lift a
 * raw `Resource<JsonElement>` read onto a typed projection without losing the cached/stale/error flags the
 * [io.teslasync.android.data.UiState] contract needs. Pure, so it is unit-tested off-device.
 */
fun <A, B> Resource<A>.mapData(transform: (A) -> B): Resource<B> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/** Reads a JSON primitive as a [Long], tolerating integer or fractional encodings; `null` ⇒ 0. */
private fun JsonPrimitive?.asLong(): Long = this?.longOrNull ?: this?.doubleOrNull?.toLong() ?: 0L

private const val WARN_PCT = 80.0
private const val MAX_PCT = 100.0
private const val MICRO_CENTS_PER_CENT = 10_000L
private const val MICRO_CENTS_PER_DOLLAR = 1_000_000.0
private const val CENTS_PER_DOLLAR = 100.0
