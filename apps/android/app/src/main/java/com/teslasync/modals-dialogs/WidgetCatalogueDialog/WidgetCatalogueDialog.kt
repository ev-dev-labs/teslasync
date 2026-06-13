// The native Jetpack Compose + Material 3 WidgetCatalogueDialog surface — a parity port of
// web/src/features/dashboard/components/WidgetCatalogueDialog.tsx. The web component is a discoverable,
// category-grouped widget picker dialog: it lists every widget in the registry grouped by category, badges the
// ones already on the dashboard as "Added" (and disables their add action), filters as the operator types over
// name / description / id / translated category label, and on a pick calls `onAdd(widgetId)` then closes.
//
// The web `<Modal size="full">` maps to the shared Material 3 [Modal] (a scrim-backed Compose Dialog with a
// titled header + close affordance and a scrollable body) — the HIG-correct native idiom, exactly as the
// sibling FeedbackModal port maps the same web Modal. The shared [Input] / [Button] / [Badge] / [GlassPanel] /
// [IconBox] map 1:1; the per-category card glyph reuses the sibling [WidgetPickerGlyphs] (the documented native
// stand-in for the registry's per-widget lucide icons), and the category header shows the web `CATEGORY_EMOJI`.
//
// The dialog's only data source is `useTranslation` (mapped to the generated i18n catalog, P1/S10) — there is
// no query/fetch, so the loading / error / stale / offline states do not exist on this surface (the owning
// Dashboard page owns the dashboard query). The state-specific branches the web source defines are reproduced
// in full: the grouped catalogue, the searching subset, the empty "no widgets match" panel, and the per-widget
// already-added state. Every derivation flows through the pure [WidgetCatalogueProjection]; the composable is a
// thin render layer that records the one-shot `view.opened` diagnostic (P1/S11) and converts each keystroke
// into a re-projection.
//
// Two faithful platform adaptations are called out so they are not silent drift: (1) the web dialog auto-focuses
// the search field on open via a deferred `setTimeout` + ref; the stateful surface requests focus too, but the
// stateless [WidgetCatalogueDialogContent] (the test entry point) does not force the IME so per-state tests stay
// deterministic. (2) The web grid (`grid-cols-1 sm:grid-cols-2`) becomes a single-column card list — the native
// idiom inside the Modal's already-scrolling body (a nested vertical lazy list would fight the outer scroll).
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/modals-dialogs) cannot form a valid Kotlin package, so the package intentionally diverges from
// the path. `MatchingDeclarationName` is suppressed for the co-located supporting composables.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.widgetcataloguedialog

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxSize
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.widgetpicker.PickerWidget
import io.teslasync.android.featureviews.widgetpicker.WidgetCategory
import io.teslasync.android.featureviews.widgetpicker.WidgetPickerGlyphs
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Elevation
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point — the faithful 1:1 port of the web
 * `WidgetCatalogueDialog({ open, onClose, onAdd, activeWidgetIds })`. Owns the client-side search query, applies
 * the pure [WidgetCatalogueProjection], records the one-shot `view.opened` diagnostic, requests focus on the
 * search field, and renders the catalogue inside the shared [Modal]. Renders nothing when [open] is false (web
 * `if (!open) return null` via the Modal's `open` prop), which also resets the query on the next open because
 * the remembered cells leave composition — matching the web open-effect reset (`setQuery('')`).
 *
 * @param open whether the dialog is shown (web `open`).
 * @param onClose dismiss request — scrim tap, system back, the header close, or after a successful add (web `onClose`).
 * @param onAdd adds the picked widget id to the dashboard; the dialog closes after invoking (web `onAdd`).
 * @param activeWidgetIds ids already on the dashboard — shown as "Added" and excluded from re-adding (web `activeWidgetIds`).
 * @param modifier host-supplied modifier for the dialog surface.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun WidgetCatalogueDialog(
    open: Boolean,
    onClose: () -> Unit,
    onAdd: (String) -> Unit,
    activeWidgetIds: List<String>,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    if (!open) return

    val activeSet = remember(activeWidgetIds) { activeWidgetIds.toSet() }
    var query by remember { mutableStateOf("") }
    val focusRequester = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        WidgetCatalogueDialogDiagnostics.recordViewOpened(logger)
        runCatching { focusRequester.requestFocus() }
    }

    val categoryLabels = resolveCategoryLabels()
    val view =
        WidgetCatalogueProjection.project(
            WidgetCatalogueInput(query = query, activeWidgetIds = activeSet, categoryLabels = categoryLabels),
        )
    val title = stringResource(R.string.translation_dashboard_catalogue_title)

    Modal(
        onDismissRequest = onClose,
        modifier = modifier,
        title = title,
        accessibleName = title,
        closeLabel = stringResource(R.string.translation_common_close),
    ) {
        WidgetCatalogueDialogContent(
            query = query,
            view = view,
            activeWidgetIds = activeSet,
            categoryLabels = categoryLabels,
            onQueryChange = { query = it },
            onClearSearch = { query = "" },
            onAddWidget = { widget ->
                if (widget.id !in activeSet) {
                    onAdd(widget.id)
                    onClose()
                }
            },
            searchFocusRequester = focusRequester,
        )
    }
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Reproduces the web dialog body: the subtitle
 * with the added/total counts, the search field, the live result-count line (only while filtering), and then
 * either the empty "no widgets match" panel or the category sections of widget cards. Holds no business state;
 * every interaction is forwarded to the caller.
 */
@Composable
internal fun WidgetCatalogueDialogContent(
    query: String,
    view: WidgetCatalogueView,
    activeWidgetIds: Set<String>,
    categoryLabels: Map<WidgetCategory, String>,
    onQueryChange: (String) -> Unit,
    onClearSearch: () -> Unit,
    onAddWidget: (PickerWidget) -> Unit,
    modifier: Modifier = Modifier,
    searchFocusRequester: FocusRequester? = null,
) {
    Column(
        modifier = modifier.fillMaxWidth().testTag(WidgetCatalogueDialogRegistration.DIALOG_TEST_TAG),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            HelperText(
                stringResource(
                    R.string.translation_dashboard_catalogue_subtitle,
                    view.addedCount,
                    view.totalCount,
                ),
            )
            CatalogueSearchField(
                query = query,
                onQueryChange = onQueryChange,
                focusRequester = searchFocusRequester,
            )
            if (view.isFiltering) {
                Caption(
                    text =
                        stringResource(
                            R.string.translation_dashboard_catalogue_resultCount,
                            view.visibleCount,
                            view.totalCount,
                        ),
                    modifier =
                        Modifier
                            .testTag(WidgetCatalogueDialogRegistration.RESULT_COUNT_TEST_TAG)
                            .semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
        }

        when (val body = view.body) {
            is WidgetCatalogueBody.Empty -> CatalogueEmptyPanel(total = view.totalCount, onClearSearch = onClearSearch)
            is WidgetCatalogueBody.Sections ->
                body.groups.forEach { group ->
                    CatalogueCategorySection(
                        group = group,
                        label = categoryLabels[group.category] ?: group.category.label,
                        activeWidgetIds = activeWidgetIds,
                        onAddWidget = onAddWidget,
                    )
                }
        }
    }
}

/** Resolves the 16 localized category labels (web `dashboard.catalogue.category.{cat}`) into a map. */
@Composable
private fun resolveCategoryLabels(): Map<WidgetCategory, String> =
    mapOf(
        WidgetCategory.Vehicle to stringResource(R.string.translation_dashboard_catalogue_category_vehicle),
        WidgetCategory.Battery to stringResource(R.string.translation_dashboard_catalogue_category_battery),
        WidgetCategory.Energy to stringResource(R.string.translation_dashboard_catalogue_category_energy),
        WidgetCategory.Driving to stringResource(R.string.translation_dashboard_catalogue_category_driving),
        WidgetCategory.Charging to stringResource(R.string.translation_dashboard_catalogue_category_charging),
        WidgetCategory.Climate to stringResource(R.string.translation_dashboard_catalogue_category_climate),
        WidgetCategory.Tires to stringResource(R.string.translation_dashboard_catalogue_category_tires),
        WidgetCategory.Security to stringResource(R.string.translation_dashboard_catalogue_category_security),
        WidgetCategory.Commands to stringResource(R.string.translation_dashboard_catalogue_category_commands),
        WidgetCategory.Media to stringResource(R.string.translation_dashboard_catalogue_category_media),
        WidgetCategory.Telemetry to stringResource(R.string.translation_dashboard_catalogue_category_telemetry),
        WidgetCategory.Analytics to stringResource(R.string.translation_dashboard_catalogue_category_analytics),
        WidgetCategory.Alerts to stringResource(R.string.translation_dashboard_catalogue_category_alerts),
        WidgetCategory.Automations to stringResource(R.string.translation_dashboard_catalogue_category_automations),
        WidgetCategory.System to stringResource(R.string.translation_dashboard_catalogue_category_system),
        WidgetCategory.Maps to stringResource(R.string.translation_dashboard_catalogue_category_maps),
    )

/**
 * The search field — web `<Input type="search">` with a leading Search icon, a visible prompt, and a separate
 * aria-label. The visible floating label carries the long web prompt; the short web aria-label is exposed to
 * assistive tech via a content description so screen readers announce "Search widgets".
 */
@Composable
private fun CatalogueSearchField(
    query: String,
    onQueryChange: (String) -> Unit,
    focusRequester: FocusRequester?,
) {
    val searchLabel = stringResource(R.string.translation_dashboard_catalogue_searchLabel)
    val fieldModifier =
        Modifier
            .fillMaxWidth()
            .testTag(WidgetCatalogueDialogRegistration.SEARCH_TEST_TAG)
            .semantics { contentDescription = searchLabel }
            .let { base -> if (focusRequester != null) base.focusRequester(focusRequester) else base }
    Input(
        value = query,
        onValueChange = onQueryChange,
        modifier = fieldModifier,
        label = stringResource(R.string.translation_dashboard_catalogue_searchPlaceholder), // parity:allow i18n key name
        leadingIcon = WidgetPickerGlyphs.Search,
    )
}

/**
 * The empty result — web's bordered "No widgets match your search" panel with a body line and a Clear-search
 * action. Always rendered (never a blank box) when a search yields no matches.
 */
@Composable
private fun CatalogueEmptyPanel(
    total: Int,
    onClearSearch: () -> Unit,
) {
    GlassPanel(
        modifier = Modifier.fillMaxWidth().testTag(WidgetCatalogueDialogRegistration.EMPTY_TEST_TAG),
        padding = PanelPadding.Lg,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            BodyText(stringResource(R.string.translation_dashboard_catalogue_emptyTitle))
            Caption(stringResource(R.string.translation_dashboard_catalogue_emptyBody, total))
            Button(
                label = stringResource(R.string.translation_dashboard_catalogue_clearSearch),
                onClick = onClearSearch,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                modifier = Modifier.testTag(WidgetCatalogueDialogRegistration.CLEAR_SEARCH_TEST_TAG),
            )
        }
    }
}

/** One category section — the web `<section>` with its emoji + translated label + count header over the cards. */
@Composable
private fun CatalogueCategorySection(
    group: WidgetCatalogueGroup,
    label: String,
    activeWidgetIds: Set<String>,
    onAddWidget: (PickerWidget) -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .testTag(WidgetCatalogueDialogRegistration.CATEGORY_TAG_PREFIX + group.category.token),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            modifier = Modifier.semantics { heading() },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Text(text = categoryEmoji(group.category))
            Caption(text = label)
            Caption(text = "(${group.widgets.size})")
        }
        group.widgets.forEach { widget ->
            CatalogueWidgetCard(
                widget = widget,
                isAdded = widget.id in activeWidgetIds,
                onAdd = { onAddWidget(widget) },
            )
        }
    }
}

/**
 * One widget entry card — web's bordered row of icon + name (+ "Added" badge) + description + Add button. The
 * Add action carries the web `aria-label` ("Add {name} widget") as its content description, is disabled when
 * the widget is already on the dashboard, and flips its visible label to "Added".
 */
@Composable
private fun CatalogueWidgetCard(
    widget: PickerWidget,
    isAdded: Boolean,
    onAdd: () -> Unit,
) {
    val addedLabel = stringResource(R.string.translation_dashboard_added)
    val addLabel = stringResource(R.string.translation_dashboard_catalogue_add)
    val addContentDescription = stringResource(R.string.translation_dashboard_catalogue_addLabel, widget.name)
    Surface(
        modifier =
            Modifier
                .fillMaxWidth()
                .testTag(WidgetCatalogueDialogRegistration.ENTRY_TAG_PREFIX + widget.id),
        shape = RoundedCornerShape(Radius.lg),
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        tonalElevation = Elevation.raised,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            IconBox(tone = IconBoxTone.Primary, size = IconBoxSize.Md) {
                Icon(imageVector = WidgetPickerGlyphs.forCategory(widget.category), contentDescription = null)
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    BodyText(text = widget.name, modifier = Modifier.weight(1f, fill = false))
                    if (isAdded) {
                        Badge(text = addedLabel, variant = BadgeVariant.Neutral)
                    }
                }
                Caption(text = widget.description)
            }
            Button(
                label = if (isAdded) addedLabel else addLabel,
                onClick = onAdd,
                modifier = Modifier.semantics { contentDescription = addContentDescription },
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                enabled = !isAdded,
            )
        }
    }
}

private val PREVIEW_WIDGETS =
    listOf(
        PickerWidget("vehicle-hero", "Vehicle Card", "Vehicle name, model, state, battery at a glance", WidgetCategory.Vehicle, 2, 9),
        PickerWidget("battery-gauge", "Battery Level", "Battery percentage with a radial gauge", WidgetCategory.Battery, 1, 2),
        PickerWidget("charge-status", "Charge Status", "Current charge state, amps, and time remaining", WidgetCategory.Charging, 2, 2),
    )

private fun previewView(
    query: String = "",
    active: Set<String> = emptySet(),
): WidgetCatalogueView =
    WidgetCatalogueProjection.project(
        WidgetCatalogueInput(query = query, activeWidgetIds = active),
        catalog = PREVIEW_WIDGETS,
        order = CATEGORY_ORDER,
    )

@Preview(name = "Catalogue — grouped", showBackground = true)
@Composable
private fun WidgetCataloguePreviewGrouped() {
    TeslaSyncTheme(dynamicColor = false) {
        WidgetCatalogueDialogContent(
            query = "",
            view = previewView(active = setOf("battery-gauge")),
            activeWidgetIds = setOf("battery-gauge"),
            categoryLabels = DEFAULT_CATEGORY_LABELS,
            onQueryChange = {},
            onClearSearch = {},
            onAddWidget = {},
        )
    }
}

@Preview(name = "Catalogue — empty result", showBackground = true)
@Composable
private fun WidgetCataloguePreviewEmpty() {
    TeslaSyncTheme(dynamicColor = false) {
        WidgetCatalogueDialogContent(
            query = "zzz",
            view = previewView(query = "zzz"),
            activeWidgetIds = emptySet(),
            categoryLabels = DEFAULT_CATEGORY_LABELS,
            onQueryChange = {},
            onClearSearch = {},
            onAddWidget = {},
        )
    }
}
