// The native Jetpack Compose + Material 3 DiagnosticPage system surface — a parity port of
// web/src/features/system/pages/DiagnosticPage.tsx, the operator-facing self-test wizard. It reproduces the web
// page's header (title + subtitle + the Run/Re-run action), the conditional error banner (GlassPanel1), the overall
// hero badge (GlassPanel2), the per-check cards (GlassPanel3), the running spinner panel (GlassPanel4), and the
// no-report empty state (GlassPanel5) — every visible string resolved from the generated res/values catalog
// (ADR-014). No value here is unit-bearing (durations are raw milliseconds the backend labels, statuses are backend
// enums, stamps are ISO strings), so there is no SI conversion at the render boundary (S5).
//
// Composition: [DiagnosticPage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the resolved phase, and threads the accessibility pane title);
// [DiagnosticPageContent] is the stateless render layer that switches the loading / empty / success surfaces off the
// bound [DiagnosticUiState] and threads each probe row into a check card.
//
// State matrix (web parity): the page never auto-runs (the endpoint is expensive + rate-limited). idle → the
// no-report empty state (GlassPanel5); running → the centered spinner panel (GlassPanel4); success → the overall hero
// (GlassPanel2) + per-check cards (GlassPanel3) + the Copy/Download actions; failed → the error banner (GlassPanel1)
// AND the no-report empty state, with the Run button doubling as the retry affordance — exactly as the web page shows
// both once the mutation rejects (its `data` resets to undefined while `latestError` is set).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located content + section composables.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.diagnostic

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
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
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.sharedsurfaces.copybutton.CopyButton
import io.teslasync.android.sharedsurfaces.toast.LocalToastController
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.systemdiagnostic.DiagnosticCheck
import io.teslasync.shared.core.presentation.systemdiagnostic.DiagnosticReport
import io.teslasync.shared.core.presentation.systemdiagnostic.formatDiagnosticReportText

/** The MIME type the downloaded report is created as — the web `type: 'text/plain;charset=utf-8'`. */
private const val MIME_TEXT_PLAIN = "text/plain"

/** Low-alpha wash behind a tone bubble's glyph — the web `bg-{tone}-500/10` affordance. */
private const val TONE_BUBBLE_ALPHA = 0.12f

/** Diameter of the overall-hero tone bubble — the web `h-12 w-12`. */
private val BubbleHeroSize: Dp = 48.dp

/** Diameter of a per-check tone bubble — the web `h-9 w-9`. */
private val BubbleCheckSize: Dp = 36.dp

/** Corner radius of the remediation callout box — the web `rounded-md`. */
private val RemediationRadius: Dp = 8.dp

// ── Stateful entry points ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [DiagnosticPageViewModel] over the supplied [source] (the host wires the shared
 * SystemDiagnosticStore via [diagnosticPageSourceOf]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun DiagnosticPage(
    source: DiagnosticPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: DiagnosticPageViewModel =
        viewModel(
            key = DiagnosticPageRegistration.SLUG,
            factory = DiagnosticPageViewModel.factory(source, logger),
        )
    DiagnosticPage(viewModel = viewModel, modifier = modifier)
}

/**
 * Stateful entry: records the one-shot `view.opened` diagnostic (P1/S11), collects the resolved run phase, and hands
 * the stateless content the run action + the accessibility pane title (web `usePageTitle(t('diagnostic.title'))`).
 */
@Composable
fun DiagnosticPage(
    viewModel: DiagnosticPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val title = stringResource(R.string.translation_diagnostic_title)
    DiagnosticPageContent(
        uiState = uiState,
        onRun = viewModel::run,
        modifier = modifier.semantics { paneTitle = title },
    )
}

// ── Stateless content ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body (web root `PageContainer` column). Renders the header (title + subtitle + Run action), then
 * the FadeIn body: the conditional error banner (GlassPanel1), the overall hero (GlassPanel2) + Copy/Download actions
 * when a report is loaded, and finally the per-check cards (GlassPanel3) / the running spinner (GlassPanel4) / the
 * no-report empty state (GlassPanel5).
 */
@Composable
fun DiagnosticPageContent(
    uiState: DiagnosticUiState,
    onRun: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val report = uiState.report
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        DiagnosticHeader(uiState = uiState, onRun = onRun)

        FadeIn {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                if (uiState is DiagnosticUiState.Failed) {
                    DiagnosticErrorBanner(message = uiState.message)
                }

                if (report != null) {
                    DiagnosticOverallHero(report = report)
                    DiagnosticActions(report = report)
                }

                when {
                    report != null -> DiagnosticCheckList(checks = report.checks)
                    uiState.isRunning -> DiagnosticRunningPanel()
                    else -> DiagnosticEmptyReport(onRun = onRun)
                }
            }
        }
    }
}

/** The page header — the title + subtitle and the Run/Re-run action (web `PageContainer` title/subtitle/actions). */
@Composable
private fun DiagnosticHeader(
    uiState: DiagnosticUiState,
    onRun: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        PageTitle(stringResource(R.string.translation_diagnostic_title))
        BodyText(
            stringResource(R.string.translation_diagnostic_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            DiagnosticRunButton(uiState = uiState, onRun = onRun)
        }
    }
}

/**
 * The Run / Re-run action (web `runButton`). While a probe set is in flight it shows the running label + the button's
 * own spinner and is disabled; once a report exists it shows the Re-run label + the refresh glyph; otherwise the Run
 * label + the play glyph. After a failure it returns to the Run label (web `data` resets to undefined), serving as the
 * retry affordance.
 */
@Composable
private fun DiagnosticRunButton(
    uiState: DiagnosticUiState,
    onRun: () -> Unit,
) {
    val running = uiState.isRunning
    val hasReport = uiState.hasReport
    val label =
        when {
            running -> stringResource(R.string.translation_diagnostic_running)
            hasReport -> stringResource(R.string.translation_diagnostic_rerun)
            else -> stringResource(R.string.translation_diagnostic_run)
        }
    Button(
        label = label,
        onClick = onRun,
        variant = ButtonVariant.Primary,
        enabled = !running,
        loading = running,
        leadingIcon = if (hasReport) DiagnosticGlyphs.RefreshCw else DiagnosticGlyphs.PlayCircle,
    )
}

/**
 * GlassPanel1 — the error banner (web `{latestError && <GlassPanel className="border-rose-500/30">…}`). Shows the
 * failure title, the shield-alert glyph, and the run's [message] (falling back to the generic error body when the
 * failure carried no message, web `latestError.message || t('diagnostic.errorBody')`).
 */
@Composable
private fun DiagnosticErrorBanner(message: String?) {
    val errorTitle = stringResource(R.string.translation_diagnostic_errorTitle)
    val body = message?.takeIf { it.isNotBlank() } ?: stringResource(R.string.translation_diagnostic_errorBody)
    GlassPanel(
        modifier = Modifier.semantics { contentDescription = errorTitle },
        padding = PanelPadding.Md,
        accent = PanelAccent.Danger,
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(
                DiagnosticGlyphs.ShieldAlert,
                contentDescription = null,
                size = IconSize.Lg,
                tint = TeslaTokens.status.danger,
            )
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PanelTitle(errorTitle)
                BodyText(body, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/**
 * GlassPanel2 — the overall hero (web `OverallHero`). The tone bubble + the rolled-up verdict label + the "Generated …"
 * caption on the left, and the check-count badge on the right, all tinted by the overall status' tone.
 */
@Composable
private fun DiagnosticOverallHero(report: DiagnosticReport) {
    val tone = toneForOverallStatus(report.overallStatus)
    GlassPanel(padding = PanelPadding.Lg) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            DiagnosticToneBubble(
                color = diagnosticToneColor(tone),
                glyph = overallStatusGlyph(report.overallStatus),
                diameter = BubbleHeroSize,
                iconSize = IconSize.Xl,
            )
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Heading(overallStatusLabel(report.overallStatus), level = HeadingLevel.Page)
                Caption(
                    stringResource(R.string.translation_diagnostic_lastRun, formatGeneratedAt(report.generatedAt)),
                )
            }
            Badge(
                text =
                    pluralStringResource(
                        R.plurals.translation_diagnostic_checkCount,
                        report.checks.size,
                        report.checks.size,
                    ),
                variant = diagnosticToneBadgeVariant(tone),
            )
        }
    }
}

/**
 * The Copy / Download action row (web `diagnostic-actions`). Copy writes the pretty-printed report JSON to the
 * clipboard (web `CopyButton text={reportJson} withToast`); Download saves the plain-text report as a `.txt`.
 */
@Composable
private fun DiagnosticActions(report: DiagnosticReport) {
    val reportJson = remember(report) { diagnosticReportJson(report) }
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CopyButton(
            text = reportJson,
            label = stringResource(R.string.translation_diagnostic_copyReport),
            withToast = true,
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Md,
        )
        DiagnosticDownloadButton(report = report)
    }
}

/**
 * The Download-.txt action (web `handleDownload`). Opens the Storage Access Framework create-document picker seeded
 * with the `diagnostic.filename` name, writes the plain-text report (web `formatDiagnosticReportText`) to the chosen
 * location, and — on a successful write — raises the success toast through the optional shared toast holder (web
 * `useOptionalToast`, which no-ops when no host is mounted).
 */
@Composable
private fun DiagnosticDownloadButton(report: DiagnosticReport) {
    val context = LocalContext.current
    val toast = LocalToastController.current
    val successMessage = stringResource(R.string.translation_diagnostic_copyReportSuccess)
    val reportText = remember(report) { formatDiagnosticReportText(report) }
    val filename =
        stringResource(
            R.string.translation_diagnostic_filename,
            remember(report) { downloadFilenameStamp(report.generatedAt) },
        )
    var pendingContent by remember { mutableStateOf<String?>(null) }
    val createDocument =
        rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(MIME_TEXT_PLAIN)) { uri ->
            val content = pendingContent
            if (uri != null && content != null) {
                runCatching {
                    context.contentResolver.openOutputStream(uri)?.use { stream -> stream.write(content.toByteArray()) }
                }
                toast?.success(title = successMessage)
            }
            pendingContent = null
        }
    Button(
        label = stringResource(R.string.translation_diagnostic_downloadReport),
        onClick = {
            pendingContent = reportText
            createDocument.launch(filename)
        },
        variant = ButtonVariant.Secondary,
        leadingIcon = DiagnosticGlyphs.Download,
    )
}

/** The per-check card list (web `report.checks.map(c => <StaggerItem><CheckCard/></StaggerItem>)`). */
@Composable
private fun DiagnosticCheckList(checks: List<DiagnosticCheck>) {
    StaggerContainer(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        checks.forEachIndexed { index, check ->
            StaggerItem(index = index) {
                DiagnosticCheckCard(check = check)
            }
        }
    }
}

/**
 * GlassPanel3 — one probe-result card (web `CheckCard`). The status tone bubble + the name/id/detail (+ an optional
 * remediation callout) on the left, and the status badge + the duration caption on the right.
 */
@Composable
private fun DiagnosticCheckCard(check: DiagnosticCheck) {
    val tone = toneForCheckStatus(check.status)
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            DiagnosticToneBubble(
                color = diagnosticToneColor(tone),
                glyph = checkStatusGlyph(check.status),
                diameter = BubbleCheckSize,
                iconSize = IconSize.Lg,
            )
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PanelTitle(check.name)
                Caption(check.id)
                if (check.detail.isNotBlank()) {
                    BodyText(check.detail, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                check.remediation?.takeIf { it.isNotBlank() }?.let { remediation ->
                    DiagnosticRemediation(remediation = remediation)
                }
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Badge(text = checkStatusLabel(check.status), variant = diagnosticToneBadgeVariant(tone))
                Caption(stringResource(R.string.translation_diagnostic_duration, check.durationMs.toString()))
            }
        }
    }
}

/** The remediation callout inside a check card (web `check.remediation` box with the `remediationLabel`). */
@Composable
private fun DiagnosticRemediation(remediation: String) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(RemediationRadius),
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
    ) {
        Column(modifier = Modifier.padding(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            MetricLabel(stringResource(R.string.translation_diagnostic_remediationLabel))
            BodyText(remediation, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** GlassPanel4 — the running state (web `<GlassPanel className="…p-12"><Spinner size="lg" label=running/></GlassPanel>`). */
@Composable
private fun DiagnosticRunningPanel() {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Box(
            modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xl2),
            contentAlignment = Alignment.Center,
        ) {
            Spinner(size = SpinnerSize.Lg, label = stringResource(R.string.translation_diagnostic_running))
        }
    }
}

/**
 * GlassPanel5 — the no-report empty state (web `<GlassPanel className="p-2"><EmptyState …/></GlassPanel>`). Shows the
 * activity glyph, the page title, the "no diagnostic run yet" message, and a Run-diagnostic CTA.
 */
@Composable
private fun DiagnosticEmptyReport(onRun: () -> Unit) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Sm) {
        EmptyState(
            icon = DiagnosticGlyphs.Activity,
            title = stringResource(R.string.translation_diagnostic_title),
            message = stringResource(R.string.translation_diagnostic_noReport),
            action =
                EmptyStateAction(
                    label = stringResource(R.string.translation_diagnostic_run),
                    onClick = onRun,
                ),
        )
    }
}

// ── Tone → theme mapping (web statusBadgeVariant / overallTone applied at the render boundary) ─────────────────────

/** A round, low-alpha-washed bubble holding a tinted status [glyph] — the web `rounded-full bg-{tone}/10 text-{tone}`. */
@Composable
private fun DiagnosticToneBubble(
    color: Color,
    glyph: ImageVector,
    diameter: Dp,
    iconSize: IconSize,
) {
    Box(
        modifier =
            Modifier
                .size(diameter)
                .clip(CircleShape)
                .background(color.copy(alpha = TONE_BUBBLE_ALPHA)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(glyph, contentDescription = null, size = iconSize, tint = color)
    }
}

/** The themed color for a [DiagnosticTone] (web `text-emerald-300` / `text-amber-300` / `text-rose-300`). */
@Composable
private fun diagnosticToneColor(tone: DiagnosticTone): Color =
    when (tone) {
        DiagnosticTone.Success -> TeslaTokens.status.success
        DiagnosticTone.Warning -> TeslaTokens.status.warning
        DiagnosticTone.Danger -> TeslaTokens.status.danger
    }

/** The badge variant for a [DiagnosticTone] (web `Badge variant="success" | "warning" | "danger"`). */
private fun diagnosticToneBadgeVariant(tone: DiagnosticTone): BadgeVariant =
    when (tone) {
        DiagnosticTone.Success -> BadgeVariant.Success
        DiagnosticTone.Warning -> BadgeVariant.Warning
        DiagnosticTone.Danger -> BadgeVariant.Danger
    }

/** The per-check status glyph (web `statusIcon`: ok → CheckCircle2, warn → AlertTriangle, else XCircle). */
private fun checkStatusGlyph(status: String): ImageVector =
    when (status) {
        CHECK_STATUS_OK -> DiagnosticGlyphs.CheckCircle
        CHECK_STATUS_WARN -> DiagnosticGlyphs.AlertTriangle
        else -> DiagnosticGlyphs.XCircle
    }

/** The overall status glyph (web `overallTone.Icon`: ok → CheckCircle2, degraded → AlertTriangle, else ShieldAlert). */
private fun overallStatusGlyph(status: String): ImageVector =
    when (status) {
        OVERALL_STATUS_OK -> DiagnosticGlyphs.CheckCircle
        OVERALL_STATUS_DEGRADED -> DiagnosticGlyphs.AlertTriangle
        else -> DiagnosticGlyphs.ShieldAlert
    }

/** The localized per-check status chip label (web `t('diagnostic.status.{status}', status.toUpperCase())`). */
@Composable
private fun checkStatusLabel(status: String): String =
    when (status) {
        CHECK_STATUS_OK -> stringResource(R.string.translation_diagnostic_status_ok)
        CHECK_STATUS_WARN -> stringResource(R.string.translation_diagnostic_status_warn)
        CHECK_STATUS_FAIL -> stringResource(R.string.translation_diagnostic_status_fail)
        else -> status.uppercase()
    }

/** The localized overall verdict label (web `t('diagnostic.overall.{status}', status)`). */
@Composable
private fun overallStatusLabel(status: String): String =
    when (status) {
        OVERALL_STATUS_OK -> stringResource(R.string.translation_diagnostic_overall_ok)
        OVERALL_STATUS_DEGRADED -> stringResource(R.string.translation_diagnostic_overall_degraded)
        OVERALL_STATUS_DOWN -> stringResource(R.string.translation_diagnostic_overall_down)
        else -> status
    }
