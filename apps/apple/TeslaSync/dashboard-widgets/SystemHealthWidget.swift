//
//  SystemHealthWidget.swift
//  TeslaSync — P4 dashboard widget · 0099 · SystemHealthWidget (Apple)
//
//  The composable System Health dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/SystemHealthWidget.tsx. Binds through
//  `SystemHealthModel` (no networking in the view); renders every state (loading /
//  empty / error / content) with a live/stale/offline freshness chip, and the
//  responsive compact (1×2) vs standard (2×4) layouts from the web source.
//

import SwiftUI

// MARK: - SystemHealthWidget (the dashboard surface)

/// The composable System Health dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/SystemHealthWidget.tsx`. Renders every state from
/// the web source inside a glass widget shell, binding through `SystemHealthModel`
/// (P1/S8). No networking lives here.
public struct SystemHealthWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SystemHealthWidget"

    /// Canonical registry metadata (registry/system.ts → "system-health").
    public static let registration = DashboardWidgetRegistration(
        id: "system-health",
        nameKey: "widget.systemHealth.title",
        descriptionKey: "widget.systemHealth.description",
        category: "system",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: SystemHealthModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: SystemHealthModel,
        size: DashboardWidgetSize = SystemHealthWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = SystemHealthWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    private var isCompact: Bool {
        SystemHealthModel.isCompact(size)
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

extension SystemHealthWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "server.rack")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            if !isCompact {
                SystemHealthStrings.text("widget.systemHealth.title", "System Health")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: TSSpacing.sm)
            SystemHealthFreshnessChip(connection: model.connection)
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
        .accessibilityLabel(SystemHealthStrings.text("widget.systemHealth.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                SystemHealthStrings.text("widget.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(SystemHealthStrings.text("widget.systemHealth.openA11y", "Open the system status page"))
    }
}

// MARK: - Content states

extension SystemHealthWidget {
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
            if isCompact { compactContent } else { standardContent }
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if isCompact {
                TSSkeleton(width: 90, height: 24, cornerRadius: TSRadius.pill)
                TSSkeleton(width: 70, height: 14, cornerRadius: TSRadius.sm)
            } else {
                Grid(horizontalSpacing: TSSpacing.lg, verticalSpacing: TSSpacing.sm) {
                    GridRow {
                        TSSkeleton(height: 14, cornerRadius: TSRadius.sm)
                        TSSkeleton(height: 14, cornerRadius: TSRadius.sm)
                    }
                    GridRow {
                        TSSkeleton(height: 14, cornerRadius: TSRadius.sm)
                        TSSkeleton(height: 14, cornerRadius: TSRadius.sm)
                    }
                }
                Spacer(minLength: 0)
                Grid(horizontalSpacing: TSSpacing.sm, verticalSpacing: TSSpacing.sm) {
                    GridRow {
                        TSSkeleton(height: 52, cornerRadius: TSRadius.md)
                        TSSkeleton(height: 52, cornerRadius: TSRadius.md)
                    }
                    GridRow {
                        TSSkeleton(height: 52, cornerRadius: TSRadius.md)
                        TSSkeleton(height: 52, cornerRadius: TSRadius.md)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement()
        .accessibilityLabel(SystemHealthStrings.text("widget.systemHealth.loading", "Loading system health"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                SystemHealthStrings.text("widget.systemHealth.noData", "No system health data")
            } icon: {
                Image(systemName: "server.rack")
            }
        } description: {
            SystemHealthStrings.text("widget.systemHealth.emptyHint", "Waiting for server health data.")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            SystemHealthStrings.text("widget.systemHealth.errorTitle", "Couldn't load system health")
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
                SystemHealthStrings.text("widget.systemHealth.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(SystemHealthStrings.text("widget.systemHealth.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Content layouts (web compact 1×2 / standard 2×4)

extension SystemHealthWidget {
    private var vitals: SystemHealthVitals {
        model.vitals
    }

    /// Compact layout (1×2): overall badge over the human label + the healthy
    /// service count (web `isCompact`).
    private var compactContent: some View {
        VStack(spacing: TSSpacing.sm) {
            SystemHealthBadge(badge: vitals.overallBadge, size: .small)
            Text(verbatim: SystemHealthOverall.label(for: vitals.overallStatus))
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            HStack(spacing: 4) {
                Text(verbatim: SystemHealthFormat.serviceCount(
                    healthy: vitals.healthyCount,
                    total: vitals.services.count
                ))
                .monospacedDigit()
                SystemHealthStrings.text("widget.systemHealth.services", "services")
            }
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: SystemHealthAccessibility.summary(from: vitals)))
    }

    /// Standard layout (2×4): the 2-column service status grid over the
    /// bottom-pinned 2-column stat grid (web standard layout).
    private var standardContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            serviceGrid
            Spacer(minLength: TSSpacing.sm)
            statGrid
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
    }

    private var serviceGrid: some View {
        let services = vitals.services
        let rows = stride(from: 0, to: services.count, by: 2).map { start in
            Array(services[start ..< min(start + 2, services.count)])
        }
        return Grid(alignment: .leading, horizontalSpacing: TSSpacing.lg, verticalSpacing: TSSpacing.xs) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                GridRow {
                    ForEach(row) { service in
                        SystemHealthServiceRow(
                            label: SystemHealthStrings.string(service.labelKey, service.defaultLabel),
                            status: service.status
                        )
                    }
                }
            }
        }
    }

    private var statGrid: some View {
        Grid(horizontalSpacing: TSSpacing.sm, verticalSpacing: TSSpacing.sm) {
            GridRow {
                SystemHealthStatTile(
                    label: SystemHealthStrings.string("widget.systemHealth.dbSize", "DB Size"),
                    value: vitals.dbSize
                )
                SystemHealthStatTile(
                    label: SystemHealthStrings.string("widget.systemHealth.activeConns", "Active Conns"),
                    value: SystemHealthFormat.activeConns(inUse: vitals.activeConns, maxOpen: vitals.maxConns)
                )
            }
            GridRow {
                SystemHealthStatTile(
                    label: SystemHealthStrings.string("widget.systemHealth.memory", "Memory"),
                    value: SystemHealthFormat.memory(vitals.memoryMB)
                )
                SystemHealthStatTile(
                    label: SystemHealthStrings.string("widget.systemHealth.goroutines", "Goroutines"),
                    value: SystemHealthFormat.goroutines(vitals.goroutines)
                )
            }
        }
    }
}
