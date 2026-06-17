//
//  VehicleAccessPageModel.swift
//  TeslaSync — P4-APPLE P7 · page:vehicles/VehicleAccess (Apple) — View model
//
//  The `@MainActor @Observable` state holder for `VehicleAccessPage` (ADR-004 — no networking in
//  the view). It consumes the `VehicleAccessPageDataSource` seam (the eight web hooks kept by name)
//  and projects the two list fetches into independent loading / empty / error / success states the
//  web page renders, resolves the vehicle label (web breadcrumb), and drives the five mutations:
//  refresh-drivers, refresh-invitations, create-invitation, remove-driver, revoke-invitation —
//  the last two gated behind a destructive confirmation exactly like the web `ConfirmDialog`s.
//  No view logic lives here.
//

import Observation
import SwiftUI

@MainActor
@Observable
public final class VehicleAccessPageModel {
    /// The vehicle id this page scopes to (web route `:id`).
    public let vehicleID: Int64

    @ObservationIgnored private let dataSource: any VehicleAccessPageDataSource

    /// The drivers list source state (web `useVehicleDrivers`).
    public private(set) var driversState: VehicleAccessListState<VehicleAccessDriverRecord> = .loading
    /// The invitations list source state (web `useVehicleInvitations`).
    public private(set) var invitationsState: VehicleAccessListState<VehicleAccessInvitationRecord> = .loading

    /// The resolved vehicle name (web `useVehicle` → breadcrumb). `nil` until resolved.
    public private(set) var vehicleName: String?

    /// In-flight flags for the section actions (web `mutation.isPending`).
    public private(set) var isRefreshingDrivers = false
    public private(set) var isRefreshingInvitations = false
    public private(set) var isCreatingInvitation = false

    /// The driver pending removal — non-nil presents the destructive confirm (web `removeTarget`).
    public var removeTarget: VehicleAccessDriverRecord?
    /// The invitation pending revocation — non-nil presents the confirm (web `revokeTarget`).
    public var revokeTarget: VehicleAccessInvitationRecord?

    /// A transient mutation failure surfaced as an alert (web `toast.error`). `nil` when clear.
    public var actionError: String?

    public init(
        vehicleID: Int64,
        dataSource: any VehicleAccessPageDataSource = SampleVehicleAccessPageDataSource()
    ) {
        self.vehicleID = vehicleID
        self.dataSource = dataSource
    }

    // MARK: Derived

    /// Web breadcrumb label: `vehicle?.display_name ?? "Vehicle #{id}"`.
    public var displayName: String {
        if let vehicleName, !vehicleName.isEmpty { return vehicleName }
        return VehicleAccessPageStrings.vehicleFallback(id: vehicleID)
    }

    /// Resolved drivers (safe to iterate; empty unless `.success`).
    public var drivers: [VehicleAccessDriverRecord] { driversState.items }
    /// Resolved invitations (safe to iterate; empty unless `.success`).
    public var invitations: [VehicleAccessInvitationRecord] { invitationsState.items }

    // MARK: Loading (web `useVehicle` + `useVehicleDrivers` + `useVehicleInvitations`)

    /// Loads the vehicle label and both list sources. Each list projects into
    /// loading → empty | error | success independently.
    public func load() async {
        driversState = .loading
        invitationsState = .loading
        await loadVehicle()
        await reloadDrivers()
        await reloadInvitations()
    }

    /// Pull-to-refresh: re-resolves the vehicle label and both lists.
    public func refresh() async {
        await loadVehicle()
        await reloadDrivers()
        await reloadInvitations()
    }

    private func loadVehicle() async {
        vehicleName = (try? await dataSource.useVehicle(vehicleID: vehicleID))??.displayName
    }

    /// Retry just the drivers source (web section refetch on the error-state retry).
    public func retryDrivers() async {
        driversState = .loading
        await reloadDrivers()
    }

    /// Retry just the invitations source (web section refetch on the error-state retry).
    public func retryInvitations() async {
        invitationsState = .loading
        await reloadInvitations()
    }

    private func reloadDrivers() async {
        do {
            let rows = try await dataSource.useVehicleDrivers(vehicleID: vehicleID)
            driversState = project(rows)
        } catch {
            driversState = .error(error.localizedDescription)
        }
    }

    private func reloadInvitations() async {
        do {
            let rows = try await dataSource.useVehicleInvitations(vehicleID: vehicleID)
            invitationsState = project(rows)
        } catch {
            invitationsState = .error(error.localizedDescription)
        }
    }

    private func project<Item: Sendable>(_ rows: [Item]) -> VehicleAccessListState<Item> {
        rows.isEmpty ? .empty : .success(rows)
    }

    // MARK: Section actions (web mutations)

    /// Web `refreshDrivers.mutate(vehicleId)` → re-sync from Tesla, then surface the fresh list.
    public func refreshDrivers() async {
        guard !isRefreshingDrivers else { return }
        isRefreshingDrivers = true
        defer { isRefreshingDrivers = false }
        do {
            let rows = try await dataSource.useRefreshVehicleDrivers(vehicleID: vehicleID)
            driversState = project(rows)
        } catch {
            actionError = error.localizedDescription
        }
    }

    /// Web `refreshInvitations.mutate(vehicleId)` → re-sync, then surface the fresh list.
    public func refreshInvitations() async {
        guard !isRefreshingInvitations else { return }
        isRefreshingInvitations = true
        defer { isRefreshingInvitations = false }
        do {
            let rows = try await dataSource.useRefreshVehicleInvitations(vehicleID: vehicleID)
            invitationsState = project(rows)
        } catch {
            actionError = error.localizedDescription
        }
    }

    /// Web `createInvitation.mutate(vehicleId)` → create + invalidate (refetch) the invitations list.
    public func createInvitation() async {
        guard !isCreatingInvitation else { return }
        isCreatingInvitation = true
        defer { isCreatingInvitation = false }
        do {
            _ = try await dataSource.useCreateVehicleInvitation(vehicleID: vehicleID)
            await reloadInvitations()
        } catch {
            actionError = error.localizedDescription
        }
    }

    // MARK: Remove-driver confirm flow (web `ConfirmDialog` + `removeDriver.mutate`)

    /// Requests the destructive confirm for a driver (web `setRemoveTarget(row)`).
    public func requestRemoveDriver(_ driver: VehicleAccessDriverRecord) {
        removeTarget = driver
    }

    /// Dismisses the confirm without removing (web `onCancel`).
    public func cancelRemoveDriver() {
        removeTarget = nil
    }

    /// Confirms removal (web `handleRemoveDriver` → `removeDriver.mutate({ vehicleId, shareUserId })`,
    /// clearing the target `onSettled`). No-ops when the driver has no `share_user_id`.
    public func confirmRemoveDriver() async {
        guard let target = removeTarget, let shareUserID = target.shareUserID else {
            removeTarget = nil
            return
        }
        do {
            try await dataSource.useRemoveVehicleDriver(vehicleID: vehicleID, shareUserID: shareUserID)
            await reloadDrivers()
        } catch {
            actionError = error.localizedDescription
        }
        removeTarget = nil
    }

    // MARK: Revoke-invitation confirm flow (web `ConfirmDialog` + `revokeInvitation.mutate`)

    /// Requests the confirm for an invitation (web `setRevokeTarget(row)`).
    public func requestRevokeInvitation(_ invitation: VehicleAccessInvitationRecord) {
        revokeTarget = invitation
    }

    /// Dismisses the confirm without revoking (web `onCancel`).
    public func cancelRevokeInvitation() {
        revokeTarget = nil
    }

    /// Confirms revocation (web `handleRevokeInvitation` →
    /// `revokeInvitation.mutate({ vehicleId, invitationId })`, clearing the target `onSettled`).
    public func confirmRevokeInvitation() async {
        guard let target = revokeTarget else { return }
        do {
            try await dataSource.useRevokeVehicleInvitation(
                vehicleID: vehicleID,
                invitationID: target.invitationID
            )
            await reloadInvitations()
        } catch {
            actionError = error.localizedDescription
        }
        revokeTarget = nil
    }
}
