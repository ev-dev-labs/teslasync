//
//  EntriesTable.Adapter.swift
//  TeslaSync — P4 feature view · 0027 · EntriesTable (Apple)
//
//  Pure (Foundation-only) projection + formatting + sort for the DLQ-inspector entries
//  table, reproducing the web source's pipeline VERBATIM so the native surface shows the
//  exact same values as
//  web/src/features/admin/components/dlq-inspector/EntriesTable.tsx.
//
//  This file is deliberately free of SwiftUI / KMP so the conversion, byte/number
//  formatting, sort comparators, and i18n facade can be compiled and executed on a plain
//  host and pinned by unit tests (the "cached → projection" adapter contract).
//

import Foundation

// MARK: - Wire DTO (mirror of the Go `DLQEntrySummary` JSON)

/// One summary row exactly as the list endpoint returns it. Field names mirror the Go
/// JSON tags (snake_case) from `internal/api/dlq_handler.go`, decoded straight from the
/// cached payload. Heavy raw/inner payload blobs are intentionally absent from the list
/// shape (loaded lazily by the entry drawer), matching `types/admin-diagnostics.ts`.
public struct DLQEntrySummaryDTO: Decodable, Equatable, Sendable {
    public let id: Int
    public let arrivedAt: String
    public let dlqTopic: String
    public let parsedReason: String
    public let parsedVehicleID: Int?
    public let parsedVin: String?
    public let parsedSourceTopic: String?
    public let parsedRedeliveries: Int?
    public let parsedTimestamp: String?
    public let parseError: String?
    public let replayable: Bool
    public let rawPayloadSize: Int
    public let innerPayloadSize: Int

    enum CodingKeys: String, CodingKey {
        case id
        case arrivedAt = "arrived_at"
        case dlqTopic = "dlq_topic"
        case parsedReason = "parsed_reason"
        case parsedVehicleID = "parsed_vehicle_id"
        case parsedVin = "parsed_vin"
        case parsedSourceTopic = "parsed_source_topic"
        case parsedRedeliveries = "parsed_redeliveries"
        case parsedTimestamp = "parsed_timestamp"
        case parseError = "parse_error"
        case replayable
        case rawPayloadSize = "raw_payload_size"
        case innerPayloadSize = "inner_payload_size"
    }

    public init(
        id: Int,
        arrivedAt: String,
        dlqTopic: String,
        parsedReason: String,
        parsedVehicleID: Int? = nil,
        parsedVin: String? = nil,
        parsedSourceTopic: String? = nil,
        parsedRedeliveries: Int? = nil,
        parsedTimestamp: String? = nil,
        parseError: String? = nil,
        replayable: Bool,
        rawPayloadSize: Int,
        innerPayloadSize: Int
    ) {
        self.id = id
        self.arrivedAt = arrivedAt
        self.dlqTopic = dlqTopic
        self.parsedReason = parsedReason
        self.parsedVehicleID = parsedVehicleID
        self.parsedVin = parsedVin
        self.parsedSourceTopic = parsedSourceTopic
        self.parsedRedeliveries = parsedRedeliveries
        self.parsedTimestamp = parsedTimestamp
        self.parseError = parseError
        self.replayable = replayable
        self.rawPayloadSize = rawPayloadSize
        self.innerPayloadSize = innerPayloadSize
    }
}

// MARK: - Projected row (what the SwiftUI table renders)

/// One projected DLQ row: the raw values the columns sort on plus the localized display
/// strings each cell shows. Mirrors the per-column `render` derivations in the web source
/// (TimeStamp absolute, mono reason/vin/topic, fmtInt redeliveries, formatBytes payload,
/// replayable badge).
public struct DLQEntryRow: Identifiable, Equatable, Sendable {
    /// The em-dash fallback the web renders for missing values (`?? '—'`).
    public static let emDash = "—"

    public let id: Int
    /// Parsed `arrived_at` instant, used by the date sort. `nil` when unparseable.
    public let arrivedAt: Date?
    /// `arrived_at` rendered absolute (web `<TimeStamp format="absolute" />`).
    public let arrivedAtText: String
    /// Raw `parsed_reason` (drives the sort + the `?? '—'` display).
    public let reason: String
    /// Raw `parsed_vin` (drives the sort + the `?? '—'` display).
    public let vin: String?
    public let sourceTopic: String?
    public let redeliveries: Int?
    /// Raw `raw_payload_size` in bytes (drives the numeric size sort).
    public let payloadSize: Int
    public let payloadSizeText: String
    public let redeliveriesText: String
    public let replayable: Bool

    public init(
        id: Int,
        arrivedAt: Date?,
        arrivedAtText: String,
        reason: String,
        vin: String?,
        sourceTopic: String?,
        redeliveries: Int?,
        payloadSize: Int,
        payloadSizeText: String,
        redeliveriesText: String,
        replayable: Bool
    ) {
        self.id = id
        self.arrivedAt = arrivedAt
        self.arrivedAtText = arrivedAtText
        self.reason = reason
        self.vin = vin
        self.sourceTopic = sourceTopic
        self.redeliveries = redeliveries
        self.payloadSize = payloadSize
        self.payloadSizeText = payloadSizeText
        self.redeliveriesText = redeliveriesText
        self.replayable = replayable
    }

    /// Reason cell text: the raw reason, or the em-dash when empty (`row.parsed_reason || '—'`).
    public var reasonDisplay: String {
        reason.isEmpty ? Self.emDash : reason
    }

    /// VIN cell text: the raw VIN, or the em-dash when absent (`row.parsed_vin ?? '—'`).
    public var vinDisplay: String {
        vin ?? Self.emDash
    }

    /// Source-topic cell text: the raw topic, or the em-dash when absent.
    public var sourceTopicDisplay: String {
        sourceTopic ?? Self.emDash
    }
}

// MARK: - Formatting (ported 1:1 from the web source + lib/numberFormat.ts)

/// Locale / timezone the projector formats against (the web `TimeStamp` + `Intl` use the
/// active locale; tests pin an explicit one for deterministic output).
public struct EntriesTableFormatContext: Equatable, Sendable {
    public let localeIdentifier: String
    public let timeZoneIdentifier: String

    public init(
        localeIdentifier: String = Locale.current.identifier,
        timeZoneIdentifier: String = TimeZone.current.identifier
    ) {
        self.localeIdentifier = localeIdentifier
        self.timeZoneIdentifier = timeZoneIdentifier
    }

    /// A deterministic context (en-US / UTC) for previews + tests.
    public static let fixed = EntriesTableFormatContext(localeIdentifier: "en_US", timeZoneIdentifier: "UTC")
}

/// Byte-size, integer, and date formatting that mirrors the web `formatBytes`, `fmtInt`
/// (`Intl.NumberFormat`), and `<TimeStamp format="absolute" />`.
public enum EntriesTableFormat {
    /// Ports `formatBytes(n)` from the web source: a non-finite / negative size is the
    /// em-dash; `< 1 KiB` is whole bytes; `< 1 MiB` is `X.X KB`; otherwise `X.X MB`. The
    /// `toFixed(1)` decimal is rendered with a `.` separator (locale-independent, as in JS).
    public static func bytes(_ count: Int) -> String {
        guard count >= 0 else { return DLQEntryRow.emDash }
        if count < 1024 { return "\(count) B" }
        if count < 1024 * 1024 {
            return "\(fixedOneDecimal(Double(count) / 1024)) KB"
        }
        return "\(fixedOneDecimal(Double(count) / (1024 * 1024))) MB"
    }

    /// `value.toFixed(1)` parity: round half away from zero to one fraction digit and
    /// render with a `.` decimal separator regardless of locale.
    static func fixedOneDecimal(_ value: Double) -> String {
        let rounded = (value * 10).rounded(.toNearestOrAwayFromZero) / 10
        return String(format: "%.1f", rounded)
    }

    /// Ports `fmtInt(v)` (`Intl.NumberFormat` with 0 fraction digits): grouped, locale-aware
    /// integer rendering.
    public static func integer(_ value: Int, localeIdentifier: String = "en_US") -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.maximumFractionDigits = 0
        formatter.minimumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    /// Parses an ISO-8601 / RFC-3339 timestamp the way the web `Date.parse(arrived_at)`
    /// does, tolerating both whole-second and fractional-second forms. Returns `nil` for an
    /// empty or unparseable value.
    public static func parseTimestamp(_ iso: String?) -> Date? {
        guard let iso, !iso.isEmpty else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: iso) { return date }
        let whole = ISO8601DateFormatter()
        whole.formatOptions = [.withInternetDateTime]
        return whole.date(from: iso)
    }

    /// Renders a parsed instant the way the web `<TimeStamp format="absolute" />` does — a
    /// localized medium date + short time — with the em-dash fallback for a missing value.
    public static func absoluteDateTime(_ date: Date?, context: EntriesTableFormatContext) -> String {
        guard let date else { return DLQEntryRow.emDash }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: context.localeIdentifier)
        formatter.timeZone = TimeZone(identifier: context.timeZoneIdentifier) ?? .current
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - Sort (ported from the web `useSortToggle` + the `sorted` switch)

/// The four sortable columns, matching the web `sortKey` cases. The non-sortable columns
/// (topic, redeliveries, replayable, actions) are intentionally absent.
public enum DLQSortKey: String, CaseIterable, Sendable {
    case arrivedAt = "arrived_at"
    case reason = "parsed_reason"
    case vin = "parsed_vin"
    case payloadSize = "raw_payload_size"
}

/// The active sort, mirroring `useSortToggle('arrived_at', 'desc')`: a key + direction with
/// the same default (newest arrivals first) and a click-to-toggle reducer.
public struct DLQSortState: Equatable, Sendable {
    public var key: DLQSortKey
    public var ascending: Bool

    public init(key: DLQSortKey = .arrivedAt, ascending: Bool = false) {
        self.key = key
        self.ascending = ascending
    }

    /// The web default: `arrived_at` descending.
    public static let `default` = DLQSortState(key: .arrivedAt, ascending: false)

    /// Reducer for a header tap (web `onSort`): re-tapping the active column flips the
    /// direction; tapping a new column selects it descending (newest / largest first).
    public func toggled(for key: DLQSortKey) -> DLQSortState {
        if key == self.key {
            return DLQSortState(key: key, ascending: !ascending)
        }
        return DLQSortState(key: key, ascending: false)
    }
}

/// Pure, stable sort of projected rows, reproducing the web `sorted` comparator switch:
/// date difference for arrivals, `localeCompare` for reason/VIN, numeric for payload size.
public enum EntriesTableSort {
    /// Ascending comparison for a single key (the direction is applied by `sorted`).
    public static func compare(_ lhs: DLQEntryRow, _ rhs: DLQEntryRow, by key: DLQSortKey) -> ComparisonResult {
        switch key {
        case .arrivedAt:
            let left = lhs.arrivedAt ?? .distantPast
            let right = rhs.arrivedAt ?? .distantPast
            if left == right { return .orderedSame }
            return left < right ? .orderedAscending : .orderedDescending
        case .reason:
            return lhs.reason.localizedCompare(rhs.reason)
        case .vin:
            return (lhs.vin ?? "").localizedCompare(rhs.vin ?? "")
        case .payloadSize:
            if lhs.payloadSize == rhs.payloadSize { return .orderedSame }
            return lhs.payloadSize < rhs.payloadSize ? .orderedAscending : .orderedDescending
        }
    }

    /// Stable sort (ties keep their original relative order, like `Array.prototype.sort`)
    /// applying `state`'s key + direction.
    public static func sorted(_ rows: [DLQEntryRow], by state: DLQSortState) -> [DLQEntryRow] {
        rows.enumerated().sorted { lhs, rhs in
            let result = compare(lhs.element, rhs.element, by: state.key)
            if result == .orderedSame { return lhs.offset < rhs.offset }
            return state.ascending ? result == .orderedAscending : result == .orderedDescending
        }.map(\.element)
    }
}

// MARK: - Projection (cached DTOs → display rows)

/// Pure projector: cached `[DLQEntrySummaryDTO]` → `[DLQEntryRow]`. Every value is computed
/// with the same arithmetic + formatting as the web widget, so the native table renders
/// identical content.
public enum EntriesTableProjector {
    /// Projects one cached summary into its display row.
    public static func projectRow(_ dto: DLQEntrySummaryDTO, context: EntriesTableFormatContext) -> DLQEntryRow {
        let arrivedAt = EntriesTableFormat.parseTimestamp(dto.arrivedAt)
        let redeliveriesText = dto.parsedRedeliveries
            .map { EntriesTableFormat.integer($0, localeIdentifier: context.localeIdentifier) } ?? DLQEntryRow.emDash
        return DLQEntryRow(
            id: dto.id,
            arrivedAt: arrivedAt,
            arrivedAtText: EntriesTableFormat.absoluteDateTime(arrivedAt, context: context),
            reason: dto.parsedReason,
            vin: dto.parsedVin,
            sourceTopic: dto.parsedSourceTopic,
            redeliveries: dto.parsedRedeliveries,
            payloadSize: dto.rawPayloadSize,
            payloadSizeText: EntriesTableFormat.bytes(dto.rawPayloadSize),
            redeliveriesText: redeliveriesText,
            replayable: dto.replayable
        )
    }

    /// Projects + sorts a cached page into the rows the table renders.
    public static func project(
        _ dtos: [DLQEntrySummaryDTO],
        context: EntriesTableFormatContext = .init(),
        sort: DLQSortState = .default
    ) -> [DLQEntryRow] {
        let rows = dtos.map { projectRow($0, context: context) }
        return EntriesTableSort.sorted(rows, by: sort)
    }
}
