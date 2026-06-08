//
//  SessionListSection.Seams.swift
//  TeslaSync — P4 feature view · 0106 · SessionListSection (Apple)
//
//  The dependency seams the SessionListSection view-model binds through, kept apart
//  from the model itself for the lint length budget: the P1/S11 telemetry contract,
//  the P1/S10 i18n facade (web `useTranslation`), the formatting facade (web
//  `useFormatting` + `fmtNumber`/`fmtWithUnit`/`formatDurationMinutes`), the units
//  facade (web `toDistanceDisplay` + `distanceUnit`), the export + bulk-delete seams
//  (web `<a download>` links + `onBulkDelete`), the coalesced source snapshot, the
//  P1/S8 source protocol, the in-memory source for previews/tests, the active-filter
//  chip model, and the VoiceOver string builder.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to the
/// shared core `Telemetry.track(.screenView(screen:…))` (ADR-016), consent-gated and
/// redacted there.
public protocol SessionListTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogSessionListTelemetry: SessionListTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// views hold no hardcoded literals. Keys live in the "SessionListSection" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time; kept
/// per-surface so each parallel prompt owns its own strings.
public enum SessionListStrings {
    public static let table = "SessionListSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Formatting facade (web `useFormatting` + numberFormat helpers)

/// The display-boundary formatting the rows need: grouped numbers (web `fmtNumber`),
/// integers (web `fmtInt`), currency (web `formatCurrency`), and the "Xh Ym"
/// duration (web `formatDurationMinutes`). Production injects a settings-backed
/// implementation (currency symbol + locale from `useSettings`); previews/tests use
/// `DefaultSessionListFormatting`.
public protocol SessionListFormatting {
    func formatNumber(_ value: Double, decimals: Int) -> String
    func formatInt(_ value: Double) -> String
    func formatCurrency(_ amount: Double, decimals: Int) -> String
    func formatDuration(minutes: Double) -> String
}

public extension SessionListFormatting {
    /// Currency at the web default precision (2), matching the section's call sites.
    func formatCurrency(_ amount: Double) -> String {
        formatCurrency(amount, decimals: 2)
    }

    /// Number at the web default precision (1) used by the kWh / kW chips.
    func formatNumber(_ value: Double) -> String {
        formatNumber(value, decimals: 1)
    }
}

/// Bundle-free default formatter: grouped thousands, fixed decimals, half-up
/// rounding, `"$"` currency symbol, and the web "Xh Ym" / "Ym" duration with a "—"
/// fallback for non-positive durations. Stateless + `Sendable`.
public struct DefaultSessionListFormatting: SessionListFormatting, Sendable {
    private let currencySymbol: String
    private let localeIdentifier: String

    public init(currencySymbol: String = "$", localeIdentifier: String = "en_US") {
        self.currencySymbol = currencySymbol
        self.localeIdentifier = localeIdentifier
    }

    private func formatter(decimals: Int) -> NumberFormatter {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter
    }

    public func formatNumber(_ value: Double, decimals: Int) -> String {
        let safe = SessionListNumeric.safe(value)
        return formatter(decimals: max(0, decimals)).string(from: NSNumber(value: safe)) ?? "0"
    }

    public func formatInt(_ value: Double) -> String {
        formatNumber(value, decimals: 0)
    }

    public func formatCurrency(_ amount: Double, decimals: Int) -> String {
        currencySymbol + formatNumber(amount, decimals: max(0, decimals))
    }

    public func formatDuration(minutes: Double) -> String {
        guard minutes.isFinite, minutes >= 0 else { return "—" }
        let hours = Int(minutes / 60)
        let mins = Int(minutes.truncatingRemainder(dividingBy: 60).rounded())
        return hours > 0 ? "\(hours)h \(mins)m" : "\(mins)m"
    }
}

// MARK: - Units facade (web `toDistanceDisplay` + `distanceUnit`)

/// The distance display boundary: converts kilometers to the user's unit and names
/// it (web passes `toDistanceDisplay(km)` + `distanceUnit`). Production injects a
/// settings-backed implementation; the default is metric passthrough.
public protocol SessionListUnits: Sendable {
    func distanceDisplay(kilometers: Double) -> Double
    var distanceUnit: String { get }
}

public struct DefaultSessionListUnits: SessionListUnits {
    public init() {}
    public func distanceDisplay(kilometers: Double) -> Double {
        kilometers
    }

    public var distanceUnit: String {
        "km"
    }
}

// MARK: - Export seam (web `<a href=/api/v1/export/charging download>`)

/// Receives an export action with the resolved request path (web download link).
/// The production app hands the path to its authenticated download/share flow; the
/// default logs the request so the view performs no networking itself.
public protocol SessionListExporter: Sendable {
    func export(format: SessionListExportFormat, request: String)
}

public struct OSLogSessionListExporter: SessionListExporter {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "charging-export")
    }

    public func export(format: SessionListExportFormat, request: String) {
        logger.info("charging.export format=\(format.rawValue, privacy: .public) request=\(request, privacy: .public)")
    }
}

// MARK: - Bulk-delete seam (web `onBulkDelete`)

/// Deletes the selected sessions (web `onBulkDelete(ids)`), present only when the
/// host wires bulk actions. The view-model awaits it, then clears the selection.
public protocol SessionListDeleter: Sendable {
    func delete(ids: [Int]) async
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `SessionListSource`: the resolved sessions
/// plus the load status, the live-state freshness, the in-flight flag, the last
/// update time, and the export date/vehicle scope inherited from the page filters.
public struct SessionListUpdate: Sendable, Equatable {
    public var status: SessionListLoadStatus
    public var items: [SessionListItem]
    public var connection: SessionListConnection
    public var refreshing: Bool
    public var updatedAt: Date?
    public var exportContext: SessionExportContext

    public init(
        status: SessionListLoadStatus = .loading,
        items: [SessionListItem] = [],
        connection: SessionListConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil,
        exportContext: SessionExportContext = SessionExportContext()
    ) {
        self.status = status
        self.items = items
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
        self.exportContext = exportContext
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8
/// charging state holder; previews/tests use `InMemorySessionListSource`. The view
/// never talks to the network directly.
@MainActor
public protocol SessionListSource: AnyObject {
    var onUpdate: (@MainActor (SessionListUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemorySessionListSource: SessionListSource {
    public var onUpdate: (@MainActor (SessionListUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SessionListUpdate?

    public init(initial: SessionListUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: SessionListUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Active-filter chip (web `ActiveFilterChips`)

/// One active-filter chip (web `FilterChipDescriptor`): a labeled, removable token
/// for the current search query or charger filter.
public struct SessionFilterChip: Sendable, Equatable, Identifiable {
    public enum Kind: String, Sendable, Equatable { case search, charger }

    public var kind: Kind
    public var label: String
    public var value: String

    public var id: String {
        kind.rawValue
    }

    public init(kind: Kind, label: String, value: String) {
        self.kind = kind
        self.label = label
        self.value = value
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected
/// localizer (`(key, fallback) -> String`) so the summaries are testable without a
/// bundle, exactly like the views' P1/S10 facade.
public enum SessionListAccessibility {
    /// The section header summary: title + filtered count.
    public static func sectionSummary(count: Int, localize: (String, String) -> String) -> String {
        let title = localize("charging.sessions.allSessions", "All Sessions")
        return "\(title): \(count)"
    }

    /// One row's VoiceOver label: date · charger · energy · cost · duration, each
    /// formatted through the same facade the row renders with.
    public static func rowLabel(
        _ item: SessionListItem,
        formatting: SessionListFormatting,
        localize: (String, String) -> String
    ) -> String {
        var parts: [String] = []
        parts.append(DateFormatter.sessionListMedium.string(from: item.startedAt))
        parts.append(localize(item.category.localizationKey, item.category.fallback))
        if item.energyKwh > 0 {
            parts.append("\(formatting.formatNumber(item.energyKwh)) kWh")
        }
        if let cost = item.costDecimal, cost > 0 {
            parts.append(formatting.formatCurrency(cost))
        } else if item.isFree {
            parts.append(localize("charging.free", "Free"))
        }
        if item.durationMinutes > 0 {
            parts.append(formatting.formatDuration(minutes: item.durationMinutes))
        }
        return parts.joined(separator: ", ")
    }
}

extension DateFormatter {
    /// A medium date + short time formatter for the row timestamp + a11y label.
    static let sessionListMedium: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()
}
