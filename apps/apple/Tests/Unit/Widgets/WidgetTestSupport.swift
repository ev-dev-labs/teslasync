import Foundation
@testable import TeslaSync

/// Shared helpers for the widget unit tests: an isolated temp-directory store and a
/// thread-safe reload counter for asserting `WidgetCenter` reloads.
func makeTempWidgetStore() -> WidgetSnapshotStore {
    let base = FileManager.default.temporaryDirectory
        .appendingPathComponent("teslasync-widget-tests", isDirectory: true)
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
    return WidgetSnapshotStore(directory: base)
}

/// Counts invocations of an injected reload closure across threads.
final class ReloadCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0

    var count: Int {
        lock.withLock { value }
    }

    func increment() {
        lock.withLock { value += 1 }
    }
}
