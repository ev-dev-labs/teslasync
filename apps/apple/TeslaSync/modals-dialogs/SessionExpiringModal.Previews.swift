//
//  SessionExpiringModal.Previews.swift
//  TeslaSync — P4 modal / dialog · 0009 · SessionExpiringModal (Apple)
//
//  Xcode previews — one per state the surface produces: the content countdown (with + without
//  unsaved drafts), loading (initial poll), empty (session active / no countdown), error (poll
//  failed → retry), and the stale / offline freshness variants. The loading / empty / error
//  previews use a `pinned` model so the ambient hide doesn't collapse the chrome. Each model is
//  anchored to a fixed clock so the countdown is deterministic. Preview-only; excluded from
//  release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentSessionExpiringTelemetry: SessionExpiringTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op controller so previews don't perform auth navigation.
    private struct SilentSessionExpiringController: SessionExpiringController {
        func stay() async {}
        func signOut() {}
    }

    private enum SessionExpiringPreviewData {
        static let now = Date(timeIntervalSince1970: 1_717_000_000)

        /// A near-expiry session snapshot (45s left → the modal opens) by default.
        static func session(secondsLeft: Int = 45) -> SessionSnapshot {
            SessionSnapshot(
                mode: .session,
                authenticated: true,
                expiresAt: now.addingTimeInterval(TimeInterval(secondsLeft)),
                expiresIn: secondsLeft,
                renewable: true
            )
        }

        static func drafts() -> [SessionDraft] {
            [
                SessionDraft(label: "alertstudio:rule:42", savedAt: now.addingTimeInterval(-120)),
                SessionDraft(label: "export:builder:drives", savedAt: now.addingTimeInterval(-600)),
                SessionDraft(label: "vehicle:notes:LRW3", savedAt: now.addingTimeInterval(-3600))
            ]
        }

        static func update(
            status: SessionExpiringLoadStatus = .loaded,
            connection: SessionExpiringConnection = .live,
            session: SessionSnapshot? = session(),
            drafts: [SessionDraft] = []
        ) -> SessionExpiringUpdate {
            SessionExpiringUpdate(status: status, session: session, drafts: drafts, connection: connection)
        }
    }

    @MainActor
    private func sessionExpiringPreview(
        update: SessionExpiringUpdate,
        pinned: Bool = false
    ) -> some View {
        let model = SessionExpiringModel(
            source: InMemorySessionExpiringSource(initial: update),
            pinned: pinned,
            telemetry: SilentSessionExpiringTelemetry(),
            controller: SilentSessionExpiringController(),
            now: { SessionExpiringPreviewData.now }
        )
        return SessionExpiringModal(model: model)
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.TS.bg)
    }

    #Preview("Content · drafts") {
        sessionExpiringPreview(update: SessionExpiringPreviewData.update(drafts: SessionExpiringPreviewData.drafts()))
    }

    #Preview("Content · no drafts") {
        sessionExpiringPreview(update: SessionExpiringPreviewData.update())
    }

    #Preview("Loading") {
        sessionExpiringPreview(
            update: SessionExpiringPreviewData.update(status: .loading, session: nil),
            pinned: true
        )
    }

    #Preview("Empty") {
        sessionExpiringPreview(
            update: SessionExpiringPreviewData.update(session: SessionSnapshot(mode: .open, authenticated: true)),
            pinned: true
        )
    }

    #Preview("Error") {
        sessionExpiringPreview(
            update: SessionExpiringPreviewData.update(status: .failed("Network unreachable"), session: nil),
            pinned: true
        )
    }

    #Preview("Stale") {
        sessionExpiringPreview(
            update: SessionExpiringPreviewData.update(
                connection: .stale,
                drafts: SessionExpiringPreviewData.drafts()
            )
        )
    }

    #Preview("Offline") {
        sessionExpiringPreview(update: SessionExpiringPreviewData.update(connection: .offline))
    }
#endif
