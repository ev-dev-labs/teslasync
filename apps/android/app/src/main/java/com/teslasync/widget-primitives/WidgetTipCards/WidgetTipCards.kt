// The native Jetpack Compose + Material 3 WidgetTipCards widget primitive — a parity port of the web shared
// recommendation list web/src/features/dashboard/widgets/shared/WidgetTipCards.tsx.
//
// [WidgetTipCards] is the stateful entry: it records the one-shot `view.opened` diagnostic (P1/S11), slices
// the caller's tips with the pure [WidgetTipCardsLayout.visible], and paints the result through the
// stateless [WidgetTipCardsContent] (the test / preview entry point). The faithful mapping of the web
// layout:
//   * the empty branch (web `<EmptyState icon message />` when `visible.length === 0`) →
//     [WidgetTipCardsEmpty], the SHIPPED EmptyState surface (P3 components/feedback) carrying the caller's
//     `emptyMessage` or, when absent, the localized default resolved from the shared catalog key whose
//     value is precisely the web default ("No recommendations"); never a blank box;
//   * the cards branch (web `<div class="space-y-2 …">{visible.map(...)}</div>`) → [WidgetTipCardsList], a
//     column of [TipCard]s spaced by the web `space-y-2` gap;
//   * each card (web `rounded-lg bg-white/[0.03] border … p-3 min-h-[44px] flex items-start gap-3`) → a
//     [Surface] with the subtle inset fill + hairline border, hosting an optional leading icon (web
//     `mt-0.5 shrink-0`), then a column whose header is the medium-weight title with an optional trailing
//     impact [Badge] (web `flex items-start justify-between`), over the muted description (web
//     `text-xs … leading-relaxed`, clamped to two lines when `compact`).
// The badge is delegated to the SHIPPED Badge surface (web `<Badge variant={impactBadgeMap[impact]}
// size="sm">`); its colour + text come from the pure [TipCardData] (web `impactBadgeMap` + `impactLabel ??
// impact`). The icon is rendered through the SHIPPED Icon surface; the tip icons are decorative (the
// meaning lives in the title/description) so they carry a null content description and are skipped by
// TalkBack, exactly as the web wraps them in a presentational span.
//
// The primitive has no interactive elements (it is a read-only list, like the web), so accessibility is
// satisfied by every title, description, and badge Text being a spoken node and the empty state carrying
// its own content description (the shared EmptyState sets it from the message).
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/widget-primitives/WidgetTipCards — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgettipcards

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the rendered cards column — used by the instrumented per-state + a11y UI tests. */
const val WIDGET_TIP_CARDS_TEST_TAG: String = "widget-tip-cards"

/** Test tag identifying the empty-state surface (web `<EmptyState />`). */
const val WIDGET_TIP_CARDS_EMPTY_TEST_TAG: String = "widget-tip-cards-empty"

/** Test tag identifying a single tip card (web each `visible.map(...)` entry). */
const val WIDGET_TIP_CARD_TEST_TAG: String = "widget-tip-card"

/** Minimum card height + accessible touch height — the native mirror of the web `min-h-[44px]`. */
private val TIP_CARD_MIN_HEIGHT: Dp = 44.dp

/** Card border width — the native mirror of the web `border` hairline (`border-white/[0.06]`). */
private val TIP_CARD_BORDER_WIDTH: Dp = 1.dp

/** Top nudge aligning the leading icon with the title baseline — the native mirror of the web `mt-0.5`. */
private val ICON_TOP_NUDGE: Dp = 2.dp

/** Gap between the title row and the description — the native mirror of the web `mt-0.5`. */
private val TITLE_DESCRIPTION_GAP: Dp = 2.dp

/** Description line cap in compact mode — the native mirror of the web `line-clamp-2`. */
private const val COMPACT_DESCRIPTION_LINES: Int = 2

/**
 * One caller-supplied tip — the native analogue of the web `TipItem`. Carries the Compose-only [icon] the
 * framework-free [TipCardData] cannot, and reduces to that pure data via [toData] for the badge logic.
 *
 * @property id the stable list key (web `tip.id`).
 * @property title the already-localized headline (web `tip.title`).
 * @property description the already-localized supporting line (web `tip.description`).
 * @property icon the optional leading glyph (web `tip.icon`); `null` renders no icon.
 * @property impact the optional impact level driving the trailing badge (web `tip.impact`).
 * @property impactLabel the optional already-localized badge text (web `tip.impactLabel`).
 */
data class TipItem(
    val id: String,
    val title: String,
    val description: String,
    val icon: ImageVector? = null,
    val impact: TipImpact? = null,
    val impactLabel: String? = null,
) {
    /** Reduces this tip to the framework-free [TipCardData] that owns the badge colour + text logic. */
    fun toData(): TipCardData =
        TipCardData(
            id = id,
            title = title,
            description = description,
            impact = impact,
            impactLabel = impactLabel,
        )
}

/**
 * Stateful entry point — the faithful port of the web `WidgetTipCards`. Records the one-shot `view.opened`
 * diagnostic (P1/S11), slices the caller's [tips] with the pure [WidgetTipCardsLayout.visible] (web
 * `tips.slice(0, maxTips ?? (compact ? 1 : 3))`), and paints the result. The primitive is presentational —
 * it fetches nothing and performs no work of its own.
 *
 * @param tips the recommendations to render (web `tips`).
 * @param modifier optional layout modifier for the list / empty state.
 * @param maxTips optional hard cap on the visible count (web `maxTips`); `null` uses the compact default.
 * @param compact when true, caps to one tip and clamps each description to two lines (web `compact`).
 * @param emptyMessage optional override for the empty-branch copy (web `emptyMessage`); `null` uses the
 *   localized default ("No recommendations").
 * @param emptyIcon optional glyph for the empty branch (web `emptyIcon`).
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun WidgetTipCards(
    tips: List<TipItem>,
    modifier: Modifier = Modifier,
    maxTips: Int? = null,
    compact: Boolean = false,
    emptyMessage: String? = null,
    emptyIcon: ImageVector? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { WidgetTipCardsDiagnostics.recordViewOpened(logger) }
    val visible = WidgetTipCardsLayout.visible(tips, maxTips, compact)
    WidgetTipCardsContent(
        tips = visible,
        modifier = modifier,
        compact = compact,
        emptyMessage = emptyMessage,
        emptyIcon = emptyIcon,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Paints the already-sliced [tips]: the
 * empty branch when the slice is empty, otherwise the column of cards. Every branch renders a non-blank
 * surface (never a hidden surface) so the P3 "every state renders" contract holds.
 */
@Composable
fun WidgetTipCardsContent(
    tips: List<TipItem>,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    emptyMessage: String? = null,
    emptyIcon: ImageVector? = null,
) {
    if (tips.isEmpty()) {
        WidgetTipCardsEmpty(modifier = modifier, message = emptyMessage, icon = emptyIcon)
    } else {
        WidgetTipCardsList(tips = tips, modifier = modifier, compact = compact)
    }
}

/**
 * The empty branch — the SHIPPED EmptyState surface (web `<EmptyState icon message />`). The message is the
 * caller's [message] or, when absent, the localized default whose catalog value is precisely the web
 * default ("No recommendations"). Never a blank box.
 */
@Composable
private fun WidgetTipCardsEmpty(
    modifier: Modifier = Modifier,
    message: String? = null,
    icon: ImageVector? = null,
) {
    EmptyState(
        message = message ?: stringResource(R.string.translation_widget_chargingOptimizer_noRecommendations),
        modifier = modifier.testTag(WIDGET_TIP_CARDS_EMPTY_TEST_TAG),
        icon = icon,
    )
}

/** The cards branch — a column of [TipCard]s separated by the web `space-y-2` gap. */
@Composable
private fun WidgetTipCardsList(
    tips: List<TipItem>,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
) {
    Column(
        modifier = modifier.fillMaxWidth().testTag(WIDGET_TIP_CARDS_TEST_TAG),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        tips.forEach { tip ->
            TipCard(tip = tip, compact = compact)
        }
    }
}

/**
 * A single tip card (web `visible.map(...)` entry): the subtle inset [Surface] hosting an optional leading
 * icon, the title + optional impact badge header, and the muted description (clamped to two lines when
 * [compact]).
 */
@Composable
private fun TipCard(
    tip: TipItem,
    compact: Boolean,
) {
    val data = tip.toData()
    Surface(
        modifier = Modifier.fillMaxWidth().testTag(WIDGET_TIP_CARD_TEST_TAG),
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surfaceVariant,
        border = BorderStroke(TIP_CARD_BORDER_WIDTH, MaterialTheme.colorScheme.outline),
    ) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = TIP_CARD_MIN_HEIGHT)
                    .padding(Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            tip.icon?.let { glyph ->
                Icon(
                    imageVector = glyph,
                    contentDescription = null,
                    modifier = Modifier.padding(top = ICON_TOP_NUDGE),
                    size = IconSize.Sm,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(TITLE_DESCRIPTION_GAP),
            ) {
                TipCardHeader(title = data.title, badgeText = data.badgeText, badgeVariant = data.badgeVariant)
                Text(
                    text = data.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = if (compact) COMPACT_DESCRIPTION_LINES else Int.MAX_VALUE,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/**
 * The title row — the medium-weight title taking the weight so an optional trailing impact [Badge] is
 * pushed to the trailing edge (web `flex items-start justify-between gap-2`). The badge renders only when
 * an impact is set, exactly as the web `{tip.impact && <Badge>}`.
 */
@Composable
private fun TipCardHeader(
    title: String,
    badgeText: String?,
    badgeVariant: BadgeVariant?,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            text = title,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurface,
        )
        if (badgeText != null && badgeVariant != null) {
            Badge(text = badgeText, variant = badgeVariant)
        }
    }
}

// ── Previews (tooling-only; the sample tips are never shipped UI) ─────────────────────────────────────

private val previewTips: List<TipItem> =
    listOf(
        TipItem(
            id = "1",
            title = "Charge to 80% on weekdays",
            description = "Capping the daily charge limit slows calendar ageing and keeps a healthy buffer.",
            icon = TeslaGlyphs.Info,
            impact = TipImpact.High,
            impactLabel = "High",
        ),
        TipItem(
            id = "2",
            title = "Shift charging to off-peak hours",
            description = "Most sessions started during peak pricing; an overnight schedule cuts cost.",
            icon = TeslaGlyphs.Info,
            impact = TipImpact.Medium,
            impactLabel = "Medium",
        ),
        TipItem(
            id = "3",
            title = "Precondition while plugged in",
            description = "Warming the cabin on shore power preserves range on cold mornings.",
            icon = TeslaGlyphs.Info,
            impact = TipImpact.Low,
            impactLabel = "Low",
        ),
    )

@Preview(name = "WidgetTipCards — cards", showBackground = true)
@Composable
private fun WidgetTipCardsListPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WidgetTipCardsContent(tips = previewTips)
    }
}

@Preview(name = "WidgetTipCards — compact (dark)", showBackground = true)
@Composable
private fun WidgetTipCardsCompactPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        WidgetTipCardsContent(tips = previewTips.take(1), compact = true)
    }
}

@Preview(name = "WidgetTipCards — empty", showBackground = true)
@Composable
private fun WidgetTipCardsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WidgetTipCardsContent(tips = emptyList(), emptyIcon = TeslaGlyphs.Info)
    }
}
