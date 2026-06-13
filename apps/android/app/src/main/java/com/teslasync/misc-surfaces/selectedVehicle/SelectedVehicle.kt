// The native Jetpack Compose + Material 3 selectedVehicle surface — a parity port of the web
// selected-vehicle store (web/src/store/selectedVehicle.tsx) composed with web/src/hooks/useSelectedVehicle.ts
// and surfaced the way the web `ActiveVehicleSegment` (the store's intended UI consumer) presents it: the
// currently-active vehicle plus a switcher that re-points every vehicle-scoped screen by writing the store.
//
// The surface keeps that contract and renders every state the P3 checklist requires: loading (skeletons),
// content (the active vehicle hero + a switcher when the fleet has more than one vehicle), empty (no
// enrolled vehicles ⇒ a friendly empty state, never a blank box), hard error (QueryError + retry), and —
// through the ADR-013 cache-then-network freshness contract — stale (a stale chip + a single auto-refresh)
// and offline (the cached fleet kept visible with an offline chip). All data flows through the shared
// [SelectedVehicleViewModel] (P1/S8); the view performs NO HTTP. Every string resolves through the i18n
// facade (P1/S10) via `stringResource` over catalog keys the web `ActiveVehicleSegment` / `NoVehicleSelected`
// already ship, so the on-screen text matches the web verbatim and localizes (en/ar/he). Every interactive
// element carries a TalkBack label, the switcher rows expose their selected state, and `view.opened` is
// emitted once via the redacting logger.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/misc-surfaces/selectedVehicle — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.miscsurfaces.selectedvehicle

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point. Binds the selection + fleet seam via [source] into a [SelectedVehicleViewModel],
 * records the one-shot `view.opened` diagnostic, collects the live cache-then-network state, and renders the
 * surface. A host supplies [source] (typically
 * `selectedVehicleSource(container.selectedVehicleStore, container.vehiclesStore)`); [logger] defaults to the
 * process logger from the data container.
 */
@Composable
fun SelectedVehicle(
    source: SelectedVehicleSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: SelectedVehicleViewModel =
        viewModel(
            key = SelectedVehicleRegistration.ID,
            factory = SelectedVehicleViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    SelectedVehicleContent(
        state = state,
        modifier = modifier,
        onSelect = viewModel::select,
        onRetry = viewModel::retry,
        onRefresh = viewModel::refresh,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. Draws a [GlassPanel]
 * with an always-present header (the active-vehicle title + a freshness chip while stale / refreshing /
 * offline) over a body that switches on the cache-then-network [UiState]: loading ⇒ skeletons, hard error ⇒
 * [QueryError] + retry, empty ⇒ a friendly [EmptyState], otherwise the active vehicle hero + switcher. Stale
 * (non-error) data auto-refreshes exactly once (web `useVehicles` refetch); offline keeps the cached fleet
 * with the offline chip.
 */
@Composable
fun SelectedVehicleContent(
    state: UiState<SelectedVehicleData>,
    modifier: Modifier = Modifier,
    onSelect: (Long) -> Unit = {},
    onRetry: () -> Unit = {},
    onRefresh: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val data = state.data ?: SelectedVehicleData.EMPTY
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            SelectedVehicleHeader(state = state)
            FadeIn(modifier = Modifier.fillMaxWidth()) {
                when {
                    state.isLoading -> SelectedVehicleLoading()
                    state.isError -> SelectedVehicleErrorBody(state = state, onRetry = onRetry)
                    state.isEmpty -> SelectedVehicleEmptyBody()
                    else -> SelectedVehicleActiveBody(data = data, onSelect = onSelect)
                }
            }
        }
    }
}

/**
 * The always-present header — the active-vehicle title (web `t('statusBar.vehicle.tooltip')`) with a leading
 * Car glyph, and, while the fleet is stale / refreshing / offline, a localized freshness chip so cached data
 * is never presented as live (ADR-013).
 */
@Composable
private fun SelectedVehicleHeader(state: UiState<SelectedVehicleData>) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                NavGlyphs.Car,
                contentDescription = null,
                size = IconSize.Md,
                tint = MaterialTheme.colorScheme.primary,
            )
            PanelTitle(stringResource(R.string.translation_statusBar_vehicle_tooltip))
        }
        SelectedVehicleFreshnessChip(state)
    }
}

/**
 * The localized freshness chip: an offline chip while cached data is shown after a failed refresh
 * (web "last known"), an "updating…" chip while a refresh is in flight, or a stale chip once the cached
 * value passes its TTL. Renders nothing while the data is fresh.
 */
@Composable
private fun SelectedVehicleFreshnessChip(state: UiState<SelectedVehicleData>) {
    when {
        state.hasError && state.hasData ->
            Badge(
                text = stringResource(R.string.translation_common_offline),
                variant = BadgeVariant.Warning,
                dot = true,
            )

        state.refreshing ->
            Badge(
                text = stringResource(R.string.translation_freshness_updating),
                variant = BadgeVariant.Neutral,
                dot = true,
            )

        state.stale ->
            Badge(
                text = stringResource(R.string.translation_mqtt_stale),
                variant = BadgeVariant.Info,
                dot = true,
            )
    }
}

/** The loading branch — stacked skeletons standing in for the active card + switcher rows. */
@Composable
private fun SelectedVehicleLoading() {
    val loadingLabel = stringResource(R.string.translation_common_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(height = ACTIVE_SKELETON_HEIGHT, rounded = true)
        Skeleton(widthFraction = SKELETON_ROW_FRACTION_A, height = ROW_SKELETON_HEIGHT)
        Skeleton(widthFraction = SKELETON_ROW_FRACTION_B, height = ROW_SKELETON_HEIGHT)
    }
}

/** The hard-error branch — a recovery-oriented [QueryError] with retry, classified from the failure. */
@Composable
private fun SelectedVehicleErrorBody(
    state: UiState<SelectedVehicleData>,
    onRetry: () -> Unit,
) {
    QueryError(
        kind = selectedVehicleErrorKind(state.errorKind, state.httpStatus),
        resourceName = stringResource(R.string.translation_statusBar_vehicle_tooltip),
        onRetry = onRetry,
    )
}

/** The empty branch — the friendly "no vehicle selected" state (web `NoVehicleSelected`), never a blank box. */
@Composable
private fun SelectedVehicleEmptyBody() {
    EmptyState(
        message = stringResource(R.string.translation_common_noVehicleSelected_desc),
        modifier = Modifier.fillMaxWidth(),
        icon = NavGlyphs.Car,
        title = stringResource(R.string.translation_common_noVehicleSelected_title),
    )
}

/**
 * The content branch — the active vehicle hero, and, when the account holds more than one vehicle, a switcher
 * whose rows write the persisted selection (web `ActiveVehicleSegment`: single-vehicle owners get a static
 * chip, multi-vehicle owners get the picker).
 */
@Composable
private fun SelectedVehicleActiveBody(
    data: SelectedVehicleData,
    onSelect: (Long) -> Unit,
) {
    val fallbackWord = stringResource(R.string.translation_statusBar_vehicle_fallback)
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        ActiveVehicleHero(row = data.selectedRow, fallbackWord = fallbackWord)
        if (data.selectable) {
            Caption(stringResource(R.string.translation_statusBar_vehicle_switch))
            Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                data.vehicles.forEach { row ->
                    VehicleSwitchRow(row = row, fallbackWord = fallbackWord, onSelect = onSelect)
                }
            }
        }
    }
}

/**
 * The active-vehicle hero — a Car glyph, the resolved name (web `display_name || vin || 'Vehicle {id}'`), the
 * model subtitle, and the VIN as a muted line. Merged into a single TalkBack node labelled "Active vehicle:
 * {name}". Guards against a missing active row (empty fleet) with the localized "No vehicle" label.
 */
@Composable
private fun ActiveVehicleHero(
    row: SelectedVehicleRow?,
    fallbackWord: String,
) {
    if (row == null) {
        BodyText(stringResource(R.string.translation_statusBar_vehicle_none))
        return
    }
    val label = rowDisplayLabel(row, fallbackWord)
    val description = activeVehicleContentDescription(stringResource(R.string.translation_statusBar_vehicle_aria), label)
    Row(
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = description },
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(NavGlyphs.Car, contentDescription = null, size = IconSize.Lg, tint = MaterialTheme.colorScheme.primary)
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            BodyText(label, maxLines = 1)
            val model = row.model
            if (!model.isNullOrBlank()) Caption(model)
            if (row.displayName.isNotBlank()) HelperText(row.vin)
        }
    }
}

/**
 * A single switcher row — a [selectable] control that writes the persisted selection on tap (web
 * `setVehicleId`). Exposes its selected state to TalkBack, a "Switch vehicle" click action, and the resolved
 * name as its accessible label; the active row carries a trailing check (web `<Check/>`).
 */
@Composable
private fun VehicleSwitchRow(
    row: SelectedVehicleRow,
    fallbackWord: String,
    onSelect: (Long) -> Unit,
) {
    val label = rowDisplayLabel(row, fallbackWord)
    val switchLabel = stringResource(R.string.translation_statusBar_vehicle_switch)
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.sm))
                .selectable(
                    selected = row.selected,
                    role = Role.Button,
                    onClick = { onSelect(row.id) },
                ).semantics(mergeDescendants = true) {
                    contentDescription = label
                    onClick(label = switchLabel, action = null)
                }.padding(horizontal = Spacing.sm, vertical = Spacing.sm),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            NavGlyphs.Car,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            BodyText(label, maxLines = 1)
            val model = row.model
            if (!model.isNullOrBlank()) Caption(model)
        }
        if (row.selected) {
            Icon(TeslaGlyphs.Check, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.success)
        }
    }
}

private val ACTIVE_SKELETON_HEIGHT = 56.dp
private val ROW_SKELETON_HEIGHT = 14.dp
private const val SKELETON_ROW_FRACTION_A = 0.7f
private const val SKELETON_ROW_FRACTION_B = 0.5f

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private fun previewRow(
    id: Long,
    name: String,
    model: String?,
    selected: Boolean,
): SelectedVehicleRow = SelectedVehicleRow(id = id, displayName = name, vin = "5YJ3E1EA7KF00000$id", model = model, selected = selected)

private fun previewFleet(selectedId: Long): SelectedVehicleData {
    val rows =
        listOf(
            previewRow(1, "Red Rocket", "Model 3", selected = selectedId == 1L),
            previewRow(2, "Spacehauler", "Model Y", selected = selectedId == 2L),
            previewRow(3, "Garage Queen", "Model S", selected = selectedId == 3L),
        )
    return SelectedVehicleData(vehicles = rows, effectiveSelectedId = selectedId, selectable = true)
}

@Preview(name = "Content — fleet", showBackground = true)
@Composable
private fun SelectedVehicleContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SelectedVehicleContent(state = UiState(UiPhase.Content, data = previewFleet(2)))
    }
}

@Preview(name = "Content — single vehicle", showBackground = true)
@Composable
private fun SelectedVehicleSinglePreview() {
    val data =
        SelectedVehicleData(
            vehicles = listOf(previewRow(1, "Daily Driver", "Model 3", selected = true)),
            effectiveSelectedId = 1,
            selectable = false,
        )
    TeslaSyncTheme(dynamicColor = false) {
        SelectedVehicleContent(state = UiState(UiPhase.Content, data = data))
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun SelectedVehicleLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SelectedVehicleContent(state = UiState.loading())
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun SelectedVehicleEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SelectedVehicleContent(state = UiState(UiPhase.Empty, data = SelectedVehicleData.EMPTY))
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun SelectedVehicleErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SelectedVehicleContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
        )
    }
}

@Preview(name = "Offline — last known", showBackground = true)
@Composable
private fun SelectedVehicleOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SelectedVehicleContent(
            state =
                UiState(
                    UiPhase.Content,
                    data = previewFleet(2),
                    fetchedAt = 0L,
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
        )
    }
}
