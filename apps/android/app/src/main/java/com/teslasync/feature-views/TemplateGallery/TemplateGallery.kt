// The native Jetpack Compose + Material 3 TemplateGallery feature view — a parity port of
// web/src/features/dashboard/components/TemplateGallery.tsx. The web component is a `<Modal>` gallery of
// dashboard templates: a "Blank Dashboard" option (applies `__blank__`) plus a card per `DASHBOARD_PRESETS`
// entry. Each card shows a `MiniGridPreview` (the preset's widget layout), the localized name, a neutral
// widget-count `<Badge>`, the description, and up to five unique category icons (`useCategoryIcons`).
// Selecting a card opens an in-modal detail view: the larger preview, name, description, "{{count}} widgets",
// a two-column grid of the preset's widget icon+name rows, and "Back" / "Use This Template" buttons.
//
// This port keeps that contract end to end and performs NO HTTP. The template catalog is the built-in
// [DASHBOARD_PRESETS] (the native analogue of the web static constant); a host may instead supply it through
// the shared P1/S8 state-holder layer as a [UiState], so this view renders every lifecycle state that layer
// can produce — the web's content branch PLUS the loading skeleton, hard-error retry, friendly empty, and
// stale/offline "last known + retry" chrome the sibling surfaces standardize. The widget/category glyphs are
// authored 24dp vectors ([TemplateGalleryGlyphs]; Android bundles no lucide set), every string resolves
// through the i18n facade (P1/S10), and `MiniGridPreview` is reproduced inline as a fixed-height proportional
// grid (the idiomatic native rendering of the web's variable-aspect preview; the web detail view itself uses a
// fixed height).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TemplateGallery — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.templategallery

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.StaggerContainer
import io.teslasync.android.components.motion.StaggerItem
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.text.NumberFormat
import java.util.Locale

/** Em dash shown for an unknown freshness age — the shared freshness "no value" fallback. */
internal const val EM_DASH: String = "\u2014"

/** First-load skeleton card count so the surface is never blank while the catalog resolves. */
private const val SKELETON_COUNT: Int = 3

/** Description clamp — the web `line-clamp-2`. */
private const val DESCRIPTION_MAX_LINES: Int = 2

/** Neutral icon tile edge for the blank option (web `p-2.5` tile). */
private val ICON_TILE: Dp = 44.dp

/** Compact mini-grid preview height on a card (the idiomatic native rendering of the web aspect-ratio box). */
private val CARD_PREVIEW_HEIGHT: Dp = 120.dp

/** Larger mini-grid preview height in the detail view (web `h-48`). */
private val DETAIL_PREVIEW_HEIGHT: Dp = 184.dp

/** Inter-cell gap inside the mini-grid preview (web cell `padding: 2px`, scaled). */
private val TILE_GAP: Dp = 1.dp

/** Low-alpha wash behind a mini-grid cell / icon tile (web `bg-white/[0.06]`). */
private const val TILE_FILL_ALPHA: Float = 0.06f

/** Mini-grid cell border alpha (web `border-white/[0.08]`). */
private const val TILE_BORDER_ALPHA: Float = 0.10f

/** Mini-grid container fill alpha (web `bg-white/[0.02]`). */
private const val PREVIEW_BG_ALPHA: Float = 0.03f

/** Category-icon chip wash alpha (web `bg-white/[0.04]`). */
private const val CATEGORY_TILE_ALPHA: Float = 0.06f

/** Skeleton bar widths for the loading card. */
private const val SKELETON_TITLE_FRACTION: Float = 0.5f
private const val SKELETON_DESC_FRACTION: Float = 0.9f

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10): the modal [galleryTitle]
 * / [detailTitle], the [blankName] + [blankDescription] of the blank option, the [apply] / [back] / [close]
 * button labels, the [empty] message, the "{{count}} widgets" [widgetCountLabel] + the card's bare
 * [countValue], and the per-preset [nameFor] / [descriptionFor] resolvers (web `t('templates.<id>.…', …)`).
 */
data class TemplateGalleryStrings(
    val galleryTitle: String,
    val detailTitle: String,
    val blankName: String,
    val blankDescription: String,
    val apply: String,
    val back: String,
    val close: String,
    val empty: String,
    val widgetCountLabel: (Int) -> String,
    val countValue: (Int) -> String,
    val nameFor: (id: String, fallback: String) -> String,
    val descriptionFor: (id: String) -> String?,
)

/**
 * Stateful entry point for the template gallery modal. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) on open, owns the in-modal gallery↔detail selection, and renders every lifecycle [state] the host's
 * template feed (P1/S8) can carry. The host owns the feed and the apply/close actions; this view never
 * performs HTTP. Render it unconditionally — the [open] gate mirrors the web `open` prop.
 *
 * @param open whether the modal is shown (web `open`).
 * @param onClose dismisses the modal (web `onClose`), after clearing any detail selection.
 * @param onApply applies a preset id, or [BLANK_PRESET_ID] for the blank option (web `onApply`).
 * @param state the cache-then-network projection of the template catalog; defaults are supplied by the
 *   web-parity overload.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun TemplateGallery(
    open: Boolean,
    onClose: () -> Unit,
    onApply: (presetId: String) -> Unit,
    state: UiState<List<DashboardTemplateData>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    if (!open) return
    LaunchedEffect(Unit) { recordTemplateGalleryOpened(logger) }
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }
    val strings = rememberTemplateGalleryStrings()
    Modal(
        onDismissRequest = {
            selectedId = null
            onClose()
        },
        modifier = modifier,
        title = if (selectedId == null) strings.galleryTitle else strings.detailTitle,
        closeLabel = strings.close,
    ) {
        TemplateGalleryContent(
            state = state,
            selectedId = selectedId,
            onSelect = { selectedId = it },
            onApply = { presetId ->
                onApply(presetId)
                selectedId = null
            },
            onBack = { selectedId = null },
            onRetry = onRetry,
            strings = strings,
        )
    }
}

/**
 * Web-parity overload mirroring the web component, which reads the static `DASHBOARD_PRESETS` constant. Wraps
 * the built-in [templates] catalog as a loaded [UiState] (empty → [UiPhase.Empty]); there is no fetch behind
 * it, so it offers no retry affordance.
 */
@Composable
fun TemplateGallery(
    open: Boolean,
    onClose: () -> Unit,
    onApply: (presetId: String) -> Unit,
    modifier: Modifier = Modifier,
    templates: List<DashboardTemplateData> = DASHBOARD_PRESETS,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(templates) {
            UiState(
                phase = if (templates.isEmpty()) UiPhase.Empty else UiPhase.Content,
                data = templates,
            )
        }
    TemplateGallery(
        open = open,
        onClose = onClose,
        onApply = onApply,
        state = state,
        onRetry = {},
        modifier = modifier,
        logger = logger,
    )
}

/**
 * Stateless renderer for the modal body — the unit/UI-test entry point. Reproduces the web gallery↔detail
 * branches and adds the lifecycle chrome the host's feed implies: a first-load skeleton, a hard-error retry
 * surface, a friendly empty state (the blank option always remains available), and a freshness chip that
 * reflects refreshing / stale / offline. Stale (non-error) data auto-refreshes, mirroring the freshness
 * contract the sibling surfaces use.
 *
 * @param selectedId the selected preset id (web `selectedId`), or `null` for the gallery grid.
 * @param onSelect opens a preset's detail view (web `setSelectedId`).
 * @param onApply applies a preset id / [BLANK_PRESET_ID] (web `onApply` / `handleApply`).
 * @param onBack returns from detail to the gallery (web `setSelectedId(null)`).
 */
@Composable
fun TemplateGalleryContent(
    state: UiState<List<DashboardTemplateData>>,
    selectedId: String?,
    onSelect: (String) -> Unit,
    onApply: (String) -> Unit,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    strings: TemplateGalleryStrings = rememberTemplateGalleryStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val result = remember(state.data) { TemplateGalleryProjection.project(state.data ?: emptyList()) }
    val selected = remember(result, selectedId) { selectedId?.let { id -> result.templates.find { it.id == id } } }
    val showFreshness = state.stale || state.refreshing || state.hasError

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        when {
            state.isLoading -> TemplateGalleryLoading()
            state.isError -> TemplateGalleryError(onRetry = onRetry)
            selected != null -> {
                if (showFreshness) TemplateGalleryFreshnessRow(state)
                TemplateDetail(
                    template = selected,
                    strings = strings,
                    onApply = { onApply(selected.id) },
                    onBack = onBack,
                )
            }
            else -> {
                if (showFreshness) TemplateGalleryFreshnessRow(state)
                TemplateGalleryGrid(
                    result = result,
                    strings = strings,
                    onSelectBlank = { onApply(BLANK_PRESET_ID) },
                    onSelectTemplate = onSelect,
                )
            }
        }
    }
}

/**
 * The populated gallery — the web `<StaggerContainer>` of the blank option followed by the preset cards. The
 * native [StaggerContainer] is a single column (the web mobile-baseline `grid-cols-1`), the idiomatic phone
 * layout. When no presets resolved, a friendly empty state follows the always-present blank option so the
 * surface is never a blank box.
 */
@Composable
private fun TemplateGalleryGrid(
    result: TemplateGalleryProjectionResult,
    strings: TemplateGalleryStrings,
    onSelectBlank: () -> Unit,
    onSelectTemplate: (String) -> Unit,
) {
    FadeIn(modifier = Modifier.fillMaxWidth()) {
        StaggerContainer(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            StaggerItem(index = 0) { BlankTemplateCard(strings = strings, onClick = onSelectBlank) }
            if (result.isEmpty) {
                StaggerItem(index = 1) { TemplateGalleryEmpty(message = strings.empty) }
            } else {
                result.templates.forEachIndexed { index, template ->
                    StaggerItem(index = index + 1) {
                        TemplateCard(
                            template = template,
                            strings = strings,
                            onClick = { onSelectTemplate(template.id) },
                        )
                    }
                }
            }
        }
    }
}

/** The "start from scratch" option — the web dashed blank card that applies [BLANK_PRESET_ID]. */
@Composable
private fun BlankTemplateCard(
    strings: TemplateGalleryStrings,
    onClick: () -> Unit,
) {
    GlassPanel(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) { role = Role.Button }
                .clickable(onClick = onClick),
        padding = PanelPadding.Lg,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconTile(icon = GridGlyph)
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Heading(text = strings.blankName, level = HeadingLevel.Panel, maxLines = 1)
                Caption(strings.blankDescription)
            }
        }
    }
}

/**
 * One template card — the web `TemplateCard`. The mini-grid preview, the truncated name, a neutral
 * widget-count badge, the two-line description, and up to five category icons. The whole card is a single
 * accessible button (merged descendants) wired to [onClick] (web `setSelectedId`).
 */
@Composable
private fun TemplateCard(
    template: TemplateProjection,
    strings: TemplateGalleryStrings,
    onClick: () -> Unit,
) {
    GlassPanel(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) { role = Role.Button }
                .clickable(onClick = onClick),
        padding = PanelPadding.Md,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            MiniGridPreview(grid = template.miniGrid, height = CARD_PREVIEW_HEIGHT)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Heading(
                    text = strings.nameFor(template.id, template.name),
                    level = HeadingLevel.Panel,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                )
                Badge(text = strings.countValue(template.widgetCount), variant = BadgeVariant.Neutral)
            }
            strings.descriptionFor(template.id)?.let { description ->
                BodyText(
                    description,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = DESCRIPTION_MAX_LINES,
                )
            }
            if (template.categoryIcons.isNotEmpty()) {
                CategoryIconRow(icons = template.categoryIcons)
            }
        }
    }
}

/** The row of unique category icons on a card — the web `useCategoryIcons` chips. Decorative for a11y. */
@Composable
private fun CategoryIconRow(icons: List<CategoryIcon>) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        icons.forEach { entry ->
            Box(
                modifier =
                    Modifier
                        .clip(RoundedCornerShape(Radius.sm))
                        .background(MaterialTheme.colorScheme.onSurface.copy(alpha = CATEGORY_TILE_ALPHA))
                        .padding(Spacing.xs),
            ) {
                Icon(
                    glyphFor(entry.icon),
                    contentDescription = null,
                    size = IconSize.Xs,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/**
 * The selected-template detail view — the web `TemplateDetail`. The larger preview, name, description,
 * "{{count}} widgets", the two-column widget icon+name grid, and the Back / Use This Template actions.
 */
@Composable
private fun TemplateDetail(
    template: TemplateProjection,
    strings: TemplateGalleryStrings,
    onApply: () -> Unit,
    onBack: () -> Unit,
) {
    FadeIn(modifier = Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            MiniGridPreview(grid = template.miniGrid, height = DETAIL_PREVIEW_HEIGHT)
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Heading(text = strings.nameFor(template.id, template.name), level = HeadingLevel.Section)
                strings.descriptionFor(template.id)?.let { description ->
                    BodyText(description, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Caption(strings.widgetCountLabel(template.widgetCount))
            }
            if (template.widgets.isNotEmpty()) {
                WidgetChipGrid(widgets = template.widgets)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Button(
                    label = strings.back,
                    onClick = onBack,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                    leadingIcon = ArrowLeftGlyph,
                )
                Button(
                    label = strings.apply,
                    onClick = onApply,
                    variant = ButtonVariant.Primary,
                    size = ButtonSize.Sm,
                    leadingIcon = SparklesGlyph,
                )
            }
        }
    }
}

/** The detail view's two-column widget grid — the web `grid grid-cols-2`. Odd counts get a trailing spacer. */
@Composable
private fun WidgetChipGrid(widgets: List<WidgetProjection>) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        widgets.chunked(2).forEach { pair ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                pair.forEach { widget -> WidgetChip(widget = widget, modifier = Modifier.weight(1f)) }
                if (pair.size == 1) Spacer(modifier = Modifier.weight(1f))
            }
        }
    }
}

/** One widget row in the detail grid — the web icon + truncated name chip. */
@Composable
private fun WidgetChip(
    widget: WidgetProjection,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(Radius.md)
    Row(
        modifier =
            modifier
                .clip(shape)
                .background(MaterialTheme.colorScheme.onSurface.copy(alpha = PREVIEW_BG_ALPHA))
                .border(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = TILE_BORDER_ALPHA), shape)
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            glyphFor(widget.icon),
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        BodyText(
            widget.name,
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
        )
    }
}

/**
 * The inline mini-grid preview — the native rendering of the web `MiniGridPreview`. Tiles are positioned
 * proportionally within a fixed-[height] box (the idiomatic native take on the web's variable aspect-ratio
 * box; the web detail view likewise pins a height), each tile drawn at its grid-cell fraction of
 * [MiniGridProjection.cols] × [MiniGridProjection.maxY], carrying the widget's glyph (or nothing for an
 * unknown widget id).
 */
@Composable
private fun MiniGridPreview(
    grid: MiniGridProjection,
    height: Dp,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(Radius.md)
    val cellShape = RoundedCornerShape(Radius.sm)
    val cellFill = MaterialTheme.colorScheme.onSurface.copy(alpha = TILE_FILL_ALPHA)
    val cellBorder = MaterialTheme.colorScheme.onSurface.copy(alpha = TILE_BORDER_ALPHA)
    BoxWithConstraints(
        modifier =
            modifier
                .fillMaxWidth()
                .height(height)
                .clip(shape)
                .background(MaterialTheme.colorScheme.onSurface.copy(alpha = PREVIEW_BG_ALPHA))
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape),
    ) {
        val cellWidth = maxWidth / grid.cols.coerceAtLeast(1)
        val cellHeight = maxHeight / grid.maxY.coerceAtLeast(1)
        grid.tiles.forEach { tile ->
            Box(
                modifier =
                    Modifier
                        .offset(x = cellWidth * tile.x, y = cellHeight * tile.y)
                        .size(width = cellWidth * tile.w, height = cellHeight * tile.h)
                        .padding(TILE_GAP),
            ) {
                Box(
                    modifier =
                        Modifier
                            .fillMaxSize()
                            .clip(cellShape)
                            .background(cellFill)
                            .border(1.dp, cellBorder, cellShape),
                    contentAlignment = Alignment.Center,
                ) {
                    tile.icon?.let { icon ->
                        Icon(
                            glyphFor(icon),
                            contentDescription = null,
                            size = IconSize.Xs,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

/** Neutral icon tile for the blank option (web `rounded-lg p-2.5 bg-white/[0.04]`), token-resolved. */
@Composable
private fun IconTile(icon: ImageVector) {
    val shape = RoundedCornerShape(Radius.md)
    Box(
        modifier =
            Modifier
                .size(ICON_TILE)
                .clip(shape)
                .background(MaterialTheme.colorScheme.onSurface.copy(alpha = CATEGORY_TILE_ALPHA)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, size = IconSize.Lg, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** First-load skeleton grid so the surface is never blank while the catalog resolves. */
@Composable
private fun TemplateGalleryLoading() {
    val loadingLabel = stringResource(R.string.translation_common_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(SKELETON_COUNT) { TemplateCardSkeleton() }
    }
}

/** Loading shape for one template card — a preview block over a title and description line. */
@Composable
private fun TemplateCardSkeleton() {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Skeleton(height = CARD_PREVIEW_HEIGHT)
            Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = 16.dp)
            Skeleton(widthFraction = SKELETON_DESC_FRACTION, height = 12.dp)
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun TemplateGalleryError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Friendly empty state shown when the catalog resolved with no templates, so the surface is never blank. */
@Composable
private fun TemplateGalleryEmpty(message: String) {
    EmptyState(message = message, icon = GridGlyph, modifier = Modifier.fillMaxWidth())
}

/**
 * The freshness chip rendered above the body when cached data is refreshing / stale / offline — the honest
 * "last known + retry" affordance the sibling surfaces standardize.
 */
@Composable
private fun TemplateGalleryFreshnessRow(state: UiState<*>) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.xs),
        horizontalArrangement = Arrangement.End,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberTemplateFreshnessFormatter(),
        )
    }
}

/**
 * Builds the localized [TemplateGalleryStrings] from the i18n catalog (P1/S10). The template chrome + per-preset
 * name/description resolve from the app-owned `template_gallery_strings.xml` (the web `templates.*` keys are
 * i18next fallbacks with no catalog entry; see that file's header), and "Back" reuses the real catalog key.
 */
@Composable
private fun rememberTemplateGalleryStrings(): TemplateGalleryStrings {
    val galleryTitle = stringResource(R.string.template_gallery_title)
    val detailTitle = stringResource(R.string.template_gallery_detail)
    val blankName = stringResource(R.string.template_gallery_blank)
    val blankDescription = stringResource(R.string.template_gallery_blank_desc)
    val apply = stringResource(R.string.template_gallery_apply)
    val back = stringResource(R.string.translation_common_back)
    val close = stringResource(R.string.translation_common_close)
    val empty = stringResource(R.string.template_gallery_empty)
    val widgetCountTemplate = stringResource(R.string.template_gallery_widget_count)
    val names = templateNames()
    val descriptions = templateDescriptions()
    return remember(
        galleryTitle,
        detailTitle,
        blankName,
        blankDescription,
        apply,
        back,
        close,
        empty,
        widgetCountTemplate,
        names,
        descriptions,
    ) {
        TemplateGalleryStrings(
            galleryTitle = galleryTitle,
            detailTitle = detailTitle,
            blankName = blankName,
            blankDescription = blankDescription,
            apply = apply,
            back = back,
            close = close,
            empty = empty,
            widgetCountLabel = { count -> widgetCountTemplate.format(groupedCount(count)) },
            countValue = { count -> groupedCount(count) },
            nameFor = { id, fallback -> names[id] ?: fallback },
            descriptionFor = { id -> descriptions[id] },
        )
    }
}

/** The localized preset display names, keyed by preset id (web `t('templates.<id>.name', …)` fallbacks). */
@Composable
private fun templateNames(): Map<String, String> =
    mapOf(
        "default" to stringResource(R.string.template_gallery_name_default),
        "commuter" to stringResource(R.string.template_gallery_name_commuter),
        "fleet_manager" to stringResource(R.string.template_gallery_name_fleet_manager),
        "data_nerd" to stringResource(R.string.template_gallery_name_data_nerd),
        "charging_focus" to stringResource(R.string.template_gallery_name_charging_focus),
        "security_monitor" to stringResource(R.string.template_gallery_name_security_monitor),
        "road_trip" to stringResource(R.string.template_gallery_name_road_trip),
        "performance" to stringResource(R.string.template_gallery_name_performance),
        "kiosk_wall" to stringResource(R.string.template_gallery_name_kiosk_wall),
        "minimal" to stringResource(R.string.template_gallery_name_minimal),
    )

/** The localized preset descriptions, keyed by preset id (web `TEMPLATE_DESCRIPTIONS` fallbacks). */
@Composable
private fun templateDescriptions(): Map<String, String> =
    mapOf(
        "default" to stringResource(R.string.template_gallery_desc_default),
        "commuter" to stringResource(R.string.template_gallery_desc_commuter),
        "fleet_manager" to stringResource(R.string.template_gallery_desc_fleet_manager),
        "data_nerd" to stringResource(R.string.template_gallery_desc_data_nerd),
        "charging_focus" to stringResource(R.string.template_gallery_desc_charging_focus),
        "security_monitor" to stringResource(R.string.template_gallery_desc_security_monitor),
        "road_trip" to stringResource(R.string.template_gallery_desc_road_trip),
        "performance" to stringResource(R.string.template_gallery_desc_performance),
        "kiosk_wall" to stringResource(R.string.template_gallery_desc_kiosk_wall),
        "minimal" to stringResource(R.string.template_gallery_desc_minimal),
    )

/** Groups [count] per the active locale for display in the badge and "{{count}} widgets" label. */
private fun groupedCount(count: Int): String = NumberFormat.getIntegerInstance(Locale.getDefault()).format(count.toLong())

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberTemplateFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(age.value)
                is FreshnessAge.Minutes -> minutes.format(age.value)
                is FreshnessAge.Hours -> hours.format(age.value)
                is FreshnessAge.Days -> days.format(age.value)
                is FreshnessAge.Weeks -> weeks.format(age.value)
            }
        }
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ─────────────────────────────

private val PREVIEW_STRINGS =
    TemplateGalleryStrings(
        galleryTitle = "Dashboard Templates",
        detailTitle = "Template Preview",
        blankName = "Blank Dashboard",
        blankDescription = "Start from scratch and add widgets manually",
        apply = "Use This Template",
        back = "Back",
        close = "Close",
        empty = "No dashboard templates available",
        widgetCountLabel = { "$it widgets" },
        countValue = { "$it" },
        nameFor = { _, fallback -> fallback },
        descriptionFor = { "Balanced overview of vehicle status, battery, climate, and recent drives" },
    )

@Preview(name = "Gallery", showBackground = true)
@Composable
private fun TemplateGalleryGalleryPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TemplateGalleryContent(
            state = UiState(UiPhase.Content, data = DASHBOARD_PRESETS),
            selectedId = null,
            onSelect = {},
            onApply = {},
            onBack = {},
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Detail", showBackground = true)
@Composable
private fun TemplateGalleryDetailPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TemplateGalleryContent(
            state = UiState(UiPhase.Content, data = DASHBOARD_PRESETS),
            selectedId = "charging_focus",
            onSelect = {},
            onApply = {},
            onBack = {},
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun TemplateGalleryLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TemplateGalleryContent(
            state = UiState(UiPhase.Loading),
            selectedId = null,
            onSelect = {},
            onApply = {},
            onBack = {},
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun TemplateGalleryEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TemplateGalleryContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            selectedId = null,
            onSelect = {},
            onApply = {},
            onBack = {},
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun TemplateGalleryErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TemplateGalleryContent(
            state = UiState(UiPhase.Error),
            selectedId = null,
            onSelect = {},
            onApply = {},
            onBack = {},
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}
