// The native Jetpack Compose + Material 3 Vehicle Access dashboard surface — a parity port of
// web/src/features/dashboard/widgets/VehicleAccessWidget.tsx. It mirrors the web `WidgetShell` (a skeleton
// while the first load is in flight, otherwise a Users-iconed title + freshness header) wrapping one of the
// two bodies the web renders: the compact summary (1×N — Users icon + "{n} Drivers" + a mobile-access
// status dot) or — when wider — the standard layout (a Mobile Access badge row, an Authorized Drivers
// detail list, and a Pending Invitations detail list when any exist), with a friendly empty state when no
// access data is present at all. All data flows through the shared [VehicleAccessWidgetViewModel] (P1/S8);
// the view never performs HTTP. Every string resolves through the i18n catalog (P1/S10), and every row +
// the compact summary carry a merged TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/VehicleAccessWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.vehicleaccess

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicleaccess.VehicleDriver
import io.teslasync.shared.core.presentation.vehicleaccess.VehicleInvitation

private val COMPACT_MIN_HEIGHT: Dp = 44.dp
private val ROW_MIN_HEIGHT: Dp = 44.dp
private val DOT_SIZE: Dp = 10.dp
private val LOADING_TITLE_HEIGHT: Dp = 14.dp
private val LOADING_ROW_HEIGHT: Dp = 32.dp
private const val LOADING_TITLE_FRACTION: Float = 0.4f
private const val LOADING_HERO_FRACTION: Float = 0.6f

/**
 * Stateful entry point. Binds the shared vehicles + drivers + invitations + mobile-access feeds via
 * [source] into a [VehicleAccessWidgetViewModel], resolves the localized [VehicleAccessStrings] from the
 * catalog (P1/S10), records the one-shot `view.opened` diagnostic, and renders the surface for the given
 * [size]. A dashboard host supplies [source] (an adapter over the shared S8 data layer) and a unique
 * [instanceKey] per placement; an explicit [vehicleId] pins the surface to one vehicle (web
 * `WidgetProps.vehicleId`), otherwise the first enrolled vehicle is used.
 */
@Composable
fun VehicleAccessWidget(
    source: VehicleAccessSource,
    modifier: Modifier = Modifier,
    size: VehicleAccessSize = VehicleAccessRegistration.DEFAULT_SIZE,
    vehicleId: Long? = null,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = VehicleAccessRegistration.ID,
) {
    val viewModel: VehicleAccessWidgetViewModel =
        viewModel(key = instanceKey, factory = VehicleAccessWidgetViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    VehicleAccessWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuit (a first load → full skeleton) and otherwise the Users title + freshness
 * header over the compact / standard body, or the empty state. The web vehicle-access widget does not pass
 * `WidgetShell`'s `error` prop, so a hard failure is surfaced honestly through the header freshness chip
 * (offline) + the refresh control above the body — never a blanked panel — and a stale (non-error) snapshot
 * auto-refreshes, mirroring the web freshness contract. [size] selects the compact vs standard layout (web
 * `size.cols`).
 */
@Composable
fun VehicleAccessWidgetContent(
    state: UiState<VehicleAccessData>,
    size: VehicleAccessSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberVehicleAccessStrings()

    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        when {
            state.isLoading ->
                VehicleAccessLoading(compact = size.isCompact, label = stringResource(R.string.translation_common_loading))
            else -> VehicleAccessLoaded(state = state, size = size, strings = strings, onRefresh = onRefresh)
        }
    }
}

@Composable
private fun VehicleAccessLoaded(
    state: UiState<VehicleAccessData>,
    size: VehicleAccessSize,
    strings: VehicleAccessStrings,
    onRefresh: () -> Unit,
) {
    val display =
        remember(state.data, strings) {
            VehicleAccessProjection.project(state.data ?: VehicleAccessData.EMPTY, strings)
        }
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        VehicleAccessHeader(title = strings.title, state = state, onRefresh = onRefresh)
        when {
            !display.hasData -> VehicleAccessEmpty(message = strings.noData, icon = FeedbackGlyphs.Users)
            size.isCompact -> VehicleAccessCompactBody(display = display)
            else -> VehicleAccessStandardBody(display = display, strings = strings)
        }
    }
}

@Composable
private fun VehicleAccessHeader(
    title: String,
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = FeedbackGlyphs.Users,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.info,
        )
        PanelTitle(title, modifier = Modifier.weight(1f).semantics { heading() })
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = false,
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

/**
 * The compact body (web `CompactView`): the Users glyph + the "{n} Drivers" summary on the left and the
 * mobile-access status dot on the right. The whole row carries the folded TalkBack phrase (title + driver
 * count + mobile status), reproducing the web status dot's `title` tooltip as an accessible label.
 */
@Composable
private fun VehicleAccessCompactBody(display: VehicleAccessDisplay) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = COMPACT_MIN_HEIGHT)
                .clearAndSetSemantics { contentDescription = display.compactContentDescription },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(
            modifier = Modifier.weight(1f),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(
                imageVector = FeedbackGlyphs.Users,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            BodyText(display.driversText, maxLines = 1)
        }
        MobileStatusDot(enabled = display.mobileEnabled)
    }
}

/**
 * The standard body (web `StandardView`): the Mobile Access badge row, the Authorized Drivers detail list
 * (or its empty line), and — only when any pending invitation exists (web `invitationEntries.length > 0`) —
 * the Pending Invitations detail list.
 */
@Composable
private fun VehicleAccessStandardBody(
    display: VehicleAccessDisplay,
    strings: VehicleAccessStrings,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().heightIn(min = ROW_MIN_HEIGHT),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Caption(strings.mobile)
            Badge(text = display.mobileBadgeText, variant = badgeVariant(display.mobileBadgeTone))
        }
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Caption(strings.authorized)
            WidgetDetailCard(
                entries = display.driverEntries,
                emptyMessage = strings.noDrivers,
                emptyIcon = FeedbackGlyphs.Users,
            )
        }
        if (display.invitationEntries.isNotEmpty()) {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Caption(strings.pending)
                WidgetDetailCard(
                    entries = display.invitationEntries,
                    emptyMessage = strings.noInvitations,
                    emptyIcon = null,
                )
            }
        }
    }
}

/**
 * The native analogue of the web `WidgetDetailCard`: a definition list of label/value(+badge) rows, or a
 * friendly empty state when there are no entries. Standard-layout placements never pass the web `compact`
 * cap (it is only set in the compact body, which renders no detail cards), so every entry is shown.
 */
@Composable
private fun WidgetDetailCard(
    entries: List<DetailEntry>,
    emptyMessage: String,
    emptyIcon: ImageVector?,
) {
    if (entries.isEmpty()) {
        VehicleAccessEmpty(message = emptyMessage, icon = emptyIcon)
    } else {
        Column(modifier = Modifier.fillMaxWidth()) {
            entries.forEachIndexed { index, entry ->
                if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                DetailRow(entry = entry)
            }
        }
    }
}

@Composable
private fun DetailRow(entry: DetailEntry) {
    val description =
        buildString {
            append("${entry.label}, ${entry.value}")
            entry.badge?.let { append(", ${it.text}") }
        }
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = ROW_MIN_HEIGHT)
                .clearAndSetSemantics { contentDescription = description }
                .padding(vertical = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Caption(entry.label, modifier = Modifier.weight(1f))
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            BodyText(entry.value, maxLines = 1)
            entry.badge?.let { Badge(text = it.text, variant = badgeVariant(it.tone)) }
        }
    }
}

@Composable
private fun MobileStatusDot(enabled: Boolean?) {
    val color =
        when (enabled) {
            true -> TeslaTokens.status.success
            false -> TeslaTokens.status.danger
            null -> MaterialTheme.colorScheme.surfaceVariant
        }
    Box(
        modifier =
            Modifier
                .size(DOT_SIZE)
                .clip(CircleShape)
                .background(color),
    )
}

@Composable
private fun VehicleAccessEmpty(
    message: String,
    icon: ImageVector?,
) {
    EmptyState(
        message = message,
        icon = icon,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun VehicleAccessLoading(
    compact: Boolean,
    label: String,
) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (compact) {
            Skeleton(widthFraction = LOADING_HERO_FRACTION, height = LOADING_ROW_HEIGHT)
        } else {
            Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
            Skeleton(height = LOADING_ROW_HEIGHT, rounded = true)
            Skeleton(height = LOADING_ROW_HEIGHT, rounded = true)
            Skeleton(height = LOADING_ROW_HEIGHT, rounded = true)
        }
    }
}

/** Maps a pure [DetailBadgeTone] onto the shared [BadgeVariant] (web `error` → danger). */
private fun badgeVariant(tone: DetailBadgeTone): BadgeVariant =
    when (tone) {
        DetailBadgeTone.Success -> BadgeVariant.Success
        DetailBadgeTone.Warning -> BadgeVariant.Warning
        DetailBadgeTone.Error -> BadgeVariant.Danger
        DetailBadgeTone.Neutral -> BadgeVariant.Neutral
    }

/**
 * Resolves the localized [VehicleAccessStrings] from the i18n catalog (P1/S10) — the nineteen
 * `widget.vehicleAccess*` keys the web component reads via `t('widget.vehicleAccess…')`. Remembered against
 * the resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberVehicleAccessStrings(): VehicleAccessStrings {
    val title = stringResource(R.string.translation_widget_vehicleAccess)
    val drivers = stringResource(R.string.translation_widget_vehicleAccessDrivers)
    val mobileOn = stringResource(R.string.translation_widget_vehicleAccessMobileOn)
    val mobileOff = stringResource(R.string.translation_widget_vehicleAccessMobileOff)
    val mobileUnknown = stringResource(R.string.translation_widget_vehicleAccessMobileUnknown)
    val mobile = stringResource(R.string.translation_widget_vehicleAccessMobile)
    val enabled = stringResource(R.string.translation_widget_vehicleAccessEnabled)
    val disabled = stringResource(R.string.translation_widget_vehicleAccessDisabled)
    val unknown = stringResource(R.string.translation_widget_vehicleAccessUnknown)
    val authorized = stringResource(R.string.translation_widget_vehicleAccessAuthorized)
    val noDrivers = stringResource(R.string.translation_widget_vehicleAccessNoDrivers)
    val pending = stringResource(R.string.translation_widget_vehicleAccessPending)
    val noInvitations = stringResource(R.string.translation_widget_vehicleAccessNoInvitations)
    val owner = stringResource(R.string.translation_widget_vehicleAccessOwner)
    val driver = stringResource(R.string.translation_widget_vehicleAccessDriver)
    val pendingStatus = stringResource(R.string.translation_widget_vehicleAccessPendingStatus)
    val accepted = stringResource(R.string.translation_widget_vehicleAccessAccepted)
    val expired = stringResource(R.string.translation_widget_vehicleAccessExpired)
    val noData = stringResource(R.string.translation_widget_vehicleAccessNoData)
    return remember(
        title,
        drivers,
        mobileOn,
        mobileOff,
        mobileUnknown,
        mobile,
        enabled,
        disabled,
        unknown,
        authorized,
        noDrivers,
        pending,
        noInvitations,
        owner,
        driver,
        pendingStatus,
        accepted,
        expired,
        noData,
    ) {
        VehicleAccessStrings(
            title = title,
            drivers = drivers,
            mobileOn = mobileOn,
            mobileOff = mobileOff,
            mobileUnknown = mobileUnknown,
            mobile = mobile,
            enabled = enabled,
            disabled = disabled,
            unknown = unknown,
            authorized = authorized,
            noDrivers = noDrivers,
            pending = pending,
            noInvitations = noInvitations,
            owner = owner,
            driver = driver,
            pendingStatus = pendingStatus,
            accepted = accepted,
            expired = expired,
            noData = noData,
        )
    }
}

@Preview(name = "VehicleAccess — standard", showBackground = true)
@Composable
private fun VehicleAccessStandardPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleAccessWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewData(), fetchedAt = PREVIEW_NOW),
            size = VehicleAccessRegistration.DEFAULT_SIZE,
            onRefresh = {},
        )
    }
}

@Preview(name = "VehicleAccess — compact", showBackground = true)
@Composable
private fun VehicleAccessCompactPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleAccessWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewData(), fetchedAt = PREVIEW_NOW),
            size = VehicleAccessRegistration.MIN_SIZE,
            onRefresh = {},
        )
    }
}

private const val PREVIEW_NOW = 1_780_000_000_000L

private fun previewData(): VehicleAccessData =
    VehicleAccessData(
        drivers =
            listOf(
                VehicleDriver(
                    id = 1,
                    vehicleId = 1,
                    driverName = "Ada Lovelace",
                    role = "owner",
                    fetchedAt = "2024-05-10T09:00:00Z",
                ),
                VehicleDriver(
                    id = 2,
                    vehicleId = 1,
                    driverEmail = "grace@example.com",
                    role = "driver",
                    fetchedAt = "2024-05-11T09:00:00Z",
                ),
            ),
        invitations =
            listOf(
                VehicleInvitation(
                    id = 3,
                    vehicleId = 1,
                    invitationId = "inv-1",
                    status = "pending",
                    createdBy = "owner@example.com",
                    fetchedAt = "2024-05-12T09:00:00Z",
                    createdAt = "2024-05-12T09:00:00Z",
                ),
            ),
        mobileEnabled = true,
    )
