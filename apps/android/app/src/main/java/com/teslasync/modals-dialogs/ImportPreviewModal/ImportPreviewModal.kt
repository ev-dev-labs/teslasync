// Compose render layer for the ImportPreviewModal modal/dialog surface — the native analogue of the JSX the web
// component returns (web/src/features/dashboard/components/ImportPreviewModal.tsx). It is a thin shell over the pure
// derivations in ImportPreviewModalModel.kt (the validation pipeline, the share-link decoder, and the
// validated-dashboard → thumbnail projection): it gates composition on `open`, records the one-shot `view.opened`
// diagnostic (P1/S11), hosts the sanctioned atomic `components/ui/Modal`, and switches the modal between the
// three-tab importer and the validation preview exactly as the web swaps its two `<Modal>` instances.
//
// Parity of the web behaviours:
//   - the `open` gate -> `if (!open) return` (web `Modal`'s own `open` short-circuit).
//   - the two titles -> `import.title` ("Import Dashboard") for the input step, `import.preview` ("Import Preview")
//     once a validation result exists (web's two `<Modal title>` instances).
//   - the three tabs (From File / Paste JSON / From URL) -> the atomic `Tabs`, each body wrapped in a reduced-motion
//     -aware `FadeIn` (web `<FadeIn>`).
//   - From File -> a tappable drop-zone whose "Browse Files" button launches the Storage Access Framework document
//     picker (`GetContent("application/json")`); the picked file is read off the main thread and validated. Android
//     has no in-dialog file drag-drop, so the web drag-over highlight + post-hoc `invalidFileType` error are subsumed
//     by the picker's up-front MIME filter (documented platform adaptation; the i18n key stays wired).
//   - Paste JSON / From URL -> the atomic `Textarea` / `Input`, each with a primary action disabled while the field
//     is blank (web `disabled={!value.trim()}`).
//   - the parse-error banner -> the atomic danger `AlertBanner` (web `<AlertBanner variant="danger">`).
//   - the preview -> errors/warnings banners, the `MiniGridPreview` thumbnail + name + count badges, the per-widget
//     availability list, the `Cannot preview this layout` empty state when the layout cannot be rebuilt, and the
//     Back / Import actions (Import shown only for a valid, rebuildable dashboard — web `isValid && dashboard`).
//
// The view performs NO HTTP and owns no store: the web component binds only `useTranslation`, so the owning surface
// that raises the importer carries any data lifecycle (loading/empty/error/stale/offline) — modelling those here
// would be drift. The host supplies the widget registry as `knownWidgetIds` plus the `iconForWidget`/`nameForWidget`
// resolvers (the web global `WIDGET_REGISTRY` / `getWidgetDef`), exactly as the sibling `MiniGridPreview` takes a
// host icon resolver; with none wired the surface degrades to the web's own "no compatible widgets" fallback.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/ImportPreviewModal) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations (the localized-strings carrier, the authored glyph set, and
// the tooling-only previews).
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.importpreviewmodal

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TabItem
import io.teslasync.android.components.ui.Tabs
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.minigridpreview.MiniGridPreview
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** The MIME filter the document picker opens with — the web `accept=".json"`. */
private const val MIME_JSON: String = "application/json"

/** Width of the layout thumbnail column, in dp — the web `w-40` (`MiniGridPreview` fills it). */
private val THUMBNAIL_WIDTH: Dp = 140.dp

/** Max height of the scrollable widget-availability list, in dp — the web `max-h-48`. */
private val WIDGET_LIST_MAX_HEIGHT: Dp = 192.dp

/** Test tags for the nodes the UI test selects (the web `data-testid` attributes). */
object ImportPreviewModalTestTags {
    const val ROOT: String = "import-preview-modal"
    const val DROPZONE: String = "import-preview-dropzone"
    const val PASTE_INPUT: String = "import-preview-paste"
    const val URL_INPUT: String = "import-preview-url"
    const val WIDGET_LIST: String = "import-preview-widget-list"
}

/**
 * The already-localized importer microcopy resolved from the i18n catalog (P1/S10). Bundled into one carrier so the
 * stateless content takes plain strings and stays trivially previewable + UI-testable. [availableCount]/[missingCount]
 * are formatters (the web `{{count}}` interpolation) rather than fixed strings.
 */
data class ImportPreviewStrings(
    val title: String,
    val preview: String,
    val fromFile: String,
    val fromClipboard: String,
    val fromUrl: String,
    val dropFile: String,
    val browse: String,
    val fileInput: String,
    val validate: String,
    val loadUrl: String,
    val widgets: String,
    val notAvailable: String,
    val cannotPreview: String,
    val back: String,
    val confirm: String,
    val close: String,
    val emptyInput: String,
    val readError: String,
    val invalidFileType: String,
    val noImportParam: String,
    val invalidUrl: String,
    val availableCount: (Int) -> String,
    val missingCount: (Int) -> String,
)

/** Resolves every [ImportPreviewStrings] entry from the generated i18n catalog keys (P1/S10). */
@Composable
fun rememberImportPreviewStrings(): ImportPreviewStrings {
    val context = LocalContext.current
    return ImportPreviewStrings(
        title = stringResource(R.string.translation_import_title),
        preview = stringResource(R.string.translation_import_preview),
        fromFile = stringResource(R.string.translation_import_fromFile),
        fromClipboard = stringResource(R.string.translation_import_fromClipboard),
        fromUrl = stringResource(R.string.translation_import_fromUrl),
        dropFile = stringResource(R.string.translation_import_dropFile),
        browse = stringResource(R.string.translation_import_browse),
        fileInput = stringResource(R.string.translation_import_fileInput),
        validate = stringResource(R.string.translation_import_validate),
        loadUrl = stringResource(R.string.translation_import_loadUrl),
        widgets = stringResource(R.string.translation_import_widgets),
        notAvailable = stringResource(R.string.translation_import_notAvailable),
        cannotPreview = stringResource(R.string.translation_import_cannotPreview),
        back = stringResource(R.string.translation_import_back),
        confirm = stringResource(R.string.translation_import_confirm),
        close = stringResource(R.string.translation_common_close),
        emptyInput = stringResource(R.string.translation_import_emptyInput),
        readError = stringResource(R.string.translation_import_readError),
        invalidFileType = stringResource(R.string.translation_import_invalidFileType),
        noImportParam = stringResource(R.string.translation_import_noImportParam),
        invalidUrl = stringResource(R.string.translation_import_invalidUrl),
        availableCount = { count -> context.getString(R.string.translation_import_availableCount, count) },
        missingCount = { count -> context.getString(R.string.translation_import_missingCount, count) },
    )
}

/**
 * Stateful entry point — the faithful 1:1 port of the web `ImportPreviewModal({ open, onClose, onConfirm,
 * initialJson })`. Renders nothing while [open] is false, records the one-shot PII-safe `view.opened` diagnostic on
 * open (P1/S11), owns the validation/parse-error state that selects the modal title + screen, wires the document
 * picker, and hosts the atomic `Modal`. The sanitised dashboard is handed to [onConfirm]; [onClose] dismisses.
 *
 * @param open whether the importer is shown (web `open`).
 * @param onClose dismiss handler (web `onClose`); also fired after a successful import.
 * @param onConfirm receives the sanitised [SavedDashboardImport] on confirm (web `onConfirm(validation.dashboard)`).
 * @param initialJson optional pre-filled payload auto-validated on open (web `initialJson`, e.g. from a share link).
 * @param knownWidgetIds the host's widget registry ids (web global `WIDGET_REGISTRY`); a widget is available only
 *   when its id is in this set.
 * @param iconForWidget resolves a widget id to its registry icon (web `getWidgetDef(id)?.icon`); `null` shows none.
 * @param nameForWidget resolves a widget id to its registry name (web `getWidgetDef(id)?.name`); `null` falls back to
 *   the raw id.
 * @param clock the id/timestamp source stamped onto the sanitised dashboard (web `Date.now()` / `toISOString()`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer` (P1/S11).
 */
@Composable
fun ImportPreviewModal(
    open: Boolean,
    onClose: () -> Unit,
    onConfirm: (SavedDashboardImport) -> Unit,
    modifier: Modifier = Modifier,
    initialJson: String? = null,
    knownWidgetIds: Set<String> = emptySet(),
    iconForWidget: (String) -> ImageVector? = { null },
    nameForWidget: (String) -> String? = { null },
    clock: ImportClock = SystemImportClock,
    logger: Logger = LocalDataContainer.current.logger,
) {
    if (!open) return
    val strings = rememberImportPreviewStrings()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val initialValidation =
        remember(initialJson, knownWidgetIds) {
            initialJson
                ?.takeIf { it.isNotBlank() }
                ?.let { ImportValidator.validateImportData(it, knownWidgetIds, clock) }
        }
    var validation by remember { mutableStateOf(initialValidation) }
    var parseError by remember { mutableStateOf<String?>(null) }

    val validate: (String) -> Unit = { raw ->
        parseError = null
        if (raw.isBlank()) {
            parseError = strings.emptyInput
        } else {
            validation = ImportValidator.validateImportData(raw, knownWidgetIds, clock)
        }
    }
    val loadUrl: (String) -> Unit = { url ->
        parseError = null
        when (val result = ImportUrlCodec.parseImportUrl(url)) {
            is ImportUrlResult.Decoded -> validate(result.json)
            ImportUrlResult.NoParam -> parseError = strings.noImportParam
            ImportUrlResult.InvalidUrl -> parseError = strings.invalidUrl
        }
    }
    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
            uri?.let { picked ->
                scope.launch {
                    val text = withContext(Dispatchers.IO) { readJsonText(context, picked) }
                    if (text != null) validate(text) else parseError = strings.readError
                }
            }
        }
    val close: () -> Unit = {
        validation = null
        parseError = null
        onClose()
    }

    LaunchedEffect(Unit) { ImportPreviewModalDiagnostics.recordViewOpened(logger) }

    Modal(
        onDismissRequest = close,
        modifier = modifier.testTag(ImportPreviewModalTestTags.ROOT),
        title = if (validation != null) strings.preview else strings.title,
        accessibleName = if (validation != null) strings.preview else strings.title,
        closeLabel = strings.close,
    ) {
        ImportPreviewModalBody(
            strings = strings,
            validation = validation,
            parseError = parseError,
            iconForWidget = iconForWidget,
            nameForWidget = nameForWidget,
            logger = logger,
            onValidate = validate,
            onLoadUrl = loadUrl,
            onBrowse = { picker.launch(MIME_JSON) },
            onConfirm = { dashboard ->
                onConfirm(dashboard)
                close()
            },
            onBack = {
                validation = null
                parseError = null
            },
        )
    }
}

/**
 * Stateless screen switch — the unit/UI-test and preview entry point. Shows the validation [ImportPreview] once a
 * [validation] result exists (web `if (validation) …`), otherwise the three-tab input form. Owns no state itself; the
 * input form owns the ephemeral draft.
 */
@Composable
fun ImportPreviewModalBody(
    strings: ImportPreviewStrings,
    validation: ImportValidation?,
    parseError: String?,
    onValidate: (String) -> Unit,
    onLoadUrl: (String) -> Unit,
    onBrowse: () -> Unit,
    onConfirm: (SavedDashboardImport) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    iconForWidget: (String) -> ImageVector? = { null },
    nameForWidget: (String) -> String? = { null },
    logger: Logger = LocalDataContainer.current.logger,
) {
    if (validation != null) {
        ImportPreview(
            validation = validation,
            strings = strings,
            iconForWidget = iconForWidget,
            nameForWidget = nameForWidget,
            logger = logger,
            onConfirm = onConfirm,
            onBack = onBack,
            modifier = modifier,
        )
    } else {
        ImportInputForm(
            strings = strings,
            parseError = parseError,
            onValidate = onValidate,
            onLoadUrl = onLoadUrl,
            onBrowse = onBrowse,
            modifier = modifier,
        )
    }
}

/** The three-tab importer (web `activeTab` switch) plus the parse-error banner. Owns the ephemeral draft state. */
@Composable
private fun ImportInputForm(
    strings: ImportPreviewStrings,
    parseError: String?,
    onValidate: (String) -> Unit,
    onLoadUrl: (String) -> Unit,
    onBrowse: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var activeTab by remember { mutableStateOf(ImportTab.File) }
    var pastedJson by remember { mutableStateOf("") }
    var importUrl by remember { mutableStateOf("") }

    val tabs =
        listOf(
            TabItem(key = ImportTab.File.name, label = strings.fromFile),
            TabItem(key = ImportTab.Paste.name, label = strings.fromClipboard),
            TabItem(key = ImportTab.Url.name, label = strings.fromUrl),
        )

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Tabs(
            tabs = tabs,
            selectedKey = activeTab.name,
            onSelect = { key -> activeTab = ImportTab.entries.firstOrNull { it.name == key } ?: ImportTab.File },
        )
        when (activeTab) {
            ImportTab.File -> FadeIn { FileTab(strings = strings, onBrowse = onBrowse) }
            ImportTab.Paste ->
                FadeIn {
                    PasteTab(
                        strings = strings,
                        value = pastedJson,
                        onValueChange = { pastedJson = it },
                        onValidate = { onValidate(pastedJson) },
                    )
                }
            ImportTab.Url ->
                FadeIn {
                    UrlTab(
                        strings = strings,
                        value = importUrl,
                        onValueChange = { importUrl = it },
                        onLoad = { onLoadUrl(importUrl) },
                    )
                }
        }
        if (parseError != null) {
            AlertBanner(message = parseError, tone = Tone.Danger)
        }
    }
}

/** The From-File drop zone: a dashed, tappable container whose Browse button launches the document picker. */
@Composable
private fun FileTab(
    strings: ImportPreviewStrings,
    onBrowse: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(ImportPreviewModalTestTags.DROPZONE)
                .clip(RoundedCornerShape(Radius.lg))
                .dashedBorder(color = MaterialTheme.colorScheme.outline, radius = Radius.lg)
                .padding(Spacing.xl)
                .semantics { contentDescription = strings.fileInput },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            ImportGlyphs.Upload,
            contentDescription = null,
            size = IconSize.Xl,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        HelperText(strings.dropFile)
        Button(
            label = strings.browse,
            onClick = onBrowse,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            leadingIcon = ImportGlyphs.Upload,
        )
    }
}

/** The Paste-JSON tab: a monospace-ish multiline field + a primary Validate action disabled while blank. */
@Composable
private fun PasteTab(
    strings: ImportPreviewStrings,
    value: String,
    onValueChange: (String) -> Unit,
    onValidate: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Textarea(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.testTag(ImportPreviewModalTestTags.PASTE_INPUT),
            label = strings.fromClipboard,
            minLines = PASTE_MIN_LINES,
            maxLines = PASTE_MAX_LINES,
        )
        Button(
            label = strings.validate,
            onClick = onValidate,
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
            enabled = value.isNotBlank(),
            leadingIcon = ImportGlyphs.FileJson,
        )
    }
}

/** The From-URL tab: a single-line field with a link affordance + a primary Load action disabled while blank. */
@Composable
private fun UrlTab(
    strings: ImportPreviewStrings,
    value: String,
    onValueChange: (String) -> Unit,
    onLoad: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Input(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.testTag(ImportPreviewModalTestTags.URL_INPUT),
            label = strings.fromUrl,
            leadingIcon = ImportGlyphs.Link,
        )
        Button(
            label = strings.loadUrl,
            onClick = onLoad,
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
            enabled = value.isNotBlank(),
        )
    }
}

/**
 * The validation preview — the web `ImportPreview` sub-component. Surfaces validation errors/warnings, then either the
 * dashboard summary (thumbnail + name + count badges + per-widget availability list) or the `Cannot preview` empty
 * state, then the Back / Import actions (Import only for a valid, rebuildable dashboard).
 */
@Composable
private fun ImportPreview(
    validation: ImportValidation,
    strings: ImportPreviewStrings,
    iconForWidget: (String) -> ImageVector?,
    nameForWidget: (String) -> String?,
    logger: Logger,
    onConfirm: (SavedDashboardImport) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val dashboard = validation.dashboard
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        if (validation.errors.isNotEmpty()) {
            AlertBanner(message = validation.errors.joinToString(separator = "\n"), tone = Tone.Danger)
        }
        if (validation.warnings.isNotEmpty()) {
            AlertBanner(message = validation.warnings.joinToString(separator = "\n"), tone = Tone.Warning)
        }
        if (dashboard != null) {
            FadeIn {
                ImportPreviewSummary(
                    dashboard = dashboard,
                    validation = validation,
                    strings = strings,
                    iconForWidget = iconForWidget,
                    nameForWidget = nameForWidget,
                    logger = logger,
                )
            }
        } else {
            EmptyState(message = strings.cannotPreview)
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Button(label = strings.back, onClick = onBack, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
            if (validation.isValid && dashboard != null) {
                Button(
                    label = strings.confirm,
                    onClick = { onConfirm(dashboard) },
                    variant = ButtonVariant.Primary,
                    size = ButtonSize.Sm,
                    leadingIcon = ImportGlyphs.CheckCircle,
                )
            }
        }
    }
}

/** The dashboard summary block: layout thumbnail + name + count badges, then the widget-availability list. */
@Composable
private fun ImportPreviewSummary(
    dashboard: SavedDashboardImport,
    validation: ImportValidation,
    strings: ImportPreviewStrings,
    iconForWidget: (String) -> ImageVector?,
    nameForWidget: (String) -> String?,
    logger: Logger,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Box(modifier = Modifier.width(THUMBNAIL_WIDTH)) {
                MiniGridPreview(
                    dashboard = dashboard.toMiniGridDashboard(),
                    iconForWidget = iconForWidget,
                    logger = logger,
                )
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PanelTitle(dashboard.name)
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    Badge(text = strings.availableCount(validation.availableWidgets.size), variant = BadgeVariant.Neutral)
                    if (validation.missingWidgets.isNotEmpty()) {
                        Badge(text = strings.missingCount(validation.missingWidgets.size), variant = BadgeVariant.Neutral)
                    }
                }
            }
        }
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .heightIn(max = WIDGET_LIST_MAX_HEIGHT)
                    .verticalScroll(rememberScrollState())
                    .testTag(ImportPreviewModalTestTags.WIDGET_LIST),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Caption(strings.widgets)
            validation.availableWidgets.forEach { widgetId ->
                AvailableWidgetRow(widgetId = widgetId, nameForWidget = nameForWidget, iconForWidget = iconForWidget)
            }
            validation.missingWidgets.forEach { widgetId ->
                MissingWidgetRow(widgetId = widgetId, notAvailable = strings.notAvailable)
            }
        }
    }
}

/** One available widget: a success check, the registry icon (if resolved), and the widget's name (or its id). */
@Composable
private fun AvailableWidgetRow(
    widgetId: String,
    nameForWidget: (String) -> String?,
    iconForWidget: (String) -> ImageVector?,
) {
    val widgetIcon = iconForWidget(widgetId)
    Row(
        modifier =
            rowSurface(
                fill = MaterialTheme.colorScheme.onSurface.copy(alpha = ROW_FILL_ALPHA),
                border = MaterialTheme.colorScheme.outlineVariant,
            ),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(ImportGlyphs.CheckCircle, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.success)
        if (widgetIcon != null) {
            Icon(widgetIcon, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        BodyText(nameForWidget(widgetId) ?: widgetId, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
    }
}

/** One missing widget: a danger cross, the unresolved id, and the localized "Not available" trailing note. */
@Composable
private fun MissingWidgetRow(
    widgetId: String,
    notAvailable: String,
) {
    Row(
        modifier =
            rowSurface(
                fill = MaterialTheme.colorScheme.onSurface.copy(alpha = ROW_FILL_ALPHA),
                border = TeslaTokens.status.danger.copy(alpha = MISSING_BORDER_ALPHA),
            ),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(ImportGlyphs.XCircle, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.danger)
        BodyText(widgetId, modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        Caption(notAvailable)
    }
}

/** Shared chip surface for a widget row — a subtle fill + hairline border (web `bg-white/[0.02] border …`). */
private fun rowSurface(
    fill: Color,
    border: Color,
): Modifier =
    Modifier
        .fillMaxWidth()
        .clip(RoundedCornerShape(Radius.md))
        .background(fill)
        .border(width = HAIRLINE_WIDTH, color = border, shape = RoundedCornerShape(Radius.md))
        .padding(horizontal = Spacing.md, vertical = Spacing.sm)

/** Reads a picked document's UTF-8 text off the SAF content resolver — the web `file.text()`; `null` on failure. */
private fun readJsonText(
    context: Context,
    uri: Uri,
): String? =
    runCatching {
        context.contentResolver.openInputStream(uri)?.use { stream -> stream.bufferedReader().readText() }
    }.getOrNull()

/** Draws a rounded dashed outline (the web `border-2 border-dashed`) without an opaque fill. */
private fun Modifier.dashedBorder(
    color: Color,
    radius: Dp,
): Modifier =
    drawBehind {
        drawRoundRect(
            color = color,
            cornerRadius = CornerRadius(radius.toPx()),
            style =
                Stroke(
                    width = DASH_STROKE_WIDTH.dp.toPx(),
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(DASH_ON, DASH_OFF)),
                ),
        )
    }

// ── Tokens that have no design-system entry (web pixel literals mapped to dp / alpha) ─────────────────────────────

/** Widget-row chip fill alpha over the theme foreground (web `bg-white/[0.02]`). */
private const val ROW_FILL_ALPHA: Float = 0.04f

/** Missing-widget row border tint alpha (web `border-red-500/10`). */
private const val MISSING_BORDER_ALPHA: Float = 0.18f

/** Hairline width for widget-row borders, in dp (web 1px). */
private val HAIRLINE_WIDTH: Dp = 1.dp

/** Dashed-outline stroke width, in dp (web `border-2`). */
private const val DASH_STROKE_WIDTH: Float = 2f

/** Dashed-outline on-segment length, in px. */
private const val DASH_ON: Float = 12f

/** Dashed-outline gap length, in px. */
private const val DASH_OFF: Float = 8f

/** Minimum rows the paste field shows (web `rows={10}`, floored for compact screens). */
private const val PASTE_MIN_LINES: Int = 6

/** Maximum rows the paste field grows to before scrolling. */
private const val PASTE_MAX_LINES: Int = 10

/**
 * The line glyphs the importer needs (web lucide `Upload`/`Link2`/`FileJson`/`CheckCircle2`/`XCircle`), authored as
 * 24×24 stroked [ImageVector]s — the same self-authored approach `TeslaGlyphs` uses (Android has no bundled lucide
 * set). Each is monochrome and recoloured at render time by the [Icon] tint.
 */
private object ImportGlyphs {
    val Upload: ImageVector =
        stroked("Upload") {
            moveTo(4f, 15f)
            lineTo(4f, 20f)
            lineTo(20f, 20f)
            lineTo(20f, 15f)
            moveTo(12f, 4f)
            lineTo(12f, 15f)
            moveTo(7.5f, 8.5f)
            lineTo(12f, 4f)
            lineTo(16.5f, 8.5f)
        }
    val Link: ImageVector =
        stroked("Link") {
            moveTo(9.5f, 14.5f)
            lineTo(14.5f, 9.5f)
            moveTo(8f, 16f)
            lineTo(6.5f, 14.5f)
            curveTo(5f, 13f, 5f, 10.5f, 6.5f, 9f)
            curveTo(8f, 7.5f, 10.5f, 7.5f, 12f, 9f)
            moveTo(16f, 8f)
            lineTo(17.5f, 9.5f)
            curveTo(19f, 11f, 19f, 13.5f, 17.5f, 15f)
            curveTo(16f, 16.5f, 13.5f, 16.5f, 12f, 15f)
        }
    val FileJson: ImageVector =
        stroked("FileJson") {
            moveTo(6f, 3f)
            lineTo(14f, 3f)
            lineTo(18f, 7f)
            lineTo(18f, 21f)
            lineTo(6f, 21f)
            close()
            moveTo(14f, 3f)
            lineTo(14f, 7f)
            lineTo(18f, 7f)
        }
    val CheckCircle: ImageVector =
        stroked("CheckCircle") {
            moveTo(3f, 12f)
            arcTo(9f, 9f, 0f, false, true, 21f, 12f)
            arcTo(9f, 9f, 0f, false, true, 3f, 12f)
            close()
            moveTo(8f, 12.5f)
            lineTo(11f, 15.5f)
            lineTo(16f, 9.5f)
        }
    val XCircle: ImageVector =
        stroked("XCircle") {
            moveTo(3f, 12f)
            arcTo(9f, 9f, 0f, false, true, 21f, 12f)
            arcTo(9f, 9f, 0f, false, true, 3f, 12f)
            close()
            moveTo(9f, 9f)
            lineTo(15f, 15f)
            moveTo(15f, 9f)
            lineTo(9f, 15f)
        }

    private fun stroked(
        name: String,
        build: PathBuilder.() -> Unit,
    ): ImageVector =
        ImageVector
            .Builder(
                name = name,
                defaultWidth = 24.dp,
                defaultHeight = 24.dp,
                viewportWidth = 24f,
                viewportHeight = 24f,
            ).apply {
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()
}

// ── Previews (tooling-only; the @Preview entry points exercise the render branches the web source defines) ────────

/** A no-op logger so the previews render without an ambient `LocalDataContainer` provider. */
private val PreviewLogger: Logger =
    object : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

private val PreviewStrings =
    ImportPreviewStrings(
        title = "Import Dashboard",
        preview = "Import Preview",
        fromFile = "From File",
        fromClipboard = "Paste JSON",
        fromUrl = "From URL",
        dropFile = "Drop a .json file here or click to browse",
        browse = "Browse Files",
        fileInput = "Dashboard JSON file",
        validate = "Validate & Preview",
        loadUrl = "Load from URL",
        widgets = "Widgets",
        notAvailable = "Not available",
        cannotPreview = "Cannot preview this layout",
        back = "Back",
        confirm = "Import Dashboard",
        close = "Close",
        emptyInput = "No data to validate",
        readError = "Failed to read file",
        invalidFileType = "Please drop a .json file",
        noImportParam = "URL does not contain an import parameter",
        invalidUrl = "Invalid URL format",
        availableCount = { count -> "$count widgets" },
        missingCount = { count -> "$count skipped" },
    )

private val PreviewValidation =
    ImportValidation(
        isValid = true,
        errors = emptyList(),
        warnings = listOf("1 widget(s) not available and will be skipped"),
        dashboard =
            SavedDashboardImport(
                id = "import-1",
                name = "Road-Trip Dashboard",
                widgets =
                    listOf(
                        ImportWidgetInstance(id = "w-1", widgetId = "battery-gauge"),
                        ImportWidgetInstance(id = "w-2", widgetId = "charge-status"),
                    ),
                layouts =
                    mapOf(
                        "lg" to
                            listOf(
                                RglLayoutItem(i = "w-1", x = 0, y = 0, w = 2, h = 1),
                                RglLayoutItem(i = "w-2", x = 2, y = 0, w = 2, h = 1),
                            ),
                    ),
                createdAt = "2026-01-15T00:00:00Z",
                updatedAt = "2026-01-15T00:00:00Z",
            ),
        missingWidgets = listOf("legacy-map"),
        availableWidgets = listOf("battery-gauge", "charge-status"),
    )

@Preview(name = "ImportPreviewModal — input (file tab)", showBackground = true, widthDp = 420, heightDp = 520)
@Composable
private fun ImportInputPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ImportPreviewModalBody(
            strings = PreviewStrings,
            validation = null,
            parseError = null,
            onValidate = {},
            onLoadUrl = {},
            onBrowse = {},
            onConfirm = {},
            onBack = {},
            logger = PreviewLogger,
        )
    }
}

@Preview(name = "ImportPreviewModal — parse error", showBackground = true, widthDp = 420, heightDp = 520)
@Composable
private fun ImportErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ImportPreviewModalBody(
            strings = PreviewStrings,
            validation = null,
            parseError = PreviewStrings.invalidUrl,
            onValidate = {},
            onLoadUrl = {},
            onBrowse = {},
            onConfirm = {},
            onBack = {},
            logger = PreviewLogger,
        )
    }
}

@Preview(name = "ImportPreviewModal — preview (valid)", showBackground = true, widthDp = 460, heightDp = 640)
@Composable
private fun ImportPreviewValidPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ImportPreviewModalBody(
            strings = PreviewStrings,
            validation = PreviewValidation,
            parseError = null,
            onValidate = {},
            onLoadUrl = {},
            onBrowse = {},
            onConfirm = {},
            onBack = {},
            iconForWidget = { null },
            nameForWidget = { id -> id },
            logger = PreviewLogger,
        )
    }
}

@Preview(name = "ImportPreviewModal — preview (cannot rebuild)", showBackground = true, widthDp = 460, heightDp = 520)
@Composable
private fun ImportPreviewEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ImportPreviewModalBody(
            strings = PreviewStrings,
            validation =
                ImportValidation(
                    isValid = false,
                    errors = listOf("No compatible widgets found in this layout"),
                    warnings = emptyList(),
                    dashboard = null,
                    missingWidgets = listOf("legacy-map"),
                    availableWidgets = emptyList(),
                ),
            parseError = null,
            onValidate = {},
            onLoadUrl = {},
            onBrowse = {},
            onConfirm = {},
            onBack = {},
            logger = PreviewLogger,
        )
    }
}
