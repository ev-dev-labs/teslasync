// The native Jetpack Compose + Material 3 AuditLogPage notifications surface — a parity port of
// web/src/features/notifications/pages/AuditLogPage.tsx, the searchable system-audit viewer. It reproduces the
// page's single panel (GlassPanel1, the "Recent Activity" card), every data state (loading skeleton / error +
// retry / empty / content), the search + active-filter-chip combo, and the Time/Action/Resource/Details table,
// with every visible string resolved from the platform string catalog (res/values*/strings.xml, ADR-014).
//
// Composition: [AuditLogPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the feed + search snapshot); [AuditLogPageContent] is
// the stateless render layer driven entirely by [UiState] + the search string + [AuditLogActions]. All
// derivation lives in the framework-free model (AuditLogPageModel.kt); this file only resolves i18n + draws.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications)
// diverges from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.notifications.auditlog

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.forms.ActiveFilter
import io.teslasync.android.components.forms.ActiveFilterChips
import io.teslasync.android.components.forms.FilterBar
import io.teslasync.android.components.forms.SearchInput
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

private val SKELETON_ROW_HEIGHT = 32.dp
private const val SKELETON_ROW_COUNT = 5
private const val COL_WEIGHT_TIME = 1.3f
private const val COL_WEIGHT_ACTION = 1f
private const val COL_WEIGHT_RESOURCE = 1.1f
private const val COL_WEIGHT_DETAILS = 1.8f

/** The page's interaction callbacks, wired to the [AuditLogPageViewModel] (web event handlers). */
data class AuditLogActions(
    val onSearch: (String) -> Unit,
    val onClearSearch: () -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [AuditLogPageViewModel] over the supplied [source] (the host wires the shared
 * [io.teslasync.shared.core.presentation.admin.AdminStore] via [asAuditLogSource]). [logger] defaults to the
 * app's redacting logger.
 */
@Composable
fun AuditLogPage(
    source: AuditLogSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: AuditLogPageViewModel =
        viewModel(
            key = AuditLogPageRegistration.SLUG,
            factory = viewModelFactory { initializer { AuditLogPageViewModel(source, logger) } },
        )
    AuditLogPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feed + search snapshot to the stateless content. */
@Composable
fun AuditLogPage(
    viewModel: AuditLogPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val search by viewModel.search.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            AuditLogActions(
                onSearch = viewModel::setSearch,
                onClearSearch = viewModel::clearSearch,
                onRetry = viewModel::retry,
            )
        }

    AuditLogPageContent(state = state, search = search, actions = actions, modifier = modifier)
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/** The stateless page body: the header and the single "Recent Activity" panel (GlassPanel1). */
@Composable
fun AuditLogPageContent(
    state: UiState<AuditLogData>,
    search: String,
    actions: AuditLogActions,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        AuditLogHeader()
        FadeIn {
            AuditLogPanel(state = state, search = search, actions = actions)
        }
    }
}

@Composable
private fun AuditLogHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_auditLog_title))
        BodyText(
            stringResource(R.string.translation_auditLog_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// ── GlassPanel1 — "Recent Activity" ─────────────────────────────────────────────────────────────────────────

@Composable
private fun AuditLogPanel(
    state: UiState<AuditLogData>,
    search: String,
    actions: AuditLogActions,
) {
    GlassPanel(padding = PanelPadding.Lg) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                AuditLogGlyphs.Clock,
                contentDescription = null,
                size = IconSize.Lg,
                tint = MaterialTheme.colorScheme.primary,
            )
            SectionTitle(stringResource(R.string.translation_auditLog_recentActivity))
        }

        when {
            state.isLoading -> AuditLogLoadingState()
            state.isError -> AuditLogErrorState(onRetry = actions.onRetry)
            state.isEmpty -> AuditLogEmptyState()
            else -> AuditLogLoadedState(entries = state.data?.entries.orEmpty(), search = search, actions = actions)
        }
    }
}

// ── States ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Loading shimmer rows mirroring the web five-`Skeleton` loading state. */
@Composable
private fun AuditLogLoadingState() {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(SKELETON_ROW_COUNT) {
            Skeleton(height = SKELETON_ROW_HEIGHT)
        }
    }
}

/** Hard-error state (web `AlertTriangle` + "Failed to load audit logs"), with a retry affordance. */
@Composable
private fun AuditLogErrorState(onRetry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.lg),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            AuditLogGlyphs.AlertTriangle,
            contentDescription = null,
            size = IconSize.Xl,
            tint = MaterialTheme.colorScheme.error,
        )
        ErrorText(stringResource(R.string.translation_auditLog_loadFailed))
        Button(
            label = stringResource(R.string.translation_error_retry),
            onClick = onRetry,
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
        )
    }
}

/** Empty state (web "No audit entries found") — the server returned no audit rows. */
@Composable
private fun AuditLogEmptyState() {
    EmptyState(
        message = stringResource(R.string.translation_auditLog_empty),
        icon = AuditLogGlyphs.FileText,
    )
}

/** Content: the search field + active-filter chip + the filtered table (or the no-matches message). */
@Composable
private fun AuditLogLoadedState(
    entries: List<AuditLogEntry>,
    search: String,
    actions: AuditLogActions,
) {
    val filtered = remember(entries, search) { filterAuditLogs(entries, search) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        AuditLogFilterBar(search = search, onSearch = actions.onSearch, onClear = actions.onClearSearch)
        if (filtered.isEmpty()) {
            BodyText(
                stringResource(R.string.translation_auditLog_noMatches),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            AuditLogTable(entries = filtered)
        }
    }
}

@Composable
private fun AuditLogFilterBar(
    search: String,
    onSearch: (String) -> Unit,
    onClear: () -> Unit,
) {
    val chipLabel = stringResource(R.string.translation_auditLog_filterLabelSearch)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        FilterBar {
            SearchInput(
                value = search,
                onValueChange = onSearch,
                hint = stringResource(R.string.translation_auditLog_searchHint),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        ActiveFilterChips(
            filters =
                if (search.isNotEmpty()) {
                    listOf(ActiveFilter(key = "q", label = chipLabel, value = search))
                } else {
                    emptyList()
                },
            onRemove = { onClear() },
        )
    }
}

// ── Table (Time / Action / Resource / Details) ──────────────────────────────────────────────────────────────

@Composable
private fun AuditLogTable(entries: List<AuditLogEntry>) {
    val locale = ConfigurationCompat.getLocales(LocalConfiguration.current).get(0) ?: Locale.ROOT
    val noMatches = stringResource(R.string.translation_auditLog_noMatches)
    val columns: List<TableColumn<AuditLogEntry>> =
        listOf(
            TableColumn(
                key = "time",
                header = stringResource(R.string.translation_auditLog_colTime),
                weight = COL_WEIGHT_TIME,
                cell = { entry -> Caption(formatAuditTimestamp(entry.createdAt, locale)) },
            ),
            TableColumn(
                key = "action",
                header = stringResource(R.string.translation_auditLog_colAction),
                weight = COL_WEIGHT_ACTION,
                cell = { entry -> BodyText(entry.action.ifBlank { EM_DASH }, maxLines = 1) },
            ),
            TableColumn(
                key = "resource",
                header = stringResource(R.string.translation_auditLog_colResource),
                weight = COL_WEIGHT_RESOURCE,
                cell = { entry -> CodeText(entry.resource.ifBlank { EM_DASH }) },
            ),
            TableColumn(
                key = "details",
                header = stringResource(R.string.translation_auditLog_colDetails),
                weight = COL_WEIGHT_DETAILS,
                cell = { entry ->
                    BodyText(
                        entry.details.ifBlank { EM_DASH },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                    )
                },
            ),
        )
    DataTable(columns = columns, rows = entries, keyOf = { it.id }, emptyText = noMatches)
}

// ── Display-boundary helper (locale-aware timestamp, web `formatDateTime`) ──────────────────────────────────

private val AUDIT_TS_FORMATTER: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)

/**
 * Formats an ISO-8601 timestamp in the device zone + [locale] as a "MMM d, y, h:mm a"-style stamp, mirroring
 * the web `formatDateTime`. Blank input → em-dash; an unparseable value falls back to the raw string.
 */
private fun formatAuditTimestamp(
    iso: String,
    locale: Locale,
): String {
    if (iso.isBlank()) return EM_DASH
    val formatter = AUDIT_TS_FORMATTER.withLocale(locale).withZone(ZoneId.systemDefault())
    return runCatching { formatter.format(OffsetDateTime.parse(iso).toInstant()) }
        .recoverCatching { formatter.format(Instant.parse(iso)) }
        .getOrDefault(iso)
}
