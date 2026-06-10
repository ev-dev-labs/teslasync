//
//  VehicleStatePanel.Views.swift
//  TeslaSync — P4 feature view · 0287 · VehicleStatePanel (Apple)
//
//  The presentational subviews composed by `VehicleStatePanel`: the data body (the
//  three row sections — Lights, Driver & Keys, Access Modes — separated by hairline
//  rules), the freshness chip (with the live pulse, the web `animate-pulse` dot), and
//  the loading / empty / error chrome. All consume the P1/S10 facade and the shared
//  P1/S9 tokens + shared components (`TSSkeleton` / `TSButton` / `TSFadeIn`) — no
//  networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the per-row value tone maps web
//  cyan-300 → `accent`, amber-300/400 → `statusWarning`, rose-300 → `statusDanger`,
//  green-400 → `statusSuccess`, purple-400 → `chartSeriesPower`, the muted off/inactive
//  state → `textMuted`, and a plain value → `textPrimary`.
//

import SwiftUI

// MARK: - Tone → token (web colour branch resolved at the view boundary)

extension VehicleStateTone {
    /// The semantic design-token colour for the row value (ADR-006).
    var color: Color {
        switch self {
        case .accent: Color.TS.accent
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        case .success: Color.TS.statusSuccess
        case .feature: Color.TS.chartSeriesPower
        case .muted: Color.TS.textMuted
        case .neutral: Color.TS.textPrimary
        }
    }
}

// MARK: - Data body (web non-empty render: three row sections)

/// The resolved panel body — the Lights, Driver & Keys, and Access Modes sections,
/// each a stack of labelled value rows, separated by hairline rules and wrapped in the
/// shared fade-in (web `FadeIn`).
struct VehicleStateContent: View {
    let projection: VehicleStateProjection

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                section(projection.lights)
                sectionDivider
                section(projection.driverAndKeys)
                sectionDivider
                section(projection.accessModes)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func section(_ rows: [VehicleStateRow]) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(rows) { row in
                VehicleStateRowView(row: row)
            }
        }
    }

    /// The web `border-t border-[var(--border-subtle)]` divider between sections.
    private var sectionDivider: some View {
        Rectangle()
            .fill(Color.TS.border)
            .frame(height: 1)
            .accessibilityHidden(true)
    }
}

// MARK: - Row (web `flex items-center justify-between`)

/// One labelled state row — a muted leading glyph + label and the tone-tinted value
/// (web `text-xs font-medium`). The icon is decorative; the spoken label combines the
/// row title and its value.
struct VehicleStateRowView: View {
    let row: VehicleStateRow

    private var label: String {
        VehicleStateStrings.string(row.field.labelKey, row.field.labelFallback)
    }

    private var value: String {
        VehicleStateStrings.resolve(row.value)
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: row.field.systemImage)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(width: 14)
                    .accessibilityHidden(true)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: value)
                .font(Font.TS.caption.weight(.medium))
                .foregroundStyle(row.tone.color)
                .multilineTextAlignment(.trailing)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: VehicleStateAccessibility.rowLabel(label: label, value: value)))
    }
}

// MARK: - Freshness chip (web `sseConnected` "Live" indicator + P4 stale/offline)

/// The header freshness chip — a tone dot + label that reproduces the web `sseConnected`
/// "Live" pill (green pulsing dot, web `animate-pulse`) and extends it with the P4
/// `stale` / `offline` states. The pulse respects Reduce Motion.
struct VehicleStateFreshnessChip: View {
    let connection: VehicleStateConnection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: VehicleStateStrings.string("vehicleState.live", "Live")
        case .stale: VehicleStateStrings.string("vehicleState.stale", "Stale")
        case .offline: VehicleStateStrings.string("vehicleState.offline", "Offline")
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(tone)
                .frame(width: 6, height: 6)
                .opacity(pulsing ? 0.35 : 1)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .onAppear {
            guard connection == .live, !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1).repeatForever(autoreverses: true)) {
                pulsing = true
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Loading / empty / error chrome (P4 leaf states)

/// The initial-fetch chrome: skeleton label/value rows across the three sections, so the
/// panel keeps its shape while the parent query resolves.
struct VehicleStateLoadingView: View {
    private var loadingLabel: String {
        VehicleStateStrings.string("vehicleState.loadingA11y", "Loading vehicle state")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 8, id: \.self) { _ in
                HStack(spacing: TSSpacing.md) {
                    TSSkeleton(width: 120, height: 12)
                    Spacer(minLength: TSSpacing.sm)
                    TSSkeleton(width: 56, height: 12)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: loadingLabel))
    }
}

/// The empty render: a friendly state for an absent live reading, never a blank panel.
struct VehicleStateEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: VehicleStateStrings.string("vehicleState.noData", "No vehicle state available"))
            } icon: {
                Image(systemName: "car.top.radiowaves.rear.right")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// The fetch-failure state (web `QueryError` peer) with a retry affordance.
struct VehicleStateErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: VehicleStateStrings.string("vehicleState.errorTitle", "Couldn't load vehicle state"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: VehicleStateStrings.string("vehicleState.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: VehicleStateStrings.string("vehicleState.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
