// The native Jetpack Compose + Material 3 NotificationFilterBar feature view — a parity port of
// web/src/features/notifications/components/NotificationFilterBar.tsx. It reproduces the web composition: a
// multi-select severity chip row (info / warn / critical), a Vehicle dropdown, a Rule dropdown, a debounced
// message search field, a from/to date range, and the removable active-filter chips with a "Clear all"
// affordance. The single data dependency — the alert-rule list for the Rule dropdown (web `useNotifications`
// domain) — flows through the shared [NotificationFilterBarViewModel] (P1/S8); the view performs no HTTP
// (ADR-002). Every visible string resolves through the i18n catalog (`R.string.translation_notifications_*`
// / `_common_*` / `_filters_*` / `_freshness_*` from P1/S10), and every interactive element (severity
// toggles, vehicle / rule dropdowns, search, date pickers, chip removers, clear-all, refresh) carries an
// accessibility label.
//
// State envelope: the alert-rule feed drives the freshness chip + refresh (retry) chrome and the Rule
// dropdown options; it never blanks the bar (web `rules ?? []` degrades gracefully) — the severity / search
// / vehicle / date controls stay usable through loading-with-cache, stale, offline, and hard-error. A first
// load with no cached rules shows the loading skeleton. The bar's "empty" representation is the absence of
// active-filter chips (the caller-owned filters), never a blank box.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/NotificationFilterBar) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + control composables.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")
@file:OptIn(ExperimentalLayoutApi::class)

package io.teslasync.android.featureviews.notificationfilterbar

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.forms.ActiveFilterChips
import io.teslasync.android.components.forms.DateRangeFilter
import io.teslasync.android.components.forms.FilterBar
import io.teslasync.android.components.forms.SearchInput
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Select
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.NotificationFilters
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.AlertRule

private const val EM_DASH = "\u2014"
private const val LOADING_BAR_COUNT = 4

/**
 * Stateful entry point. Binds the cache-then-network alert-rule feed via [source] into a
 * [NotificationFilterBarViewModel], records the one-shot `view.opened` diagnostic, and renders the
 * controlled filter bar for the caller-owned [filters] + [onChange] (web `NotificationFilterBarProps`). The
 * [vehicles] list is supplied by the caller exactly as the web component receives its `vehicles` prop; a
 * host supplies [source] (an adapter over the shared S8 Notifications data layer) and a unique [instanceKey]
 * per placement.
 *
 * @param filters the current filter selection (owned by the parent, like the web `filters` prop).
 * @param onChange invoked with the next [NotificationFilters] on every edit (web `onChange`).
 * @param vehicles the enrolled vehicles for the Vehicle dropdown (web `vehicles` prop).
 * @param source the cache-then-network alert-rule seam (a [notificationFilterBarSource] adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun NotificationFilterBar(
    filters: NotificationFilters,
    onChange: (NotificationFilters) -> Unit,
    vehicles: List<Vehicle>,
    source: NotificationFilterBarSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = NOTIFICATION_FILTER_BAR_SLUG,
) {
    val viewModel: NotificationFilterBarViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { NotificationFilterBarViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    NotificationFilterBarContent(
        state = state,
        filters = filters,
        onChange = onChange,
        vehicles = vehicles.map { VehicleChoice(id = it.id, displayName = it.displayName) },
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. A first load with no cached
 * rules shows the loading skeleton; otherwise the freshness + refresh header sits over the always-usable
 * controls (severity chips, vehicle + rule dropdowns, search, date range) and the active-filter chips. A
 * rule load error keeps the bar fully usable (offline chip + refresh = retry), mirroring the web's graceful
 * degradation.
 */
@Composable
fun NotificationFilterBarContent(
    state: UiState<List<AlertRule>>,
    filters: NotificationFilters,
    onChange: (NotificationFilters) -> Unit,
    vehicles: List<VehicleChoice>,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (state.isLoading) {
        LoadingChrome(modifier)
        return
    }
    val rules = state.data ?: emptyList()
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        FilterStatusHeader(state = state, onRefresh = onRefresh)
        FilterControls(filters = filters, onChange = onChange, vehicles = vehicles, rules = rules)
        DateRangeRow(filters = filters, onChange = onChange)
        ActiveChips(filters = filters, onChange = onChange, vehicles = vehicles, rules = rules)
    }
}

@Composable
private fun FilterStatusHeader(
    state: UiState<List<AlertRule>>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberFreshnessFormatter(),
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun FilterControls(
    filters: NotificationFilters,
    onChange: (NotificationFilters) -> Unit,
    vehicles: List<VehicleChoice>,
    rules: List<AlertRule>,
) {
    val searchHint = stringResource(R.string.translation_notifications_inbox_filter_searchPlaceholder) // parity:allow i18n key name
    FilterBar {
        SeverityChips(
            selectedWires = selectedSeverities(filters),
            onToggle = { onChange(filters.copy(severity = toggleSeverity(filters.severity, it))) },
        )
        Select(
            options = vehicleOptions(stringResource(R.string.translation_notifications_inbox_filter_allVehicles), vehicles),
            selectedValue = vehicleSelectValue(filters),
            onSelect = { onChange(withVehicle(filters, it)) },
            label = stringResource(R.string.translation_notifications_inbox_filter_vehicle),
        )
        Select(
            options = ruleOptions(stringResource(R.string.translation_notifications_inbox_filter_allRules), rules),
            selectedValue = ruleSelectValue(filters),
            onSelect = { onChange(withRule(filters, it)) },
            label = stringResource(R.string.translation_notifications_inbox_filter_rule),
        )
        SearchInput(
            value = filters.q ?: "",
            onValueChange = { onChange(withQuery(filters, it)) },
            hint = searchHint,
            clearLabel = stringResource(R.string.translation_common_clear),
        )
    }
}

@Composable
private fun SeverityChips(
    selectedWires: Set<String>,
    onToggle: (String) -> Unit,
) {
    val labels = severityChipLabels()
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        NotificationSeverity.ordered.forEach { severity ->
            val isActive = severity.wire in selectedWires
            Button(
                label = labels.getValue(severity),
                onClick = { onToggle(severity.wire) },
                variant = if (isActive) ButtonVariant.Primary else ButtonVariant.Outline,
                size = ButtonSize.Sm,
                leadingIcon = severityIcon(severity),
                modifier = Modifier.semantics { selected = isActive },
            )
        }
    }
}

@Composable
private fun DateRangeRow(
    filters: NotificationFilters,
    onChange: (NotificationFilters) -> Unit,
) {
    DateRangeFilter(
        startEpochDay = isoDateToEpochDay(filters.from),
        endEpochDay = isoDateToEpochDay(filters.to),
        onRangeChange = { start, end -> onChange(withDateRange(filters, start, end)) },
    )
}

@Composable
private fun ActiveChips(
    filters: NotificationFilters,
    onChange: (NotificationFilters) -> Unit,
    vehicles: List<VehicleChoice>,
    rules: List<AlertRule>,
) {
    ActiveFilterChips(
        filters = activeFilters(filters, rememberChipLabels(), vehicles, rules),
        onRemove = { key -> onChange(clearFilter(filters, key)) },
        onClearAll = { onChange(clearAll(filters)) },
        clearAllLabel = stringResource(R.string.translation_filters_clearAll),
    )
}

@Composable
private fun LoadingChrome(modifier: Modifier) {
    val label = stringResource(R.string.translation_common_loading)
    Column(
        modifier = modifier.fillMaxWidth().padding(Spacing.md).semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(LOADING_BAR_COUNT) { Skeleton(height = Spacing.lg, rounded = true) }
    }
}

// ── localized helpers (resolved at the Compose boundary; the Model stays string-free) ──────────────────

private fun severityIcon(severity: NotificationSeverity): ImageVector =
    when (severity) {
        NotificationSeverity.Info -> DataDisplayGlyphs.Info
        NotificationSeverity.Warn -> DataDisplayGlyphs.AlertTriangle
        NotificationSeverity.Critical -> DataDisplayGlyphs.AlertOctagon
    }

@Composable
private fun severityChipLabels(): Map<NotificationSeverity, String> =
    mapOf(
        NotificationSeverity.Info to stringResource(R.string.translation_notifications_inbox_filter_severity_info),
        NotificationSeverity.Warn to stringResource(R.string.translation_notifications_inbox_filter_severity_warn),
        NotificationSeverity.Critical to stringResource(R.string.translation_notifications_inbox_filter_severity_critical),
    )

@Composable
private fun rememberChipLabels(): NotificationFilterChipLabels =
    NotificationFilterChipLabels(
        severity = stringResource(R.string.translation_notifications_inbox_filter_severity),
        vehicle = stringResource(R.string.translation_notifications_inbox_filter_vehicle),
        rule = stringResource(R.string.translation_notifications_inbox_filter_rule),
        search = stringResource(R.string.translation_notifications_inbox_filter_searchLabel),
        from = stringResource(R.string.translation_notifications_inbox_filter_from),
        to = stringResource(R.string.translation_notifications_inbox_filter_to),
        severityValues =
            mapOf(
                NotificationSeverity.Info.wire to stringResource(R.string.translation_notifications_inbox_filter_severity_info),
                NotificationSeverity.Warn.wire to stringResource(R.string.translation_notifications_inbox_filter_severity_warn),
                NotificationSeverity.Critical.wire to
                    stringResource(R.string.translation_notifications_inbox_filter_severity_critical),
            ),
    )

/**
 * The localized relative-age formatter shared with the freshness chip — maps each [FreshnessAge] bucket to a
 * `translation_freshness_*` string so the chip carries no English microcopy (mirrors the web freshness
 * labels). Unknown collapses to an em dash.
 */
@Composable
private fun rememberFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return { age ->
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
