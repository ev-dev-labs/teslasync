//
//  TirePressureVisualWidget.swift
//  TeslaSync — P4 dashboard widget · 0102 · TirePressureVisualWidget (Apple)
//
//  The composable Tire Pressure Visual dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/TirePressureVisualWidget.tsx. Renders every state
//  from the web source (loading / empty / error / stale / offline / content)
//  inside a glass widget shell, binding through `TirePressureModel` (P1/S8). No
//  networking lives here. The shared registry types (`DashboardWidgetSize` /
//  `DashboardWidgetRegistration`) are REUSED from the canonical surface — not
//  redeclared — so there is no duplicate symbol when both compile in the module.
//

import Foundation
import SwiftUI

// MARK: - TirePressureVisualWidget (the dashboard surface)

/// The composable Tire Pressure Visual dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/TirePressureVisualWidget.tsx`. A top-down car
/// silhouette with four color-coded tires flanked by their pressure values, with
/// an All-Normal / Check-Pressure status chip and the unit + reading time in the
/// footer. Renders every state, binding through `TirePressureModel`.
public struct TirePressureVisualWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "TirePressureVisualWidget"

    /// Canonical registry metadata (registry/tires.ts → "tire-pressure-visual").
    public static let registration = DashboardWidgetRegistration(
        id: "tire-pressure-visual",
        nameKey: "widget.tirePressureVisual",
        descriptionKey: "widget.tirePressureVisual.description",
        category: "tires",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 2, rows: 4),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: TirePressureModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: TirePressureModel,
        size: DashboardWidgetSize = TirePressureVisualWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = TirePressureVisualWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `isCompact = size.cols <= 1`.
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
        .accessibilityElement(children: .contain)
    }
}

extension TirePressureVisualWidget {
    // MARK: Header

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "smallcircle.filled.circle")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            if !isCompact {
                TirePressureStrings.text("widget.tirePressure", "Tire Pressure")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: TSSpacing.sm)
            TireFreshnessChip(connection: model.connection)
            refreshButton
            if onOpen != nil { openButton }
        }
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(TirePressureStrings.text("widget.tireRefresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                TirePressureStrings.text("widget.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(TirePressureStrings.text("widget.tireOpenA11y", "Open the tire pressure page"))
    }

    // MARK: Content states

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
        VStack(spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.md) {
                TSSkeleton(width: 44, height: 28, cornerRadius: TSRadius.sm)
                TSSkeleton(width: 60, height: 120, cornerRadius: TSRadius.md)
                TSSkeleton(width: 44, height: 28, cornerRadius: TSRadius.sm)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            HStack {
                TSSkeleton(width: 80, height: 18, cornerRadius: TSRadius.pill)
                Spacer()
                TSSkeleton(width: 64, height: 12)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(TirePressureStrings.text("widget.tireLoading", "Loading tire pressure"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                TirePressureStrings.text("widget.noTireData", "No tire pressure data")
            } icon: {
                Image(systemName: "smallcircle.filled.circle")
            }
        } description: {
            TirePressureStrings.text(
                "widget.tireEmptyHint",
                "Tire pressure will appear once your vehicle reports TPMS readings."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            TirePressureStrings.text("widget.tireErrorTitle", "Couldn't load tire pressure")
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
                TirePressureStrings.text("widget.tireRetry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(TirePressureStrings.text("widget.tireRetry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var loadedContent: some View {
        if let projection = model.projection {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                if model.connection != .live {
                    TireConnectivityBanner(connection: model.connection)
                }
                diagramRow(projection)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                footer(projection)
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(verbatim: TirePressureAccessibility.summary(
                for: projection,
                unit: model.unit,
                locale: model.locale,
                localize: TirePressureStrings.string
            )))
        } else {
            emptyState
        }
    }

    private func diagramRow(_ projection: TirePressureProjection) -> some View {
        HStack(spacing: TSSpacing.md) {
            TireValueColumn(
                top: projection.frontLeft,
                bottom: projection.rearLeft,
                unit: model.unit,
                locale: model.locale,
                alignment: .trailing
            )
            TireCarDiagram(projection: projection)
                .frame(maxWidth: .infinity)
            TireValueColumn(
                top: projection.frontRight,
                bottom: projection.rearRight,
                unit: model.unit,
                locale: model.locale,
                alignment: .leading
            )
        }
    }

    private func footer(_ projection: TirePressureProjection) -> some View {
        let statusTone: TSTone = projection.allNormal ? .success : (projection.hasWarning ? .warning : .danger)
        let statusLabel = projection.allNormal
            ? TirePressureStrings.string("widget.tireAllNormal", "All Normal")
            : TirePressureStrings.string("widget.tireWarning", "Check Pressure")
        let readingTime = TireReadingTime.string(
            for: projection.latestReading,
            localize: TirePressureStrings.string
        )
        return HStack {
            TirePressureChip(tone: statusTone, label: statusLabel)
            Spacer(minLength: TSSpacing.xs)
            Text(verbatim: "\(model.unit.label) · \(readingTime)")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
        }
    }
}
