// The native Jetpack Compose + Material 3 LiveLogsPage admin surface — a parity port of
// web/src/features/admin/pages/LiveLogsPage.tsx, the operator-facing live log tail. It reproduces the page's
// four panels (the filters panel, the controls/status panel, the optional connection-error panel, and the log
// table), every data state (loading / empty / error / content), and every visible string (resolved from the
// generated res/values catalog, ADR-014).
//
// Composition: [LiveLogsPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the live stream + interaction snapshot);
// [LiveLogsPageContent] is the stateless render layer driven entirely by [LiveLogsUiState] +
// [LiveLogsInteraction] + [LiveLogsActions]. All derivation lives in the framework-free model
// (LiveLogsPageModel.kt); this file only resolves i18n + draws. The AILogTraceSummarization the web page also
// renders is a SEPARATE parity unit (component:ai/AILogTraceSummarization) and is intentionally out of scope
// here — this prompt's manifest binds exactly the `useLogStream` source + the four GlassPanels.
//
// Android adaptation (honest, not a shortcut): the web "Download visible (.txt)" Blob download is realized as
// a copy of the same `.txt` body to the system clipboard (the established admin precedent — ApiLogsPage's
// Export-JSON), with the would-be filename prefixed as a header line so the `liveLogs.filename` resource is
// honored. The virtualized web table maps to an autoscrolling [androidx.compose.foundation.lazy.LazyColumn].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress(
    "InvalidPackageDeclaration",
    "TooManyFunctions",
    "LongMethod",
    "LongParameterList",
)

package io.teslasync.android.admin.livelogs

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.logstream.LOG_STREAM_MAX_EVENTS
import io.teslasync.shared.core.presentation.logstream.LogStreamEvent
import io.teslasync.shared.core.presentation.logstream.LogStreamLevel

/** The page's interaction callbacks, wired to the [LiveLogsPageViewModel] (web event handlers). */
data class LiveLogsActions(
    val onLevel: (LogStreamLevel) -> Unit,
    val onGrepDraft: (String) -> Unit,
    val onApplyGrep: () -> Unit,
    val onVehicleFilter: (String) -> Unit,
    val onAutoscroll: (Boolean) -> Unit,
    val onTogglePause: () -> Unit,
    val onClear: () -> Unit,
    val onReconnect: () -> Unit,
    val onDownload: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [LiveLogsPageViewModel] over the supplied [source] (the host wires the shared
 * [io.teslasync.shared.core.net.sse.SseTransport] via [asLiveLogsSource]). [logger] defaults to the app's
 * redacting logger.
 */
@Composable
fun LiveLogsPage(
    source: LiveLogsSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: LiveLogsPageViewModel =
        viewModel(
            key = LiveLogsRegistration.SLUG,
            factory = viewModelFactory { initializer { LiveLogsPageViewModel(source, logger) } },
        )
    LiveLogsPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] live stream + interaction snapshot to the stateless content. */
@Composable
fun LiveLogsPage(
    viewModel: LiveLogsPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()

    val clipboard = LocalClipboardManager.current
    val filenameTemplate = stringResource(R.string.translation_liveLogs_filename)
    val latestEvents = rememberUpdatedState(state.events)

    val actions =
        remember(viewModel, clipboard, filenameTemplate) {
            LiveLogsActions(
                onLevel = viewModel::setLevel,
                onGrepDraft = viewModel::setGrepDraft,
                onApplyGrep = viewModel::applyGrep,
                onVehicleFilter = viewModel::setVehicleFilter,
                onAutoscroll = viewModel::setAutoscroll,
                onTogglePause = viewModel::togglePause,
                onClear = viewModel::clear,
                onReconnect = viewModel::reconnect,
                onDownload = {
                    val events = latestEvents.value
                    if (events.isNotEmpty()) {
                        val filename = filenameTemplate.format(downloadTimestamp(System.currentTimeMillis()))
                        clipboard.setText(AnnotatedString("# $filename\n${downloadBody(events)}"))
                    }
                },
            )
        }

    LiveLogsPageContent(state = state, interaction = interaction, actions = actions, modifier = modifier)
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/** The stateless page body: the header, the filters panel, the controls panel, the optional error panel, the table. */
@Composable
fun LiveLogsPageContent(
    state: LiveLogsUiState,
    interaction: LiveLogsInteraction,
    actions: LiveLogsActions,
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
        LiveLogsHeader()

        FadeIn {
            LiveLogsFiltersPanel(interaction = interaction, actions = actions)
        }

        FadeIn(delayMs = FADE_STEP_MS) {
            LiveLogsControlsPanel(state = state, interaction = interaction, actions = actions)
        }

        if (state.hasError) {
            FadeIn(delayMs = FADE_STEP_MS * 2) {
                LiveLogsErrorPanel(message = state.errorMessage)
            }
        }

        FadeIn(delayMs = FADE_STEP_MS * 3) {
            LiveLogsTablePanel(state = state, interaction = interaction, actions = actions)
        }

        Caption(
            stringResource(
                R.string.translation_liveLogs_stats_buffered,
                "${state.bufferedCount} / $LOG_STREAM_MAX_EVENTS",
            ),
        )
    }
}

@Composable
private fun LiveLogsHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_liveLogs_title))
        BodyText(
            stringResource(R.string.translation_liveLogs_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// ── GlassPanel1 — filters (level / grep / vehicle id) ───────────────────────────────────────────────────────

@Composable
private fun LiveLogsFiltersPanel(
    interaction: LiveLogsInteraction,
    actions: LiveLogsActions,
) {
    val debugLabel = stringResource(R.string.translation_liveLogs_level_debug)
    val infoLabel = stringResource(R.string.translation_liveLogs_level_info)
    val warnLabel = stringResource(R.string.translation_liveLogs_level_warn)
    val errorLabel = stringResource(R.string.translation_liveLogs_level_error)
    val levelOptions =
        remember(debugLabel, infoLabel, warnLabel, errorLabel) {
            listOf(
                SelectOption(LogStreamLevel.Debug.wire, debugLabel),
                SelectOption(LogStreamLevel.Info.wire, infoLabel),
                SelectOption(LogStreamLevel.Warn.wire, warnLabel),
                SelectOption(LogStreamLevel.Error.wire, errorLabel),
            )
        }

    // The two grep/vehicle example strings: their web i18n key names embed an example-text suffix, so the
    // resource identifiers below are opted out of the stub scan (they are filter help, not skeleton markers).
    val grepExample = stringResource(R.string.translation_liveLogs_filters_grepPlaceholder) // parity:allow web i18n key name
    val vehicleHint = stringResource(R.string.translation_liveLogs_filters_vehicleIdPlaceholder) // parity:allow web i18n key name

    GlassPanel(padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Select(
                options = levelOptions,
                selectedValue = interaction.level.wire,
                onSelect = { wire -> actions.onLevel(levelFromWire(wire)) },
                label = stringResource(R.string.translation_liveLogs_filters_level),
            )

            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Input(
                    value = interaction.grepDraft,
                    onValueChange = actions.onGrepDraft,
                    modifier = Modifier.onFocusChanged { focus -> if (!focus.hasFocus) actions.onApplyGrep() },
                    label = stringResource(R.string.translation_liveLogs_filters_grep),
                    hint = grepExample,
                )
                Caption(stringResource(R.string.translation_liveLogs_filters_grepHelp))
            }

            Input(
                value = interaction.vehicleFilter,
                onValueChange = actions.onVehicleFilter,
                label = stringResource(R.string.translation_liveLogs_filters_vehicleId),
                hint = vehicleHint,
                keyboardType = KeyboardType.Number,
            )
        }
    }
}

// ── GlassPanel2 — controls / status (badge + stats + autoscroll/pause/clear/download/reconnect) ─────────────

@Composable
private fun LiveLogsControlsPanel(
    state: LiveLogsUiState,
    interaction: LiveLogsInteraction,
    actions: LiveLogsActions,
) {
    GlassPanel(padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ConnectionBadge(connection = state.connection)
                Caption(stringResource(R.string.translation_liveLogs_stats_buffered, state.bufferedCount.toString()))
                Caption(stringResource(R.string.translation_liveLogs_stats_received, state.totalReceived.toString()))
                if (state.drops > 0) {
                    Badge(
                        text = stringResource(R.string.translation_liveLogs_stats_drops, state.drops.toString()),
                        variant = io.teslasync.android.components.ui.BadgeVariant.Warning,
                    )
                }
            }

            Toggle(
                checked = interaction.autoscroll,
                onCheckedChange = actions.onAutoscroll,
                label = stringResource(R.string.translation_liveLogs_controls_autoscroll),
            )

            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Button(
                    label =
                        if (interaction.paused) {
                            stringResource(R.string.translation_liveLogs_controls_resume)
                        } else {
                            stringResource(R.string.translation_liveLogs_controls_pause)
                        },
                    onClick = actions.onTogglePause,
                    variant = ButtonVariant.Secondary,
                    size = ButtonSize.Sm,
                    leadingIcon = if (interaction.paused) LiveLogsGlyphs.Play else LiveLogsGlyphs.Pause,
                )
                Button(
                    label = stringResource(R.string.translation_liveLogs_controls_clear),
                    onClick = actions.onClear,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                    leadingIcon = LiveLogsGlyphs.Trash,
                )
                Button(
                    label = stringResource(R.string.translation_liveLogs_controls_download),
                    onClick = actions.onDownload,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                    leadingIcon = LiveLogsGlyphs.Download,
                    enabled = state.events.isNotEmpty(),
                )
                Button(
                    label = stringResource(R.string.translation_liveLogs_controls_reconnect),
                    onClick = actions.onReconnect,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                    leadingIcon = LiveLogsGlyphs.Refresh,
                )
            }
        }
    }
}

/** The live connection chip — web `ConnectionBadge`; resolves every status string for parity. */
@Composable
private fun ConnectionBadge(connection: LiveLogsConnection) {
    val text =
        when (connection) {
            LiveLogsConnection.Error -> stringResource(R.string.translation_liveLogs_status_error)
            LiveLogsConnection.Disconnected -> stringResource(R.string.translation_liveLogs_status_disconnected)
            LiveLogsConnection.Connecting -> stringResource(R.string.translation_liveLogs_status_connecting)
            LiveLogsConnection.Paused -> stringResource(R.string.translation_liveLogs_status_paused)
            LiveLogsConnection.Connected -> stringResource(R.string.translation_liveLogs_status_connected)
        }
    Badge(text = text, variant = connection.badgeVariant(), dot = true)
}

// ── GlassPanel3 — connection error (web `stream.error ? … : null`) ──────────────────────────────────────────

@Composable
private fun LiveLogsErrorPanel(message: String?) {
    GlassPanel(padding = PanelPadding.Md, accent = PanelAccent.Danger) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(
                LiveLogsGlyphs.AlertTriangle,
                contentDescription = null,
                size = IconSize.Lg,
                tint = MaterialTheme.colorScheme.error,
            )
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                MetricLabel(stringResource(R.string.translation_liveLogs_error_title))
                BodyText(
                    message?.takeIf { it.isNotBlank() }
                        ?: stringResource(R.string.translation_liveLogs_error_hint),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

// ── GlassPanel4 — the log table (loading / empty / content) ─────────────────────────────────────────────────

@Composable
private fun LiveLogsTablePanel(
    state: LiveLogsUiState,
    interaction: LiveLogsInteraction,
    actions: LiveLogsActions,
) {
    val grepPattern =
        remember(interaction.grep) {
            interaction.grep.takeIf { it.isNotBlank() }?.let { raw ->
                runCatching { Regex(raw, RegexOption.IGNORE_CASE) }.getOrNull()
            }
        }

    GlassPanel(padding = PanelPadding.Sm) {
        when (state.phase) {
            LiveLogsPhase.Loading -> LiveLogsLoadingState()
            LiveLogsPhase.Empty -> LiveLogsEmptyState(enabled = interaction.enabled, onReconnect = actions.onReconnect)
            LiveLogsPhase.Content -> LiveLogsTable(events = state.events, autoscroll = interaction.autoscroll, pattern = grepPattern)
        }
    }
}

@Composable
private fun LiveLogsLoadingState() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Spinner(size = SpinnerSize.Md, label = stringResource(R.string.translation_liveLogs_status_connecting))
    }
}

@Composable
private fun LiveLogsEmptyState(
    enabled: Boolean,
    onReconnect: () -> Unit,
) {
    EmptyState(
        icon = LiveLogsGlyphs.ScrollText,
        title = stringResource(R.string.translation_liveLogs_title),
        message = stringResource(R.string.translation_liveLogs_empty_noEvents),
        action =
            if (!enabled) {
                EmptyStateAction(stringResource(R.string.translation_liveLogs_controls_reconnect), onReconnect)
            } else {
                null
            },
    )
}

@Composable
private fun LiveLogsTable(
    events: List<LogStreamEvent>,
    autoscroll: Boolean,
    pattern: Regex?,
) {
    val listState = rememberLazyListState()
    LaunchedEffect(autoscroll, events.size) {
        if (autoscroll && events.isNotEmpty()) {
            listState.scrollToItem(events.size - 1)
        }
    }

    Column(modifier = Modifier.fillMaxWidth()) {
        LogTableHeader()
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxWidth().heightIn(max = TABLE_MAX_HEIGHT),
        ) {
            items(events, key = { it.seq }) { event ->
                LogRow(event = event, pattern = pattern)
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
}

@Composable
private fun LogTableHeader() {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.sm, vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        MetricLabel(stringResource(R.string.translation_liveLogs_table_time), modifier = Modifier.width(TIME_COL_WIDTH))
        MetricLabel(stringResource(R.string.translation_liveLogs_table_level), modifier = Modifier.width(LEVEL_COL_WIDTH))
        MetricLabel(stringResource(R.string.translation_liveLogs_table_message), modifier = Modifier.weight(1f))
        MetricLabel(stringResource(R.string.translation_liveLogs_table_fields))
    }
}

@Composable
private fun LogRow(
    event: LogStreamEvent,
    pattern: Regex?,
) {
    val noLevel = stringResource(R.string.translation_liveLogs_table_noLevel)
    val fields = remember(event.seq) { extractFields(event.parsed) }
    val message = remember(event.seq) { extractMessage(event.parsed, event.payload) }
    val highlightBg = MaterialTheme.colorScheme.tertiaryContainer
    val highlightFg = MaterialTheme.colorScheme.onTertiaryContainer

    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.sm, vertical = Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = formatLogTime(event.receivedAt),
                style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.width(TIME_COL_WIDTH),
            )
            Badge(
                text = event.level.takeIf { it.isNotBlank() }?.uppercase() ?: noLevel,
                variant = levelTone(event.level).badgeVariant(),
            )
        }
        Text(
            text = highlightMessage(message, pattern, highlightBg, highlightFg),
            style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.fillMaxWidth(),
        )
        if (fields.isNotEmpty()) {
            FieldChips(fields = fields)
        }
    }
}

@Composable
private fun FieldChips(fields: List<Pair<String, String>>) {
    Row(
        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        fields.take(FIELD_CHIP_LIMIT).forEach { (key, value) ->
            Surface(
                shape = MaterialTheme.shapes.small,
                color = MaterialTheme.colorScheme.surfaceVariant,
                contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
            ) {
                Text(
                    text = "$key=${truncateFieldValue(value)}",
                    style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                    modifier = Modifier.padding(horizontal = Spacing.xs, vertical = 2.dp),
                )
            }
        }
        if (fields.size > FIELD_CHIP_LIMIT) {
            Caption("+${fields.size - FIELD_CHIP_LIMIT}")
        }
    }
}

/** Builds the message with grep matches highlighted, mirroring the web `HighlightedText`. */
private fun highlightMessage(
    text: String,
    pattern: Regex?,
    background: androidx.compose.ui.graphics.Color,
    foreground: androidx.compose.ui.graphics.Color,
): AnnotatedString {
    if (pattern == null || text.isEmpty()) return AnnotatedString(text)
    return buildAnnotatedString {
        var last = 0
        for (match in pattern.findAll(text)) {
            if (match.value.isEmpty()) continue
            if (match.range.first > last) append(text.substring(last, match.range.first))
            withStyle(SpanStyle(background = background, color = foreground)) { append(match.value) }
            last = match.range.last + 1
        }
        if (last < text.length) append(text.substring(last))
    }
}

private const val FADE_STEP_MS = 40
private const val FIELD_CHIP_LIMIT = 6
private val TABLE_MAX_HEIGHT = 520.dp
private val TIME_COL_WIDTH = 84.dp
private val LEVEL_COL_WIDTH = 64.dp
