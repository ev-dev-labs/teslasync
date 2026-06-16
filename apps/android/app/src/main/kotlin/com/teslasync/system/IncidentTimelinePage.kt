// The native Jetpack Compose + Material 3 IncidentTimelinePage system surface — a parity port of
// web/src/features/system/pages/IncidentTimelinePage.tsx, the per-incident post-mortem mounted at
// /system-status/incidents/:id. It reproduces the web page's PageContainer scaffold (title + subtitle + Back
// action), the four GlassPanels (the not-found panel; the incident header with status/severity/source/age + the
// Resolve control; the newest-first Timeline; the add-update form), the resolve ConfirmDialog, and the append/
// resolve toasts — every visible string resolved from the generated res/values catalog (ADR-014), every timestamp
// formatted at the display boundary in the device locale (web useDateFormat).
//
// Composition: [IncidentTimelinePage] is the stateful entry (parses the route id, constructs the view-model over
// the host-wired source, records the one-shot `view.opened` diagnostic, owns the ephemeral draft + confirm-dialog
// state the web keeps in `useState`, threads the toast queue + field/dialog reset signals + the Back deep link);
// [IncidentTimelinePageContent] is the stateless render layer that switches the loading / not-found / success
// surfaces off the bound [UiState].
//
// State matrix (web parity): loading (first load, no data) → the "Loading incident…" body (web `if (isLoading)`);
// success (a decoded incident) → the header + Timeline + add-update surfaces; not-found (a hard first-load failure
// or a missing/non-positive route id, web `error || !incident`) → GlassPanel1 with the "Back to System Status"
// link. A keep-previous-data fold (IncidentTimelinePageViewModel) holds the incident on screen across the post-
// write refetch so an append/resolve never flashes the first-load spinner.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located content + section composables + the toast mapper.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.incidenttimeline

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.feedback.ToastHost
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.incidents.Incident
import io.teslasync.shared.core.presentation.incidents.IncidentUpdateEntry
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale

/** Maximum simultaneously-stacked toasts. */
private const val MAX_TOASTS = 3

/** Toast visible duration before auto-dismiss. */
private const val TOAST_DURATION_MS = 4_000L

/** Maximum add-update message length the textarea accepts (web `maxLength={4000}`). */
private const val MAX_MESSAGE_LENGTH = 4_000

/** Width of the timeline entry's left accent rule (web `border-l-2`). */
private val TIMELINE_RULE_WIDTH = 2.dp

/** Minimum touch target for the not-found "Back to System Status" link (ADR-015 ≥ 48dp). */
private val BACK_LINK_MIN_HEIGHT = 48.dp

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: parses the [rawId] route argument (web `useParams().id` → `numericId`) and constructs the
 * [IncidentTimelinePageViewModel] over the supplied [source] (the host wires the shared S7 IncidentRepository).
 * [logger] defaults to the app's redacting logger.
 */
@Composable
fun IncidentTimelinePage(
    source: IncidentTimelinePageSource,
    rawId: String,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val incidentId = remember(rawId) { parseIncidentId(rawId) }
    val viewModel: IncidentTimelinePageViewModel =
        viewModel(
            key = "${IncidentTimelinePageRegistration.SLUG}:$rawId",
            factory = viewModelFactory { initializer { IncidentTimelinePageViewModel(source, incidentId, logger) } },
        )
    IncidentTimelinePage(viewModel = viewModel, rawId = rawId, modifier = modifier)
}

/**
 * Stateful entry: records the one-shot `view.opened` diagnostic (P1/S11), collects the resolved snapshot + the two
 * in-flight flags, owns the ephemeral draft (web `message` / `nextStatus`) + the confirm-dialog flag (web
 * `confirmResolve`), clears them on the view-model's success signals, hosts the toast queue, and wires the Back
 * deep link (web `navigate('/system-status')`).
 */
@Composable
fun IncidentTimelinePage(
    viewModel: IncidentTimelinePageViewModel,
    rawId: String,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val submitting by viewModel.submitting.collectAsStateWithLifecycle()
    val resolving by viewModel.resolving.collectAsStateWithLifecycle()

    var message by rememberSaveable(rawId) { mutableStateOf("") }
    var nextStatus by rememberSaveable(rawId) { mutableStateOf("") }
    var confirmResolve by rememberSaveable(rawId) { mutableStateOf(false) }

    LaunchedEffect(viewModel) {
        viewModel.appendSucceeded.collect {
            message = ""
            nextStatus = ""
        }
    }
    LaunchedEffect(viewModel) { viewModel.resolveSucceeded.collect { confirmResolve = false } }

    val toastStrings = rememberIncidentTimelineToastStrings()
    val toastQueue = remember { mutableStateListOf<ToastItem>() }
    IncidentTimelineToastPresenter(viewModel, toastQueue, toastStrings)

    val locale = ConfigurationCompat.getLocales(LocalConfiguration.current).get(0) ?: Locale.ROOT
    val uriHandler = LocalUriHandler.current
    val onBack: () -> Unit =
        remember(uriHandler) { { uriHandler.openUri(IncidentTimelinePageRegistration.SYSTEM_STATUS_DEEP_LINK) } }

    Box(modifier = modifier.fillMaxSize()) {
        IncidentTimelinePageContent(
            uiState = uiState,
            rawId = rawId,
            locale = locale,
            submitting = submitting,
            resolving = resolving,
            message = message,
            onMessageChange = { message = it.take(MAX_MESSAGE_LENGTH) },
            nextStatus = nextStatus,
            onNextStatusChange = { nextStatus = it },
            onSubmit = { viewModel.appendUpdate(message, nextStatus) },
            onResolveClick = { confirmResolve = true },
            onBack = onBack,
        )
        ToastHost(toasts = toastQueue, onDismiss = { id -> toastQueue.removeAll { it.id == id } })
    }

    if (confirmResolve) {
        ConfirmDialog(
            title = stringResource(R.string.translation_incidentTimeline_confirmTitle),
            message = stringResource(R.string.translation_incidentTimeline_confirmMessage),
            confirmLabel = stringResource(R.string.translation_incidentTimeline_confirmResolve),
            cancelLabel = stringResource(R.string.translation_incidentTimeline_confirmCancel),
            onConfirm = viewModel::resolve,
            onCancel = { if (!resolving) confirmResolve = false },
            severity = ConfirmSeverity.Warning,
            loading = resolving,
            closeLabel = stringResource(R.string.translation_incidentTimeline_confirmClose),
        )
    }
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body (web root `PageContainer` column). Switches the loading / not-found / success surface
 * off the bound [uiState] and threads the draft + action seams into the success surface. The accessibility pane
 * title is the incident title once loaded, else the generic "Incident" heading (web `usePageTitle`).
 */
@Composable
fun IncidentTimelinePageContent(
    uiState: UiState<Incident>,
    rawId: String,
    locale: Locale,
    submitting: Boolean,
    resolving: Boolean,
    message: String,
    onMessageChange: (String) -> Unit,
    nextStatus: String,
    onNextStatusChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onResolveClick: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val incident = uiState.data
    val paneTitleText = incident?.title ?: stringResource(R.string.translation_incidentTimeline_pageTitle)

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg)
                .semantics { paneTitle = paneTitleText },
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        when {
            incident != null ->
                IncidentSuccessSurface(
                    incident = incident,
                    locale = locale,
                    submitting = submitting,
                    resolving = resolving,
                    message = message,
                    onMessageChange = onMessageChange,
                    nextStatus = nextStatus,
                    onNextStatusChange = onNextStatusChange,
                    onSubmit = onSubmit,
                    onResolveClick = onResolveClick,
                    onBack = onBack,
                )

            uiState.isError -> IncidentNotFoundSurface(rawId = rawId, onBack = onBack)

            else -> IncidentLoadingSurface()
        }
    }
}

// ── Loading surface (web `if (isLoading)`) ──────────────────────────────────────────────────────────────────

/** The first-load surface — the "Incident / Loading…" header over the "Loading incident…" body (web loading branch). */
@Composable
private fun IncidentLoadingSurface() {
    IncidentPageHeader(
        title = stringResource(R.string.translation_incidentTimeline_pageTitle),
        subtitle = stringResource(R.string.translation_incidentTimeline_loadingSubtitle),
        onBack = null,
    )
    BodyText(
        stringResource(R.string.translation_incidentTimeline_loadingBody),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

// ── Not-found surface (GlassPanel1, web `error || !incident`) ────────────────────────────────────────────────

/**
 * GlassPanel1 — the not-found surface (web error/invalid-id branch). The "Incident / Not found" header over a panel
 * carrying the not-found message + the "Back to System Status" link, so the surface is never blank.
 */
@Composable
private fun IncidentNotFoundSurface(
    rawId: String,
    onBack: () -> Unit,
) {
    IncidentPageHeader(
        title = stringResource(R.string.translation_incidentTimeline_pageTitle),
        subtitle = stringResource(R.string.translation_incidentTimeline_notFoundSubtitle),
        onBack = onBack,
    )
    GlassPanel(padding = PanelPadding.Md) {
        BodyText(
            stringResource(R.string.translation_incidentTimeline_notFoundBody, rawId),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        BackToStatusLink(onBack = onBack)
    }
}

/** The "Back to System Status" link — icon + label, navigating to the system-status deep link (web `<Link>`). */
@Composable
private fun BackToStatusLink(onBack: () -> Unit) {
    val label = stringResource(R.string.translation_incidentTimeline_backToStatus)
    Row(
        modifier =
            Modifier
                .padding(top = Spacing.sm)
                .clip(MaterialTheme.shapes.small)
                .clickable(onClick = onBack)
                .heightIn(min = BACK_LINK_MIN_HEIGHT)
                .padding(horizontal = Spacing.xs)
                .semantics {
                    role = Role.Button
                    contentDescription = label
                },
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(IncidentTimelineGlyphs.ArrowLeft, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.primary)
        BodyText(label, color = MaterialTheme.colorScheme.primary)
    }
}

// ── Success surface (GlassPanel2 + GlassPanel3 + GlassPanel4) ────────────────────────────────────────────────

/**
 * The resolved-incident surface — the "title / Incident #id" header over GlassPanel2 (header), GlassPanel3
 * (timeline), and GlassPanel4 (add-update form, only while open). Mirrors the web `space-y-5` success column.
 */
@Composable
private fun IncidentSuccessSurface(
    incident: Incident,
    locale: Locale,
    submitting: Boolean,
    resolving: Boolean,
    message: String,
    onMessageChange: (String) -> Unit,
    nextStatus: String,
    onNextStatusChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onResolveClick: () -> Unit,
    onBack: () -> Unit,
) {
    val resolved = isIncidentResolved(incident.status)

    IncidentPageHeader(
        title = incident.title,
        subtitle = stringResource(R.string.translation_incidentTimeline_subtitle, incident.id.toString()),
        onBack = onBack,
    )
    IncidentHeaderPanel(
        incident = incident,
        locale = locale,
        resolved = resolved,
        resolving = resolving,
        onResolveClick = onResolveClick,
    )
    IncidentTimelinePanel(incident = incident, locale = locale)
    if (!resolved) {
        IncidentAddUpdatePanel(
            incident = incident,
            submitting = submitting,
            message = message,
            onMessageChange = onMessageChange,
            nextStatus = nextStatus,
            onNextStatusChange = onNextStatusChange,
            onSubmit = onSubmit,
        )
    }
}

/** The page header — a title + optional subtitle column, and the trailing Back action (web PageContainer header). */
@Composable
private fun IncidentPageHeader(
    title: String,
    subtitle: String?,
    onBack: (() -> Unit)?,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            PageTitle(title, modifier = Modifier.semantics { heading() })
            if (subtitle != null) {
                HelperText(subtitle)
            }
        }
        if (onBack != null) {
            Button(
                label = stringResource(R.string.translation_incidentTimeline_back),
                onClick = onBack,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = IncidentTimelineGlyphs.ArrowLeft,
            )
        }
    }
}

/**
 * GlassPanel2 — the incident header: the severity glyph, the status badge + severity + source + open/resolved age
 * chips, the description, the affected-components line, the started/resolved timestamps, and the Resolve control
 * (only while open). Web lines 159–201.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun IncidentHeaderPanel(
    incident: Incident,
    locale: Locale,
    resolved: Boolean,
    resolving: Boolean,
    onResolveClick: () -> Unit,
) {
    val severityTone = IncidentSeverityTone.fromWire(incident.severity)
    val nowMs = remember(incident) { System.currentTimeMillis() }

    GlassPanel(padding = PanelPadding.Md) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalAlignment = Alignment.Top) {
            Icon(
                severityGlyph(severityTone),
                contentDescription = null,
                size = IconSize.Lg,
                tint = severityColor(severityTone),
            )
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                    verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    Badge(statusLabel(incident.status), variant = statusBadgeVariant(incident.status))
                    Text(
                        incident.severity.uppercase(locale),
                        style = MaterialTheme.typography.labelSmall,
                        color = severityColor(severityTone),
                    )
                    Caption(incident.source)
                    val age = IncidentTimelineDuration.format(incident.startedAt, incident.resolvedAt, nowMs)
                    if (resolved) {
                        Badge(stringResource(R.string.translation_incidentTimeline_resolvedBadge, age), variant = BadgeVariant.Success)
                    } else {
                        Badge(stringResource(R.string.translation_incidentTimeline_openBadge, age), variant = BadgeVariant.Neutral)
                    }
                }
                if (incident.description.isNotBlank()) {
                    BodyText(incident.description, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (incident.affectedComponents.isNotEmpty()) {
                    Caption(
                        stringResource(
                            R.string.translation_incidentTimeline_affects,
                            incident.affectedComponents.joinToString(", "),
                        ),
                    )
                }
                IncidentStartedLine(incident = incident, locale = locale)
            }
            if (!resolved) {
                Button(
                    label = stringResource(R.string.translation_incidentTimeline_resolve),
                    onClick = onResolveClick,
                    variant = ButtonVariant.Primary,
                    size = ButtonSize.Sm,
                    enabled = !resolving,
                    leadingIcon = IncidentTimelineGlyphs.CheckCircle,
                )
            }
        }
    }
}

/** The "Started … · Resolved …" timestamp line — web's clock-prefixed `started_at` + optional `resolved_at`. */
@Composable
private fun IncidentStartedLine(
    incident: Incident,
    locale: Locale,
) {
    val started = stringResource(R.string.translation_incidentTimeline_started, formatTimestamp(incident.startedAt, locale))
    val resolvedAt = incident.resolvedAt
    val line =
        if (resolvedAt != null) {
            started + stringResource(R.string.translation_incidentTimeline_resolvedSuffix, formatTimestamp(resolvedAt, locale))
        } else {
            started
        }
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
        Icon(IncidentTimelineGlyphs.Clock, contentDescription = null, size = IconSize.Xs, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Caption(line)
    }
}

/**
 * GlassPanel3 — the Timeline: the message-square heading + entry count, then the updates newest-first (web
 * `[...updates].reverse()`), each a left-ruled row of a status badge + timestamp + optional author over the
 * message. Web lines 218–238.
 */
@Composable
private fun IncidentTimelinePanel(
    incident: Incident,
    locale: Locale,
) {
    val entries = timelineEntries(incident)
    GlassPanel(padding = PanelPadding.Md) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(IncidentTimelineGlyphs.MessageSquare, contentDescription = null, size = IconSize.Md)
            SectionTitle(stringResource(R.string.translation_incidentTimeline_timeline))
            Caption(stringResource(R.string.translation_incidentTimeline_entries, entries.size))
        }
        Column(
            modifier = Modifier.padding(top = Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            entries.forEach { entry -> IncidentTimelineRow(entry = entry, locale = locale) }
        }
    }
}

/** One timeline entry — a left accent rule, the status badge + timestamp + optional author, and the message body. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun IncidentTimelineRow(
    entry: IncidentUpdateEntry,
    locale: Locale,
) {
    Row(
        modifier = Modifier.height(IntrinsicSize.Min),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Box(
            modifier =
                Modifier
                    .width(TIMELINE_RULE_WIDTH)
                    .fillMaxHeight()
                    .background(MaterialTheme.colorScheme.outlineVariant),
        )
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Badge(statusLabel(entry.status), variant = statusBadgeVariant(entry.status))
                Caption(formatTimestamp(entry.at, locale))
                val author = entry.author
                if (!author.isNullOrBlank()) {
                    Caption(stringResource(R.string.translation_incidentTimeline_byAuthor, author))
                }
            }
            BodyText(entry.message)
        }
    }
}

/**
 * GlassPanel4 — the add-update form (only while open, web `!isResolved`): a multi-line message field, a status
 * transition select, and the submit button that flips to its in-flight label. Web lines 242–271.
 */
@Composable
private fun IncidentAddUpdatePanel(
    incident: Incident,
    submitting: Boolean,
    message: String,
    onMessageChange: (String) -> Unit,
    nextStatus: String,
    onNextStatusChange: (String) -> Unit,
    onSubmit: () -> Unit,
) {
    val selectLabel = stringResource(R.string.translation_incidentTimeline_statusSelectLabel)
    GlassPanel(padding = PanelPadding.Md) {
        SectionTitle(stringResource(R.string.translation_incidentTimeline_addUpdate))
        Column(
            modifier = Modifier.padding(top = Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Textarea(
                value = message,
                onValueChange = onMessageChange,
                hint = stringResource(R.string.translation_incidentTimeline_messageHint),
                enabled = !submitting,
                minLines = 3,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Select(
                    options = statusTransitionOptions(currentStatus = incident.status),
                    selectedValue = nextStatus,
                    onSelect = onNextStatusChange,
                    modifier = Modifier.weight(1f).semantics { contentDescription = selectLabel },
                    enabled = !submitting,
                )
                Button(
                    label =
                        if (submitting) {
                            stringResource(R.string.translation_incidentTimeline_adding)
                        } else {
                            stringResource(R.string.translation_incidentTimeline_addUpdate)
                        },
                    onClick = onSubmit,
                    variant = ButtonVariant.Primary,
                    enabled = !submitting,
                )
            }
        }
    }
}

/** The status-transition select options — "Keep status as X" plus the four "→ Status" transitions (web select). */
@Composable
private fun statusTransitionOptions(currentStatus: String): List<SelectOption> =
    listOf(
        SelectOption("", stringResource(R.string.translation_incidentTimeline_keepStatus, statusLabel(currentStatus))),
        SelectOption(IncidentLifecycleStatus.Investigating.wire, stringResource(R.string.translation_incidentTimeline_toInvestigating)),
        SelectOption(IncidentLifecycleStatus.Identified.wire, stringResource(R.string.translation_incidentTimeline_toIdentified)),
        SelectOption(IncidentLifecycleStatus.Monitoring.wire, stringResource(R.string.translation_incidentTimeline_toMonitoring)),
        SelectOption(IncidentLifecycleStatus.Resolved.wire, stringResource(R.string.translation_incidentTimeline_toResolved)),
    )

// ── Tone / label resolution (web SEVERITY_TONE / STATUS_BADGE / STATUS_LABEL) ────────────────────────────────

/** Resolves the severity glyph (web `SEVERITY_TONE[severity].Icon`). */
private fun severityGlyph(tone: IncidentSeverityTone): ImageVector =
    when (tone) {
        IncidentSeverityTone.Minor -> IncidentTimelineGlyphs.AlertCircle
        IncidentSeverityTone.Major -> IncidentTimelineGlyphs.AlertTriangle
        IncidentSeverityTone.Critical -> IncidentTimelineGlyphs.AlertOctagon
    }

/** Resolves the severity accent color from the design tokens (web `SEVERITY_TONE[severity].cls`). */
@Composable
private fun severityColor(tone: IncidentSeverityTone): Color =
    when (tone) {
        IncidentSeverityTone.Minor -> TeslaTokens.status.warning
        IncidentSeverityTone.Major -> TeslaTokens.chart.energy
        IncidentSeverityTone.Critical -> TeslaTokens.status.danger
    }

/** Maps a status to its shared badge variant (web `STATUS_BADGE[status]`). */
private fun statusBadgeVariant(status: String): BadgeVariant =
    when (IncidentStatusTone.fromStatus(status)) {
        IncidentStatusTone.Danger -> BadgeVariant.Danger
        IncidentStatusTone.Warning -> BadgeVariant.Warning
        IncidentStatusTone.Info -> BadgeVariant.Info
        IncidentStatusTone.Success -> BadgeVariant.Success
        IncidentStatusTone.Neutral -> BadgeVariant.Neutral
    }

/** Resolves a status to its localized label (web `STATUS_LABEL[status]`); an unknown status renders verbatim. */
@Composable
private fun statusLabel(status: String): String =
    when (IncidentLifecycleStatus.fromWire(status)) {
        IncidentLifecycleStatus.Investigating -> stringResource(R.string.translation_incidentTimeline_status_investigating)
        IncidentLifecycleStatus.Identified -> stringResource(R.string.translation_incidentTimeline_status_identified)
        IncidentLifecycleStatus.Monitoring -> stringResource(R.string.translation_incidentTimeline_status_monitoring)
        IncidentLifecycleStatus.Resolved -> stringResource(R.string.translation_incidentTimeline_status_resolved)
        null -> status
    }

// ── Toasts (web useToast) ───────────────────────────────────────────────────────────────────────────────────

/** The already-localized toast microcopy the presenter reads from the catalog (P1/S10). */
data class IncidentTimelineToastStrings(
    val updateRequired: String,
    val updateAdded: String,
    val appendFailed: String,
    val resolved: String,
    val resolveFailed: String,
)

/** Resolves the toast microcopy from the surface-owned catalog keys. */
@Composable
fun rememberIncidentTimelineToastStrings(): IncidentTimelineToastStrings =
    IncidentTimelineToastStrings(
        updateRequired = stringResource(R.string.translation_incidentTimeline_toastUpdateRequired),
        updateAdded = stringResource(R.string.translation_incidentTimeline_toastUpdateAdded),
        appendFailed = stringResource(R.string.translation_incidentTimeline_toastAppendFailed),
        resolved = stringResource(R.string.translation_incidentTimeline_toastResolved),
        resolveFailed = stringResource(R.string.translation_incidentTimeline_toastResolveFailed),
    )

/**
 * Collects the view-model's one-shot [IncidentTimelineToast]s, maps each to a localized + toned [ToastItem], and
 * feeds the caller-owned [queue] with an auto-dismiss timer — the native analogue of the web `useToast` calls.
 */
@Composable
private fun IncidentTimelineToastPresenter(
    viewModel: IncidentTimelinePageViewModel,
    queue: SnapshotStateList<ToastItem>,
    strings: IncidentTimelineToastStrings,
) {
    val scope = rememberCoroutineScope()
    var seq by remember { mutableLongStateOf(0L) }
    LaunchedEffect(viewModel, strings) {
        viewModel.toasts.collect { toast ->
            val item = toastItem(toast, seq++, strings)
            queue.add(item)
            if (queue.size > MAX_TOASTS) queue.removeAt(0)
            scope.launch {
                delay(TOAST_DURATION_MS)
                queue.removeAll { it.id == item.id }
            }
        }
    }
}

private fun toastItem(
    toast: IncidentTimelineToast,
    id: Long,
    strings: IncidentTimelineToastStrings,
): ToastItem =
    when (toast) {
        IncidentTimelineToast.UpdateRequired -> ToastItem(id, strings.updateRequired, Tone.Danger)
        IncidentTimelineToast.UpdateAdded -> ToastItem(id, strings.updateAdded, Tone.Success)
        is IncidentTimelineToast.AppendFailed ->
            ToastItem(id, toast.detail?.takeIf { it.isNotBlank() } ?: strings.appendFailed, Tone.Danger)
        IncidentTimelineToast.Resolved -> ToastItem(id, strings.resolved, Tone.Success)
        is IncidentTimelineToast.ResolveFailed ->
            ToastItem(id, toast.detail?.takeIf { it.isNotBlank() } ?: strings.resolveFailed, Tone.Danger)
    }
