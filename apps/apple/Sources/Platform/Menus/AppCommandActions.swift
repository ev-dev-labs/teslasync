import Observation

/// Observable hub the macOS menus drive: it carries auth/permission state (to
/// enable/disable command items), routes refresh/print/command actions back to the
/// app through injected closures, and exposes confirmation + help/shortcut sheet
/// flags. Keeping the policy here (not in the `Commands` view) makes it testable.
@MainActor
@Observable
public final class AppCommandActions {
    /// Whether a session exists — disables the Commands menu when false.
    public var isAuthenticated = false
    /// Backend-permitted command set ("where backend permissions allow").
    public var permittedCommands: Set<VehicleCommandKind> = []
    /// A command awaiting the user's confirmation (drives the app's confirm sheet).
    public var pendingCommandConfirmation: VehicleCommandKind?
    /// The reason a command was blocked, for a sign-in / permission nudge.
    public var lastBlockedDecision: VehicleCommandDecision?
    /// Help / keyboard-shortcut sheet visibility (presented by the app).
    public var helpSheetVisible = false
    public var shortcutsSheetVisible = false
    /// The most recent command outcome, for a result banner/alert.
    public var lastOutcome: VehicleCommandOutcome?

    @ObservationIgnored public var onRefresh: @MainActor () -> Void = {}
    @ObservationIgnored public var onRunCommand: @MainActor (VehicleCommandKind) -> Void = { _ in }
    @ObservationIgnored public var onPrint: @MainActor () -> Void = {}

    public init() {}

    public func refresh() {
        onRefresh()
    }

    public func triggerPrint() {
        onPrint()
    }

    /// Evaluates the safety gate; on success arms the confirmation, otherwise
    /// records why it was blocked. Never runs a command without confirmation.
    public func requestCommand(_ kind: VehicleCommandKind) {
        let decision = VehicleCommandGate.evaluate(
            kind,
            isAuthenticated: isAuthenticated,
            permitted: permittedCommands
        )
        switch decision {
        case .allowed:
            lastBlockedDecision = nil
            pendingCommandConfirmation = kind
        case .needsAuthentication, .notPermitted:
            lastBlockedDecision = decision
        }
    }

    /// Runs the armed command after the user confirms.
    public func confirmPendingCommand() {
        guard let kind = pendingCommandConfirmation else { return }
        pendingCommandConfirmation = nil
        onRunCommand(kind)
    }

    public func cancelPendingCommand() {
        pendingCommandConfirmation = nil
    }
}
