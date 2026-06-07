import AppIntents
import Foundation

/// Reads the app-written widget snapshot from the App Group so read-only intents
/// (charging status, latest alert) can answer from cache without networking or
/// any PII. Returns `nil` when nothing is cached yet.
public enum IntentSnapshotReader {
    public static func current(store: WidgetSnapshotStore = WidgetSnapshotStore()) -> TeslaSyncWidgetSnapshot? {
        store.load()
    }
}

/// Errors surfaced from TeslaSync intents. Conforms to
/// `CustomLocalizedStringResourceConvertible` so Siri / Shortcuts present a
/// localized, non-technical message (never a raw server body).
public enum TeslaSyncIntentError: Swift.Error, CustomLocalizedStringResourceConvertible {
    /// No valid session — the user must sign in first.
    case needsAuthentication
    /// Signed in, but the backend does not permit this command.
    case notPermitted(VehicleCommandKind)
    /// No command executor is wired yet.
    case unavailable
    /// No cached data is available to answer a read-only intent.
    case noData

    public var localizedStringResource: LocalizedStringResource {
        switch self {
        case .needsAuthentication: "intent.error.needsAuth"
        case .notPermitted: "intent.error.notPermitted"
        case .unavailable: "intent.error.unavailable"
        case .noData: "intent.error.noData"
        }
    }
}

/// Maps a non-blocking command decision to the matching thrown error, or `nil`
/// when the command is allowed to proceed.
enum IntentGateError {
    static func error(
        for decision: VehicleCommandDecision,
        kind: VehicleCommandKind
    ) -> TeslaSyncIntentError? {
        switch decision {
        case .allowed: nil
        case .needsAuthentication: .needsAuthentication
        case .notPermitted: .notPermitted(kind)
        }
    }
}
