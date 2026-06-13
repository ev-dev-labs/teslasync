// The native Jetpack Compose + Material 3 VehiclePhotoUpload feature view — a parity port of
// web/src/features/vehicles/components/VehiclePhotoUpload.tsx. It reproduces that surface end to end inside a
// GlassPanel: the header ("Vehicle photo" title + a first-load spinner), the photo zone (a rounded bordered box
// showing the picked/uploaded image preview or, when none, the empty-zone prompt + the "JPEG or PNG — up to N
// MB" constraints line), the choose/replace control (with an "Uploading…" in-flight state), and the remove
// control gated behind a danger confirm dialog. Beyond the web (which renders only once the read resolves) the
// native surface honours the P3 states contract: a first-load spinner + skeleton preview (no cache), a
// hard-error QueryError with retry (no cache), and the stale/offline "last known" view with a freshness chip +
// auto-refresh — so the panel is never a blank box.
//
// The view performs NO HTTP: it binds the [VehiclePhotoUploadViewModel] (P1/S8) and renders. The picked image
// bytes are read from the system photo picker (OpenDocument, restricted to JPEG/PNG to mirror the web `accept`)
// off the main thread; the upload + delete go through the shared store. Toasts (web `useToast`) are surfaced
// through the shared [ToastHost] from the view-model's typed [PhotoToast] stream, localized at this boundary
// (P1/S10). Every string resolves through the i18n catalog (the `vehicles.photos.*` + `common.*` + `freshness.*`
// + `a11y.*` keys); no English literal lives in render code, and every interactive control carries a
// TalkBack-readable label.
//
// Native-idiom adaptations (documented; capability-faithful, not scope-narrowing):
//  • the web drag-drop zone becomes the Android system photo picker (a tap opens OpenDocument filtered to
//    image/jpeg + image/png) — mobile has no pointer drag affordance, and the picker is the platform-correct
//    file source;
//  • the web dashed border becomes a solid rounded outline — Compose has no first-class dashed border and the
//    generated design tokens use solid outlines;
//  • the CURRENT (already-uploaded) photo preview is fetched through the optional injected
//    [VehiclePhotoImageLoader] (the web `<img src={vehiclePhotoUrl(...)}>`); a host that has not wired remote
//    rendering (or a failed load) shows the honest empty-zone prompt while the Replace / Remove controls still
//    convey that a photo is on file — never a blank box;
//  • there is no empty surface: the absent-photo read (`has_photo:false`, always HTTP 200) IS the friendly
//    photo zone (content), exact web parity.
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed: the mandated surface
// directory (com/teslasync/feature-views/VehiclePhotoUpload) cannot form a valid Kotlin package and the file
// hosts several co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.featureviews.vehiclephotoupload

import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.feedback.ToastHost
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.presentation.vehiclephoto.VehiclePhotoMeta
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val MAX_TOASTS = 3
private const val TOAST_DURATION_MS = 4_000L
private const val FADE_DELAY_MS = 50
private val PREVIEW_MAX_HEIGHT: Dp = 192.dp
private val DROPZONE_BORDER_WIDTH: Dp = 1.5.dp
private val PREVIEW_CORNER: Dp = 12.dp
private val DROPZONE_CORNER: Dp = 16.dp
private const val DROPZONE_FILL_ALPHA = 0.4f
private const val EM_DASH = "\u2014"

/** The two image MIME types the picker is filtered to — the native mirror of the web `accept` attribute (WebP intentionally absent). */
private val PHOTO_PICKER_MIME_TYPES = arrayOf("image/jpeg", "image/png")

/**
 * Stateful entry point. Binds the [viewModel] (P1/S8), records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), wires the system photo picker (read → instant local preview → upload), the danger confirm dialog,
 * and the toast host. Every lifecycle state the host's photo feed can carry is rendered — loading, hard error
 * with retry, content (with or without a photo), and stale/offline — without ever performing HTTP.
 *
 * @param viewModel the state holder bound to the shared photo feed + upload/delete writes (P1/S8).
 * @param imageLoader the optional read-back port that renders the CURRENT uploaded photo (web
 *   `<img src={vehiclePhotoUrl(...)}>`); defaults to [VehiclePhotoImageLoader.None] so an unwired host / preview
 *   shows the empty-zone prompt honestly.
 */
@Composable
fun VehiclePhotoUpload(
    viewModel: VehiclePhotoUploadViewModel,
    modifier: Modifier = Modifier,
    imageLoader: VehiclePhotoImageLoader = VehiclePhotoImageLoader.None,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val state by viewModel.photoState.collectAsStateWithLifecycle()
    val actions by viewModel.actions.collectAsStateWithLifecycle()

    var confirmRemove by remember { mutableStateOf(false) }
    var localPreview by remember { mutableStateOf<ImageBitmap?>(null) }
    var remotePreview by remember { mutableStateOf<ImageBitmap?>(null) }

    val hasPhoto = state.hasUploadedPhoto()
    val uploadedAt = state.data?.uploadedAt

    // Load the current uploaded photo through the optional read-back port (web `<img src=vehiclePhotoUrl(...)>`);
    // re-runs when a re-upload changes `uploaded_at` (the web `?v=` cache-buster signal).
    LaunchedEffect(viewModel.vehicleId, hasPhoto, uploadedAt, imageLoader) {
        remotePreview = if (hasPhoto) decodePhotoBytes(imageLoader.load(viewModel.vehicleId)) else null
    }

    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null) {
                scope.launch {
                    val bytes = readUriBytes(context, uri)
                    val meta = queryPickedPhotoMeta(context, uri)
                    localPreview = decodePhotoBytes(bytes)
                    val size = bytes?.size?.toLong() ?: meta.size
                    viewModel.upload(PickedPhoto(meta.name, meta.mimeType, size) { bytes ?: ByteArray(0) })
                }
            }
        }

    // Toast presentation + the web's clear-preview-on-outcome / close-dialog-on-success side effects, both folded
    // into the one effect so they stay consistent with the queue (web `onSuccess`/`onError`).
    val toastStrings = rememberPhotoToastStrings()
    val toastQueue = remember { mutableStateListOf<ToastItem>() }
    var nextToastId by remember { mutableLongStateOf(0L) }
    LaunchedEffect(viewModel, toastStrings) {
        viewModel.toasts.collect { toast ->
            when (toast) {
                is PhotoToast.Uploaded, is PhotoToast.UploadFailed -> localPreview = null
                is PhotoToast.Removed -> confirmRemove = false
                is PhotoToast.RemoveFailed -> Unit
            }
            val item = toastStrings.toItem(toast, nextToastId++)
            if (toastQueue.size >= MAX_TOASTS) toastQueue.removeAt(0)
            toastQueue.add(item)
            scope.launch {
                delay(TOAST_DURATION_MS)
                toastQueue.removeAll { it.id == item.id }
            }
        }
    }

    Box(modifier = modifier.fillMaxWidth()) {
        VehiclePhotoUploadContent(
            state = state,
            actions = actions,
            hasPhoto = hasPhoto,
            previewBitmap = localPreview ?: remotePreview,
            onChoose = { picker.launch(PHOTO_PICKER_MIME_TYPES) },
            onRemoveRequest = { confirmRemove = true },
            onRetry = viewModel::retry,
            showRemoveDialog = confirmRemove,
            onConfirmRemove = viewModel::remove,
            onCancelRemove = { confirmRemove = false },
        )
        ToastHost(
            toasts = toastQueue,
            onDismiss = { id -> toastQueue.removeAll { it.id == id } },
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }
}

/**
 * Stateless renderer of the surface — the unit/UI-test + preview entry point. Always draws the GlassPanel header
 * (so the surface is never blank), then switches the body across the cache-then-network state matrix: a
 * hard-error QueryError with retry (no cache), and otherwise the photo zone (preview / empty-zone prompt / loading
 * skeleton + the choose/replace + remove controls), plus the stale/offline freshness chip. Stale, non-error data
 * auto-refreshes, mirroring the sibling surfaces' contract. The danger confirm dialog renders over the panel
 * while [showRemoveDialog] is set.
 */
@Composable
fun VehiclePhotoUploadContent(
    state: UiState<VehiclePhotoMeta>,
    actions: PhotoActions,
    onChoose: () -> Unit,
    onRemoveRequest: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    hasPhoto: Boolean = state.hasUploadedPhoto(),
    previewBitmap: ImageBitmap? = null,
    showRemoveDialog: Boolean = false,
    onConfirmRemove: () -> Unit = {},
    onCancelRemove: () -> Unit = {},
    strings: VehiclePhotoUploadStrings = rememberVehiclePhotoUploadStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                VehiclePhotoHeader(state = state, strings = strings)
                if (state.isError) {
                    VehiclePhotoErrorBody(state = state, onRetry = onRetry, strings = strings)
                } else {
                    VehiclePhotoZone(
                        state = state,
                        actions = actions,
                        hasPhoto = hasPhoto,
                        previewBitmap = previewBitmap,
                        onChoose = onChoose,
                        onRemoveRequest = onRemoveRequest,
                        strings = strings,
                    )
                }
            }
        }
    }
    if (showRemoveDialog) {
        VehiclePhotoRemoveDialog(
            loading = actions.removing,
            onConfirm = onConfirmRemove,
            onCancel = onCancelRemove,
            strings = strings,
        )
    }
}

// ── Header ───────────────────────────────────────────────────────────────────────────────────────────────

/** The "Vehicle photo" title with the web first-load [Spinner] and the offline/stale freshness chip. */
@Composable
private fun VehiclePhotoHeader(
    state: UiState<*>,
    strings: VehiclePhotoUploadStrings,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        PanelTitle(strings.title, modifier = Modifier.weight(1f).semantics { heading() })
        if (state.isLoading) {
            Spinner(size = SpinnerSize.Sm, accessibleLabel = strings.loadingLabel)
        }
        if (state.stale || state.hasError) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                compact = true,
                fetchingLabel = strings.loadingState,
                errorLabel = strings.offline,
                formatAge = rememberPhotoFreshnessFormatter(),
            )
        }
    }
}

// ── Photo zone ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The bordered photo zone — the web dashed drop box. Shows the image preview when one is available (local pick
 * or the loaded remote photo), a shimmering skeleton while the first read is in flight, or the empty-zone glyph
 * + prompt otherwise; always the constraints line and the choose/replace (+ remove) controls beneath.
 */
@Composable
private fun VehiclePhotoZone(
    state: UiState<VehiclePhotoMeta>,
    actions: PhotoActions,
    hasPhoto: Boolean,
    previewBitmap: ImageBitmap?,
    onChoose: () -> Unit,
    onRemoveRequest: () -> Unit,
    strings: VehiclePhotoUploadStrings,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(DROPZONE_CORNER),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = DROPZONE_FILL_ALPHA),
        border = BorderStroke(DROPZONE_BORDER_WIDTH, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Spacing.lg),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            when {
                previewBitmap != null ->
                    Image(
                        bitmap = previewBitmap,
                        contentDescription = strings.previewAlt,
                        modifier = Modifier.fillMaxWidth().heightIn(max = PREVIEW_MAX_HEIGHT).clip(RoundedCornerShape(PREVIEW_CORNER)),
                        contentScale = ContentScale.Fit,
                    )

                state.isLoading ->
                    Skeleton(modifier = Modifier.fillMaxWidth(), height = PREVIEW_MAX_HEIGHT, rounded = true)

                else ->
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        Icon(
                            VehiclePhotoUploadGlyphs.Image,
                            contentDescription = null,
                            size = IconSize.Xl,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        BodyText(strings.dropPrompt, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
            }

            Caption(strings.constraints)

            VehiclePhotoControls(
                actions = actions,
                hasPhoto = hasPhoto,
                onChoose = onChoose,
                onRemoveRequest = onRemoveRequest,
                strings = strings,
            )
        }
    }
}

/** The choose/replace primary control (with its "Uploading…" in-flight state) + the ghost remove control. */
@Composable
private fun VehiclePhotoControls(
    actions: PhotoActions,
    hasPhoto: Boolean,
    onChoose: () -> Unit,
    onRemoveRequest: () -> Unit,
    strings: VehiclePhotoUploadStrings,
) {
    val uploading = actions.uploading
    val chooseLabel =
        when {
            uploading -> strings.uploading
            hasPhoto -> strings.replace
            else -> strings.choose
        }
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(
            label = chooseLabel,
            onClick = onChoose,
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
            enabled = !uploading,
            loading = uploading,
        )
        if (hasPhoto) {
            Button(
                label = strings.remove,
                onClick = onRemoveRequest,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                enabled = !uploading && !actions.removing,
            )
        }
    }
}

// ── Error + dialog ─────────────────────────────────────────────────────────────────────────────────────────

/** Hard-error surface with a retry affordance (web `QueryError`), personalised with the surface resource name. */
@Composable
private fun VehiclePhotoErrorBody(
    state: UiState<*>,
    onRetry: () -> Unit,
    strings: VehiclePhotoUploadStrings,
) {
    QueryError(
        kind =
            classifyQueryError(
                status = state.httpStatus,
                online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
                transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
            ),
        resourceName = strings.title,
        onRetry = onRetry,
    )
}

/** The danger confirm dialog gating the remove (web `ConfirmDialog`); stays open during the in-flight delete. */
@Composable
private fun VehiclePhotoRemoveDialog(
    loading: Boolean,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    strings: VehiclePhotoUploadStrings,
) {
    ConfirmDialog(
        title = strings.confirmRemoveTitle,
        message = strings.confirmRemoveMessage,
        confirmLabel = strings.confirmRemoveLabel,
        cancelLabel = strings.cancel,
        onConfirm = onConfirm,
        onCancel = onCancel,
        severity = ConfirmSeverity.Danger,
        loading = loading,
        closeLabel = strings.close,
    )
}

// ── Localized strings (P1/S10) ─────────────────────────────────────────────────────────────────────────────

/**
 * The already-localized microcopy the surface folds into its output — every `t(...)` key the web component
 * resolves, plus the lifecycle-chrome keys the added states need. Resolved through the P1/S10 i18n facade at the
 * Compose boundary and passed down, keeping the renderer free of any English literal and trivially previewable /
 * unit-testable.
 */
data class VehiclePhotoUploadStrings(
    val title: String,
    val dropPrompt: String,
    val constraints: String,
    val previewAlt: String,
    val choose: String,
    val replace: String,
    val remove: String,
    val uploading: String,
    val confirmRemoveTitle: String,
    val confirmRemoveMessage: String,
    val confirmRemoveLabel: String,
    val cancel: String,
    val close: String,
    val loadingLabel: String,
    val loadingState: String,
    val offline: String,
)

@Composable
private fun rememberVehiclePhotoUploadStrings(): VehiclePhotoUploadStrings {
    val title = stringResource(R.string.translation_vehicles_photos_upload_title)
    val dropPrompt = stringResource(R.string.translation_vehicles_photos_upload_dropPrompt)
    val constraints = stringResource(R.string.translation_vehicles_photos_upload_constraints, photoMaxMegabytes().toString())
    val previewAlt = stringResource(R.string.translation_vehicles_photos_upload_previewAlt)
    val choose = stringResource(R.string.translation_vehicles_photos_upload_choose)
    val replace = stringResource(R.string.translation_vehicles_photos_upload_replace)
    val remove = stringResource(R.string.translation_vehicles_photos_upload_remove)
    val uploading = stringResource(R.string.translation_vehicles_photos_upload_uploading)
    val confirmRemoveTitle = stringResource(R.string.translation_vehicles_photos_upload_confirmRemoveTitle)
    val confirmRemoveMessage = stringResource(R.string.translation_vehicles_photos_upload_confirmRemoveMessage)
    val confirmRemoveLabel = stringResource(R.string.translation_common_remove)
    val cancel = stringResource(R.string.translation_common_cancel)
    val close = stringResource(R.string.translation_common_close)
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    val loadingState = stringResource(R.string.translation_common_loading)
    val offline = stringResource(R.string.translation_common_offline)
    return remember(title, dropPrompt, constraints, previewAlt, choose, replace, remove, uploading) {
        VehiclePhotoUploadStrings(
            title = title,
            dropPrompt = dropPrompt,
            constraints = constraints,
            previewAlt = previewAlt,
            choose = choose,
            replace = replace,
            remove = remove,
            uploading = uploading,
            confirmRemoveTitle = confirmRemoveTitle,
            confirmRemoveMessage = confirmRemoveMessage,
            confirmRemoveLabel = confirmRemoveLabel,
            cancel = cancel,
            close = close,
            loadingLabel = loadingLabel,
            loadingState = loadingState,
            offline = offline,
        )
    }
}

/** The four toast messages (web `toast.success` / `toast.error`), mapping a typed [PhotoToast] to a [ToastItem]. */
data class VehiclePhotoToastStrings(
    val uploaded: String,
    val uploadFailed: String,
    val removed: String,
    val removeFailed: String,
) {
    fun toItem(
        toast: PhotoToast,
        id: Long,
    ): ToastItem =
        when (toast) {
            PhotoToast.Uploaded -> ToastItem(id, uploaded, Tone.Success)
            PhotoToast.Removed -> ToastItem(id, removed, Tone.Success)
            is PhotoToast.UploadFailed -> ToastItem(id, toast.message ?: uploadFailed, Tone.Danger)
            is PhotoToast.RemoveFailed -> ToastItem(id, toast.message ?: removeFailed, Tone.Danger)
        }
}

@Composable
private fun rememberPhotoToastStrings(): VehiclePhotoToastStrings {
    val uploaded = stringResource(R.string.translation_vehicles_photos_uploadSuccess)
    val uploadFailed = stringResource(R.string.translation_vehicles_photos_uploadFailed)
    val removed = stringResource(R.string.translation_vehicles_photos_deleteSuccess)
    val removeFailed = stringResource(R.string.translation_vehicles_photos_deleteFailed)
    return remember(uploaded, uploadFailed, removed, removeFailed) {
        VehiclePhotoToastStrings(uploaded, uploadFailed, removed, removeFailed)
    }
}

/** Localized relative-age formatter for the freshness chip (`translation_freshness_*`). */
@Composable
private fun rememberPhotoFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
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
}

// ── Platform IO (content URI → bytes / metadata, bytes → preview) ────────────────────────────────────────────

/** Reads the full image bytes for the picked [uri] off the main thread, or `null` on an IO failure. */
private suspend fun readUriBytes(
    context: Context,
    uri: Uri,
): ByteArray? =
    withContext(Dispatchers.IO) {
        runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull()
    }

/** The name / declared MIME / declared size the picker reports for [uri] (web `File.name` / `.type` / `.size`). */
private data class PickedPhotoMeta(
    val name: String,
    val mimeType: String?,
    val size: Long,
)

private fun queryPickedPhotoMeta(
    context: Context,
    uri: Uri,
): PickedPhotoMeta {
    var name = uri.lastPathSegment ?: DEFAULT_PHOTO_NAME
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
    return PickedPhotoMeta(name = name, mimeType = context.contentResolver.getType(uri), size = size)
}

/** Decodes image [bytes] to an [ImageBitmap] for inline preview, or `null` when absent / undecodable. */
private suspend fun decodePhotoBytes(bytes: ByteArray?): ImageBitmap? {
    if (bytes == null || bytes.isEmpty()) return null
    return withContext(Dispatchers.Default) {
        runCatching { BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap() }.getOrNull()
    }
}

private const val DEFAULT_PHOTO_NAME = "photo"

// ── Previews (tooling-only; one @Preview per rendered state) ─────────────────────────────────────────────────

private fun previewState(
    phase: UiPhase = UiPhase.Content,
    hasPhoto: Boolean = false,
    stale: Boolean = false,
    errorKind: ErrorKind? = null,
    fetchedAt: Long? = 1_700_000_000_000L,
): UiState<VehiclePhotoMeta> =
    UiState(
        phase = phase,
        data = if (phase == UiPhase.Content) VehiclePhotoMeta(hasPhoto = hasPhoto, uploadedAt = null) else null,
        fetchedAt = fetchedAt,
        stale = stale,
        errorKind = errorKind,
    )

@Preview(name = "VehiclePhotoUpload · no photo", showBackground = true)
@Composable
private fun VehiclePhotoUploadEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehiclePhotoUploadContent(
            state = previewState(hasPhoto = false),
            actions = PhotoActions(),
            onChoose = {},
            onRemoveRequest = {},
            onRetry = {},
        )
    }
}

@Preview(name = "VehiclePhotoUpload · photo on file", showBackground = true)
@Composable
private fun VehiclePhotoUploadHasPhotoPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehiclePhotoUploadContent(
            state = previewState(hasPhoto = true),
            actions = PhotoActions(),
            onChoose = {},
            onRemoveRequest = {},
            onRetry = {},
        )
    }
}

@Preview(name = "VehiclePhotoUpload · uploading", showBackground = true)
@Composable
private fun VehiclePhotoUploadUploadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehiclePhotoUploadContent(
            state = previewState(hasPhoto = false),
            actions = PhotoActions(uploading = true),
            onChoose = {},
            onRemoveRequest = {},
            onRetry = {},
        )
    }
}

@Preview(name = "VehiclePhotoUpload · loading", showBackground = true)
@Composable
private fun VehiclePhotoUploadLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehiclePhotoUploadContent(state = UiState.loading(), actions = PhotoActions(), onChoose = {}, onRemoveRequest = {}, onRetry = {})
    }
}

@Preview(name = "VehiclePhotoUpload · error", showBackground = true)
@Composable
private fun VehiclePhotoUploadErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehiclePhotoUploadContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            actions = PhotoActions(),
            onChoose = {},
            onRemoveRequest = {},
            onRetry = {},
        )
    }
}

@Preview(name = "VehiclePhotoUpload · offline (cached)", showBackground = true)
@Composable
private fun VehiclePhotoUploadOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehiclePhotoUploadContent(
            state = previewState(hasPhoto = true, stale = true, errorKind = ErrorKind.Network),
            actions = PhotoActions(),
            onChoose = {},
            onRemoveRequest = {},
            onRetry = {},
        )
    }
}

@Preview(name = "VehiclePhotoUpload · confirm remove", showBackground = true)
@Composable
private fun VehiclePhotoUploadConfirmPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehiclePhotoUploadContent(
            state = previewState(hasPhoto = true),
            actions = PhotoActions(),
            onChoose = {},
            onRemoveRequest = {},
            onRetry = {},
            showRemoveDialog = true,
        )
    }
}
