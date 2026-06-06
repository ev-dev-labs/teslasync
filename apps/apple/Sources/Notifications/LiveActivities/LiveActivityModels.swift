import Foundation

/// The three Live Activity kinds TeslaSync drives.
public enum LiveActivityKind: String, CaseIterable, Sendable {
    case charging
    case drive
    case command
}

/// A type-erased start request, so the `LiveActivityPresenting` seam stays a small
/// non-generic protocol while the system presenter reconstructs the typed
/// `ActivityKit` call. Carries the static attributes + the initial content state.
public enum LiveActivityRequest: Sendable {
    case charging(ChargingActivityAttributes, ChargingActivityAttributes.ContentState)
    case drive(DriveActivityAttributes, DriveActivityAttributes.ContentState)
    case command(CommandActivityAttributes, CommandActivityAttributes.ContentState)

    public var kind: LiveActivityKind {
        switch self {
        case .charging: .charging
        case .drive: .drive
        case .command: .command
        }
    }

    /// The initial content state, erased — used when a start request targets an
    /// already-running activity (it folds into an update).
    public var state: LiveActivityState {
        switch self {
        case let .charging(_, state): .charging(state)
        case let .drive(_, state): .drive(state)
        case let .command(_, state): .command(state)
        }
    }
}

/// A type-erased content-state update for the `LiveActivityPresenting` seam.
public enum LiveActivityState: Sendable, Equatable {
    case charging(ChargingActivityAttributes.ContentState)
    case drive(DriveActivityAttributes.ContentState)
    case command(CommandActivityAttributes.ContentState)

    public var kind: LiveActivityKind {
        switch self {
        case .charging: .charging
        case .drive: .drive
        case .command: .command
        }
    }
}
