//
//  AlertStudioPage.Models.swift
//  TeslaSync — P4 feature view · 0192 · AlertStudioPage (Apple)
//
//  The `@Observable` read models the AlertStudioPage view-model binds (web
//  `useAlertRules` / `useNotificationChannels` / `useAlertMetrics`) and the CRUD
//  mutator seam (save / delete / toggle / test / snooze / bulk). No SwiftUI, no
//  direct networking — the view never talks to the network.
//

import Foundation
import Observation
import OSLog

// MARK: - Observable models (P1/S8 binding)

/// The observable view-model for the alert-rules feed. Subscribes to an `ASRulesSource`
/// and republishes its snapshot for SwiftUI to switch over. The view performs no
/// networking; `start`/`stop`/`refresh` delegate to the source.
@MainActor
@Observable
public final class ASRulesModel {
    public private(set) var snapshot: ASListSnapshot<ASAlertRule>
    @ObservationIgnored private let source: any ASRulesSource
    @ObservationIgnored private var started = false

    public init(source: any ASRulesSource) {
        self.source = source
        snapshot = ASListSnapshot()
        source.onUpdate = { [weak self] snapshot in self?.snapshot = snapshot }
    }

    public init(preview: ASListSnapshot<ASAlertRule>) {
        let inMemory = ASInMemoryRulesSource(initial: preview)
        source = inMemory
        snapshot = preview
        inMemory.onUpdate = { [weak self] snapshot in self?.snapshot = snapshot }
    }

    public var presentation: ASListPresentation<ASAlertRule> {
        .resolve(snapshot)
    }

    public var rules: [ASAlertRule] {
        snapshot.items
    }

    public func start() {
        guard !started else { return }
        started = true
        source.start()
    }

    public func stop() {
        started = false
        source.stop()
    }

    public func refresh() {
        source.refresh()
    }
}

/// The observable view-model for the notification-channels feed.
@MainActor
@Observable
public final class ASChannelsModel {
    public private(set) var snapshot: ASListSnapshot<ASNotificationChannel>
    @ObservationIgnored private let source: any ASChannelsSource
    @ObservationIgnored private var started = false

    public init(source: any ASChannelsSource) {
        self.source = source
        snapshot = ASListSnapshot()
        source.onUpdate = { [weak self] snapshot in self?.snapshot = snapshot }
    }

    public init(preview: ASListSnapshot<ASNotificationChannel>) {
        let inMemory = ASInMemoryChannelsSource(initial: preview)
        source = inMemory
        snapshot = preview
        inMemory.onUpdate = { [weak self] snapshot in self?.snapshot = snapshot }
    }

    public var presentation: ASListPresentation<ASNotificationChannel> {
        .resolve(snapshot)
    }

    public var channels: [ASNotificationChannel] {
        snapshot.items
    }

    public func start() {
        guard !started else { return }
        started = true
        source.start()
    }

    public func stop() {
        started = false
        source.stop()
    }

    public func refresh() {
        source.refresh()
    }
}

/// The observable view-model for the computed-metric registry feed.
@MainActor
@Observable
public final class ASMetricsModel {
    public private(set) var snapshot: ASListSnapshot<ASComputedMetricSummary>
    @ObservationIgnored private let source: any ASMetricsSource
    @ObservationIgnored private var started = false

    public init(source: any ASMetricsSource) {
        self.source = source
        snapshot = ASListSnapshot()
        source.onUpdate = { [weak self] snapshot in self?.snapshot = snapshot }
    }

    public init(preview: ASListSnapshot<ASComputedMetricSummary>) {
        let inMemory = ASInMemoryMetricsSource(initial: preview)
        source = inMemory
        snapshot = preview
        inMemory.onUpdate = { [weak self] snapshot in self?.snapshot = snapshot }
    }

    public var metrics: [ASComputedMetricSummary] {
        snapshot.items
    }

    public var presentation: ASListPresentation<ASComputedMetricSummary> {
        .resolve(snapshot)
    }

    /// Web `computedMetricsQuery.isLoading`.
    public var isLoading: Bool {
        snapshot.status == .loading && snapshot.items.isEmpty
    }

    public func start() {
        guard !started else { return }
        started = true
        source.start()
    }

    public func stop() {
        started = false
        source.stop()
    }
}

// MARK: - CRUD mutator seam (web mutation hooks)

/// The seven mutations the page drives. The view-model awaits a boolean result, then
/// refreshes the bound rules source on success (web invalidates the `alert-rules`
/// query). All networking lives behind this seam so the view never talks to the
/// network directly.
public protocol AlertStudioMutator: Sendable {
    /// Create or update a rule (web `useSaveAlertRule`). Returns success.
    func save(_ input: ASAlertRuleInput) async -> Bool
    /// Delete a rule by id (web `useDeleteAlertRule`). Returns success.
    func delete(id: Int64) async -> Bool
    /// Flip a rule's enabled flag (web `useToggleAlertRule`). Returns success.
    func toggle(id: Int64, enabled: Bool) async -> Bool
    /// Send a test notification (web `useTestAlertRule`). Returns success.
    func test(_ request: ASAlertTestRequest) async -> Bool
    /// Snooze a rule for N minutes; `0` clears (web `useSnoozeAlertRule`). Returns
    /// success.
    func snooze(id: Int64, minutes: Int) async -> Bool
    /// Bulk-enable a set of rules (web `useBulkEnableRules`). Returns success.
    func bulkEnable(ids: [Int64]) async -> Bool
    /// Bulk-disable a set of rules (web `useBulkDisableRules`). Returns success.
    func bulkDisable(ids: [Int64]) async -> Bool
}

/// `os.Logger`-backed default that records the intent without networking, so previews
/// render the CRUD chrome safely. Reports success so the bound source refreshes.
public struct OSLogAlertStudioMutator: AlertStudioMutator {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "alert-studio")
    }

    public func save(_ input: ASAlertRuleInput) async -> Bool {
        logger.info("alert-studio.save id=\(input.id.map(String.init) ?? "new", privacy: .public)")
        return true
    }

    public func delete(id: Int64) async -> Bool {
        logger.info("alert-studio.delete id=\(id, privacy: .public)")
        return true
    }

    public func toggle(id: Int64, enabled: Bool) async -> Bool {
        logger.info("alert-studio.toggle id=\(id, privacy: .public) enabled=\(enabled, privacy: .public)")
        return true
    }

    public func test(_ request: ASAlertTestRequest) async -> Bool {
        logger.info("alert-studio.test includeTitle=\(request.includeTitle, privacy: .public)")
        return true
    }

    public func snooze(id: Int64, minutes: Int) async -> Bool {
        logger.info("alert-studio.snooze id=\(id, privacy: .public) minutes=\(minutes, privacy: .public)")
        return true
    }

    public func bulkEnable(ids: [Int64]) async -> Bool {
        logger.info("alert-studio.bulkEnable count=\(ids.count, privacy: .public)")
        return true
    }

    public func bulkDisable(ids: [Int64]) async -> Bool {
        logger.info("alert-studio.bulkDisable count=\(ids.count, privacy: .public)")
        return true
    }
}
