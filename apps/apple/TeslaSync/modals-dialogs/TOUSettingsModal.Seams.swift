//
//  TOUSettingsModal.Seams.swift
//  TeslaSync — P4 modal / dialog · 0021 · TOUSettingsModal (Apple)
//
//  The dependency seams the TOUSettingsModal view-model binds through, kept apart from the model for the
//  lint length budget: the P1/S11 telemetry contract, the update / cancel control seam (web
//  `useUpdateTOUSettings` + the `handleClose`), the coalesced energy-site source snapshot, the P1/S8
//  source protocol, the in-memory source for previews/tests, the P1/S10 i18n facade (web
//  `useTranslation`), and the VoiceOver string builders. Foundation + OSLog only — no view, no network.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared core `Telemetry.track(.screenView(…))`
/// (ADR-016), consent-gated + redacted there.
public protocol TOUSettingsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogTOUSettingsTelemetry: TOUSettingsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Update / cancel control seam (web `useUpdateTOUSettings` / `handleClose`)

/// The dialog's command seam. `update` is the web `updateMutation.mutate({ siteId, settings })` (the
/// POST to `/tesla/energy-sites/{siteId}/tou-settings`), reporting completion back through `onResult`
/// (web `onSuccess` / `onError`). `cancel` is the web `handleClose`. Keeps the network out of the view;
/// the production app injects an adapter driving the real mutation, previews/tests use the defaults.
@MainActor
public protocol TOUSettingsController: AnyObject {
    /// Delivers the update outcome (web `onSuccess` → `.success`, `onError` → `.failure(message)`).
    var onResult: (@MainActor (TOUSubmitResult) -> Void)? { get set }
    func update(payload: TOUSettingsPayload, siteId: Int)
    func cancel()
}

/// `os.Logger`-backed default that records the intents without a network call and optimistically
/// reports success, so a standalone surface completes rather than hangs. Production injects the real
/// mutation adapter; previews/tests inject their own controllers.
@MainActor
public final class OSLogTOUSettingsController: TOUSettingsController {
    public var onResult: (@MainActor (TOUSubmitResult) -> Void)?
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "energy")
    }

    public func update(payload _: TOUSettingsPayload, siteId: Int) {
        let slug = TOUSettingsSurface.slug
        logger.info("tou.update site=\(siteId, privacy: .public) surface=\(slug, privacy: .public)")
        onResult?(.success)
    }

    public func cancel() {
        let slug = TOUSettingsSurface.slug
        logger.info("tou.cancel surface=\(slug, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `TOUSettingsSource`: the load status, the resolved energy-site
/// context (the `energy_site_id` + name + TOU-capability), the live-state freshness, and the in-flight
/// flag.
public struct TOUSettingsUpdate: Sendable, Equatable {
    public var status: TOUSettingsLoadStatus
    public var context: TOUSettingsContext?
    public var connection: TOUSettingsConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: TOUSettingsLoadStatus = .loading,
        context: TOUSettingsContext? = nil,
        connection: TOUSettingsConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.context = context
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 state holders —
/// resolving the energy-site context (web `useEnergy`) + the live-state freshness, plus a refresh
/// affordance (web `useRefreshTeslaEnergySiteInfo`). Previews/tests use `InMemoryTOUSettingsSource`. The
/// view never reads the network directly.
@MainActor
public protocol TOUSettingsSource: AnyObject {
    var onUpdate: (@MainActor (TOUSettingsUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-resolves the site context + freshness (web refetch / the stale auto-refresh / post-save refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and lets
/// a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryTOUSettingsSource: TOUSettingsSource {
    public var onUpdate: (@MainActor (TOUSettingsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: TOUSettingsUpdate?

    public init(initial: TOUSettingsUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { push(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: TOUSettingsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "TOUSettingsModal" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum TOUSettingsStrings {
    public static let table = "TOUSettingsModal"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the summaries
/// are testable without a bundle.
public enum TOUSettingsAccessibility {
    /// The dialog container label (web `Modal` `aria-labelledby` heading → "Update Rate Plan").
    public static func dialogLabel(localize: (String, String) -> String) -> String {
        localize("energy.tou.title", "Update Rate Plan")
    }

    /// One tab's VoiceOver label, with the selected state appended so the segment reads its status.
    public static func tabLabel(
        title: String,
        selected: Bool,
        localize: (String, String) -> String
    ) -> String {
        guard selected else { return title }
        let selectedWord = localize("tou.selected", "selected")
        return "\(title), \(selectedWord)"
    }

    /// The preset picker's VoiceOver label: the field name + the current selection (or the prompt copy).
    public static func presetLabel(
        field: String,
        selection: String
    ) -> String {
        "\(field), \(selection)"
    }
}
