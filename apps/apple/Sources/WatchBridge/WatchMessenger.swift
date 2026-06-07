import Foundation

/// The send side of the WatchConnectivity link, abstracted so the phone and watch
/// coordinators can be driven by a fake in tests/previews and so platforms without
/// WatchConnectivity (macOS) still compile. Main-actor isolated because the
/// coordinators that own it are.
@MainActor
public protocol WatchMessenger: AnyObject {
    /// Whether the counterpart device is reachable right now for an interactive
    /// message. The application-context channel works regardless.
    var isReachable: Bool { get }

    /// Pushes the latest state as the coalesced application context — delivered when
    /// the counterpart next wakes. This is the honest "no background stream"
    /// channel: only the most recent state survives, never a backlog.
    func updateContext(_ context: [String: Any])

    /// Sends an interactive message (reachable → live; otherwise queued for
    /// background delivery). Fire-and-forget; replies arrive as their own message.
    func sendMessage(_ message: [String: Any])
}

/// The receive side: the coordinator the live link forwards decoded, `Sendable`
/// events to. Keeping the events typed (not raw dictionaries) means nothing
/// non-`Sendable` ever crosses the actor hop from the WatchConnectivity queue.
@MainActor
public protocol WatchLinkReceiver: AnyObject {
    func didReceivePayload(_ payload: WatchSyncPayload)
    func didReceiveCommandRequest(_ request: WatchCommandRequest)
    func didReceiveCommandResult(_ result: WatchCommandResult)
    func didReceiveRefreshRequest()
    func reachabilityDidChange(_ isReachable: Bool)
}

/// A no-op messenger for previews, tests, and platforms without WatchConnectivity.
/// Reports unreachable and drops everything, so a coordinator degrades to its
/// cached state honestly.
@MainActor
public final class InertWatchMessenger: WatchMessenger {
    public init() {}
    public var isReachable: Bool {
        false
    }

    public func updateContext(_: [String: Any]) {}
    public func sendMessage(_: [String: Any]) {}
}
