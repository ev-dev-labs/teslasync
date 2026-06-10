//
//  PowertrainPanel.swift
//  TeslaSync — P4 feature view · 0283 · PowertrainPanel (Apple)
//
//  The Powertrain telemetry panel — the SwiftUI parity of
//  features/vehicles/components/telemetry-panels/PowertrainPanel.tsx. Renders the web
//  source's body (the shift-state pill, the bipolar power bar, the front/rear RPM and
//  torque cards, the peak-motor / inverter temperatures, and the regen row) inside a
//  glass panel, plus the P4 leaf contract states. Binds through `PowertrainModel`
//  (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton chrome (web parent `isLoading`).
//    • empty    — no telemetry resolved → friendly empty state (web `EmptyState`),
//                 never a blank box.
//    • error    — parent query failure → retry affordance (web `QueryError` peer).
//    • data     — the full panel (pill + power bar + cards + temperature/regen rows).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip +
//                 banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - PowertrainPanel (the feature surface)

/// The Powertrain telemetry panel — the SwiftUI parity of
/// `features/vehicles/components/telemetry-panels/PowertrainPanel.tsx`. Renders every
/// state from the web source plus the P4 leaf freshness states, binding through
/// `PowertrainModel`.
public struct PowertrainPanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "PowertrainPanel"

    @State private var model: PowertrainModel

    public init(model: PowertrainModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                if model.connection != .live {
                    connectivityBanner
                }
                content
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: PowertrainStrings.string("common.powertrain", "Powertrain")))
    }
}

// MARK: - Header (web `<h3 class="section-title"><Cog/> {title}</h3>`)

private extension PowertrainPanel {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "gearshape.2.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.chartSeriesRegen)
                .accessibilityHidden(true)
            Text(verbatim: PowertrainStrings.string("common.powertrain", "Powertrain"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
        }
    }

    var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = PowertrainStrings.string("powertrain.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = PowertrainStrings.string("powertrain.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = PowertrainStrings.string("powertrain.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text(verbatim: PowertrainStrings.string("powertrain.refresh", "Refresh")))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? PowertrainStrings.string("powertrain.offlineBanner", "Offline — showing last known data")
            : PowertrainStrings.string("powertrain.staleBanner", "Reconnecting — data may be stale")
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: label)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension PowertrainPanel {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            PowertrainLoadingView()
        case .empty:
            PowertrainEmptyView()
        case let .error(message):
            PowertrainErrorView(message: message) { model.refresh() }
        case let .data(projection):
            PowertrainContent(projection: projection)
        }
    }
}
