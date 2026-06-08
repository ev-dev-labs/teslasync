//
//  MotorPerformanceWidget.swift
//  TeslaSync — P4 dashboard widget · 0067 · MotorPerformanceWidget (Apple)
//
//  The composable Motor Performance dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/MotorPerformanceWidget.tsx. Binds through `MotorPerformanceModel`
//  (no networking in the view) and renders every state: loading / empty / error / content, with a
//  live / stale / offline freshness chip. Responsive: a single-column footprint collapses to the web's
//  compact gear + torque readout; ≥ 2 columns show the radial torque gauge + the 2 × 2 metric grid.
//

import SwiftUI

// MARK: - MotorPerformanceWidget (the dashboard surface)

/// The composable Motor Performance dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/MotorPerformanceWidget.tsx`. Renders the live motor data (torque, stator
/// temp, gear state, lateral / longitudinal g-forces) inside a glass widget shell, binding through
/// `MotorPerformanceModel` (P1/S8). No networking lives here.
public struct MotorPerformanceWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "MotorPerformanceWidget"

    /// Canonical registry metadata (registry/vehicle.ts → "motor-performance").
    public static let registration = DashboardWidgetRegistration(
        id: "motor-performance",
        nameKey: "widget.motorPerformance.title",
        descriptionKey: "widget.motorPerformance.description",
        category: "vehicle",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: MotorPerformanceModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: MotorPerformanceModel,
        size: DashboardWidgetSize = MotorPerformanceWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = MotorPerformanceWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// The web `isCompact = size.cols <= 1` branch.
    private var isCompact: Bool {
        size.cols <= 1
    }

    public var body: some View {
        content
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case let .error(message):
            errorState(message)
        case .empty:
            readyContainer { emptyState }
        case .content:
            readyContainer { contentBody }
        }
    }
}

// MARK: - Chrome (header / compact overlay)

extension MotorPerformanceWidget {
    /// Wraps a ready (non-loading, non-error) body in the correct chrome: the full header row at ≥ 2
    /// columns, or the web title-less compact layout with an overlaid freshness indicator.
    @ViewBuilder
    private func readyContainer(@ViewBuilder _ body: () -> some View) -> some View {
        if isCompact {
            ZStack(alignment: .topTrailing) {
                body()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                compactFreshnessOverlay
            }
        } else {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                header
                body()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            MotorPerformanceStrings.text("widget.motorPerformance.title", "Motor Performance")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            MotorFreshnessChip(
                connection: model.connection,
                isFetching: model.isFetching,
                updatedAt: model.updatedAt
            )
            MotorRefreshButton(isFetching: model.isFetching) { model.refresh() }
            if onOpen != nil { openButton }
        }
    }

    private var compactFreshnessOverlay: some View {
        HStack(spacing: TSSpacing.xs) {
            MotorFreshnessChip(
                connection: model.connection,
                isFetching: model.isFetching,
                updatedAt: model.updatedAt,
                showsLabel: false
            )
            MotorRefreshButton(isFetching: model.isFetching) { model.refresh() }
        }
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                MotorPerformanceStrings.text("widget.motorPerformance.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(MotorPerformanceStrings.text("widget.motorPerformance.openA11y", "Open motor details"))
    }
}

// MARK: - Content bodies (compact + full)

extension MotorPerformanceWidget {
    @ViewBuilder
    private var contentBody: some View {
        if isCompact {
            compactBody
        } else {
            fullBody
        }
    }

    /// The web compact branch: stacked Gear + Torque readouts, vertically centered.
    private var compactBody: some View {
        let projection = model.projection
        let nmUnit = MotorPerformanceStrings.string("widget.motorPerformance.nm", "Nm")
        return VStack(spacing: TSSpacing.xs) {
            Spacer(minLength: 0)
            captionLabel("widget.motorPerformance.gear", "Gear")
            Text(verbatim: projection.gearText)
                .font(Font.TS.section)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            captionLabel("widget.motorPerformance.torque", "Torque")
                .padding(.top, TSSpacing.xs)
            Text(verbatim: "\(projection.torqueLabelText) \(nmUnit)")
                .font(Font.TS.panel)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.top, TSSpacing.md)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: MotorPerformanceAccessibility.summary(for: projection)))
    }

    /// The web full branch: the radial torque gauge over the 2 × 2 metric grid.
    private var fullBody: some View {
        let projection = model.projection
        let nmUnit = MotorPerformanceStrings.string("widget.motorPerformance.nm", "Nm")
        return VStack(spacing: TSSpacing.md) {
            MotorTorqueGauge(
                fraction: projection.gaugeFraction,
                valueText: projection.gaugeValueText,
                unit: nmUnit,
                captionText: projection.torqueLabelText,
                tint: projection.torqueZone.color
            )
            metricGrid(projection)
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }

    private func metricGrid(_ projection: MotorProjection) -> some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: TSSpacing.sm), count: 2)
        let gForce = MotorProjection.gForceUnit
        return LazyVGrid(columns: columns, spacing: TSSpacing.sm) {
            MotorStatTile(
                label: MotorPerformanceStrings.string("widget.motorPerformance.statorTemp", "Stator Temp"),
                value: projection.statorTempText ?? "—",
                unit: projection.statorTempUnit
            )
            MotorStatTile(
                label: MotorPerformanceStrings.string("widget.motorPerformance.gearState", "Gear State"),
                value: projection.gearText
            )
            MotorStatTile(
                label: MotorPerformanceStrings.string("widget.motorPerformance.lateralG", "Lateral G"),
                value: projection.lateralGText ?? "—",
                unit: projection.lateralGText == nil ? nil : gForce
            )
            MotorStatTile(
                label: MotorPerformanceStrings.string("widget.motorPerformance.longitudinalG", "Longitudinal G"),
                value: projection.longitudinalGText ?? "—",
                unit: projection.longitudinalGText == nil ? nil : gForce
            )
        }
    }

    private func captionLabel(_ key: String, _ fallback: String) -> some View {
        MotorPerformanceStrings.text(key, fallback)
            .font(Font.TS.caption)
            .textCase(.uppercase)
            .tracking(0.6)
            .foregroundStyle(Color.TS.textMuted)
    }
}

// MARK: - Non-ready states (loading / empty / error)

extension MotorPerformanceWidget {
    /// The web `WidgetShell` loading branch: a skeleton standing in for the gauge + metric grid.
    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if !isCompact {
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 120, height: 10)
                    Spacer(minLength: 0)
                    TSSkeleton(width: 44, height: 10)
                }
            }
            TSSkeleton(height: isCompact ? 64 : 104, cornerRadius: TSRadius.lg)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            if !isCompact {
                LazyVGrid(
                    columns: Array(repeating: GridItem(.flexible(), spacing: TSSpacing.sm), count: 2),
                    spacing: TSSpacing.sm
                ) {
                    ForEach(0 ..< 4, id: \.self) { _ in
                        TSSkeleton(height: 40, cornerRadius: TSRadius.sm)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(MotorPerformanceStrings.text("widget.motorPerformance.loading", "Loading motor data"))
    }

    /// The web `EmptyState` body (Zap icon + "No motor data"), always shown — never a blank panel.
    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                MotorPerformanceStrings.text("widget.motorPerformance.noData", "No motor data")
            } icon: {
                Image(systemName: "bolt.fill")
            }
        } description: {
            MotorPerformanceStrings.text(
                "widget.motorPerformance.emptyHint",
                "Motor telemetry will appear here once the vehicle reports."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// The web `WidgetShell` error branch (`QueryError`) with a retry affordance.
    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
            MotorPerformanceStrings.text("widget.motorPerformance.errorTitle", "Couldn't load motor data")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
            }
            Button {
                model.refresh()
            } label: {
                MotorPerformanceStrings.text("widget.motorPerformance.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}
