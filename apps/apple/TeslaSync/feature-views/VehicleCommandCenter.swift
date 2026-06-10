//
//  VehicleCommandCenter.swift
//  TeslaSync — P4 feature view · 0261 · VehicleCommandCenter (Apple)
//
//  The composable Vehicle Command Center surface — the SwiftUI parity of
//  features/system/components/VehicleCommandCenter.tsx. Inside a glass panel it renders
//  the vehicle header (name + lifecycle badge + freshness chip + model/VIN + live
//  battery/range/temperature stats), the last-command status feedback, the asleep +
//  stale banners, the command search box, the favorites bar and the collapsible category
//  groups of command tiles — plus the input / select / confirm command dialogs. It
//  renders every state from the web source (loading skeleton / content / search-empty /
//  command-status error / stale / offline-asleep) through `VehicleCommandCenterModel`
//  (P1/S8). No networking lives here; the surface emits the P1/S11 `view.opened`.
//

import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension VehicleCommandCenterStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the
    /// model file) so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Design mapping (catalog enums → P1/S9 tokens)

extension VehicleCommandVariant {
    /// The semantic tone for the variant (web `hover:border-neon-{cyan|red|green}` /
    /// danger affordance).
    var tone: TSTone {
        switch self {
        case .default: .accent
        case .danger: .danger
        case .success: .success
        }
    }
}

extension VCCStat.Tone {
    /// The stat value colour (web emerald / amber for battery; secondary otherwise).
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .secondary: Color.TS.textSecondary
        }
    }
}

// MARK: - VehicleCommandCenter (the command surface)

/// The composable Vehicle Command Center surface, binding through
/// `VehicleCommandCenterModel` (P1/S8). No networking lives here.
public struct VehicleCommandCenter: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = VehicleCommandCenterSurface.slug

    @State private var model: VehicleCommandCenterModel

    public init(model: VehicleCommandCenterModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.05) {
            TSGlassPanel {
                Group {
                    switch model.phase {
                    case .loading:
                        VCCLoadingChrome()
                    case .content:
                        content
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear {
            model.start()
            model.autoRefreshIfStale()
        }
        .onDisappear { model.stop() }
        .onChange(of: model.connection) { _, _ in model.autoRefreshIfStale() }
        .sheet(item: dialogBinding) { request in
            VCCCommandDialog(request: request, model: model)
        }
        .accessibilityElement(children: .contain)
    }

    /// Binding for `.sheet(item:)` over the model's active dialog (web `activeDialog`).
    private var dialogBinding: Binding<VCCDialogRequest?> {
        Binding(
            get: { model.activeDialog },
            set: { newValue in if newValue == nil { model.cancelDialog() } }
        )
    }

    /// The full content composition once a vehicle snapshot is present (web render).
    private var content: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            VCCHeader(model: model)
            banners
            VCCSearchField(
                text: Binding(get: { model.search }, set: { model.search = $0 }),
                hasQuery: !model.trimmedSearch.isEmpty
            )
            VCCCommandArea(model: model)
        }
    }

    /// The stacked status / asleep / stale / command-status banners (each renders only
    /// when its condition holds, mirroring the web conditional banners).
    @ViewBuilder
    private var banners: some View {
        if let result = model.lastResult {
            VCCFeedbackBanner(result: result)
        }
        if model.isAsleep {
            VCCAsleepBanner(state: model.projection?.stateLabel ?? "")
        }
        if model.showsStaleBanner {
            VCCStaleBanner(ageLabel: model.ageLabel)
        }
        if case let .failed(message) = model.commandStatus {
            VCCCommandStatusErrorBanner(message: message) { model.refresh() }
        }
    }
}
