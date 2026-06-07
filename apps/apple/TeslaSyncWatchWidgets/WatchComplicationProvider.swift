import SwiftUI
import WidgetKit

/// The timeline provider backing the watch complications. Like the iOS widgets, it
/// reads the cached snapshot from the shared App Group store once and ages it
/// fresh → stale → offline through the unit-tested `WidgetTimelinePlanner`. There
/// is no networking here: a complication only ever shows what the watch app last
/// received from the phone.
struct WatchComplicationProvider: TimelineProvider {
    private let store: WidgetSnapshotStore

    init(store: WidgetSnapshotStore = WidgetSnapshotStore()) {
        self.store = store
    }

    func placeholder(in _: Context) -> TeslaSyncWidgetEntry { // parity:allow WidgetKit protocol method
        TeslaSyncWidgetEntry(date: Date(), snapshot: .sample(), freshness: .fresh)
    }

    func getSnapshot(in context: Context, completion: @escaping (TeslaSyncWidgetEntry) -> Void) {
        let now = Date()
        let snapshot = resolvedSnapshot(isPreview: context.isPreview, now: now)
        let freshness = WidgetFreshnessPolicy.standard.evaluate(now: now, lastUpdated: snapshot.generatedAt)
        completion(TeslaSyncWidgetEntry(date: now, snapshot: snapshot, freshness: freshness))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TeslaSyncWidgetEntry>) -> Void) {
        let now = Date()
        let snapshot = resolvedSnapshot(isPreview: context.isPreview, now: now)
        let entries = WidgetTimelinePlanner.entries(for: snapshot, now: now)
        let reload = WidgetTimelinePlanner.reloadDate(for: snapshot, now: now)
        completion(Timeline(entries: entries, policy: .after(reload)))
    }

    private func resolvedSnapshot(isPreview: Bool, now: Date) -> TeslaSyncWidgetSnapshot {
        if let cached = store.load() {
            return cached
        }
        if isPreview {
            return .sample(reference: now)
        }
        return .empty(generatedAt: now.addingTimeInterval(-WidgetFreshnessPolicy.standard.offlineAfter))
    }
}
