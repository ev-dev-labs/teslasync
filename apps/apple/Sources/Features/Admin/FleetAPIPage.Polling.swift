import SwiftUI

/// Tesla API Polling card (web GlassPanel #1/#2): the global suspend/resume switch with a
/// status line, plus the suspended-state callout. Binds the `@Observable` model's
/// `isSuspended` + the suspend mutation (web `useToggleAPISuspend`).
struct FleetAPIPollingPanel: View {
    let model: FleetAPIPageModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                row
                if model.isSuspended {
                    suspendedCallout
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Tesla API Polling"))
    }

    // MARK: - Switch row

    private var row: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSIconBox(
                systemName: model.isSuspended ? "pause.fill" : "play.fill",
                tone: model.isSuspended ? .danger : .success
            )
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text("Tesla API Polling")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text(statusKey)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Toggle(isOn: pollingBinding) {
                EmptyView()
            }
            .labelsHidden()
            .tint(Color.TS.accent)
            .disabled(model.isSuspendInFlight)
            .accessibilityLabel(Text("Tesla API Polling"))
        }
    }

    private var statusKey: LocalizedStringKey {
        model.isSuspended
            ? "All Tesla Fleet API calls are suspended"
            : "Vehicle data is being polled from Tesla"
    }

    /// Web `checked={!api_suspended}` — flipping either way toggles suspension.
    private var pollingBinding: Binding<Bool> {
        Binding(
            get: { !model.isSuspended },
            set: { _ in Task { await model.toggleSuspend() } }
        )
    }

    // MARK: - Suspended callout (web GlassPanel #2 — red note)

    private var suspendedCallout: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "pause.fill")
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(
                // swiftlint:disable:next line_length
                "Polling and commands are paused. Token refresh continues so you won't need to re-authenticate. Useful when your vehicle is in service."
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.statusDanger.opacity(0.85))
        }
        .fleetAPITinted(.danger)
        .accessibilityElement(children: .combine)
    }
}
