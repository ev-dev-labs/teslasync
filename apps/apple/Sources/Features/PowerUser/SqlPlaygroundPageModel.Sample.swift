import Foundation

/// An in-memory `SqlDraftStore` for previews + unit tests — it holds the draft in memory instead
/// of touching the shared `UserDefaults`, so tests are hermetic and a preview can be seeded with a
/// starting query. It mirrors the production `UserDefaultsSqlDraftStore` contract (an empty save
/// clears the value). Thread-safe via an `NSLock` so it satisfies the `Sendable` seam.
public final class InMemorySqlDraftStore: SqlDraftStore, @unchecked Sendable {
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
