//
//  BatteryHealthAnalyticsWidget.swift
//  TeslaSync — P4 dashboard widget · 0014 · BatteryHealthAnalyticsWidget (Apple)
//
//  The composable Battery Analytics dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/BatteryHealthAnalyticsWidget.tsx. Binds through
//  `BatteryHealthAnalyticsWidgetModel` (no networking in the view) and renders every state from the
//  web source.
//

import SwiftUI

// MARK: - BatteryHealthAnalyticsWidget (the dashboard surface)

/// The composable Battery Analytics dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/BatteryHealthAnalyticsWidget.tsx`. Renders every state from the web
/// source (loading / empty / error / stale / offline / content) inside a glass widget shell, binding
/// through `BatteryHealthAnalyticsWidgetModel` (P1/S8). No networking lives here.
public struct BatteryHealthAnalyticsWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = BatteryHealthAnalyticsWidgetSurface.slug

    /// Canonical registry metadata (registry/battery.ts → "battery-health-analytics").
    public static let registration = BatteryHealthAnalyticsWidgetSurface.registration

    @State private var model: BatteryHealthAnalyticsWidgetModel
    private let size: DashboardWidgetSize

    public init(
        model: BatteryHealthAnalyticsWidgetModel,
        size: DashboardWidgetSize = BatteryHealthAnalyticsWidget.registration.defaultSize
    ) {
        _model = State(initialValue: model)
        self.size = BatteryHealthAnalyticsWidget.registration.clamp(size)
    }

    /// Web `isCompact = size.cols <= 1` — drops the title/icon + the stat cluster, leaving the gauge.
    private var isCompact: Bool {
        size.cols <= 1
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
        Text(verbatim: BatteryHealthAnalyticsWidgetStrings.string(key, fallback))
    }
}

extension BatteryHealthAnalyticsWidget {
    // MARK: Header

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "waveform.path.ecg")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.statusSuccess)
                    .accessibilityHidden(true)
                text("widget.batteryHealthAnalytics.title", "Battery Analytics")
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
            label = BatteryHealthAnalyticsWidgetStrings.string("widget.batteryHealthAnalytics.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = BatteryHealthAnalyticsWidgetStrings.string("widget.batteryHealthAnalytics.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = BatteryHealthAnalyticsWidgetStrings.string("widget.batteryHealthAnalytics.offline", "Offline")
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
        .accessibilityLabel(text("widget.batteryHealthAnalytics.refresh", "Refresh"))
    }

    // MARK: Content states

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            BatteryHealthLoadingView(showStats: !isCompact)
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

    /// Web `<EmptyState message={t('widget.batteryHealthAnalytics.noData', 'No battery health data')} />`.
    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                text("widget.batteryHealthAnalytics.noData", "No battery health data")
            } icon: {
                Image(systemName: "waveform.path.ecg")
            }
        } description: {
            text(
                "widget.batteryHealthAnalytics.emptyHint",
                "Battery health analytics appear here once enough charge history is collected."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            text("widget.batteryHealthAnalytics.errorTitle", "Couldn't load battery health")
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
                text("widget.batteryHealthAnalytics.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(text("widget.batteryHealthAnalytics.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    // MARK: Gauge hero (web `WidgetGaugeHero`)

    private func gaugeHero(_ projection: BatteryHealthAnalyticsWidgetProjection) -> some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: TSSpacing.md) {
                if model.connection != .live {
                    BatteryHealthConnectivityBanner(connection: model.connection)
                }
                BatteryHealthRadialGauge(gauge: projection.gauge, diameter: isCompact ? 70 : 100)
                if !isCompact {
                    BatteryHealthStatCluster(stats: projection.stats)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, TSSpacing.xs)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
