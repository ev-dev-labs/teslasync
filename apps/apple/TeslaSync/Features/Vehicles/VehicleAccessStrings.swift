//
//  VehicleAccessStrings.swift
//  TeslaSync — P4-APPLE P7 · page:vehicles/VehicleAccess (Apple) — Strings + render-boundary format
//
//  Every visible literal the Vehicle Access page resolves, centralized so the views and the parity
//  audit agree on the web key names (verbatim). The defaults already ship in the platform
//  `Localizable.xcstrings` under the i18next default-namespace prefix `translation.` (the catalog
//  convention every shipped sibling page uses), so each key is referenced as
//  `translation.vehicleAccess.X` while the verbatim web key `vehicleAccess.X` is preserved as the
//  suffix — no catalog edit is needed. The keys are computed (not stored) properties because
//  `LocalizedStringKey` is not `Sendable`; under the app's Swift 6 `complete` strict-concurrency
//  mode a stored `static let` of it would be a non-concurrency-safe global. Computed accessors hold
//  no shared state, so they are safe.
//

import Foundation
import SwiftUI

// MARK: - Parity string keys (web `t(key, default)` — Localizable.xcstrings)

public enum VehicleAccessPageStrings {
    // ── Page chrome ──────────────────────────────────────────────
    public static var title: LocalizedStringKey { "translation.vehicleAccess.title" }
    public static var subtitle: LocalizedStringKey { "translation.vehicleAccess.subtitle" }
    public static var refresh: LocalizedStringKey { "translation.vehicleAccess.refresh" }

    // ── Drivers section ──────────────────────────────────────────
    public static var driversTitle: LocalizedStringKey { "translation.vehicleAccess.drivers.title" }
    public static var driversName: LocalizedStringKey { "translation.vehicleAccess.drivers.name" }
    public static var driversEmail: LocalizedStringKey { "translation.vehicleAccess.drivers.email" }
    public static var driversRole: LocalizedStringKey { "translation.vehicleAccess.drivers.role" }
    public static var driversRemove: LocalizedStringKey { "translation.vehicleAccess.drivers.remove" }
    public static var driversEmpty: LocalizedStringKey { "translation.vehicleAccess.drivers.empty" }
    public static var driversRefresh: LocalizedStringKey { "translation.vehicleAccess.drivers.refresh" }
    public static var driversRemoveTitle: LocalizedStringKey { "translation.vehicleAccess.drivers.removeTitle" }
    public static var driversRemoveMessage: LocalizedStringKey { "translation.vehicleAccess.drivers.removeMessage" }
    public static var driversRemoveConfirm: LocalizedStringKey { "translation.vehicleAccess.drivers.removeConfirm" }

    // ── Invitations section ──────────────────────────────────────
    public static var invitationsTitle: LocalizedStringKey { "translation.vehicleAccess.invitations.title" }
    public static var invitationsStatus: LocalizedStringKey { "translation.vehicleAccess.invitations.status" }
    public static var invitationsCreatedBy: LocalizedStringKey { "translation.vehicleAccess.invitations.createdBy" }
    public static var invitationsExpires: LocalizedStringKey { "translation.vehicleAccess.invitations.expires" }
    public static var invitationsLink: LocalizedStringKey { "translation.vehicleAccess.invitations.link" }
    public static var invitationsCopyLink: LocalizedStringKey { "translation.vehicleAccess.invitations.copyLink" }
    public static var invitationsCreate: LocalizedStringKey { "translation.vehicleAccess.invitations.create" }
    public static var invitationsCreateBtn: LocalizedStringKey { "translation.vehicleAccess.invitations.createBtn" }
    public static var invitationsEmpty: LocalizedStringKey { "translation.vehicleAccess.invitations.empty" }
    public static var invitationsRefresh: LocalizedStringKey { "translation.vehicleAccess.invitations.refresh" }
    public static var invitationsRevoke: LocalizedStringKey { "translation.vehicleAccess.invitations.revoke" }
    public static var invitationsRevokeTitle: LocalizedStringKey {
        "translation.vehicleAccess.invitations.revokeTitle"
    }

    public static var invitationsRevokeMessage: LocalizedStringKey {
        "translation.vehicleAccess.invitations.revokeMessage"
    }

    public static var invitationsRevokeConfirm: LocalizedStringKey {
        "translation.vehicleAccess.invitations.revokeConfirm"
    }

    /// Web breadcrumb fallback `Vehicle #{id}` — a verbatim, non-localized composition exactly as
    /// the web hardcodes it (`vehicle?.display_name ?? \`Vehicle #${vehicleId}\``).
    public static func vehicleFallback(id: Int64) -> String {
        "Vehicle #\(id)"
    }

    /// The 27 web key names (verbatim), for the parity coverage audit.
    public static let rawKeys: [String] = [
        "vehicleAccess.drivers.email",
        "vehicleAccess.drivers.empty",
        "vehicleAccess.drivers.name",
        "vehicleAccess.drivers.refresh",
        "vehicleAccess.drivers.remove",
        "vehicleAccess.drivers.removeConfirm",
        "vehicleAccess.drivers.removeMessage",
        "vehicleAccess.drivers.removeTitle",
        "vehicleAccess.drivers.role",
        "vehicleAccess.drivers.title",
        "vehicleAccess.invitations.copyLink",
        "vehicleAccess.invitations.create",
        "vehicleAccess.invitations.createBtn",
        "vehicleAccess.invitations.createdBy",
        "vehicleAccess.invitations.empty",
        "vehicleAccess.invitations.expires",
        "vehicleAccess.invitations.link",
        "vehicleAccess.invitations.refresh",
        "vehicleAccess.invitations.revoke",
        "vehicleAccess.invitations.revokeConfirm",
        "vehicleAccess.invitations.revokeMessage",
        "vehicleAccess.invitations.revokeTitle",
        "vehicleAccess.invitations.status",
        "vehicleAccess.invitations.title",
        "vehicleAccess.refresh",
        "vehicleAccess.subtitle",
        "vehicleAccess.title"
    ]
}

// MARK: - Render-boundary formatters

/// The render-boundary formatters for the Vehicle Access page. Pure `static func`s (no stored
/// formatter globals) so they are concurrency-safe under Swift 6 `complete` mode.
public enum VehicleAccessPageFormat {
    /// The universal unrenderable sentinel (web `'—'`).
    public static let emDash = "—"

    /// Web `TimeStamp value={row.expires_at}` (absolute): locale "Apr 4, 2:30 AM"; `nil` → `'—'`.
    public static func timestamp(_ date: Date?) -> String {
        guard let date else { return emDash }
        return date.formatted(.dateTime.month(.abbreviated).day().hour().minute())
    }

    /// A text value or the em-dash sentinel when missing (web `row.x ?? '—'`).
    public static func textOrDash(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return emDash }
        return value
    }
}

// MARK: - Invitation status badge (web `StatusBadge` mapping)

/// The web maps an invitation's status onto a vehicle-status dot for the `StatusBadge`
/// (`status === 'pending' ? 'online' : status === 'revoked' ? 'offline' : 'asleep'`), which renders
/// that mapped word (capitalized) with the corresponding dot color. This reproduces that mapping:
/// the displayed word + the tone of the matching vehicle FSM badge (online → success/green,
/// offline → danger/red, asleep → neutral/grey).
public enum VehicleAccessInvitationStatus: Sendable {
    case online
    case offline
    case asleep

    public init(status: String) {
        switch status.lowercased() {
        case "pending": self = .online
        case "revoked": self = .offline
        default: self = .asleep
        }
    }

    /// The capitalized vehicle-status word the web `StatusBadge` renders for the mapped state.
    public var label: String {
        switch self {
        case .online: "Online"
        case .offline: "Offline"
        case .asleep: "Asleep"
        }
    }

    /// The semantic tone of the mapped vehicle FSM dot.
    public var tone: TSTone {
        switch self {
        case .online: .success
        case .offline: .danger
        case .asleep: .neutral
        }
    }
}
