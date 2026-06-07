import SwiftUI

/// The confirmed quick-actions surface. Companion-local actions (refresh, open on
/// iPhone) run immediately; vehicle commands require an explicit confirmation, a
/// valid phone session (disabled with a lock when signed out), and they relay to
/// the phone which holds all vehicle authority. The in-flight command shows
/// progress and the returned outcome is surfaced verbatim — never a silent success.
struct WatchActionsView: View {
    @Environment(WatchModel.self) private var model
    @State private var confirming: WatchQuickAction?

    var body: some View {
        List {
            if !model.isAuthenticated {
                Section {
                    WatchAuthBanner()
                }
            }
            Section {
                ForEach(WatchQuickAction.menu) { action in
                    actionRow(action)
                }
            } footer: {
                Text("watch.actions.footer")
                    .font(Font.TS.caption)
            }
            if let outcome = model.lastOutcomeKey {
                Section {
                    Label(LocalizedStringKey(outcome), systemImage: "info.circle")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .accessibilityIdentifier("watch.actions.outcome")
                }
            }
        }
        .navigationTitle("watch.actions.title")
        .confirmationDialog(
            confirming.map { Text(LocalizedStringKey($0.confirmKey)) } ?? Text(verbatim: ""),
            isPresented: confirmationBinding,
            titleVisibility: .visible
        ) {
            if let action = confirming {
                Button(LocalizedStringKey(action.titleKey)) {
                    model.perform(action)
                    confirming = nil
                }
                Button("watch.cancel", role: .cancel) {
                    confirming = nil
                }
            }
        }
    }

    private var confirmationBinding: Binding<Bool> {
        Binding(
            get: { confirming != nil },
            set: { presented in
                if !presented { confirming = nil }
            }
        )
    }

    private func actionRow(_ action: WatchQuickAction) -> some View {
        let signedOut = action.requiresAuthentication && !model.isAuthenticated
        let isPending = model.pendingActionID != nil && action.isVehicleCommand

        return Button {
            if action.requiresConfirmation {
                confirming = action
            } else {
                model.perform(action)
            }
        } label: {
            HStack {
                Label(LocalizedStringKey(action.titleKey), systemImage: action.systemImage)
                Spacer(minLength: 0)
                if isPending {
                    ProgressView()
                } else if signedOut {
                    Image(systemName: "lock.fill")
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
        .disabled(signedOut || model.pendingActionID != nil)
        .accessibilityIdentifier("watch.action.\(action.rawValue)")
    }
}
