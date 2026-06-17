import Foundation

// MARK: - Sample / test seams (page + preview defaults until the KMP adapter is injected)

/// The page/preview default `SettingsPageDataSource`: resolves the settings load immediately
/// with the default snapshot. It is NOT production settings data — it exists so the surface
/// renders its `.ready` state out of the box (mirroring the sibling `Sample*DataSource`
/// seams). Production replaces it with the `/settings` adapter. An `actor` keeps it trivially
/// `Sendable` under Swift 6 strict concurrency.
public actor SampleSettingsPageDataSource: SettingsPageDataSource {
    private let snapshot: AppSettingsSnapshot

    public init(snapshot: AppSettingsSnapshot = .default) {
        self.snapshot = snapshot
    }

    public func load() async throws -> AppSettingsSnapshot {
        snapshot
    }
}

/// A `SettingsPageDataSource` that never returns — drives the `.loading` state in previews
/// and tests by suspending until the surrounding task is cancelled.
public actor PendingSettingsPageDataSource: SettingsPageDataSource {
    public init() {}

    public func load() async throws -> AppSettingsSnapshot {
        // Suspend indefinitely (until cancellation) so the model stays in `.loading`.
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (_: CheckedContinuation<AppSettingsSnapshot, Error>) in }
        } onCancel: {}
    }
}

/// A `SettingsPageDataSource` that always throws — exercises the load-failure path (which, per
/// web parity, still resolves the page to its rendered content).
public actor FailingSettingsPageDataSource: SettingsPageDataSource {
    struct Failure: Error {}

    public init() {}

    public func load() async throws -> AppSettingsSnapshot {
        throw Failure()
    }
}

/// An in-memory `SettingsChecklistStore` that records how many times `restart()` fired, for
/// tests/previews — hermetic, never touches `UserDefaults` or `NotificationCenter`. Backed by
/// an `NSLock` so the count is safe to read across the model's main-actor calls.
public final class InMemorySettingsChecklistStore: SettingsChecklistStore, @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    public init() {}

    public var restartCount: Int {
        lock.lock(); defer { lock.unlock() }
        return count
    }

    public func restart() {
        lock.lock(); defer { lock.unlock() }
        count += 1
    }
}

/// An in-memory `SettingsTourLauncher` that records how many times `openLauncher()` fired, for
/// tests/previews — hermetic, never touches `NotificationCenter`.
public final class RecordingSettingsTourLauncher: SettingsTourLauncher, @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    public init() {}

    public var openCount: Int {
        lock.lock(); defer { lock.unlock() }
        return count
    }

    public func openLauncher() {
        lock.lock(); defer { lock.unlock() }
        count += 1
    }
}
