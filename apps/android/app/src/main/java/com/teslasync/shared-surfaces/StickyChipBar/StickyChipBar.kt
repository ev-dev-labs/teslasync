// The native Jetpack Compose + Material 3 StickyChipBar shared surface — a parity port of the web
// "jump to section" navigation web/src/components/status/StickyChipBar.tsx.
//
// [StickyChipBar] is the stateful entry: it binds the [StickyChipBarViewModel] (the P1/S8 state holder owning
// the tracked active id — the web `activeId` state), records the one-shot `view.opened` diagnostic (P1/S11),
// seeds + re-derives the active id as the chip set changes ([StickyChipBarViewModel.syncChips]), forwards the
// host's reported visible-section ids to the observer reducer ([StickyChipBarViewModel.onSectionsVisible]),
// projects the caller's collection with the pure [StickyChipBarProjection.project], and paints
// [StickyChipBarContent]. [StickyChipBarContent] is the stateless renderer (the test / preview entry point).
//
// The faithful mapping of the web behaviour:
//   * the empty-`chips` outcome (web renders an empty `<nav>`) → [StickyChipBarProjection.Empty], painted as a
//     friendly [EmptyState] so a panel is never a blank box (the P3 "every state renders" contract);
//   * the populated row (web `chips.map`) → [StickyChipBarProjection.Resolved], a `selectableGroup` row of
//     pills, each a `Role.Tab` `selectable` carrying its active / inactive branch;
//   * the active chip's cyan highlight (web `bg-cyan-400/15 ring-1 ring-cyan-400/30 text-cyan-200`) → the
//     generated P1/S9 [TeslaTokens.chart] cyan series (`regen`), never a raw hex, resolved at the boundary;
//   * `overflow-x-auto` → `Modifier.horizontalScroll`; the translucent sticky chrome (web
//     `bg-[var(--bg-1)]/85 backdrop-blur border-b border-white/[0.06]`) → a translucent `surface` fill plus a
//     hairline bottom rail. Backdrop-blur has no first-class Compose primitive without an extra dependency, so
//     the translucent fill is the documented native approximation (Honesty Covenant #9 — documented, not silent);
//   * `min-h-[32px] px-3 py-1 text-xs font-medium` → the chip height / padding / `labelMedium` text.
// The two web side effects are host concerns, not surface concerns: the CSS `position: sticky` (the host pins
// this bar above its scrollable, e.g. a `stickyHeader`), and the click `scrollIntoView` (the web reaches into
// `#main-content`; the Android host owns the scrollable and performs the scroll in [onChipSelected]). The
// surface stays a pure presentation layer, exactly as the web component delegates scrolling to the page's
// scroll container. The host reports the currently-visible section anchors through [visibleSectionIds] — the
// native analogue of the web `IntersectionObserver` watching the chip anchors.
//
// Accessibility: the row announces the localized [navLabel] (web `<nav aria-label>`); each chip speaks its
// label with the `Tab` role and selected state (web `aria-current`), the touch target is expanded to the
// Material minimum, and disabled / motion concerns follow the platform. Every visible string is caller-supplied
// already-localized (the chip labels) or resolved from the P1/S10 catalog ([navLabel] / [emptyMessage]); no
// English literal lives in shipped code paths.
//
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer, helpers and previews;
// `InvalidPackageDeclaration` because the mandated surface directory (com/teslasync/shared-surfaces/StickyChipBar)
// cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.stickychipbar

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the rendered bar container — used by the instrumented per-state + a11y UI tests. */
const val STICKY_CHIP_BAR_TEST_TAG: String = "sticky-chip-bar"

/** Gap between chips — the native mirror of the web `gap-1.5` (6 px). */
private val CHIP_GAP: Dp = 6.dp

/** Minimum chip height — the web `min-h-[32px]`. */
private val CHIP_MIN_HEIGHT: Dp = 32.dp

/** Active chip ring width — the web `ring-1`. */
private val CHIP_RING_WIDTH: Dp = 1.dp

/** The sticky bar's hairline bottom rail thickness — the web `border-b`. */
private val BAR_BORDER_THICKNESS: Dp = 1.dp

/** Active chip fill opacity — the web `bg-cyan-400/15`. */
private const val ACTIVE_FILL_ALPHA: Float = 0.15f

/** Active chip ring opacity — the web `ring-cyan-400/30`. */
private const val ACTIVE_RING_ALPHA: Float = 0.30f

/** Translucent sticky-bar fill opacity — the web `bg-[var(--bg-1)]/85` (backdrop-blur approximated). */
private const val BAR_BG_ALPHA: Float = 0.85f

/** Hairline bottom-rail opacity — the web `border-white/[0.06]`. */
private const val BAR_BORDER_ALPHA: Float = 0.06f

/**
 * Stateful entry point bound to the shared state holder — the faithful port of the web `StickyChipBar`. Binds
 * the [StickyChipBarViewModel], records the one-shot `view.opened` diagnostic (P1/S11), keeps the tracked
 * active id valid as [chips] change, forwards the host-reported [visibleSectionIds] to the observer reducer
 * (web `IntersectionObserver`), and projects the collection into the branch [StickyChipBarContent] paints.
 *
 * @param chips the controlled "jump to" targets, in order (web `chips`).
 * @param onChipSelected invoked with a chip's id when it is activated — the host scrolls the section into view
 *   (web `handleClick` scrolling `#main-content`); the surface only updates the highlight.
 * @param modifier optional layout modifier for the bar.
 * @param visibleSectionIds the chip-anchor ids the host currently sees on screen — the native analogue of the
 *   web `IntersectionObserver` entries; the top-most one becomes active. Empty leaves the active id as seeded.
 * @param navLabel the localized accessibility label announced for the row (web `aria-label="Jump to section"`);
 *   defaults to the `nav.quickNav` catalog entry.
 * @param emptyMessage the localized message shown when there are no chips; defaults to the `common.noData`
 *   catalog entry.
 * @param testTag the container test tag; defaults to [STICKY_CHIP_BAR_TEST_TAG].
 * @param instanceKey the `viewModel` key scoping the holder per placement; defaults to the registration id.
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun StickyChipBar(
    chips: List<ChipItem>,
    onChipSelected: (String) -> Unit,
    modifier: Modifier = Modifier,
    visibleSectionIds: List<String> = emptyList(),
    navLabel: String = stringResource(R.string.translation_nav_quickNav),
    emptyMessage: String = stringResource(R.string.translation_common_noData),
    testTag: String = STICKY_CHIP_BAR_TEST_TAG,
    instanceKey: String = StickyChipBarRegistration.ID,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: StickyChipBarViewModel =
        viewModel(key = instanceKey, factory = StickyChipBarViewModel.factory(logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    LaunchedEffect(viewModel, chips) { viewModel.syncChips(chips) }
    LaunchedEffect(viewModel, visibleSectionIds, chips) {
        viewModel.onSectionsVisible(visibleSectionIds, chips.map { it.id })
    }
    val activeId by viewModel.activeId.collectAsStateWithLifecycle()
    val projection = remember(chips, activeId) { StickyChipBarProjection.project(chips, activeId) }
    StickyChipBarContent(
        projection = projection,
        navLabel = navLabel,
        emptyMessage = emptyMessage,
        onChipClick = { id ->
            viewModel.selectChip(id)
            onChipSelected(id)
        },
        modifier = modifier,
        testTag = testTag,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Paints the projected branch: the friendly
 * empty surface, or the populated `selectableGroup` chip row. Every branch renders a non-blank surface (never
 * a hidden one) so the P3 "every state renders" contract holds.
 */
@Composable
fun StickyChipBarContent(
    projection: StickyChipBarProjection,
    navLabel: String,
    emptyMessage: String,
    onChipClick: (String) -> Unit,
    modifier: Modifier = Modifier,
    testTag: String = STICKY_CHIP_BAR_TEST_TAG,
) {
    when (projection) {
        is StickyChipBarProjection.Empty ->
            EmptyState(message = emptyMessage, modifier = modifier.testTag(testTag))

        is StickyChipBarProjection.Resolved ->
            StickyChipBarRow(
                chips = projection.chips,
                navLabel = navLabel,
                onChipClick = onChipClick,
                modifier = modifier.testTag(testTag),
            )
    }
}

/**
 * The populated, horizontally-scrollable chip row pinned inside the translucent sticky bar — a `selectableGroup`
 * announcing [navLabel] (web the `<nav>` wrapping the `overflow-x-auto` chip list).
 */
@Composable
private fun StickyChipBarRow(
    chips: List<ChipView>,
    navLabel: String,
    onChipClick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val railColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha = BAR_BORDER_ALPHA)
    val barColor = MaterialTheme.colorScheme.surface.copy(alpha = BAR_BG_ALPHA)
    Box(
        modifier =
            modifier
                .fillMaxWidth()
                .background(barColor)
                .bottomBorder(railColor, BAR_BORDER_THICKNESS),
    ) {
        Row(
            modifier =
                Modifier
                    .semantics { contentDescription = navLabel }
                    .selectableGroup()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = Spacing.lg, vertical = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(CHIP_GAP),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            chips.forEach { chip -> SectionChip(chip = chip, onClick = onChipClick) }
        }
    }
}

/**
 * One "jump to" chip — a rounded `selectable` (`Role.Tab`) with the active cyan fill + ring + text when it is
 * the tracked section (web `bg-cyan-400/15 ring-cyan-400/30 text-cyan-200`), or a muted label otherwise. The
 * merged node speaks the label with the tab role + selected state (web `aria-current`).
 */
@Composable
private fun SectionChip(
    chip: ChipView,
    onClick: (String) -> Unit,
) {
    val accent = TeslaTokens.chart.regen
    val contentColor = if (chip.active) accent else MaterialTheme.colorScheme.onSurfaceVariant
    val fill = if (chip.active) accent.copy(alpha = ACTIVE_FILL_ALPHA) else Color.Transparent
    val ring = if (chip.active) accent.copy(alpha = ACTIVE_RING_ALPHA) else Color.Transparent
    Row(
        modifier =
            Modifier
                .minimumInteractiveComponentSize()
                .clip(CircleShape)
                .background(fill, CircleShape)
                .border(CHIP_RING_WIDTH, ring, CircleShape)
                .selectable(selected = chip.active, role = Role.Tab) { onClick(chip.id) }
                .semantics(mergeDescendants = true) {}
                .heightIn(min = CHIP_MIN_HEIGHT)
                .padding(horizontal = Spacing.md, vertical = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text = chip.label, style = MaterialTheme.typography.labelMedium, color = contentColor)
    }
}

/** Draws a [thickness] line along the node's bottom edge in [color] — the web `border-b`. */
private fun Modifier.bottomBorder(
    color: Color,
    thickness: Dp,
): Modifier =
    drawBehind {
        val stroke = thickness.toPx()
        val y = size.height - stroke / 2f
        drawLine(color = color, start = Offset(0f, y), end = Offset(size.width, y), strokeWidth = stroke)
    }

// ── Previews (tooling-only; sample chips are never shipped UI) ───────────────────────────────────────

private val PREVIEW_CHIPS: List<ChipView> =
    listOf(
        ChipView(id = "overview", label = "Overview", active = true),
        ChipView(id = "battery", label = "Battery", active = false),
        ChipView(id = "charging", label = "Charging", active = false),
        ChipView(id = "efficiency", label = "Efficiency", active = false),
    )

@Preview(name = "StickyChipBar — chips", showBackground = true)
@Composable
private fun StickyChipBarChipsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StickyChipBarContent(
            projection = StickyChipBarProjection.Resolved(PREVIEW_CHIPS),
            navLabel = "Quick navigation",
            emptyMessage = "No data available",
            onChipClick = {},
        )
    }
}

@Preview(name = "StickyChipBar — empty", showBackground = true)
@Composable
private fun StickyChipBarEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StickyChipBarContent(
            projection = StickyChipBarProjection.Empty,
            navLabel = "Quick navigation",
            emptyMessage = "No data available",
            onChipClick = {},
        )
    }
}
