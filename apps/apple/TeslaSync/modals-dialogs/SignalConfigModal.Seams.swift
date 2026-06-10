//
//  SignalConfigModal.Seams.swift
//  TeslaSync — P4 modal / dialog · 0016 · SignalConfigModal (Apple)
//
//  The dependency seams the SignalConfigModal view-model binds through, kept apart from the model for
//  the lint length budget: the P1/S11 telemetry contract, the action seam (web `onSubmit` +
//  `onClose`), the coalesced source snapshot (the available-signal catalog + initial selection +
//  default interval + freshness), the P1/S8 source protocol, the in-memory source for previews/tests,
//  the P1/S10 i18n facade (web has hardcoded English; native routes every string through a key), and
//  the VoiceOver string builders.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there).
public protocol SignalConfigTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. The slug is a
/// static, non-identifying constant.
public struct OSLogSignalConfigTelemetry: SignalConfigTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Action seam (web `onSubmit` + `onClose`)

/// The two commands the modal drives — committing the chosen subscriptions (web
/// `onSubmit(signals)` then `onClose()`) and cancelling (web `onClose()`). The default logs the
/// intent without networking so previews render safely; the production app injects an adapter over
/// the real Fleet Telemetry subscribe mutation + the sheet dismissal.
public protocol SignalConfigActions: Sendable {
    func subscribe(_ subscriptions: [SignalConfigSubscription])
    func cancel()
}

/// `os.Logger`-backed default that records the intents without networking or dismissal.
public struct OSLogSignalConfigActions: SignalConfigActions {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "telemetry")
    }

    public func subscribe(_ subscriptions: [SignalConfigSubscription]) {
        logger.info(
            "signals.subscribe surface=\(SignalConfigSurface.slug, privacy: .public) count=\(subscriptions.count)"
        )
    }

    public func cancel() {
        logger.info("signals.cancel surface=\(SignalConfigSurface.slug, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `SignalConfigSource`: the catalog load status, the
/// available-signal catalog (web `categories`), the pre-selected signal names (web
/// `initialSelected`), the default cadence (web `initialInterval`), the live-state freshness, the
/// in-flight refresh flag, and the last-updated timestamp.
public struct SignalConfigUpdate: Sendable, Equatable {
    public var status: SignalConfigLoadStatus
    public var catalog: [SignalConfigCategoryCatalog]
    public var initialSelected: [String]
    public var initialInterval: Int
    public var connection: SignalConfigConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: SignalConfigLoadStatus = .loading,
        catalog: [SignalConfigCategoryCatalog] = [],
        initialSelected: [String] = [],
        initialInterval: Int = SignalConfigCatalog.defaultIntervalValue,
        connection: SignalConfigConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.catalog = catalog
        self.initialSelected = initialSelected
        self.initialInterval = initialInterval
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }

    /// A stable identity for the catalog's signal set — the model rebuilds the editable draft only
    /// when this changes, so a pure freshness flip (live → stale) preserves the operator's edits.
    public var catalogSignature: [String] {
        catalog.flatMap { category in category.fields.map { "\(category.category)/\($0)" } }
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 state holders —
/// the available-signal catalog query plus the operator's current subscription as the initial
/// selection + default interval — and reports live-state freshness. Previews/tests use
/// `InMemorySignalConfigSource`. The view never talks to the network.
@MainActor
public protocol SignalConfigSource: AnyObject {
    var onUpdate: (@MainActor (SignalConfigUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the catalog query (web parent refetch / the error-state retry / the stale refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemorySignalConfigSource: SignalConfigSource {
    public var onUpdate: (@MainActor (SignalConfigUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SignalConfigUpdate?

    public init(initial: SignalConfigUpdate? = nil) {
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
    public func push(_ update: SignalConfigUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web hardcoded copy → keyed strings

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "SignalConfigModal" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings.
public enum SignalConfigStrings {
    public static let table = "SignalConfigModal"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Convenience for body interpolation (`{{count}}` etc.): resolves then substitutes one token.
    public static func string(
        _ key: String,
        _ fallback: String,
        _ token: String,
        _ value: String
    ) -> String {
        string(key, fallback).replacingOccurrences(of: token, with: value)
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the
/// summaries are testable without a bundle.
public enum SignalConfigAccessibility {
    /// The dialog's container label (web Modal `title`).
    public static func dialogLabel(localize: (String, String) -> String) -> String {
        localize("signals.config.title", "Fleet Telemetry Signal Configuration")
    }

    /// The "{selected} of {total} signals selected" status (web `{selectedCount} / {totalCount}`).
    public static func selectionSummary(
        selected: Int,
        total: Int,
        localize: (String, String) -> String
    ) -> String {
        localize("signals.config.selectionSummary", "{{selected}} of {{total}} signals selected")
            .replacingOccurrences(of: "{{selected}}", with: String(selected))
            .replacingOccurrences(of: "{{total}}", with: String(total))
    }

    /// The select-all toggle's label (web "Select All" / "Deselect All").
    public static func selectAllToggleLabel(allSelected: Bool, localize: (String, String) -> String) -> String {
        allSelected
            ? localize("signals.config.deselectAll", "Deselect All")
            : localize("signals.config.selectAll", "Select All")
    }

    /// One signal row's VoiceOver label: the field name, its selection state, and its cadence.
    public static func rowLabel(
        name: String,
        selected: Bool,
        intervalLabel: String,
        localize: (String, String) -> String
    ) -> String {
        let state = selected
            ? localize("signals.config.selected", "Selected")
            : localize("signals.config.notSelected", "Not selected")
        let cadence = localize("signals.config.everyInterval", "every {{interval}}")
            .replacingOccurrences(of: "{{interval}}", with: intervalLabel)
        return "\(name), \(state), \(cadence)"
    }

    /// A category header's VoiceOver label: the name, its tri-state, and the selected/total tally.
    public static func categoryLabel(
        category: String,
        state: SignalConfigCategoryState,
        selected: Int,
        total: Int,
        localize: (String, String) -> String
    ) -> String {
        let stateWord: String = switch state {
        case .all: localize("signals.config.allSelected", "All selected")
        case .some: localize("signals.config.someSelected", "Some selected")
        case .none: localize("signals.config.noneSelected", "None selected")
        }
        let tally = localize("signals.config.categoryTally", "{{selected}} of {{total}}")
            .replacingOccurrences(of: "{{selected}}", with: String(selected))
            .replacingOccurrences(of: "{{total}}", with: String(total))
        return "\(category), \(stateWord), \(tally)"
    }

    /// A preset button's VoiceOver label: its name plus its description hint.
    public static func presetLabel(name: String, detail: String) -> String {
        "\(name). \(detail)"
    }
}
