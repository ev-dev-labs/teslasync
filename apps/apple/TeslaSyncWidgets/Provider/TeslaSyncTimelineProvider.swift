import SwiftUI
import WidgetKit

/// The single timeline provider backing every TeslaSync widget. It reads the cached
/// snapshot from the App Group store once and delegates entry construction to the
/// unit-tested `WidgetTimelinePlanner`. There is no networking and no SSE here — a
/// widget only ever shows what the app last cached, flagged with honest freshness
/// that visibly ages fresh → stale → offline.
struct TeslaSyncTimelineProvider: TimelineProvider {
    private let store: WidgetSnapshotStore

    init(store: WidgetSnapshotStore = WidgetSnapshotStore()) {
        self.store = store
    }

    /// This required WidgetKit entry point renders representative sample data while
    /// the system has no timeline entry yet.
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

    /// The cache if present; representative sample in the gallery preview; otherwise
    /// an envelope dated far enough back to read as honestly offline.
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
