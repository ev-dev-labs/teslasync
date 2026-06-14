//
//  VehicleSettingsTab.swift
//  TeslaSync — P4 feature view · 0308 · VehicleSettingsTab (Apple)
//
//  The per-vehicle settings surface — the SwiftUI parity of
//  features/vehicles/components/VehicleSettingsTab.tsx. Renders the web section's
//  header (title + subtitle), the per-key override rows (label + help, typed input,
//  source pill, Save + Reset), and the P4 leaf contract states, inside a glass panel.
//  Binds through `VehicleSettingsTabModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial resolver fetch → skeleton rows (web 3-skeleton short-circuit).
//    • empty    — resolved with no supported keys → friendly empty state, never blank.
//    • error    — resolver query failure → retry affordance (web `ErrorDisplay` peer).
//    • data     — the per-key override rows (input + source pill + Save/Reset).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip +
//                 banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - VehicleSettingsTab (the feature surface)

/// The per-vehicle settings surface — the SwiftUI parity of
/// `features/vehicles/components/VehicleSettingsTab.tsx`. Renders every state from the
/// web section plus the P4 leaf freshness states, binding through
/// `VehicleSettingsTabModel`.
public struct VehicleSettingsTab: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "VehicleSettingsTab"

    @State private var model: VehicleSettingsTabModel

    public init(model: VehicleSettingsTabModel) {
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
        .accessibilityLabel(Text(verbatim: VehicleSettingsStrings.string(
            "vehicleSettings.title", "Per-vehicle settings"
        )))
    }
}

// MARK: - Header (web Heading + subtitle, plus freshness chip + refresh)

private extension VehicleSettingsTab {
    var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: VehicleSettingsStrings.string("vehicleSettings.title", "Per-vehicle settings"))
                    .font(Font.TS.section)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text(verbatim: VehicleSettingsStrings.string(
                    "vehicleSettings.subtitle",
                    "Override individual settings for this vehicle. Resets fall back to your account-wide values."
                ))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: TSSpacing.xs) {
                freshnessChip
                refreshButton
            }
        }
    }

    var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = VehicleSettingsStrings.string("vehicleSettings.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = VehicleSettingsStrings.string("vehicleSettings.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = VehicleSettingsStrings.string("vehicleSettings.offline", "Offline")
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
        .accessibilityLabel(Text(verbatim: VehicleSettingsStrings.string("vehicleSettings.refresh", "Refresh")))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? VehicleSettingsStrings.string("vehicleSettings.offlineBanner", "Offline — showing last saved settings")
            : VehicleSettingsStrings.string("vehicleSettings.staleBanner", "Reconnecting — settings may be stale")
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

// MARK: - Content states (web render gate + P4 leaf contract)

private extension VehicleSettingsTab {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            VehicleSettingsLoadingView()
        case .empty:
            VehicleSettingsEmptyView()
        case let .error(message):
            VehicleSettingsErrorView(message: message) { model.refresh() }
        case .data:
            VehicleSettingsRows(model: model)
        }
    }
}
