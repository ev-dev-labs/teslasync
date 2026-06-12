// The native Jetpack Compose + Material 3 BrowserPushChannelCard feature view — a parity port of
// web/src/features/notifications/components/BrowserPushChannelCard.tsx. The web component renders inside the
// notification "Channels" tab: a GlassPanel with an always-visible header (a cyan BellRing badge + the
// "Browser push" title + subtitle, with a status chip on the right), then either an "unavailable" notice
// (one of four disabled reasons) or an Enable/Disable action plus the iOS note, then the per-device
// "Registered devices" list (user agent + relative "last used" + a this-device marker + a remove control).
//
// This port keeps that composition end to end and performs NO HTTP. Browser web-push maps to the native FCM
// device-push pipeline (P3/A6), so the host binds the shared push state-holder layer (P1/S8): the this-device
// capability + subscription arrive as a [BrowserPushChannelStatus] (projected from `PushRegistrationState` plus
// the notification permission and server-configured flag), and the registered-devices list arrives as a
// cache-then-network [UiState] so this view renders every lifecycle state that layer can carry — loading,
// hard error with retry, empty, content, and stale/offline ("last known"). A web-parity overload taking the
// raw hook-shaped props is also provided for hosts that already hold the loaded values. Every user-facing
// string resolves through the i18n catalog (P1/S10); colors are design tokens, never raw hex.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/BrowserPushChannelCard — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path — exactly as the sibling feature views do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.browserpushchannelcard

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
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
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
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Inner spacing between the card's three sections — the web `space-y-4`. */
private val SECTION_GAP: Dp = Spacing.lg

/** Cyan title-badge wash + ring — the web `bg-cyan-300/10 ring-cyan-300/30`. */
private const val ICON_BOX_WASH_ALPHA: Float = 0.12f
private const val ICON_BOX_BORDER_ALPHA: Float = 0.30f

/** Amber "unavailable" notice wash + ring — the web `bg-amber-300/5 ring-amber-300/20`. */
private const val NOTICE_WASH_ALPHA: Float = 0.08f
private const val NOTICE_BORDER_ALPHA: Float = 0.24f

/** Subtle per-device row wash + hairline — the web `bg-white/[0.02] ring-white/5`. */
private const val ROW_WASH_ALPHA: Float = 0.40f
private const val ROW_BORDER_ALPHA: Float = 0.50f

/** Loading skeleton rows for the device list. */
private const val DEVICE_SKELETON_ROWS: Int = 2

/** Skeleton row height (matches a device row). */
private val DEVICE_SKELETON_HEIGHT: Dp = 48.dp

/** Top nudge for a leading glyph beside multi-line text — the web `mt-0.5`. */
private val GLYPH_TOP_NUDGE: Dp = 2.dp

private val BORDER_WIDTH: Dp = 1.dp

/**
 * Stateful entry point for the browser-push channel card. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders the always-visible header plus every lifecycle [devices] state. The host owns
 * the push state holder (P1/S8) and supplies the projected [status], the registered-devices feed, the
 * enable/disable/remove callbacks and [onRetry] (the feed's refetch). This view never performs HTTP.
 *
 * @param status the this-device capability + subscription (web `useWebPush` + `usePushPublicKey`).
 * @param devices the cache-then-network projection of the registered-devices list (web `usePushSubscriptions`).
 * @param onEnable enables push on this device (web `subscribe`).
 * @param onDisable disables push on this device (web `unsubscribe`).
 * @param onRemoveDevice removes a registered device by endpoint (web `useUnsubscribePush`).
 * @param onRetry re-runs the host's device-list load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun BrowserPushChannelCard(
    status: BrowserPushChannelStatus,
    devices: UiState<List<PushSubscriptionRow>>,
    onEnable: () -> Unit,
    onDisable: () -> Unit,
    onRemoveDevice: (String) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) {
        recordBrowserPushChannelCardOpened(logger)
    }
    BrowserPushChannelCardContent(
        status = status,
        devices = devices,
        onEnable = onEnable,
        onDisable = onDisable,
        onRemoveDevice = onRemoveDevice,
        onRetry = onRetry,
        modifier = modifier,
    )
}

/**
 * Web-parity overload mirroring the web component's hook outputs (`useWebPush` + `usePushPublicKey` +
 * `usePushSubscriptions`) for hosts that already hold the loaded values. Maps them onto a
 * [BrowserPushChannelStatus] and a [UiState] — an empty [subscriptions] shows the empty state (web hides the
 * list; native always shows a friendly empty surface). Records `view.opened` like the stateful entry; there is
 * no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun BrowserPushChannelCard(
    notifSupported: Boolean,
    isPushApiSupported: Boolean,
    serverConfigured: Boolean?,
    keyLoading: Boolean,
    permission: BrowserPushPermission,
    isSubscribed: Boolean,
    currentEndpoint: String?,
    subscriptions: List<PushSubscriptionRow>,
    onEnable: () -> Unit,
    onDisable: () -> Unit,
    onRemoveDevice: (String) -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val status =
        remember(
            notifSupported,
            isPushApiSupported,
            serverConfigured,
            keyLoading,
            permission,
            isSubscribed,
            currentEndpoint,
        ) {
            BrowserPushChannelStatus(
                notifSupported = notifSupported,
                pushApiSupported = isPushApiSupported,
                serverConfigured = serverConfigured,
                keyLoading = keyLoading,
                permission = permission,
                isSubscribed = isSubscribed,
                currentEndpoint = currentEndpoint,
            )
        }
    val devices =
        remember(subscriptions) {
            UiState(
                phase = if (subscriptions.isEmpty()) UiPhase.Empty else UiPhase.Content,
                data = subscriptions,
            )
        }
    BrowserPushChannelCard(
        status = status,
        devices = devices,
        onEnable = onEnable,
        onDisable = onDisable,
        onRemoveDevice = onRemoveDevice,
        onRetry = {},
        modifier = modifier,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the preview/UI-test entry point. Reproduces the web component's
 * always-on header + status chip, its unsupported-vs-action branch, and the registered-devices list, and adds
 * the lifecycle chrome the host's device feed implies: a freshness chip (refreshing/stale/offline), a loading
 * skeleton, a hard-error retry surface, and a friendly empty state. Stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. [nowMillis] anchors the relative "last used" time.
 */
@Composable
fun BrowserPushChannelCardContent(
    status: BrowserPushChannelStatus,
    devices: UiState<List<PushSubscriptionRow>>,
    onEnable: () -> Unit,
    onDisable: () -> Unit,
    onRemoveDevice: (String) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    nowMillis: Long = System.currentTimeMillis(),
) {
    LaunchedEffect(devices.stale, devices.refreshing, devices.hasError) {
        if (devices.stale && !devices.refreshing && !devices.hasError) onRetry()
    }
    val formatAge = rememberBrowserPushFreshnessFormatter()
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(SECTION_GAP),
        ) {
            BrowserPushHeader(status = status)
            BrowserPushBody(status = status, onEnable = onEnable, onDisable = onDisable)
            BrowserPushDevicesSection(
                devices = devices,
                currentEndpoint = status.currentEndpoint,
                onRemoveDevice = onRemoveDevice,
                onRetry = onRetry,
                nowMillis = nowMillis,
                formatAge = formatAge,
            )
        }
    }
}

/** Always-visible header — the web BellRing badge + title/subtitle + status chip. */
@Composable
private fun BrowserPushHeader(status: BrowserPushChannelStatus) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Row(
            modifier = Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val shape = RoundedCornerShape(Radius.md)
            val accent = TeslaTokens.status.info
            Row(
                modifier =
                    Modifier
                        .clip(shape)
                        .background(accent.copy(alpha = ICON_BOX_WASH_ALPHA))
                        .border(BORDER_WIDTH, accent.copy(alpha = ICON_BOX_BORDER_ALPHA), shape)
                        .padding(Spacing.sm),
            ) {
                Icon(BrowserPushGlyphs.BellRing, contentDescription = null, size = IconSize.Md, tint = accent)
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Heading(stringResource(R.string.translation_webpush_title), level = HeadingLevel.Panel)
                HelperText(stringResource(R.string.translation_webpush_subtitle))
            }
        }
        BrowserPushStatusBadge(status)
    }
}

/** Status chip — web success "Active on this device" / neutral "Not subscribed" / warning "Unavailable". */
@Composable
private fun BrowserPushStatusBadge(status: BrowserPushChannelStatus) {
    when (BrowserPushChannelCardProjection.badge(status)) {
        BrowserPushBadge.Subscribed ->
            Badge(stringResource(R.string.translation_webpush_status_subscribed), variant = BadgeVariant.Success)
        BrowserPushBadge.NotSubscribed ->
            Badge(stringResource(R.string.translation_webpush_status_notSubscribed), variant = BadgeVariant.Neutral)
        BrowserPushBadge.Unsupported ->
            Badge(stringResource(R.string.translation_webpush_status_unsupported), variant = BadgeVariant.Warning)
    }
}

/** The unsupported notice OR the enable/disable action + iOS note — the web branch on `isUnsupported`. */
@Composable
private fun BrowserPushBody(
    status: BrowserPushChannelStatus,
    onEnable: () -> Unit,
    onDisable: () -> Unit,
) {
    val reason = BrowserPushChannelCardProjection.disabledReason(status)
    if (reason != null) {
        BrowserPushUnsupportedNotice(reason)
    } else {
        BrowserPushActionRow(
            action = BrowserPushChannelCardProjection.action(status) ?: BrowserPushAction.Enable,
            onEnable = onEnable,
            onDisable = onDisable,
        )
    }
}

/** Amber "why it's unavailable" notice — the web AlertCircle + reason text. Never a blank box. */
@Composable
private fun BrowserPushUnsupportedNotice(reason: BrowserPushDisabledReason) {
    val shape = RoundedCornerShape(Radius.md)
    val accent = TeslaTokens.status.warning
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(shape)
                .background(accent.copy(alpha = NOTICE_WASH_ALPHA))
                .border(BORDER_WIDTH, accent.copy(alpha = NOTICE_BORDER_ALPHA), shape)
                .padding(Spacing.md),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            BrowserPushGlyphs.AlertCircle,
            contentDescription = null,
            size = IconSize.Sm,
            tint = accent,
            modifier = Modifier.padding(top = GLYPH_TOP_NUDGE),
        )
        BodyText(reasonText(reason), modifier = Modifier.weight(1f))
    }
}

/** Enable (primary, BellRing) or Disable (secondary, BellOff), with the iOS note beneath — the web action row. */
@Composable
private fun BrowserPushActionRow(
    action: BrowserPushAction,
    onEnable: () -> Unit,
    onDisable: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        when (action) {
            BrowserPushAction.Disable ->
                Button(
                    label = stringResource(R.string.translation_webpush_disable),
                    onClick = onDisable,
                    variant = ButtonVariant.Secondary,
                    size = ButtonSize.Sm,
                    leadingIcon = BrowserPushGlyphs.BellOff,
                )
            BrowserPushAction.Enable ->
                Button(
                    label = stringResource(R.string.translation_webpush_enable),
                    onClick = onEnable,
                    variant = ButtonVariant.Primary,
                    size = ButtonSize.Sm,
                    leadingIcon = BrowserPushGlyphs.BellRing,
                )
        }
        HelperText(stringResource(R.string.translation_webpush_iosNote))
    }
}

/**
 * The "Registered devices" section — always rendered with lifecycle chrome (loading skeleton, hard-error retry,
 * friendly empty state, or the device rows) plus a freshness chip when refreshing/stale/offline.
 */
@Composable
private fun BrowserPushDevicesSection(
    devices: UiState<List<PushSubscriptionRow>>,
    currentEndpoint: String?,
    onRemoveDevice: (String) -> Unit,
    onRetry: () -> Unit,
    nowMillis: Long,
    formatAge: (FreshnessAge) -> String,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Caption(stringResource(R.string.translation_webpush_devices_title), modifier = Modifier.weight(1f))
            if (devices.stale || devices.refreshing || devices.hasError) {
                DataFreshness(
                    updatedAtMillis = devices.fetchedAt?.takeIf { it > 0 },
                    isFetching = devices.refreshing,
                    isStale = devices.stale,
                    isError = devices.hasError,
                    fetchingLabel = stringResource(R.string.translation_common_loading),
                    errorLabel = stringResource(R.string.translation_common_offline),
                    formatAge = formatAge,
                )
            }
        }
        when (browserPushDevicesSurfaceFor(devices.isLoading, devices.isError)) {
            BrowserPushDevicesSurface.Loading -> DevicesLoading()
            BrowserPushDevicesSurface.Error -> DevicesError(onRetry)
            BrowserPushDevicesSurface.Ready -> {
                val rows =
                    remember(devices.data, currentEndpoint, nowMillis) {
                        BrowserPushChannelCardProjection.projectDevices(
                            rows = devices.data ?: emptyList(),
                            currentEndpoint = currentEndpoint,
                            ageOf = { iso -> BrowserPushTimeFormatting.relativeAge(iso, nowMillis) },
                        )
                    }
                if (rows.isEmpty()) {
                    DevicesEmpty()
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                        rows.forEach { row -> DeviceRow(row = row, onRemoveDevice = onRemoveDevice, formatAge = formatAge) }
                    }
                }
            }
        }
    }
}

/** First-load skeleton so the section is never blank (web hides the list; native shows loading chrome). */
@Composable
private fun DevicesLoading() {
    val label = stringResource(R.string.translation_common_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(DEVICE_SKELETON_ROWS) {
            Skeleton(height = DEVICE_SKELETON_HEIGHT, rounded = true)
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun DevicesError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Friendly empty state — never a blank box (the web list is simply hidden when empty). */
@Composable
private fun DevicesEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_common_noData),
        icon = BrowserPushGlyphs.Smartphone,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** One registered-device row — Smartphone glyph + user agent (+ this-device marker) + last-used + remove. */
@Composable
private fun DeviceRow(
    row: BrowserPushDeviceRow,
    onRemoveDevice: (String) -> Unit,
    formatAge: (FreshnessAge) -> String,
) {
    val shape = RoundedCornerShape(Radius.md)
    val label = row.userAgent ?: stringResource(R.string.translation_webpush_devices_unknownAgent)
    val lastUsed =
        row.lastUsedAge?.let { age ->
            stringResource(R.string.translation_webpush_devices_lastUsed, formatAge(age))
        } ?: stringResource(R.string.translation_webpush_devices_neverUsed)
    val removeLabel = stringResource(R.string.translation_webpush_devices_remove)
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(shape)
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = ROW_WASH_ALPHA))
                .border(BORDER_WIDTH, MaterialTheme.colorScheme.outlineVariant.copy(alpha = ROW_BORDER_ALPHA), shape)
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            BrowserPushGlyphs.Smartphone,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = GLYPH_TOP_NUDGE),
        )
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            DeviceTitleLine(label = label, isThisDevice = row.isThisDevice)
            Caption(lastUsed)
        }
        Button(
            onClick = { onRemoveDevice(row.endpoint) },
            modifier = Modifier.semantics { contentDescription = removeLabel },
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        ) {
            Icon(BrowserPushGlyphs.Trash2, contentDescription = null, size = IconSize.Sm)
        }
    }
}

/** Device name line — the user agent (truncated) with an inline cyan "(this device)" marker. */
@Composable
private fun DeviceTitleLine(
    label: String,
    isThisDevice: Boolean,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false),
        )
        if (isThisDevice) {
            Text(
                text = stringResource(R.string.translation_webpush_devices_thisDevice),
                style = MaterialTheme.typography.labelSmall,
                color = TeslaTokens.status.info,
                maxLines = 1,
            )
        }
    }
}

/** Maps a [BrowserPushDisabledReason] to its localized message (P1/S10). */
@Composable
private fun reasonText(reason: BrowserPushDisabledReason): String =
    when (reason) {
        BrowserPushDisabledReason.NotificationUnsupported ->
            stringResource(R.string.translation_webpush_unsupported_notification)
        BrowserPushDisabledReason.ServerDisabled ->
            stringResource(R.string.translation_webpush_unsupported_serverDisabled)
        BrowserPushDisabledReason.PushApiUnsupported ->
            stringResource(R.string.translation_webpush_unsupported_pushApi)
        BrowserPushDisabledReason.PermissionDenied ->
            stringResource(R.string.translation_webpush_unsupported_permissionDenied)
    }

/**
 * Localized relative-age formatter for the device "last used" line and the freshness chip
 * (`translation_freshness_*`) — the render-only concern kept out of the pure projection.
 */
@Composable
private fun rememberBrowserPushFreshnessFormatter(): (FreshnessAge) -> String {
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

/**
 * Line-style glyphs the card needs, authored as 24×24 stroked vectors. The web library uses `lucide-react`;
 * Android has no bundled equivalent without the frozen `material-icons-extended` artifact, so they are drawn
 * here (mirroring `components/ui/TeslaGlyphs`) and recolored at render time by the `Icon` composable's tint.
 */
object BrowserPushGlyphs {
    /** A bell with two "ring" ticks — the web lucide `BellRing`. */
    val BellRing: ImageVector =
        stroked("BellRing") {
            moveTo(7f, 17f)
            lineTo(17f, 17f)
            moveTo(7f, 17f)
            curveTo(7f, 17f, 6f, 9.5f, 9f, 7.5f)
            curveTo(10.5f, 6.5f, 13.5f, 6.5f, 15f, 7.5f)
            curveTo(18f, 9.5f, 17f, 17f, 17f, 17f)
            moveTo(10.5f, 17f)
            curveTo(10.5f, 19f, 13.5f, 19f, 13.5f, 17f)
            moveTo(12f, 6.5f)
            lineTo(12f, 5f)
            moveTo(18.5f, 6f)
            lineTo(20f, 4.5f)
            moveTo(5.5f, 6f)
            lineTo(4f, 4.5f)
        }

    /** A bell struck through — the web lucide `BellOff`. */
    val BellOff: ImageVector =
        stroked("BellOff") {
            moveTo(7f, 17f)
            lineTo(17f, 17f)
            moveTo(7f, 17f)
            curveTo(7f, 17f, 6f, 9.5f, 9f, 7.5f)
            curveTo(10.5f, 6.5f, 13.5f, 6.5f, 15f, 7.5f)
            curveTo(18f, 9.5f, 17f, 17f, 17f, 17f)
            moveTo(10.5f, 17f)
            curveTo(10.5f, 19f, 13.5f, 19f, 13.5f, 17f)
            moveTo(12f, 6.5f)
            lineTo(12f, 5f)
            moveTo(4f, 4f)
            lineTo(20f, 20f)
        }

    /** A phone outline with a home dot — the web lucide `Smartphone`. */
    val Smartphone: ImageVector =
        stroked("Smartphone") {
            rect(7f, 3f, 17f, 21f)
            dot(12f, 18f)
        }

    /** A trash can with lid + handle + two inner lines — the web lucide `Trash2`. */
    val Trash2: ImageVector =
        stroked("Trash2") {
            moveTo(4f, 6f)
            lineTo(20f, 6f)
            moveTo(9f, 6f)
            lineTo(9f, 4f)
            lineTo(15f, 4f)
            lineTo(15f, 6f)
            moveTo(6f, 6f)
            lineTo(7f, 20f)
            lineTo(17f, 20f)
            lineTo(18f, 6f)
            moveTo(10f, 10f)
            lineTo(10f, 17f)
            moveTo(14f, 10f)
            lineTo(14f, 17f)
        }

    /** A circle enclosing an exclamation mark — the web lucide `AlertCircle`. */
    val AlertCircle: ImageVector =
        stroked("AlertCircle") {
            moveTo(12f, 3f)
            curveTo(16.97f, 3f, 21f, 7.03f, 21f, 12f)
            curveTo(21f, 16.97f, 16.97f, 21f, 12f, 21f)
            curveTo(7.03f, 21f, 3f, 16.97f, 3f, 12f)
            curveTo(3f, 7.03f, 7.03f, 3f, 12f, 3f)
            moveTo(12f, 8f)
            lineTo(12f, 13f)
            dot(12f, 16f)
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

    /** A round-capped near-zero-length segment renders as a filled dot at ([x], [y]). */
    private fun PathBuilder.dot(
        x: Float,
        y: Float,
    ) {
        moveTo(x, y)
        lineTo(x + 0.1f, y)
    }

    /** Axis-aligned closed rectangle from ([left], [top]) to ([right], [bottom]). */
    private fun PathBuilder.rect(
        left: Float,
        top: Float,
        right: Float,
        bottom: Float,
    ) {
        moveTo(left, top)
        lineTo(right, top)
        lineTo(right, bottom)
        lineTo(left, bottom)
        lineTo(left, top)
    }
}

// ── Previews ──────────────────────────────────────────────────────────────────────────────────────────────

private const val PREVIEW_NOW_MILLIS: Long = 1_700_000_600_000L
private const val PREVIEW_STALE_MILLIS: Long = 1_699_900_000_000L

private fun previewSubscriptions(): List<PushSubscriptionRow> =
    listOf(
        PushSubscriptionRow(
            id = 1,
            endpoint = "reg-this-device",
            userAgent = "Pixel 8 \u00B7 Android 14",
            lastUsedAt = "2023-11-14T22:20:00Z",
        ),
        PushSubscriptionRow(
            id = 2,
            endpoint = "reg-laptop",
            userAgent = "Chrome \u00B7 macOS",
            lastUsedAt = null,
        ),
    )

private fun previewStatus(
    isSubscribed: Boolean = true,
    notifSupported: Boolean = true,
    pushApiSupported: Boolean = true,
    serverConfigured: Boolean? = true,
    permission: BrowserPushPermission = BrowserPushPermission.Granted,
): BrowserPushChannelStatus =
    BrowserPushChannelStatus(
        notifSupported = notifSupported,
        pushApiSupported = pushApiSupported,
        serverConfigured = serverConfigured,
        keyLoading = false,
        permission = permission,
        isSubscribed = isSubscribed,
        currentEndpoint = if (isSubscribed) "reg-this-device" else null,
    )

@Preview(name = "Subscribed + devices", showBackground = true)
@Composable
private fun BrowserPushChannelCardSubscribedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BrowserPushChannelCardContent(
            status = previewStatus(isSubscribed = true),
            devices = UiState(phase = UiPhase.Content, data = previewSubscriptions(), fetchedAt = PREVIEW_NOW_MILLIS),
            onEnable = {},
            onDisable = {},
            onRemoveDevice = {},
            onRetry = {},
            nowMillis = PREVIEW_NOW_MILLIS,
        )
    }
}

@Preview(name = "Not subscribed", showBackground = true)
@Composable
private fun BrowserPushChannelCardNotSubscribedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BrowserPushChannelCardContent(
            status = previewStatus(isSubscribed = false),
            devices = UiState(phase = UiPhase.Empty, data = emptyList(), fetchedAt = PREVIEW_NOW_MILLIS),
            onEnable = {},
            onDisable = {},
            onRemoveDevice = {},
            onRetry = {},
            nowMillis = PREVIEW_NOW_MILLIS,
        )
    }
}

@Preview(name = "Unavailable (server not configured)", showBackground = true)
@Composable
private fun BrowserPushChannelCardUnsupportedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BrowserPushChannelCardContent(
            status = previewStatus(isSubscribed = false, pushApiSupported = false, serverConfigured = false),
            devices = UiState(phase = UiPhase.Empty, data = emptyList(), fetchedAt = PREVIEW_NOW_MILLIS),
            onEnable = {},
            onDisable = {},
            onRemoveDevice = {},
            onRetry = {},
            nowMillis = PREVIEW_NOW_MILLIS,
        )
    }
}

@Preview(name = "Devices loading", showBackground = true)
@Composable
private fun BrowserPushChannelCardLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BrowserPushChannelCardContent(
            status = previewStatus(isSubscribed = true),
            devices = UiState.loading(),
            onEnable = {},
            onDisable = {},
            onRemoveDevice = {},
            onRetry = {},
            nowMillis = PREVIEW_NOW_MILLIS,
        )
    }
}

@Preview(name = "Devices error", showBackground = true)
@Composable
private fun BrowserPushChannelCardErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BrowserPushChannelCardContent(
            status = previewStatus(isSubscribed = true),
            devices = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onEnable = {},
            onDisable = {},
            onRemoveDevice = {},
            onRetry = {},
            nowMillis = PREVIEW_NOW_MILLIS,
        )
    }
}

@Preview(name = "Devices offline (last known)", showBackground = true)
@Composable
private fun BrowserPushChannelCardOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BrowserPushChannelCardContent(
            status = previewStatus(isSubscribed = true),
            devices =
                UiState(
                    phase = UiPhase.Content,
                    data = previewSubscriptions(),
                    fetchedAt = PREVIEW_STALE_MILLIS,
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            onEnable = {},
            onDisable = {},
            onRemoveDevice = {},
            onRetry = {},
            nowMillis = PREVIEW_NOW_MILLIS,
        )
    }
}
