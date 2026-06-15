import Foundation
import Observation

// MARK: - Live source seam (web `useLogStream` SSE transport)

/// The seam the page subscribes through for the live log tail (web `useLogStream`, backed by
/// `GET /admin/logs/stream`). Closure-of-stream shaped so it composes as a value, fakes
/// trivially in tests/previews, and stays KMP-`Shared`-free: production wraps the shared SSE
/// client (ADR-004/009), tests pass a scripted `AsyncStream`. `open` returns a cold stream —
/// subscribing starts the connection; the model cancels by ending its iteration (the page
/// `.task` tears down on navigate-away / filter change, web effect cleanup `controller.abort`).
public protocol LiveLogsStreaming: Sendable {
    func open(level: LiveLogLevel, grep: String) -> AsyncStream<LiveLogStreamElement>
}

// MARK: - Page model

/// The `@Observable` state holder the `LiveLogsPage` binds to (ADR-004 — no networking in the
/// view). Owns the rolling event buffer, the connection status, the server-drop + received
/// counters, the level/grep/vehicle filters, and the pause / auto-scroll / enabled controls,
/// reading the live tail through the injected `LiveLogsStreaming` seam. Mirrors the web
/// `useLogStream` result + the page's local `useState` exactly: pausing holds the buffer
/// without dropping the connection; the vehicle filter is client-side; level/grep restart the
/// subscription.
@MainActor
@Observable
public final class LiveLogsPageModel {
    /// Web `LOG_STREAM_MAX_EVENTS` — the rolling client buffer ceiling (FIFO eviction).
    public static let maxEvents = 1000

    /// ADR-013 freshness window — visible data older than this with no new event is flagged
    /// stale (never hidden). Matches `LiveStalenessPolicy.standard` (120s).
    public static let stalenessWindow: TimeInterval = 120

    // Filters (web URL/local state). `grepDraft` is the in-progress field; `grep` is the
    // applied (committed) expression that actually restarts the server-side subscription.
    public var level: LiveLogLevel = .info
    public var grepDraft = ""
    public private(set) var grep = ""
    public var vehicleFilter = ""

    // Controls (web local state).
    public private(set) var paused = false
    public var autoscroll = true
    public private(set) var enabled = true

    // Stream state (web `useLogStream` result).
    public private(set) var events: [LiveLogEntry] = []
    public private(set) var isConnected = false
    public private(set) var failure: String?
    public private(set) var drops = 0
    public private(set) var totalReceived = 0
    public private(set) var lastActivityAt: Date?

    @ObservationIgnored private let source: any LiveLogsStreaming
    @ObservationIgnored private let clock: @Sendable () -> Date
    @ObservationIgnored private var seqCounter = 0
    @ObservationIgnored private var epoch = 0

    public init(
        source: any LiveLogsStreaming = SampleLiveLogsSource(),
        clock: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.source = source
        self.clock = clock
    }

    // MARK: - Subscription identity (drives the page `.task(id:)`)

    /// The subscription identity (web effect deps `[level, grep, enabled]` + a reconnect
    /// epoch). `paused` is intentionally excluded — pausing must NOT tear down the stream.
    public var subscription: LiveLogSubscription {
        LiveLogSubscription(level: level, grep: grep, enabled: enabled, epoch: epoch)
    }

    // MARK: - Live subscription loop (web `useLogStream` effect)

    /// Opens the live tail and ingests frames until the stream ends (the page `.task` cancels
    /// it on navigate-away / subscription change). `connected` flips the badge; `log` stamps
    /// freshness and appends unless paused; `drop` accrues the server-side drop counter; a
    /// terminal `failed` surfaces the error panel (web `stream.error`).
    public func run() async {
        guard enabled else {
            isConnected = false
            return
        }
        failure = nil
        isConnected = false
        for await element in source.open(level: level, grep: grep) {
            ingest(element)
        }
        if failure == nil { isConnected = false }
    }

    /// Folds a single live frame into the state (the body of the `run()` loop, factored out so
    /// every branch is driven deterministically in unit tests). `log` stamps freshness before
    /// the pause check, so the staleness clock tracks the server even while paused.
    func ingest(_ element: LiveLogStreamElement) {
        switch element {
        case .connected:
            isConnected = true
        case let .log(payload):
            isConnected = true
            lastActivityAt = clock()
            if !paused { append(payload) }
        case let .drop(count):
            if count > 0 { drops += count }
        case let .failed(detail):
            failure = detail
            isConnected = false
        }
    }

    /// Appends a freshly received line, assigning a monotonic `seq` (web `nextSeq`) and
    /// evicting the oldest rows past the buffer ceiling (web FIFO `slice`).
    private func append(_ payload: String) {
        seqCounter += 1
        let entry = LiveLogsFormat.makeEntry(seq: seqCounter, payload: payload, receivedAt: clock())
        events.append(entry)
        if events.count > Self.maxEvents {
            events.removeFirst(events.count - Self.maxEvents)
        }
        totalReceived += 1
    }

    // MARK: - Derived (web `filteredEvents` / `ConnectionBadge` / `grepPattern`)

    /// Web `filteredEvents` — the buffer narrowed to a vehicle id when the (client-side)
    /// vehicle filter is set, otherwise the whole buffer.
    public var filteredEvents: [LiveLogEntry] {
        let needle = vehicleFilter.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else { return events }
        return events.filter { $0.vehicleID == needle }
    }

    /// The entries-panel state (web `filteredEvents.length === 0` branch).
    public var tableState: LiveLogsTableState {
        filteredEvents.isEmpty ? .empty : .success
    }

    /// The connection chip state (web `ConnectionBadge` precedence).
    public var status: LiveLogConnectionStatus {
        if failure != nil { return .error }
        if !enabled { return .disconnected }
        if !isConnected { return .connecting }
        if paused { return .paused }
        return .connected
    }

    /// The error-panel detail (web `stream.error.message`); `nil` hides the panel.
    public var errorDetail: String? {
        failure
    }

    /// Web `grepPattern` — the compiled case-insensitive highlight regex (or `nil`).
    public var grepRegex: NSRegularExpression? {
        LiveLogsFormat.grepRegex(grep)
    }

    /// Web download guard (`filteredEvents.length === 0` disables the action).
    public var canDownload: Bool {
        !filteredEvents.isEmpty
    }

    /// Whether the empty state should offer a reconnect affordance (web shows it when the
    /// stream is not actively connected; here: anything but a live/paused connection).
    public var offersReconnect: Bool {
        switch status {
        case .connected, .paused: false
        case .error, .disconnected, .connecting: true
        }
    }

    /// ADR-013 freshness: an open stream silent past the window is stale (data stays visible,
    /// flagged). `now` is injectable so the view's periodic timeline + tests both drive it.
    public func isStale(asOf now: Date) -> Bool {
        guard isConnected, failure == nil, let last = lastActivityAt else { return false }
        return now.timeIntervalSince(last) > Self.stalenessWindow
    }

    // MARK: - Actions (web handlers)

    /// Web `applyGrep` — commits the draft expression, restarting the server-side filter.
    public func applyGrep() {
        guard grepDraft != grep else { return }
        grep = grepDraft
    }

    /// Web Pause/Resume toggle — holds/resumes appending without dropping the connection.
    public func togglePause() {
        paused.toggle()
    }

    /// Web `handleClear` — drops the in-memory buffer and resets the counters.
    public func clear() {
        events = []
        drops = 0
        totalReceived = 0
    }

    /// Web `handleReconnect` — forces a fresh connection with the current filters by bumping
    /// the subscription epoch (the page `.task(id:)` restarts).
    public func reconnect() {
        failure = nil
        enabled = true
        epoch += 1
    }

    /// The `.txt` body the download/share produces (web `handleDownload` blob contents).
    public func downloadBody(calendar: Calendar = .current) -> String {
        LiveLogsFormat.downloadBody(filteredEvents, calendar: calendar)
    }

    /// The download filename (web `downloadFilename`).
    public func downloadFilename(now: Date? = nil) -> String {
        LiveLogsFormat.filename(now: now ?? clock())
    }
}
