//
//  UptimeMonitorWidget.swift
//  TeslaSync — P4 dashboard widget · 0104 · UptimeMonitorWidget (Apple)
//
//  The composable Uptime Monitor dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/UptimeMonitorWidget.tsx. Binds through
//  `UptimeMonitorModel` (no networking in the view); renders every state
//  (loading / empty / error / content) with a live/stale/offline freshness chip,
//  and the responsive compact (1×1) vs standard vs tall layouts from the web
//  source (overall badge → service rows → DB-size/tables footer).
//

import SwiftUI

// MARK: - UptimeMonitorWidget (the dashboard surface)

/// The composable Uptime Monitor dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/UptimeMonitorWidget.tsx`. Renders every state from
/// the web source inside a glass widget shell, binding through
/// `UptimeMonitorModel` (P1/S8). No networking lives here.
public struct UptimeMonitorWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "UptimeMonitorWidget"

    /// Canonical registry metadata (registry/system.ts → "uptime-monitor").
    public static let registration = DashboardWidgetRegistration(
        id: "uptime-monitor",
        nameKey: "widget.uptime.title",
        descriptionKey: "widget.uptime.description",
        category: "system",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: UptimeMonitorModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    /// The grid passes an already in-envelope size (the registry `minSize`/
    /// `maxSize` are enforced by the grid via `registration.clamp`). The view uses
    /// it directly — exactly like the web component reads `size` — so the web
    /// breakpoints (`isCompact`/`isTall`) stay faithful and previewable.
    public init(
        model: UptimeMonitorModel,
        size: DashboardWidgetSize = UptimeMonitorWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = size
        self.onOpen = onOpen
    }

    private var isCompact: Bool {
        UptimeMonitorModel.isCompact(size)
    }

    private var isTall: Bool {
        UptimeMonitorModel.isTall(size)
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

extension UptimeMonitorWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            if !isCompact {
                UptimeMonitorStrings.text("widget.uptime.title", "Uptime Monitor")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: TSSpacing.sm)
            UptimeFreshnessChip(connection: model.connection)
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
        .accessibilityLabel(UptimeMonitorStrings.text("widget.uptime.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                UptimeMonitorStrings.text("widget.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(UptimeMonitorStrings.text("widget.uptime.openA11y", "Open the System Health page"))
    }
}

// MARK: - Content states

extension UptimeMonitorWidget {
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
            contentBody
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(width: 96, height: 18, cornerRadius: TSRadius.pill)
            if isCompact {
                TSSkeleton(width: 72, height: 30, cornerRadius: TSRadius.sm)
            } else {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(height: 14, cornerRadius: TSRadius.sm)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement()
        .accessibilityLabel(UptimeMonitorStrings.text("widget.uptime.loading", "Loading system health"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                UptimeMonitorStrings.text("widget.uptime.noData", "No system health data")
            } icon: {
                Image(systemName: "waveform.path.ecg")
            }
        } description: {
            UptimeMonitorStrings.text("widget.uptime.emptyHint", "Waiting for the health monitor to report.")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            UptimeMonitorStrings.text("widget.uptime.errorTitle", "Couldn't load system health")
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
                UptimeMonitorStrings.text("widget.uptime.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(UptimeMonitorStrings.text("widget.uptime.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Content layout (web overall badge / compact count / service rows / footer)

extension UptimeMonitorWidget {
    private var projection: UptimeMonitorProjection {
        model.projection
    }

    private var contentBody: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            overallRow
            if isCompact {
                Spacer(minLength: 0)
                compactCount
                Spacer(minLength: 0)
            } else {
                serviceList
                if isTall {
                    Spacer(minLength: TSSpacing.xs)
                    footer
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityValue(Text(verbatim: UptimeMonitorAccessibility.summary(for: projection)))
    }

    /// The overall status row (web `Overall` label + `All OK`/status badge).
    private var overallRow: some View {
        HStack {
            UptimeMonitorStrings.text("widget.uptime.overall", "Overall")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            Spacer()
            UptimeStatusBadge(
                text: UptimeMonitorStatusText.overallBadge(projection.overallStatus),
                tone: projection.overallTone,
                emphasized: true
            )
        }
    }

    /// The compact (1×1) layout: just the healthy/total count (web
    /// `{healthyCount}/{services.length}`).
    private var compactCount: some View {
        Text(verbatim: UptimeMonitorFormat.healthRatio(
            healthy: projection.healthyCount,
            total: projection.totalCount
        ))
        .font(Font.TS.title)
        .fontWeight(.bold)
        .monospacedDigit()
        .foregroundStyle(Color.TS.textPrimary)
        .lineLimit(1)
        .minimumScaleFactor(0.5)
        .frame(maxWidth: .infinity, alignment: .center)
    }

    /// The standard layout: one row per service (web `services.map(ServiceRow)`).
    private var serviceList: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(projection.services, id: \.key) { service in
                UptimeServiceRow(
                    label: UptimeMonitorStrings.serviceLabel(service.key),
                    statusText: UptimeMonitorStatusText.serviceBadge(service.status),
                    tone: service.tone
                )
            }
        }
    }

    /// The tall-mode footer (web `isTall && !isCompact` DB-size/tables block).
    private var footer: some View {
        VStack(spacing: TSSpacing.xs) {
            Divider().overlay(Color.TS.border)
            UptimeFooterRow(
                label: UptimeMonitorStrings.string("widget.uptime.dbSize", "DB Size"),
                value: UptimeMonitorFormat.databaseSize(projection.databaseSize)
            )
            UptimeFooterRow(
                label: UptimeMonitorStrings.string("widget.uptime.tables", "Tables"),
                value: UptimeMonitorFormat.tableCount(projection.tableCount)
            )
        }
    }
}
