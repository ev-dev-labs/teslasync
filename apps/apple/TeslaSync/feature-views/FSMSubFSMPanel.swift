//
//  FSMSubFSMPanel.swift
//  TeslaSync — P4 feature view · 0230 · FSMSubFSMPanel (Apple)
//
//  The active sub-FSM panel — the SwiftUI parity of
//  features/system/components/FSMSubFSMPanel.tsx. Renders the web source's regions (the
//  uppercase "Active Sub-FSMs" header and the 1/2-column grid of drive/charge session
//  cards) inside a glass panel, plus the P4 leaf contract states. Binds through
//  `FSMSubFSMModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface beyond the web's own guard):
//    • notApplicable — web `if (!isVehicleView) return null` → the surface renders nothing.
//    • loading       — initial fetch → skeleton cards (web parent `isLoading`).
//    • empty         — resolved, `subs.length === 0` → friendly empty state, never a blank box.
//    • error         — parent query failure → retry affordance (web `QueryError` peer).
//    • data          — the populated grid of sub-FSM cards.
//    • stale / offline — the orthogonal `connection` axis → header freshness chip + banner
//                        with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - FSMSubFSMPanel (the feature surface)

/// The active sub-FSM panel — the SwiftUI parity of
/// `features/system/components/FSMSubFSMPanel.tsx`. Renders every state from the web source
/// plus the P4 leaf freshness states, binding through `FSMSubFSMModel`.
public struct FSMSubFSMPanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "FSMSubFSMPanel"

    @State private var model: FSMSubFSMModel

    public init(model: FSMSubFSMModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        Group {
            if model.phase == .notApplicable {
                // Web `if (!isVehicleView) return null` — no panel chrome at all.
                EmptyView()
            } else {
                panel
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    private var panel: some View {
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
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: FSMSubFSMStrings.string("fsm.subFSMs", "Active Sub-FSMs")))
    }
}

// MARK: - Header (web uppercase `<h2>` label + the P4 freshness controls)

private extension FSMSubFSMPanel {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: FSMSubFSMStrings.string("fsm.subFSMs", "Active Sub-FSMs"))
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textSecondary)
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
            label = FSMSubFSMStrings.string("fsm.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = FSMSubFSMStrings.string("fsm.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = FSMSubFSMStrings.string("fsm.offline", "Offline")
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
        .accessibilityLabel(Text(verbatim: FSMSubFSMStrings.string("fsm.refresh", "Refresh")))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? FSMSubFSMStrings.string("fsm.offlineBanner", "Offline — showing last known data")
            : FSMSubFSMStrings.string("fsm.staleBanner", "Reconnecting — data may be stale")
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

private extension FSMSubFSMPanel {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .notApplicable:
            // Unreachable here (handled in `body`); kept for an exhaustive switch.
            EmptyView()
        case .loading:
            FSMSubFSMLoadingView()
        case .empty:
            FSMSubFSMEmptyView()
        case let .error(message):
            FSMSubFSMErrorView(message: message) { model.refresh() }
        case .data:
            FSMSubFSMContent(rows: model.resolved.rows)
        }
    }
}
