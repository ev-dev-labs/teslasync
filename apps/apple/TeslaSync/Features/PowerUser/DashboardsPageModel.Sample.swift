import Foundation

/// An in-memory `DashboardDraftStore` for previews + unit tests — it holds the draft in memory
/// instead of touching the shared `UserDefaults`, so tests are hermetic and a preview can be
/// seeded with a starting envelope. It mirrors the production `UserDefaultsDashboardDraftStore`
/// contract (an empty save clears the value). Thread-safe via an `NSLock` so it satisfies the
/// `Sendable` seam.
public final class InMemoryDashboardDraftStore: DashboardDraftStore, @unchecked Sendable {
    private let lock = NSLock()
    private var value: String

    /// - Parameter seed: the initial persisted draft (web: a prior `localStorage` value).
    public init(seed: String = "") {
        value = seed
    }

    public func load() -> String {
        lock.withLock { value }
    }

    public func save(_ newValue: String) {
        lock.withLock { value = newValue }
    }
}

/// An in-memory `DashboardClipboard` for previews + unit tests — it records the last written text
/// and the write count instead of touching the real pasteboard, and returns a configurable
/// `result` so a test can drive the `unavailable` / `failed` branches of the page's copy flow
/// (web `navigator.clipboard` absent / `writeText` rejected). Thread-safe via an `NSLock`.
public final class InMemoryDashboardClipboard: DashboardClipboard, @unchecked Sendable {
    private let lock = NSLock()
    private let result: DashboardClipboardResult
    private var lastText: String?
    private var writes = 0

    /// - Parameter result: the outcome `writeText` reports (default `.written`).
    public init(result: DashboardClipboardResult = .written) {
        self.result = result
    }

    public func writeText(_ text: String) -> DashboardClipboardResult {
        lock.withLock {
            writes += 1
            if result == .written { lastText = text }
        }
        return result
    }

    /// The most recent text passed to `writeText` (only retained on a `.written` result).
    public var lastWrittenText: String? {
        lock.withLock { lastText }
    }

    /// The number of `writeText` calls (web copy-button presses that reached the clipboard).
    public var writeCount: Int {
        lock.withLock { writes }
    }
}
