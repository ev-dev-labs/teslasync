//
//  ChangesPanel.swift
//  TeslaSync — P4 feature view · 0030 · ChangesPanel (Apple)
//
//  The Feature Flags change-audit panel — the SwiftUI parity of
//  web/src/features/admin/components/feature-flags/ChangesPanel.tsx. Binds through
//  `ChangesPanelModel` (P1/S8); the panel is always mounted so the loading + empty
//  states render in-place rather than gating the surface (verbatim the web file's
//  own contract). Renders every state (loading / empty / error / stale / offline /
//  content). No networking lives in the view.
//

import SwiftUI

// MARK: - ChangesPanel (the feature surface)

/// Native, Apple-idiomatic parity of the web `ChangesPanel`: the feature-flag
/// change-audit table (web `DataTable`) with its scoped/global empty state (web
/// `EmptyState`), plus the loading / error / stale / offline chrome the prompt's
/// surface contract requires. Emits the P1/S11 `view.opened` diagnostics event with
/// the surface slug `ChangesPanel` on appear.
public struct ChangesPanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public nonisolated static let surfaceSlug = "ChangesPanel"

    /// The `view.opened` diagnostics event this surface emits on appear.
    public nonisolated static var viewOpenedEvent: DashboardWidgetTelemetryEvent {
        .viewOpened(surface: surfaceSlug)
    }

    @Bindable private var model: ChangesPanelModel
    private let telemetry: (any DashboardWidgetTelemetrySink)?

    /// Live / preview binding: the production app injects a source-backed model.
    public init(model: ChangesPanelModel, telemetry: (any DashboardWidgetTelemetrySink)? = nil) {
        self.model = model
        self.telemetry = telemetry
    }

    /// Web-prop binding: the source component renders from `rows` + `loading`
    /// (+ optional `scopedKey`). Constructs the bound model from the props so the
    /// call site matches the web `<ChangesPanel rows loading scopedKey />`.
    @MainActor
    public init(
        rows: [ChangesPanelFlagChange],
        loading: Bool,
        scopedKey: String? = nil,
        telemetry: (any DashboardWidgetTelemetrySink)? = nil
    ) {
        self.init(
            model: ChangesPanelModel(rows: rows, loading: loading, scopedKey: scopedKey),
            telemetry: telemetry
        )
    }

    public var body: some View {
        let presentation = ChangesPanelPresentation.resolve(state: model.state, scopedKey: model.scopedKey)
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
            telemetry?.record(ChangesPanel.viewOpenedEvent)
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

extension ChangesPanel {
    private func header(for presentation: ChangesPanelPresentation) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "flag.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            ChangesPanelStrings.text("admin.flags.audit.title", "Flag change log")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            headerAccessory(for: presentation)
        }
    }

    @ViewBuilder
    private func headerAccessory(for presentation: ChangesPanelPresentation) -> some View {
        switch presentation {
        case let .content(_, freshness, refreshing):
            ChangesStatusAccessory(freshness: freshness, refreshing: refreshing) { model.refresh() }
        case .offlineNoData:
            ChangesFreshnessChip(freshness: .offline)
        case .error:
            ChangesFreshnessChip(freshness: .stale)
        case .loading, .empty:
            EmptyView()
        }
    }
}

// MARK: - Content states

extension ChangesPanel {
    @ViewBuilder
    private func content(for presentation: ChangesPanelPresentation) -> some View {
        switch presentation {
        case .loading:
            ChangesLoadingView()
        case let .empty(scopedKey):
            ChangesEmptyView(scopedKey: scopedKey)
        case .offlineNoData:
            ChangesOfflineView { model.refresh() }
        case let .error(retryable):
            ChangesErrorView(retryable: retryable) { model.refresh() }
        case let .content(projection, _, _):
            ChangeLogTable(rows: projection.rows)
        }
    }

    /// Whether the resolved presentation is stale content (drives auto-refresh).
    private func isStale(_ presentation: ChangesPanelPresentation) -> Bool {
        if case let .content(_, freshness, _) = presentation {
            return freshness == .stale
        }
        return false
    }
}
