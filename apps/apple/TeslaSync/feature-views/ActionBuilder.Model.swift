//
//  ActionBuilder.Model.swift
//  TeslaSync — P4 feature view · 0080 · ActionBuilder (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) for the
//  automation ActionBuilder. The view binds through `ActionBuilderModel`, which owns
//  the editable list of action steps (the web `actions` prop the parent controls),
//  exposes the derived channel/default-channel projections, and hands the parent a
//  fresh `[AutomationAction]` on every mutation (the web `onChange` callback). No
//  networking lives here — this is a controlled form, exactly like the web component.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// logs via `os.Logger`; production injects an adapter that forwards to the
/// shared-core `Telemetry.track(.screenView(screen:…))` (ADR-016).
public protocol ActionBuilderTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogActionBuilderTelemetry: ActionBuilderTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "ActionBuilder" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time.
public enum ActionBuilderStrings {
    public static let table = "ActionBuilder"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// A `(key, fallback) -> String` localizer for the SwiftUI-free adapter projections.
    public static func localize(_ key: String, _ fallback: String) -> String {
        string(key, fallback)
    }
}

// MARK: - Identified row (stable identity for reorder/remove)

/// An action wrapped with a stable identity so SwiftUI `ForEach` tracks rows across
/// moves/removes (the web keys by `kind-index`; native uses a UUID for smoother
/// reordering while emitting the same `[AutomationAction]` data on change).
public struct IdentifiedAction: Identifiable, Sendable, Equatable {
    public let id: UUID
    public var action: AutomationAction

    public init(id: UUID = UUID(), action: AutomationAction) {
        self.id = id
        self.action = action
    }
}

/// The direction a row moves (web `moveAction(index, -1 | 1)`).
public enum MoveDirection: Sendable, Equatable {
    case up, down

    var delta: Int {
        self == .up ? -1 : 1
    }
}

// MARK: - State holder (P1/S8 layer)

/// The ActionBuilder's observable view-model. Owns the editable action list (web
/// `actions`), derives the channel options + default channel, applies the same
/// add/remove/replace/move mutations the web callbacks do, and emits the updated
/// list to the host on every change. Emits the `view.opened` diagnostics event once.
@MainActor
@Observable
public final class ActionBuilderModel {
    /// The editable action rows (web `actions`, with stable identity).
    public private(set) var rows: [IdentifiedAction]

    /// The notification channels available to notify actions (web `channels` prop).
    public let channels: [NotificationChannelSummary]

    @ObservationIgnored private let telemetry: any ActionBuilderTelemetry
    @ObservationIgnored private let onChange: ([AutomationAction]) -> Void
    @ObservationIgnored private var started = false

    public init(
        actions: [AutomationAction] = [],
        channels: [NotificationChannelSummary] = [],
        telemetry: any ActionBuilderTelemetry = OSLogActionBuilderTelemetry(),
        onChange: @escaping ([AutomationAction]) -> Void = { _ in }
    ) {
        rows = actions.map { IdentifiedAction(action: $0) }
        self.channels = channels
        self.telemetry = telemetry
        self.onChange = onChange
    }

    /// The current action values (web `actions`), stripped of identity.
    public var actions: [AutomationAction] {
        rows.map(\.action)
    }

    /// Web `defaultChannelId` memo.
    public var defaultChannelID: Int {
        ActionBuilderAdapter.defaultChannelID(in: channels)
    }

    /// Web `channelOptions` memo.
    public var channelOptions: [ChannelOption] {
        ActionBuilderAdapter.channelOptions(channels)
    }

    /// The 1-based position of a row, for the index label + move guards.
    public func index(of id: UUID) -> Int? {
        rows.firstIndex { $0.id == id }
    }

    /// Web `moveAction` guard: whether a row can move in the given direction.
    public func canMove(id: UUID, _ direction: MoveDirection) -> Bool {
        guard let index = index(of: id) else { return false }
        return rows.indices.contains(index + direction.delta)
    }

    /// Web `addAction`: append a default command action seeded with the default channel.
    public func addAction() {
        let action = ActionBuilderAdapter.defaultAction(.command, channelID: defaultChannelID)
        rows.append(IdentifiedAction(action: action))
        emit()
    }

    /// Web `removeAction(index)`.
    public func removeAction(id: UUID) {
        rows.removeAll { $0.id == id }
        emit()
    }

    /// Web `replaceAction(index, nextAction)`.
    public func replaceAction(id: UUID, with action: AutomationAction) {
        guard let index = index(of: id) else { return }
        rows[index].action = action
        emit()
    }

    /// Web action-type select: replace with a fresh default of the chosen kind.
    public func changeKind(id: UUID, to kind: AutomationActionKind) {
        replaceAction(id: id, with: ActionBuilderAdapter.defaultAction(kind, channelID: defaultChannelID))
    }

    /// Web `moveAction(index, direction)`: swap with the neighbor, if in range.
    public func moveAction(id: UUID, _ direction: MoveDirection) {
        guard let index = index(of: id) else { return }
        let target = index + direction.delta
        guard rows.indices.contains(target) else { return }
        rows.swapAt(index, target)
        emit()
    }

    /// Emits the `view.opened` diagnostics event exactly once. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ActionBuilderSurface.slug)
    }

    private func emit() {
        onChange(rows.map(\.action))
    }
}
