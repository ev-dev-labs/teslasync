//
//  LiveMotorStatus.swift
//  TeslaSync — P4 feature view · 0157 · LiveMotorStatus (Apple)
//
//  The drivetrain-health "Live Motor Status" surface — the SwiftUI parity of
//  features/driving/components/drivetrain-health/LiveMotorStatus.tsx. Renders every state from the
//  web source (loading skeleton / empty / error / stale / offline / content) for the four status
//  cards (Shift State / Power / Regen / Source) and the nine inline metrics (per-axle RPM + torque,
//  the motor / inverter / battery temperatures, and HV isolation), binding through
//  `LiveMotorStatusModel` (P1/S8). No networking lives here; the freshness chip + auto-refresh
//  reflect the bound source's live-state.
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension LiveMotorStatusStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file) so
    /// the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - LiveMotorStatus (the drivetrain-health surface)

/// The composable Live Motor Status surface — the SwiftUI parity of
/// `features/driving/components/drivetrain-health/LiveMotorStatus.tsx`. Renders every state from the
/// web source, the four status cards, and the nine inline metrics, binding through
/// `LiveMotorStatusModel` (P1/S8). No networking lives here.
public struct LiveMotorStatus: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = LiveMotorStatusSurface.slug

    @State private var model: LiveMotorStatusModel

    public init(model: LiveMotorStatusModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.22) {
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

// MARK: - Header (web `<h3>` Cog title + freshness chip)

private extension LiveMotorStatus {
    /// The always-visible panel header: the web `<h3><Cog/>{t('drivetrain.liveMotor', …)}</h3>` —
    /// an uppercase muted title with a leading gear glyph — with the freshness chip trailing while
    /// fetching or when the bound source is stale / offline.
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "gearshape.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            LiveMotorStatusStrings.text("drivetrain.liveMotor", "Live Motor Status")
                .font(Font.TS.body)
                .fontWeight(.medium)
                .textCase(.uppercase)
                .tracking(0.8)
                .foregroundStyle(Color.TS.textMuted)
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

    /// The chip appears only while fetching or when the bound source is stale / offline (the
    /// prompt's stale-chip / offline-chip states); when live + idle the header is just the title.
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
                LiveMotorStatusGrid(projection: projection)
            } else {
                emptyState
            }
        }
    }

    /// The web empty branch: `<EmptyState message={t('drivetrain.noLiveMotor', 'No live motor
    /// telemetry yet')} />`.
    var emptyState: some View {
        TSEmptyState(
            title: LocalizedStringKey(
                LiveMotorStatusStrings.string("drivetrain.noLiveMotor", "No live motor telemetry yet")
            ),
            systemImage: "bolt.car.fill"
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
    }

    /// Native failure branch (the web leaf has no error state of its own): a retryable QueryError
    /// equivalent with the bound source's message, mirroring the affordance the prompt requires.
    func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            LiveMotorStatusStrings.text("drivetrain.motor.errorTitle", "Couldn't load motor status")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(
                LocalizedStringKey(LiveMotorStatusStrings.string("drivetrain.motor.retry", "Retry")),
                variant: .secondary,
                size: .small
            ) {
                model.refresh()
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
