//
//  DriveScoreGaugeWidget.swift
//  TeslaSync — P4 dashboard widget · 0039 · DriveScoreGaugeWidget (Apple)
//
//  The composable Drive Score Gauge dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/DriveScoreGaugeWidget.tsx. Binds through `DriveScoreGaugeWidgetModel`
//  (no networking in the view) and renders every state from the web source.
//

import SwiftUI

// MARK: - DriveScoreGaugeWidget (the dashboard surface)

/// The composable Drive Score Gauge dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/DriveScoreGaugeWidget.tsx`. Renders every state from the web source
/// (loading / empty / error / stale / offline / content) inside a glass widget shell, binding through
/// `DriveScoreGaugeWidgetModel` (P1/S8). No networking lives here.
public struct DriveScoreGaugeWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = DriveScoreGaugeWidgetSurface.slug

    /// Canonical registry metadata (registry/driving.ts → "drive-score-gauge").
    public static let registration = DriveScoreGaugeWidgetSurface.registration

    @State private var model: DriveScoreGaugeWidgetModel
    private let size: DashboardWidgetSize

    public init(
        model: DriveScoreGaugeWidgetModel,
        size: DashboardWidgetSize = DriveScoreGaugeWidget.registration.defaultSize
    ) {
        _model = State(initialValue: model)
        self.size = DriveScoreGaugeWidget.registration.clamp(size)
    }

    /// Web `isCompact = size.cols === 1 && size.rows === 1` — drops the title/icon + sub-score detail.
    private var isCompact: Bool {
        size.cols == 1 && size.rows == 1
    }

    /// Web `isTall = size.rows >= 2` — gates the sub-score metric bars below the gauge.
    private var isTall: Bool {
        size.rows >= 2
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: model.connection) { _, _ in model.autoRefreshIfStale() }
        .accessibilityElement(children: .contain)
    }

    /// SwiftUI `Text` from the P1/S10 catalog (the view holds no English literals).
    private func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: DriveScoreGaugeWidgetStrings.string(key, fallback))
    }
}

extension DriveScoreGaugeWidget {
    // MARK: Header

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "gauge.medium")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                text("widget.driveScoreGauge.title", "Drive Score")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: TSSpacing.sm)
            if model.phase != .loading {
                freshnessChip
            }
            refreshButton
        }
    }

    private var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = DriveScoreGaugeWidgetStrings.string("widget.driveScoreGauge.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = DriveScoreGaugeWidgetStrings.string("widget.driveScoreGauge.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = DriveScoreGaugeWidgetStrings.string("widget.driveScoreGauge.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(text("widget.driveScoreGauge.refresh", "Refresh"))
    }

    // MARK: Content states

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            DriveScoreGaugeLoadingView()
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            if let projection = model.projection {
                gaugeHero(projection)
            } else {
                emptyState
            }
        }
    }

    /// Web `<EmptyState message={t('widget.driveScoreGauge.noData', 'No score yet')} />`.
    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                text("widget.driveScoreGauge.noData", "No score yet")
            } icon: {
                Image(systemName: "gauge.medium")
            }
        } description: {
            text("widget.driveScoreGauge.emptyHint", "Your weekly drive score appears here after a few drives.")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            text("widget.driveScoreGauge.errorTitle", "Couldn't load drive score")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
            Button {
                model.refresh()
            } label: {
                text("widget.driveScoreGauge.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(text("widget.driveScoreGauge.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    // MARK: Gauge hero (web `WidgetGaugeHero`)

    private func gaugeHero(_ projection: DriveScoreGaugeWidgetProjection) -> some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: TSSpacing.md) {
                if model.connection != .live {
                    DriveScoreConnectivityBanner(connection: model.connection)
                }
                DriveScoreRadialGauge(gauge: projection.gauge, diameter: isCompact ? 70 : 100)
                if !isCompact {
                    DriveScoreStatCluster(stats: projection.stats)
                }
                if !isCompact, isTall {
                    VStack(spacing: TSSpacing.sm) {
                        ForEach(projection.bars) { bar in
                            DriveScoreMetricBar(bar: bar)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, TSSpacing.xs)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
