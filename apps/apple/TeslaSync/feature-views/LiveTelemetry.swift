//
//  LiveTelemetry.swift
//  TeslaSync — P4 feature view · 0127 · LiveTelemetry (Apple)
//
//  The live-telemetry section — the SwiftUI parity of
//  features/dashboard/components/LiveTelemetry.tsx. Renders the web source's section
//  divider header and its responsive grid of six panels (drivetrain, climate,
//  security, tyre pressure, media, navigation), plus the P4 leaf contract states.
//  Binds through `LiveTelemetryModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → the panel grid with per-panel skeletons (the web
//                 `data ? rows : <SkeletonRows/>` branch with no snapshot yet).
//    • empty    — resolved with no telemetry at all → friendly empty state.
//    • error    — parent query failure → retry affordance (web `QueryError` peer).
//    • data     — the full six-panel grid (each panel skeletons until its snapshot).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip +
//                 banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - LiveTelemetry (the feature surface)

/// The live-telemetry section — the SwiftUI parity of
/// `features/dashboard/components/LiveTelemetry.tsx`. Renders every state from the web
/// source plus the P4 leaf freshness states, binding through `LiveTelemetryModel`.
public struct LiveTelemetry: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "LiveTelemetry"

    @State private var model: LiveTelemetryModel

    public init(model: LiveTelemetryModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            header
            if model.connection != .live {
                connectivityBanner
            }
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: LiveTelemetryStrings.string("telemetry.title", "Live Telemetry")))
    }
}

// MARK: - Header (web section divider `<Cog/> {title}` + freshness)

private extension LiveTelemetry {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "gearshape.2.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: LiveTelemetryStrings.string("telemetry.title", "Live Telemetry").uppercased())
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityAddTraits(.isHeader)
            rule
            freshnessChip
            refreshButton
        }
    }

    var rule: some View {
        Rectangle()
            .fill(Color.TS.border)
            .frame(height: 1)
            .frame(maxWidth: .infinity)
            .accessibilityHidden(true)
    }

    var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = LiveTelemetryStrings.string("liveTelemetry.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = LiveTelemetryStrings.string("liveTelemetry.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = LiveTelemetryStrings.string("liveTelemetry.offline", "Offline")
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
        .accessibilityLabel(Text(verbatim: LiveTelemetryStrings.string("liveTelemetry.refresh", "Refresh")))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? LiveTelemetryStrings.string("liveTelemetry.offlineBanner", "Offline — showing last known data")
            : LiveTelemetryStrings.string("liveTelemetry.staleBanner", "Reconnecting — data may be stale")
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

// MARK: - Content states (web grid + the P4 leaf contract)

private extension LiveTelemetry {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading, .data:
            TSFadeIn {
                LiveTelemetryGrid(resolved: model.resolved)
            }
        case .empty:
            LiveTelemetryEmptyView()
        case let .error(message):
            LiveTelemetryErrorView(message: message) { model.refresh() }
        }
    }
}
