import Foundation

/// Reads and writes the cached widget snapshot in the App Group container shared by
/// the app and the widget extensions. Writes are atomic; reads never throw — a
/// missing, unreadable, or future-schema file resolves to `nil` so the widget shows
/// its honest empty/offline state instead of crashing.
///
/// If the App Group container is unavailable (e.g. entitlement not provisioned on a
/// given build), the store falls back to a per-process caches directory. That keeps
/// the code robust; cross-process sharing simply requires the entitlement, which is
/// verified on the signed macOS/iOS build.
public struct WidgetSnapshotStore: Sendable {
    /// Directory the snapshot file lives in, or `nil` if none could be resolved.
    public let directory: URL?

    /// Production initializer: resolves the App Group container, falling back to
    /// the caches directory.
    public init(appGroupIdentifier: String = WidgetAppGroup.identifier) {
        let fileManager = FileManager.default
        if let container = fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier) {
            directory = container
        } else {
            directory = try? fileManager.url(
                for: .cachesDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            )
        }
    }

    /// Test/preview initializer pointed at an explicit directory.
    public init(directory: URL) {
        self.directory = directory
    }

    private var fileURL: URL? {
        directory?.appendingPathComponent(WidgetAppGroup.snapshotFileName, isDirectory: false)
    }

    /// Persists `snapshot` atomically. Creates the directory if needed.
    public func save(_ snapshot: TeslaSyncWidgetSnapshot) throws {
        guard let fileURL, let directory else {
            throw WidgetSnapshotStoreError.noContainer
        }
        let fileManager = FileManager.default
        if !fileManager.fileExists(atPath: directory.path) {
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        let data = try WidgetSnapshotCoder.encode(snapshot)
        try data.write(to: fileURL, options: [.atomic])
    }

    /// Loads the cached snapshot, or `nil` when absent/unreadable/too new.
    public func load() -> TeslaSyncWidgetSnapshot? {
        guard let fileURL, let data = try? Data(contentsOf: fileURL) else { return nil }
        guard let snapshot = try? WidgetSnapshotCoder.decode(data), snapshot.isReadable else { return nil }
        return snapshot
    }

    /// Removes the cached snapshot if present (used by sign-out to drop PII).
    public func clear() {
        guard let fileURL else { return }
        try? FileManager.default.removeItem(at: fileURL)
    }
}

public enum WidgetSnapshotStoreError: Error, Equatable {
    /// No App Group container or fallback directory could be resolved.
    case noContainer
}
