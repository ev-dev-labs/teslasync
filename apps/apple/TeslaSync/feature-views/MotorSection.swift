//
//  MotorSection.swift
//  TeslaSync — P4 feature view · 0293 · MotorSection (Apple)
//
//  The Powertrain section — the SwiftUI parity of
//  features/vehicles/components/vehicle-detail/MotorSection.tsx. Renders the web source's
//  body (the eight powertrain `MetricCard` tiles — shift state, pack voltage, front motor
//  current, front + rear torque, front + rear RPM, and the peak motor temperature) inside
//  a glass panel under an always-visible "Powertrain" header, plus the P4 leaf contract
//  states. Binds through `MotorSectionModel` (P1/S8); no networking here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton chrome (web parent `isLoading`).
//    • empty    — no snapshot resolved → friendly empty state (web `EmptyState`),
//                 never a blank box.
//    • error    — parent query failure → retry affordance (web `QueryError` peer).
//    • data     — the eight-tile grid (web `grid grid-cols-2 sm:3 lg:4`).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip +
//                 banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - MotorSection (the feature surface)

/// The Powertrain section — the SwiftUI parity of
/// `features/vehicles/components/vehicle-detail/MotorSection.tsx`. Renders every state
/// from the web source plus the P4 leaf freshness states, binding through
/// `MotorSectionModel`.
public struct MotorSection: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "MotorSection"

    @State private var model: MotorSectionModel

    public init(model: MotorSectionModel) {
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
        .accessibilityLabel(Text(verbatim: MotorSectionStrings.string("vehicles.detail.motor", "Powertrain")))
    }
}

// MARK: - Header (web `<Cog/> {t('vehicles.detail.motor')}` title row)

private extension MotorSection {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "gearshape.2.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: MotorSectionStrings.string("vehicles.detail.motor", "Powertrain"))
                .font(Font.TS.section)
                .fontWeight(.bold)
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
            label = MotorSectionStrings.string("motor.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = MotorSectionStrings.string("motor.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = MotorSectionStrings.string("motor.offline", "Offline")
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
        .accessibilityLabel(Text(verbatim: MotorSectionStrings.string("motor.refresh", "Refresh")))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? MotorSectionStrings.string("motor.offlineBanner", "Offline — showing last known data")
            : MotorSectionStrings.string("motor.staleBanner", "Reconnecting — data may be stale")
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

private extension MotorSection {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            MotorSectionLoadingView()
        case .empty:
            MotorSectionEmptyView()
        case let .error(message):
            MotorSectionErrorView(message: message) { model.refresh() }
        case let .data(projection):
            MotorSectionContent(projection: projection)
        }
    }
}
