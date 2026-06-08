import SwiftUI

// The pure, KMP-free SwiftUI surface for the BatteryRadialGauge widget: the
// radial gauge (web `RadialGauge` + `ChargeLimitRing`) and the panel chrome that
// renders every loading / empty / error / stale / offline branch. State tests
// and previews drive these directly with a `BatteryRadialGaugeRenderState`.

// MARK: - Gauge

/// The radial battery gauge — a native port of the web `RadialGauge` plus the
/// `ChargeLimitRing` overlay. Honors Reduce Motion for the fill animation.
struct BatteryRadialGauge: View {
    let projection: BatteryGaugeProjection
    let diameter: CGFloat
    let showsLabel: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let strokeWidth: CGFloat = 8

    private var bandColor: Color {
        switch projection.band {
        case .high: Color.TS.statusSuccess
        case .medium: Color.TS.statusWarning
        case .low: Color.TS.statusDanger
        case .unknown: Color.TS.textMuted
        }
    }

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            ZStack {
                Circle()
                    .stroke(Color.TS.border.opacity(0.4), lineWidth: strokeWidth)
                Circle()
                    .trim(from: 0, to: projection.clampedLevel / 100)
                    .stroke(bandColor, style: StrokeStyle(lineWidth: strokeWidth, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(
                        reduceMotion ? nil : .easeInOut(duration: TSMotion.slowDuration),
                        value: projection.clampedLevel
                    )
                if projection.showsChargeLimit {
                    Circle()
                        .trim(from: 0, to: projection.chargeLimitFraction)
                        .stroke(Color.white.opacity(0.25), style: StrokeStyle(lineWidth: 2, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                }
                HStack(alignment: .firstTextBaseline, spacing: 1) {
                    Text(verbatim: "\(projection.levelPercent)")
                        .font(.system(size: diameter * 0.26, weight: .bold))
                        .foregroundStyle(Color.TS.textPrimary)
                    Text(verbatim: "%")
                        .font(.system(size: diameter * 0.14))
                        .foregroundStyle(Color.TS.textSecondary)
                }
                .monospacedDigit()
            }
            .frame(width: diameter, height: diameter)
            if showsLabel {
                Text(LocalizedStringKey("translation.widget.battery"))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(LocalizedStringKey("translation.widget.battery")))
        .accessibilityValue(Text(verbatim: "\(projection.levelPercent)%"))
    }
}

// MARK: - Content

/// The pure body of the widget: the panel chrome (title + freshness) and every
/// render branch (skeleton / gauge / empty / error). State tests construct this
/// directly with a `BatteryRadialGaugeRenderState`.
struct BatteryRadialGaugeContent: View {
    let renderState: BatteryRadialGaugeRenderState
    let size: TSDashboardWidgetSize
    let onRefresh: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var chargingPulse = false

    var body: some View {
        panelBody
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(
                Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }

    @ViewBuilder
    private var panelBody: some View {
        switch renderState.phase {
        case .loading:
            GeometryReader { geo in
                TSSkeleton(width: geo.size.width, height: geo.size.height, cornerRadius: TSRadius.lg)
            }
        case let .failure(retryable):
            failureState(retryable: retryable)
        case .content:
            shell
        }
    }

    // MARK: Shell

    private var shell: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            if !size.isCompact {
                header
            }
            bodyContent
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
        .overlay(alignment: .topTrailing) {
            if size.isCompact {
                freshnessIndicator
                    .padding(TSSpacing.sm)
            }
        }
    }

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "minus.plus.batteryblock")
                .font(.system(size: 12))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(LocalizedStringKey("translation.widget.batteryRadial"))
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            freshnessIndicator
        }
    }

    /// Freshness chip: an offline / stale / fetching indicator plus a manual
    /// refresh control (web `DataFreshness` `isFetching/isStale/isError/onRefresh`).
    private var freshnessIndicator: some View {
        HStack(spacing: TSSpacing.xs) {
            if renderState.isOffline {
                Image(systemName: "wifi.slash")
                    .font(.caption2)
                    .foregroundStyle(Color.TS.statusWarning)
                    .accessibilityLabel(Text(LocalizedStringKey("translation.common.offline")))
            } else if renderState.isStale {
                Image(systemName: "clock.badge.exclamationmark")
                    .font(.caption2)
                    .foregroundStyle(Color.TS.statusWarning)
                    .accessibilityLabel(Text(LocalizedStringKey("translation.live.staleBanner.title")))
            } else if renderState.isFetching {
                ProgressView()
                    .controlSize(.mini)
                    .accessibilityHidden(true)
            }
            Button(action: onRefresh) {
                Image(systemName: "arrow.clockwise").font(.caption2)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(Text(LocalizedStringKey("translation.common.refresh")))
        }
    }

    // MARK: Body branches

    @ViewBuilder
    private var bodyContent: some View {
        if let projection = renderState.projection {
            gauge(projection)
        } else {
            emptyState
        }
    }

    private func gauge(_ projection: BatteryGaugeProjection) -> some View {
        VStack(spacing: TSSpacing.sm) {
            BatteryRadialGauge(
                projection: projection,
                diameter: size.isCompact ? 70 : 100,
                showsLabel: !size.isCompact
            )
            if size.isExpanded {
                statsRow(projection.stats)
            }
            if projection.isCharging {
                chargingIndicator
            }
        }
    }

    private func statsRow(_ stats: [BatteryGaugeStat]) -> some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            ForEach(stats) { stat in
                VStack(spacing: 2) {
                    Text(LocalizedStringKey(stat.labelKey))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                    HStack(alignment: .firstTextBaseline, spacing: 1) {
                        Text(verbatim: stat.value)
                            .font(Font.TS.bodySm)
                            .fontWeight(.semibold)
                            .foregroundStyle(Color.TS.textPrimary)
                        Text(verbatim: stat.unit)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textSecondary)
                    }
                    .monospacedDigit()
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private var chargingIndicator: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "bolt.fill").font(.caption2)
            Text(LocalizedStringKey("translation.widget.charging")).font(Font.TS.caption)
        }
        .foregroundStyle(Color.TS.statusSuccess)
        .opacity(reduceMotion ? 1 : (chargingPulse ? 0.55 : 1))
        .animation(
            reduceMotion ? nil : .easeInOut(duration: 1).repeatForever(autoreverses: true),
            value: chargingPulse
        )
        .onAppear { chargingPulse = true }
        .accessibilityElement(children: .combine)
    }

    private var emptyState: some View {
        TSEmptyState(title: "translation.widget.noBattery", systemImage: "minus.plus.batteryblock")
    }

    private func failureState(retryable: Bool) -> some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: renderState.isOffline ? "wifi.slash" : "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
            Text(LocalizedStringKey(
                renderState.isOffline ? "translation.common.offline" : "translation.error.loadFailed"
            ))
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textPrimary)
            .multilineTextAlignment(.center)
            if retryable {
                Button(action: onRefresh) {
                    Text(LocalizedStringKey("translation.common.retry"))
                        .font(Font.TS.caption)
                        .fontWeight(.medium)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.TS.accent)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Previews

#if DEBUG
    private struct BatteryRadialGaugePreviewHarness: View {
        var body: some View {
            let charged = BatteryGaugeProjection(batteryLevel: 82, chargeLimitSoc: 90, isCharging: true)
            let low = BatteryGaugeProjection(batteryLevel: 12, chargeLimitSoc: nil, isCharging: false)
            return ScrollView {
                VStack(spacing: TSSpacing.lg) {
                    preview("Loaded (charging)", BatteryRadialGaugeRenderState(
                        phase: .content, projection: charged,
                        isStale: false, isOffline: false, isFetching: true
                    ), size: TSDashboardWidgetSize(cols: 2, rows: 2))
                    preview("Low (stale)", BatteryRadialGaugeRenderState(
                        phase: .content, projection: low,
                        isStale: true, isOffline: false, isFetching: false
                    ), size: TSDashboardWidgetSize(cols: 1, rows: 2))
                    preview("Empty (offline)", BatteryRadialGaugeRenderState(
                        phase: .content, projection: nil,
                        isStale: false, isOffline: true, isFetching: false
                    ), size: TSDashboardWidgetSize(cols: 1, rows: 2))
                    preview("Error", BatteryRadialGaugeRenderState(
                        phase: .failure(retryable: true), projection: nil,
                        isStale: false, isOffline: false, isFetching: false
                    ), size: TSDashboardWidgetSize(cols: 1, rows: 2))
                    preview("Loading", BatteryRadialGaugeRenderState(
                        phase: .loading, projection: nil,
                        isStale: false, isOffline: false, isFetching: false
                    ), size: TSDashboardWidgetSize(cols: 1, rows: 2))
                }
                .padding()
            }
        }

        @MainActor
        private func preview(
            _ title: String,
            _ state: BatteryRadialGaugeRenderState,
            size: TSDashboardWidgetSize
        ) -> some View {
            VStack(alignment: .leading) {
                Text(verbatim: title).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                BatteryRadialGaugeContent(renderState: state, size: size, onRefresh: {})
                    .frame(height: 200)
            }
        }
    }

    #Preview("BatteryRadialGauge — states") {
        BatteryRadialGaugePreviewHarness().background(Color.TS.bg)
    }
#endif
