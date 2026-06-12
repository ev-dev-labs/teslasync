// The native Jetpack Compose + Material 3 NotificationChannels feature view — a parity port of
// web/src/features/notifications/components/NotificationChannelsView.tsx. It reproduces that surface end to end:
// the four-up delivery-stats row (web `useNotificationStats`), the "Add Channel" affordance, the grid of channel
// cards with per-card toggle / test / edit / delete (web `useNotificationChannels` + the mutation hooks), and the
// create/edit modal that builds a channel payload from per-kind fields. Every lifecycle state the shared
// cache-then-network feeds can carry is rendered — loading skeleton chrome, friendly empty state, hard-error
// retry surface, and stale/offline "last known" with a freshness chip + auto-refresh — so a panel is never a
// blank box. The view performs NO HTTP: it binds the [NotificationChannelsViewModel] (P1/S8) and renders.
//
// Toasts (web `useToast`) are surfaced through the shared [ToastHost] from the view-model's typed [ChannelToast]
// stream, localized at this boundary (P1/S10). The web `<BrowserPushChannelCard />` is intentionally NOT ported:
// it registers a *browser* Web-Push subscription (service worker + Notification API), a capability with no native
// Android-Compose analogue — Android push is FCM, owned by a separate subsystem (io.teslasync.android.push), not
// this CRUD surface. Omitting the browser-only affordance is a deliberate platform divergence, declared here so
// there is no silent drift.
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed: the mandated surface directory
// (com/teslasync/feature-views/NotificationChannelsView) cannot form a valid Kotlin package and the file hosts
// several co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.featureviews.notificationchannelsview

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.ToastHost
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelpIcon
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import io.teslasync.shared.core.presentation.notifications.NotificationStats
import kotlinx.coroutines.launch

private const val ACCENT_BG_ALPHA = 0.12f
private const val ACCENT_RING_ALPHA = 0.28f
private const val DISABLED_ALPHA = 0.6f
private const val MAX_TOASTS = 3
private const val TOAST_DURATION_MS = 4_000L
private val CARD_SKELETON_HEIGHT = 168.dp
private val STAT_SKELETON_HEIGHT = 84.dp
private val ICON_BOX_RADIUS = Radius.lg
private const val TYPE_CHIPS_PER_ROW = 3

/**
 * Stateful entry point for the NotificationChannels surface. Binds the [viewModel] (P1/S8), records the one-shot
 * PII-safe `view.opened` diagnostic, owns the create/edit modal + toast queue, and renders every lifecycle state
 * the channel + stats feeds can carry. The host constructs the view-model via
 * [NotificationChannelsViewModel.create]; this view never performs HTTP.
 */
@Composable
fun NotificationChannelsView(
    viewModel: NotificationChannelsViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val channelsState by viewModel.channels.collectAsStateWithLifecycle()
    val statsState by viewModel.stats.collectAsStateWithLifecycle()
    val testingChannelId by viewModel.testingChannelId.collectAsStateWithLifecycle()

    var showForm by remember { mutableStateOf(false) }
    var editingChannel by remember { mutableStateOf<NotificationChannel?>(null) }

    val toastQueue = remember { mutableStateListOf<ToastItem>() }
    ChannelToastPresenter(viewModel, toastQueue)

    Box(modifier = modifier.fillMaxWidth()) {
        NotificationChannelsViewContent(
            channelsState = channelsState,
            statsState = statsState,
            testingChannelId = testingChannelId,
            onAddClick = {
                editingChannel = null
                showForm = true
            },
            onToggle = viewModel::toggle,
            onTest = viewModel::testFromCard,
            onEdit = { channel ->
                editingChannel = channel
                showForm = true
            },
            onDelete = viewModel::delete,
            onRetry = viewModel::retry,
        )

        ToastHost(
            toasts = toastQueue,
            onDismiss = { id -> toastQueue.removeAll { it.id == id } },
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }

    if (showForm) {
        val close = {
            showForm = false
            editingChannel = null
        }
        ChannelFormModal(
            channel = editingChannel,
            onDismiss = close,
            onSaved = close,
            onSave = viewModel::save,
            onTest = viewModel::testFromModal,
        )
    }
}

/**
 * Stateless renderer of the surface — the unit/UI-test entry point. Reproduces the web layout (stats row →
 * add button → channel grid) and every lifecycle branch: stats skeletons vs tiles, a channel loading skeleton,
 * a hard-error retry surface, the no-channels empty state, and the populated cards with their freshness chip.
 * Stale (non-error) channel data auto-refreshes, mirroring the sibling surfaces' freshness contract.
 */
@Composable
fun NotificationChannelsViewContent(
    channelsState: UiState<List<NotificationChannel>>,
    statsState: UiState<NotificationStats>,
    testingChannelId: Long?,
    onAddClick: () -> Unit,
    onToggle: (NotificationChannel) -> Unit,
    onTest: (NotificationChannel) -> Unit,
    onEdit: (NotificationChannel) -> Unit,
    onDelete: (NotificationChannel) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(channelsState.stale, channelsState.refreshing, channelsState.hasError) {
        if (channelsState.stale && !channelsState.refreshing && !channelsState.hasError) onRetry()
    }

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        FadeIn { StatsRow(statsState) }
        FadeIn { AddChannelButton(onAddClick) }
        FadeIn {
            ChannelsSection(
                channelsState = channelsState,
                testingChannelId = testingChannelId,
                onToggle = onToggle,
                onTest = onTest,
                onEdit = onEdit,
                onDelete = onDelete,
                onRetry = onRetry,
            )
        }
    }
}

// ── Stats row ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The four delivery-stat tiles (web `MetricCard` row). Shows the tiles once stats resolve (always, even all-zero,
 * matching the web `stats ?` branch), a freshness chip when the cached value is stale/offline, and a row of
 * shimmering skeletons while the first fetch runs so the header is never blank.
 */
@Composable
private fun StatsRow(state: UiState<NotificationStats>) {
    val stats = state.data
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (state.stale || state.refreshing || state.hasError) {
            FreshnessChip(state)
        }
        if (stats != null) {
            val tiles = remember(stats) { statTiles(stats) }
            StatTileGrid(tiles)
        } else {
            StatSkeletonGrid()
        }
    }
}

@Composable
private fun StatTileGrid(tiles: List<StatTileData>) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        tiles.chunked(2).forEach { rowTiles ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                rowTiles.forEach { tile ->
                    StatTile(tile, modifier = Modifier.weight(1f))
                }
                if (rowTiles.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun StatTile(
    tile: StatTileData,
    modifier: Modifier = Modifier,
) {
    val label = statLabel(tile.kind)
    MetricCard(
        label = label,
        value = tile.value,
        modifier = modifier,
        icon = statGlyph(tile.kind),
        accent = statAccent(tile.kind),
        iconContentDescription = label,
    )
}

@Composable
private fun StatSkeletonGrid() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        repeat(2) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                repeat(2) {
                    Skeleton(modifier = Modifier.weight(1f), height = STAT_SKELETON_HEIGHT)
                }
            }
        }
    }
}

@Composable
private fun statLabel(kind: StatKind): String =
    when (kind) {
        StatKind.Sent -> stringResource(R.string.translation_notifications_stats_sent)
        StatKind.Failed -> stringResource(R.string.translation_notifications_stats_failed)
        StatKind.Pending -> stringResource(R.string.translation_notifications_stats_pending)
        StatKind.ActiveChannels -> stringResource(R.string.translation_notifications_stats_activeChannels)
    }

@Composable
private fun statAccent(kind: StatKind): Color =
    when (kind) {
        StatKind.Sent -> TeslaTokens.status.success
        StatKind.Failed -> TeslaTokens.status.danger
        StatKind.Pending -> TeslaTokens.status.warning
        StatKind.ActiveChannels -> TeslaTokens.status.info
    }

private fun statGlyph(kind: StatKind) =
    when (kind) {
        StatKind.Sent -> ChannelGlyphs.CheckCircle
        StatKind.Failed -> ChannelGlyphs.XCircle
        StatKind.Pending -> ChannelGlyphs.Bell
        StatKind.ActiveChannels -> ChannelGlyphs.Bell
    }

// ── Add button ───────────────────────────────────────────────────────────────────────────────────────────

/** The right-aligned primary "Add Channel" button (web header CTA). */
@Composable
private fun AddChannelButton(onAddClick: () -> Unit) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Button(
            label = stringResource(R.string.translation_notifications_channels_add),
            onClick = onAddClick,
            variant = ButtonVariant.Primary,
            leadingIcon = io.teslasync.android.components.ui.TeslaGlyphs.Plus,
        )
    }
}

// ── Channels section ─────────────────────────────────────────────────────────────────────────────────────

/** The channel grid area: loading skeletons / hard-error retry / empty state / cards (+ freshness chip). */
@Composable
private fun ChannelsSection(
    channelsState: UiState<List<NotificationChannel>>,
    testingChannelId: Long?,
    onToggle: (NotificationChannel) -> Unit,
    onTest: (NotificationChannel) -> Unit,
    onEdit: (NotificationChannel) -> Unit,
    onDelete: (NotificationChannel) -> Unit,
    onRetry: () -> Unit,
) {
    when {
        channelsState.isLoading -> ChannelsLoading()
        channelsState.isError -> ChannelsError(onRetry)
        channelsState.isEmpty -> ChannelsEmpty()
        else ->
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                if (channelsState.stale || channelsState.refreshing || channelsState.hasError) {
                    FreshnessChip(channelsState)
                }
                (channelsState.data ?: emptyList()).forEach { channel ->
                    ChannelCard(
                        channel = channel,
                        isTesting = testingChannelId == channel.id,
                        onToggle = onToggle,
                        onTest = onTest,
                        onEdit = onEdit,
                        onDelete = onDelete,
                    )
                }
            }
    }
}

@Composable
private fun ChannelsLoading() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        repeat(3) {
            Skeleton(
                modifier = Modifier.semantics { contentDescription = LOADING_TAG },
                height = CARD_SKELETON_HEIGHT,
            )
        }
    }
}

@Composable
private fun ChannelsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun ChannelsEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_notifications_channels_empty_message),
        title = stringResource(R.string.translation_notifications_channels_empty_title),
        icon = ChannelGlyphs.Bell,
        modifier = Modifier.fillMaxWidth(),
    )
}

// ── Channel card ─────────────────────────────────────────────────────────────────────────────────────────

/** One channel card: identity header + toggle, masked config preview, and the test / edit / delete actions. */
@Composable
private fun ChannelCard(
    channel: NotificationChannel,
    isTesting: Boolean,
    onToggle: (NotificationChannel) -> Unit,
    onTest: (NotificationChannel) -> Unit,
    onEdit: (NotificationChannel) -> Unit,
    onDelete: (NotificationChannel) -> Unit,
) {
    val meta = remember(channel.channelKind) { channelMetaFor(channel.channelKind) }
    GlassPanel(
        modifier =
            Modifier
                .fillMaxWidth()
                .alpha(if (channel.enabled) 1f else DISABLED_ALPHA),
        padding = PanelPadding.Lg,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            ChannelCardHeader(channel = channel, meta = meta, onToggle = onToggle)
            ChannelConfigPreview(channel)
            ChannelCardActions(
                channel = channel,
                isTesting = isTesting,
                onTest = onTest,
                onEdit = onEdit,
                onDelete = onDelete,
            )
        }
    }
}

@Composable
private fun ChannelCardHeader(
    channel: NotificationChannel,
    meta: ChannelTypeMeta,
    onToggle: (NotificationChannel) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Row(
            modifier = Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BrandIconBox(meta)
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                BodyText(channel.name)
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Caption(meta.label)
                    ChannelStatusBadge(channel.enabled)
                }
            }
        }
        Toggle(
            checked = channel.enabled,
            onCheckedChange = { onToggle(channel) },
            modifier = Modifier.width(56.dp),
        )
    }
}

@Composable
private fun BrandIconBox(meta: ChannelTypeMeta) {
    Box(
        modifier =
            Modifier
                .clip(RoundedCornerShape(ICON_BOX_RADIUS))
                .background(meta.brandColor.copy(alpha = ACCENT_BG_ALPHA))
                .border(1.dp, meta.brandColor.copy(alpha = ACCENT_RING_ALPHA), RoundedCornerShape(ICON_BOX_RADIUS))
                .padding(Spacing.sm),
        contentAlignment = Alignment.Center,
    ) {
        Icon(meta.glyph, contentDescription = null, size = IconSize.Md, tint = meta.brandColor)
    }
}

@Composable
private fun ChannelStatusBadge(enabled: Boolean) {
    if (enabled) {
        Badge(stringResource(R.string.translation_notifications_channels_active), variant = BadgeVariant.Success)
    } else {
        Badge(stringResource(R.string.translation_notifications_channels_disabled), variant = BadgeVariant.Neutral)
    }
}

/** The first three config rows, credentials masked (web nested preview box). Never shown blank. */
@Composable
private fun ChannelConfigPreview(channel: NotificationChannel) {
    val entries = remember(channel) { configPreviewEntries(channel) }
    if (entries.isEmpty()) return
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Sm) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            entries.forEach { (key, value) ->
                Caption("$key: $value")
            }
        }
    }
}

@Composable
private fun ChannelCardActions(
    channel: NotificationChannel,
    isTesting: Boolean,
    onTest: (NotificationChannel) -> Unit,
    onEdit: (NotificationChannel) -> Unit,
    onDelete: (NotificationChannel) -> Unit,
) {
    val testLabel =
        if (isTesting) {
            stringResource(R.string.translation_notifications_channels_testing)
        } else {
            stringResource(R.string.translation_notifications_channels_testShort)
        }
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(
            label = testLabel,
            onClick = { onTest(channel) },
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
            loading = isTesting,
            leadingIcon = ChannelGlyphs.Beaker,
        )
        Button(
            label = stringResource(R.string.translation_common_edit),
            onClick = { onEdit(channel) },
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            leadingIcon = io.teslasync.android.components.ui.TeslaGlyphs.Edit,
        )
        Spacer(Modifier.weight(1f))
        IconButton(
            imageVector = ChannelGlyphs.Trash,
            contentDescription = stringResource(R.string.translation_common_delete),
            onClick = { onDelete(channel) },
            size = IconSize.Sm,
            tint = TeslaTokens.status.danger,
        )
    }
}

// ── Freshness chip ───────────────────────────────────────────────────────────────────────────────────────

/** Right-aligned freshness chip shown above cached data that is refreshing / stale / offline. */
@Composable
private fun FreshnessChip(state: UiState<*>) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
        )
    }
}

// ── Create / edit modal ──────────────────────────────────────────────────────────────────────────────────

private sealed interface TestBanner {
    data class Success(
        val message: String,
    ) : TestBanner

    data class Failure(
        val message: String,
    ) : TestBanner
}

/**
 * The create/edit channel modal (web `ChannelFormModal`). Owns the transient form state (kind, name, enabled,
 * per-field config, inline error + test banner, pending flags). [onSave] returns a [Result] so a success closes
 * via [onSaved] and a failure shows the inline error; [onTest] returns the structured result for the inline
 * banner and raises the modal's toast inside the view-model.
 */
@Composable
private fun ChannelFormModal(
    channel: NotificationChannel?,
    onDismiss: () -> Unit,
    onSaved: () -> Unit,
    onSave: suspend (io.teslasync.shared.core.presentation.notifications.NotificationChannelInput) -> Result<NotificationChannel>,
    onTest: suspend (Long) -> Result<io.teslasync.shared.core.presentation.notifications.ChannelTestResult>,
) {
    val isEdit = channel != null
    val scope = rememberCoroutineScope()

    var kind by remember { mutableStateOf(channel?.channelKind ?: ChannelKind.Discord) }
    var name by remember { mutableStateOf(channel?.name ?: "") }
    var enabled by remember { mutableStateOf(channel?.enabled ?: true) }
    var config by remember { mutableStateOf(channel?.let { channelToFormConfig(it) } ?: emptyMap()) }
    var formError by remember { mutableStateOf<String?>(null) }
    var testBanner by remember { mutableStateOf<TestBanner?>(null) }
    var saving by remember { mutableStateOf(false) }
    var testing by remember { mutableStateOf(false) }

    val meta = remember(kind) { channelMetaFor(kind) }
    val nameRequiredMsg = stringResource(R.string.translation_notifications_channels_nameRequired)
    val namePrefix = stringResource(R.string.translation_notifications_channels_namePlaceholderPrefix) // parity:allow P1/S10 i18n key id
    val testSuccessMsg = stringResource(R.string.translation_notifications_channels_testSuccess)
    val testFailedMsg = stringResource(R.string.translation_notifications_channels_testFailed)

    val title =
        if (isEdit) {
            stringResource(R.string.translation_notifications_channels_editTitle)
        } else {
            stringResource(R.string.translation_notifications_channels_addTitle)
        }

    Modal(
        onDismissRequest = onDismiss,
        title = title,
        closeLabel = stringResource(R.string.translation_common_close),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            if (!isEdit) {
                ChannelTypeSelector(
                    selectedKind = kind,
                    onSelect = { selected ->
                        kind = selected
                        config = emptyMap()
                        testBanner = null
                    },
                )
            }

            Input(
                value = name,
                onValueChange = { name = it },
                label = stringResource(R.string.translation_notifications_channels_nameLabel),
                hint = "$namePrefix ${meta.label}",
            )

            ChannelConfigFields(
                meta = meta,
                config = config,
                onFieldChange = { key, value -> config = config + (key to value) },
            )

            Toggle(
                checked = enabled,
                onCheckedChange = { enabled = it },
                label =
                    if (enabled) {
                        stringResource(R.string.translation_notifications_channels_enabled)
                    } else {
                        stringResource(R.string.translation_notifications_channels_disabled)
                    },
            )

            testBanner?.let { TestResultBanner(it) }
            formError?.let { ErrorText(it) }

            ChannelFormActions(
                isEdit = isEdit,
                saving = saving,
                testing = testing,
                onCancel = onDismiss,
                onTest = {
                    val target = channel
                    if (target != null) {
                        testing = true
                        testBanner = null
                        scope.launch {
                            val result = onTest(target.id)
                            testing = false
                            testBanner =
                                result.fold(
                                    onSuccess = { data ->
                                        if (data.success) {
                                            TestBanner.Success(testSuccessMsg)
                                        } else {
                                            TestBanner.Failure(data.error ?: testFailedMsg)
                                        }
                                    },
                                    onFailure = { TestBanner.Failure(testFailedMsg) },
                                )
                        }
                    }
                },
                onSubmit = {
                    formError = null
                    testBanner = null
                    if (name.isBlank()) {
                        formError = nameRequiredMsg
                    } else {
                        val payload =
                            buildChannelPayload(kind, name, enabled, config, channel?.id)
                        saving = true
                        scope.launch {
                            val result = onSave(payload)
                            saving = false
                            result.fold(
                                onSuccess = { onSaved() },
                                onFailure = { error -> formError = error.message ?: error.toString() },
                            )
                        }
                    }
                },
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChannelTypeSelector(
    selectedKind: ChannelKind,
    onSelect: (ChannelKind) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Caption(stringResource(R.string.translation_notifications_channels_typeLabel))
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            maxItemsInEachRow = TYPE_CHIPS_PER_ROW,
        ) {
            CHANNEL_TYPES.forEach { meta ->
                ChannelTypeChip(
                    meta = meta,
                    selected = meta.kind == selectedKind,
                    onSelect = { onSelect(meta.kind) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun ChannelTypeChip(
    meta: ChannelTypeMeta,
    selected: Boolean,
    onSelect: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val border = if (selected) meta.brandColor else MaterialTheme.colorScheme.outlineVariant
    val background = if (selected) meta.brandColor.copy(alpha = ACCENT_BG_ALPHA) else Color.Transparent
    val content = if (selected) meta.brandColor else MaterialTheme.colorScheme.onSurfaceVariant
    Column(
        modifier =
            modifier
                .clip(RoundedCornerShape(Radius.md))
                .background(background)
                .border(1.dp, border, RoundedCornerShape(Radius.md))
                .selectable(selected = selected, role = Role.RadioButton, onClick = onSelect)
                .semantics { contentDescription = meta.label }
                .padding(Spacing.sm),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(meta.glyph, contentDescription = null, size = IconSize.Md, tint = content)
        Caption(meta.label)
    }
}

@Composable
private fun ChannelConfigFields(
    meta: ChannelTypeMeta,
    config: Map<String, String>,
    onFieldChange: (String, String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Caption("${meta.label} ${stringResource(R.string.translation_notifications_channels_configLabel)}")
            HelpIcon(
                text = stringResource(R.string.translation_notifications_channels_testHint),
                contentDescription = "${meta.label} ${stringResource(R.string.translation_notifications_channels_configLabel)}",
            )
        }
        meta.fields.forEach { field ->
            Input(
                value = config[field.key].orEmpty(),
                onValueChange = { onFieldChange(field.key, it) },
                label = field.label,
                hint = field.hint,
                keyboardType = if (field.secret) KeyboardType.Password else KeyboardType.Text,
                visualTransformation =
                    if (field.secret) PasswordVisualTransformation() else VisualTransformation.None,
            )
        }
        HelperText(stringResource(R.string.translation_notifications_channels_testHint))
    }
}

@Composable
private fun TestResultBanner(banner: TestBanner) {
    val accent =
        when (banner) {
            is TestBanner.Success -> TeslaTokens.status.success
            is TestBanner.Failure -> TeslaTokens.status.danger
        }
    val glyph =
        when (banner) {
            is TestBanner.Success -> ChannelGlyphs.CheckCircle
            is TestBanner.Failure -> ChannelGlyphs.XCircle
        }
    val message =
        when (banner) {
            is TestBanner.Success -> banner.message
            is TestBanner.Failure -> banner.message
        }
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Sm) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(glyph, contentDescription = null, size = IconSize.Sm, tint = accent)
            BodyText(message, color = accent)
        }
    }
}

@Composable
private fun ChannelFormActions(
    isEdit: Boolean,
    saving: Boolean,
    testing: Boolean,
    onCancel: () -> Unit,
    onTest: () -> Unit,
    onSubmit: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (isEdit) {
            Button(
                label =
                    if (testing) {
                        stringResource(R.string.translation_notifications_channels_testing)
                    } else {
                        stringResource(R.string.translation_notifications_channels_test)
                    },
                onClick = onTest,
                variant = ButtonVariant.Secondary,
                loading = testing,
                leadingIcon = ChannelGlyphs.Beaker,
            )
        }
        Spacer(Modifier.weight(1f))
        Button(
            label = stringResource(R.string.translation_common_cancel),
            onClick = onCancel,
            variant = ButtonVariant.Ghost,
        )
        Button(
            label = submitLabel(isEdit, saving),
            onClick = onSubmit,
            variant = ButtonVariant.Primary,
            loading = saving,
        )
    }
}

@Composable
private fun submitLabel(
    isEdit: Boolean,
    saving: Boolean,
): String =
    when {
        saving -> stringResource(R.string.translation_common_saving)
        isEdit -> stringResource(R.string.translation_common_update)
        else -> stringResource(R.string.translation_common_create)
    }

// ── Toast presentation ───────────────────────────────────────────────────────────────────────────────────

/** Localized strings the toast presenter folds a [ChannelToast] into a [ToastItem] with. */
private data class ChannelToastStrings(
    val enabled: String,
    val disabled: String,
    val toggleFailed: String,
    val deleted: String,
    val deleteFailed: String,
    val testSent: String,
    val testFailed: String,
) {
    fun toItem(
        toast: ChannelToast,
        id: Long,
    ): ToastItem =
        when (toast) {
            ChannelToast.Enabled -> ToastItem(id, enabled, Tone.Success)
            ChannelToast.Disabled -> ToastItem(id, disabled, Tone.Success)
            ChannelToast.ToggleFailed -> ToastItem(id, toggleFailed, Tone.Danger)
            ChannelToast.Deleted -> ToastItem(id, deleted, Tone.Success)
            ChannelToast.DeleteFailed -> ToastItem(id, deleteFailed, Tone.Danger)
            is ChannelToast.TestSucceeded -> ToastItem(id, prefixed(toast.channelName, testSent), Tone.Success)
            is ChannelToast.TestFailed ->
                ToastItem(id, withDetail(prefixed(toast.channelName, testFailed), toast.detail), Tone.Danger)
        }

    private fun prefixed(
        name: String?,
        body: String,
    ): String = if (name.isNullOrBlank()) body else "$name: $body"

    private fun withDetail(
        base: String,
        detail: String?,
    ): String = if (detail.isNullOrBlank()) base else "$base \u2014 $detail"
}

@Composable
private fun rememberChannelToastStrings(): ChannelToastStrings =
    ChannelToastStrings(
        enabled = stringResource(R.string.translation_notifications_channels_toggledOn),
        disabled = stringResource(R.string.translation_notifications_channels_toggledOff),
        toggleFailed = stringResource(R.string.translation_notifications_channels_toggleFailed),
        deleted = stringResource(R.string.translation_notifications_channels_deleted),
        deleteFailed = stringResource(R.string.translation_notifications_channels_deleteFailed),
        testSent = stringResource(R.string.translation_notifications_channels_testSuccessShort),
        testFailed = stringResource(R.string.translation_notifications_channels_testFailed),
    )

/** Collects the view-model's [ChannelToast] stream into the bottom [ToastHost] queue, auto-dismissing each. */
@Composable
private fun ChannelToastPresenter(
    viewModel: NotificationChannelsViewModel,
    queue: androidx.compose.runtime.snapshots.SnapshotStateList<ToastItem>,
) {
    val strings = rememberChannelToastStrings()
    val scope = rememberCoroutineScope()
    var nextId by remember { mutableLongStateOf(0L) }
    LaunchedEffect(viewModel, strings) {
        viewModel.toasts.collect { toast ->
            val item = strings.toItem(toast, nextId++)
            if (queue.size >= MAX_TOASTS) queue.removeAt(0)
            queue.add(item)
            scope.launch {
                kotlinx.coroutines.delay(TOAST_DURATION_MS)
                queue.removeAll { it.id == item.id }
            }
        }
    }
}

/** Accessibility / test tag for the loading skeleton chrome (kept stable for the UI test). */
private const val LOADING_TAG = "Loading"

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────────

private val PREVIEW_STATS =
    NotificationStats(totalSent = 1280, sent = 1240, failed = 12, pending = 3, totalChannels = 4, enabledChannels = 3)

private fun previewChannels(): List<NotificationChannel> =
    listOf(
        NotificationChannel.Discord(
            id = 1,
            name = "Ops Discord",
            enabled = true,
            webhookUrl = "https://discord.com/api/webhooks/123/abc",
        ),
        NotificationChannel.Email(
            id = 2,
            name = "Email alerts",
            enabled = false,
            smtpHost = "smtp.gmail.com",
            smtpPort = 587,
            smtpUsername = "alerts@example.com",
            smtpPassword = "secret",
            fromAddress = "alerts@example.com",
            toAddresses = listOf("you@example.com"),
            useTls = true,
        ),
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun NotificationChannelsContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        NotificationChannelsViewContent(
            channelsState = UiState(UiPhase.Content, previewChannels()),
            statsState = UiState(UiPhase.Content, PREVIEW_STATS),
            testingChannelId = null,
            onAddClick = {},
            onToggle = {},
            onTest = {},
            onEdit = {},
            onDelete = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun NotificationChannelsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        NotificationChannelsViewContent(
            channelsState = UiState(UiPhase.Empty, emptyList()),
            statsState = UiState(UiPhase.Content, PREVIEW_STATS),
            testingChannelId = null,
            onAddClick = {},
            onToggle = {},
            onTest = {},
            onEdit = {},
            onDelete = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun NotificationChannelsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        NotificationChannelsViewContent(
            channelsState = UiState(UiPhase.Loading),
            statsState = UiState(UiPhase.Loading),
            testingChannelId = null,
            onAddClick = {},
            onToggle = {},
            onTest = {},
            onEdit = {},
            onDelete = {},
            onRetry = {},
        )
    }
}
