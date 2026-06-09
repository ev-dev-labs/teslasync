//
//  ScheduledMaintenanceCard.swift
//  TeslaSync — P4 feature view · 0251 · ScheduledMaintenanceCard (Apple)
//
//  The operator-grade scheduled-maintenance card — the SwiftUI parity of
//  features/system/components/status/ScheduledMaintenanceCard.tsx. Surfaces the active / upcoming
//  maintenance window on the system-status surface and lets the operator schedule a new one inline,
//  bound through `ScheduledMaintenanceModel` (P1/S8). No networking lives here; the dynamic ring +
//  freshness chip + banner reflect the bound source's live-state.
//
//  States (every one renders — no hidden surface):
//    • loading   — initial fetch → skeleton chrome (web `isLoading && !state`).
//    • scheduler — mode ok / degraded → the never-blank scheduler (explainer + inline form).
//    • active    — mode maintenance → message + "Active until … (N min remaining)" + Clear, with a
//                  blue ring (amber when the window is within 24h, web `within24h`).
//    • error     — query failure → retry affordance (P4 leaf over the web).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip + banner with a
//                  one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - ScheduledMaintenanceCard (the feature surface)

/// The operator-grade scheduled-maintenance card — the SwiftUI parity of
/// `features/system/components/status/ScheduledMaintenanceCard.tsx`. Renders every state from the
/// web source plus the P4 leaf freshness states, binding through `ScheduledMaintenanceModel`.
public struct ScheduledMaintenanceCard: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ScheduledMaintenanceCard"

    @State private var model: ScheduledMaintenanceModel
    @State private var showSchedule = false
    @State private var startDate: Date
    @State private var durationText = "60"
    @State private var message = ""

    public init(model: ScheduledMaintenanceModel) {
        _model = State(initialValue: model)
        _startDate = State(initialValue: Self.defaultStart())
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ScheduledMaintenanceHeader(
                active: model.headerActive,
                within24h: model.headerWithin24h,
                connection: model.connection,
                onRefresh: { model.refresh() }
            )
            if model.connection != .live {
                ScheduledMaintenanceConnectivityBanner(connection: model.connection)
            }
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(panelBackground)
        .overlay(panelRing)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension ScheduledMaintenanceCard {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            ScheduledMaintenanceLoadingView()
        case let .error(message):
            ScheduledMaintenanceErrorView(message: message) { model.refresh() }
        case let .active(active):
            ScheduledMaintenanceActiveView(content: active, isMutating: model.isMutating) {
                Task { await model.clear() }
            }
        case .scheduler:
            ScheduledMaintenanceSchedulerView(
                showSchedule: $showSchedule,
                startDate: $startDate,
                durationText: $durationText,
                message: $message,
                isMutating: model.isMutating,
                onSchedule: submitSchedule,
                onCancel: { showSchedule = false }
            )
        }
    }

    func submitSchedule() {
        Task {
            let scheduled = await model.schedule(
                start: startDate,
                durationText: durationText,
                message: message
            )
            if scheduled { resetForm() }
        }
    }

    func resetForm() {
        showSchedule = false
        message = ""
        startDate = Self.defaultStart()
    }
}

// MARK: - Panel chrome (web GlassPanel + dynamic `ringClass`)

private extension ScheduledMaintenanceCard {
    var panelShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
    }

    /// The frosted panel with the dynamic ring tint behind the content (web `bg-…-500/[0.04]`).
    var panelBackground: some View {
        panelShape
            .fill(model.ringTone.tint)
            .background(TSMaterial.panel, in: panelShape)
    }

    /// The dynamic 1pt ring (web `ring-1` amber / blue / hairline).
    var panelRing: some View {
        panelShape.strokeBorder(model.ringTone.ring, lineWidth: 1)
    }

    /// The combined VoiceOver label: title + active / within-24h qualifiers when present.
    var accessibilityLabel: String {
        ScheduledMaintenanceAccessibility.cardLabel(
            title: ScheduledMaintenanceStrings.string("scheduled.title", "Scheduled maintenance"),
            active: model.headerActive
                ? ScheduledMaintenanceStrings.string("scheduled.badge.active", "Maintenance active")
                : nil,
            within24h: model.headerWithin24h
                ? ScheduledMaintenanceStrings.string("scheduled.within24h", "Within 24h")
                : nil
        )
    }

    /// A sensible default window start (the next round hour), mirroring the web operator picking a
    /// near-future start rather than "now".
    static func defaultStart() -> Date {
        Date().addingTimeInterval(60 * 60)
    }
}
