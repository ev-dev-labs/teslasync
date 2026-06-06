import Foundation

/// The lifecycle of a queued vehicle command, surfaced in the command Live
/// Activity and (optionally) a foreground toast.
public enum CommandActivityStatus: String, Codable, Hashable, Sendable {
    case pending
    case sent
    case executing
    case succeeded
    case failed

    /// Whether the command has reached a terminal state (the activity should end).
    public var isTerminal: Bool {
        self == .succeeded || self == .failed
    }
}

/// ActivityKit attributes for a **command execution** Live Activity (e.g. "Climate
/// On", "Open Trunk"): a short-lived activity that tracks a queued command to its
/// terminal state.
public struct CommandActivityAttributes: Codable, Hashable, Sendable {
    public let vehicleName: String
    public let commandName: String

    public init(vehicleName: String, commandName: String) {
        self.vehicleName = vehicleName
        self.commandName = commandName
    }

    public struct ContentState: Codable, Hashable, Sendable {
        public var status: CommandActivityStatus
        public var message: String?

        public init(status: CommandActivityStatus, message: String? = nil) {
            self.status = status
            self.message = message
        }
    }
}

#if os(iOS)
    import ActivityKit

    @available(iOS 16.1, *)
    extension CommandActivityAttributes: ActivityAttributes {}
#endif
