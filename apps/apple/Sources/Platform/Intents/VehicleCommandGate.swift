import Foundation

/// The pure, framework-free decision for whether a vehicle command may run.
///
/// Factored out of the App Intent / menu command so the safety policy (auth +
/// backend permission) is unit-testable without the App Intents runtime. The
/// caller maps the decision onto a confirmation prompt, a sign-in nudge, or a
/// permission error.
public enum VehicleCommandDecision: Equatable, Sendable {
    /// Authenticated and permitted — proceed to confirmation.
    case allowed
    /// No session — the user must sign in first.
    case needsAuthentication
    /// Signed in, but the backend does not permit this command for this user.
    case notPermitted
}

/// Stateless gate evaluating a command against the current auth + permission
/// mirror. `permitted` is the backend-authorized command set ("where backend
/// permissions allow"); an **empty** set is treated as "capabilities unknown" and
/// does not block — the authoritative check still happens server-side when the app
/// executes the command, so an unknown mirror must not strand a legitimate user.
public enum VehicleCommandGate {
    public static func evaluate(
        _ kind: VehicleCommandKind,
        isAuthenticated: Bool,
        permitted: Set<VehicleCommandKind>
    ) -> VehicleCommandDecision {
        guard isAuthenticated else { return .needsAuthentication }
        if !permitted.isEmpty, !permitted.contains(kind) { return .notPermitted }
        return .allowed
    }
}
