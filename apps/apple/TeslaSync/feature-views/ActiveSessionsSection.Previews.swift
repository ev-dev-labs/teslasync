//
//  ActiveSessionsSection.Previews.swift
//  TeslaSync — P4 feature view · 0197 · ActiveSessionsSection (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated list with
//  the current device + others), empty (resolved with no rows), loading (initial
//  spinner), error (fetch failed → retry), open-mode (AUTH_MODE_OPEN notice), and
//  the stale / offline freshness variants. Preview-only; excluded from release builds
//  via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentActiveSessionsTelemetry: ActiveSessionsTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample sessions spanning the current device + browsers / OSes / IPs.
    private enum ActiveSessionsPreviewData {
        static func items() -> [ActiveSessionItem] {
            let now = Date(timeIntervalSince1970: 1_717_000_000)
            return [
                ActiveSessionItem(
                    id: "1",
                    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
                        + "(KHTML, like Gecko) Version/17.4 Safari/605.1.15",
                    ip: "192.168.1.24",
                    createdAt: now.addingTimeInterval(-3600),
                    lastSeenAt: now,
                    current: true
                ),
                ActiveSessionItem(
                    id: "2",
                    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        + "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
                    ip: "203.0.113.8",
                    createdAt: now.addingTimeInterval(-86400),
                    lastSeenAt: now.addingTimeInterval(-7200),
                    current: false
                ),
                ActiveSessionItem(
                    id: "3",
                    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 "
                        + "(KHTML, like Gecko) Mobile/15E148",
                    ip: "198.51.100.42",
                    createdAt: now.addingTimeInterval(-2 * 86400),
                    lastSeenAt: now.addingTimeInterval(-3 * 3600),
                    current: false
                )
            ]
        }

        static func update(
            status: ActiveSessionsLoadStatus = .loaded,
            mode: ActiveSessionsMode = .session,
            connection: ActiveSessionsConnection = .live,
            empty: Bool = false
        ) -> ActiveSessionsUpdate {
            ActiveSessionsUpdate(
                status: status,
                mode: mode,
                items: empty ? [] : items(),
                connection: connection
            )
        }
    }

    @MainActor
    private func activeSessionsPreview(_ update: ActiveSessionsUpdate) -> ActiveSessionsSection {
        let model = ActiveSessionsModel(
            source: InMemoryActiveSessionsSource(initial: update),
            telemetry: SilentActiveSessionsTelemetry()
        )
        return ActiveSessionsSection(model: model)
    }

    #Preview("Content") {
        ScrollView { activeSessionsPreview(ActiveSessionsPreviewData.update()).padding() }
    }

    #Preview("Empty") {
        activeSessionsPreview(ActiveSessionsPreviewData.update(empty: true)).padding()
    }

    #Preview("Loading") {
        activeSessionsPreview(ActiveSessionsPreviewData.update(status: .loading, empty: true)).padding()
    }

    #Preview("Error") {
        activeSessionsPreview(
            ActiveSessionsPreviewData.update(status: .failed("Request timed out"), empty: true)
        )
        .padding()
    }

    #Preview("Open mode") {
        activeSessionsPreview(ActiveSessionsPreviewData.update(mode: .open, empty: true)).padding()
    }

    #Preview("Stale") {
        ScrollView { activeSessionsPreview(ActiveSessionsPreviewData.update(connection: .stale)).padding() }
    }

    #Preview("Offline") {
        ScrollView { activeSessionsPreview(ActiveSessionsPreviewData.update(connection: .offline)).padding() }
    }
#endif
