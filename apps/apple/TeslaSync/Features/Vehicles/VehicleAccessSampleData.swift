//
//  VehicleAccessSampleData.swift
//  TeslaSync — P4-APPLE P7 · page:vehicles/VehicleAccess (Apple) — Sample seams
//
//  In-memory `VehicleAccessPageDataSource` doubles for the default screen, SwiftUI previews, and
//  the data-state gate evidence. When the generated KMP client lands (P1/S2-S3) only these bodies
//  change — the model, the sections, and the view stay untouched (ADR-004). An `actor` backs the
//  sample so the mutating sample (create / remove / revoke) is concurrency-safe under Swift 6
//  `complete` mode while the page exercises the full CRUD surface against live-feeling fixtures.
//

import Foundation

// MARK: - Sample seam (one representative vehicle with a live-feeling, mutable access list)

/// A populated, mutable access list: three drivers (one non-removable owner) and two invitations
/// (one pending + copyable, one revoked). Drives the default screen + the success-state evidence,
/// and honors the create / remove / revoke / refresh mutations so the page's full behaviour is
/// exercised without a backend.
public struct SampleVehicleAccessPageDataSource: VehicleAccessPageDataSource {
    private let store = Store()

    public init() {}

    public func useVehicle(vehicleID: Int64) async throws -> VehicleAccessVehicle? {
        VehicleAccessVehicle(id: vehicleID, displayName: "Garage Rocket")
    }

    public func useVehicleDrivers(vehicleID: Int64) async throws -> [VehicleAccessDriverRecord] {
        await store.drivers()
    }

    public func useVehicleInvitations(vehicleID: Int64) async throws -> [VehicleAccessInvitationRecord] {
        await store.invitations()
    }

    public func useRefreshVehicleDrivers(vehicleID: Int64) async throws -> [VehicleAccessDriverRecord] {
        await store.drivers()
    }

    public func useRefreshVehicleInvitations(vehicleID: Int64) async throws -> [VehicleAccessInvitationRecord] {
        await store.invitations()
    }

    public func useRemoveVehicleDriver(vehicleID: Int64, shareUserID: Int64) async throws {
        await store.removeDriver(shareUserID: shareUserID)
    }

    public func useCreateVehicleInvitation(vehicleID: Int64) async throws -> VehicleAccessInvitationRecord {
        await store.createInvitation()
    }

    public func useRevokeVehicleInvitation(vehicleID: Int64, invitationID: String) async throws {
        await store.revokeInvitation(invitationID: invitationID)
    }

    /// Mutable fixture state, isolated to an actor so the sample CRUD is data-race-free.
    private actor Store {
        private var driverRows: [VehicleAccessDriverRecord] = [
            VehicleAccessDriverRecord(
                id: 1, shareUserID: nil, driverName: "Ada Lovelace",
                driverEmail: "ada@teslasync.io", role: "Owner"
            ),
            VehicleAccessDriverRecord(
                id: 2, shareUserID: 5001, driverName: "Grace Hopper",
                driverEmail: "grace@teslasync.io", role: "Driver"
            ),
            VehicleAccessDriverRecord(
                id: 3, shareUserID: 5002, driverName: "Alan Turing",
                driverEmail: "alan@teslasync.io", role: "Driver"
            )
        ]

        private var invitationRows: [VehicleAccessInvitationRecord] = [
            VehicleAccessInvitationRecord(
                id: 10, invitationID: "inv-9f3a",
                inviteURL: "https://tesla.com/_ak/teslasync.io/inv-9f3a",
                status: "pending",
                expiresAt: Date(timeIntervalSinceNow: 3 * 86_400),
                createdBy: "ada@teslasync.io"
            ),
            VehicleAccessInvitationRecord(
                id: 11, invitationID: "inv-7b21",
                inviteURL: nil,
                status: "revoked",
                expiresAt: Date(timeIntervalSinceNow: -2 * 86_400),
                createdBy: "ada@teslasync.io"
            )
        ]

        private var nextInvitationID: Int64 = 12

        func drivers() -> [VehicleAccessDriverRecord] { driverRows }
        func invitations() -> [VehicleAccessInvitationRecord] { invitationRows }

        func removeDriver(shareUserID: Int64) {
            driverRows.removeAll { $0.shareUserID == shareUserID }
        }

        func revokeInvitation(invitationID: String) {
            invitationRows = invitationRows.map { row in
                guard row.invitationID == invitationID else { return row }
                return VehicleAccessInvitationRecord(
                    id: row.id, invitationID: row.invitationID, inviteURL: nil,
                    status: "revoked", expiresAt: row.expiresAt, createdBy: row.createdBy
                )
            }
        }

        func createInvitation() -> VehicleAccessInvitationRecord {
            let id = nextInvitationID
            nextInvitationID += 1
            let invite = VehicleAccessInvitationRecord(
                id: id,
                invitationID: "inv-\(String(format: "%04x", id))",
                inviteURL: "https://tesla.com/_ak/teslasync.io/inv-\(String(format: "%04x", id))",
                status: "pending",
                expiresAt: Date(timeIntervalSinceNow: 7 * 86_400),
                createdBy: "ada@teslasync.io"
            )
            invitationRows.insert(invite, at: 0)
            return invite
        }
    }
}

// MARK: - Empty seam (both lists resolve empty → the empty data state)

/// Both list fetches resolve empty — exercises the page's empty data state for drivers + invitations.
public struct EmptyVehicleAccessPageDataSource: VehicleAccessPageDataSource {
    public init() {}

    public func useVehicle(vehicleID: Int64) async throws -> VehicleAccessVehicle? {
        VehicleAccessVehicle(id: vehicleID, displayName: nil)
    }

    public func useVehicleDrivers(vehicleID: Int64) async throws -> [VehicleAccessDriverRecord] { [] }
    public func useVehicleInvitations(vehicleID: Int64) async throws -> [VehicleAccessInvitationRecord] { [] }
    public func useRefreshVehicleDrivers(vehicleID: Int64) async throws -> [VehicleAccessDriverRecord] { [] }
    public func useRefreshVehicleInvitations(vehicleID: Int64) async throws -> [VehicleAccessInvitationRecord] { [] }
    public func useRemoveVehicleDriver(vehicleID: Int64, shareUserID: Int64) async throws {}

    public func useCreateVehicleInvitation(vehicleID: Int64) async throws -> VehicleAccessInvitationRecord {
        VehicleAccessInvitationRecord(
            id: 1, invitationID: "inv-0001", inviteURL: nil,
            status: "pending", expiresAt: nil, createdBy: nil
        )
    }

    public func useRevokeVehicleInvitation(vehicleID: Int64, invitationID: String) async throws {}
}

// MARK: - Failing seam (both list fetches throw → the error data state)

/// Both list fetches fail — exercises the page's error data state + Retry for drivers + invitations.
public struct FailingVehicleAccessPageDataSource: VehicleAccessPageDataSource {
    public init() {}

    public func useVehicle(vehicleID: Int64) async throws -> VehicleAccessVehicle? {
        VehicleAccessVehicle(id: vehicleID, displayName: nil)
    }

    public func useVehicleDrivers(vehicleID: Int64) async throws -> [VehicleAccessDriverRecord] {
        throw VehicleAccessPageError.driversUnavailable
    }

    public func useVehicleInvitations(vehicleID: Int64) async throws -> [VehicleAccessInvitationRecord] {
        throw VehicleAccessPageError.invitationsUnavailable
    }

    public func useRefreshVehicleDrivers(vehicleID: Int64) async throws -> [VehicleAccessDriverRecord] {
        throw VehicleAccessPageError.driversUnavailable
    }

    public func useRefreshVehicleInvitations(vehicleID: Int64) async throws -> [VehicleAccessInvitationRecord] {
        throw VehicleAccessPageError.invitationsUnavailable
    }

    public func useRemoveVehicleDriver(vehicleID: Int64, shareUserID: Int64) async throws {
        throw VehicleAccessPageError.mutationRejected
    }

    public func useCreateVehicleInvitation(vehicleID: Int64) async throws -> VehicleAccessInvitationRecord {
        throw VehicleAccessPageError.mutationRejected
    }

    public func useRevokeVehicleInvitation(vehicleID: Int64, invitationID: String) async throws {
        throw VehicleAccessPageError.mutationRejected
    }
}
