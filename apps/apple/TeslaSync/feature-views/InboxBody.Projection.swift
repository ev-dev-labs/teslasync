//
//  InboxBody.Projection.swift
//  TeslaSync — P4 feature view · 0183 · InboxBody (Apple)
//
//  The pure projection logic for the inbox surface — Foundation-only ports of the
//  web `InboxBody.tsx` helpers: `groupByDay` (Today / Yesterday / dated buckets),
//  the unread tally, the per-row drill-through (`lib/alertDrillthrough`), the
//  per-row context menu (`buildRowContextMenu`), the bulk-action list, the
//  master-selection state, and the VoiceOver summaries. No store, no SwiftUI — so
//  every branch is unit-tested in isolation.
//

import Foundation

// MARK: - Date formatting (web `new Date(iso)` + `Intl.DateTimeFormat`)

/// Locale-aware date helpers shared by the day-grouping + the rows + the tests.
public enum InboxDateFormat {
    /// The web absent-value sentinel.
    public static let dash = "—"

    /// Parses an ISO-8601 (optionally fractional) timestamp or a numeric
    /// epoch-seconds string (web `new Date(iso)`). Returns nil when unparseable.
    public static func parseDate(_ raw: String) -> Date? {
        guard !raw.isEmpty else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: raw) { return date }
        iso.formatOptions = [.withInternetDateTime]
        if let date = iso.date(from: raw) { return date }
        if let seconds = Double(raw) { return Date(timeIntervalSince1970: seconds) }
        return nil
    }

    /// Web `timeAgo` — the OS-localized relative form ("5m ago"); `now` injectable.
    public static func relative(for date: Date, relativeTo now: Date = Date()) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: now)
    }

    /// Web `Intl.DateTimeFormat(undefined, { weekday:'long', month:'short',
    /// day:'numeric', year:'numeric' })` — the dated bucket header.
    public static func datedLabel(for date: Date, locale: Locale = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.setLocalizedDateFormatFromTemplate("EEEEMMMdyyyy")
        return formatter.string(from: date)
    }
}

// MARK: - Day grouping (web `groupByDay`)

/// One day bucket — `today` / `yesterday` are localized at the view (web
/// `t('common.today')` / `t('common.yesterday')`); `dated` carries the
/// already-formatted header string.
public enum InboxDayBucket: Equatable, Sendable {
    case today
    case yesterday
    case dated(String)

    /// A stable identity for the bucket header / `ForEach`.
    public var key: String {
        switch self {
        case .today: "today"
        case .yesterday: "yesterday"
        case let .dated(label): "dated:\(label)"
        }
    }
}

/// A day-grouped slice of the flat list (web `{ day, rows }`).
public struct InboxDayGroup: Identifiable, Equatable, Sendable {
    public let bucket: InboxDayBucket
    public let rows: [InboxNotification]

    public init(bucket: InboxDayBucket, rows: [InboxNotification]) {
        self.bucket = bucket
        self.rows = rows
    }

    public var id: String {
        bucket.key
    }
}

// MARK: - Projection (web render helpers)

/// The pure projections the inbox renders from. Mirrors `InboxBody.tsx` exactly.
public enum InboxProjection {
    /// Port of the web `groupByDay`: walks the rows (newest-first order is kept),
    /// drops unparseable timestamps, and starts a new bucket whenever the local
    /// day label changes. `now` + `calendar` + `locale` are injectable for tests.
    public static func groupByDay(
        _ rows: [InboxNotification],
        relativeTo now: Date = Date(),
        calendar: Calendar = .current,
        locale: Locale = .current
    ) -> [InboxDayGroup] {
        guard !rows.isEmpty else { return [] }
        let today = calendar.startOfDay(for: now)
        let yesterday = calendar.date(byAdding: .day, value: -1, to: today) ?? today
        var out: [(bucket: InboxDayBucket, rows: [InboxNotification])] = []
        for row in rows {
            guard let date = InboxDateFormat.parseDate(row.createdAt) else { continue }
            let bucket = bucketFor(date, today: today, yesterday: yesterday, calendar: calendar, locale: locale)
            if var last = out.last, last.bucket == bucket {
                last.rows.append(row)
                out[out.count - 1] = last
            } else {
                out.append((bucket, [row]))
            }
        }
        return out.map { InboxDayGroup(bucket: $0.bucket, rows: $0.rows) }
    }

    private static func bucketFor(
        _ date: Date,
        today: Date,
        yesterday: Date,
        calendar: Calendar,
        locale: Locale
    ) -> InboxDayBucket {
        let dayStart = calendar.startOfDay(for: date)
        if dayStart == today { return .today }
        if dayStart == yesterday { return .yesterday }
        return .dated(InboxDateFormat.datedLabel(for: date, locale: locale))
    }

    /// Web `rows.reduce((acc, r) => r.read_at ? acc : acc + 1, 0)`.
    public static func unreadCount(_ rows: [InboxNotification]) -> Int {
        rows.reduce(0) { $0 + ($1.isRead ? 0 : 1) }
    }

    /// Web `rows.map(r => r.id)` — the ids the select-all checkbox spans.
    public static func visibleIds(_ rows: [InboxNotification]) -> [Int] {
        rows.map(\.id)
    }

    /// Web `masterState(visibleIds) === 'all'`: every visible row selected and at
    /// least one row present.
    public static func allVisibleSelected(_ visibleIds: [Int], selected: Set<Int>) -> Bool {
        guard !visibleIds.isEmpty else { return false }
        return visibleIds.allSatisfy { selected.contains($0) }
    }

    /// Web `rows.filter(r => !r.read_at).map(r => r.id)` — the unread ids the
    /// auto-mark-on-open + mark-all affordances act on.
    public static func unreadIds(_ rows: [InboxNotification]) -> [Int] {
        rows.filter { !$0.isRead }.map(\.id)
    }
}

// MARK: - Drill-through (web `lib/alertDrillthrough`)

/// A computed drill-through destination (web `DrillthroughTarget`): a route path
/// plus ordered query items (`vehicle_id`, `t`, `signal`).
public struct InboxDrillTarget: Equatable, Sendable {
    public let path: String
    public let query: [(String, String)]

    public init(path: String, query: [(String, String)]) {
        self.path = path
        self.query = query
    }

    public static func == (lhs: InboxDrillTarget, rhs: InboxDrillTarget) -> Bool {
        lhs.path == rhs.path && lhs.query.elementsEqual(rhs.query) { $0 == $1 }
    }

    /// Web `getAlertDrillthroughHref` — `path?key=value&…` (or bare path).
    public var href: String {
        guard !query.isEmpty else { return path }
        var components = URLComponents()
        components.queryItems = query.map { URLQueryItem(name: $0.0, value: $0.1) }
        let search = components.percentEncodedQuery ?? ""
        return search.isEmpty ? path : "\(path)?\(search)"
    }
}

/// Port of `lib/alertDrillthrough.ts`: the signal → page map, the Signal Explorer
/// fallback, and the target/href builders. Pure + table-driven.
public enum InboxDrillthrough {
    /// Generic fallback when no signal-specific page is registered.
    public static let signalExplorerFallback = "/signal-explorer"

    /// Web `SIGNAL_TO_PAGE` — telemetry signal name → destination route.
    public static let signalToPage: [String: String] = [
        "BatteryLevel": "/battery", "RatedRange": "/battery", "ChargeLimitSoc": "/battery",
        "EstBatteryRange": "/battery", "IdealBatteryRange": "/battery",
        "ChargeState": "/charging", "DetailedChargeState": "/charging", "DCChargingPower": "/charging",
        "ACChargingPower": "/charging", "ChargeAmps": "/charging", "ChargerVoltage": "/charging",
        "ChargerActualCurrent": "/charging", "ChargingCableType": "/charging",
        "Gear": "/drives", "VehicleSpeed": "/drives", "Power": "/drives", "Odometer": "/drives",
        "InsideTemp": "/climate-control", "OutsideTemp": "/climate-control",
        "HvacPower": "/climate-control", "ClimateKeeperMode": "/climate-control",
        "TpmsPressureFl": "/tire-pressure", "TpmsPressureFr": "/tire-pressure",
        "TpmsPressureRl": "/tire-pressure", "TpmsPressureRr": "/tire-pressure",
        "TpmsHardWarnings": "/tire-pressure", "TpmsSoftWarnings": "/tire-pressure",
        "TpmsLastSeenPressureTimeFl": "/tire-pressure", "TpmsLastSeenPressureTimeFr": "/tire-pressure",
        "TpmsLastSeenPressureTimeRl": "/tire-pressure", "TpmsLastSeenPressureTimeRr": "/tire-pressure",
        "Locked": "/security-access", "SentryMode": "/security-access", "DoorState": "/security-access",
        "WindowState": "/security-access", "SunroofInstalled": "/security-access",
        "SoftwareUpdateVersion": "/software-updates",
        "SoftwareUpdateDownloadPercentComplete": "/software-updates",
        "SoftwareUpdateInstallationPercentComplete": "/software-updates",
        "SoftwareUpdateExpectedDurationMinutes": "/software-updates",
        "LocatedAtHome": "/navigation", "LocatedAtWork": "/navigation",
        "LocatedAtFavorite": "/navigation", "DestinationName": "/navigation",
        "DestinationLocation": "/navigation"
    ]

    /// Web `getAlertDrillthrough(alert)` — builds the target from the rule signal,
    /// the (non-zero) vehicle id, and the notification timestamp.
    public static func target(signal: String?, vehicleId: Int?, createdAt: String) -> InboxDrillTarget {
        var query: [(String, String)] = []
        if let vehicleId, vehicleId > 0 { query.append(("vehicle_id", String(vehicleId))) }
        if !createdAt.isEmpty { query.append(("t", createdAt)) }
        if let signal, !signal.isEmpty { query.append(("signal", signal)) }
        if let signal, let page = signalToPage[signal] {
            return InboxDrillTarget(path: page, query: query)
        }
        return InboxDrillTarget(path: signalExplorerFallback, query: query)
    }

    /// Web `rule ? getAlertDrillthroughHref(synthetic) : null` — the row only
    /// drills through when its rule is known (the synthetic alert needs a signal).
    public static func rowTarget(
        notification: InboxNotification,
        rule: InboxRule?,
        vehicle: InboxVehicle?
    ) -> InboxDrillTarget? {
        guard let rule else { return nil }
        let vehicleId = vehicle?.id ?? rule.vehicleId ?? 0
        return target(signal: rule.signalName, vehicleId: vehicleId, createdAt: notification.createdAt)
    }
}
