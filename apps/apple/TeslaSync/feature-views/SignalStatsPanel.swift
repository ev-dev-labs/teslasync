//
//  SignalStatsPanel.swift
//  TeslaSync — P4 feature view · 0272 · SignalStatsPanel (Apple)
//
//  The per-signal min/max/avg/count summary panel — the SwiftUI parity of
//  features/telemetry/components/SignalStatsPanel.tsx. Renders the web source's
//  regions (the title + the "Hide empty (N)" toggle, and the stat grid) inside a
//  glass panel, plus the P4 leaf contract states. Binds through `SignalStatsModel`
//  (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton grid (web `loading ? <Skeleton…>`).
//    • empty    — resolved, nothing to show → friendly empty state, never a blank
//                 box (the web "No stats available" branch).
//    • error    — parent query failure → retry affordance (web `QueryError` peer).
//    • data     — the full stat table (with the per-signal colour + "no data" hints).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip +
//                 banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - SignalStatsPanel (the feature surface)

/// The per-signal stats summary panel — the SwiftUI parity of
/// `features/telemetry/components/SignalStatsPanel.tsx`. Renders every state from
/// the web source plus the P4 leaf freshness states, binding through
/// `SignalStatsModel`. The hide-empty toggle is local view state, matching the web
/// `useState(false)`.
public struct SignalStatsPanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SignalStatsPanel"

    @State private var model: SignalStatsModel
    @State private var hideEmpty = false

    public init(model: SignalStatsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
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
        .accessibilityLabel(Text(verbatim: SignalStatsStrings.string("signalStats.panelA11y", "Signal statistics")))
    }
}

// MARK: - Header (web `section-title` + the hide-empty toggle + freshness)

private extension SignalStatsPanel {
    var resolvedTitle: String {
        model.resolved.title ?? SignalStatsStrings.string("signalStats.title", "Stats Summary")
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: resolvedTitle)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            // Web `emptyCount > 0 && <Toggle … />`.
            if model.resolved.emptyCount > 0 {
                SignalStatsHideEmptyToggle(isOn: $hideEmpty, count: model.resolved.emptyCount)
            }
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
            label = SignalStatsStrings.string("signalStats.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = SignalStatsStrings.string("signalStats.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = SignalStatsStrings.string("signalStats.offline", "Offline")
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
        .accessibilityLabel(Text(verbatim: SignalStatsStrings.string("signalStats.refresh", "Refresh")))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? SignalStatsStrings.string("signalStats.offlineBanner", "Offline — showing last known data")
            : SignalStatsStrings.string("signalStats.staleBanner", "Reconnecting — data may be stale")
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

private extension SignalStatsPanel {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            SignalStatsLoadingView()
        case .empty:
            SignalStatsEmptyView()
        case let .error(message):
            SignalStatsErrorView(message: message) { model.refresh() }
        case .data:
            SignalStatsContent(rows: model.resolved.rows, hideEmpty: hideEmpty)
        }
    }
}
