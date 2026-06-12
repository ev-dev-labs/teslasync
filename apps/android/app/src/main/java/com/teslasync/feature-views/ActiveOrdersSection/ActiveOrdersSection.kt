// The native Jetpack Compose + Material 3 ActiveOrdersSection feature view — a parity port of
// web/src/features/settings/components/ActiveOrdersSection.tsx. Inside a `<GlassPanel>` the web component
// renders a header (a ShoppingCart IconBox + "Active Orders" title + subtitle on the left; a "Synced …" stamp
// + a Refresh button on the right) and a 1/2-column grid of order cards (model + status `<Badge>`, then Order
// ID, VIN, Delivery Date, and an "Upgradable" chip), falling back to a friendly `<EmptyState>` whose copy
// depends on whether the account has ever been fetched.
//
// This port keeps that contract end to end and binds the shared P1/S8 [UserStore] (the KMP port of the web
// `useTeslaUserOrders` / `useRefreshTeslaOrders` hooks) directly — it performs NO HTTP itself (ADR-002). The
// orders feed is a cache-then-network resource, so the surface renders every lifecycle state that layer can
// carry: a loading skeleton, a hard-error retry surface, the two empty states, the populated grid, and a
// stale/offline ("last known") freshness chip with auto-refresh. Refreshing calls the store mutation and
// surfaces the web `useToast` success/error toast from the i18n catalog. All data derivations live in
// [ActiveOrdersProjection] (pure, unit-tested off-device); the status token colors are resolved here at the
// Compose boundary (never a raw hex in the model).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ActiveOrdersSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.activeorderssection

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.ToastHost
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.dismissToast
import io.teslasync.android.components.feedback.enqueueToast
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.user.TeslaOrder
import io.teslasync.shared.core.presentation.user.TeslaOrdersEnvelope
import io.teslasync.shared.core.presentation.user.UserStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.ZoneId
import java.util.Locale

/** The web `<FadeIn delay={0.045}>` entrance delay, in milliseconds. */
private const val FADE_DELAY_MS: Int = 45

/** Max queued refresh toasts and how long each is shown before it auto-dismisses. */
private const val MAX_TOASTS: Int = 3
private const val TOAST_DURATION_MS: Long = 3_200L

/** Skeleton bar proportions/heights so the loading panel is never a blank box. */
private const val SKELETON_TITLE_FRACTION: Float = 0.45f
private const val SKELETON_LINE_FRACTION: Float = 0.85f
private val SKELETON_TITLE_HEIGHT: Dp = 16.dp
private val SKELETON_LINE_HEIGHT: Dp = 12.dp

/** Low-alpha wash + hairline border behind each order card (web `bg-white/[0.02]` + subtle border). */
private const val CARD_WASH_ALPHA: Float = 0.35f
private val CARD_PADDING: Dp = 14.dp
private val CARD_BORDER_WIDTH: Dp = 1.dp

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10). Each field maps
 * one-to-one to a web `t(...)` call in the `settings` namespace (`orders.*`), plus the freshness/error chrome
 * the cache-then-network lifecycle implies and the two refresh toasts (`toast.orders*`).
 */
data class ActiveOrdersSectionStrings(
    val title: String,
    val subtitle: String,
    val synced: String,
    val refresh: String,
    val orderId: String,
    val vin: String,
    val deliveryDate: String,
    val upgradable: String,
    val noOrders: String,
    val noData: String,
    val loading: String,
    val updating: String,
    val offline: String,
    val errorTitle: String,
    val errorMessage: String,
    val retry: String,
)

/**
 * Stateful entry point for the ActiveOrdersSection surface. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11), binds the shared [store]'s orders feed (P1/S8) as a cache-then-network [UiState], and
 * drives the Refresh mutation — surfacing the web `useToast` success/error toast. The view performs no HTTP.
 *
 * @param store the shared User/Account state holder (web `useUser` domain); supplied by the host page.
 * @param modifier the layout modifier for the surface root.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param scope the coroutine scope the refresh mutation runs in; defaults to the composition scope.
 */
@Composable
fun ActiveOrdersSection(
    store: UserStore,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    scope: CoroutineScope = rememberCoroutineScope(),
) {
    LaunchedEffect(Unit) { recordActiveOrdersSectionOpened(logger) }

    val feed = remember(store) { store.teslaUserOrders() }
    val resource by feed.collectAsStateWithLifecycle()
    val state = remember(resource) { resource.toUiState { ActiveOrdersProjection.isEmpty(it) } }

    val refreshedMessage = stringResource(R.string.translation_toast_ordersRefreshed)
    val failedMessage = stringResource(R.string.translation_toast_ordersFailed)

    var refreshing by remember { mutableStateOf(false) }
    var toasts by remember { mutableStateOf(emptyList<ToastItem>()) }
    var toastSeq by remember { mutableLongStateOf(0L) }

    val onRefresh: () -> Unit = {
        if (!refreshing) {
            refreshing = true
            scope.launch {
                val result = store.refreshTeslaOrders()
                refreshing = false
                toastSeq += 1
                val message = if (result.isSuccess) refreshedMessage else failedMessage
                val tone = if (result.isSuccess) Tone.Success else Tone.Danger
                toasts = enqueueToast(toasts, ToastItem(id = toastSeq, message = message, tone = tone), MAX_TOASTS)
            }
        }
    }

    LaunchedEffect(toasts) {
        if (toasts.isNotEmpty()) {
            delay(TOAST_DURATION_MS)
            toasts = toasts.drop(1)
        }
    }

    Box(modifier = modifier) {
        ActiveOrdersSectionContent(
            state = state,
            refreshing = refreshing || state.refreshing,
            onRefresh = onRefresh,
            onRetry = onRefresh,
        )
        ToastHost(
            toasts = toasts,
            onDismiss = { id -> toasts = dismissToast(toasts, id) },
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web component's
 * panel: an always-visible header (icon + title + subtitle, sync stamp, Refresh button) above a body that
 * switches between the loading skeleton, the hard-error retry surface, the populated order grid, and the two
 * empty states. A stale (non-error) value auto-refreshes via [onRetry], mirroring the sibling surfaces'
 * freshness contract; [zone]/[locale] format the sync stamp + delivery dates.
 */
@Composable
fun ActiveOrdersSectionContent(
    state: UiState<TeslaOrdersEnvelope>,
    refreshing: Boolean,
    onRefresh: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    zone: ZoneId = ZoneId.systemDefault(),
    locale: Locale = Locale.getDefault(),
    strings: ActiveOrdersSectionStrings = rememberActiveOrdersSectionStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(padding = PanelPadding.Md) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                ActiveOrdersHeader(
                    state = state,
                    refreshing = refreshing,
                    onRefresh = onRefresh,
                    zone = zone,
                    locale = locale,
                    strings = strings,
                )
                ActiveOrdersBody(
                    state = state,
                    onRetry = onRetry,
                    zone = zone,
                    locale = locale,
                    strings = strings,
                )
            }
        }
    }
}

/** The header: a ShoppingCart icon box + title/subtitle on the left, the sync stamp + Refresh on the right. */
@Composable
private fun ActiveOrdersHeader(
    state: UiState<TeslaOrdersEnvelope>,
    refreshing: Boolean,
    onRefresh: () -> Unit,
    zone: ZoneId,
    locale: Locale,
    strings: ActiveOrdersSectionStrings,
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
            IconBox(tone = IconBoxTone.Info) {
                Icon(ShoppingCartGlyph, contentDescription = null, size = IconSize.Lg)
            }
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Heading(strings.title, level = HeadingLevel.Panel, maxLines = 1)
                Caption(strings.subtitle)
            }
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ActiveOrdersSyncStamp(state = state, refreshing = refreshing, zone = zone, locale = locale, strings = strings)
            Button(
                label = strings.refresh,
                onClick = onRefresh,
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
                loading = refreshing,
                leadingIcon = RefreshGlyph,
            )
        }
    }
}

/**
 * The right-of-header freshness affordance. While refreshing / stale / offline it shows the [DataFreshness]
 * chip (carrying the honest "Offline" / "updating…" state); otherwise, once fetched, it shows the web-parity
 * "Synced <timestamp>" caption. Nothing renders before the first fetch.
 */
@Composable
private fun ActiveOrdersSyncStamp(
    state: UiState<TeslaOrdersEnvelope>,
    refreshing: Boolean,
    zone: ZoneId,
    locale: Locale,
    strings: ActiveOrdersSectionStrings,
) {
    val fetchedAt = state.data?.fetchedAt
    when {
        refreshing || state.refreshing || state.stale || state.hasError ->
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                isFetching = refreshing || state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                fetchingLabel = strings.updating,
                errorLabel = strings.offline,
                formatAge = rememberFreshnessFormatter(),
            )

        !fetchedAt.isNullOrBlank() ->
            Caption("${strings.synced} ${ActiveOrdersProjection.formatSynced(fetchedAt, zone, locale)}")
    }
}

/** The panel body: loading skeleton, hard-error retry, the order grid, or the two empty states. */
@Composable
private fun ActiveOrdersBody(
    state: UiState<TeslaOrdersEnvelope>,
    onRetry: () -> Unit,
    zone: ZoneId,
    locale: Locale,
    strings: ActiveOrdersSectionStrings,
) {
    when {
        state.isLoading -> ActiveOrdersLoading(label = strings.loading)
        state.isError -> ActiveOrdersError(onRetry = onRetry, strings = strings)
        else -> {
            val envelope = state.data
            val orders = remember(envelope, zone, locale) { ActiveOrdersProjection.orders(envelope, zone, locale) }
            if (orders.isEmpty()) {
                ActiveOrdersEmpty(
                    message = if (ActiveOrdersProjection.hasFetched(envelope)) strings.noOrders else strings.noData,
                )
            } else {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    orders.forEach { order -> OrderCard(order = order, strings = strings) }
                }
            }
        }
    }
}

/** One order card — the faithful reproduction of the web grid cell. */
@Composable
private fun OrderCard(
    order: OrderView,
    strings: ActiveOrdersSectionStrings,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = CARD_WASH_ALPHA),
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(CARD_BORDER_WIDTH, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(CARD_PADDING),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    modifier = Modifier.weight(1f),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        PackageGlyph,
                        contentDescription = null,
                        size = IconSize.Sm,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Heading(order.model, modifier = Modifier.weight(1f, fill = false), level = HeadingLevel.Panel, maxLines = 1)
                }
                Badge(order.statusLabel, variant = statusVariant(order.statusKind))
            }
            OrderDetailRow(label = strings.orderId) { CodeText(order.orderId) }
            if (order.hasVin) {
                OrderDetailRow(label = strings.vin) { CodeText(order.vin ?: EM_DASH) }
            }
            if (order.hasDeliveryDate) {
                OrderDetailRow(label = strings.deliveryDate) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            CalendarGlyph,
                            contentDescription = null,
                            size = IconSize.Xs,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            order.deliveryDateLabel ?: EM_DASH,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                    }
                }
            }
            if (order.isUpgradable) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    Badge(strings.upgradable, variant = BadgeVariant.Info)
                }
            }
        }
    }
}

/** A label-left / value-right detail row inside an order card (web `flex justify-between`). */
@Composable
private fun OrderDetailRow(
    label: String,
    value: @Composable () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Caption(label)
        value()
    }
}

/** First-load skeleton — a title bar plus two lines so the panel is never a blank box while loading. */
@Composable
private fun ActiveOrdersLoading(label: String) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT)
        Skeleton(widthFraction = SKELETON_LINE_FRACTION, height = SKELETON_LINE_HEIGHT)
        Skeleton(widthFraction = SKELETON_LINE_FRACTION, height = SKELETON_LINE_HEIGHT)
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun ActiveOrdersError(
    onRetry: () -> Unit,
    strings: ActiveOrdersSectionStrings,
) {
    ErrorDisplay(
        message = strings.errorMessage,
        title = strings.errorTitle,
        onRetry = onRetry,
        retryLabel = strings.retry,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Empty surface — the web `<EmptyState>` with the Info glyph; never a blank box. */
@Composable
private fun ActiveOrdersEmpty(message: String) {
    EmptyState(
        message = message,
        icon = TeslaGlyphs.Info,
        modifier = Modifier.fillMaxWidth(),
    )
}

// ── Render-only helpers ────────────────────────────────────────────────────────────────────────────────────

/** The web status-badge variant: delivered → success, in-transit → info, cancelled → danger, pending → warning. */
private fun statusVariant(kind: OrderStatusKind): BadgeVariant =
    when (kind) {
        OrderStatusKind.Delivered -> BadgeVariant.Success
        OrderStatusKind.InTransit -> BadgeVariant.Info
        OrderStatusKind.Cancelled -> BadgeVariant.Danger
        OrderStatusKind.Pending -> BadgeVariant.Warning
        OrderStatusKind.Neutral -> BadgeVariant.Neutral
    }

/**
 * Builds the localized [ActiveOrdersSectionStrings] from the i18n catalog (P1/S10): the `orders.*` keys the web
 * component reads (in the `settings` namespace, resolved here from the generated catalog), plus the freshness /
 * error / toast chrome. Remembered against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberActiveOrdersSectionStrings(): ActiveOrdersSectionStrings {
    val title = stringResource(R.string.translation_orders_title)
    val subtitle = stringResource(R.string.translation_orders_subtitle)
    val synced = stringResource(R.string.translation_orders_lastSynced)
    val refresh = stringResource(R.string.translation_orders_refresh)
    val orderId = stringResource(R.string.translation_orders_orderId)
    val vin = stringResource(R.string.translation_orders_vin)
    val deliveryDate = stringResource(R.string.translation_orders_deliveryDate)
    val upgradable = stringResource(R.string.translation_orders_upgradable)
    val noOrders = stringResource(R.string.translation_orders_noOrders)
    val noData = stringResource(R.string.translation_orders_noData)
    val loading = stringResource(R.string.translation_common_loading)
    val updating = stringResource(R.string.translation_freshness_updating)
    val offline = stringResource(R.string.translation_common_offline)
    val errorTitle = stringResource(R.string.translation_error_serverError_title)
    val errorMessage = stringResource(R.string.translation_error_serverError_message)
    val retry = stringResource(R.string.translation_common_retry)
    return remember(title, refresh, orderId, deliveryDate, noOrders, noData, offline, errorTitle, retry) {
        ActiveOrdersSectionStrings(
            title = title,
            subtitle = subtitle,
            synced = synced,
            refresh = refresh,
            orderId = orderId,
            vin = vin,
            deliveryDate = deliveryDate,
            upgradable = upgradable,
            noOrders = noOrders,
            noData = noData,
            loading = loading,
            updating = updating,
            offline = offline,
            errorTitle = errorTitle,
            errorMessage = errorMessage,
            retry = retry,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberFreshnessFormatter(): (FreshnessAge) -> String {
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────────

private val PREVIEW_STRINGS =
    ActiveOrdersSectionStrings(
        title = "Active Orders",
        subtitle = "Vehicle orders and delivery tracking from Tesla",
        synced = "Synced",
        refresh = "Refresh",
        orderId = "Order ID",
        vin = "VIN",
        deliveryDate = "Delivery Date",
        upgradable = "Upgradable",
        noOrders = "No active orders found.",
        noData = "No order data yet. Click Refresh to fetch from Tesla.",
        loading = "Loading…",
        updating = "updating…",
        offline = "Offline",
        errorTitle = "Server error",
        errorMessage = "Something went wrong on our end. Please try again.",
        retry = "Retry",
    )

private val PREVIEW_ENVELOPE =
    TeslaOrdersEnvelope(
        orders =
            listOf(
                TeslaOrder(
                    id = 1,
                    orderId = "RN123456789",
                    model = "Model 3",
                    status = "READY_FOR_TRANSPORT",
                    deliveryDate = "2026-07-15",
                    vin = "5YJ3E1EA7PF000000",
                    isUpgradable = true,
                    fetchedAt = "2026-06-12T14:30:00Z",
                ),
                TeslaOrder(
                    id = 2,
                    orderId = "RN987654321",
                    model = "Model Y",
                    status = "BOOKED",
                    deliveryDate = null,
                    vin = null,
                    isUpgradable = false,
                    fetchedAt = "2026-06-12T14:30:00Z",
                ),
            ),
        fetchedAt = "2026-06-12T14:30:00Z",
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun ActiveOrdersContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ActiveOrdersSectionContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_ENVELOPE, fetchedAt = 1_750_000_000_000L),
            refreshing = false,
            onRefresh = {},
            onRetry = {},
            zone = ZoneId.of("UTC"),
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty (no orders)", showBackground = true)
@Composable
private fun ActiveOrdersEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ActiveOrdersSectionContent(
            state = UiState(phase = UiPhase.Empty, data = TeslaOrdersEnvelope(fetchedAt = "2026-06-12T14:30:00Z")),
            refreshing = false,
            onRefresh = {},
            onRetry = {},
            zone = ZoneId.of("UTC"),
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun ActiveOrdersLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ActiveOrdersSectionContent(
            state = UiState(phase = UiPhase.Loading),
            refreshing = false,
            onRefresh = {},
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun ActiveOrdersErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ActiveOrdersSectionContent(
            state = UiState(phase = UiPhase.Error),
            refreshing = false,
            onRefresh = {},
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}
