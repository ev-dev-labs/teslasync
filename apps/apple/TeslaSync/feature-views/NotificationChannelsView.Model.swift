//
//  NotificationChannelsView.Model.swift
//  TeslaSync — P4 feature view · 0188 · NotificationChannelsView (Apple)
//
//  The surface identity (P1/S11 slug), the telemetry seam (P1/S11 `view.opened`), the
//  state-holder seam (P1/S8), the observable view-model, and the in-memory source for
//  previews/tests. The view binds through `NotificationChannelsModel`; no networking
//  lives in the view. The model owns the list/stats snapshot and the four mutations the
//  web component drives through TanStack hooks (`useToggleChannel`, `useTestChannel`,
//  `useDeleteChannel`, and — via the form — `useSaveChannel`), surfacing their
//  success/failure as the web `useToast` feedback.
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable, non-identifying identity for the `NotificationChannelsView` surface. The slug
/// is emitted with the P1/S11 `view.opened` contract and referenced by the view + tests
/// so the two never drift.
public enum NotificationChannelsSurface {
    public static let slug = "NotificationChannelsView"

    /// Reports the surface becoming visible. Factored out of the view's lifecycle so it
    /// is unit-testable without a rendering host.
    public static func reportOpen(to telemetry: any NotificationChannelsTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Diagnostics seam for the P1/S11 `view.opened` contract. The model reports the
/// surface's appearance through this protocol so production wiring, previews, and tests
/// can each supply their own sink.
public protocol NotificationChannelsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// Default sink: emits a redaction-safe `view.opened` `os_log` event. The slug is a
/// static, non-identifying constant logged verbatim; no channel name or secret is recorded.
public struct OSLogNotificationChannelsTelemetry: NotificationChannelsTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// One mutating action the source performs — used by the in-memory source to inject
/// failures for the error-path tests.
public enum ChannelSourceAction: Sendable, Equatable {
    case save
    case test
    case toggle
    case delete
}

/// The seam the view binds through. Production implements this over the notifications
/// channel + stats queries and the four channel mutations; previews/tests use
/// `InMemoryNotificationChannelsSource`. The view never talks to the network directly.
@MainActor
public protocol NotificationChannelsSource: AnyObject {
    /// Pushes a coalesced snapshot (channels + stats + lifecycle) to the bound model.
    var onUpdate: (@MainActor (NotifChannelsInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()

    func save(_ payload: NotificationChannelInput) async throws
    func test(_ channelID: Int64) async throws -> ChannelTestResult
    func toggle(_ channelID: Int64) async throws
    func delete(_ channelID: Int64) async throws
}

// MARK: - View-model

/// The surface's observable view-model. Subscribes to a `NotificationChannelsSource`,
/// recomputes the resolved projection, exposes the render `phase` + the `connection`
/// axis, tracks per-row in-flight mutations, and publishes the latest toast. Auto-refreshes
/// once when the feed transitions to stale (web parent re-fetch).
@MainActor
@Observable
public final class NotificationChannelsModel {
    public private(set) var resolved = NotifChannelsProjection.resolve(NotifChannelsInput(isLoading: true))
    public private(set) var connection: NotifChannelsConnection = .live
    public private(set) var toast: NotifToast?
    public private(set) var togglingChannelID: Int64?
    public private(set) var testingChannelID: Int64?
    public private(set) var deletingChannelID: Int64?
    public private(set) var formModel: ChannelFormModel?

    public var phase: NotifChannelsResolved.Phase {
        resolved.phase
    }

    public var isFormPresented: Bool {
        formModel != nil
    }

    @ObservationIgnored private let source: any NotificationChannelsSource
    @ObservationIgnored private let telemetry: any NotificationChannelsTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any NotificationChannelsSource,
        telemetry: any NotificationChannelsTelemetry = OSLogNotificationChannelsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        NotificationChannelsSurface.reportOpen(to: telemetry)
        source.start()
    }

    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (header refresh button + error retry).
    public func refresh() {
        source.refresh()
    }

    public func dismissToast() {
        toast = nil
    }

    // MARK: Per-row in-flight helpers (web `testMut.variables === ch.id`)

    public func isToggling(_ channelID: Int64) -> Bool {
        togglingChannelID == channelID
    }

    public func isTesting(_ channelID: Int64) -> Bool {
        testingChannelID == channelID
    }

    public func isDeleting(_ channelID: Int64) -> Bool {
        deletingChannelID == channelID
    }

    // MARK: Form presentation (web `showForm` + `editingChannel`)

    public func presentAdd() {
        formModel = makeForm(editing: nil)
    }

    public func presentEdit(_ channel: NotificationChannelData) {
        formModel = makeForm(editing: channel)
    }

    public func dismissForm() {
        formModel = nil
    }

    private func makeForm(editing channel: NotificationChannelData?) -> ChannelFormModel {
        ChannelFormModel(source: source, editing: channel) { [weak self] in
            self?.handleFormSaved()
        }
    }

    /// Web `onSaved`: close the modal; the channel list re-fetches (query invalidation).
    private func handleFormSaved() {
        dismissForm()
        refresh()
    }

    // MARK: Mutations (web card `toggleMut` / `testMut` / `deleteMut`)

    /// Web toggle: flips enabled; success copy reflects the pre-toggle state.
    public func toggle(_ channel: NotificationChannelData) async {
        togglingChannelID = channel.id
        defer { togglingChannelID = nil }
        do {
            try await source.toggle(channel.id)
            let key = channel.enabled ? "notifications.channels.toggledOff" : "notifications.channels.toggledOn"
            let fallback = channel.enabled ? "Channel disabled" : "Channel enabled"
            successToast(NotifChannelsStrings.string(key, fallback))
            refresh()
        } catch {
            dangerToast(NotifChannelsStrings.string("notifications.channels.toggleFailed", "Failed to toggle channel"))
        }
    }

    /// Web card test: success ⇒ "name: Test sent!"; failure ⇒ "name: Test failed".
    public func test(_ channel: NotificationChannelData) async {
        testingChannelID = channel.id
        defer { testingChannelID = nil }
        do {
            let result = try await source.test(channel.id)
            if result.success {
                successToast(prefixed(channel.name, "notifications.channels.testSuccessShort", "Test sent!"))
            } else {
                dangerToast(prefixed(channel.name, "notifications.channels.testFailed", "Test failed"))
            }
        } catch {
            dangerToast(prefixed(channel.name, "notifications.channels.testFailed", "Test failed"))
        }
    }

    /// Web delete: success ⇒ "Channel deleted"; failure ⇒ "Failed to delete channel".
    public func delete(_ channel: NotificationChannelData) async {
        deletingChannelID = channel.id
        defer { deletingChannelID = nil }
        do {
            try await source.delete(channel.id)
            successToast(NotifChannelsStrings.string("notifications.channels.deleted", "Channel deleted"))
            refresh()
        } catch {
            dangerToast(NotifChannelsStrings.string("notifications.channels.deleteFailed", "Failed to delete channel"))
        }
    }

    // MARK: Internals

    private func apply(_ input: NotifChannelsInput) {
        resolved = NotifChannelsProjection.resolve(input)
        let previous = connection
        connection = input.connection
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func prefixed(_ name: String, _ key: String, _ fallback: String) -> String {
        "\(name): \(NotifChannelsStrings.string(key, fallback))"
    }

    private func successToast(_ message: String) {
        toast = NotifToast(tone: .success, message: message)
    }

    private func dangerToast(_ message: String) {
        toast = NotifToast(tone: .danger, message: message)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit tests. Drive reads with `push(_:)`; configure
/// `testResult` + `failingActions` to exercise the mutation success/failure branches.
@MainActor
public final class InMemoryNotificationChannelsSource: NotificationChannelsSource {
    public var onUpdate: (@MainActor (NotifChannelsInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var savedPayloads: [NotificationChannelInput] = []
    public private(set) var toggledIDs: [Int64] = []
    public private(set) var deletedIDs: [Int64] = []
    public private(set) var testedIDs: [Int64] = []

    public var testResult: ChannelTestResult
    public var failingActions: Set<ChannelSourceAction>

    private let initial: NotifChannelsInput?

    public init(
        initial: NotifChannelsInput? = nil,
        testResult: ChannelTestResult = ChannelTestResult(success: true),
        failingActions: Set<ChannelSourceAction> = []
    ) {
        self.initial = initial
        self.testResult = testResult
        self.failingActions = failingActions
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

    public func save(_ payload: NotificationChannelInput) async throws {
        savedPayloads.append(payload)
        try failIfNeeded(.save)
    }

    public func test(_ channelID: Int64) async throws -> ChannelTestResult {
        testedIDs.append(channelID)
        try failIfNeeded(.test)
        return testResult
    }

    public func toggle(_ channelID: Int64) async throws {
        toggledIDs.append(channelID)
        try failIfNeeded(.toggle)
    }

    public func delete(_ channelID: Int64) async throws {
        deletedIDs.append(channelID)
        try failIfNeeded(.delete)
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: NotifChannelsInput) {
        onUpdate?(input)
    }

    private func failIfNeeded(_ action: ChannelSourceAction) throws {
        if failingActions.contains(action) {
            throw InMemoryChannelSourceError.injected(action)
        }
    }
}

/// The error the in-memory source throws for an injected failure.
public enum InMemoryChannelSourceError: Error, Equatable {
    case injected(ChannelSourceAction)
}
