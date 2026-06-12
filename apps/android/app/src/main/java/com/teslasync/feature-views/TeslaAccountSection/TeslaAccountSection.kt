// The native Jetpack Compose + Material 3 Tesla Account feature view — a parity port of
// web/src/features/settings/components/TeslaAccountSection.tsx. It reproduces that surface end to end: the
// Shield header (icon chip + title + subtitle), the bordered connection-status row (Connected — with the
// optional "Expires in Nd" soft-warning pill and the "Token expires …" line — vs Disconnected/Not
// connected), the wrapping action row (Connect, or the Refresh Token / Sync Vehicles / Re-authorize /
// Disconnect manage set), the inline "Synced N vehicle(s)." success line, and the destructive-disconnect
// ConfirmDialog. Beyond the web (which renders unconditionally) the native surface honours the P3 states
// contract: a loading skeleton (no cache), a hard-error retry surface (no cache), and the stale/offline
// "last known" view with a freshness chip + auto-refresh — so the panel is never a blank box. A resolved
// status always renders the chrome + the Connected/Not-connected content (web parity: there is no empty
// branch — "no connection" IS the friendly Not-connected content), so the view-model's emptiness predicate
// folds Empty into Content.
//
// The view performs NO HTTP: it binds the [TeslaAccountSectionViewModel] (P1/S8) and renders. Toasts (web
// `useToast`) are surfaced through the shared [ToastHost] from the view-model's typed [TeslaAccountToast]
// stream, localized at this boundary (P1/S10). The OAuth "Connect"/"Re-authorize" open (web
// `window.location.href = auth_url`) is hoisted via [onOpenUrl] (default: the Compose `LocalUriHandler`, a
// Custom Tab / browser) so the view performs no side effect itself and stays unit/UI-testable. Every string
// resolves through the i18n catalog (the `tesla_*`, `toast_*`, `common_*`, `error_*` keys); no English
// literal lives in render code, and every interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed: the mandated surface
// directory (com/teslasync/feature-views/TeslaAccountSection) cannot form a valid Kotlin package and the
// file hosts several co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.featureviews.teslaaccountsection

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.ToastHost
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.presentation.settings.AuthStatus
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

private const val MAX_TOASTS = 3
private const val TOAST_DURATION_MS = 4_000L
private const val FADE_DELAY_MS = 50
private const val STATUS_WASH_ALPHA = 0.14f
private const val PILL_WASH_ALPHA = 0.12f
private const val PILL_RING_ALPHA = 0.30f
private val STATUS_BADGE_SIZE = 32.dp
private val CONTROL_SKELETON_HEIGHT = 52.dp
private val STATUS_SKELETON_HEIGHT = 64.dp

/** Which phase the destructive-disconnect [ConfirmDialog] is in (hidden / asking / running the mutation). */
private enum class DisconnectConfirmPhase { Hidden, Asking, Running }

/**
 * Stateful entry point for the Tesla Account surface. Binds the [viewModel] (P1/S8), records the one-shot
 * PII-safe `view.opened` diagnostic, owns the toast queue + the disconnect confirm dialog, opens OAuth URLs
 * through [onOpenUrl] (default: the Compose `LocalUriHandler`), and renders every lifecycle state the
 * auth-status feed can carry. The host constructs the view-model via [TeslaAccountSectionViewModel.create];
 * this view never performs HTTP.
 *
 * @param viewModel the state holder bound to the shared Tesla-auth feeds + mutations (P1/S8).
 * @param onOpenUrl opens a Tesla OAuth authorize URL (web `window.location.href`); defaults to the browser.
 */
@Composable
fun TeslaAccountSection(
    viewModel: TeslaAccountSectionViewModel,
    modifier: Modifier = Modifier,
    onOpenUrl: ((String) -> Unit)? = null,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val authStatus by viewModel.authStatus.collectAsStateWithLifecycle()
    val reauthNeeded by viewModel.reauthNeeded.collectAsStateWithLifecycle()
    val actions by viewModel.actions.collectAsStateWithLifecycle()
    val syncedCount by viewModel.syncedCount.collectAsStateWithLifecycle()

    val uriHandler = LocalUriHandler.current
    val openUrl = onOpenUrl ?: remember(uriHandler) { { url: String -> uriHandler.openUri(url) } }
    LaunchedEffect(viewModel, openUrl) { viewModel.openUrls.collect { openUrl(it) } }

    val toastQueue = remember { mutableStateListOf<ToastItem>() }
    TeslaAccountToastPresenter(viewModel, toastQueue)

    var confirmPhase by remember { mutableStateOf(DisconnectConfirmPhase.Hidden) }
    // Auto-dismiss the confirm dialog once an initiated disconnect settles; the toast reports the outcome.
    LaunchedEffect(actions.disconnecting) {
        if (confirmPhase == DisconnectConfirmPhase.Running && !actions.disconnecting) {
            confirmPhase = DisconnectConfirmPhase.Hidden
        }
    }

    Box(modifier = modifier.fillMaxWidth()) {
        TeslaAccountSectionContent(
            authStatus = authStatus,
            reauthNeeded = reauthNeeded,
            actions = actions,
            syncedCount = syncedCount,
            onConnect = viewModel::connect,
            onRefreshToken = viewModel::refreshToken,
            onSyncVehicles = viewModel::syncVehicles,
            onDisconnect = { confirmPhase = DisconnectConfirmPhase.Asking },
            onRetry = viewModel::retry,
        )
        ToastHost(
            toasts = toastQueue,
            onDismiss = { id -> toastQueue.removeAll { it.id == id } },
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }

    if (confirmPhase != DisconnectConfirmPhase.Hidden) {
        ConfirmDialog(
            title = stringResource(R.string.translation_tesla_disconnectTitle),
            message = stringResource(R.string.translation_tesla_disconnectConfirm),
            confirmLabel = stringResource(R.string.translation_tesla_disconnect),
            cancelLabel = stringResource(R.string.translation_common_cancel),
            onConfirm = {
                confirmPhase = DisconnectConfirmPhase.Running
                viewModel.disconnect()
            },
            onCancel = { confirmPhase = DisconnectConfirmPhase.Hidden },
            severity = ConfirmSeverity.Danger,
            loading = confirmPhase == DisconnectConfirmPhase.Running,
            closeLabel = stringResource(R.string.translation_common_close),
        )
    }
}

/**
 * Stateless renderer of the surface — the unit/UI-test + preview entry point. Always draws the GlassPanel
 * header (so the surface is never blank), then switches the body across the cache-then-network state
 * matrix: a loading skeleton (no cache), a hard-error retry surface (no cache), and the ready body
 * (connection status + actions + optional synced line, plus the stale/offline freshness chip). Stale,
 * non-error data auto-refreshes, mirroring the sibling surfaces' contract. [nowMs] is injected so the
 * "expires soon" derivation is deterministic in tests/previews.
 */
@Composable
fun TeslaAccountSectionContent(
    authStatus: UiState<AuthStatus>,
    reauthNeeded: Boolean,
    actions: TeslaAccountActions,
    syncedCount: Int?,
    onConnect: () -> Unit,
    onRefreshToken: () -> Unit,
    onSyncVehicles: () -> Unit,
    onDisconnect: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    nowMs: Long = System.currentTimeMillis(),
) {
    LaunchedEffect(authStatus.stale, authStatus.refreshing, authStatus.hasError) {
        if (authStatus.stale && !authStatus.refreshing && !authStatus.hasError) onRetry()
    }
    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                TeslaAccountHeader()
                TeslaAccountBody(
                    authStatus = authStatus,
                    reauthNeeded = reauthNeeded,
                    actions = actions,
                    syncedCount = syncedCount,
                    nowMs = nowMs,
                    onConnect = onConnect,
                    onRefreshToken = onRefreshToken,
                    onSyncVehicles = onSyncVehicles,
                    onDisconnect = onDisconnect,
                    onRetry = onRetry,
                )
            }
        }
    }
}

// ── Header ───────────────────────────────────────────────────────────────────────────────────────────────

/** The Shield icon chip + title + subtitle (web header row). Always rendered so the panel is never blank. */
@Composable
private fun TeslaAccountHeader() {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconBox(tone = IconBoxTone.Info) {
            Icon(DataDisplayGlyphs.Shield, contentDescription = null, size = IconSize.Lg)
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PanelTitle(
                stringResource(R.string.translation_tesla_title),
                modifier = Modifier.semantics { heading() },
            )
            Caption(stringResource(R.string.translation_tesla_subtitle))
        }
    }
}

// ── Body state switch ────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun TeslaAccountBody(
    authStatus: UiState<AuthStatus>,
    reauthNeeded: Boolean,
    actions: TeslaAccountActions,
    syncedCount: Int?,
    nowMs: Long,
    onConnect: () -> Unit,
    onRefreshToken: () -> Unit,
    onSyncVehicles: () -> Unit,
    onDisconnect: () -> Unit,
    onRetry: () -> Unit,
) {
    val data = authStatus.data
    when {
        data != null ->
            TeslaAccountReadyBody(
                auth = data,
                uiState = authStatus,
                reauthNeeded = reauthNeeded,
                actions = actions,
                syncedCount = syncedCount,
                nowMs = nowMs,
                onConnect = onConnect,
                onRefreshToken = onRefreshToken,
                onSyncVehicles = onSyncVehicles,
                onDisconnect = onDisconnect,
            )

        authStatus.isError -> TeslaAccountErrorBody(onRetry)
        else -> TeslaAccountLoadingBody()
    }
}

/** The populated body — freshness chip (when degraded), status row, action row, and the synced-line. */
@Composable
private fun TeslaAccountReadyBody(
    auth: AuthStatus,
    uiState: UiState<AuthStatus>,
    reauthNeeded: Boolean,
    actions: TeslaAccountActions,
    syncedCount: Int?,
    nowMs: Long,
    onConnect: () -> Unit,
    onRefreshToken: () -> Unit,
    onSyncVehicles: () -> Unit,
    onDisconnect: () -> Unit,
) {
    val view = remember(auth, reauthNeeded, nowMs) { TeslaAccountView.from(auth, reauthNeeded, nowMs) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        if (uiState.stale || uiState.refreshing || uiState.hasError) {
            TeslaAccountFreshness(uiState)
        }
        TeslaAccountStatusRow(view)
        TeslaAccountActionRow(
            view = view,
            actions = actions,
            onConnect = onConnect,
            onRefreshToken = onRefreshToken,
            onSyncVehicles = onSyncVehicles,
            onDisconnect = onDisconnect,
        )
        if (syncedCount != null) {
            BodyText(
                stringResource(R.string.translation_tesla_synced, syncedCount),
                color = TeslaTokens.status.success,
            )
        }
    }
}

// ── Status row ───────────────────────────────────────────────────────────────────────────────────────────

/** The bordered connection-status row (web `bg-white/[0.02] border rounded-lg p-3`). */
@Composable
private fun TeslaAccountStatusRow(view: TeslaAccountView) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.md))
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(Radius.md))
                .padding(Spacing.md),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (view.connected) {
            StatusBadge(glyph = DataDisplayGlyphs.CheckCircle, tone = TeslaTokens.status.success)
            ConnectedStatus(view)
        } else {
            StatusBadge(glyph = TeslaAccountGlyphs.XCircle, tone = TeslaTokens.status.danger)
            NotConnectedStatus(view)
        }
    }
}

/** The circular tinted status badge (web `h-8 w-8 rounded-full bg-{tone}/10`). */
@Composable
private fun StatusBadge(
    glyph: ImageVector,
    tone: Color,
) {
    Surface(
        modifier = Modifier.size(STATUS_BADGE_SIZE),
        shape = CircleShape,
        color = tone.copy(alpha = STATUS_WASH_ALPHA),
        contentColor = tone,
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(glyph, contentDescription = null, size = IconSize.Md, tint = tone)
        }
    }
}

/** The Connected status text + optional "Expires in Nd" pill + the "Token expires …" line. */
@Composable
private fun ConnectedStatus(view: TeslaAccountView) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BodyText(
                stringResource(R.string.translation_tesla_connected),
                color = TeslaTokens.status.success,
            )
            view.expiringSoonDays?.let { ExpiringSoonPill(it) }
        }
        view.expiresAtMillis?.let { expiresAt ->
            Caption(
                "${stringResource(R.string.translation_tesla_tokenExpires)} ${rememberFormattedDateTime(expiresAt)}",
            )
        }
    }
}

/** The Disconnected / Not-connected status text + (when expired) the reconnect copy. */
@Composable
private fun NotConnectedStatus(view: TeslaAccountView) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        BodyText(
            if (view.showDisconnectedPill) {
                stringResource(R.string.translation_tesla_disconnected)
            } else {
                stringResource(R.string.translation_tesla_notConnected)
            },
            color = TeslaTokens.status.danger,
        )
        if (view.showDisconnectedPill) {
            Caption(stringResource(R.string.translation_tesla_reauth_body))
        }
    }
}

/** The amber "Expires in Nd" soft-warning pill (web amber chip with the AlertTriangle glyph). */
@Composable
private fun ExpiringSoonPill(days: Int) {
    val accent = TeslaTokens.status.warning
    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = accent.copy(alpha = PILL_WASH_ALPHA),
        contentColor = accent,
        border = BorderStroke(1.dp, accent.copy(alpha = PILL_RING_ALPHA)),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(DataDisplayGlyphs.AlertTriangle, contentDescription = null, size = IconSize.Xs, tint = accent)
            Text(
                stringResource(R.string.translation_tesla_expiringSoon, days),
                style = MaterialTheme.typography.labelSmall,
                color = accent,
            )
        }
    }
}

// ── Action row ───────────────────────────────────────────────────────────────────────────────────────────

/** The wrapping action row — "Connect" alone, or the Refresh / Sync / Re-authorize / Disconnect manage set. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TeslaAccountActionRow(
    view: TeslaAccountView,
    actions: TeslaAccountActions,
    onConnect: () -> Unit,
    onRefreshToken: () -> Unit,
    onSyncVehicles: () -> Unit,
    onDisconnect: () -> Unit,
) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (view.showConnectAction) {
            Button(
                label = stringResource(R.string.translation_tesla_connect),
                onClick = onConnect,
                variant = ButtonVariant.Primary,
                leadingIcon = DataDisplayGlyphs.ExternalLink,
                loading = actions.connecting,
            )
        } else {
            Button(
                label = stringResource(R.string.translation_tesla_refreshToken),
                onClick = onRefreshToken,
                variant = ButtonVariant.Secondary,
                leadingIcon = FeedbackGlyphs.Refresh,
                loading = actions.refreshingToken,
            )
            Button(
                label = stringResource(R.string.translation_tesla_syncVehicles),
                onClick = onSyncVehicles,
                variant = ButtonVariant.Secondary,
                leadingIcon = TeslaAccountGlyphs.Car,
                loading = actions.syncing,
            )
            Button(
                label = stringResource(R.string.translation_tesla_reauthorize),
                onClick = onConnect,
                variant = ButtonVariant.Outline,
                leadingIcon = DataDisplayGlyphs.ExternalLink,
                enabled = !actions.connecting,
            )
            Button(
                label = stringResource(R.string.translation_tesla_disconnect),
                onClick = onDisconnect,
                variant = ButtonVariant.Danger,
                leadingIcon = TeslaAccountGlyphs.XCircle,
                enabled = !actions.disconnecting,
            )
        }
    }
}

// ── Loading / error / freshness ──────────────────────────────────────────────────────────────────────────

/** The first-load skeleton chrome — accessible "Loading" so the panel is never a silent blank box. */
@Composable
private fun TeslaAccountLoadingBody() {
    val loading = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = loading },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(height = STATUS_SKELETON_HEIGHT, rounded = true)
        Skeleton(widthFraction = 0.6f, height = CONTROL_SKELETON_HEIGHT, rounded = true)
    }
}

/** The hard-error surface (no cached fallback) — a localized message with a retry affordance. */
@Composable
private fun TeslaAccountErrorBody(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Right-aligned freshness chip shown above cached data that is refreshing / stale / offline. */
@Composable
private fun TeslaAccountFreshness(state: UiState<*>) {
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

// ── Toast presentation ───────────────────────────────────────────────────────────────────────────────────

/** Localized strings the toast presenter folds a [TeslaAccountToast] into a [ToastItem] with. */
private data class TeslaToastStrings(
    val tokenRefreshed: String,
    val tokenRefreshFailed: String,
    val disconnected: String,
    val disconnectFailed: String,
    val syncFailed: String,
) {
    fun toItem(
        toast: TeslaAccountToast,
        id: Long,
    ): ToastItem =
        when (toast) {
            TeslaAccountToast.TokenRefreshed -> ToastItem(id, tokenRefreshed, Tone.Success)
            TeslaAccountToast.TokenRefreshFailed -> ToastItem(id, tokenRefreshFailed, Tone.Danger)
            TeslaAccountToast.Disconnected -> ToastItem(id, disconnected, Tone.Success)
            TeslaAccountToast.DisconnectFailed -> ToastItem(id, disconnectFailed, Tone.Danger)
            TeslaAccountToast.SyncFailed -> ToastItem(id, syncFailed, Tone.Danger)
        }
}

@Composable
private fun rememberTeslaToastStrings(): TeslaToastStrings =
    TeslaToastStrings(
        tokenRefreshed = stringResource(R.string.translation_toast_tokenRefreshed),
        tokenRefreshFailed = stringResource(R.string.translation_toast_tokenRefreshFailed),
        disconnected = stringResource(R.string.translation_toast_disconnected),
        disconnectFailed = stringResource(R.string.translation_toast_disconnectFailed),
        syncFailed = stringResource(R.string.translation_toast_syncFailed),
    )

/** Collects the view-model's [TeslaAccountToast] stream into the bottom [ToastHost] queue, auto-dismissing each. */
@Composable
private fun TeslaAccountToastPresenter(
    viewModel: TeslaAccountSectionViewModel,
    queue: androidx.compose.runtime.snapshots.SnapshotStateList<ToastItem>,
) {
    val strings = rememberTeslaToastStrings()
    val scope = rememberCoroutineScope()
    var nextId by remember { mutableLongStateOf(0L) }
    LaunchedEffect(viewModel, strings) {
        viewModel.toasts.collect { toast ->
            val item = strings.toItem(toast, nextId++)
            if (queue.size >= MAX_TOASTS) queue.removeAt(0)
            queue.add(item)
            scope.launch {
                delay(TOAST_DURATION_MS)
                queue.removeAll { it.id == item.id }
            }
        }
    }
}

// ── Date formatting ──────────────────────────────────────────────────────────────────────────────────────

/** Formats [epochMillis] in the device zone + locale as a medium date / short time (web `formatDateTime`). */
@Composable
private fun rememberFormattedDateTime(epochMillis: Long): String =
    remember(epochMillis) {
        val zoned = Instant.ofEpochMilli(epochMillis).atZone(ZoneId.systemDefault())
        DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(Locale.getDefault())
            .format(zoned)
    }

// ── Previews (tooling-only; one @Preview per render branch) ──────────────────────────────────────────────

private val PREVIEW_ACTIONS = TeslaAccountActions()
private const val PREVIEW_NOW = 1_780_000_000_000L

private fun previewAuth(
    authenticated: Boolean,
    expiresAt: String? = null,
): AuthStatus = AuthStatus(authenticated = authenticated, expiresAt = expiresAt)

@Preview(name = "Connected", showBackground = true)
@Composable
private fun TeslaAccountConnectedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TeslaAccountSectionContent(
            authStatus = UiState(UiPhase.Content, previewAuth(authenticated = true, expiresAt = "2027-01-01T00:00:00Z")),
            reauthNeeded = false,
            actions = PREVIEW_ACTIONS,
            syncedCount = 3,
            onConnect = {},
            onRefreshToken = {},
            onSyncVehicles = {},
            onDisconnect = {},
            onRetry = {},
            nowMs = PREVIEW_NOW,
        )
    }
}

@Preview(name = "Connected — expiring soon", showBackground = true)
@Composable
private fun TeslaAccountExpiringSoonPreview() {
    val expiresAt = Instant.ofEpochMilli(PREVIEW_NOW + TeslaAccountView.DAY_MS * 3).toString()
    TeslaSyncTheme(dynamicColor = false) {
        TeslaAccountSectionContent(
            authStatus = UiState(UiPhase.Content, previewAuth(authenticated = true, expiresAt = expiresAt)),
            reauthNeeded = false,
            actions = PREVIEW_ACTIONS,
            syncedCount = null,
            onConnect = {},
            onRefreshToken = {},
            onSyncVehicles = {},
            onDisconnect = {},
            onRetry = {},
            nowMs = PREVIEW_NOW,
        )
    }
}

@Preview(name = "Not connected", showBackground = true)
@Composable
private fun TeslaAccountNotConnectedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TeslaAccountSectionContent(
            authStatus = UiState(UiPhase.Content, previewAuth(authenticated = false)),
            reauthNeeded = false,
            actions = PREVIEW_ACTIONS,
            syncedCount = null,
            onConnect = {},
            onRefreshToken = {},
            onSyncVehicles = {},
            onDisconnect = {},
            onRetry = {},
            nowMs = PREVIEW_NOW,
        )
    }
}

@Preview(name = "Disconnected — re-auth", showBackground = true)
@Composable
private fun TeslaAccountDisconnectedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TeslaAccountSectionContent(
            authStatus = UiState(UiPhase.Content, previewAuth(authenticated = true, expiresAt = "2027-01-01T00:00:00Z")),
            reauthNeeded = true,
            actions = PREVIEW_ACTIONS,
            syncedCount = null,
            onConnect = {},
            onRefreshToken = {},
            onSyncVehicles = {},
            onDisconnect = {},
            onRetry = {},
            nowMs = PREVIEW_NOW,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun TeslaAccountLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TeslaAccountSectionContent(
            authStatus = UiState(UiPhase.Loading),
            reauthNeeded = false,
            actions = PREVIEW_ACTIONS,
            syncedCount = null,
            onConnect = {},
            onRefreshToken = {},
            onSyncVehicles = {},
            onDisconnect = {},
            onRetry = {},
            nowMs = PREVIEW_NOW,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun TeslaAccountErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TeslaAccountSectionContent(
            authStatus = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            reauthNeeded = false,
            actions = PREVIEW_ACTIONS,
            syncedCount = null,
            onConnect = {},
            onRefreshToken = {},
            onSyncVehicles = {},
            onDisconnect = {},
            onRetry = {},
            nowMs = PREVIEW_NOW,
        )
    }
}

@Preview(name = "Offline — cached", showBackground = true)
@Composable
private fun TeslaAccountOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TeslaAccountSectionContent(
            authStatus =
                UiState(
                    phase = UiPhase.Content,
                    data = previewAuth(authenticated = true, expiresAt = "2027-01-01T00:00:00Z"),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            reauthNeeded = false,
            actions = PREVIEW_ACTIONS,
            syncedCount = null,
            onConnect = {},
            onRefreshToken = {},
            onSyncVehicles = {},
            onDisconnect = {},
            onRetry = {},
            nowMs = PREVIEW_NOW,
        )
    }
}
