//
//  FleetApiSection.swift
//  TeslaSync — P4 feature view · 0004 · FleetApiSection (Apple)
//
//  The composed Fleet API dev-tools feature view — SwiftUI parity of
//  features/admin/components/devtools/FleetApiSection.tsx. Renders the setup-wizard
//  section over the nine-tool grid, with a freshness chip + connectivity banner
//  (ADR-013) above. Binds through `FleetApiSectionModel` (no networking in the
//  view) and renders every section state: loading / empty / error / stale / offline
//  / content; each tool renders its own per-action states beneath.
//

import SwiftUI

/// The Fleet API tools + onboarding feature view — the SwiftUI parity of the web
/// `FleetApiSection`. Composes the setup wizard and the nine Fleet API tool cards.
public struct FleetApiSection: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        FleetApiSectionModel.surfaceSlug
    }

    @State private var model: FleetApiSectionModel

    public init(model: FleetApiSectionModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.xl) {
                statusBar
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Status bar (freshness chip + connectivity banner)

extension FleetApiSection {
    private var statusBar: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack {
                Spacer(minLength: 0)
                FleetFreshnessChip(
                    freshness: model.freshness,
                    updatedAt: model.updatedAt,
                    onRefresh: { model.refresh() }
                )
            }
            if model.connection != .live { connectivityBanner }
        }
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "devtools.fleet.offlineBanner" : "devtools.fleet.staleBanner"
        let fallback = isOffline
            ? "Offline — showing the last loaded data"
            : "Reconnecting — data may be out of date"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            FleetApiStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(tone.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Section content states

extension FleetApiSection {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            loadedContent
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            TSSkeleton(width: 160, height: 16)
            TSSkeleton(height: 64, cornerRadius: TSRadius.md)
            ForEach(0 ..< 3, id: \.self) { _ in
                TSSkeleton(height: 120, cornerRadius: TSRadius.lg)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(FleetApiStrings.text("devtools.fleet.loading", "Loading Fleet API tools"))
    }

    private var emptyState: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "wrench.and.screwdriver")
                .font(.system(size: 30))
                .foregroundStyle(Color.TS.textMuted)
            FleetApiStrings.text("devtools.fleet.emptyTitle", "Fleet API not configured yet")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            FleetApiStrings.text(
                "devtools.fleet.emptyHint",
                "Complete the setup wizard to connect your Tesla Fleet API account."
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .multilineTextAlignment(.center)
            retryButton
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.x4xl)
        .accessibilityElement(children: .combine)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 30))
                .foregroundStyle(Color.TS.statusDanger)
            FleetApiStrings.text("error.loadFailed", "Failed to load data")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            retryButton
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.x4xl)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        FleetButton(
            titleKey: "devtools.fleet.retry", fallback: "Retry",
            variant: .secondary, systemImage: "arrow.clockwise"
        ) { model.refresh() }
    }

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xl) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                FleetSectionHeader(key: "devtools.fleet.setupWizard", fallback: "Setup Wizard")
                OnboardingWorkflow(model: model)
            }
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                FleetSectionHeader(key: "devtools.fleet.toolsTitle", fallback: "Fleet API Tools")
                toolGrid
            }
        }
    }

    private var toolGrid: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 320), spacing: TSSpacing.lg, alignment: .top)],
            alignment: .leading,
            spacing: TSSpacing.lg
        ) {
            FleetConfigTool(model: model)
            PartnerRegistrationTool(model: model)
            PartnerPublicKeyTool(model: model)
            PublicKeySetupTool(model: model)
            VehicleKeyPairingTool(model: model)
            FleetTelemetrySubscribeTool(model: model)
            FleetTelemetryConfigTool(model: model)
            FleetStatusTool(model: model)
            VehicleDataTools(model: model)
        }
    }
}
