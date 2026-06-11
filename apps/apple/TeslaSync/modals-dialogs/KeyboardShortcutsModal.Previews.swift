//
//  KeyboardShortcutsModal.Previews.swift
//  TeslaSync — P4 modal/dialog · 0006 · KeyboardShortcutsModal (Apple)
//
//  Xcode previews — one per state the surface produces: content (all groups), global-only, this-page
//  (route-scoped), a search needle, empty (no match), loading (initial), error (resolution failed →
//  retry), and the stale / offline freshness variants. Preview-only; excluded from release builds via
//  `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentKBShortcutsTelemetry: KBShortcutsTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op controller so previews don't touch navigation.
    private struct SilentKBShortcutsController: KBShortcutsController {
        func dismiss() {}
    }

    private enum KBShortcutsPreviewData {
        /// A representative registry snapshot spanning global + route-scoped groups.
        static let entries: [KBShortcutEntry] = [
            KBShortcutEntry(
                id: "nav.dashboard",
                keys: ["g", "d"],
                description: "Go to dashboard",
                group: "Navigation",
                scope: .global
            ),
            KBShortcutEntry(
                id: "nav.vehicles",
                keys: ["g", "v"],
                description: "Go to vehicles",
                group: "Navigation",
                scope: .global
            ),
            KBShortcutEntry(
                id: "palette.open",
                keys: ["Ctrl", "K"],
                description: "Open command palette",
                group: "Actions",
                scope: .global
            ),
            KBShortcutEntry(
                id: "global.help",
                keys: ["?"],
                description: "Show keyboard shortcuts",
                group: "Global",
                scope: .global
            ),
            KBShortcutEntry(
                id: "replay.playPause",
                keys: ["Space"],
                description: "Play / pause replay",
                group: "Trip replay",
                scope: .route,
                routeMatch: .prefix("/replay")
            ),
            KBShortcutEntry(
                id: "replay.step",
                keys: ["Shift", "→"],
                description: "Step forward",
                group: "Trip replay",
                scope: .route,
                routeMatch: .prefix("/replay")
            )
        ]

        static func update(
            status: KBShortcutsLoadStatus = .loaded,
            connection: KBShortcutsConnection = .live,
            pathname: String = "/replay/42",
            entries: [KBShortcutEntry] = entries
        ) -> KBShortcutsUpdate {
            KBShortcutsUpdate(
                status: status,
                entries: entries,
                pathname: pathname,
                connection: connection
            )
        }
    }

    @MainActor
    private func kbShortcutsPreview(
        _ update: KBShortcutsUpdate,
        filter: KBShortcutsFilter = .all,
        search: String = ""
    ) -> KeyboardShortcutsModal {
        let model = KBShortcutsModel(
            source: InMemoryKBShortcutsSource(initial: update),
            telemetry: SilentKBShortcutsTelemetry(),
            controller: SilentKBShortcutsController(),
            filterStore: InMemoryKBShortcutsFilterStore(initial: filter)
        )
        model.start()
        if !search.isEmpty { model.updateSearch(search) }
        return KeyboardShortcutsModal(model: model)
    }

    #Preview("Content — all") {
        ScrollView { kbShortcutsPreview(KBShortcutsPreviewData.update()).padding() }
    }

    #Preview("Filter — global") {
        ScrollView { kbShortcutsPreview(KBShortcutsPreviewData.update(), filter: .global).padding() }
    }

    #Preview("Filter — this page") {
        ScrollView { kbShortcutsPreview(KBShortcutsPreviewData.update(), filter: .page).padding() }
    }

    #Preview("Search") {
        ScrollView { kbShortcutsPreview(KBShortcutsPreviewData.update(), search: "go to").padding() }
    }

    #Preview("Empty") {
        ScrollView { kbShortcutsPreview(KBShortcutsPreviewData.update(), search: "zzzz").padding() }
    }

    #Preview("Loading") {
        kbShortcutsPreview(KBShortcutsPreviewData.update(status: .loading, entries: [])).padding()
    }

    #Preview("Error") {
        kbShortcutsPreview(
            KBShortcutsPreviewData.update(status: .failed("Network timed out"), entries: [])
        ).padding()
    }

    #Preview("Stale") {
        ScrollView { kbShortcutsPreview(KBShortcutsPreviewData.update(connection: .stale)).padding() }
    }

    #Preview("Offline") {
        ScrollView { kbShortcutsPreview(KBShortcutsPreviewData.update(connection: .offline)).padding() }
    }
#endif
