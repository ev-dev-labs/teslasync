// The native Jetpack Compose + Material 3 view for the DateGroupedList shared surface — the parity port of the
// web `DateGroupedList` component (web/src/components/data-display/DateGroupedList.tsx). Its data layer (the
// [DateGroupedListGroup] render shape, the [dateGroupHeaderReadout] projection, the [DateGroupedListState]
// holder, and the [DateGroupedListDiagnostics] event) lives in DateGroupedListModel.kt.
//
// Web parity, element for element: the web renders a vertical stack of `<section>`s spaced by `space-y-6`. Each
// section opens with a `flex items-center gap-3` header — a `text-xs` cluster holding the bold `text-primary`
// date label and an optional muted `· relativeLabel`, then a `flex-1 h-px` glass-border divider at 50% opacity,
// then an optional right-pinned `text-xs tabular-nums` summary — followed by the group's items spaced by
// `space-y-3`. The native port reproduces each piece: the outer [Column] spaces sections by [groupSpacing]; the
// header [Row] carries the [Subhead] date label, the [Caption] relative label, a weighted hairline [Box]
// divider, and the tabular [GroupSummaryText]; the items [Column] spaces each rendered item by [itemSpacing].
//
// Data binding: the view performs NO HTTP. The stateful entry collects the P1/S8 [DateGroupedListState] with
// `collectAsStateWithLifecycle` and delegates to the stateless entry, which is the faithful port of the web
// props (`groups` + `renderItem` + `itemKey`) and the unit/UI-test seam. Diagnostics: one PII-safe
// `view.opened` (P1/S11) fires on first composition, before any group renders, so the surface is always
// recorded — even when it is given no groups and renders nothing.
//
// Empty state (Honesty Covenant #9 — documented, not silently dropped): the web component has no async data
// source and no loading / error / stale / offline branch; when `groups` is empty it simply renders an empty
// container (nothing visible). The native port is faithful: the outer container is always present, and an empty
// `groups` produces no sections — the same "nothing visible" the web shows. A fabricated empty message would
// add copy the anonymous web surface does not own (and the host that mounts this primitive owns its own empty
// state, exactly as on the web).
//
// Accessibility: each group's header is one merged TalkBack node marked as a `heading()` whose readout leads
// with the date label, then the relative label and summary (the [dateGroupHeaderReadout] projection) — the
// native analogue of the web `<section aria-labelledby={header}>`, with the divider excluded just as the web
// marks it `aria-hidden`. This lets a TalkBack user jump between days by heading. Every visible string is
// supplied already-localized by the caller, so there are no English literals in this surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.dategroupedlist

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag for the outer list container — lets a UI test assert the surface mounted. */
const val DATE_GROUPED_LIST_TAG: String = "date-grouped-list"

/** Test-tag prefix for a group section container, suffixed with the group's dateKey. */
const val DATE_GROUP_SECTION_TAG_PREFIX: String = "date-group-section-"

/** Test-tag prefix for a group's header row, suffixed with the group's dateKey. */
const val DATE_GROUP_HEADER_TAG_PREFIX: String = "date-group-header-"

/** Web divider `h-px` — a one-pixel hairline rule. */
private val DividerThickness: Dp = 1.dp

/** Web divider `opacity-50` — the glass-border rule is painted at half strength. */
private const val DIVIDER_ALPHA: Float = 0.5f

/**
 * Stateful entry point — binds the P1/S8 [DateGroupedListState] and renders the grouped list. Collects the
 * holder's groups with lifecycle awareness and forwards them to the stateless overload, the native analogue of
 * the web parent owning the `groups` array.
 *
 * @param state the shared state holder the surface binds to.
 * @param itemSpacing vertical gap between items inside a group (web `space-y-3`).
 * @param groupSpacing vertical gap between successive groups (web `space-y-6`).
 * @param itemKey optional stable key extractor for an item (web `itemKey`); falls back to the item index.
 * @param logger the sanctioned redacting logger the `view.opened` diagnostic is emitted through.
 * @param itemContent the per-item slot (web `renderItem`); receives the item and its index within the group.
 */
@Composable
fun <T> DateGroupedList(
    state: DateGroupedListState<T>,
    modifier: Modifier = Modifier,
    itemSpacing: Dp = Spacing.md,
    groupSpacing: Dp = Spacing.xl2,
    itemKey: ((item: T, indexInGroup: Int) -> Any)? = null,
    logger: Logger = LocalDataContainer.current.logger,
    itemContent: @Composable (item: T, indexInGroup: Int) -> Unit,
) {
    val groups by state.groups.collectAsStateWithLifecycle()
    DateGroupedList(
        groups = groups,
        modifier = modifier,
        itemSpacing = itemSpacing,
        groupSpacing = groupSpacing,
        itemKey = itemKey,
        logger = logger,
        itemContent = itemContent,
    )
}

/**
 * Stateless entry point — the faithful port of the web `DateGroupedList` props (`groups` + `renderItem` +
 * `itemKey`) and the unit/UI-test seam. Records the one-shot PII-safe `view.opened` diagnostic, then renders
 * one date-divider section per group. An empty [groups] renders the container with no sections — the same
 * "nothing visible" the web empty container shows.
 *
 * @param groups the date groups to render, in order.
 * @param itemSpacing vertical gap between items inside a group (web `space-y-3`, default 12 dp).
 * @param groupSpacing vertical gap between successive groups (web `space-y-6`, default 24 dp).
 * @param itemKey optional stable key extractor for an item (web `itemKey`); falls back to the item index.
 * @param logger the sanctioned redacting logger the `view.opened` diagnostic is emitted through.
 * @param itemContent the per-item slot (web `renderItem`); receives the item and its index within the group.
 */
@Composable
fun <T> DateGroupedList(
    groups: List<DateGroupedListGroup<T>>,
    modifier: Modifier = Modifier,
    itemSpacing: Dp = Spacing.md,
    groupSpacing: Dp = Spacing.xl2,
    itemKey: ((item: T, indexInGroup: Int) -> Any)? = null,
    logger: Logger = LocalDataContainer.current.logger,
    itemContent: @Composable (item: T, indexInGroup: Int) -> Unit,
) {
    LaunchedEffect(Unit) { DateGroupedListDiagnostics.recordViewOpened(logger) }

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(DATE_GROUPED_LIST_TAG),
        verticalArrangement = Arrangement.spacedBy(groupSpacing),
    ) {
        groups.forEach { group ->
            // Web `key={group.dateKey}` — keep group identity stable across data updates to avoid recompose
            // thrash and preserve item state when a day's contents change.
            key(group.dateKey) {
                DateGroupSection(
                    group = group,
                    itemSpacing = itemSpacing,
                    itemKey = itemKey,
                    itemContent = itemContent,
                )
            }
        }
    }
}

/**
 * One date group — the web `<section>`: a header divider row followed by the group's items. The section is
 * tagged so a UI test can assert it rendered.
 */
@Composable
private fun <T> DateGroupSection(
    group: DateGroupedListGroup<T>,
    itemSpacing: Dp,
    itemKey: ((item: T, indexInGroup: Int) -> Any)?,
    itemContent: @Composable (item: T, indexInGroup: Int) -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .testTag(DATE_GROUP_SECTION_TAG_PREFIX + group.dateKey),
    ) {
        GroupHeader(
            dateKey = group.dateKey,
            dateLabel = group.dateLabel,
            relativeLabel = group.relativeLabel,
            summary = group.summary,
        )
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(itemSpacing),
        ) {
            group.items.forEachIndexed { index, item ->
                key(itemKey?.invoke(item, index) ?: index) {
                    itemContent(item, index)
                }
            }
        }
    }
}

/**
 * The date-divider header — the web `mb-3 flex items-center gap-3` row. A `text-xs` label cluster (the bold
 * date label plus an optional muted `· relativeLabel`), a weighted hairline divider, and an optional right-
 * pinned tabular summary. The whole row is one merged TalkBack `heading()` whose readout is
 * [dateGroupHeaderReadout]; the divider is decorative and contributes no readout, mirroring the web
 * `aria-hidden` divider.
 */
@Composable
private fun GroupHeader(
    dateKey: String,
    dateLabel: String,
    relativeLabel: String?,
    summary: String?,
) {
    val readout = dateGroupHeaderReadout(dateLabel, relativeLabel, summary)
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(bottom = Spacing.md)
                .testTag(DATE_GROUP_HEADER_TAG_PREFIX + dateKey)
                .semantics(mergeDescendants = true) {
                    heading()
                    contentDescription = readout
                },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Subhead(text = dateLabel)
            if (!relativeLabel.isNullOrBlank()) {
                Caption(text = "· $relativeLabel")
            }
        }
        Box(
            modifier =
                Modifier
                    .weight(1f)
                    .height(DividerThickness)
                    .background(MaterialTheme.colorScheme.outlineVariant.copy(alpha = DIVIDER_ALPHA)),
        )
        if (!summary.isNullOrBlank()) {
            GroupSummaryText(text = summary)
        }
    }
}

/**
 * The right-pinned per-group summary — the web `text-xs tabular-nums text-[var(--text-muted)]` span. Rendered
 * with tabular figures (`tnum`) so the numbers in successive summaries (e.g. "6.2 mi" / "39.9 mi") align under
 * one another, exactly as the web `tabular-nums` intends. Theme typography + the muted scheme color keep it
 * consistent across light / dark / high-contrast.
 */
@Composable
private fun GroupSummaryText(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}
