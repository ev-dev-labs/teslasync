//
//  ReauthDialog.Previews.swift
//  TeslaSync — P4 modal/dialog · 0007 · ReauthDialog (Apple)
//
//  Xcode previews — one per state the surface produces: credential (the Password / Authenticator tabs),
//  credential-password-only (no tabs), confirm (the typed-confirmation field), loading (initial),
//  empty (no active challenge), error (mode resolution failed → retry), and the stale / offline
//  freshness variants. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentReauthTelemetry: ReauthTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op controller so previews don't touch a sudo queue.
    private struct SilentReauthController: ReauthController {
        func complete(_: ReauthCredential) {}
        func cancel() {}
    }

    /// A canned credential service so a preview submission resolves without a server.
    private struct StubReauthCredentialService: ReauthCredentialService {
        let outcome: ReauthSubmitOutcome
        func submit(_: ReauthSubmitBody) async -> ReauthSubmitOutcome {
            outcome
        }
    }

    private enum ReauthPreviewData {
        /// A resolved snapshot anchored to a fixed challenge path, live + credential mode by default.
        static func update(
            status: ReauthLoadStatus = .loaded,
            connection: ReauthConnection = .live,
            mode: ReauthMode = .credential,
            totpTabAvailable: Bool = true,
            hasContext: Bool = true
        ) -> ReauthChallengeUpdate {
            ReauthChallengeUpdate(
                status: status,
                context: hasContext
                    ? ReauthChallengeContext(
                        path: "/settings/reset",
                        mode: mode,
                        totpTabAvailable: totpTabAvailable
                    )
                    : nil,
                connection: connection
            )
        }
    }

    @MainActor
    private func reauthPreview(_ update: ReauthChallengeUpdate) -> ReauthDialog {
        let credential = ReauthCredential(mode: .session, token: "preview-token")
        let model = ReauthDialogModel(
            source: InMemoryReauthChallengeSource(initial: update),
            telemetry: SilentReauthTelemetry(),
            service: StubReauthCredentialService(outcome: .success(credential)),
            controller: SilentReauthController()
        )
        return ReauthDialog(model: model)
    }

    #Preview("Credential") {
        ScrollView { reauthPreview(ReauthPreviewData.update()).padding() }
    }

    #Preview("Credential — password only") {
        ScrollView { reauthPreview(ReauthPreviewData.update(totpTabAvailable: false)).padding() }
    }

    #Preview("Confirm") {
        ScrollView { reauthPreview(ReauthPreviewData.update(mode: .confirm)).padding() }
    }

    #Preview("Loading") {
        reauthPreview(ReauthPreviewData.update(status: .loading, hasContext: false)).padding()
    }

    #Preview("Empty") {
        reauthPreview(ReauthPreviewData.update(status: .loaded, hasContext: false)).padding()
    }

    #Preview("Error") {
        reauthPreview(
            ReauthPreviewData.update(status: .failed("Couldn't reach the auth server"), hasContext: false)
        )
        .padding()
    }

    #Preview("Stale") {
        ScrollView { reauthPreview(ReauthPreviewData.update(connection: .stale)).padding() }
    }

    #Preview("Offline") {
        ScrollView { reauthPreview(ReauthPreviewData.update(connection: .offline)).padding() }
    }
#endif
