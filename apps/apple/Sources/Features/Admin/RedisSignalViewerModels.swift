import Foundation

// Value types, data-source seams, render states, and the pure display helpers that
// back the native Redis Signal Viewer (web
// `web/src/features/admin/pages/RedisSignalViewerPage.tsx`). Kept free of SwiftUI so the
// projection logic is unit-testable in isolation (the page model + views depend on these).

// MARK: - Vehicle value type (web `useVehicles` row, trimmed to this unit's render set)

/// One vehicle offered in the viewer's picker — a pure value type carrying only the
/// fields this parity unit renders (id, display name, VIN). Mirrors the web `useVehicles`
/// row the page maps into its `<Select>` options.
public struct RedisSignalVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String?
    public let vin: String?

    public init(id: Int64, displayName: String? = nil, vin: String? = nil) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
    }

    /// The option label — the Swift port of the web expression
    /// `v.display_name || v.vin || `Vehicle ${v.id}``.
    public var label: String {
        if let displayName, !displayName.isEmpty { return displayName }
        if let vin, !vin.isEmpty { return vin }
        return "Vehicle \(id)"
    }
}

// MARK: - Signal category (web `categorizeSignal` + `CATEGORY_COLORS`)

/// The bucket a cached signal falls into, mirroring the web `SignalCategory` union and its
/// tone map. The raw `label` is rendered verbatim exactly like the web (`{row.category}` /
/// the filter `Battery (${count})` template literals are NOT translated upstream).
public enum RedisSignalCategory: String, CaseIterable, Hashable, Sendable {
    case battery = "Battery"
    case charging = "Charging"
    case driving = "Driving"
    case climate = "Climate"
    case other = "Other"

    /// Verbatim display label (web renders the category string directly, untranslated).
    public var label: String {
        rawValue
    }

    /// Web `CATEGORY_COLORS` → the shared semantic tone used by the category badge.
    public var tone: TSToneToken {
        switch self {
        case .battery: .success
        case .charging: .info
        case .driving: .warning
        case .climate: .danger
        case .other: .neutral
        }
    }

    /// Pure port of web `categorizeSignal(name)`. Battery / Charging / Driving match a
    /// name *prefix*; Climate matches a substring anywhere; everything else is Other.
    public static func categorize(_ name: String) -> RedisSignalCategory {
        let lower = name.lowercased()
        if hasAnyPrefix(lower, ["battery", "bms", "pack", "brick", "module"]) { return .battery }
        if hasAnyPrefix(lower, ["ac", "dc", "charge", "charger"]) { return .charging }
        if hasAnyPrefix(lower, ["vehicle", "odometer", "latitude", "longitude", "gps"]) { return .driving }
        if containsAny(lower, ["temp", "hvac", "inside", "outside", "climate"]) { return .climate }
        return .other
    }

    private static func hasAnyPrefix(_ value: String, _ prefixes: [String]) -> Bool {
        prefixes.contains { value.hasPrefix($0) }
    }

    private static func containsAny(_ value: String, _ needles: [String]) -> Bool {
        needles.contains { value.contains($0) }
    }
}

/// A small tone token decoupled from SwiftUI so the model layer stays UI-free; the view
/// maps it to the shared `TSTone`. Mirrors the six web badge tones.
public enum TSToneToken: String, Hashable, Sendable {
    case neutral, accent, success, warning, danger, info
}

// MARK: - Signal value (web `RedisSignalEntry` value/type pair)

/// A cached signal's value, tagged by its wire type (web `RedisSignalEntry`:
/// `value: number | string | boolean`, `type: 'number' | 'string' | 'boolean'`).
public enum RedisSignalValue: Hashable, Sendable {
    case number(Double)
    case string(String)
    case boolean(Bool)

    /// Web `entry.type` — the verbatim type token shown in the Type badge.
    public var typeLabel: String {
        switch self {
        case .number: "number"
        case .string: "string"
        case .boolean: "boolean"
        }
    }

    /// Web `String(row.value)` — the value rendered in the Value column.
    public var display: String {
        switch self {
        case let .number(value): RedisSignalFormat.numberValue(value)
        case let .string(value): value
        case let .boolean(value): value ? "true" : "false"
        }
    }
}

// MARK: - Signal row (web `SignalRow`)

/// One table row: the signal name (the stable id), its typed value, and its category
/// (web `SignalRow` — `{ name, value, type, category }`).
public struct RedisSignalRow: Identifiable, Hashable, Sendable {
    public let name: String
    public let value: RedisSignalValue
    public let category: RedisSignalCategory

    public var id: String {
        name
    }

    public init(name: String, value: RedisSignalValue) {
        self.name = name
        self.value = value
        category = RedisSignalCategory.categorize(name)
    }

    /// Web `isLocationSignal(name)` — exact (anchored) match for the lat/lng/gps names
    /// whose value is masked by default so a casual screen-share doesn't leak a location.
    public var isLocation: Bool {
        Self.locationNames.contains(name.lowercased())
    }

    private static let locationNames: Set<String> = [
        "latitude", "longitude", "gps_lat", "gps_lng",
        "gps_latitude", "gps_longitude", "location_lat", "location_lng"
    ]
}

// MARK: - Diagnostic meta (web `RedisSignalsMeta`)

/// The diagnostic block the API returns alongside the signals (web `RedisSignalsMeta`),
/// surfaced in the header chips and the empty/error diagnostic.
public struct RedisSignalsMeta: Hashable, Sendable {
    public let liveSignalStoreMode: String
    public let redisKey: String
    public let redisFieldCount: Int
    public let l1SignalCount: Int
    public let l1LastSeenAt: Date?
    public let l2LastSeenAt: Date?
    public let vehicleVIN: String?

    public init(
        liveSignalStoreMode: String,
        redisKey: String = "",
        redisFieldCount: Int = 0,
        l1SignalCount: Int = 0,
        l1LastSeenAt: Date? = nil,
        l2LastSeenAt: Date? = nil,
        vehicleVIN: String? = nil
    ) {
        self.liveSignalStoreMode = liveSignalStoreMode
        self.redisKey = redisKey
        self.redisFieldCount = redisFieldCount
        self.l1SignalCount = l1SignalCount
        self.l1LastSeenAt = l1LastSeenAt
        self.l2LastSeenAt = l2LastSeenAt
        self.vehicleVIN = vehicleVIN
    }

    /// Web `meta.live_signal_store_mode === 'hybrid'` — drives the mode chip's tone.
    public var isHybrid: Bool {
        liveSignalStoreMode == "hybrid"
    }
}

// MARK: - Signals snapshot (web `RedisSignalsResponse`)

/// One vehicle's cached-signal snapshot (web `RedisSignalsResponse`). Rows are stored
/// pre-sorted by name (web `.sort((a, b) => a.name.localeCompare(b.name))`).
public struct RedisSignalsSnapshot: Hashable, Sendable {
    public let vehicleID: Int64
    public let signalCount: Int
    public let rows: [RedisSignalRow]
    public let meta: RedisSignalsMeta?

    public init(vehicleID: Int64, signalCount: Int, rows: [RedisSignalRow], meta: RedisSignalsMeta? = nil) {
        self.vehicleID = vehicleID
        self.signalCount = signalCount
        self.rows = rows.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
        self.meta = meta
    }
}

// MARK: - Purge results (web purge responses)

/// Web `RedisSignalsPurgeResponse` — the per-vehicle purge outcome.
public struct RedisPurgeResult: Hashable, Sendable {
    public let purged: Bool
    public init(purged: Bool) {
        self.purged = purged
    }
}

/// Web `RedisSignalsPurgeAllResponse` — the cluster-wide purge outcome.
public struct RedisPurgeAllResult: Hashable, Sendable {
    public let purged: Int
    public let scanned: Int
    public let limit: Int
    public let hasMore: Bool

    public init(purged: Int, scanned: Int, limit: Int, hasMore: Bool) {
        self.purged = purged
        self.scanned = scanned
        self.limit = limit
        self.hasMore = hasMore
    }
}

// MARK: - Data-source seams (web `useVehicles` + `@/api/devtools` redis calls)

/// Supplies the vehicle list the picker offers (web `useVehicles` → `GET /vehicles`). The
/// production app binds the shared KMP vehicles feed (ADR-004 — no networking in the view);
/// previews and tests inject doubles to drive the loading / empty / error / success states.
public protocol RedisSignalViewerVehicleSource: Sendable {
    func loadVehicles() async throws -> [RedisSignalVehicle]
}

/// Reads and purges the Redis (L2) signal cache (web `getRedisSignals` /
/// `purgeRedisSignals` / `purgeAllRedisSignals` from `@/api/devtools`). Bound to the shared
/// KMP dev-tools client in production; sampled in previews/tests.
public protocol RedisSignalStore: Sendable {
    func loadSignals(vehicleID: Int64) async throws -> RedisSignalsSnapshot
    func purge(vehicleID: Int64) async throws -> RedisPurgeResult
    func purgeAll() async throws -> RedisPurgeAllResult
}

// MARK: - Render states (web `useQuery` phases)

/// The vehicles source's render phase (web `useVehicles` query phases + the empty list).
public enum RedisVehiclesState: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case loaded([RedisSignalVehicle])
}

/// The signals source's render phase for the table panel (web select-prompt /
/// `isLoading` / diagnostic / table branches). `empty` carries the diagnostic meta so the
/// "no signals cached" branch can still show mode/VIN/last-seen.
public enum RedisSignalsState: Equatable, Sendable {
    /// No vehicle selected — the web `selectedVehicleId === null` select prompt.
    case idle
    case loading
    /// Loaded with zero cached signals (web diagnostic empty-state branch).
    case empty(RedisSignalsMeta?)
    /// The upstream query failed (web diagnostic error branch).
    case error(message: String, meta: RedisSignalsMeta?)
    case loaded(RedisSignalsSnapshot)
}

/// The category-filter selection (web `categoryFilter` state: `'all'` + the five buckets).
public enum RedisCategoryFilter: Hashable, Sendable, CaseIterable {
    case all
    case battery
    case charging
    case driving
    case climate
    case other

    /// The concrete category this filter narrows to, or `nil` for "all".
    public var category: RedisSignalCategory? {
        switch self {
        case .all: nil
        case .battery: .battery
        case .charging: .charging
        case .driving: .driving
        case .climate: .climate
        case .other: .other
        }
    }
}

// MARK: - Purge outcome (web `toast.*`)

/// The result banner shown after a purge command — the HIG-native peer of the web
/// `toast.success / info / warning / error`. Each case carries the data the web detail
/// string interpolates so the banner can resolve the localized message at the boundary.
public enum RedisPurgeOutcome: Equatable, Sendable {
    case purgeSucceeded(vehicle: String)
    case purgeNoOp(vehicle: String)
    case purgeAllSucceeded(count: Int)
    case purgeAllPartial(count: Int, limit: Int)
    case failed(message: String)

    /// Maps to the banner tone (web toast severity).
    public var tone: TSToneToken {
        switch self {
        case .purgeSucceeded, .purgeAllSucceeded: .success
        case .purgeNoOp: .info
        case .purgeAllPartial: .warning
        case .failed: .danger
        }
    }
}

// MARK: - Display formatters (web `fmtInt` / `String(value)`)

/// Display-boundary formatters for the viewer. `int` mirrors the web `fmtInt` grouped
/// integer; `numberValue` mirrors JavaScript `String(number)` (no grouping, no trailing
/// `.0`) used in the Value column.
public enum RedisSignalFormat {
    private static let grouping: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        return formatter
    }()

    /// Web `fmtInt(n)` — grouped integer (e.g. `1,234`).
    public static func int(_ value: Int) -> String {
        grouping.string(from: NSNumber(value: value)) ?? String(value)
    }

    /// JS `String(value)` for the Value column: integral doubles render without a decimal
    /// (`42`), fractional doubles keep their minimal decimal form (`42.5`).
    public static func numberValue(_ value: Double) -> String {
        guard value.isFinite else { return value.isNaN ? "NaN" : (value < 0 ? "-Infinity" : "Infinity") }
        if value == value.rounded(), abs(value) < 1e15 {
            return String(Int64(value))
        }
        return String(value)
    }
}
