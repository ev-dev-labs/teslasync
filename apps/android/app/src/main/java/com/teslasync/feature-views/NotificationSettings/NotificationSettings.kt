// The native Jetpack Compose + Material 3 NotificationSettings feature view — a parity port of
// web/src/features/settings/components/NotificationSettings.tsx. The web component renders a single faded-in
// GlassPanel with three stacked sections: (1) Browser notifications — a cyan Bell IconBox header over the
// permission control (Enable button / Enabled badge / blocked notice, or an "unsupported" notice) plus the
// per-event push toggles once granted; (2) Browser tab signals — the two server-persisted flags
// (unread-count badge, critical-alert flash) with a hint; (3) Notification sounds — a cyan Volume2 IconBox
// header, the master switch, an autoplay hint, the seven per-channel rows each with a Test button, and the
// volume slider.
//
// This port keeps that composition end to end and performs NO HTTP, audio, or permission I/O itself. The
// host binds the bundled [NotificationSettingsViewModel] (P1/S8): the browser-tab-signals come from the
// network-backed `/settings` document as a [UiState], so this view renders every lifecycle state that layer
// carries — a first-load skeleton, a hard error with retry, content, and stale/offline "last known" with a
// freshness chip + re-read. The device-local sound + web-push preferences are collected snapshots; the
// runtime notification permission is read (and requested) by the stateful entry, since it is Activity-
// coupled. A stateless [NotificationSettingsContent] takes hand-built state so every branch is preview- and
// screenshot-testable. Every user-facing string resolves through the i18n catalog (P1/S10); colors are
// design tokens, never raw hex.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/NotificationSettings) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.notificationsettings

import android.Manifest
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxSize
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Slider
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import kotlin.math.roundToInt

/** Gap between the panel's three sections — the web `space-y-5`. */
private val SECTION_GAP = Spacing.lg

/** Inner vertical rhythm within a section — the web `space-y-3` / `space-y-4`. */
private val ROW_GAP = Spacing.md

/** Hairline divider alpha — the web `border-white/[0.06]`. */
private const val DIVIDER_ALPHA = 0.5f

/** Dim applied to a sound channel row when the master switch is off — the web `opacity-60`. */
private const val DISABLED_ROW_ALPHA = 0.6f

/** Subtle channel-row fill — the web `bg-[var(--surface-2)]`. */
private const val ROW_BG_ALPHA = 0.4f

/** Discrete slider stops between 0 and 100 at a step of 5 (web `step={5}`): 21 values → 19 interior steps. */
private const val VOLUME_STEPS = 19
private const val VOLUME_MAX = 100f

private val SKELETON_ROW_HEIGHT = 28.dp
private val SECTION_MIN_HEIGHT = 88.dp
private val ROW_CORNER = Radius.md
private const val FADE_DELAY_MS = 130

/**
 * Stateful entry point. Collects the bundled [viewModel] state, records the one-shot `view.opened`
 * diagnostic + loads the device-local prefs ([NotificationSettingsViewModel.onAppear]), reads the runtime
 * notification permission (re-read on resume so a change in system settings is reflected), and wires the
 * permission request. Renders the stateless [NotificationSettingsContent].
 */
@Composable
fun NotificationSettings(
    viewModel: NotificationSettingsViewModel,
    modifier: Modifier = Modifier,
) {
    val tabSignals by viewModel.tabSignals.collectAsStateWithLifecycle()
    val soundPrefs by viewModel.soundPrefs.collectAsStateWithLifecycle()
    val webPushPrefs by viewModel.webPushPrefs.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.onAppear() }

    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var permissionAsked by rememberSaveable { mutableStateOf(false) }
    var permission by remember { mutableStateOf(browserNotifPermissionFor(context, permissionAsked)) }
    var autoplayHintDismissed by rememberSaveable { mutableStateOf(false) }

    // Re-read the OS notification state on resume (web reflects the live `Notification.permission`).
    DisposableEffect(lifecycleOwner, permissionAsked) {
        val observer =
            LifecycleEventObserver { _, event ->
                if (event == Lifecycle.Event.ON_RESUME) {
                    permission = browserNotifPermissionFor(context, permissionAsked)
                }
            }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val permissionLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            permissionAsked = true
            permission = if (granted) BrowserNotifPermission.Granted else BrowserNotifPermission.Denied
        }

    val onRequestPermission = {
        requestNotificationPermission(context) {
            permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    NotificationSettingsContent(
        tabSignals = tabSignals,
        soundPrefs = soundPrefs,
        webPushPrefs = webPushPrefs,
        permission = permission,
        notificationsSupported = true,
        showAutoplayHint = soundPrefs.master && !autoplayHintDismissed,
        modifier = modifier,
        onRequestPermission = onRequestPermission,
        onAlerts = viewModel::setAlerts,
        onExportStatus = viewModel::setExportStatus,
        onTabBadge = viewModel::setTabBadge,
        onCriticalFlash = viewModel::setCriticalFlash,
        onMaster = viewModel::setSoundMaster,
        onCategory = viewModel::setSoundCategory,
        onVolumePercent = viewModel::setVolumePercent,
        onTest = { category ->
            // Re-show the playback hint if the device could not produce audio (web `no_audio_context` reset).
            if (viewModel.testSound(category) == SoundPlayResult.Unavailable) autoplayHintDismissed = false
        },
        onRetry = viewModel::retry,
        onRefresh = viewModel::refresh,
    )
}

/**
 * Stateless surface — the faded-in GlassPanel with the three sections, hoisted out of the view-model so
 * every state is preview- and screenshot-testable with hand-built inputs.
 */
@Composable
fun NotificationSettingsContent(
    tabSignals: UiState<TabSignals>,
    soundPrefs: NotificationSoundPrefs,
    webPushPrefs: WebPushPrefs,
    permission: BrowserNotifPermission,
    notificationsSupported: Boolean,
    showAutoplayHint: Boolean,
    modifier: Modifier = Modifier,
    onRequestPermission: () -> Unit = {},
    onAlerts: (Boolean) -> Unit = {},
    onExportStatus: (Boolean) -> Unit = {},
    onTabBadge: (Boolean) -> Unit = {},
    onCriticalFlash: (Boolean) -> Unit = {},
    onMaster: (Boolean) -> Unit = {},
    onCategory: (NotificationSoundCategory, Boolean) -> Unit = { _, _ -> },
    onVolumePercent: (Int) -> Unit = {},
    onTest: (NotificationSoundCategory) -> Unit = {},
    onRetry: () -> Unit = {},
    onRefresh: () -> Unit = {},
) {
    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(SECTION_GAP)) {
                BrowserNotificationsSection(
                    notificationsSupported = notificationsSupported,
                    permission = permission,
                    webPushPrefs = webPushPrefs,
                    onRequestPermission = onRequestPermission,
                    onAlerts = onAlerts,
                    onExportStatus = onExportStatus,
                )
                SectionDivider()
                TabSignalsSection(
                    state = tabSignals,
                    onTabBadge = onTabBadge,
                    onCriticalFlash = onCriticalFlash,
                    onRetry = onRetry,
                    onRefresh = onRefresh,
                )
                SectionDivider()
                NotificationSoundsSection(
                    prefs = soundPrefs,
                    showAutoplayHint = showAutoplayHint,
                    onMaster = onMaster,
                    onCategory = onCategory,
                    onVolumePercent = onVolumePercent,
                    onTest = onTest,
                )
            }
        }
    }
}

// ── Section 1: Browser notifications (web useWebPush + useNotificationListener) ─────────────────────────

@Composable
private fun BrowserNotificationsSection(
    notificationsSupported: Boolean,
    permission: BrowserNotifPermission,
    webPushPrefs: WebPushPrefs,
    onRequestPermission: () -> Unit,
    onAlerts: (Boolean) -> Unit,
    onExportStatus: (Boolean) -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(ROW_GAP)) {
        SectionHeader(
            glyph = NotificationSettingsGlyphs.Bell,
            title = stringResource(R.string.translation_browserNotifications_title),
            subtitle = stringResource(R.string.translation_browserNotifications_subtitle),
        )
        if (!notificationsSupported) {
            HelperText(stringResource(R.string.translation_browserNotifications_unsupported))
        } else {
            PermissionControl(permission = permission, onRequestPermission = onRequestPermission)
            if (showsEventPreferences(permission)) {
                EventPreferences(prefs = webPushPrefs, onAlerts = onAlerts, onExportStatus = onExportStatus)
            }
        }
    }
}

/** The single permission control for the current state — web `permission` branch. */
@Composable
private fun PermissionControl(
    permission: BrowserNotifPermission,
    onRequestPermission: () -> Unit,
) {
    when (browserNotifControl(permission)) {
        BrowserNotifControl.RequestPermission ->
            Button(
                label = stringResource(R.string.translation_browserNotifications_enable),
                onClick = onRequestPermission,
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
                leadingIcon = NotificationSettingsGlyphs.Bell,
            )
        BrowserNotifControl.ShowEnabledBadge ->
            Badge(text = stringResource(R.string.translation_browserNotifications_enabled), variant = BadgeVariant.Success)
        BrowserNotifControl.ShowBlockedMessage ->
            HelperText(stringResource(R.string.translation_browserNotifications_blocked))
    }
}

/** The per-event push toggles, shown once permission is granted — web `permission === 'granted'` block. */
@Composable
private fun EventPreferences(
    prefs: WebPushPrefs,
    onAlerts: (Boolean) -> Unit,
    onExportStatus: (Boolean) -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Caption(stringResource(R.string.translation_browserNotifications_events))
        Toggle(
            checked = prefs.alerts,
            onCheckedChange = onAlerts,
            label = stringResource(R.string.translation_browserNotifications_alerts),
        )
        Toggle(
            checked = prefs.exportStatus,
            onCheckedChange = onExportStatus,
            label = stringResource(R.string.translation_browserNotifications_exportStatus),
        )
        HelperText(stringResource(R.string.translation_browserNotifications_hint))
    }
}

// ── Section 2: Browser tab signals (web useSettings / useSaveSettings) ──────────────────────────────────

@Composable
private fun TabSignalsSection(
    state: UiState<TabSignals>,
    onTabBadge: (Boolean) -> Unit,
    onCriticalFlash: (Boolean) -> Unit,
    onRetry: () -> Unit,
    onRefresh: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Caption(stringResource(R.string.translation_settings_tab_heading))
        when (tabSignalsSurfaceFor(state.isLoading, state.isError)) {
            TabSignalsSurface.Loading -> TabSignalsLoading()
            TabSignalsSurface.Error -> TabSignalsError(onRetry = onRetry)
            TabSignalsSurface.Ready -> {
                if (state.stale || state.hasError || state.refreshing) {
                    TabSignalsFreshness(state = state, onRefresh = onRefresh)
                }
                TabSignalsToggles(
                    signals = state.data ?: TabSignals.DEFAULT,
                    onTabBadge = onTabBadge,
                    onCriticalFlash = onCriticalFlash,
                )
            }
        }
    }
}

/** The two tab-signal toggles + the hint — web parity (missing fields default ON). */
@Composable
private fun TabSignalsToggles(
    signals: TabSignals,
    onTabBadge: (Boolean) -> Unit,
    onCriticalFlash: (Boolean) -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Toggle(
            checked = signals.badgeEnabled,
            onCheckedChange = onTabBadge,
            label = stringResource(R.string.translation_settings_tab_badge),
        )
        Toggle(
            checked = signals.criticalFlashEnabled,
            onCheckedChange = onCriticalFlash,
            label = stringResource(R.string.translation_settings_tab_flash),
        )
        HelperText(stringResource(R.string.translation_settings_tab_hint))
    }
}

@Composable
private fun TabSignalsLoading() {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(height = SKELETON_ROW_HEIGHT, rounded = true)
        Skeleton(height = SKELETON_ROW_HEIGHT, rounded = true)
    }
}

@Composable
private fun TabSignalsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth().heightIn(min = SECTION_MIN_HEIGHT),
    )
}

@Composable
private fun TabSignalsFreshness(
    state: UiState<TabSignals>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            errorLabel = stringResource(R.string.translation_common_offline),
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

// ── Section 3: Notification sounds (web useNotificationSoundPrefs + playNotificationSound) ───────────────

@Composable
private fun NotificationSoundsSection(
    prefs: NotificationSoundPrefs,
    showAutoplayHint: Boolean,
    onMaster: (Boolean) -> Unit,
    onCategory: (NotificationSoundCategory, Boolean) -> Unit,
    onVolumePercent: (Int) -> Unit,
    onTest: (NotificationSoundCategory) -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(ROW_GAP)) {
        SectionHeader(
            glyph = NotificationSettingsGlyphs.Volume2,
            title = stringResource(R.string.translation_notificationSounds_title),
            subtitle = stringResource(R.string.translation_notificationSounds_subtitle),
        )
        Toggle(
            checked = prefs.master,
            onCheckedChange = onMaster,
            label = stringResource(R.string.translation_notificationSounds_master),
        )
        if (showAutoplayHint) {
            HelperText(stringResource(R.string.translation_notificationSounds_autoplayHint))
        }
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Caption(stringResource(R.string.translation_notificationSounds_categoriesHeading))
            NotificationSoundCategory.entries.forEach { category ->
                SoundChannelRow(
                    category = category,
                    enabled = prefs.isCategoryEnabled(category),
                    masterOn = prefs.master,
                    onToggle = { checked -> onCategory(category, checked) },
                    onTest = { onTest(category) },
                )
            }
        }
        Slider(
            value = prefs.volumePercent.toFloat(),
            onValueChange = { onVolumePercent(it.roundToInt()) },
            label = stringResource(R.string.translation_notificationSounds_volume),
            valueText = "${prefs.volumePercent}%",
            valueRange = 0f..VOLUME_MAX,
            steps = VOLUME_STEPS,
            enabled = prefs.master,
        )
    }
}

/** One channel row — its label toggle beside a Test button, dimmed (not disabled) when master is off. */
@Composable
private fun SoundChannelRow(
    category: NotificationSoundCategory,
    enabled: Boolean,
    masterOn: Boolean,
    onToggle: (Boolean) -> Unit,
    onTest: () -> Unit,
) {
    val label = categoryLabel(category)
    val testLabel = stringResource(R.string.translation_notificationSounds_test)
    val testDescription = stringResource(R.string.translation_notificationSounds_testAria, label)
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .alpha(if (masterOn) 1f else DISABLED_ROW_ALPHA)
                .clip(RoundedCornerShape(ROW_CORNER))
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = ROW_BG_ALPHA))
                .padding(horizontal = Spacing.md, vertical = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Toggle(checked = enabled, onCheckedChange = onToggle, label = label, modifier = Modifier.weight(1f))
        Button(
            label = testLabel,
            onClick = onTest,
            modifier = Modifier.semantics { contentDescription = testDescription },
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            leadingIcon = NotificationSettingsGlyphs.Play,
        )
    }
}

// ── Shared section chrome ───────────────────────────────────────────────────────────────────────────────

/** A section header: a cyan-toned IconBox glyph beside the title + subtitle (web IconBox + h2/h3). */
@Composable
private fun SectionHeader(
    glyph: ImageVector,
    title: String,
    subtitle: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(ROW_GAP),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconBox(tone = IconBoxTone.Info, size = IconBoxSize.Md) {
            Icon(glyph, contentDescription = null, size = IconSize.Lg)
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PanelTitle(title, modifier = Modifier.semantics { heading() })
            Caption(subtitle)
        }
    }
}

@Composable
private fun SectionDivider() {
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = DIVIDER_ALPHA))
}

/** Resolves a channel's localized label (web `notificationSounds.category.<wire>`). */
@Composable
private fun categoryLabel(category: NotificationSoundCategory): String =
    stringResource(
        when (category) {
            NotificationSoundCategory.CriticalAlert -> R.string.translation_notificationSounds_category_critical_alert
            NotificationSoundCategory.WarningAlert -> R.string.translation_notificationSounds_category_warning_alert
            NotificationSoundCategory.InfoAlert -> R.string.translation_notificationSounds_category_info_alert
            NotificationSoundCategory.ChargeComplete -> R.string.translation_notificationSounds_category_charge_complete
            NotificationSoundCategory.DriveComplete -> R.string.translation_notificationSounds_category_drive_complete
            NotificationSoundCategory.AutomationRun -> R.string.translation_notificationSounds_category_automation_run
            NotificationSoundCategory.Achievement -> R.string.translation_notificationSounds_category_achievement
        },
    )

// ── Permission helpers (web useWebPush — Activity-coupled, outside the stateless content) ───────────────

/**
 * Maps the device's OS notification state to the web [BrowserNotifPermission]: enabled → granted; otherwise
 * on API 33+ not-yet-asked → default (the Enable button can prompt), and asked-and-denied or any pre-33
 * disabled → denied.
 */
internal fun browserNotifPermissionFor(
    context: Context,
    asked: Boolean,
): BrowserNotifPermission =
    when {
        areNotificationsEnabled(context) -> BrowserNotifPermission.Granted
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !asked -> BrowserNotifPermission.Default
        else -> BrowserNotifPermission.Denied
    }

private fun areNotificationsEnabled(context: Context): Boolean =
    androidx.core.app.NotificationManagerCompat
        .from(context)
        .areNotificationsEnabled()

/**
 * Requests the notification permission (web `requestPermission`): on API 33+ launches the
 * `POST_NOTIFICATIONS` runtime prompt via [launchRuntimePrompt]; below 33 (no runtime permission) opens the
 * app's system notification settings so the user can re-enable.
 */
private fun requestNotificationPermission(
    context: Context,
    launchRuntimePrompt: () -> Unit,
) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        launchRuntimePrompt()
    } else {
        openAppNotificationSettings(context)
    }
}

private fun openAppNotificationSettings(context: Context) {
    val intent =
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    // runCatching (not a generic catch clause) so a missing settings activity never crashes the surface.
    runCatching { context.startActivity(intent) }
}

// ── Previews — one per rendered state ───────────────────────────────────────────────────────────────────

private const val PREVIEW_NOW = 1_780_000_000_000L
private val PREVIEW_SOUNDS = NotificationSoundPrefs.DEFAULT.copy(master = true)

@Preview(name = "NotificationSettings · granted", showBackground = true)
@Composable
private fun NotificationSettingsGrantedPreview() {
    TeslaSyncTheme {
        NotificationSettingsContent(
            tabSignals = UiState(phase = UiPhase.Content, data = TabSignals.DEFAULT, fetchedAt = PREVIEW_NOW),
            soundPrefs = PREVIEW_SOUNDS,
            webPushPrefs = WebPushPrefs.DEFAULT,
            permission = BrowserNotifPermission.Granted,
            notificationsSupported = true,
            showAutoplayHint = true,
        )
    }
}

@Preview(name = "NotificationSettings · request permission", showBackground = true)
@Composable
private fun NotificationSettingsDefaultPreview() {
    TeslaSyncTheme {
        NotificationSettingsContent(
            tabSignals = UiState(phase = UiPhase.Content, data = TabSignals.DEFAULT, fetchedAt = PREVIEW_NOW),
            soundPrefs = NotificationSoundPrefs.DEFAULT,
            webPushPrefs = WebPushPrefs.DEFAULT,
            permission = BrowserNotifPermission.Default,
            notificationsSupported = true,
            showAutoplayHint = false,
        )
    }
}

@Preview(name = "NotificationSettings · blocked", showBackground = true)
@Composable
private fun NotificationSettingsBlockedPreview() {
    TeslaSyncTheme {
        NotificationSettingsContent(
            tabSignals =
                UiState(
                    phase = UiPhase.Content,
                    data = TabSignals(badgeEnabled = true, criticalFlashEnabled = false),
                    fetchedAt = PREVIEW_NOW,
                ),
            soundPrefs = NotificationSoundPrefs.DEFAULT,
            webPushPrefs = WebPushPrefs.DEFAULT,
            permission = BrowserNotifPermission.Denied,
            notificationsSupported = true,
            showAutoplayHint = false,
        )
    }
}

@Preview(name = "NotificationSettings · unsupported", showBackground = true)
@Composable
private fun NotificationSettingsUnsupportedPreview() {
    TeslaSyncTheme {
        NotificationSettingsContent(
            tabSignals = UiState(phase = UiPhase.Content, data = TabSignals.DEFAULT, fetchedAt = PREVIEW_NOW),
            soundPrefs = NotificationSoundPrefs.DEFAULT,
            webPushPrefs = WebPushPrefs.DEFAULT,
            permission = BrowserNotifPermission.Default,
            notificationsSupported = false,
            showAutoplayHint = false,
        )
    }
}

@Preview(name = "NotificationSettings · tab loading", showBackground = true)
@Composable
private fun NotificationSettingsLoadingPreview() {
    TeslaSyncTheme {
        NotificationSettingsContent(
            tabSignals = UiState.loading(),
            soundPrefs = PREVIEW_SOUNDS,
            webPushPrefs = WebPushPrefs.DEFAULT,
            permission = BrowserNotifPermission.Granted,
            notificationsSupported = true,
            showAutoplayHint = true,
        )
    }
}

@Preview(name = "NotificationSettings · tab error", showBackground = true)
@Composable
private fun NotificationSettingsErrorPreview() {
    TeslaSyncTheme {
        NotificationSettingsContent(
            tabSignals = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Unknown),
            soundPrefs = NotificationSoundPrefs.DEFAULT,
            webPushPrefs = WebPushPrefs.DEFAULT,
            permission = BrowserNotifPermission.Granted,
            notificationsSupported = true,
            showAutoplayHint = false,
        )
    }
}

@Preview(name = "NotificationSettings · tab offline", showBackground = true)
@Composable
private fun NotificationSettingsOfflinePreview() {
    TeslaSyncTheme {
        NotificationSettingsContent(
            tabSignals =
                UiState(
                    phase = UiPhase.Content,
                    data = TabSignals.DEFAULT,
                    fetchedAt = PREVIEW_NOW,
                    stale = true,
                    errorKind = ErrorKind.Timeout,
                ),
            soundPrefs = PREVIEW_SOUNDS,
            webPushPrefs = WebPushPrefs(alerts = true, exportStatus = false),
            permission = BrowserNotifPermission.Granted,
            notificationsSupported = true,
            showAutoplayHint = true,
        )
    }
}
