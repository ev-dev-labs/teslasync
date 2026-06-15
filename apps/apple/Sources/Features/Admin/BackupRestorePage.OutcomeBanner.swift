import SwiftUI

/// The dismissible result banner shown after a command — the HIG-native peer of the web
/// `toast.success` / `toast.warning` / `toast.error`. Maps a `BackupOutcome` to a tinted
/// `TSAlertBanner`; the title resolves from `Localizable.xcstrings` with the web key name.
struct BackupOutcomeBanner: View {
    let outcome: BackupOutcome
    let onDismiss: () -> Void

    private var tone: TSTone {
        if outcome == .checksumMismatch { return .warning }
        return outcome.isError ? .danger : .success
    }

    private var symbol: String {
        switch tone {
        case .danger: "exclamationmark.triangle.fill"
        case .warning: "exclamationmark.circle.fill"
        default: "checkmark.circle.fill"
        }
    }

    var body: some View {
        TSAlertBanner(tone: tone, systemImage: symbol, title: title, onDismiss: onDismiss)
    }

    /// Web i18n key per outcome (verbatim key names from `BackupRestorePage.tsx`).
    private var title: LocalizedStringKey {
        switch outcome {
        case .configCreated: "backup.configCreated"
        case .configCreateFailed: "backup.configCreateFailed"
        case .configUpdated: "backup.configUpdated"
        case .configUpdateFailed: "backup.configUpdateFailed"
        case .configDeleted: "backup.configDeleted"
        case .configDeleteFailed: "backup.configDeleteFailed"
        case .triggered: "backup.triggered"
        case .triggerFailed: "backup.triggerFailed"
        case .quickStarted: "backup.quickStarted"
        case .quickFailed: "backup.quickFailed"
        case .checksumVerified: "backup.checksumVerified"
        case .checksumMismatch: "backup.checksumMismatch"
        case .verifyFailed: "backup.verifyFailed"
        case .previewFailed: "backup.previewFailed"
        }
    }
}
