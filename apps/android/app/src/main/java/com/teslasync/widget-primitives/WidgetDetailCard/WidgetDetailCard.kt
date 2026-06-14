// The native Jetpack Compose + Material 3 WidgetDetailCard shared widget primitive — a parity port of
// web/src/features/dashboard/widgets/shared/WidgetDetailCard.tsx. The web surface is a PURE presentational
// building block reused by many dashboard widgets: a vertically-scrolling stack of label/value rows (the label
// muted + uppercased on the left, the value — optionally monospace, a null value shown as an em dash — on the
// right with an optional trailing status badge, a hairline divider under every row but the last), or, when no
// rows are supplied, the shared empty state. A `compact` flag caps the list at the first four rows.
//
// This native surface keeps that contract end to end and renders every branch the web source draws — the empty
// state and the populated list crossed with the badge / monospace / null-value / compact-cap / divider branches
// — without ever hiding a region. It performs NO HTTP and binds NO state holder (the web component fetches
// nothing; see WidgetDetailCardModel.kt for the honesty rationale and why the generic loading / error / stale /
// offline states belong to the owning widget, not a presentational primitive). The chrome is composed from the
// shared components (the `components.feedback` EmptyState and the `components.ui` Badge) on platform tokens
// (P1/S9 — Spacing) so it stays correct across light / dark / high-contrast themes; the only string it renders
// beyond its caller-supplied props (the default empty message) resolves through the i18n facade (P1/S10) by-name
// with the English fallback. Each row is one merged semantics node whose spoken description is the original-case
// "label, value[, badge]" (so TalkBack never spells out the visually-uppercased label). A one-shot PII-safe
// `view.opened` diagnostic (P1/S11) fires on first composition. All branch selection flows through the pure
// [projectWidgetDetailCard] / [badgeVariantFor] in WidgetDetailCardModel.kt.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/widget-primitives/WidgetDetailCard) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetdetailcard

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Web `tracking-wide` on the uppercased row label — a small positive letter spacing. */
private val DETAIL_LABEL_TRACKING: TextUnit = 0.5.sp

// ── Test tags (stable hooks for WidgetDetailCardUiTest; inert at runtime) ─────────────────────────────
const val WIDGET_DETAIL_CARD_LIST_TAG: String = "widget-detail-card-list"
const val WIDGET_DETAIL_CARD_ROW_TAG: String = "widget-detail-card-row"
const val WIDGET_DETAIL_CARD_EMPTY_TAG: String = "widget-detail-card-empty"

/**
 * Stateful entry point — the faithful port of the web `WidgetDetailCard`. Records the one-shot `view.opened`
 * diagnostic (P1/S11) on first composition, reduces the parent's [entries] into the render-ready model, resolves
 * the default empty message through the i18n facade, and renders the card. Performs no HTTP and binds no state
 * holder (the web component is presentational; its rows are owned by the parent widget).
 *
 * @param entries the rows to render (web `entries`); empty ⇒ the friendly empty state.
 * @param compact caps the list at the first [COMPACT_ROW_LIMIT] rows (web `compact`).
 * @param emptyMessage the message shown when there are no rows (web `emptyMessage`); already localized by the
 *   caller. `null` ⇒ the localized default ("No details available").
 * @param emptyIcon the optional glyph shown above the empty message (web `emptyIcon`); the native counterpart of
 *   the web `ReactNode` icon.
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun WidgetDetailCard(
    entries: List<DetailEntry>,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    emptyMessage: String? = null,
    emptyIcon: ImageVector? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { WidgetDetailCardDiagnostics.recordViewOpened(logger) }
    val render = remember(entries, compact) { projectWidgetDetailCard(entries, compact) }
    val resolvedEmptyMessage = emptyMessage ?: rememberDefaultEmptyMessage()
    WidgetDetailCardContent(
        render = render,
        modifier = modifier,
        emptyMessage = resolvedEmptyMessage,
        emptyIcon = emptyIcon,
    )
}

/**
 * Stateless renderer for every surface state — the UI-test + preview entry point. Draws the shared empty state
 * when [WidgetDetailCardRender.isEmpty], otherwise a vertically-scrolling stack of rows (web `overflow-y-auto
 * h-full`). The card carries no chrome of its own (the owning widget panel provides it), exactly like the web
 * source.
 */
@Composable
fun WidgetDetailCardContent(
    render: WidgetDetailCardRender,
    modifier: Modifier = Modifier,
    emptyMessage: String = WidgetDetailCardDefaults.EMPTY_MESSAGE,
    emptyIcon: ImageVector? = null,
) {
    if (render.isEmpty) {
        EmptyState(
            message = emptyMessage,
            modifier = modifier.testTag(WIDGET_DETAIL_CARD_EMPTY_TAG),
            icon = emptyIcon,
        )
        return
    }
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .testTag(WIDGET_DETAIL_CARD_LIST_TAG),
    ) {
        render.rows.forEach { row -> DetailRowItem(row) }
    }
}

/**
 * One label/value line — web's per-row `<div class="flex items-center justify-between …">`. The whole row is a
 * single merged semantics node whose spoken description is the original-case "label, value[, badge]" (so a
 * screen reader never spells out the visually-uppercased label), with the optional hairline divider beneath it
 * (web `border-b` on every row but the last).
 */
@Composable
private fun DetailRowItem(row: DetailRow) {
    val description = remember(row) { detailRowContentDescription(row) }
    Column(modifier = Modifier.fillMaxWidth().testTag(WIDGET_DETAIL_CARD_ROW_TAG)) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = Spacing.xs, vertical = Spacing.sm)
                    .clearAndSetSemantics { contentDescription = description },
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            DetailLabel(text = row.label, modifier = Modifier.weight(1f))
            DetailValueGroup(row = row)
        }
        if (row.showDivider) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

/**
 * The muted, uppercased, wide-tracked label on the left — web `text-[10px] uppercase text-[var(--text-muted)]
 * tracking-wide`. Truncates to one line (web `truncate`). The display text is uppercased for visual parity; the
 * row's merged semantics carry the original-case label so accessibility is unaffected. The locale-invariant
 * `uppercase()` mirrors the CSS `text-transform` and avoids locale-specific casing surprises.
 */
@Composable
private fun DetailLabel(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text.uppercase(),
        modifier = modifier,
        style = MaterialTheme.typography.labelSmall.copy(letterSpacing = DETAIL_LABEL_TRACKING),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

/**
 * The value (optionally monospace) plus its optional trailing badge on the right — web `<span class="flex
 * min-w-0 items-center gap-2">`. The value truncates to one line; the badge maps onto the shared chip via the
 * pure [badgeVariantFor] (web `badgeVariantMap`).
 */
@Composable
private fun DetailValueGroup(row: DetailRow) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = row.value,
            style =
                if (row.mono) {
                    MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace)
                } else {
                    MaterialTheme.typography.bodyMedium
                },
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        row.badge?.let { badge ->
            Badge(text = badge.text, variant = badgeVariantFor(badge.variant))
        }
    }
}

/**
 * Resolves the default empty-state message through the i18n facade by-name with the English
 * [WidgetDetailCardDefaults.EMPTY_MESSAGE] fallback — the native mirror of i18next `t(key, default)` for the one
 * string the web source owns implicitly (its hardcoded `'No details available'`). A caller-supplied
 * `emptyMessage` (already localized) takes precedence and never reaches here.
 */
@Composable
private fun rememberDefaultEmptyMessage(): String {
    val context = LocalContext.current
    val lookup: (String) -> String? = { name -> context.optionalString(name) }
    return remember(context) {
        resolveOptional(lookup, KEY_WIDGET_DETAIL_CARD_EMPTY, WidgetDetailCardDefaults.EMPTY_MESSAGE)
    }
}

/**
 * Optional by-name read from the Android string catalog — the seam [resolveOptional] uses to reproduce web
 * `t(key, default)` for the surface's one implicit string. `getIdentifier` is the only way to attempt a key that
 * may be absent, so `DiscouragedApi` is suppressed; release builds keep resource names so the lookup stays
 * stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

// ── Previews — one per render branch (populated / populated dark / compact cap / empty). Sample strings are
// tooling-only, never shipped UI. ──────────────────────────────────────────────────────────────────────────

private val PREVIEW_ENTRIES: List<DetailEntry> =
    listOf(
        DetailEntry(label = "Battery", value = "82%", badge = DetailBadge("Healthy", DetailBadgeVariant.Success)),
        DetailEntry(label = "Range", value = "247 mi"),
        DetailEntry(label = "VIN", value = "5YJ3E1EA7KF000000", mono = true),
        DetailEntry(label = "Charge limit", value = "90%", badge = DetailBadge("High", DetailBadgeVariant.Warning)),
        DetailEntry(label = "Last seen", value = null),
    )

@Preview(name = "WidgetDetailCard · populated", showBackground = true)
@Composable
private fun WidgetDetailCardPopulatedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WidgetDetailCardContent(
            render = projectWidgetDetailCard(PREVIEW_ENTRIES, compact = false),
            modifier = Modifier.padding(Spacing.md),
        )
    }
}

@Preview(name = "WidgetDetailCard · populated (dark)", showBackground = true)
@Composable
private fun WidgetDetailCardPopulatedDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        WidgetDetailCardContent(
            render = projectWidgetDetailCard(PREVIEW_ENTRIES, compact = false),
            modifier = Modifier.padding(Spacing.md),
        )
    }
}

@Preview(name = "WidgetDetailCard · compact (first 4)", showBackground = true)
@Composable
private fun WidgetDetailCardCompactPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WidgetDetailCardContent(
            render = projectWidgetDetailCard(PREVIEW_ENTRIES, compact = true),
            modifier = Modifier.padding(Spacing.md),
        )
    }
}

@Preview(name = "WidgetDetailCard · empty", showBackground = true)
@Composable
private fun WidgetDetailCardEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WidgetDetailCardContent(
            render = projectWidgetDetailCard(emptyList(), compact = false),
            emptyMessage = WidgetDetailCardDefaults.EMPTY_MESSAGE,
            emptyIcon = TeslaGlyphs.Info,
            modifier = Modifier.padding(Spacing.md),
        )
    }
}
