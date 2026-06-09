//
//  ChargingScheduleWidget.swift
//  TeslaSync — P4 dashboard widget · 0023 · ChargingScheduleWidget (Apple)
//
//  The composable Charging Schedule dashboard surface — the SwiftUI parity of
//  features/dashboard/widgets/ChargingScheduleWidget.tsx. Binds through
//  ChargingScheduleModel (no networking in the view); renders every state and
//  honors the same 1×2…4×40 grid envelope as the web registry. A 1×1 instance
//  collapses to the compact charge-limit hero, exactly like the source.
//

import Foundation
import SwiftUI

// MARK: - ChargingScheduleWidget (the dashboard surface)

/// The Charging Schedule dashboard widget — SwiftUI parity of
/// `features/dashboard/widgets/ChargingScheduleWidget.tsx`. Renders every state
/// from the web source (loading / empty / error / stale / offline / content)
/// inside a glass widget shell, binding through `ChargingScheduleModel` (P1/S8).
/// No networking lives here.
public struct ChargingScheduleWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ChargingScheduleWidget"

    /// Canonical registry metadata (registry/charging.ts → "charging-schedule").
    public static let registration = DashboardWidgetRegistration(
        id: "charging-schedule",
        nameKey: "widget.chargingSchedule.title",
        descriptionKey: "widget.chargingSchedule.description",
        category: "charging",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: ChargingScheduleModel
    private let requestedSize: DashboardWidgetSize
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: ChargingScheduleModel,
        size: DashboardWidgetSize = ChargingScheduleWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        // The requested footprint drives the layout-density branch (web uses the
        // grid size prop); the clamped size keeps the surface inside the registry
        // envelope. Under the 1×2 registry minimum the standard layout renders;
        // the compact (1×1) hero mirrors the source for a 1×1 request.
        requestedSize = size
        self.size = ChargingScheduleWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// A 1×1 instance collapses to the compact charge-limit hero — the web
    /// `size.cols <= 1 && size.rows <= 1` branch.
    private var isCompact: Bool {
        ChargingScheduleModel.isCompact(for: requestedSize)
    }

    /// Whether the standard layout shows the current-level / status detail row —
    /// the web `isTall = size.rows >= 2`.
    private var isTall: Bool {
        ChargingScheduleModel.isTall(for: size)
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

extension ChargingScheduleWidget {
    @ViewBuilder
    private var header: some View {
        if isCompact {
            HStack(spacing: TSSpacing.xs) {
                Spacer(minLength: 0)
                if model.phase != .loading { freshnessChip }
                refreshButton
            }
        } else {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "calendar")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                ChargingScheduleStrings.text("widget.chargingSchedule.title", "Charging Schedule")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.sm)
                if model.phase != .loading { freshnessChip }
                refreshButton
                if onOpen != nil { openButton }
            }
        }
    }

    private var freshnessChip: some View {
        ChargingScheduleFreshnessChip(connection: model.connection)
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(ChargingScheduleStrings.text("widget.chargingSchedule.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                ChargingScheduleStrings.text("widget.chargingSchedule.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            ChargingScheduleStrings.text("widget.chargingSchedule.openA11y", "Open the charging page")
        )
    }
}

// MARK: - Content states

extension ChargingScheduleWidget {
    @ViewBuilder
    private var content: some View {
        if isCompact {
            compactContent
        } else {
            fullContent
        }
    }

    // MARK: Compact

    @ViewBuilder
    private var compactContent: some View {
        switch model.phase {
        case .loading:
            compactLoading
        case let .error(message):
            compactError(message)
        case .empty:
            emptyState(compact: true)
        case .content:
            ChargingScheduleCompactLimit(limitText: model.projection.compactLimitText)
        }
    }

    private var compactLoading: some View {
        VStack(spacing: TSSpacing.xs) {
            TSSkeleton(width: 72, height: 30, cornerRadius: TSRadius.sm)
            TSSkeleton(width: 64, height: 12, cornerRadius: TSRadius.pill)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(
            ChargingScheduleStrings.text("widget.chargingSchedule.loading", "Loading charging schedule")
        )
    }

    private func compactError(_ message: String) -> some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 20))
                .foregroundStyle(Color.TS.statusDanger)
            retryButton(emphasized: false)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: errorAccessibilityLabel(message)))
    }

    // MARK: Standard

    @ViewBuilder
    private var fullContent: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case let .error(message):
            errorState(message)
        case .empty:
            emptyState(compact: false)
        case .content:
            loadedContent
        }
    }

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if model.connection != .live {
                ChargingScheduleConnectivityBanner(connection: model.connection)
            }

            HStack(spacing: TSSpacing.sm) {
                ChargingScheduleModeBadge(mode: model.projection.mode)
                if model.projection.pending { ChargingSchedulePendingBadge() }
                Spacer(minLength: 0)
            }

            if model.projection.hasTimes {
                ChargingScheduleTimeline(items: model.projection.timelineItems)
            } else {
                ChargingScheduleStrings.text("widget.chargingSchedule.noTimes", "No scheduled times set")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            if isTall, model.projection.hasState {
                Spacer(minLength: 0)
                ChargingScheduleDetailRow(
                    batteryLevel: model.projection.batteryLevel,
                    isCharging: model.projection.isCharging
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: ChargingScheduleAccessibility.summary(for: model.projection)))
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(width: 96, height: 22, cornerRadius: TSRadius.pill)
            ForEach(0 ..< 3, id: \.self) { _ in
                TSSkeleton(height: 30, cornerRadius: TSRadius.md)
            }
            TSSkeleton(height: 28, cornerRadius: TSRadius.sm)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(
            ChargingScheduleStrings.text("widget.chargingSchedule.loading", "Loading charging schedule")
        )
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            ChargingScheduleStrings.text("widget.chargingSchedule.errorTitle", "Couldn't load schedule")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            retryButton(emphasized: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: errorAccessibilityLabel(message)))
    }

    private func emptyState(compact: Bool) -> some View {
        ContentUnavailableView {
            Label {
                ChargingScheduleStrings.text("widget.chargingSchedule.noData", "No schedule data")
            } icon: {
                Image(systemName: "calendar")
            }
        } description: {
            if !compact {
                ChargingScheduleStrings.text(
                    "widget.chargingSchedule.emptyHint",
                    "Set a scheduled charge or departure time in your Tesla to see it here."
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func retryButton(emphasized: Bool) -> some View {
        Button {
            model.refresh()
        } label: {
            if emphasized {
                ChargingScheduleStrings.text("widget.chargingSchedule.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            } else {
                ChargingScheduleStrings.text("widget.chargingSchedule.retry", "Retry")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.accent)
            }
        }
        .buttonStyle(.plain)
    }

    private func errorAccessibilityLabel(_ message: String) -> String {
        let title = ChargingScheduleStrings.string("widget.chargingSchedule.errorTitle", "Couldn't load schedule")
        return message.isEmpty ? title : "\(title). \(message)"
    }
}
