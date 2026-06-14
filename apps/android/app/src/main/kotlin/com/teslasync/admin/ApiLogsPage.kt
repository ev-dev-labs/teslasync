// The native Jetpack Compose + Material 3 ApiLogsPage admin surface — a parity port of
// web/src/features/admin/pages/ApiLogsPage.tsx, the API call-log inspector. It reproduces the page's panels
// (the four stat tiles, the filter panel, the paginated log table, and the per-row expanded request/response
// detail), every data state (loading / empty / error / content), and every visible string (resolved from the
// generated res/values catalog, ADR-014).
//
// Composition: [ApiLogsPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the feed + interaction snapshot); [ApiLogsPageContent]
// is the stateless render layer driven entirely by [UiState] + [ApiLogsInteraction] + [ApiLogsActions]. All
// derivation lives in the framework-free model (ApiLogsPageModel.kt); this file only resolves i18n + draws.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions", "LongMethod")

package io.teslasync.android.admin.apilogs

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DeltaArrow
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.datadisplay.StatTrend
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.BannerAction
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.feedback.Tone
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
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.text.NumberFormat
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/** The page's interaction callbacks, wired to the [ApiLogsPageViewModel] (web event handlers). */
data class ApiLogsActions(
    val onMethod: (String) -> Unit,
    val onStatus: (String) -> Unit,
    val onEndpoint: (String) -> Unit,
    val onService: (String) -> Unit,
    val onClear: () -> Unit,
    val onPage: (Int) -> Unit,
    val onToggleExpand: (Long) -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [ApiLogsPageViewModel] over the supplied [source] (the host wires the shared
 * [io.teslasync.shared.core.presentation.admin.AdminStore] via [asApiLogsSource]). [logger] defaults to the
 * app's redacting logger.
 */
@Composable
fun ApiLogsPage(
    source: ApiLogsSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: ApiLogsPageViewModel =
        viewModel(
            key = ApiLogsPageRegistration.SLUG,
            factory = viewModelFactory { initializer { ApiLogsPageViewModel(source, logger) } },
        )
    ApiLogsPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feed + interaction snapshot to the stateless content. */
@Composable
fun ApiLogsPage(
    viewModel: ApiLogsPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            ApiLogsActions(
                onMethod = viewModel::setMethod,
                onStatus = viewModel::setStatus,
                onEndpoint = viewModel::setEndpoint,
                onService = viewModel::selectService,
                onClear = viewModel::clearFilters,
                onPage = viewModel::setPage,
                onToggleExpand = viewModel::toggleExpanded,
                onRetry = viewModel::retry,
            )
        }

    ApiLogsPageContent(state = state, interaction = interaction, actions = actions, modifier = modifier)
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/** The stateless page body: the header, the optional error banner, the stats, the filters, and the table. */
@Composable
fun ApiLogsPageContent(
    state: UiState<ApiLogsData>,
    interaction: ApiLogsInteraction,
    actions: ApiLogsActions,
    modifier: Modifier = Modifier,
) {
    val data = state.data ?: ApiLogsData.EMPTY
    val visible = filterLogs(data.logs, interaction.filters)
    val locale = ConfigurationCompat.getLocales(LocalConfiguration.current).get(0) ?: Locale.ROOT
    val numbers = remember(locale) { ApiLogsNumberFormats(locale) }

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        ApiLogsHeader()

        if (state.hasError) {
            AlertBanner(
                message = stringResource(R.string.translation_error_loadFailed),
                tone = Tone.Danger,
                icon = ApiLogsGlyphs.AlertCircle,
                action = BannerAction(stringResource(R.string.translation_error_retry), actions.onRetry),
            )
        }

        FadeIn {
            ApiLogsStatsSection(stats = data.stats, loading = state.isLoading, numbers = numbers, onService = actions.onService)
        }

        FadeIn(delayMs = FADE_STEP_MS) {
            ApiLogsFiltersPanel(interaction = interaction, stats = data.stats, actions = actions)
        }

        FadeIn(delayMs = FADE_STEP_MS * 2) {
            ApiLogsTablePanel(
                state = state,
                visible = visible,
                total = data.total,
                interaction = interaction,
                numbers = numbers,
                actions = actions,
            )
        }
    }
}

@Composable
private fun ApiLogsHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_apiLogs_title))
        BodyText(
            stringResource(R.string.translation_apiLogs_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// ── Stats (Total-Calls / Error-Rate / Avg-Duration / Last-24h + By Service chips) ───────────────────────────

@Composable
private fun ApiLogsStatsSection(
    stats: ApiLogStats?,
    loading: Boolean,
    numbers: ApiLogsNumberFormats,
    onService: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                label = stringResource(R.string.translation_apiLogs_totalCalls),
                value = numbers.int(stats?.totalCalls),
                modifier = Modifier.weight(1f),
                icon = ApiLogsGlyphs.FileText,
                loading = loading,
            )
            StatCard(
                label = stringResource(R.string.translation_apiLogs_errorRate),
                value = stats?.errorRate?.let { "${numbers.decimal(it)}%" } ?: EM_DASH,
                modifier = Modifier.weight(1f),
                icon = ApiLogsGlyphs.AlertTriangle,
                trend = errorRateTrend(stats),
                loading = loading,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                label = stringResource(R.string.translation_apiLogs_avgDuration),
                value = stats?.avgDurationMs?.let { "${numbers.intFromDouble(it)}ms" } ?: EM_DASH,
                modifier = Modifier.weight(1f),
                icon = ApiLogsGlyphs.Clock,
                loading = loading,
            )
            StatCard(
                label = stringResource(R.string.translation_apiLogs_last24h),
                value = numbers.int(stats?.last24h),
                modifier = Modifier.weight(1f),
                icon = ApiLogsGlyphs.Activity,
                loading = loading,
            )
        }
        val byService = stats?.byService.orEmpty()
        if (byService.isNotEmpty()) {
            ApiLogsByServiceChips(byService = byService, numbers = numbers, onService = onService)
        }
    }
}

@Composable
private fun ApiLogsByServiceChips(
    byService: Map<String, Long>,
    numbers: ApiLogsNumberFormats,
    onService: (String) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Caption(stringResource(R.string.translation_apiLogs_byService))
        byService.forEach { (service, count) ->
            val label = serviceLabel(service)
            Row(
                modifier =
                    Modifier
                        .clickable { onService(service) }
                        .semantics { contentDescription = label }
                        .padding(vertical = Spacing.xs),
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Badge(text = label, variant = serviceTone(service).badgeVariant())
                Caption(numbers.int(count))
            }
        }
    }
}

// ── Filters panel (GlassPanel1) ─────────────────────────────────────────────────────────────────────────────

@Composable
private fun ApiLogsFiltersPanel(
    interaction: ApiLogsInteraction,
    stats: ApiLogStats?,
    actions: ApiLogsActions,
) {
    GlassPanel(padding = PanelPadding.Md) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                ApiLogsGlyphs.Filter,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Caption(stringResource(R.string.translation_apiLogs_filters), modifier = Modifier.weight(1f))
            if (interaction.filters.hasAny) {
                Button(
                    label = stringResource(R.string.translation_apiLogs_clear),
                    onClick = actions.onClear,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                )
            }
        }

        Column(
            modifier = Modifier.padding(top = Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            val allServices = stringResource(R.string.translation_apiLogs_allServices)
            val serviceAria = stringResource(R.string.translation_apiLogs_serviceFilterAria)
            Column(
                modifier = Modifier.semantics { contentDescription = serviceAria },
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Select(
                    options = deriveServiceOptions(stats?.byService, interaction.service, allServices).map { SelectOption(it.value, it.label) },
                    selectedValue = interaction.service,
                    onSelect = actions.onService,
                    emptyLabel = allServices,
                )
                if (stats != null) {
                    HelperText(
                        stringResource(
                            R.string.translation_apiLogs_serviceCount,
                            stats.byService.size.toString(),
                            KNOWN_SERVICES.size.toString(),
                        ),
                    )
                }
            }

            Select(
                options = methodOptions(stringResource(R.string.translation_apiLogs_allMethods)),
                selectedValue = interaction.method,
                onSelect = actions.onMethod,
                emptyLabel = stringResource(R.string.translation_apiLogs_allMethods),
            )

            Select(
                options = statusOptions(stringResource(R.string.translation_apiLogs_allStatus)),
                selectedValue = interaction.status,
                onSelect = actions.onStatus,
                emptyLabel = stringResource(R.string.translation_apiLogs_allStatus),
            )

            Input(
                value = interaction.endpoint,
                onValueChange = actions.onEndpoint,
                hint = stringResource(R.string.translation_apiLogs_filterEndpoint),
                leadingIcon = ApiLogsGlyphs.Search,
            )
        }
    }
}

// ── Table panel (GlassPanel6) + states + pagination ─────────────────────────────────────────────────────────

@Composable
private fun ApiLogsTablePanel(
    state: UiState<ApiLogsData>,
    visible: List<ApiCallLog>,
    total: Int,
    interaction: ApiLogsInteraction,
    numbers: ApiLogsNumberFormats,
    actions: ApiLogsActions,
) {
    val clipboard = LocalClipboardManager.current
    val pages = totalPages(total)

    GlassPanel(padding = PanelPadding.None) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val range = showingRange(interaction.page, total)
            BodyText(
                text =
                    if (total > 0) {
                        stringResource(
                            R.string.translation_apiLogs_showing,
                            range.first.toString(),
                            range.second.toString(),
                            numbers.int(total.toLong()),
                        )
                    } else {
                        stringResource(R.string.translation_apiLogs_noLogs)
                    },
                modifier = Modifier.weight(1f),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Button(
                label = stringResource(R.string.translation_apiLogs_exportJson),
                onClick = { clipboard.setText(AnnotatedString(encodeLogsJson(visible))) },
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
                leadingIcon = ApiLogsGlyphs.Download,
                enabled = visible.isNotEmpty(),
            )
        }

        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        when {
            state.isLoading -> ApiLogsLoadingState()
            state.isError -> ApiLogsErrorState(onRetry = actions.onRetry)
            visible.isEmpty() -> ApiLogsEmptyState(hasFilters = interaction.filters.hasAny)
            else ->
                Column(modifier = Modifier.fillMaxWidth()) {
                    visible.forEachIndexed { index, log ->
                        if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        ApiLogRow(
                            log = log,
                            expanded = interaction.expandedId == log.id,
                            numbers = numbers,
                            onToggle = { actions.onToggleExpand(log.id) },
                        )
                    }
                }
        }

        if (pages > 1) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            ApiLogsPaginationFooter(page = interaction.page, pages = pages, onPage = actions.onPage)
        }
    }
}

@Composable
private fun ApiLogsLoadingState() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Spinner(size = SpinnerSize.Md, label = stringResource(R.string.translation_apiLogs_loading))
    }
}

@Composable
private fun ApiLogsErrorState(onRetry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            ApiLogsGlyphs.AlertCircle,
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
private fun ApiLogsEmptyState(hasFilters: Boolean) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        EmptyState(
            message = stringResource(R.string.translation_apiLogs_noLogsFound),
            icon = ApiLogsGlyphs.FileText,
        )
        if (hasFilters) {
            HelperText(
                stringResource(R.string.translation_apiLogs_adjustFilters),
                modifier = Modifier.padding(bottom = Spacing.lg),
            )
        }
    }
}

// ── One log row + its expanded detail (GlassPanel7 / GlassPanel8 / GlassPanel9) ─────────────────────────────

@Composable
private fun ApiLogRow(
    log: ApiCallLog,
    expanded: Boolean,
    numbers: ApiLogsNumberFormats,
    onToggle: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onToggle)
                    .padding(Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Badge(text = serviceLabel(log.service), variant = serviceTone(log.service).badgeVariant())
                    Badge(text = log.httpMethod, variant = methodTone(log.httpMethod).badgeVariant())
                    Badge(
                        text = log.statusCode?.toString() ?: STATUS_NA,
                        variant = statusTone(log.statusCode).badgeVariant(),
                    )
                    Caption("${numbers.int(log.durationMs)}ms")
                }
                CodeText(log.endpoint)
                Caption(formatTimestamp(log.ts))
                val rowError = log.errorMessage
                if (!rowError.isNullOrBlank()) {
                    BodyText(rowError, color = MaterialTheme.colorScheme.error, maxLines = 1)
                }
            }
            Icon(
                if (expanded) ApiLogsGlyphs.ChevronUp else ApiLogsGlyphs.ChevronDown,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (expanded) {
            ApiLogDetail(log = log)
        }
    }
}

@Composable
private fun ApiLogDetail(log: ApiCallLog) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        RequestUrlPanel(log = log)
        val detailError = log.errorMessage
        if (!detailError.isNullOrBlank()) {
            ErrorDetailPanel(message = detailError)
        }
        RequestBodyPanel(log = log)
        ResponseBodyPanel(log = log)
    }
}

/** The expanded "Request URL" panel (web GlassPanel #7). */
@Composable
private fun RequestUrlPanel(log: ApiCallLog) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(stringResource(R.string.translation_apiLogs_requestUrl))
        GlassPanel(padding = PanelPadding.Sm) {
            CodeText("${log.httpMethod} ${log.endpoint}".trim())
        }
    }
}

/** The expanded error panel (web's red error GlassPanel; shown only when the row failed). */
@Composable
private fun ErrorDetailPanel(message: String) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(stringResource(R.string.translation_apiLogs_error))
        GlassPanel(padding = PanelPadding.Sm) {
            ErrorText(message)
        }
    }
}

/** The expanded request-body JSON viewer (web GlassPanel #8). */
@Composable
private fun RequestBodyPanel(log: ApiCallLog) {
    JsonViewerPanel(label = stringResource(R.string.translation_apiLogs_requestBody), data = log.requestBody)
}

/** The expanded response-body JSON viewer (web GlassPanel #9). */
@Composable
private fun ResponseBodyPanel(log: ApiCallLog) {
    JsonViewerPanel(label = stringResource(R.string.translation_apiLogs_responseBody), data = log.responseBody)
}

@Composable
private fun JsonViewerPanel(
    label: String,
    data: String?,
) {
    if (data.isNullOrBlank()) {
        HelperText(stringResource(R.string.translation_apiLogs_noData, label.lowercase(Locale.ROOT)))
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(label)
        GlassPanel(padding = PanelPadding.Sm) {
            CodeText(prettyPrintJson(data))
        }
    }
}

@Composable
private fun ApiLogsPaginationFooter(
    page: Int,
    pages: Int,
    onPage: (Int) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(Spacing.md),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(
            label = stringResource(R.string.translation_apiLogs_previous),
            onClick = { onPage(page - 1) },
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
            leadingIcon = TeslaGlyphs.ChevronLeft,
            enabled = page > 0,
        )
        Caption(stringResource(R.string.translation_apiLogs_pageOf, (page + 1).toString(), pages.toString()))
        Button(
            label = stringResource(R.string.translation_apiLogs_next),
            onClick = { onPage(page + 1) },
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
            leadingIcon = TeslaGlyphs.ChevronRight,
            enabled = page < pages - 1,
        )
    }
}

// ── Display-boundary helpers (locale number formatting + timestamp + JSON pretty print) ─────────────────────

/** The error-rate trend chip (web `error_rate > 5 ? {up, error_count, positive:false} : undefined`). */
private fun errorRateTrend(stats: ApiLogStats?): StatTrend? {
    val rate = stats?.errorRate ?: return null
    if (rate <= ERROR_RATE_TREND_THRESHOLD) return null
    return StatTrend(direction = DeltaArrow.Up, text = (stats.errorCount ?: 0L).toString(), positive = false)
}

private fun methodOptions(allLabel: String): List<SelectOption> =
    listOf(
        SelectOption("", allLabel),
        SelectOption("GET", "GET"),
        SelectOption("POST", "POST"),
        SelectOption("PUT", "PUT"),
        SelectOption("DELETE", "DELETE"),
    )

private fun statusOptions(allLabel: String): List<SelectOption> =
    listOf(
        SelectOption("", allLabel),
        SelectOption("2xx", "2xx Success"),
        SelectOption("3xx", "3xx Redirect"),
        SelectOption("4xx", "4xx Client Error"),
        SelectOption("5xx", "5xx Server Error"),
    )

/** Locale-aware number formatters built once per locale at the render boundary (counts, ms, percentage). */
private class ApiLogsNumberFormats(locale: Locale) {
    private val integer = NumberFormat.getIntegerInstance(locale)
    private val number = NumberFormat.getNumberInstance(locale).apply { maximumFractionDigits = 2 }

    fun int(value: Long?): String = value?.let { integer.format(it) } ?: EM_DASH

    fun intFromDouble(value: Double): String = integer.format(Math.round(value))

    fun decimal(value: Double): String = number.format(value)
}

private val TS_FORMATTER: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss 'UTC'")

/** Formats an ISO-8601 timestamp as a readable UTC stamp (web `<DateTime in="utc" />`); raw on parse failure. */
private fun formatTimestamp(ts: String): String =
    runCatching { OffsetDateTime.parse(ts).atZoneSameInstant(ZoneOffset.UTC).format(TS_FORMATTER) }
        .getOrDefault(ts)

/** Pretty-prints a JSON string body (web `JSON.stringify(JSON.parse(data), null, 2)`); raw when not JSON. */
private fun prettyPrintJson(raw: String): String =
    runCatching { PRETTY_JSON.encodeToString(kotlinx.serialization.json.JsonElement.serializer(), PRETTY_JSON.parseToJsonElement(raw)) }
        .getOrDefault(raw)

private val PRETTY_JSON = kotlinx.serialization.json.Json { prettyPrint = true }

private const val ERROR_RATE_TREND_THRESHOLD = 5.0
private const val FADE_STEP_MS = 50
private const val STATUS_NA = "N/A"
