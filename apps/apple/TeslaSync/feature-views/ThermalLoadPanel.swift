//
//  ThermalLoadPanel.swift
//  TeslaSync — P4 feature view · 0163 · ThermalLoadPanel (Apple)
//
//  The thermal-load indicators panel — the SwiftUI parity of
//  features/driving/components/drivetrain-health/ThermalLoadPanel.tsx. Renders the web
//  source's regions (the muted-uppercase header with the activity glyph, the per-sensor
//  severity bars, and the 2-/4-column inline-metric grid) inside a glass panel, plus the
//  P4 leaf contract states. Binds through `ThermalLoadModel` (P1/S8); no networking
//  lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton chrome (web parent `health` resolving).
//    • empty    — payload resolved with no sensors → friendly empty state (the web
//                 page's `EmptyState` peer), never a blank box.
//    • error    — parent query failure → retry affordance (web `QueryError` peer).
//    • data     — the full panel (severity bars + inline-metric grid).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip +
//                 banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - ThermalLoadPanel (the feature surface)

/// The thermal-load indicators panel — the SwiftUI parity of
/// `features/driving/components/drivetrain-health/ThermalLoadPanel.tsx`. Renders every
/// state from the web source plus the P4 leaf freshness states, binding through
/// `ThermalLoadModel`.
public struct ThermalLoadPanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ThermalLoadPanel"

    @State private var model: ThermalLoadModel

    public init(model: ThermalLoadModel) {
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
        .accessibilityLabel(Text(verbatim: ThermalStrings.string(
            "drivetrain.thermalMetrics", "Thermal Load Indicators"
        )))
    }
}

// MARK: - Header (web muted-uppercase `<h3><Activity/> {title}</h3>` + freshness)

private extension ThermalLoadPanel {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: ThermalStrings.string("drivetrain.thermalMetrics", "Thermal Load Indicators"))
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
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
            label = ThermalStrings.string("thermal.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = ThermalStrings.string("thermal.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = ThermalStrings.string("thermal.offline", "Offline")
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
        .accessibilityLabel(Text(verbatim: ThermalStrings.string("thermal.refresh", "Refresh")))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? ThermalStrings.string("thermal.offlineBanner", "Offline — showing last known data")
            : ThermalStrings.string("thermal.staleBanner", "Reconnecting — data may be stale")
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

// MARK: - Content states (web shell + the P4 leaf contract)

private extension ThermalLoadPanel {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            ThermalLoadingView()
        case .empty:
            ThermalEmptyView()
        case let .error(message):
            ThermalErrorView(message: message) { model.refresh() }
        case .data:
            ThermalLoadContent(resolved: model.resolved)
        }
    }
}
