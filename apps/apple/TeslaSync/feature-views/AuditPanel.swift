//
//  AuditPanel.swift
//  TeslaSync — P4 feature view · 0026 · AuditPanel (Apple)
//
//  The composable DLQ replay-audit panel — the SwiftUI parity of
//  web/src/features/admin/components/dlq-inspector/AuditPanel.tsx. Binds through
//  `AuditPanelModel` (P1/S8); the panel is always mounted so the loading + empty
//  states render in-place rather than gating the surface (verbatim the web file's
//  own contract). Renders every state (loading / empty / error / stale / offline /
//  content). No networking lives in the view.
//

import SwiftUI

// MARK: - AuditPanel (the feature surface)

/// Native, Apple-idiomatic parity of the web `AuditPanel`: the replay-audit log
/// table (web `DataTable`) with its scoped/global empty state (web `EmptyState`),
/// plus the loading / error / stale / offline chrome the prompt's surface contract
/// requires. Emits the P1/S11 `view.opened` diagnostics event with the surface
/// slug `AuditPanel` on appear.
public struct AuditPanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public nonisolated static let surfaceSlug = "AuditPanel"

    /// The `view.opened` diagnostics event this surface emits on appear.
    public nonisolated static var viewOpenedEvent: DashboardWidgetTelemetryEvent {
        .viewOpened(surface: surfaceSlug)
    }

    @Bindable private var model: AuditPanelModel
    private let telemetry: (any DashboardWidgetTelemetrySink)?

    /// Live / preview binding: the production app injects a source-backed model.
    public init(model: AuditPanelModel, telemetry: (any DashboardWidgetTelemetrySink)? = nil) {
        self.model = model
        self.telemetry = telemetry
    }

    /// Web-prop binding: the source component renders from `rows` + `loading`
    /// (+ optional `scopedDlqId`). Constructs the bound model from the two props so
    /// the call site matches the web `<AuditPanel rows loading scopedDlqId />`.
    @MainActor
    public init(
        rows: [AuditPanelDLQReplayRecord],
        loading: Bool,
        scopedDlqId: Int? = nil,
        telemetry: (any DashboardWidgetTelemetrySink)? = nil
    ) {
        self.init(
            model: AuditPanelModel(rows: rows, loading: loading, scopedDlqId: scopedDlqId),
            telemetry: telemetry
        )
    }

    public var body: some View {
        let presentation = AuditPanelPresentation.resolve(state: model.state, scopedDlqId: model.scopedDlqId)
        return VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header(for: presentation)
            content(for: presentation)
                .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .task {
            telemetry?.record(AuditPanel.viewOpenedEvent)
            model.start()
        }
        .onDisappear { model.stop() }
        .onChange(of: isStale(presentation)) { _, stale in
            if stale { model.refresh() }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header

extension AuditPanel {
    private func header(for presentation: AuditPanelPresentation) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            AuditPanelStrings.text("admin.dlq.audit.title", "Replay audit log")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            headerAccessory(for: presentation)
        }
    }

    @ViewBuilder
    private func headerAccessory(for presentation: AuditPanelPresentation) -> some View {
        switch presentation {
        case let .content(_, freshness, refreshing):
            AuditStatusAccessory(freshness: freshness, refreshing: refreshing) { model.refresh() }
        case .offlineNoData:
            AuditFreshnessChip(freshness: .offline)
        case .error:
            AuditFreshnessChip(freshness: .stale)
        case .loading, .empty:
            EmptyView()
        }
    }
}

// MARK: - Content states

extension AuditPanel {
    @ViewBuilder
    private func content(for presentation: AuditPanelPresentation) -> some View {
        switch presentation {
        case .loading:
            AuditLoadingView()
        case let .empty(scoped):
            AuditEmptyView(scoped: scoped)
        case .offlineNoData:
            AuditOfflineView { model.refresh() }
        case let .error(retryable):
            AuditErrorView(retryable: retryable) { model.refresh() }
        case let .content(projection, _, _):
            AuditLogTable(rows: projection.rows)
        }
    }

    /// Whether the resolved presentation is stale content (drives auto-refresh).
    private func isStale(_ presentation: AuditPanelPresentation) -> Bool {
        if case let .content(_, freshness, _) = presentation {
            return freshness == .stale
        }
        return false
    }
}
