import Foundation

/// The seam the `LiveActivityController` drives ActivityKit through. Non-generic so
/// it fakes trivially in tests (no ActivityKit runtime): production uses
/// `SystemLiveActivityPresenter` on iOS 16.2+; everywhere else the controller falls
/// back to `NoopLiveActivityPresenter` so unsupported platforms degrade honestly.
public protocol LiveActivityPresenting: Sendable {
    /// Whether Live Activities can actually be presented right now (OS supports them
    /// and the user has not disabled them).
    var isSupported: Bool { get }

    /// Starts an activity; returns its system id, or `nil` when unsupported/disabled
    /// or the request was rejected.
    func start(_ request: LiveActivityRequest) async -> String?

    /// Updates a running activity's content state.
    func update(kind: LiveActivityKind, id: String, state: LiveActivityState) async

    /// Ends a running activity, optionally with a final content state.
    func end(kind: LiveActivityKind, id: String, finalState: LiveActivityState?) async
}

/// The honest no-op presenter for macOS and OS versions without ActivityKit: it
/// reports `isSupported == false` and silently ignores all calls (renders no
/// stand-in UI and never crashes). The controller selects it automatically off the
/// supported path.
public struct NoopLiveActivityPresenter: LiveActivityPresenting {
    public init() {}

    public var isSupported: Bool {
        false
    }

    public func start(_: LiveActivityRequest) async -> String? {
        nil
    }

    public func update(kind _: LiveActivityKind, id _: String, state _: LiveActivityState) async {}

    public func end(kind _: LiveActivityKind, id _: String, finalState _: LiveActivityState?) async {}
}
