//
//  TelemetryErrorsWidget.swift
//  TeslaSync — P4 dashboard widget · 0100 · TelemetryErrorsWidget (Apple)
//
//  The composable Telemetry Errors dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/TelemetryErrorsWidget.tsx. Binds through
//  `TelemetryErrorsModel` (no networking in the view); renders every state
//  (loading / empty / error / content) with a live/fetching/stale/offline/error
//  freshness chip, and the responsive compact (1×2) vs standard (2×4) layouts
//  from the web source.
//

import SwiftUI

// MARK: - TelemetryErrorsWidget (the dashboard surface)

/// The composable Telemetry Errors dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/TelemetryErrorsWidget.tsx`. Renders every state
/// from the web source inside a glass widget shell, binding through
/// `TelemetryErrorsModel` (P1/S8). No networking lives here.
public struct TelemetryErrorsWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "TelemetryErrorsWidget"

    /// Canonical registry metadata (registry/system.ts → "telemetry-errors").
    public static let registration = DashboardWidgetRegistration(
        id: "telemetry-errors",
        nameKey: "widget.telemetryErrors.title",
        descriptionKey: "widget.telemetryErrors.description",
        category: "system",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: TelemetryErrorsModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: TelemetryErrorsModel,
        size: DashboardWidgetSize = TelemetryErrorsWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = TelemetryErrorsWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    private var isCompact: Bool {
        TelemetryErrorsModel.isCompact(size)
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

// MARK: - Header

extension TelemetryErrorsWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            if !isCompact {
                TelemetryErrorsStrings.text("widget.telemetryErrors.title", "Telemetry Errors")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: TSSpacing.sm)
            TelemetryFreshnessChip(
                freshness: model.freshness,
                updatedAt: model.updatedAt,
                compact: isCompact,
                onRefresh: { model.refresh() }
            )
            if onOpen != nil { openButton }
        }
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                TelemetryErrorsStrings.text("widget.open", "Open").font(Font.TS.label)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(TelemetryErrorsStrings.text(
            "widget.telemetryErrors.openA11y",
            "Open the Fleet Telemetry page"
        ))
    }
}

// MARK: - Content states

extension TelemetryErrorsWidget {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case .empty:
            TelemetryErrorsEmptyState()
        case let .error(message):
            errorState(message)
        case .content:
            if isCompact { compactContent } else { standardContent }
        }
    }

    private var loadingChrome: some View {
        Group {
            if isCompact {
                VStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 56, height: 24, cornerRadius: TSRadius.sm)
                    TSSkeleton(width: 64, height: 10, cornerRadius: TSRadius.sm)
                    TSSkeleton(width: 72, height: 24, cornerRadius: TSRadius.pill)
                }
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    HStack {
                        TSSkeleton(width: 120, height: 12, cornerRadius: TSRadius.sm)
                        Spacer()
                        TSSkeleton(width: 56, height: 18, cornerRadius: TSRadius.pill)
                    }
                    ForEach(0 ..< 3, id: \.self) { _ in
                        TSSkeleton(height: 44, cornerRadius: TSRadius.md)
                    }
                    Spacer(minLength: 0)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement()
        .accessibilityLabel(TelemetryErrorsStrings.text("widget.telemetryErrors.loading", "Loading telemetry errors"))
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            TelemetryErrorsStrings.text("widget.telemetryErrors.errorTitle", "Couldn't load telemetry errors")
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
                TelemetryErrorsStrings.text("widget.telemetryErrors.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(TelemetryErrorsStrings.text("widget.telemetryErrors.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Content layouts (web compact 1×2 / standard 2×4)

extension TelemetryErrorsWidget {
    /// Compact layout (1×2): the active-VIN count over its label + the status
    /// badge (web `isCompact` branch).
    private var compactContent: some View {
        VStack(spacing: TSSpacing.xs) {
            Spacer(minLength: 0)
            Text(verbatim: TelemetryErrorsFormat.int(model.activeVINCount))
                .font(Font.TS.title)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            TelemetryErrorsStrings.text("widget.telemetryErrors.errorVINs", "error VINs")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            TelemetryStatusBadge(status: model.status, emphasized: true)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, minHeight: 44, maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: TelemetryErrorsAccessibility.summary(
            activeVINCount: model.activeVINCount,
            status: model.status
        )))
    }

    /// Standard layout (2×4): the active-VIN header + status badge over the
    /// scrollable aggregated-error feed (web standard branch).
    private var standardContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(alignment: .firstTextBaseline) {
                Text(verbatim: TelemetryErrorsStrings.count(
                    "widget.telemetryErrors.activeVINs",
                    "%lld VINs with errors",
                    model.activeVINCount
                ))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                Spacer(minLength: TSSpacing.sm)
                TelemetryStatusBadge(status: model.status)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: TelemetryErrorsAccessibility.summary(
                activeVINCount: model.activeVINCount,
                status: model.status
            )))

            TelemetryErrorFeed(aggregates: model.aggregates)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}
