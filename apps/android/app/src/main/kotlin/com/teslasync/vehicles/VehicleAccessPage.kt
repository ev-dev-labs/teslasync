// The native Jetpack Compose + Material 3 VehicleAccessPage vehicles surface — a parity port of
// web/src/features/vehicles/pages/VehicleAccessPage.tsx, the per-vehicle driver-sharing + invitation manager. It
// reproduces the page's chrome (PageContainer: title + subtitle + the parent-vehicle breadcrumb override + the
// page-level loading state) and both GlassPanels it renders inside it:
//   - GlassPanel1 "Drivers": a header (Users icon + title + count badge + Refresh) over the shared-driver DataTable
//     (name / email / role / remove) or, when empty, the no-drivers empty state;
//   - GlassPanel2 "Share Invitations": a header (Mail icon + title + count badge + Refresh + Invite Driver) over the
//     invitation DataTable (status / created-by / expires / copy-link / revoke) or the no-invitations empty state;
// plus the two destructive confirm dialogs (remove driver / revoke invitation). Every visible string resolves from
// the generated res/values catalog (ADR-014); no field is unit-bearing so there is no SI conversion (S5).
//
// Composition: [VehicleAccessPage] is the stateful entry (constructs the view-model over the host-wired source for
// the route vehicle id, records the one-shot `view.opened` diagnostic, collects the feeds + dialog/in-flight state);
// [VehicleAccessPageContent] is the stateless render layer. The framework-free model (VehicleAccessPageModel.kt)
// owns the status-token / timestamp / breadcrumb / loading folds; this file only resolves i18n + draws. The panels
// always render a non-blank surface (DataTable or empty state), never gated away.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehicles) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.vehicles.vehicleaccess

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.StatusBadge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.CopyButton
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconButtonVariant
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.pagecontainer.PageContainer
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicleaccess.VehicleDriver
import io.teslasync.shared.core.presentation.vehicleaccess.VehicleInvitation

// ── Column weights (web table column emphasis) ────────────────────────────────────────────────────────────────
private const val WEIGHT_TEXT = 2f
private const val WEIGHT_ROLE = 1.4f
private const val WEIGHT_STATUS = 1.4f
private const val WEIGHT_NARROW = 1f

/** Stagger the second panel in by 50 ms (web `<FadeIn delay={0.05}>`). */
private const val INVITATIONS_FADE_DELAY_MS = 50

/**
 * The Drivers panel + remove-dialog callbacks, wired to the [VehicleAccessPageViewModel] (web event handlers). Kept
 * domain-scoped (drivers only) so the holder stays small.
 */
data class DriverPanelActions(
    val onRefresh: () -> Unit,
    val onRequestRemove: (VehicleDriver) -> Unit,
    val onConfirmRemove: () -> Unit,
    val onCancelRemove: () -> Unit,
)

/**
 * The Invitations panel + revoke-dialog callbacks, wired to the [VehicleAccessPageViewModel] (web event handlers).
 * Kept domain-scoped (invitations only) so the holder stays small.
 */
data class InvitationPanelActions(
    val onRefresh: () -> Unit,
    val onCreate: () -> Unit,
    val onRequestRevoke: (VehicleInvitation) -> Unit,
    val onConfirmRevoke: () -> Unit,
    val onCancelRevoke: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [VehicleAccessPageViewModel] over the supplied [source] (the host binds the shared
 * VehiclesStore + a page-local vehicle-access repository via [vehicleAccessPageSourceOf]) for the vehicle [vehicleId].
 * The view-model is keyed by this surface's slug + vehicle id so it is scoped to the navigation entry.
 */
@Composable
fun VehicleAccessPage(
    source: VehicleAccessPageSource,
    vehicleId: String,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: VehicleAccessPageViewModel =
        viewModel(
            key = "${VehicleAccessPageRegistration.SLUG}:$vehicleId",
            factory = viewModelFactory { initializer { VehicleAccessPageViewModel(source, vehicleId, logger) } },
        )
    VehicleAccessPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: records the one-shot diagnostic and binds the feeds + dialog state to the stateless content. */
@Composable
fun VehicleAccessPage(
    viewModel: VehicleAccessPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val vehicle by viewModel.vehicleState.collectAsStateWithLifecycle()
    val drivers by viewModel.driversState.collectAsStateWithLifecycle()
    val invitations by viewModel.invitationsState.collectAsStateWithLifecycle()
    val refreshingDrivers by viewModel.refreshingDrivers.collectAsStateWithLifecycle()
    val refreshingInvitations by viewModel.refreshingInvitations.collectAsStateWithLifecycle()
    val creatingInvitation by viewModel.creatingInvitation.collectAsStateWithLifecycle()
    val removeTarget by viewModel.removeTarget.collectAsStateWithLifecycle()
    val revokeTarget by viewModel.revokeTarget.collectAsStateWithLifecycle()
    val removingDriver by viewModel.removingDriver.collectAsStateWithLifecycle()
    val revokingInvitation by viewModel.revokingInvitation.collectAsStateWithLifecycle()

    val driverActions =
        remember(viewModel) {
            DriverPanelActions(
                onRefresh = viewModel::refreshDrivers,
                onRequestRemove = viewModel::requestRemoveDriver,
                onConfirmRemove = viewModel::confirmRemoveDriver,
                onCancelRemove = viewModel::cancelRemoveDriver,
            )
        }
    val invitationActions =
        remember(viewModel) {
            InvitationPanelActions(
                onRefresh = viewModel::refreshInvitations,
                onCreate = viewModel::createInvitation,
                onRequestRevoke = viewModel::requestRevokeInvitation,
                onConfirmRevoke = viewModel::confirmRevokeInvitation,
                onCancelRevoke = viewModel::cancelRevokeInvitation,
            )
        }

    VehicleAccessPageContent(
        vehicleId = viewModel.vehicleId,
        vehicleName = vehicle.data?.displayName,
        drivers = drivers,
        invitations = invitations,
        refreshingDrivers = refreshingDrivers,
        refreshingInvitations = refreshingInvitations,
        creatingInvitation = creatingInvitation,
        removeTarget = removeTarget,
        revokeTarget = revokeTarget,
        removingDriver = removingDriver,
        revokingInvitation = revokingInvitation,
        driverActions = driverActions,
        invitationActions = invitationActions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body, rendered inside the shared [PageContainer] chrome (web `<PageContainer>`): a first load
 * (either feed loading with nothing cached) shows the centred spinner; otherwise the two GlassPanels render with
 * their DataTables or empty states. The breadcrumb override mirrors the web `vehicle?.display_name ?? \`Vehicle
 * #${vehicleId}\``. The two confirm dialogs are conditionally composed (web `open={target !== null}`).
 */
@Composable
fun VehicleAccessPageContent(
    vehicleId: String,
    vehicleName: String?,
    drivers: UiState<List<VehicleDriver>>,
    invitations: UiState<List<VehicleInvitation>>,
    refreshingDrivers: Boolean,
    refreshingInvitations: Boolean,
    creatingInvitation: Boolean,
    removeTarget: VehicleDriver?,
    revokeTarget: VehicleInvitation?,
    removingDriver: Boolean,
    revokingInvitation: Boolean,
    driverActions: DriverPanelActions,
    invitationActions: InvitationPanelActions,
    modifier: Modifier = Modifier,
) {
    val driversList = drivers.data ?: emptyList()
    val invitationsList = invitations.data ?: emptyList()

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
    ) {
        PageContainer(
            title = stringResource(R.string.translation_vehicleAccess_title),
            subtitle = stringResource(R.string.translation_vehicleAccess_subtitle),
            loading = pageIsLoading(drivers, invitations),
            breadcrumbLabels =
                mapOf(VehicleAccessPageRegistration.PARENT_WEB_PATH to vehicleBreadcrumbLabel(vehicleName, vehicleId)),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                FadeIn {
                    DriversPanel(
                        drivers = driversList,
                        refreshing = refreshingDrivers,
                        onRefresh = driverActions.onRefresh,
                        onRemove = driverActions.onRequestRemove,
                    )
                }
                FadeIn(delayMs = INVITATIONS_FADE_DELAY_MS) {
                    InvitationsPanel(
                        invitations = invitationsList,
                        refreshing = refreshingInvitations,
                        creating = creatingInvitation,
                        onRefresh = invitationActions.onRefresh,
                        onCreate = invitationActions.onCreate,
                        onRevoke = invitationActions.onRequestRevoke,
                    )
                }

                if (removeTarget != null) {
                    RemoveDriverDialog(
                        loading = removingDriver,
                        onConfirm = driverActions.onConfirmRemove,
                        onCancel = driverActions.onCancelRemove,
                    )
                }
                if (revokeTarget != null) {
                    RevokeInvitationDialog(
                        loading = revokingInvitation,
                        onConfirm = invitationActions.onConfirmRevoke,
                        onCancel = invitationActions.onCancelRevoke,
                    )
                }
            }
        }
    }
}

// ── Drivers panel (GlassPanel1) ───────────────────────────────────────────────────────────────────────────────

/**
 * The Drivers GlassPanel — the web first `<GlassPanel>`: a header (Users icon + "Drivers" + count badge + Refresh)
 * over the shared-driver DataTable, or the no-drivers empty state when the list is empty (web
 * `{driversList.length > 0 ? <DataTable/> : <EmptyState/>}`).
 */
@Composable
private fun DriversPanel(
    drivers: List<VehicleDriver>,
    refreshing: Boolean,
    onRefresh: () -> Unit,
    onRemove: (VehicleDriver) -> Unit,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        PanelHeader(
            icon = VehicleAccessGlyphs.Users,
            title = stringResource(R.string.translation_vehicleAccess_drivers_title),
            count = drivers.size,
        ) {
            RefreshButton(
                refreshing = refreshing,
                accessibilityLabel = stringResource(R.string.translation_vehicleAccess_drivers_refresh),
                onClick = onRefresh,
            )
        }
        Spacer(Modifier.height(Spacing.md))
        if (drivers.isNotEmpty()) {
            DataTable(
                columns = driverColumns(onRemove),
                rows = drivers,
                keyOf = { it.id },
            )
        } else {
            EmptyState(
                icon = VehicleAccessGlyphs.Users,
                message = stringResource(R.string.translation_vehicleAccess_drivers_empty),
            )
        }
    }
}

@Composable
private fun driverColumns(onRemove: (VehicleDriver) -> Unit): List<TableColumn<VehicleDriver>> {
    val nameHeader = stringResource(R.string.translation_vehicleAccess_drivers_name)
    val emailHeader = stringResource(R.string.translation_vehicleAccess_drivers_email)
    val roleHeader = stringResource(R.string.translation_vehicleAccess_drivers_role)
    val removeLabel = stringResource(R.string.translation_vehicleAccess_drivers_remove)
    return listOf(
        TableColumn(key = "name", header = nameHeader, weight = WEIGHT_TEXT) { row ->
            BodyText(orDash(row.driverName))
        },
        TableColumn(key = "email", header = emailHeader, weight = WEIGHT_TEXT) { row ->
            BodyText(orDash(row.driverEmail), color = MaterialTheme.colorScheme.onSurfaceVariant)
        },
        TableColumn(key = "role", header = roleHeader, weight = WEIGHT_ROLE) { row ->
            val role = row.role
            if (role != null) {
                Badge(role, variant = BadgeVariant.Info)
            } else {
                BodyText(VEHICLE_ACCESS_EM_DASH, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        TableColumn(key = "actions", header = "", weight = WEIGHT_NARROW, alignEnd = true) { row ->
            if (row.shareUserId != null) {
                IconButton(
                    imageVector = VehicleAccessGlyphs.UserMinus,
                    contentDescription = removeLabel,
                    onClick = { onRemove(row) },
                    variant = IconButtonVariant.Standard,
                    size = IconSize.Sm,
                    tint = MaterialTheme.colorScheme.error,
                )
            }
        },
    )
}

// ── Invitations panel (GlassPanel2) ───────────────────────────────────────────────────────────────────────────

/**
 * The Invitations GlassPanel — the web second `<GlassPanel>`: a header (Mail icon + "Share Invitations" + count
 * badge + Refresh + Invite Driver) over the invitation DataTable, or the no-invitations empty state when the list is
 * empty (web `{invitationsList.length > 0 ? <DataTable/> : <EmptyState/>}`).
 */
@Composable
private fun InvitationsPanel(
    invitations: List<VehicleInvitation>,
    refreshing: Boolean,
    creating: Boolean,
    onRefresh: () -> Unit,
    onCreate: () -> Unit,
    onRevoke: (VehicleInvitation) -> Unit,
) {
    val createAccessibilityLabel = stringResource(R.string.translation_vehicleAccess_invitations_create)
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        PanelHeader(
            icon = VehicleAccessGlyphs.Mail,
            title = stringResource(R.string.translation_vehicleAccess_invitations_title),
            count = invitations.size,
        ) {
            RefreshButton(
                refreshing = refreshing,
                accessibilityLabel = stringResource(R.string.translation_vehicleAccess_invitations_refresh),
                onClick = onRefresh,
            )
            Button(
                label = stringResource(R.string.translation_vehicleAccess_invitations_createBtn),
                onClick = onCreate,
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
                loading = creating,
                leadingIcon = VehicleAccessGlyphs.UserPlus,
                modifier =
                    Modifier.semantics {
                        contentDescription = createAccessibilityLabel
                    },
            )
        }
        Spacer(Modifier.height(Spacing.md))
        if (invitations.isNotEmpty()) {
            DataTable(
                columns = invitationColumns(onRevoke),
                rows = invitations,
                keyOf = { it.id },
            )
        } else {
            EmptyState(
                icon = VehicleAccessGlyphs.Shield,
                message = stringResource(R.string.translation_vehicleAccess_invitations_empty),
            )
        }
    }
}

@Composable
private fun invitationColumns(onRevoke: (VehicleInvitation) -> Unit): List<TableColumn<VehicleInvitation>> {
    val statusHeader = stringResource(R.string.translation_vehicleAccess_invitations_status)
    val createdByHeader = stringResource(R.string.translation_vehicleAccess_invitations_createdBy)
    val expiresHeader = stringResource(R.string.translation_vehicleAccess_invitations_expires)
    val linkHeader = stringResource(R.string.translation_vehicleAccess_invitations_link)
    val copyLabel = stringResource(R.string.translation_vehicleAccess_invitations_copyLink)
    val copiedLabel = stringResource(R.string.translation_common_copyLink_copied)
    val revokeLabel = stringResource(R.string.translation_vehicleAccess_invitations_revoke)
    return listOf(
        TableColumn(key = "status", header = statusHeader, weight = WEIGHT_STATUS) { row ->
            StatusBadge(status = invitationStatusToken(row.status))
        },
        TableColumn(key = "createdBy", header = createdByHeader, weight = WEIGHT_TEXT) { row ->
            BodyText(orDash(row.createdBy), color = MaterialTheme.colorScheme.onSurfaceVariant)
        },
        TableColumn(key = "expires", header = expiresHeader, weight = WEIGHT_TEXT) { row ->
            BodyText(formatInvitationExpiry(row.expiresAt))
        },
        TableColumn(key = "link", header = linkHeader, weight = WEIGHT_NARROW) { row ->
            val url = row.inviteUrl
            if (url != null) {
                CopyButton(
                    text = url,
                    copyLabel = copyLabel,
                    copiedLabel = copiedLabel,
                    iconOnly = true,
                )
            } else {
                BodyText(VEHICLE_ACCESS_EM_DASH, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        TableColumn(key = "actions", header = "", weight = WEIGHT_NARROW, alignEnd = true) { row ->
            if (invitationIsRevocable(row.status)) {
                IconButton(
                    imageVector = VehicleAccessGlyphs.XCircle,
                    contentDescription = revokeLabel,
                    onClick = { onRevoke(row) },
                    variant = IconButtonVariant.Standard,
                    size = IconSize.Sm,
                    tint = MaterialTheme.colorScheme.error,
                )
            }
        },
    )
}

// ── Shared panel header + refresh affordance ──────────────────────────────────────────────────────────────────

/** A panel header: a leading icon + section title + an optional count badge, and a trailing [actions] cluster. */
@Composable
private fun PanelHeader(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    count: Int,
    actions: @Composable RowScope.() -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                size = IconSize.Lg,
                tint = MaterialTheme.colorScheme.primary,
            )
            SectionTitle(title)
            if (count > 0) {
                Badge(count.toString(), variant = BadgeVariant.Neutral)
            }
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            content = actions,
        )
    }
}

/**
 * The ghost Refresh button shared by both panels (web `<Button size="sm" variant="ghost">RefreshCw + Refresh`). The
 * visible label is the short "Refresh" (web `vehicleAccess.refresh`); the [accessibilityLabel] carries the panel-
 * specific name (web `aria-label` = `vehicleAccess.drivers.refresh` / `vehicleAccess.invitations.refresh`).
 */
@Composable
private fun RefreshButton(
    refreshing: Boolean,
    accessibilityLabel: String,
    onClick: () -> Unit,
) {
    Button(
        label = stringResource(R.string.translation_vehicleAccess_refresh),
        onClick = onClick,
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
        loading = refreshing,
        leadingIcon = VehicleAccessGlyphs.Refresh,
        modifier = Modifier.semantics { contentDescription = accessibilityLabel },
    )
}

// ── Confirm dialogs ───────────────────────────────────────────────────────────────────────────────────────────

/** The destructive remove-driver confirm dialog (web first `<ConfirmDialog variant="danger">`). */
@Composable
private fun RemoveDriverDialog(
    loading: Boolean,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
) {
    ConfirmDialog(
        title = stringResource(R.string.translation_vehicleAccess_drivers_removeTitle),
        message = stringResource(R.string.translation_vehicleAccess_drivers_removeMessage),
        confirmLabel = stringResource(R.string.translation_vehicleAccess_drivers_removeConfirm),
        cancelLabel = stringResource(R.string.translation_common_cancel),
        onConfirm = onConfirm,
        onCancel = onCancel,
        severity = ConfirmSeverity.Danger,
        loading = loading,
        closeLabel = stringResource(R.string.translation_common_close),
    )
}

/** The destructive revoke-invitation confirm dialog (web second `<ConfirmDialog variant="danger">`). */
@Composable
private fun RevokeInvitationDialog(
    loading: Boolean,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
) {
    ConfirmDialog(
        title = stringResource(R.string.translation_vehicleAccess_invitations_revokeTitle),
        message = stringResource(R.string.translation_vehicleAccess_invitations_revokeMessage),
        confirmLabel = stringResource(R.string.translation_vehicleAccess_invitations_revokeConfirm),
        cancelLabel = stringResource(R.string.translation_common_cancel),
        onConfirm = onConfirm,
        onCancel = onCancel,
        severity = ConfirmSeverity.Danger,
        loading = loading,
        closeLabel = stringResource(R.string.translation_common_close),
    )
}
