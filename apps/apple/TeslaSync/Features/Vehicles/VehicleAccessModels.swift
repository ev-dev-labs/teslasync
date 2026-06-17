//
//  VehicleAccessModels.swift
//  TeslaSync — P4-APPLE P7 · page:vehicles/VehicleAccess (Apple) — Value types + seam
//
//  Native SwiftUI / Apple HIG parity of `web/src/features/vehicles/pages/VehicleAccessPage.tsx`
//  (route `/vehicles/:id/access`). The page manages who can drive a vehicle and the outstanding
//  share invitations behind two independent data sources — the drivers list and the invitations
//  list — each with its own loading / empty / error / success state, plus the vehicle lookup that
//  labels the screen (web breadcrumb). Networking lives behind the `VehicleAccessPageDataSource`
//  seam (ADR-004 — no networking in the view); each method keeps its web TanStack hook name so the
//  call sites in `VehicleAccessPageModel` read like the React page.
//
//  This page carries NO SI measurements (drivers + invitations are textual / temporal), so the only
//  render-boundary projection is the locale date for an invitation's expiry (web `TimeStamp`).
//
//  Types are `VehicleAccess…Record` / `VehicleAccessPage…`-prefixed so this parity unit composes in
//  the single `TeslaSync` module alongside the sibling `VehicleAccess*` dashboard-widget surface
//  without symbol collision (the repo's established dedupe convention).
//

import Foundation

// MARK: - Vehicle (web `useVehicle` → `GET /vehicles/{id}` → `Vehicle`)

/// The vehicle this page scopes to. Only the display name is used (web breadcrumb
/// `vehicle?.display_name ?? "Vehicle #{id}"`); the rest of the vehicle shape is irrelevant here.
public struct VehicleAccessVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String?

    public init(id: Int64, displayName: String?) {
        self.id = id
        self.displayName = displayName
    }
}

// MARK: - Driver (web `useVehicleDrivers` → `GET /vehicles/{vehicleId}/drivers` → `VehicleDriver`)

/// One authorized driver (web `VehicleDriver`). `shareUserID` is `nil` for the owner / a driver that
/// cannot be removed (web `share_user_id: number | null`); the remove action only appears when it is
/// present. `driverName` / `driverEmail` / `role` are optional, surfaced as the em-dash sentinel
/// when missing (web `'—'`).
public struct VehicleAccessDriverRecord: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let shareUserID: Int64?
    public let driverName: String?
    public let driverEmail: String?
    public let role: String?

    public init(
        id: Int64,
        shareUserID: Int64?,
        driverName: String?,
        driverEmail: String?,
        role: String?
    ) {
        self.id = id
        self.shareUserID = shareUserID
        self.driverName = driverName
        self.driverEmail = driverEmail
        self.role = role
    }
}

// MARK: - Invitation (web `useVehicleInvitations` → `GET /vehicles/{vehicleId}/invitations`)

/// One share invitation (web `VehicleInvitation`). `inviteURL` is `nil` once consumed / for a
/// server that withholds the link (web `invite_url: string | null`) — the copy affordance is then
/// replaced by the em-dash sentinel. `status` drives the status badge + whether the revoke action
/// is offered (web `status === 'pending'`); `expiresAt` is `nil` for a non-expiring invite (web
/// `expires_at: string | null`, rendered through `TimeStamp` → `'—'`).
public struct VehicleAccessInvitationRecord: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let invitationID: String
    public let inviteURL: String?
    public let status: String
    public let expiresAt: Date?
    public let createdBy: String?

    public init(
        id: Int64,
        invitationID: String,
        inviteURL: String?,
        status: String,
        expiresAt: Date?,
        createdBy: String?
    ) {
        self.id = id
        self.invitationID = invitationID
        self.inviteURL = inviteURL
        self.status = status
        self.expiresAt = expiresAt
        self.createdBy = createdBy
    }

    /// Whether the revoke action is offered (web `row.status === 'pending'`).
    public var isPending: Bool {
        status.lowercased() == "pending"
    }
}

// MARK: - List state (web `isLoading ? … : list.length ? DataTable : EmptyState`)

/// The four data states each list source (drivers, invitations) renders. `.success` carries the
/// resolved rows; a `.success([])` is projected to `.empty` by the model so the view binds one
/// source of truth. `.error` is the retryable fetch failure (ADR-011 — never a blank region);
/// `.loading` is the initial fetch / a redacted skeleton. Generic so the drivers + invitations
/// sources share one state machine (DRY).
public enum VehicleAccessListState<Item: Sendable>: Sendable {
    case loading
    case empty
    case error(String)
    case success([Item])

    /// The resolved rows when loaded, else an empty array (safe for the view to iterate).
    public var items: [Item] {
        if case let .success(rows) = self { return rows }
        return []
    }
}

// MARK: - Data source seam (web hooks kept by name at the Swift call site)

/// The single async data seam for `VehicleAccessPage`, mirroring the page's eight web hooks. The
/// production implementation binds the shared KMP repositories / use-cases (ADR-004); previews and
/// tests inject doubles to drive the loading / empty / error states. A thrown error is the
/// retryable failure path; an empty array is the empty data state.
public protocol VehicleAccessPageDataSource: Sendable {
    /// `useVehicle(id)` → `GET /vehicles/{id}`. Labels the screen (web breadcrumb). A `nil` result
    /// falls back to the `Vehicle #{id}` sentinel.
    func useVehicle(vehicleID: Int64) async throws -> VehicleAccessVehicle?

    /// `useVehicleDrivers(vehicleId)` → `GET /vehicles/{vehicleId}/drivers`.
    func useVehicleDrivers(vehicleID: Int64) async throws -> [VehicleAccessDriverRecord]

    /// `useVehicleInvitations(vehicleId)` → `GET /vehicles/{vehicleId}/invitations`.
    func useVehicleInvitations(vehicleID: Int64) async throws -> [VehicleAccessInvitationRecord]

    /// `useRefreshVehicleDrivers` → `POST /vehicles/{vehicleId}/drivers/refresh` (re-sync from Tesla).
    func useRefreshVehicleDrivers(vehicleID: Int64) async throws -> [VehicleAccessDriverRecord]

    /// `useRefreshVehicleInvitations` → `POST /vehicles/{vehicleId}/invitations/refresh`.
    func useRefreshVehicleInvitations(vehicleID: Int64) async throws -> [VehicleAccessInvitationRecord]

    /// `useRemoveVehicleDriver` → `DELETE /vehicles/{vehicleId}/drivers` (body `share_user_id`).
    func useRemoveVehicleDriver(vehicleID: Int64, shareUserID: Int64) async throws

    /// `useCreateVehicleInvitation` → `POST /vehicles/{vehicleId}/invitations`.
    func useCreateVehicleInvitation(vehicleID: Int64) async throws -> VehicleAccessInvitationRecord

    /// `useRevokeVehicleInvitation` → `POST /vehicles/{vehicleId}/invitations/{invitationId}/revoke`.
    func useRevokeVehicleInvitation(vehicleID: Int64, invitationID: String) async throws
}

// MARK: - Errors

/// Seam errors surfaced to the model and projected into the localized data states / action banners.
public enum VehicleAccessPageError: Error, LocalizedError {
    case driversUnavailable
    case invitationsUnavailable
    case mutationRejected

    public var errorDescription: String? {
        switch self {
        case .driversUnavailable:
            return String(
                localized: "translation.vehicleAccess.drivers.empty",
                defaultValue: "No drivers found. Refresh to sync from Tesla."
            )
        case .invitationsUnavailable:
            return String(
                localized: "translation.vehicleAccess.invitations.empty",
                defaultValue: "No invitations yet. Create one to share vehicle access."
            )
        case .mutationRejected:
            return String(
                localized: "translation.common.error",
                defaultValue: "Something went wrong"
            )
        }
    }
}
