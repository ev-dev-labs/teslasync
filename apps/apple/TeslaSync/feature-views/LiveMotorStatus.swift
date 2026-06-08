//
//  LiveMotorStatus.swift
//  TeslaSync — P4 feature view · 0170 · LiveMotorStatus (Apple)
//
//  The composable driving-dynamics "Live Motor Status" surface — the SwiftUI parity of
//  features/driving/components/driving-dynamics/LiveMotorStatus.tsx. Renders every state from
//  the web source (loading skeleton / empty / error / stale / offline / content) for the live
//  torque, front-axle RPM, motor-temperature gauges plus the shift-state badge, binding through
//  `LiveMotorStatusModel` (P1/S8). No networking lives here; the freshness chip + auto-refresh
//  reflect the bound source's live-state.
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension LiveMotorStatusStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file)
    /// so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - LiveMotorStatus (the driving-dynamics surface)

/// The composable Live Motor Status surface — the SwiftUI parity of
/// `features/driving/components/driving-dynamics/LiveMotorStatus.tsx`. Renders every state from
/// the web source and the responsive gauge row (Torque / Front RPM / Motor) plus the shift-state
/// badge, binding through `LiveMotorStatusModel` (P1/S8). No networking lives here.
public struct LiveMotorStatus: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = LiveMotorStatusSurface.slug

    @State private var model: LiveMotorStatusModel

    public init(model: LiveMotorStatusModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
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

private extension LiveMotorStatus {
    /// The always-visible panel header: the web `<h2>{t('dynamics.liveMotor', …)}</h2>` title
    /// with the freshness chip trailing while fetching or when the bound source is stale/offline.
    var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            LiveMotorStatusStrings.text("dynamics.liveMotor", "Live Motor Status")
                .font(Font.TS.section)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            if showsFreshnessChip {
                LiveMotorFreshnessChip(
                    connection: model.connection,
                    isFetching: model.isFetching,
                    updatedAt: model.updatedAt
                )
            }
        }
    }

    /// The freshness chip appears only while fetching or when the bound source is stale/offline
    /// (the prompt's stale-chip / offline-chip states); when live + idle the header is just title.
    var showsFreshnessChip: Bool {
        model.isFetching || model.connection != .live
    }
}

// MARK: - Content states

private extension LiveMotorStatus {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            LiveMotorLoadingGrid()
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            if let projection = model.projection {
                LiveMotorGrid(projection: projection)
            } else {
                emptyState
            }
        }
    }

    /// The web empty branch: `<EmptyState message={t('dynamics.noLiveMotor', 'Awaiting live
    /// motor data')} />`.
    var emptyState: some View {
        TSEmptyState(
            title: LocalizedStringKey(
                LiveMotorStatusStrings.string("dynamics.noLiveMotor", "Awaiting live motor data")
            ),
            systemImage: "bolt.car.fill"
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
    }

    /// Native failure branch (the web leaf has no error state of its own): a retryable error with
    /// the bound source's message, mirroring the QueryError affordance the prompt requires.
    func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            LiveMotorStatusStrings.text("dynamics.motor.errorTitle", "Couldn't load motor status")
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
                LiveMotorStatusStrings.text("dynamics.motor.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(LiveMotorStatusStrings.text("dynamics.motor.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
