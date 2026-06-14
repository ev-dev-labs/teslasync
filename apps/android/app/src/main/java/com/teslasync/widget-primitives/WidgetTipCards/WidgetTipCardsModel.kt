// Pure, framework-free model + projection + diagnostics for the WidgetTipCards widget primitive — the
// native analogue of web/src/features/dashboard/widgets/shared/WidgetTipCards.tsx. No Compose, no Android
// framework, no HTTP: every declaration here is exercised off-device in the :android:testReleaseUnitTest
// gate, keeping the composable a thin render layer over these pure functions (the accepted sibling-surface
// contract used by WidgetComparisonCard / WidgetBigNumber).
//
// What the web source actually is (and therefore the COMPLETE branch set this primitive reproduces): the
// web `WidgetTipCards` is a PURELY PRESENTATIONAL list of recommendation cards — a shared building block
// embedded by many dashboard widgets (BatteryDegradationForecast, ChargingOptimizer, DrivingCoach,
// AnomalyDetector). It takes a caller-supplied `tips: TipItem[]`, an optional `maxTips`, a `compact?` flag,
// and the empty-branch copy (`emptyMessage` / `emptyIcon`); it fetches nothing. Each `TipItem` carries an
// `id`, an optional leading `icon`, an already-localized `title` and `description`, an optional `impact`
// level (`high | medium | low`) that colours a trailing badge, and an optional already-localized
// `impactLabel`. The component's real, fully-reproduced render branches are exactly the two the web source
// has:
//   * EMPTY — when the visible slice is empty (web `visible.length === 0`), a friendly empty state (never a
//             blank box), reproduced as [WidgetTipCardsProjection.Empty];
//   * CARDS — otherwise, one [TipCardData] per visible tip (web `visible.map(...)`), each an optional icon,
//             a title with an optional impact badge, and a description, reproduced as
//             [WidgetTipCardsProjection.Cards].
// The visible slice is the first [resolveLimit] tips (web `tips.slice(0, maxTips ?? (compact ? 1 : 3))`);
// the `compact` flag also tightens the description to two lines (web `line-clamp-2`), modelled as the
// composable's clamp input rather than data. The badge variant is the web `impactBadgeMap`
// (high → success, medium → warning, low → neutral) carried on [TipImpact.badgeVariant]; the badge text is
// the web `tip.impactLabel ?? tip.impact`, carried on [TipCardData.badgeText] — when a caller supplies no
// localized label the fallback is the impact's stable wire token (the same `high`/`medium`/`low`
// discriminator the web falls back to), never an invented English sentence.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this
// primitive is a pure projection of caller-supplied tips — it is handed finished cards, so it never
// fetches, never errors, never goes stale and never goes offline. Modelling those would fabricate behaviour
// the web spec does not have (Honesty Covenant: no scope narrowing, no silent drift), exactly as the
// accepted WidgetComparisonCard / Delta presentational ports document. Its REAL states are the empty and
// cards branches above, both of which always render. The only static copy it owns — the default empty
// message — resolves at the render boundary from the shared P1/S10 catalog key whose value is precisely the
// web default ("No recommendations" → `translation_widget_chargingOptimizer_noRecommendations`); no English
// literal lives in native code and no new catalog key is invented (the allowed-files set forbids editing
// the catalog).
//
// `InvalidPackageDeclaration` is suppressed because this primitive's mandated directory
// (com/teslasync/widget-primitives/WidgetTipCards — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgettipcards

import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the WidgetTipCards primitive. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`WidgetTipCards`).
 */
object WidgetTipCardsRegistration {
    /** Stable surface id (also the key a host would bind the primitive with). */
    const val ID: String = "widget-tip-cards"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11, prompt-mandated). */
    const val SLUG: String = "WidgetTipCards"
}

/** How many tips the non-compact form keeps by default — the native mirror of the web `compact ? 1 : 3`. */
const val WIDGET_TIP_CARDS_DEFAULT_LIMIT: Int = 3

/** How many tips the compact form keeps — the native mirror of the web `compact ? 1 : 3`. */
const val WIDGET_TIP_CARDS_COMPACT_LIMIT: Int = 1

/**
 * A recommendation's impact level — the native analogue of the web `TipItem.impact` union
 * (`'high' | 'medium' | 'low'`). [wireValue] is the stable discriminator the web also falls back to when
 * no localized label is supplied; [badgeVariant] is the web `impactBadgeMap` colour mapping.
 */
enum class TipImpact(
    val wireValue: String,
) {
    /** Web `high` → `success` badge. */
    High("high"),

    /** Web `medium` → `warning` badge. */
    Medium("medium"),

    /** Web `low` → `neutral` badge. */
    Low("low"),
    ;

    /** The badge colour for this level — the native mirror of the web `impactBadgeMap[impact]`. */
    val badgeVariant: BadgeVariant
        get() =
            when (this) {
                High -> BadgeVariant.Success
                Medium -> BadgeVariant.Warning
                Low -> BadgeVariant.Neutral
            }

    companion object {
        /** Resolves a wire token (`high`/`medium`/`low`) back to a level, or `null` when unknown/absent. */
        fun fromWire(value: String?): TipImpact? = entries.firstOrNull { it.wireValue == value }
    }
}

/**
 * One projected card's framework-free data — the pure analogue of the web `TipItem` minus the Compose-only
 * icon (which the composable carries on its own input type so this model stays off-device testable).
 *
 * @property id the stable list key (web `tip.id`).
 * @property title the already-localized headline shown next to the badge (web `tip.title`).
 * @property description the already-localized supporting line (web `tip.description`).
 * @property impact the optional impact level driving the trailing badge (web `tip.impact`); `null` hides it.
 * @property impactLabel the optional already-localized badge text (web `tip.impactLabel`).
 */
data class TipCardData(
    val id: String,
    val title: String,
    val description: String,
    val impact: TipImpact? = null,
    val impactLabel: String? = null,
) {
    /** The badge colour, or `null` when no impact is set — web renders the badge only when `tip.impact`. */
    val badgeVariant: BadgeVariant?
        get() = impact?.badgeVariant

    /**
     * The badge text, or `null` when no impact is set — the native mirror of the web
     * `tip.impactLabel ?? tip.impact`: the caller's localized label when present, else the impact's stable
     * wire token (the same fallback the web uses). Never an invented English sentence.
     */
    val badgeText: String?
        get() = impact?.let { impactLabel ?: it.wireValue }
}

/**
 * Pure slice/limit math — the native mirror of the web `tips.slice(0, maxTips ?? (compact ? 1 : 3))`. Kept
 * framework-free and generic so the same logic slices both the composable's icon-bearing inputs and the
 * model's [TipCardData], and so every branch is asserted off-device in the unit gate.
 */
object WidgetTipCardsLayout {
    /**
     * The number of tips to show — web `maxTips ?? (compact ? 1 : 3)`. A caller [maxTips] wins (including
     * `0`, which yields the empty branch); otherwise the compact default applies. Negative inputs are
     * clamped to `0` so [visible] never throws.
     */
    fun resolveLimit(
        maxTips: Int?,
        compact: Boolean,
    ): Int {
        val limit = maxTips ?: if (compact) WIDGET_TIP_CARDS_COMPACT_LIMIT else WIDGET_TIP_CARDS_DEFAULT_LIMIT
        return limit.coerceAtLeast(0)
    }

    /** The first [resolveLimit] items of [tips] — the native mirror of the web `tips.slice(0, limit)`. */
    fun <T> visible(
        tips: List<T>,
        maxTips: Int?,
        compact: Boolean,
    ): List<T> = tips.take(resolveLimit(maxTips, compact))
}

/**
 * The projected render state the primitive paints — the native analogue of the web component's two render
 * branches. Framework-free so the whole contract is covered by the JVM unit gate without a Compose host.
 */
sealed interface WidgetTipCardsProjection {
    /** Web `visible.length === 0` → the friendly empty state (never a blank box). */
    data object Empty : WidgetTipCardsProjection

    /** Web non-empty branch → one [TipCardData] per visible tip (web `visible.map(...)`). */
    data class Cards(
        val cards: List<TipCardData>,
    ) : WidgetTipCardsProjection

    companion object {
        /**
         * Projects [tips] into the branch the composable paints — the native mirror of the web
         * `visible = tips.slice(0, limit); visible.length === 0 ? empty : cards`. The slice keeps the first
         * [WidgetTipCardsLayout.resolveLimit] tips; an empty visible slice is the empty branch; otherwise
         * every visible tip becomes a [TipCardData].
         */
        fun project(
            tips: List<TipCardData>,
            maxTips: Int? = null,
            compact: Boolean = false,
        ): WidgetTipCardsProjection {
            val visible = WidgetTipCardsLayout.visible(tips, maxTips, compact)
            return if (visible.isEmpty()) Empty else Cards(visible)
        }
    }
}

/**
 * PII-safe diagnostics for the primitive (P1/S11). Emits only the stable, dot-namespaced `view.opened`
 * event tagged with the surface [WidgetTipCardsRegistration.SLUG] — never a tip title, description, impact,
 * or label, so a diagnostics line can never leak what the card displays. Kept free of Compose so it is
 * unit-tested with a recording [Logger]; the composable calls it once per surface open.
 */
object WidgetTipCardsDiagnostics {
    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the one PII-safe `view.opened` diagnostic. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to WidgetTipCardsRegistration.SLUG))
    }
}
