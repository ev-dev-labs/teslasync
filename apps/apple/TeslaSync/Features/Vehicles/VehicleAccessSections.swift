//
//  VehicleAccessSections.swift
//  TeslaSync — P4-APPLE P7 · page:vehicles/VehicleAccess (Apple) — The two GlassPanels
//
//  The two `GlassPanel` regions of the web page rebuilt as native HIG cards, each binding through
//  the `@Observable` `VehicleAccessPageModel` (ADR-004 — no networking here) and driving the
//  loading / empty / error / success states for its source (ADR-011 — never a blank region):
//    • `VehicleAccessDriversSection`     (web GlassPanel1) — the authorized-driver table + the
//      destructive remove confirm (web `ConfirmDialog`).
//    • `VehicleAccessInvitationsSection` (web GlassPanel2) — the share-invitation table, the
//      refresh / create actions, + the revoke confirm.
//  Both render the web `DataTable` faithfully via `VehicleAccessTable`. All copy resolves from
//  `Localizable.xcstrings` via `VehicleAccessPageStrings`.
//

import SwiftUI

// MARK: - Drivers section (web GlassPanel1)

struct VehicleAccessDriversSection: View {
    @Bindable var model: VehicleAccessPageModel

    private var driverColumns: [VehicleAccessTableColumn<VehicleAccessDriverRecord>] {
        [
            VehicleAccessTableColumn(id: "name", title: VehicleAccessPageStrings.driversName) { row in
                Text(verbatim: VehicleAccessPageFormat.textOrDash(row.driverName))
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
            },
            VehicleAccessTableColumn(id: "email", title: VehicleAccessPageStrings.driversEmail) { row in
                Text(verbatim: VehicleAccessPageFormat.textOrDash(row.driverEmail))
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            },
            VehicleAccessTableColumn(
                id: "role",
                title: VehicleAccessPageStrings.driversRole,
                width: .fixed(110)
            ) { row in
                VehicleAccessRoleBadge(role: row.role)
            }
        ]
    }

    var body: some View {
        TSFadeIn {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    VehicleAccessSectionHeader(
                        systemImage: "person.2.fill",
                        title: VehicleAccessPageStrings.driversTitle,
                        itemCount: model.drivers.count
                    ) {
                        refreshButton
                    }
                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .confirmationDialog(
            Text(VehicleAccessPageStrings.driversRemoveTitle),
            isPresented: removeDialogPresented,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task { await model.confirmRemoveDriver() }
            } label: {
                Text(VehicleAccessPageStrings.driversRemoveConfirm)
            }
            Button(role: .cancel) {
                model.cancelRemoveDriver()
            } label: {
                Text(String(localized: "translation.common.cancel", defaultValue: "Cancel"))
            }
        } message: {
            Text(VehicleAccessPageStrings.driversRemoveMessage)
        }
    }

    private var refreshButton: some View {
        TSButton(
            variant: .ghost,
            size: .small,
            isLoading: model.isRefreshingDrivers,
            action: { Task { await model.refreshDrivers() } },
            label: { Label(VehicleAccessPageStrings.refresh, systemImage: "arrow.clockwise") }
        )
        .accessibilityLabel(Text(VehicleAccessPageStrings.driversRefresh))
    }

    @ViewBuilder
    private var content: some View {
        switch model.driversState {
        case .loading:
            TSTableSkeleton(rows: 3)
        case let .error(message):
            VehicleAccessErrorView(message: message) {
                Task { await model.retryDrivers() }
            }
        case .empty:
            TSEmptyState(
                title: VehicleAccessPageStrings.driversEmpty,
                systemImage: "person.2"
            )
            .frame(maxWidth: .infinity, minHeight: 160)
        case let .success(drivers):
            VehicleAccessTable(
                rows: drivers,
                columns: driverColumns,
                accessibilityLabel: VehicleAccessPageStrings.driversTitle
            ) { row in
                if row.shareUserID != nil {
                    Button {
                        model.requestRemoveDriver(row)
                    } label: {
                        Image(systemName: "person.fill.badge.minus")
                            .foregroundStyle(Color.TS.statusDanger)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(VehicleAccessPageStrings.driversRemove))
                }
            }
        }
    }

    private var removeDialogPresented: Binding<Bool> {
        Binding(
            get: { model.removeTarget != nil },
            set: { presented in if !presented { model.cancelRemoveDriver() } }
        )
    }
}

// MARK: - Invitations section (web GlassPanel2)

struct VehicleAccessInvitationsSection: View {
    @Bindable var model: VehicleAccessPageModel

    private var invitationColumns: [VehicleAccessTableColumn<VehicleAccessInvitationRecord>] {
        [
            VehicleAccessTableColumn(
                id: "status",
                title: VehicleAccessPageStrings.invitationsStatus,
                width: .fixed(110)
            ) { row in
                VehicleAccessStatusBadge(status: row.status)
            },
            VehicleAccessTableColumn(
                id: "createdBy",
                title: VehicleAccessPageStrings.invitationsCreatedBy
            ) { row in
                Text(verbatim: VehicleAccessPageFormat.textOrDash(row.createdBy))
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            },
            VehicleAccessTableColumn(
                id: "expires",
                title: VehicleAccessPageStrings.invitationsExpires,
                width: .fixed(140)
            ) { row in
                Text(verbatim: VehicleAccessPageFormat.timestamp(row.expiresAt))
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
            },
            VehicleAccessTableColumn(
                id: "link",
                title: VehicleAccessPageStrings.invitationsLink,
                width: .fixed(60)
            ) { row in
                if let url = row.inviteURL, !url.isEmpty {
                    TSCopyButton(value: url)
                        .accessibilityLabel(Text(VehicleAccessPageStrings.invitationsCopyLink))
                } else {
                    Text(verbatim: VehicleAccessPageFormat.emDash)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        ]
    }

    var body: some View {
        TSFadeIn(delay: 0.05) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    VehicleAccessSectionHeader(
                        systemImage: "envelope.fill",
                        title: VehicleAccessPageStrings.invitationsTitle,
                        itemCount: model.invitations.count
                    ) {
                        headerActions
                    }
                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .confirmationDialog(
            Text(VehicleAccessPageStrings.invitationsRevokeTitle),
            isPresented: revokeDialogPresented,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task { await model.confirmRevokeInvitation() }
            } label: {
                Text(VehicleAccessPageStrings.invitationsRevokeConfirm)
            }
            Button(role: .cancel) {
                model.cancelRevokeInvitation()
            } label: {
                Text(String(localized: "translation.common.cancel", defaultValue: "Cancel"))
            }
        } message: {
            Text(VehicleAccessPageStrings.invitationsRevokeMessage)
        }
    }

    private var headerActions: some View {
        HStack(spacing: TSSpacing.sm) {
            TSButton(
                variant: .ghost,
                size: .small,
                isLoading: model.isRefreshingInvitations,
                action: { Task { await model.refreshInvitations() } },
                label: { Label(VehicleAccessPageStrings.refresh, systemImage: "arrow.clockwise") }
            )
            .accessibilityLabel(Text(VehicleAccessPageStrings.invitationsRefresh))

            TSButton(
                variant: .primary,
                size: .small,
                isLoading: model.isCreatingInvitation,
                action: { Task { await model.createInvitation() } },
                label: {
                    Label(VehicleAccessPageStrings.invitationsCreateBtn, systemImage: "person.fill.badge.plus")
                }
            )
            .accessibilityLabel(Text(VehicleAccessPageStrings.invitationsCreate))
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.invitationsState {
        case .loading:
            TSTableSkeleton(rows: 3)
        case let .error(message):
            VehicleAccessErrorView(message: message) {
                Task { await model.retryInvitations() }
            }
        case .empty:
            TSEmptyState(
                title: VehicleAccessPageStrings.invitationsEmpty,
                systemImage: "checkmark.shield"
            )
            .frame(maxWidth: .infinity, minHeight: 160)
        case let .success(invitations):
            VehicleAccessTable(
                rows: invitations,
                columns: invitationColumns,
                accessibilityLabel: VehicleAccessPageStrings.invitationsTitle
            ) { row in
                if row.isPending {
                    Button {
                        model.requestRevokeInvitation(row)
                    } label: {
                        Image(systemName: "xmark.circle")
                            .foregroundStyle(Color.TS.statusDanger)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(VehicleAccessPageStrings.invitationsRevoke))
                }
            }
        }
    }

    private var revokeDialogPresented: Binding<Bool> {
        Binding(
            get: { model.revokeTarget != nil },
            set: { presented in if !presented { model.cancelRevokeInvitation() } }
        )
    }
}
