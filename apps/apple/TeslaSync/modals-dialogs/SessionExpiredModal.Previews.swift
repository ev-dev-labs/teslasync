//
//  SessionExpiredModal.Previews.swift
//  TeslaSync — P4 modal/dialog · 0008 · SessionExpiredModal (Apple)
//
//  Xcode previews — one per state the surface produces: expired (the hard block), empty (open mode:
//  no session to protect), dormant (session healthy), loading (skeleton chrome), error (poll failed
//  → retry), and the stale / offline freshness variants of the block. Preview-only; excluded from
//  release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentSessionExpiredTelemetry: SessionExpiredTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op controller so previews don't trigger a re-auth navigation.
    private struct SilentSessionReauthController: SessionReauthController {
        func signIn() {}
    }

    private enum SessionExpiredPreviewData {
        /// A resolved session snapshot, expired + live by default.
        static func update(
            status: SessionLoadStatus = .loaded,
            mode: SessionMode = .session,
            hasExpired: Bool = true,
            eventTriggered: Bool = false,
            connection: SessionConnection = .live,
            hasContext: Bool = true
        ) -> SessionExpiredUpdate {
            SessionExpiredUpdate(
                status: status,
                context: hasContext
                    ? SessionContext(mode: mode, hasExpired: hasExpired, eventTriggered: eventTriggered)
                    : nil,
                connection: connection
            )
        }
    }

    @MainActor
    private func sessionExpiredPreview(_ update: SessionExpiredUpdate) -> SessionExpiredModal {
        let model = SessionExpiredModel(
            source: InMemorySessionExpiredSource(initial: update),
            telemetry: SilentSessionExpiredTelemetry(),
            controller: SilentSessionReauthController()
        )
        return SessionExpiredModal(model: model)
    }

    #Preview("Expired") {
        sessionExpiredPreview(SessionExpiredPreviewData.update()).padding()
    }

    #Preview("Empty (open mode)") {
        sessionExpiredPreview(SessionExpiredPreviewData.update(mode: .open, hasExpired: false)).padding()
    }

    #Preview("Dormant") {
        sessionExpiredPreview(SessionExpiredPreviewData.update(hasExpired: false)).padding()
    }

    #Preview("Loading") {
        sessionExpiredPreview(SessionExpiredPreviewData.update(status: .loading, hasContext: false)).padding()
    }

    #Preview("Error") {
        sessionExpiredPreview(
            SessionExpiredPreviewData.update(status: .failed("Couldn't reach /auth/session"), hasContext: false)
        )
        .padding()
    }

    #Preview("Stale") {
        sessionExpiredPreview(SessionExpiredPreviewData.update(connection: .stale)).padding()
    }

    #Preview("Offline") {
        sessionExpiredPreview(SessionExpiredPreviewData.update(connection: .offline)).padding()
    }
#endif
