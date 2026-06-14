// The native Jetpack Compose + Material 3 FeedbackQueuePage admin surface — a parity port of
// web/src/features/admin/pages/FeedbackQueuePage.tsx, the in-app feedback queue. It reproduces the page's
// single panel (GlassPanel1), every data state (loading / empty / error / content), and every visible string
// (resolved from the generated res/values catalog, ADR-014): the status/category filters, the paginated
// feedback table (created / category / title / page / reporter / status / GitHub columns), and the per-row
// expanded detail with the inline triage controls (status change, GitHub URL save, forward-to-GitHub).
//
// Composition: [FeedbackQueuePage] is the stateful entry (constructs the view-model over the host-wired
// source, records the one-shot `view.opened` diagnostic, collects the feed + interaction snapshot);
// [FeedbackQueuePageContent] is the stateless render layer driven entirely by [UiState] +
// [FeedbackQueueInteraction] + [FeedbackQueueActions]. All derivation lives in the framework-free model
// (FeedbackQueuePageModel.kt); this file only resolves i18n + draws.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions", "LongMethod")

package io.teslasync.android.admin.feedback

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.UserCell
import io.teslasync.android.components.datadisplay.UserCellUser
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.MaskVariant
import io.teslasync.android.components.ui.MaskedValue
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.feedback.FeedbackEntry
import io.teslasync.shared.core.presentation.feedback.FeedbackListResponse
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** The page's interaction callbacks, wired to the [FeedbackQueuePageViewModel] (web event handlers). */
data class FeedbackQueueActions(
    val onStatusFilter: (String) -> Unit,
    val onCategoryFilter: (String) -> Unit,
    val onRefresh: () -> Unit,
    val onPage: (Int) -> Unit,
    val onToggleExpand: (Long) -> Unit,
    val onUpdateStatus: (Long, String) -> Unit,
    val onSaveUrl: (Long, String) -> Unit,
    val onForward: (Long) -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [FeedbackQueuePageViewModel] over the supplied [source] (the host wires the
 * shared [io.teslasync.shared.core.presentation.feedback.FeedbackStore] via [asFeedbackQueueSource]).
 * [logger] defaults to the app's redacting logger.
 */
@Composable
fun FeedbackQueuePage(
    source: FeedbackQueueSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: FeedbackQueuePageViewModel =
        viewModel(
            key = FeedbackQueueRegistration.SLUG,
            factory = viewModelFactory { initializer { FeedbackQueuePageViewModel(source, logger) } },
        )
    FeedbackQueuePage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feed + interaction snapshot to the stateless content. */
@Composable
fun FeedbackQueuePage(
    viewModel: FeedbackQueuePageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val updating by viewModel.updating.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            FeedbackQueueActions(
                onStatusFilter = viewModel::setStatus,
                onCategoryFilter = viewModel::setCategory,
                onRefresh = viewModel::refresh,
                onPage = viewModel::setPage,
                onToggleExpand = viewModel::toggleExpanded,
                onUpdateStatus = viewModel::updateStatus,
                onSaveUrl = viewModel::saveGithubUrl,
                onForward = viewModel::forwardToGithub,
                onRetry = viewModel::retry,
            )
        }

    FeedbackQueuePageContent(
        state = state,
        interaction = interaction,
        updating = updating,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/** The stateless page body: the header + the single GlassPanel (filters + the data-state table). */
@Composable
fun FeedbackQueuePageContent(
    state: UiState<FeedbackListResponse>,
    interaction: FeedbackQueueInteraction,
    updating: Boolean,
    actions: FeedbackQueueActions,
    modifier: Modifier = Modifier,
) {
    val data = state.data
    val items = data?.items ?: emptyList()
    val total = data?.total ?: 0L
    val bridgeEnabled = data?.githubBridgeEnabled ?: false

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        PageTitle(stringResource(R.string.translation_feedback_queue_title))

        FadeIn {
            GlassPanel(padding = PanelPadding.Md) {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    FeedbackQueueFilters(
                        interaction = interaction,
                        bridgeEnabled = bridgeEnabled,
                        refreshing = state.refreshing,
                        actions = actions,
                    )

                    when {
                        state.isLoading -> FeedbackLoadingState()
                        state.isError -> FeedbackErrorState(onRetry = actions.onRetry)
                        items.isEmpty() -> FeedbackEmptyState()
                        else ->
                            FeedbackTable(
                                items = items,
                                total = total,
                                interaction = interaction,
                                bridgeEnabled = bridgeEnabled,
                                updating = updating,
                                refreshing = state.refreshing,
                                actions = actions,
                            )
                    }
                }
            }
        }
    }
}

// ── Filters (status / category Select + Refresh + the bridge-disabled hint) ─────────────────────────────────

@Composable
private fun FeedbackQueueFilters(
    interaction: FeedbackQueueInteraction,
    bridgeEnabled: Boolean,
    refreshing: Boolean,
    actions: FeedbackQueueActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Bottom,
        ) {
            Select(
                options = statusFilterOptions(),
                selectedValue = interaction.status,
                onSelect = actions.onStatusFilter,
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_feedback_queue_filter_status),
                emptyLabel = stringResource(R.string.translation_feedback_queue_filter_allStatuses),
            )
            Select(
                options = categoryFilterOptions(),
                selectedValue = interaction.category,
                onSelect = actions.onCategoryFilter,
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_feedback_queue_filter_category),
                emptyLabel = stringResource(R.string.translation_feedback_queue_filter_allCategories),
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
        ) {
            Button(
                label = stringResource(R.string.translation_common_refresh),
                onClick = actions.onRefresh,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = FeedbackGlyphs.Refresh,
                loading = refreshing,
            )
        }
        if (!bridgeEnabled) {
            HelperText(stringResource(R.string.translation_feedback_queue_bridgeDisabled))
        }
    }
}

// ── Data states ─────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun FeedbackLoadingState() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spinner(size = SpinnerSize.Md)
    }
}

@Composable
private fun FeedbackErrorState(onRetry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            TeslaGlyphs.Octagon,
            contentDescription = null,
            size = IconSize.Xl,
            tint = MaterialTheme.colorScheme.error,
        )
        ErrorText(stringResource(R.string.translation_error_loadFailed))
        Button(
            label = stringResource(R.string.translation_error_retry),
            onClick = onRetry,
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
        )
    }
}

@Composable
private fun FeedbackEmptyState() {
    EmptyState(
        message = stringResource(R.string.translation_feedback_queue_emptyMessage),
        icon = FeedbackGlyphs.Bug,
        title = stringResource(R.string.translation_feedback_queue_empty),
    )
}

// ── Table (header + rows + pagination) ──────────────────────────────────────────────────────────────────────

@Composable
private fun FeedbackTable(
    items: List<FeedbackEntry>,
    total: Long,
    interaction: FeedbackQueueInteraction,
    bridgeEnabled: Boolean,
    updating: Boolean,
    refreshing: Boolean,
    actions: FeedbackQueueActions,
) {
    val hScroll = rememberScrollState()
    val locale = ConfigurationCompat.getLocales(LocalConfiguration.current).get(0) ?: Locale.ROOT

    Column(modifier = Modifier.fillMaxWidth()) {
        FeedbackTableHeader(scroll = hScroll)
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        items.forEachIndexed { index, row ->
            if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            FeedbackRow(
                row = row,
                expanded = interaction.expandedId == row.id,
                scroll = hScroll,
                locale = locale,
                bridgeEnabled = bridgeEnabled,
                updating = updating,
                actions = actions,
            )
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        FeedbackPaginationFooter(
            page = interaction.page,
            total = total,
            refreshing = refreshing,
            onPage = actions.onPage,
        )
    }
}

@Composable
private fun FeedbackTableHeader(scroll: androidx.compose.foundation.ScrollState) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .horizontalScroll(scroll)
                .padding(horizontal = Spacing.sm, vertical = Spacing.sm),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(CHEVRON_W))
        HeaderCell(stringResource(R.string.translation_feedback_queue_col_created), CREATED_W)
        HeaderCell(stringResource(R.string.translation_feedback_queue_col_category), CATEGORY_W)
        HeaderCell(stringResource(R.string.translation_feedback_queue_col_title), TITLE_W)
        HeaderCell(stringResource(R.string.translation_feedback_queue_col_pageRoute), PAGE_ROUTE_W)
        HeaderCell(stringResource(R.string.translation_feedback_queue_col_reporter), REPORTER_W)
        HeaderCell(stringResource(R.string.translation_feedback_queue_col_status), STATUS_W)
        HeaderCell(stringResource(R.string.translation_feedback_queue_col_github), GITHUB_W)
    }
}

@Composable
private fun HeaderCell(
    text: String,
    width: Dp,
) {
    Caption(text, modifier = Modifier.width(width))
}

@Composable
private fun FeedbackRow(
    row: FeedbackEntry,
    expanded: Boolean,
    scroll: androidx.compose.foundation.ScrollState,
    locale: Locale,
    bridgeEnabled: Boolean,
    updating: Boolean,
    actions: FeedbackQueueActions,
) {
    val uriHandler = LocalUriHandler.current
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clickable { actions.onToggleExpand(row.id) }
                    .horizontalScroll(scroll)
                    .padding(horizontal = Spacing.sm, vertical = Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                if (expanded) TeslaGlyphs.ChevronUp else TeslaGlyphs.ChevronDown,
                contentDescription = null,
                size = IconSize.Sm,
                modifier = Modifier.width(CHEVRON_W),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            BodyText(formatCreated(row.createdAt, locale), modifier = Modifier.width(CREATED_W))
            Box(Modifier.width(CATEGORY_W)) {
                Badge(text = categoryLabel(row.category), variant = categoryTone(row.category).badgeVariant())
            }
            BodyText(
                row.title.ifEmpty { EM_DASH },
                modifier = Modifier.width(TITLE_W),
                maxLines = 2,
            )
            Box(Modifier.width(PAGE_ROUTE_W)) {
                if (row.pageRoute.isNotEmpty()) {
                    CodeText(row.pageRoute)
                } else {
                    Caption(EM_DASH)
                }
            }
            Box(Modifier.width(REPORTER_W)) {
                FeedbackReporter(row)
            }
            Box(Modifier.width(STATUS_W)) {
                Badge(text = statusLabel(row.status), variant = statusTone(row.status).badgeVariant())
            }
            Box(Modifier.width(GITHUB_W)) {
                if (row.githubIssueUrl.isNotEmpty()) {
                    LinkText(
                        text = stringResource(R.string.translation_feedback_queue_openIssue),
                        onClick = { uriHandler.openUri(row.githubIssueUrl) },
                    )
                } else {
                    Caption(EM_DASH)
                }
            }
        }
        if (expanded) {
            FeedbackDetail(
                row = row,
                bridgeEnabled = bridgeEnabled,
                updating = updating,
                actions = actions,
            )
        }
    }
}

/** The reporter cell — the web `<UserCell user={{ id: submitter_subject, email: user_email }} />`. */
@Composable
private fun FeedbackReporter(row: FeedbackEntry) {
    UserCell(
        user =
            UserCellUser(
                id = row.submitterSubject.ifEmpty { null },
                email = row.userEmail.ifEmpty { null },
            ),
    )
}

@Composable
private fun FeedbackPaginationFooter(
    page: Int,
    total: Long,
    refreshing: Boolean,
    onPage: (Int) -> Unit,
) {
    val pages = totalPages(total)
    Row(
        modifier = Modifier.fillMaxWidth().padding(Spacing.md),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Caption(
            stringResource(
                R.string.translation_feedback_queue_pageOf,
                (page + 1).toString(),
                pages.toString(),
                total.toString(),
            ),
            modifier = Modifier.weight(1f),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
            Button(
                label = stringResource(R.string.translation_common_previous),
                onClick = { onPage(page - 1) },
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = TeslaGlyphs.ChevronLeft,
                enabled = page > 0 && !refreshing,
            )
            Button(
                label = stringResource(R.string.translation_common_next),
                onClick = { onPage(page + 1) },
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = TeslaGlyphs.ChevronRight,
                enabled = page + 1 < pages && !refreshing,
            )
        }
    }
}

// ── Expanded row detail (web FeedbackExpansion) ─────────────────────────────────────────────────────────────

@Composable
private fun FeedbackDetail(
    row: FeedbackEntry,
    bridgeEnabled: Boolean,
    updating: Boolean,
    actions: FeedbackQueueActions,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PanelTitle(stringResource(R.string.translation_feedback_queue_expand_body))
            BodyText(row.body.ifEmpty { EM_DASH })
        }

        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            DetailField(stringResource(R.string.translation_feedback_queue_expand_appVersion), row.appVersion, code = true)
            DetailField(stringResource(R.string.translation_feedback_queue_expand_userAgent), row.userAgent, code = false)
            DetailField(
                stringResource(R.string.translation_feedback_queue_expand_submitter),
                row.submitterSubject.ifEmpty { row.submitterIp },
                code = true,
            )
            FeedbackEmailField(row.userEmail)
        }

        val recentErrors = row.recentErrors
        if (recentErrors != null) {
            ExpandableJsonSection(
                label = stringResource(R.string.translation_feedback_queue_expand_recentErrors),
                content = prettyErrors(recentErrors),
            )
        }
        if (row.consoleTail.isNotEmpty()) {
            ExpandableJsonSection(
                label = stringResource(R.string.translation_feedback_queue_expand_consoleTail),
                content = row.consoleTail,
            )
        }

        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        FeedbackTriageControls(row = row, bridgeEnabled = bridgeEnabled, updating = updating, actions = actions)
    }
}

@Composable
private fun DetailField(
    label: String,
    value: String,
    code: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(label)
        val resolved = value.ifEmpty { EM_DASH }
        if (code) CodeText(resolved) else BodyText(resolved)
    }
}

@Composable
private fun FeedbackEmailField(email: String) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(stringResource(R.string.translation_feedback_queue_expand_userEmail))
        if (email.isNotEmpty()) {
            MaskedValue(
                value = email,
                variant = MaskVariant.Email,
                revealLabel = stringResource(R.string.translation_mask_reveal),
                hideLabel = stringResource(R.string.translation_mask_hide),
                accessibleName = stringResource(R.string.translation_feedback_queue_maskedEmail),
                copyable = true,
                copyLabel = stringResource(R.string.translation_mask_copy),
                copiedLabel = stringResource(R.string.translation_common_copyButton_copied),
            )
        } else {
            BodyText(EM_DASH)
        }
    }
}

@Composable
private fun ExpandableJsonSection(
    label: String,
    content: String,
) {
    var open by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(
            modifier = Modifier.fillMaxWidth().clickable { open = !open },
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                if (open) TeslaGlyphs.ChevronUp else TeslaGlyphs.ChevronDown,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Caption(label)
        }
        if (open) {
            GlassPanel(padding = PanelPadding.Sm) {
                Column(modifier = Modifier.horizontalScroll(rememberScrollState())) {
                    CodeText(content)
                }
            }
        }
    }
}

@Composable
private fun FeedbackTriageControls(
    row: FeedbackEntry,
    bridgeEnabled: Boolean,
    updating: Boolean,
    actions: FeedbackQueueActions,
) {
    var draftUrl by remember(row.id, row.githubIssueUrl) { mutableStateOf(row.githubIssueUrl) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Select(
            options = statusEditOptions(),
            selectedValue = row.status,
            onSelect = { value -> if (value != row.status) actions.onUpdateStatus(row.id, value) },
            label = stringResource(R.string.translation_feedback_queue_action_changeStatus),
            enabled = !updating,
        )
        Input(
            value = draftUrl,
            onValueChange = { draftUrl = it },
            label = stringResource(R.string.translation_feedback_queue_action_githubUrl),
            enabled = !updating,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
            Button(
                label = stringResource(R.string.translation_feedback_queue_action_saveUrl),
                onClick = { actions.onSaveUrl(row.id, draftUrl) },
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
                enabled = !updating && draftUrl != row.githubIssueUrl,
            )
            if (bridgeEnabled && row.githubIssueUrl.isEmpty()) {
                Button(
                    label = stringResource(R.string.translation_feedback_queue_action_forward),
                    onClick = { actions.onForward(row.id) },
                    variant = ButtonVariant.Primary,
                    size = ButtonSize.Sm,
                    leadingIcon = FeedbackGlyphs.Bug,
                    enabled = !updating,
                )
            }
        }
    }
}

// ── i18n option lists + label resolvers (web `statusOptions` / `categoryOptions` / badge labels) ────────────

@Composable
private fun statusFilterOptions(): List<SelectOption> =
    listOf(
        SelectOption("", stringResource(R.string.translation_feedback_queue_filter_allStatuses)),
        SelectOption("new", stringResource(R.string.translation_feedback_queue_status_new)),
        SelectOption("triaged", stringResource(R.string.translation_feedback_queue_status_triaged)),
        SelectOption("closed", stringResource(R.string.translation_feedback_queue_status_closed)),
    )

@Composable
private fun categoryFilterOptions(): List<SelectOption> =
    listOf(
        SelectOption("", stringResource(R.string.translation_feedback_queue_filter_allCategories)),
        SelectOption("bug", stringResource(R.string.translation_feedback_category_bug)),
        SelectOption("feature", stringResource(R.string.translation_feedback_category_feature)),
        SelectOption("other", stringResource(R.string.translation_feedback_category_other)),
    )

@Composable
private fun statusEditOptions(): List<SelectOption> =
    listOf(
        SelectOption("new", stringResource(R.string.translation_feedback_queue_status_new)),
        SelectOption("triaged", stringResource(R.string.translation_feedback_queue_status_triaged)),
        SelectOption("closed", stringResource(R.string.translation_feedback_queue_status_closed)),
    )

@Composable
private fun categoryLabel(category: String): String =
    when (category) {
        "bug" -> stringResource(R.string.translation_feedback_category_bug)
        "feature" -> stringResource(R.string.translation_feedback_category_feature)
        else -> stringResource(R.string.translation_feedback_category_other)
    }

@Composable
private fun statusLabel(status: String): String =
    when (status) {
        "new" -> stringResource(R.string.translation_feedback_queue_status_new)
        "triaged" -> stringResource(R.string.translation_feedback_queue_status_triaged)
        else -> stringResource(R.string.translation_feedback_queue_status_closed)
    }

/** A tappable, underlined link rendered as the web `<a>` (opens the GitHub issue in the browser). */
@Composable
private fun LinkText(
    text: String,
    onClick: () -> Unit,
) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.primary,
        textDecoration = TextDecoration.Underline,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.clickable(onClick = onClick),
    )
}

/**
 * Formats the ISO-8601 `created_at` as a localized date-time at the render boundary (web
 * `useDateFormat().formatDateTime`); falls back to the raw string when it cannot be parsed.
 */
private fun formatCreated(
    raw: String,
    locale: Locale,
): String =
    runCatching {
        OffsetDateTime
            .parse(raw)
            .atZoneSameInstant(ZoneId.systemDefault())
            .format(DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM).withLocale(locale))
    }.getOrDefault(raw.ifEmpty { EM_DASH })

// Fixed table column widths (dp) — the synced-scroll DataTable keeps header + rows aligned.
private val CHEVRON_W = 24.dp
private val CREATED_W = 150.dp
private val CATEGORY_W = 120.dp
private val TITLE_W = 220.dp
private val PAGE_ROUTE_W = 150.dp
private val REPORTER_W = 170.dp
private val STATUS_W = 100.dp
private val GITHUB_W = 110.dp
