//
//  InfrastructureSection.swift
//  TeslaSync — P4 feature view · 0006 · InfrastructureSection (Apple)
//
//  The composed dev-tools Infrastructure surface — the SwiftUI parity of
//  features/admin/components/devtools/InfrastructureSection.tsx. The web source is a
//  responsive 2-column grid (`grid gap-4 lg:grid-cols-2`) of five on-demand tools:
//  Db Stats, Migrations, MQTT test, Env Check, Runtime. This view reproduces that
//  composition, binds through `InfrastructureModel` (P1/S8 — no networking here),
//  renders every state (loading / empty / error / stale / offline / success), and
//  localizes through `InfrastructureStrings` (P1/S10).
//

import SwiftUI

/// The dev-tools Infrastructure feature view. Holds the bound `InfrastructureModel`,
/// drives the responsive tool grid, and surfaces the connectivity/freshness chrome.
public struct InfrastructureSection: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "InfrastructureSection"

    @State private var model: InfrastructureModel
    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    /// Designated initializer — inject a source (production app) or an
    /// `InMemoryInfrastructureSource` (previews/tests).
    public init(model: InfrastructureModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer over a bare `InfrastructureSource`.
    public init(
        source: any InfrastructureSource,
        telemetry: any InfrastructureTelemetry = OSLogInfrastructureTelemetry()
    ) {
        _model = State(initialValue: InfrastructureModel(source: source, telemetry: telemetry))
    }

    private var columnCount: Int {
        #if os(iOS)
            horizontalSizeClass == .compact ? 1 : 2
        #else
            2
        #endif
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                toolbar
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    // MARK: Toolbar (connectivity + refresh)

    private var toolbar: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: InfrastructureStrings.string("Infrastructure", "Infrastructure"))
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            InfraFreshnessChip(connection: model.connection)
            refreshButton
        }
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 12, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(InfrastructureStrings.text("Refresh", "Refresh"))
        .accessibilityHint(InfrastructureStrings.text("Refresh Hint", "Re-checks dev-tools connectivity"))
    }

    // MARK: Content states

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingGrid
        case .ready:
            readyContent
        }
    }

    private var loadingGrid: some View {
        grid {
            ForEach(model.tools) { state in
                InfraToolSkeleton().id(state.id)
            }
        }
        .accessibilityLabel(InfrastructureStrings.text("Loading", "Loading dev tools"))
    }

    private var readyContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if model.isOffline {
                offlineBanner
            }
            grid {
                ForEach(model.tools) { state in
                    toolView(for: state.tool).id(state.id)
                }
            }
        }
    }

    @ViewBuilder
    private func toolView(for tool: InfraTool) -> some View {
        switch tool.kind {
        case .backend:
            InfraBackendToolView(model: model, tool: tool)
        case .mqtt:
            InfraMqttToolView(model: model, tool: tool)
        }
    }

    // MARK: Offline banner (cached results stay visible)

    private var offlineBanner: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: InfrastructureStrings.string("Offline Title", "You're offline"))
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: InfrastructureStrings.string(
                    "Offline Message",
                    "Dev tools are unavailable. Showing the last results; reconnect to run again."
                ))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.statusWarning.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusWarning.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    // MARK: Responsive grid (web `lg:grid-cols-2`)

    private func grid(@ViewBuilder content: () -> some View) -> some View {
        LazyVGrid(
            columns: Array(
                repeating: GridItem(.flexible(), spacing: TSSpacing.lg, alignment: .top),
                count: columnCount
            ),
            alignment: .leading,
            spacing: TSSpacing.lg,
            content: content
        )
    }
}
