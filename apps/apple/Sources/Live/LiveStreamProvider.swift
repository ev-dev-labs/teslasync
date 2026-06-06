import Foundation

/// A live event delivered to the store: the originating SSE `id` (for
/// `Last-Event-ID` resume), its `kind`, the wall-clock time it arrived, and the
/// typed payload. Generic over `Event` so production carries `LiveFleetEvent`
/// while tests/previews carry any `Sendable` value with zero KMP objects.
public struct LiveEnvelope<Event: Sendable>: Sendable {
    /// The SSE `id:` of the frame, when present, so the store can resume with it.
    public let id: String?
    /// Routing discriminator (mirrors the facade `LiveEventKind`).
    public let kind: LiveEventKind
    /// When the event was received locally — drives the freshness clock.
    public let receivedAt: Date
    /// The typed payload.
    public let payload: Event

    public init(id: String?, kind: LiveEventKind, receivedAt: Date, payload: Event) {
        self.id = id
        self.kind = kind
        self.receivedAt = receivedAt
        self.payload = payload
    }
}

/// One element of a live stream. A subscription yields connection-state
/// transitions and typed events, and ends with a single terminal `failed` when
/// the stream cannot continue (so the store can run its auth-refresh/retry
/// policy). The shared client's own transient reconnects surface as
/// `.connection(.reconnecting)` and never terminate the Swift stream.
public enum LiveStreamElement<Event: Sendable>: Sendable {
    case connection(LiveConnectionState)
    case event(LiveEnvelope<Event>)
    case failed(FacadeError)
}

/// The seam the live store subscribes through. Closure-based (rather than a
/// protocol with an associated type) so it composes as a value, fakes trivially
/// in tests, and stays Shared-free: production builds one wrapping the KMP
/// `SseClient` (`SharedLiveStreamProvider`); tests pass a scripted `AsyncStream`.
///
/// `open` returns a cold stream — subscribing starts the connection; the store
/// cancels by terminating its iteration (background/disappear). `resumeToken` is
/// the last seen SSE `id`, forwarded so a re-subscription resumes with
/// `Last-Event-ID` across foreground cycles.
public struct LiveStreamProvider<Event: Sendable>: Sendable {
    public typealias Open = @Sendable (
        _ target: LiveStreamTarget,
        _ resumeToken: String?
    ) -> AsyncStream<LiveStreamElement<Event>>

    private let openStream: Open

    public init(open: @escaping Open) {
        openStream = open
    }

    /// Opens a cold subscription to `target`, resuming from `resumeToken` when set.
    public func open(
        _ target: LiveStreamTarget,
        resumingFrom resumeToken: String? = nil
    ) -> AsyncStream<LiveStreamElement<Event>> {
        openStream(target, resumeToken)
    }
}
