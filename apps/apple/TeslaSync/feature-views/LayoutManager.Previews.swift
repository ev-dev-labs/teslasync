//
//  LayoutManager.Previews.swift
//  TeslaSync — P4 feature view · 0125 · LayoutManager (Apple)
//
//  #if DEBUG previews — one per state + branch of the web source: loaded (active
//  highlight + default chip + several tabs), the single-default edge, loading,
//  empty (with New Layout), error, and the stale/offline freshness chips.
//  Previews use the bundle-free `.echo` localizer so the English copy renders
//  without the folded catalog, and no-op actions so they are side-effect-free.
//

#if DEBUG
    import SwiftUI

    @MainActor
    private enum LayoutManagerPreview {
        static let actions = LayoutManagerActions(
            onSwitch: { _ in },
            onCreate: { _ in },
            onRename: { _, _ in },
            onDelete: { _ in },
            onReorder: { _, _ in },
            onDuplicate: { _ in },
            onOpenSettings: { _ in }
        )

        static let layouts: [SavedLayoutData] = [
            SavedLayoutData(id: "overview", name: "Overview", icon: "📊", isDefault: true),
            SavedLayoutData(id: "trips", name: "Road Trips", icon: "🛣️"),
            SavedLayoutData(id: "charging", name: "Charging", icon: "⚡️"),
            SavedLayoutData(id: "battery", name: "Battery Health", icon: "🔋")
        ]

        static func switcher(
            _ state: LayoutManagerState,
            connection: LayoutLiveConnection = .live
        ) -> some View {
            LayoutManager(
                state: state,
                connection: connection,
                actions: actions,
                localize: .echo
            )
            .padding(TSSpacing.lg)
            .background(Color.TS.bg)
        }
    }

    #Preview("Loaded · active + default") {
        LayoutManagerPreview.switcher(
            .loaded(layouts: LayoutManagerPreview.layouts, activeID: "trips")
        )
    }

    #Preview("Loaded · single default") {
        LayoutManagerPreview.switcher(
            .loaded(
                layouts: [SavedLayoutData(id: "overview", name: "Overview", isDefault: true)],
                activeID: "overview"
            )
        )
    }

    #Preview("Loading") {
        LayoutManagerPreview.switcher(.loading)
    }

    #Preview("Empty (+ New Layout)") {
        LayoutManagerPreview.switcher(.empty)
    }

    #Preview("Error") {
        LayoutManagerPreview.switcher(.error(message: nil))
    }

    #Preview("Stale (cached)") {
        LayoutManagerPreview.switcher(
            .loaded(layouts: LayoutManagerPreview.layouts, activeID: "overview"),
            connection: .stale
        )
    }

    #Preview("Offline (cached)") {
        LayoutManagerPreview.switcher(
            .loaded(layouts: LayoutManagerPreview.layouts, activeID: "overview"),
            connection: .offline
        )
    }
#endif
