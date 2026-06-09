//
//  BatteryGaugeWidget.swift
//  TeslaSync — P4 dashboard widget · 0013 · BatteryGaugeWidget (Apple)
//
//  The composable Battery Level dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/BatteryGaugeWidget.tsx. Binds through `BatteryGaugeWidgetModel`
//  (no networking in the view) and renders every state from the web source.
//

import SwiftUI

// MARK: - BatteryGaugeWidget (the dashboard surface)

/// The composable Battery Level dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/BatteryGaugeWidget.tsx`. Renders every state from the web source
/// (loading / empty / error / stale / offline / content) inside a glass widget shell, binding through
/// `BatteryGaugeWidgetModel` (P1/S8). No networking lives here.
public struct BatteryGaugeWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = BatteryGaugeWidgetSurface.slug

    /// Canonical registry metadata (registry/battery.ts → "battery-gauge").
    public static let registration = BatteryGaugeWidgetSurface.registration

    @State private var model: BatteryGaugeWidgetModel
    private let size: DashboardWidgetSize

    public init(
        model: BatteryGaugeWidgetModel,
        size: DashboardWidgetSize = BatteryGaugeWidget.registration.defaultSize
    ) {
        _model = State(initialValue: model)
        self.size = BatteryGaugeWidget.registration.clamp(size)
    }

    /// Web `isCompact = size.cols === 1 && size.rows === 1` — shrinks the ring and drops the charging
    /// caption. The registry min size is 1×2, so a clamped surface is never compact in practice; the
    /// branch is preserved for parity with the web `WidgetGaugeHero` `compact` path.
    private var isCompact: Bool {
        size.cols == 1 && size.rows == 1
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
        Text(verbatim: BatteryGaugeWidgetStrings.string(key, fallback))
    }
}

extension BatteryGaugeWidget {
    // MARK: Header

    /// The web `BatteryGaugeWidget` renders a title-less `WidgetShell`, so the header carries only the
    /// freshness chip + refresh affordance (right-aligned); the gauge's own "Battery" caption is the
    /// surface identifier.
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Spacer(minLength: 0)
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
            label = BatteryGaugeWidgetStrings.string("widget.battery.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = BatteryGaugeWidgetStrings.string("widget.battery.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = BatteryGaugeWidgetStrings.string("widget.battery.offline", "Offline")
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
        .accessibilityLabel(text("widget.battery.refresh", "Refresh"))
    }

    // MARK: Content states

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            BatteryGaugeWidgetLoadingView()
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

    /// Web `<EmptyState icon={<Battery />} message={t('widget.noBattery', 'No battery data')} />`.
    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                text("widget.noBattery", "No battery data")
            } icon: {
                Image(systemName: "battery.100")
            }
        } description: {
            text("widget.battery.emptyHint", "Battery level appears here once the vehicle reports state.")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            text("widget.battery.errorTitle", "Couldn't load battery level")
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
                text("widget.battery.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(text("widget.battery.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    // MARK: Gauge hero (web `WidgetGaugeHero`)

    private func gaugeHero(_ projection: BatteryGaugeWidgetProjection) -> some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: TSSpacing.md) {
                if model.connection != .live {
                    BatteryGaugeWidgetConnectivityBanner(connection: model.connection)
                }
                BatteryGaugeWidgetRadialGauge(gauge: projection.gauge, diameter: isCompact ? 70 : 100)
                if !isCompact, projection.isCharging {
                    BatteryGaugeWidgetChargingChip(text: projection.chargingText)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, TSSpacing.xs)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
