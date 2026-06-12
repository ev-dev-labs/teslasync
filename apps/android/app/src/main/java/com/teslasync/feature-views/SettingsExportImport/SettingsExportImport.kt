// The native Jetpack Compose + Material 3 SettingsExportImport feature view — a parity port of
// web/src/features/settings/components/SettingsExportImport.tsx. It reproduces the "Backup & Restore" panel end
// to end: the branded header, the Export row (a single button that fetches the bundle, writes it to downloads,
// and toasts the confirmation), and the Import flow (a drop zone / file picker → local schema validation → a
// dry-run preview of the per-section {added, updated, skipped} diff → Apply, which re-renders the applied diff
// and toasts the result). Every branch the web component renders is reproduced — the idle drop zone, the
// "Reading…" parsing affordance, an inline error surface, the dry-run preview, and the applied result — so the
// panel is never a blank box. The view performs NO HTTP: it binds the [SettingsExportImportViewModel] (P1/S8)
// and renders; file reads + the downloads write are isolated platform seams the host provides.
//
// This domain is mutation-only (the web hooks are `useMutation`, not `useQuery`), so there is no
// cache-then-network loading/empty/stale/offline read state to render — the parity surfaces are the export and
// import flows themselves, reproduced faithfully here.
//
// `MatchingDeclarationName`/`InvalidPackageDeclaration`/`filename` are suppressed: the mandated surface
// directory (com/teslasync/feature-views/SettingsExportImport) cannot form a valid Kotlin package and the file
// hosts several co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.featureviews.settingsexportimport

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.ToastHost
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.iconColorFor
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.presentation.settingsbackup.ImportSummary
import io.teslasync.shared.core.presentation.settingsbackup.SettingsImportResult
import io.teslasync.shared.core.presentation.settingsbackup.SettingsImportSectionResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.text.NumberFormat
import java.util.concurrent.atomic.AtomicLong

/**
 * Stateful entry point for the SettingsExportImport surface. Binds the [viewModel] (P1/S8), records the one-shot
 * PII-safe `view.opened` diagnostic, wires the platform document picker + downloads writer, drains the toast
 * effects, and renders the stateless [SettingsExportImportContent]. This view never performs HTTP.
 */
@Composable
fun SettingsExportImport(
    viewModel: SettingsExportImportViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val context = LocalContext.current
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val saver = remember(context) { downloadsBundleSaver(context) }
    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null) viewModel.ingest(buildPickedFile(context, uri))
        }

    val toasts = remember { mutableStateListOf<ToastItem>() }
    ToastEffects(viewModel, context, toasts)

    Column(modifier = modifier.fillMaxWidth()) {
        SettingsExportImportContent(
            state = state,
            onExport = { viewModel.export(saver) },
            onChooseFile = { picker.launch(IMPORT_MIME_TYPES) },
            onApply = viewModel::applyImport,
            onReset = viewModel::reset,
        )
        ToastHost(toasts = toasts, onDismiss = { id -> toasts.removeAll { it.id == id } })
    }
}

/**
 * Drains the view-model's one-shot [SettingsExportImportEffect]s into localized [ToastItem]s, mirroring the web
 * `toast.success` / `useMutationToast` calls. Strings are resolved through [Context.getString] (P1/S10) so the
 * applied-result counts format at emit time; no English literal lives here.
 */
@Composable
private fun ToastEffects(
    viewModel: SettingsExportImportViewModel,
    context: Context,
    toasts: MutableList<ToastItem>,
) {
    val ids = remember { AtomicLong(0L) }
    LaunchedEffect(viewModel, context) {
        viewModel.effects.collect { effect ->
            toasts.add(effect.toToastItem(ids.getAndIncrement(), context))
        }
    }
}

private fun SettingsExportImportEffect.toToastItem(
    id: Long,
    context: Context,
): ToastItem =
    when (this) {
        SettingsExportImportEffect.ExportSucceeded ->
            ToastItem(
                id,
                context.getString(R.string.translation_settingsBackup_export_successTitle) + "\n" +
                    context.getString(R.string.translation_settingsBackup_export_successDetail),
                Tone.Success,
            )
        SettingsExportImportEffect.ExportFailed ->
            ToastItem(id, context.getString(R.string.translation_error_serverError_message), Tone.Danger)
        is SettingsExportImportEffect.ImportApplied ->
            ToastItem(
                id,
                context.getString(R.string.translation_settingsBackup_import_appliedTitle) + "\n" +
                    context.getString(R.string.translation_settingsBackup_import_appliedDetail, added, updated, skipped),
                Tone.Success,
            )
        SettingsExportImportEffect.ImportApplyFailed ->
            ToastItem(id, context.getString(R.string.translation_error_serverError_message), Tone.Danger)
    }

/**
 * Stateless renderer of the surface — the unit/UI-test entry point. Reproduces the web layout (header → Export
 * row → Import flow) and every import branch driven purely by [state] + the action callbacks.
 */
@Composable
fun SettingsExportImportContent(
    state: SettingsExportImportUiState,
    onExport: () -> Unit,
    onChooseFile: () -> Unit,
    onApply: () -> Unit,
    onReset: () -> Unit,
    modifier: Modifier = Modifier,
) {
    FadeIn(modifier = modifier, delayMs = PANEL_FADE_DELAY_MS) {
        GlassPanel(padding = PanelPadding.Lg) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                BackupHeader()
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                ExportRow(exporting = state.exporting, onExport = onExport)
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                ImportSection(state = state, onChooseFile = onChooseFile, onApply = onApply, onReset = onReset)
            }
        }
    }
}

// ── Header ─────────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun BackupHeader() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        IconBox(tone = IconBoxTone.Info) {
            Icon(SettingsExportImportGlyphs.Database, contentDescription = null, tint = iconColorFor(IconBoxTone.Info))
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            SectionTitle(stringResource(R.string.translation_settingsBackup_title))
            HelperText(stringResource(R.string.translation_settingsBackup_subtitle))
        }
    }
}

// ── Export row ─────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun ExportRow(
    exporting: Boolean,
    onExport: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PanelTitle(stringResource(R.string.translation_settingsBackup_export_title))
            HelperText(stringResource(R.string.translation_settingsBackup_export_help))
        }
        Button(
            label =
                stringResource(
                    if (exporting) {
                        R.string.translation_settingsBackup_export_busy
                    } else {
                        R.string.translation_settingsBackup_export_cta
                    },
                ),
            onClick = onExport,
            enabled = !exporting,
            loading = exporting,
            leadingIcon = FeedbackGlyphs.Download,
        )
    }
}

// ── Import flow ────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun ImportSection(
    state: SettingsExportImportUiState,
    onChooseFile: () -> Unit,
    onApply: () -> Unit,
    onReset: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PanelTitle(stringResource(R.string.translation_settingsBackup_import_title))
            HelperText(stringResource(R.string.translation_settingsBackup_import_help))
        }
        if (state.stage != ImportStage.Preview && state.stage != ImportStage.Applied) {
            DropZone(parsing = state.stage == ImportStage.Parsing, onChooseFile = onChooseFile)
        }
        state.error?.let { ImportErrorRow(it) }
        if (state.stage == ImportStage.Preview && state.pending != null && state.preview != null) {
            PreviewResult(
                pending = state.pending,
                preview = state.preview,
                applying = state.applying,
                onApply = onApply,
                onReset = onReset,
            )
        }
        if (state.stage == ImportStage.Applied && state.applied != null) {
            AppliedResult(applied = state.applied, onReset = onReset)
        }
    }
}

@Composable
private fun DropZone(
    parsing: Boolean,
    onChooseFile: () -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.lg))
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .border(width = 2.dp, color = MaterialTheme.colorScheme.outlineVariant, shape = RoundedCornerShape(Radius.lg))
                .padding(Spacing.xl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            SettingsExportImportGlyphs.FileJson,
            contentDescription = null,
            size = IconSize.Xl,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        HelperText(stringResource(R.string.translation_settingsBackup_import_dropPrompt))
        Button(
            label =
                stringResource(
                    if (parsing) {
                        R.string.translation_settingsBackup_import_parsing
                    } else {
                        R.string.translation_settingsBackup_import_choose
                    },
                ),
            onClick = onChooseFile,
            variant = ButtonVariant.Ghost,
            enabled = !parsing,
            loading = parsing,
            leadingIcon = SettingsExportImportGlyphs.Upload,
        )
    }
}

@Composable
private fun ImportErrorRow(error: ImportError) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.md))
                .background(TeslaTokens.status.danger.copy(alpha = ERROR_BG_ALPHA))
                .border(
                    width = 1.dp,
                    color = TeslaTokens.status.danger.copy(alpha = ERROR_BORDER_ALPHA),
                    shape = RoundedCornerShape(Radius.md),
                ).padding(Spacing.md),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(TeslaGlyphs.Warning, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.danger)
        ErrorText(importErrorMessage(error))
    }
}

@Composable
private fun PreviewResult(
    pending: PendingImport,
    preview: SettingsImportResult,
    applying: Boolean,
    onApply: () -> Unit,
    onReset: () -> Unit,
) {
    val summary = remember(preview) { summariseImport(preview) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                val sizeText = remember(pending.sizeBytes) { formatByteCount(pending.sizeBytes) }
                BodyText(
                    stringResource(R.string.translation_settingsBackup_import_previewHeader, pending.filename, sizeText),
                )
                HelperText(
                    stringResource(
                        R.string.translation_settingsBackup_import_summary,
                        summary.added,
                        summary.updated,
                        summary.skipped,
                    ),
                )
            }
            Button(
                label = stringResource(R.string.translation_settingsBackup_import_changeFile),
                onClick = onReset,
                variant = ButtonVariant.Ghost,
                enabled = !applying,
            )
        }
        SectionDiffList(preview)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(
                label = stringResource(R.string.translation_settingsBackup_import_cancel),
                onClick = onReset,
                variant = ButtonVariant.Ghost,
                enabled = !applying,
            )
            ApplyButton(summary = summary, applying = applying, onApply = onApply)
        }
    }
}

@Composable
private fun ApplyButton(
    summary: ImportSummary,
    applying: Boolean,
    onApply: () -> Unit,
) {
    val label =
        when {
            applying -> stringResource(R.string.translation_settingsBackup_import_applying)
            summary.total > 0 -> stringResource(R.string.translation_settingsBackup_import_applyCount, summary.total)
            else -> stringResource(R.string.translation_settingsBackup_import_applyNoChanges)
        }
    Button(
        label = label,
        onClick = onApply,
        enabled = !applying && summary.total > 0,
        loading = applying,
    )
}

@Composable
private fun AppliedResult(
    applied: SettingsImportResult,
    onReset: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        BodyText(stringResource(R.string.translation_settingsBackup_import_appliedHeader))
        SectionDiffList(applied)
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            Button(
                label = stringResource(R.string.translation_settingsBackup_import_done),
                onClick = onReset,
                variant = ButtonVariant.Ghost,
            )
        }
    }
}

@Composable
private fun SectionDiffList(result: SettingsImportResult) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        sectionDiffRows(result).forEach { row ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BodyText(sectionLabel(row.key))
                val counts = row.counts
                if (counts != null) {
                    CodeText(formatSectionCounts(counts))
                } else {
                    Text(
                        EM_DASH,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun importErrorMessage(error: ImportError): String =
    when (error) {
        ImportError.TooLarge -> stringResource(R.string.translation_settingsBackup_import_errorTooLarge)
        ImportError.Read -> stringResource(R.string.translation_settingsBackup_import_errorRead)
        is ImportError.InvalidJson -> stringResource(R.string.translation_settingsBackup_import_errorJson, error.detail)
        ImportError.PreviewFailed -> stringResource(R.string.translation_settingsBackup_import_errorPreview)
    }

@Composable
private fun sectionLabel(key: String): String =
    when (key) {
        SECTION_KEY_SETTINGS -> stringResource(R.string.translation_settingsBackup_section_settings)
        SECTION_KEY_ALERT_RULES -> stringResource(R.string.translation_settingsBackup_section_alertRules)
        SECTION_KEY_GEOFENCES -> stringResource(R.string.translation_settingsBackup_section_geofences)
        SECTION_KEY_QUIET_HOURS -> stringResource(R.string.translation_settingsBackup_section_quietHours)
        else -> key
    }

// ── Platform seams ─────────────────────────────────────────────────────────────────────────────────────────

private fun buildPickedFile(
    context: Context,
    uri: Uri,
): PickedFile {
    var name = uri.lastPathSegment ?: DEFAULT_IMPORT_NAME
    var size = 0L
    context.contentResolver
        .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
        ?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (nameIndex >= 0 && !cursor.isNull(nameIndex)) name = cursor.getString(nameIndex)
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex)
            }
        }
    val resolver = context.contentResolver
    return PickedFile(name = name, sizeBytes = size) {
        withContext(Dispatchers.IO) {
            (resolver.openInputStream(uri)?.use { it.readBytes() } ?: throw IOException()).decodeToString()
        }
    }
}

private fun downloadsBundleSaver(context: Context): SettingsBundleSaver =
    SettingsBundleSaver { filename, json ->
        withContext(Dispatchers.IO) { runCatching { writeDownloadFile(context, filename, json) } }
    }

private fun writeDownloadFile(
    context: Context,
    filename: String,
    json: String,
) {
    val bytes = json.encodeToByteArray()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val resolver = context.contentResolver
        val values =
            ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, filename)
                put(MediaStore.Downloads.MIME_TYPE, MIME_JSON)
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: throw IOException()
        resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: throw IOException()
    } else {
        val dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: context.filesDir
        File(dir, filename).writeBytes(bytes)
    }
}

private fun formatByteCount(bytes: Long): String = NumberFormat.getIntegerInstance().format(bytes)

private const val PANEL_FADE_DELAY_MS = 160
private const val MIME_JSON = "application/json"
private const val DEFAULT_IMPORT_NAME = "import.json"
private const val EM_DASH = "—"
private const val ERROR_BG_ALPHA = 0.08f
private const val ERROR_BORDER_ALPHA = 0.30f
private val IMPORT_MIME_TYPES = arrayOf(MIME_JSON, "application/octet-stream", "text/plain")

// ── Previews ───────────────────────────────────────────────────────────────────────────────────────────────

private fun sampleResult(): SettingsImportResult =
    SettingsImportResult(
        dryRun = true,
        sections =
            mapOf(
                SECTION_KEY_SETTINGS to SettingsImportSectionResult(added = 0, updated = 3, skipped = 5),
                SECTION_KEY_ALERT_RULES to SettingsImportSectionResult(added = 2, updated = 0, skipped = 1),
                SECTION_KEY_GEOFENCES to SettingsImportSectionResult(added = 1, updated = 0, skipped = 0),
            ),
    )

@Preview(showBackground = true)
@Composable
private fun SettingsExportImportIdlePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SettingsExportImportContent(SettingsExportImportUiState(), {}, {}, {}, {})
    }
}

@Preview(showBackground = true)
@Composable
private fun SettingsExportImportPreviewStatePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SettingsExportImportContent(
            SettingsExportImportUiState(
                stage = ImportStage.Preview,
                pending = PendingImport("teslasync-settings-20260612.json", 2_048L),
                preview = sampleResult(),
            ),
            {},
            {},
            {},
            {},
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun SettingsExportImportAppliedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SettingsExportImportContent(
            SettingsExportImportUiState(stage = ImportStage.Applied, applied = sampleResult()),
            {},
            {},
            {},
            {},
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun SettingsExportImportErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SettingsExportImportContent(SettingsExportImportUiState(error = ImportError.TooLarge), {}, {}, {}, {})
    }
}
