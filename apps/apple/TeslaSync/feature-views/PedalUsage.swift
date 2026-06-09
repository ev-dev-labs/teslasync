//
//  PedalUsage.swift
//  TeslaSync — P4 feature view · 0173 · PedalUsage (Apple)
//
//  The composable driving-dynamics "Pedal Usage" surface — the SwiftUI parity of
//  features/driving/components/driving-dynamics/PedalUsage.tsx. Renders every state from the web
//  source (loading skeleton / empty / error / stale / offline / content) for the live throttle and
//  brake position gauges plus the brake-active status badge, binding through `PedalUsageModel`
//  (P1/S8). No networking lives here; the freshness chip + auto-refresh reflect the bound source's
//  live-state.
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension PedalUsageStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file) so
    /// the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - PedalUsage (the driving-dynamics surface)

/// The composable Pedal Usage surface — the SwiftUI parity of
/// `features/driving/components/driving-dynamics/PedalUsage.tsx`. Renders every state from the web
/// source and the responsive pedal row (Throttle / Brake gauges + brake-active badge), binding
/// through `PedalUsageModel` (P1/S8). No networking lives here.
public struct PedalUsage: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = PedalUsageSurface.slug

    @State private var model: PedalUsageModel

    public init(model: PedalUsageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.1) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    header
                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear {
            model.start()
            model.autoRefreshIfStale()
        }
        .onDisappear { model.stop() }
        .onChange(of: model.connection) { _, _ in model.autoRefreshIfStale() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header (web `<h2>` title + freshness chip)

private extension PedalUsage {
    /// The always-visible panel header: the web `<h2>{t('dynamics.pedalUsage', …)}</h2>` title with
    /// the freshness chip trailing while fetching or when the bound source is stale/offline.
    var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            PedalUsageStrings.text("dynamics.pedalUsage", "Pedal Usage")
                .font(Font.TS.section)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            if showsFreshnessChip {
                PedalFreshnessChip(
                    connection: model.connection,
                    isFetching: model.isFetching,
                    updatedAt: model.updatedAt
                )
            }
        }
    }

    /// The freshness chip appears only while fetching or when the bound source is stale/offline (the
    /// prompt's stale-chip / offline-chip states); when live + idle the header is just the title.
    var showsFreshnessChip: Bool {
        model.isFetching || model.connection != .live
    }
}

// MARK: - Content states

private extension PedalUsage {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            PedalLoadingGrid()
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            if let projection = model.projection {
                PedalGrid(projection: projection)
            } else {
                emptyState
            }
        }
    }

    /// The web empty branch: `<EmptyState message={t('dynamics.pedalNoData', 'No pedal telemetry
    /// received yet')} />`.
    var emptyState: some View {
        TSEmptyState(
            title: LocalizedStringKey(
                PedalUsageStrings.string("dynamics.pedalNoData", "No pedal telemetry received yet")
            ),
            systemImage: "shoeprints.fill"
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
    }

    /// Native failure branch (the web leaf has no error state of its own): a retryable error with the
    /// bound source's message, mirroring the QueryError affordance the prompt requires.
    func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            PedalUsageStrings.text("dynamics.pedal.errorTitle", "Couldn't load pedal telemetry")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button {
                model.refresh()
            } label: {
                PedalUsageStrings.text("dynamics.pedal.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(PedalUsageStrings.text("dynamics.pedal.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
