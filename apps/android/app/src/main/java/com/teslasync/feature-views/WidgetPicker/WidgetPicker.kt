// The native Jetpack Compose + Material 3 WidgetPicker feature view — a parity port of
// web/src/features/dashboard/components/WidgetPicker.tsx. The web component is the dashboard's widget-catalogue
// drawer: a searchable, category-filtered catalogue over the static widget registry, plus a Recently-Added
// shortcut row, a Layout-Presets list, an add-all-per-group action, and a session footer summarizing what was
// added — opened from the dashboard and dismissed via its scrim/close.
//
// The web "drawer" (`@/components/ui` Drawer: a scrim-backed slide-in panel with a title and a conditional
// footer) maps on Android to a Material 3 [ModalBottomSheet] — the HIG-correct native idiom for a
// scrim-backed, swipe/tap-dismissable selection panel with a sticky header and footer. This mirrors the
// sibling AddWidgetButton port's decision to map a web pattern onto the first-class Material primitive rather
// than porting Tailwind chrome. The shared [Badge] / [Button] / [Input] map 1:1, the category pills use the
// shared [TabNav] (Material 3 FilterChip row), and the live-region announcement uses the same polite
// 1 dp semantics node the navigation `RouteAnnouncer` uses.
//
// The picker's only data source is `useTranslation` (mapped to the generated i18n catalog, P1/S10) — there is
// no query/fetch, so the loading / error / stale / offline states do not exist on this surface (the owning
// Dashboard page owns the dashboard query). The state-specific branches the web source defines are reproduced
// in full: the empty "no widgets match" result, the Recently-Added section (shown only when not searching or
// filtering), the Layout-Presets section (same gate), the searching-vs-grouped body, the per-widget
// already-added state, and the session footer. Every derivation flows through the pure
// [WidgetPickerProjection]; the composable is a thin render layer that records the one-shot `view.opened`
// diagnostic (P1/S11) and persists Recently-Added through the injected [WidgetPickerRecentStore].
//
// Two faithful platform adaptations are called out so they are not silent drift: (1) the web's hardware
// `Enter` (add the sole match) / `Escape` (clear) keyboard shortcuts are desktop affordances — the shared
// text field does not surface them, so the native interaction is tapping a card; the [WidgetPickerProjection]
// still models `singleAddableForEnter` for parity and tests. (2) The web auto-focuses the search field on
// open; the stateful surface requests focus too, but the stateless [WidgetPickerContent] (the test entry
// point) does not force the IME so per-state tests stay deterministic.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/feature-views/WidgetPicker) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")
@file:OptIn(ExperimentalMaterial3Api::class)

package io.teslasync.android.featureviews.widgetpicker

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.TabNav
import io.teslasync.android.components.ui.TabNavItem
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Elevation
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

private const val DISABLED_ALPHA = 0.45f
private const val ICON_WASH_ALPHA = 0.12f
private const val ALL_KEY = "all"

/**
 * The one PII-safe announcement the picker speaks through its live region: either a single widget's name or a
 * batch count, resolved to the localized string in the composable. Holds only the count and (for the single
 * case) the widget name — never any other state.
 */
private data class PendingAnnouncement(
    val count: Int,
    val widgetName: String?,
)

/**
 * Stateful entry point — the faithful 1:1 port of the web `WidgetPicker({ open, onClose, onAddWidgets,
 * onApplyPreset, activeWidgetIds })`. Owns the client-side search/filter/session/recently-added state, applies
 * the pure [WidgetPickerProjection], persists Recently-Added through [recentStore], records the one-shot
 * `view.opened` diagnostic, and renders the catalogue inside a Material 3 [ModalBottomSheet]. Renders nothing
 * when [open] is false (web `if (!open) return null`), which also resets all client state on the next open
 * because the remembered cells leave composition — matching the web's open-effect reset.
 *
 * @param open whether the drawer is shown (web `open`).
 * @param onClose dismiss request — scrim tap, swipe, or the header/footer close (web `onClose`).
 * @param onAddWidgets adds the given widget ids to the dashboard (web `onAddWidgets`).
 * @param onApplyPreset applies the preset by id and closes (web `onApplyPreset`).
 * @param activeWidgetIds ids already on the dashboard — shown as "Added" and excluded from add-all
 *   (web `activeWidgetIds`).
 * @param modifier host-supplied modifier for the sheet.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param recentStore persistence for Recently-Added; defaults to a session-scoped in-memory store.
 */
@Composable
fun WidgetPicker(
    open: Boolean,
    onClose: () -> Unit,
    onAddWidgets: (List<String>) -> Unit,
    onApplyPreset: (String) -> Unit,
    activeWidgetIds: List<String>,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    recentStore: WidgetPickerRecentStore? = null,
) {
    if (!open) return

    val store = recentStore ?: remember { InMemoryWidgetPickerRecentStore() }
    val byId = remember { widgetCatalog.associateBy { it.id } }
    val activeSet = remember(activeWidgetIds) { activeWidgetIds.toSet() }

    var search by remember { mutableStateOf("") }
    var categoryFilter by remember { mutableStateOf<WidgetCategory?>(null) }
    var addedThisSession by remember { mutableStateOf(emptySet<String>()) }
    var recentIds by remember { mutableStateOf(store.load()) }
    var pending by remember { mutableStateOf<PendingAnnouncement?>(null) }

    val focusRequester = remember { FocusRequester() }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    LaunchedEffect(Unit) {
        WidgetPickerDiagnostics.recordViewOpened(logger)
        runCatching { focusRequester.requestFocus() }
    }

    val input =
        WidgetPickerInput(
            search = search,
            categoryFilter = categoryFilter,
            activeWidgetIds = activeSet,
            recentlyAddedIds = recentIds,
            addedThisSessionIds = addedThisSession,
        )
    val view = remember(input) { WidgetPickerProjection.project(input) }

    fun applyAdd(requestedIds: List<String>) {
        val addable = WidgetPickerProjection.addableIds(requestedIds, activeSet)
        if (addable.isEmpty()) return
        onAddWidgets(addable)
        addedThisSession = addedThisSession + addable
        val next = WidgetPickerProjection.nextRecentlyAdded(recentIds, addable)
        recentIds = next
        store.save(next)
        pending =
            if (addable.size == 1) {
                PendingAnnouncement(1, byId[addable.first()]?.name)
            } else {
                PendingAnnouncement(addable.size, null)
            }
    }

    val announcementText =
        pending?.let { announcement ->
            if (announcement.count == 1 && announcement.widgetName != null) {
                stringResource(R.string.translation_widgets_addedAnnouncement, announcement.widgetName)
            } else {
                stringResource(R.string.translation_widgets_addedBatchAnnouncement, announcement.count)
            }
        } ?: ""

    ModalBottomSheet(onDismissRequest = onClose, sheetState = sheetState, modifier = modifier) {
        WidgetPickerContent(
            searchText = search,
            categoryFilter = categoryFilter,
            activeWidgetIds = activeSet,
            view = view,
            announcementText = announcementText,
            onSearchChange = { search = it },
            onSelectCategory = { categoryFilter = it },
            onAddWidget = { applyAdd(listOf(it.id)) },
            onAddAll = { applyAdd(it) },
            onApplyPreset = { presetId ->
                onApplyPreset(presetId)
                onClose()
            },
            onClose = onClose,
            searchFocusRequester = focusRequester,
        )
    }
}

/**
 * Stateless renderer — the unit/UI-test entry point. Reproduces the web drawer body: the title + close header,
 * the polite live region, the sticky search field and category pills, the Recently-Added and Layout-Presets
 * sections, the searching-vs-grouped catalogue (with its empty state), and the session footer. Holds no
 * business state; every interaction is forwarded to the caller. Host this inside a height-bounded container
 * (the [ModalBottomSheet] sheet, or a `fillMaxSize` test root) so the catalogue list can scroll under the
 * sticky header/footer.
 */
@Composable
internal fun WidgetPickerContent(
    searchText: String,
    categoryFilter: WidgetCategory?,
    activeWidgetIds: Set<String>,
    view: WidgetPickerView,
    announcementText: String,
    onSearchChange: (String) -> Unit,
    onSelectCategory: (WidgetCategory?) -> Unit,
    onAddWidget: (PickerWidget) -> Unit,
    onAddAll: (List<String>) -> Unit,
    onApplyPreset: (String) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    searchFocusRequester: FocusRequester? = null,
) {
    Column(modifier = modifier.fillMaxWidth().testTag(WidgetPickerRegistration.SHEET_TEST_TAG)) {
        WidgetPickerHeader(onClose = onClose)
        LiveRegion(text = announcementText)
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            WidgetPickerSearchBar(
                searchText = searchText,
                availableCount = view.availableCount,
                onSearchChange = onSearchChange,
                focusRequester = searchFocusRequester,
            )
            WidgetPickerCategoryPills(
                availableCategories = view.availableCategories,
                selected = categoryFilter,
                onSelectCategory = onSelectCategory,
            )
        }
        LazyColumn(
            modifier = Modifier.fillMaxWidth().weight(1f),
            contentPadding = PaddingValues(Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            recentlyAddedSection(
                widgets = view.recentlyAdded,
                query = view.query,
                isSearching = view.isSearching,
                activeWidgetIds = activeWidgetIds,
                onAddWidget = onAddWidget,
            )
            presetsSection(
                show = view.showPresets,
                presets = view.presets,
                onApplyPreset = onApplyPreset,
            )
            bodySection(
                view = view,
                activeWidgetIds = activeWidgetIds,
                onAddWidget = onAddWidget,
                onAddAll = onAddAll,
            )
        }
        if (view.addedThisSessionCount > 0) {
            WidgetPickerFooter(addedCount = view.addedThisSessionCount, onDone = onClose)
        }
    }
}

@Composable
private fun WidgetPickerHeader(onClose: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = Spacing.lg, end = Spacing.sm, bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SectionTitle(stringResource(R.string.translation_dashboard_addWidget), modifier = Modifier.weight(1f))
        IconButton(
            imageVector = TeslaGlyphs.Close,
            contentDescription = stringResource(R.string.translation_common_close),
            onClick = onClose,
            size = IconSize.Md,
        )
    }
}

@Composable
private fun WidgetPickerSearchBar(
    searchText: String,
    availableCount: Int,
    onSearchChange: (String) -> Unit,
    focusRequester: FocusRequester?,
) {
    val fieldModifier =
        Modifier
            .fillMaxWidth()
            .testTag(WidgetPickerRegistration.SEARCH_TEST_TAG)
            .let { base -> if (focusRequester != null) base.focusRequester(focusRequester) else base }
    Input(
        value = searchText,
        onValueChange = onSearchChange,
        modifier = fieldModifier,
        label = stringResource(R.string.translation_widgets_search),
        leadingIcon = WidgetPickerGlyphs.Search,
    )
    Caption(
        text = "$availableCount ${stringResource(R.string.translation_widgets_available)}",
        modifier = Modifier.padding(top = Spacing.xs),
    )
}

@Composable
private fun WidgetPickerCategoryPills(
    availableCategories: List<WidgetCategory>,
    selected: WidgetCategory?,
    onSelectCategory: (WidgetCategory?) -> Unit,
) {
    val allItem = TabNavItem(ALL_KEY, stringResource(R.string.translation_widgets_allCategories))
    val items = remember(availableCategories) { availableCategories.map { TabNavItem(it.token, it.label) } }
    val filterLabel = stringResource(R.string.translation_widgets_categoryFilter)
    TabNav(
        items = listOf(allItem) + items,
        selectedKey = selected?.token ?: ALL_KEY,
        onSelect = { key ->
            onSelectCategory(if (key == ALL_KEY) null else WidgetCategory.entries.firstOrNull { it.token == key })
        },
        modifier = Modifier.semantics { contentDescription = filterLabel },
    )
}

private fun LazyListScope.recentlyAddedSection(
    widgets: List<PickerWidget>,
    query: String,
    isSearching: Boolean,
    activeWidgetIds: Set<String>,
    onAddWidget: (PickerWidget) -> Unit,
) {
    if (widgets.isEmpty()) return
    item(key = "recent-header") {
        SectionHeading(
            text = stringResource(R.string.translation_widgets_recentlyAdded),
            leadingIcon = WidgetPickerGlyphs.Clock,
        )
    }
    items(widgets, key = { "recent-${it.id}" }) { widget ->
        WidgetCard(
            widget = widget,
            isAdded = widget.id in activeWidgetIds,
            query = query,
            isSearching = isSearching,
            onClick = { onAddWidget(widget) },
        )
    }
    item(key = "recent-divider") { SectionDivider() }
}

private fun LazyListScope.presetsSection(
    show: Boolean,
    presets: List<WidgetPreset>,
    onApplyPreset: (String) -> Unit,
) {
    if (!show) return
    item(key = "presets-header") {
        SectionHeading(text = stringResource(R.string.translation_dashboard_presets))
    }
    items(presets, key = { "preset-${it.id}" }) { preset ->
        PresetCard(preset = preset, onClick = { onApplyPreset(preset.id) })
    }
    item(key = "presets-divider") { SectionDivider() }
}

private fun LazyListScope.bodySection(
    view: WidgetPickerView,
    activeWidgetIds: Set<String>,
    onAddWidget: (PickerWidget) -> Unit,
    onAddAll: (List<String>) -> Unit,
) {
    val query = view.query
    val isSearching = view.isSearching
    when (val body = view.body) {
        is WidgetPickerBody.Empty ->
            item(key = "empty") {
                Text(
                    text = stringResource(R.string.translation_widgets_noResults, view.rawQuery),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xl2),
                )
            }

        is WidgetPickerBody.Results -> {
            if (body.showAddAll) {
                item(key = "results-header") {
                    ResultsHeader(
                        resultCount = body.widgets.size,
                        rawQuery = view.rawQuery,
                        addableCount = body.addableCount,
                        addableIds = body.widgets.filter { it.id !in activeWidgetIds }.map { it.id },
                        onAddAll = onAddAll,
                    )
                }
            }
            items(body.widgets, key = { "result-${it.id}" }) { widget ->
                WidgetCard(
                    widget = widget,
                    isAdded = widget.id in activeWidgetIds,
                    query = query,
                    isSearching = isSearching,
                    onClick = { onAddWidget(widget) },
                )
            }
        }

        is WidgetPickerBody.Grouped ->
            body.groups.forEach { group ->
                item(key = "group-${group.category.token}") {
                    GroupHeader(
                        category = group.category,
                        addableCount = group.addableCount,
                        addableIds = group.widgets.filter { it.id !in activeWidgetIds }.map { it.id },
                        onAddAll = onAddAll,
                    )
                }
                items(group.widgets, key = { "group-${group.category.token}-${it.id}" }) { widget ->
                    WidgetCard(
                        widget = widget,
                        isAdded = widget.id in activeWidgetIds,
                        query = query,
                        isSearching = isSearching,
                        onClick = { onAddWidget(widget) },
                    )
                }
            }
    }
}

@Composable
private fun ResultsHeader(
    resultCount: Int,
    rawQuery: String,
    addableCount: Int,
    addableIds: List<String>,
    onAddAll: (List<String>) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Caption(
            text = stringResource(R.string.translation_widgets_searchResults, resultCount, rawQuery),
            modifier = Modifier.weight(1f),
        )
        AddAllButton(addableCount = addableCount, addableIds = addableIds, onAddAll = onAddAll)
    }
}

@Composable
private fun GroupHeader(
    category: WidgetCategory,
    addableCount: Int,
    addableIds: List<String>,
    onAddAll: (List<String>) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SectionHeading(text = category.label, modifier = Modifier.weight(1f))
        AddAllButton(addableCount = addableCount, addableIds = addableIds, onAddAll = onAddAll)
    }
}

@Composable
private fun AddAllButton(
    addableCount: Int,
    addableIds: List<String>,
    onAddAll: (List<String>) -> Unit,
) {
    Button(
        label = stringResource(R.string.translation_widgets_addAllCount, addableCount),
        onClick = { onAddAll(addableIds) },
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
        enabled = addableCount > 0,
    )
}

@Composable
private fun WidgetCard(
    widget: PickerWidget,
    isAdded: Boolean,
    query: String,
    isSearching: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        enabled = !isAdded,
        modifier = Modifier.fillMaxWidth().testTag(WidgetPickerRegistration.WIDGET_TAG_PREFIX + widget.id),
        shape = RoundedCornerShape(Radius.lg),
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        tonalElevation = Elevation.raised,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md).alpha(if (isAdded) DISABLED_ALPHA else 1f),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            CardIcon(widget.category)
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    Text(
                        text = highlighted(widget.name, query),
                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                        color = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (isAdded) {
                        Badge(text = stringResource(R.string.translation_dashboard_added), variant = BadgeVariant.Neutral)
                    }
                }
                Text(
                    text = highlighted(widget.description, query),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    MetricLabel(WidgetPickerProjection.sizeLabel(widget))
                    if (isSearching) {
                        MetricLabel(widget.category.label)
                    }
                }
            }
        }
    }
}

@Composable
private fun CardIcon(category: WidgetCategory) {
    Surface(
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.primary.copy(alpha = ICON_WASH_ALPHA),
    ) {
        Icon(
            imageVector = WidgetPickerGlyphs.forCategory(category),
            contentDescription = null,
            modifier = Modifier.padding(Spacing.sm),
            size = IconSize.Md,
            tint = MaterialTheme.colorScheme.primary,
        )
    }
}

@Composable
private fun PresetCard(
    preset: WidgetPreset,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().testTag("dashboard-widget-picker-preset-" + preset.id),
        shape = RoundedCornerShape(Radius.lg),
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        tonalElevation = Elevation.raised,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Text(
                text = preset.name,
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                color = MaterialTheme.colorScheme.onSurface,
            )
            MetricLabel("${preset.widgetCount} ${stringResource(R.string.translation_dashboard_widgets)}")
        }
    }
}

@Composable
private fun WidgetPickerFooter(
    addedCount: Int,
    onDone: () -> Unit,
) {
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    Row(
        modifier = Modifier.fillMaxWidth().padding(Spacing.lg),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            modifier = Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = TeslaGlyphs.Check,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.success,
            )
            Text(
                text = pluralStringResource(R.plurals.translation_widgets_addedCount, addedCount, addedCount),
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
        Button(
            label = stringResource(R.string.translation_dashboard_done),
            onClick = onDone,
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
        )
    }
}

@Composable
private fun SectionHeading(
    text: String,
    modifier: Modifier = Modifier,
    leadingIcon: ImageVector? = null,
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leadingIcon != null) {
            Icon(
                imageVector = leadingIcon,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        MetricLabel(text)
    }
}

@Composable
private fun SectionDivider() {
    HorizontalDivider(
        modifier = Modifier.padding(vertical = Spacing.xs),
        color = MaterialTheme.colorScheme.outlineVariant,
    )
}

/**
 * The polite live region the picker uses to announce additions — the native analogue of the web
 * `VisuallyHidden liveRegion`. A visually-negligible node whose [contentDescription] is spoken by TalkBack
 * when it changes, without stealing focus (mirrors the navigation `RouteAnnouncer`).
 */
@Composable
private fun LiveRegion(text: String) {
    Box(
        modifier =
            Modifier
                .size(1.dp)
                .semantics {
                    liveRegion = LiveRegionMode.Polite
                    contentDescription = text
                },
    )
}

/** Builds the card text with the matched query span emphasized — the native analogue of web `highlightMatch`. */
@Composable
private fun highlighted(
    text: String,
    query: String,
): AnnotatedString {
    val spans = WidgetPickerProjection.highlight(text, query)
    val primary = MaterialTheme.colorScheme.primary
    return buildAnnotatedString {
        append(spans.before)
        if (spans.match.isNotEmpty()) {
            withStyle(SpanStyle(color = primary, fontWeight = FontWeight.SemiBold)) {
                append(spans.match)
            }
        }
        append(spans.after)
    }
}

// ── Previews (tooling-only; exercise the grouped and empty render branches) ───────────────────────
private val PREVIEW_CATALOG =
    listOf(
        PickerWidget("battery-gauge", "Battery Level", "Battery percentage with radial gauge", WidgetCategory.Battery, 1, 2),
        PickerWidget("charge-status", "Charge Status", "Current charge state, amps, time remaining", WidgetCategory.Charging, 2, 2),
        PickerWidget("location-map", "Vehicle Location Map", "Live map of vehicle position", WidgetCategory.Maps, 2, 4),
    )

@Preview(name = "WidgetPicker — grouped", showBackground = true)
@Composable
private fun WidgetPickerGroupedPreview() {
    val view = WidgetPickerProjection.project(WidgetPickerInput(), catalog = PREVIEW_CATALOG, presets = widgetPresets)
    TeslaSyncTheme(dynamicColor = false) {
        Box(modifier = Modifier.fillMaxWidth()) {
            WidgetPickerContent(
                searchText = "",
                categoryFilter = null,
                activeWidgetIds = setOf("battery-gauge"),
                view = view,
                announcementText = "",
                onSearchChange = {},
                onSelectCategory = {},
                onAddWidget = {},
                onAddAll = {},
                onApplyPreset = {},
                onClose = {},
            )
        }
    }
}
