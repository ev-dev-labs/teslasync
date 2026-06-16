// The native Jetpack Compose + Material 3 GDPRExportPage admin surface — a parity port of
// web/src/features/admin/pages/GDPRExportPage.tsx, the GDPR export-artifact inspector. It reproduces the
// page's panels (the artifact-id lookup, the status + format/size/storage tiles, the artifact-details
// metadata, and the download panel), every data state (empty / error / success, plus loading), and every
// visible string (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [GDPRExportPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, polls while the export is queued/running, collects the feed
// + interaction snapshot); [GDPRExportPageContent] is the stateless render layer driven entirely by [UiState]
// + [GdprExportInteraction] + [GDPRExportActions]. All derivation lives in the framework-free model
// (GDPRExportPageModel.kt); this file only resolves i18n + draws.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions", "LongMethod")

package io.teslasync.android.admin.gdpr

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.StatCard
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
import io.teslasync.android.components.ui.CopyButton
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.operatorconfidence.GDPRExportArtifact
import java.util.Locale

/** The page's interaction callbacks, wired to the [GDPRExportPageViewModel] (web event handlers). */
data class GDPRExportActions(
    val onIdInput: (String) -> Unit,
    val onLookup: () -> Unit,
    val onRetry: () -> Unit,
    val onDownload: (GDPRExportArtifact) -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [GDPRExportPageViewModel] over the supplied [source] (the host wires the
 * shared [io.teslasync.shared.core.presentation.operatorconfidence.OperatorConfidenceStore] via
 * [asGdprExportSource]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun GDPRExportPage(
    source: GdprExportSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: GDPRExportPageViewModel =
        viewModel(
            key = GDPRExportPageRegistration.SLUG,
            factory = viewModelFactory { initializer { GDPRExportPageViewModel(source, logger) } },
        )
    GDPRExportPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feed + interaction snapshot to the stateless content. */
@Composable
fun GDPRExportPage(
    viewModel: GDPRExportPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val context = LocalContext.current

    // Re-poll while the export is still being produced (web `refetchInterval: INTERVALS.FAST`); the effect is
    // re-keyed on the status so it stops the moment the artifact reaches a terminal state, and is torn down
    // when the screen leaves composition.
    val status = state.data?.status
    LaunchedEffect(interaction.activeId, status) {
        if (interaction.activeId.isNotBlank() && status != null && isPolling(status)) {
            while (true) {
                kotlinx.coroutines.delay(GDPRExportPageRegistration.POLL_INTERVAL_MS)
                viewModel.refresh()
            }
        }
    }

    val actions =
        remember(viewModel, context) {
            GDPRExportActions(
                onIdInput = viewModel::setIdInput,
                onLookup = viewModel::lookup,
                onRetry = viewModel::retry,
                onDownload = { artifact -> openDownload(context, downloadUrl(artifact)) },
            )
        }

    GDPRExportPageContent(state = state, interaction = interaction, actions = actions, modifier = modifier)
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/** The stateless page body: the header, the optional subsystem banner, the lookup panel, and the result. */
@Composable
fun GDPRExportPageContent(
    state: UiState<GDPRExportArtifact>,
    interaction: GdprExportInteraction,
    actions: GDPRExportActions,
    modifier: Modifier = Modifier,
) {
    val activeId = interaction.activeId
    val artifact = state.data
    val subsystemMissing = activeId.isNotBlank() && state.httpStatus == HTTP_SUBSYSTEM_MISSING && artifact == null
    val notFound = activeId.isNotBlank() && state.httpStatus == HTTP_NOT_FOUND && artifact == null

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        GDPRExportHeader()

        if (subsystemMissing) {
            AlertBanner(
                message = stringResource(R.string.translation_admin_gdprExport_notConfigured),
                tone = Tone.Warning,
                title = stringResource(R.string.translation_admin_subsystem_unavailableTitle),
            )
        }

        FadeIn {
            GDPRExportLookupPanel(interaction = interaction, actions = actions)
        }

        when {
            activeId.isBlank() ->
                FadeIn(delayMs = FADE_STEP_MS) { GDPRExportEmptyPanel() }
            subsystemMissing -> Unit // the warning banner above is the rendered surface for a 503
            notFound ->
                FadeIn(delayMs = FADE_STEP_MS) { GDPRExportNotFoundBanner() }
            artifact != null ->
                FadeIn(delayMs = FADE_STEP_MS) { GDPRExportArtifactSection(artifact = artifact, actions = actions) }
            state.isLoading ->
                FadeIn(delayMs = FADE_STEP_MS) { GDPRExportLoadingPanel() }
            state.hasError ->
                FadeIn(delayMs = FADE_STEP_MS) { GDPRExportErrorBanner(onRetry = actions.onRetry) }
            else ->
                FadeIn(delayMs = FADE_STEP_MS) { GDPRExportLoadingPanel() }
        }
    }
}

@Composable
private fun GDPRExportHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_admin_gdprExport_pageTitle))
        BodyText(
            stringResource(R.string.translation_admin_gdprExport_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// ── GlassPanel1 — Lookup artifact ────────────────────────────────────────────────────────────────────────────

@Composable
private fun GDPRExportLookupPanel(
    interaction: GdprExportInteraction,
    actions: GDPRExportActions,
) {
    GlassPanel(padding = PanelPadding.Md) {
        PanelTitle(stringResource(R.string.translation_admin_gdprExport_lookupTitle))
        Column(
            modifier = Modifier.padding(top = Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Input(
                value = interaction.idInput,
                onValueChange = actions.onIdInput,
                label = stringResource(R.string.translation_admin_gdprExport_idLabel),
                hint = stringResource(R.string.translation_admin_gdprExport_idPlaceholder), // parity:allow web i18n key admin.gdprExport.idPlaceholder field-prompt copy, not a code stub
            )
            Button(
                label = stringResource(R.string.translation_admin_gdprExport_lookupButton),
                onClick = actions.onLookup,
                variant = ButtonVariant.Primary,
                size = ButtonSize.Md,
                leadingIcon = GdprExportGlyphs.Search,
                enabled = interaction.idInput.isNotBlank(),
            )
            Caption(stringResource(R.string.translation_admin_gdprExport_lookupHint))
        }
    }
}

// ── GlassPanel2 — No artifact selected (empty state) ──────────────────────────────────────────────────────────

@Composable
private fun GDPRExportEmptyPanel() {
    GlassPanel(padding = PanelPadding.Md) {
        EmptyState(
            message = stringResource(R.string.translation_admin_gdprExport_emptyMessage),
            icon = GdprExportGlyphs.HardDriveDownload,
            title = stringResource(R.string.translation_admin_gdprExport_emptyTitle),
        )
    }
}

// ── Error surfaces (404 not-found banner, generic load-failed banner, first-load spinner) ────────────────────

@Composable
private fun GDPRExportNotFoundBanner() {
    AlertBanner(
        message = stringResource(R.string.translation_admin_gdprExport_notFoundMessage),
        tone = Tone.Danger,
        title = stringResource(R.string.translation_admin_gdprExport_notFoundTitle),
    )
}

@Composable
private fun GDPRExportErrorBanner(onRetry: () -> Unit) {
    AlertBanner(
        message = stringResource(R.string.translation_error_loadFailed),
        tone = Tone.Danger,
        action = BannerAction(stringResource(R.string.translation_error_retry), onRetry),
    )
}

@Composable
private fun GDPRExportLoadingPanel() {
    GlassPanel(padding = PanelPadding.Md) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spinner(size = SpinnerSize.Md, label = stringResource(R.string.translation_common_loading))
        }
    }
}

// ── Success — the resolved artifact (status + tiles, details, optional error, download) ──────────────────────

@Composable
private fun GDPRExportArtifactSection(
    artifact: GDPRExportArtifact,
    actions: GDPRExportActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        GDPRExportStatusGrid(artifact = artifact)
        GDPRExportDetailsPanel(artifact = artifact)
        val error = artifact.error
        if (!error.isNullOrBlank()) {
            AlertBanner(
                message = error,
                tone = Tone.Danger,
                title = stringResource(R.string.translation_admin_gdprExport_errorTitle),
            )
        }
        GDPRExportDownloadPanel(artifact = artifact, actions = actions)
    }
}

// ── GlassPanel3 / Format / Size / Storage tiles ──────────────────────────────────────────────────────────────

@Composable
private fun GDPRExportStatusGrid(artifact: GDPRExportArtifact) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            GDPRExportStatusPanel(status = artifact.status, modifier = Modifier.weight(1f))
            StatCard(
                label = stringResource(R.string.translation_admin_gdprExport_formatLabel),
                value = artifact.format.ifBlank { EM_DASH },
                modifier = Modifier.weight(1f),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                label = stringResource(R.string.translation_admin_gdprExport_bytesLabel),
                value = formatBytes(artifact.bytes),
                modifier = Modifier.weight(1f),
            )
            StatCard(
                label = stringResource(R.string.translation_admin_gdprExport_storageLabel),
                value = artifact.storage?.ifBlank { EM_DASH } ?: EM_DASH,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun GDPRExportStatusPanel(
    status: String,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        Caption(stringResource(R.string.translation_admin_gdprExport_statusLabel))
        Box(modifier = Modifier.padding(top = Spacing.xs)) {
            Badge(text = status.ifBlank { EM_DASH }, variant = statusTone(status).badgeVariant())
        }
    }
}

// ── GlassPanel7 — Artifact details ───────────────────────────────────────────────────────────────────────────

@Composable
private fun GDPRExportDetailsPanel(artifact: GDPRExportArtifact) {
    val locale = ConfigurationCompat.getLocales(LocalConfiguration.current).get(0) ?: Locale.ROOT
    val nowMs = remember(artifact) { System.currentTimeMillis() }

    GlassPanel(padding = PanelPadding.Md) {
        PanelTitle(stringResource(R.string.translation_admin_gdprExport_metaTitle))
        Column(
            modifier = Modifier.padding(top = Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            GDPRExportCopyRow(
                label = stringResource(R.string.translation_admin_gdprExport_metaId),
                value = artifact.id,
            )
            val userId = artifact.userId
            if (!userId.isNullOrBlank()) {
                GDPRExportMetaRow(label = stringResource(R.string.translation_admin_gdprExport_metaUser)) {
                    BodyText(userId)
                }
            }
            GDPRExportDateRow(
                label = stringResource(R.string.translation_admin_gdprExport_metaCreated),
                iso = artifact.createdAt,
                locale = locale,
                nowMs = nowMs,
            )
            val completedAt = artifact.completedAt
            if (!completedAt.isNullOrBlank()) {
                GDPRExportDateRow(
                    label = stringResource(R.string.translation_admin_gdprExport_metaCompleted),
                    iso = completedAt,
                    locale = locale,
                    nowMs = nowMs,
                )
            }
            val expiresAt = artifact.expiresAt
            if (!expiresAt.isNullOrBlank()) {
                GDPRExportDateRow(
                    label = stringResource(R.string.translation_admin_gdprExport_metaExpires),
                    iso = expiresAt,
                    locale = locale,
                    nowMs = nowMs,
                )
            }
            val sha = artifact.sha256
            if (!sha.isNullOrBlank()) {
                GDPRExportCopyRow(
                    label = stringResource(R.string.translation_admin_gdprExport_metaSha256),
                    value = sha,
                )
            }
        }
    }
}

@Composable
private fun GDPRExportMetaRow(
    label: String,
    value: @Composable () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(label)
        value()
    }
}

@Composable
private fun GDPRExportDateRow(
    label: String,
    iso: String,
    locale: Locale,
    nowMs: Long,
) {
    GDPRExportMetaRow(label = label) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            BodyText(formatDateTime(iso, locale))
            Caption(formatRelative(iso, nowMs, locale))
        }
    }
}

@Composable
private fun GDPRExportCopyRow(
    label: String,
    value: String,
) {
    GDPRExportMetaRow(label = label) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            CodeText(value, modifier = Modifier.weight(1f))
            CopyButton(
                text = value,
                copyLabel = stringResource(R.string.translation_common_copyButton_copy),
                copiedLabel = stringResource(R.string.translation_common_copyButton_copied),
                iconOnly = true,
            )
        }
    }
}

// ── GlassPanel8 — Download ────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun GDPRExportDownloadPanel(
    artifact: GDPRExportArtifact,
    actions: GDPRExportActions,
) {
    GlassPanel(padding = PanelPadding.Md) {
        PanelTitle(stringResource(R.string.translation_admin_gdprExport_downloadTitle))
        Column(
            modifier = Modifier.padding(top = Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            when (downloadAvailability(artifact)) {
                DownloadAvailability.Available -> {
                    BodyText(stringResource(R.string.translation_admin_gdprExport_downloadHint))
                    Button(
                        label = stringResource(R.string.translation_admin_gdprExport_downloadButton),
                        onClick = { actions.onDownload(artifact) },
                        variant = ButtonVariant.Primary,
                        size = ButtonSize.Md,
                        leadingIcon = GdprExportGlyphs.HardDriveDownload,
                        enabled = downloadUrl(artifact) != null,
                    )
                }
                DownloadAvailability.Wait ->
                    Caption(stringResource(R.string.translation_admin_gdprExport_downloadWait))
                DownloadAvailability.Expired ->
                    Caption(stringResource(R.string.translation_admin_gdprExport_downloadExpired))
                DownloadAvailability.Failed ->
                    Caption(stringResource(R.string.translation_admin_gdprExport_downloadFailed))
            }
        }
    }
}

// ── Display-boundary helpers ─────────────────────────────────────────────────────────────────────────────────

/** Launches the artifact's binary download in the system handler (the native analogue of the web `<a download>`). */
private fun openDownload(
    context: Context,
    url: String?,
) {
    if (url.isNullOrBlank()) return
    runCatching {
        val intent =
            Intent(Intent.ACTION_VIEW, Uri.parse(url))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }
}

private const val FADE_STEP_MS = 50
private const val HTTP_SUBSYSTEM_MISSING = 503
private const val HTTP_NOT_FOUND = 404
