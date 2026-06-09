//
//  VehicleAccessWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0106 · VehicleAccessWidget (Apple)
//
//  Pure (Foundation-only) projection: the cached drivers / invitations / mobile-enabled DTOs → the
//  display rows + badges, reproducing the web source's pipeline VERBATIM so the native surface shows
//  the exact same labels, values, and badge tones as
//  features/dashboard/widgets/VehicleAccessWidget.tsx.
//
//  This file is deliberately free of SwiftUI so the projection + date formatting can be compiled and
//  executed on a plain host and pinned by unit tests.
//

import Foundation

// MARK: - Badge tone (web `Badge` variant)

/// The four badge tones this surface uses, mirroring the web `Badge` variants the widget passes
/// (`success` / `neutral` / `warning` / `danger`). The web `WidgetDetailCard` maps the entry
/// variant `error` → `danger`; we collapse to `danger` directly. The SwiftUI tone → color mapping
/// lives in the Content file so this stays renderer-free + testable.
public enum VehicleAccessBadgeTone: Sendable, Equatable {
    case success
    case neutral
    case warning
    case danger
}

// MARK: - Badge (web `<Badge variant size="sm">`)

/// A localized status chip: a tone plus the key/fallback for its label. The label resolves through
/// the P1/S10 facade so no English literal lives in the projection.
public struct VehicleAccessBadge: Sendable, Equatable {
    public let labelKey: String
    public let labelFallback: String
    public let tone: VehicleAccessBadgeTone

    public init(labelKey: String, labelFallback: String, tone: VehicleAccessBadgeTone) {
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.tone = tone
    }

    /// The resolved (localized) label for display + accessibility.
    public var label: String {
        VehicleAccessStrings.string(labelKey, labelFallback)
    }
}

// MARK: - Projected detail row (web `DetailEntry` / `WidgetDetailCard` row)

/// One projected row: a dynamic label (driver name/email or invitation creator), a value string
/// (the short-formatted timestamp), and a status badge. Mirrors the web `DetailEntry`
/// (`{ label, value, badge }`). Unlike the energy-site card, the label here is live data — already
/// resolved to the em-dash sentinel when absent — not a localization key.
public struct VehicleAccessDetailEntry: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let value: String
    public let badge: VehicleAccessBadge

    public init(id: String, label: String, value: String, badge: VehicleAccessBadge) {
        self.id = id
        self.label = label
        self.value = value
        self.badge = badge
    }
}

// MARK: - Projection

/// The fully-projected widget content: the driver rows, the invitation rows, the driver count + the
/// raw mobile-access flag (both consumed by the compact layout), and the resolved mobile-access
/// badge (consumed by the standard layout). `hasAnyData` reproduces the web render predicate
/// `safeDrivers.length > 0 || safeInvitations.length > 0 || mobileEnabled !== null`.
public struct VehicleAccessProjection: Equatable, Sendable {
    public let driverEntries: [VehicleAccessDetailEntry]
    public let invitationEntries: [VehicleAccessDetailEntry]
    public let driverCount: Int
    public let mobileEnabled: Bool?
    public let mobileBadge: VehicleAccessBadge
    public let hasAnyData: Bool

    public init(
        driverEntries: [VehicleAccessDetailEntry],
        invitationEntries: [VehicleAccessDetailEntry],
        driverCount: Int,
        mobileEnabled: Bool?,
        mobileBadge: VehicleAccessBadge,
        hasAnyData: Bool
    ) {
        self.driverEntries = driverEntries
        self.invitationEntries = invitationEntries
        self.driverCount = driverCount
        self.mobileEnabled = mobileEnabled
        self.mobileBadge = mobileBadge
        self.hasAnyData = hasAnyData
    }

    /// The pre-data projection (no drivers / invitations / mobile flag). The model exposes this as
    /// its initial value so the view never deals with an optional projection.
    public static let empty = VehicleAccessProjection(
        driverEntries: [],
        invitationEntries: [],
        driverCount: 0,
        mobileEnabled: nil,
        mobileBadge: VehicleAccessProjector.mobileBadge(for: nil),
        hasAnyData: false
    )
}

// MARK: - Formatting (ported from web lib/dateFormat.ts)

/// Date formatting ported from the web widget's `formatDateShort`. Pure so the value pipeline is
/// pinned by unit tests without rendering.
public enum VehicleAccessFormat {
    /// The em-dash sentinel the web widget renders for an absent label/value (`'—'`).
    public static let emptyDash = "—"

    /// `formatDateShort(iso)` from dateFormat.ts: a null/blank/invalid input collapses to the
    /// em-dash; otherwise the date renders as `toLocaleDateString(locale, { month: 'short', day:
    /// 'numeric' })` (e.g. "Jun 9"). The `timeZone` is injectable so the projection can be pinned
    /// deterministically in tests (the web `new Date(iso)` uses the device's local zone, the
    /// default here).
    public static func dateShort(
        _ iso: String?,
        localeIdentifier: String = "en_US",
        timeZone: TimeZone = .current
    ) -> String {
        guard let iso, let date = parseISO(iso) else { return emptyDash }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.timeZone = timeZone
        // Locale-aware month/day ordering, matching Intl's { month: 'short', day: 'numeric' }.
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        return formatter.string(from: date)
    }

    /// Lenient ISO-8601 parse mirroring the web `new Date(iso)`: RFC-3339 with or without fractional
    /// seconds, falling back to a date-only `yyyy-MM-dd`. Returns `nil` for anything unparseable
    /// (the web `isNaN(d.getTime())` branch).
    static func parseISO(_ raw: String) -> Date? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let withFractional = ISO8601DateFormatter()
        withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFractional.date(from: trimmed) { return date }

        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let date = plain.date(from: trimmed) { return date }

        let dateOnly = DateFormatter()
        dateOnly.locale = Locale(identifier: "en_US_POSIX")
        dateOnly.timeZone = TimeZone(identifier: "UTC")
        dateOnly.dateFormat = "yyyy-MM-dd"
        return dateOnly.date(from: trimmed)
    }
}

// MARK: - Projection

/// Pure projector: the cached driver / invitation / mobile DTOs → a `VehicleAccessProjection`. Every
/// label, value, and badge tone is derived with the exact same logic as the web widget's `useMemo`
/// blocks.
public enum VehicleAccessProjector {
    public static func project(
        drivers: [VehicleAccessDriverDTO],
        invitations: [VehicleAccessInvitationDTO],
        mobileEnabled: Bool?,
        localeIdentifier: String = "en_US",
        timeZone: TimeZone = .current
    ) -> VehicleAccessProjection {
        // Drivers — web: label = name ?? email ?? '—'; value = formatDateShort(fetched_at);
        // badge = role === 'owner' ? (Owner, success) : (Driver, neutral).
        let driverEntries = drivers.map { driver -> VehicleAccessDetailEntry in
            let label = driver.driverName ?? driver.driverEmail ?? VehicleAccessFormat.emptyDash
            let isOwner = driver.role == "owner"
            let badge = VehicleAccessBadge(
                labelKey: isOwner ? "widget.vehicleAccessOwner" : "widget.vehicleAccessDriver",
                labelFallback: isOwner ? "Owner" : "Driver",
                tone: isOwner ? .success : .neutral
            )
            return VehicleAccessDetailEntry(
                id: "driver-\(driver.id)",
                label: label,
                value: VehicleAccessFormat.dateShort(
                    driver.fetchedAt,
                    localeIdentifier: localeIdentifier,
                    timeZone: timeZone
                ),
                badge: badge
            )
        }

        // Invitations — web: label = created_by ?? '—'; value = formatDateShort(created_at);
        // badge = pending → (Pending, warning), accepted → (Accepted, success), else → (Expired,
        // error → danger).
        let invitationEntries = invitations.map { invitation -> VehicleAccessDetailEntry in
            let badge = invitationBadge(status: invitation.status)
            return VehicleAccessDetailEntry(
                id: "invitation-\(invitation.id)",
                label: invitation.createdBy ?? VehicleAccessFormat.emptyDash,
                value: VehicleAccessFormat.dateShort(
                    invitation.createdAt,
                    localeIdentifier: localeIdentifier,
                    timeZone: timeZone
                ),
                badge: badge
            )
        }

        let hasAnyData = !drivers.isEmpty || !invitations.isEmpty || mobileEnabled != nil

        return VehicleAccessProjection(
            driverEntries: driverEntries,
            invitationEntries: invitationEntries,
            driverCount: drivers.count,
            mobileEnabled: mobileEnabled,
            mobileBadge: mobileBadge(for: mobileEnabled),
            hasAnyData: hasAnyData
        )
    }

    /// Web invitation-status → badge mapping. Any status that is neither `pending` nor `accepted`
    /// falls through to the Expired (danger) chip, matching the web ternary's final branch.
    static func invitationBadge(status: String) -> VehicleAccessBadge {
        switch status {
        case "pending":
            VehicleAccessBadge(
                labelKey: "widget.vehicleAccessPendingStatus",
                labelFallback: "Pending",
                tone: .warning
            )
        case "accepted":
            VehicleAccessBadge(
                labelKey: "widget.vehicleAccessAccepted",
                labelFallback: "Accepted",
                tone: .success
            )
        default:
            VehicleAccessBadge(
                labelKey: "widget.vehicleAccessExpired",
                labelFallback: "Expired",
                tone: .danger
            )
        }
    }

    /// Web mobile-access → badge mapping: `enabled === true` → (Enabled, success), `=== false` →
    /// (Disabled, danger), `null` → (Unknown, neutral).
    public static func mobileBadge(for enabled: Bool?) -> VehicleAccessBadge {
        switch enabled {
        case .some(true):
            VehicleAccessBadge(labelKey: "widget.vehicleAccessEnabled", labelFallback: "Enabled", tone: .success)
        case .some(false):
            VehicleAccessBadge(labelKey: "widget.vehicleAccessDisabled", labelFallback: "Disabled", tone: .danger)
        case .none:
            VehicleAccessBadge(labelKey: "widget.vehicleAccessUnknown", labelFallback: "Unknown", tone: .neutral)
        }
    }
}

// MARK: - Layout (web `isCompact`)

/// Pure size → layout mapping, mirroring the web `isCompact = size.cols <= 1` (which swaps the full
/// standard card for the single-line compact summary). Kept testable + SwiftUI-free.
public enum VehicleAccessLayout {
    public static func isCompact(_ size: DashboardWidgetSize) -> Bool {
        size.cols <= 1
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver summaries spoken for the widget body. Pure + public so the a11y label
/// content can be unit-tested without rendering the view.
public enum VehicleAccessAccessibility {
    /// The spoken status for the compact dot, mirroring the web `title=` on the mobile-access dot
    /// (Mobile access enabled / disabled / unknown).
    public static func mobileDotLabel(for enabled: Bool?) -> String {
        switch enabled {
        case .some(true):
            VehicleAccessStrings.string("widget.vehicleAccessMobileOn", "Mobile access enabled")
        case .some(false):
            VehicleAccessStrings.string("widget.vehicleAccessMobileOff", "Mobile access disabled")
        case .none:
            VehicleAccessStrings.string("widget.vehicleAccessMobileUnknown", "Mobile access unknown")
        }
    }

    /// The compact-layout summary: "N Drivers. <mobile dot status>".
    public static func compactSummary(for projection: VehicleAccessProjection) -> String {
        let drivers = VehicleAccessStrings.string("widget.vehicleAccessDrivers", "Drivers")
        let mobile = mobileDotLabel(for: projection.mobileEnabled)
        return "\(projection.driverCount) \(drivers). \(mobile)"
    }

    /// The standard-layout summary: the title, the mobile-access line, then each driver and each
    /// pending invitation row (label, value, badge), matching what the card renders.
    public static func standardSummary(for projection: VehicleAccessProjection) -> String {
        let title = VehicleAccessStrings.string("widget.vehicleAccess", "Vehicle Access")
        let mobileLabel = VehicleAccessStrings.string("widget.vehicleAccessMobile", "Mobile Access")
        var parts = [title, "\(mobileLabel) \(projection.mobileBadge.label)"]

        let drivers = VehicleAccessStrings.string("widget.vehicleAccessAuthorized", "Authorized Drivers")
        parts.append(drivers)
        if projection.driverEntries.isEmpty {
            parts.append(VehicleAccessStrings.string("widget.vehicleAccessNoDrivers", "No authorized drivers"))
        } else {
            for entry in projection.driverEntries {
                parts.append("\(entry.label) \(entry.value) \(entry.badge.label)")
            }
        }

        if !projection.invitationEntries.isEmpty {
            parts.append(VehicleAccessStrings.string("widget.vehicleAccessPending", "Pending Invitations"))
            for entry in projection.invitationEntries {
                parts.append("\(entry.label) \(entry.value) \(entry.badge.label)")
            }
        }

        return parts.joined(separator: ". ")
    }

    /// The spoken summary for the empty state: the surface title followed by the "No access data
    /// available" message the view shows.
    public static func emptySummary() -> String {
        let title = VehicleAccessStrings.string("widget.vehicleAccess", "Vehicle Access")
        let message = VehicleAccessStrings.string("widget.vehicleAccessNoData", "No access data available")
        return "\(title). \(message)"
    }
}
