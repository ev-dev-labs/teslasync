//
//  VersionInfoWidget.swift
//  TeslaSync — P4 dashboard widget · 0111 · VersionInfoWidget (Apple)
//
//  The composable Version Info dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/VersionInfoWidget.tsx. Binds through
//  `VersionInfoModel` (no networking in the view); renders every state (loading /
//  empty / error / content) with a live/stale/offline freshness chip, and the
//  responsive compact (1×2) / standard (2×2) / wide (≥4 cols) layouts from the
//  web source.
//

import SwiftUI

// MARK: - VersionInfoWidget (the dashboard surface)

/// The composable Version Info dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/VersionInfoWidget.tsx`. Renders every state from
/// the web source inside a glass widget shell, binding through `VersionInfoModel`
/// (P1/S8). No networking lives here.
public struct VersionInfoWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "VersionInfoWidget"

    /// Canonical registry metadata (registry/system.ts → "version-info").
    public static let registration = DashboardWidgetRegistration(
        id: "version-info",
        nameKey: "widget.versionInfo.title",
        descriptionKey: "widget.versionInfo.description",
        category: "system",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: VersionInfoModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: VersionInfoModel,
        size: DashboardWidgetSize = VersionInfoWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = VersionInfoWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    private var isCompact: Bool {
        VersionInfoModel.isCompact(size)
    }

    private var isWide: Bool {
        VersionInfoModel.isWide(size)
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

extension VersionInfoWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "info.circle.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            if !isCompact {
                VersionInfoStrings.text("widget.versionInfo.title", "Version Info")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: TSSpacing.sm)
            VersionInfoFreshnessChip(connection: model.connection)
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
        .accessibilityLabel(VersionInfoStrings.text("widget.versionInfo.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                VersionInfoStrings.text("widget.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(VersionInfoStrings.text("widget.versionInfo.openA11y", "Open the system information page"))
    }
}

// MARK: - Content states

extension VersionInfoWidget {
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
                Spacer(minLength: 0)
                TSSkeleton(width: 90, height: 18, cornerRadius: TSRadius.sm)
                TSSkeleton(width: 64, height: 16, cornerRadius: TSRadius.pill)
                Spacer(minLength: 0)
            } else {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(height: 14, cornerRadius: TSRadius.sm)
                }
                Spacer(minLength: 0)
                Grid(horizontalSpacing: TSSpacing.sm, verticalSpacing: TSSpacing.sm) {
                    GridRow {
                        TSSkeleton(height: 52, cornerRadius: TSRadius.md)
                        TSSkeleton(height: 52, cornerRadius: TSRadius.md)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: isCompact ? .center : .topLeading)
        .accessibilityElement()
        .accessibilityLabel(VersionInfoStrings.text("widget.versionInfo.loading", "Loading version info"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                VersionInfoStrings.text("widget.versionInfo.noData", "No version data available")
            } icon: {
                Image(systemName: "info.circle")
            }
        } description: {
            VersionInfoStrings.text("widget.versionInfo.emptyHint", "Waiting for version data.")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            VersionInfoStrings.text("widget.versionInfo.errorTitle", "Couldn't load version info")
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
                VersionInfoStrings.text("widget.versionInfo.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(VersionInfoStrings.text("widget.versionInfo.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Content layouts (web compact 1×2 / standard / wide)

extension VersionInfoWidget {
    private var vitals: VersionInfoVitals {
        model.vitals
    }

    /// Compact layout (1×2): the chart version over the truncated-SHA badge,
    /// centered (web `isCompact` branch).
    private var compactContent: some View {
        VStack(spacing: TSSpacing.sm) {
            Text(verbatim: vitals.chartVersion)
                .font(Font.TS.body)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            VersionInfoBadge(value: vitals.truncatedSha)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: VersionInfoAccessibility.summary(from: vitals, isWide: false)))
    }

    /// Standard / wide layout: the KV list over the (wide-only) OS/Arch line and
    /// the bottom-pinned stat grid (web standard/wide branch).
    private var standardContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            kvList
            if isWide { osArchLine }
            Spacer(minLength: TSSpacing.sm)
            statGrid
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
    }

    private var kvList: some View {
        VStack(spacing: TSSpacing.xs) {
            ForEach(VersionInfoProjection.kvItems(from: vitals)) { item in
                VersionInfoKVRow(
                    label: VersionInfoStrings.string(item.labelKey, item.defaultLabel),
                    item: item
                )
            }
        }
    }

    private var osArchLine: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: "\(VersionInfoStrings.string("widget.versionInfo.os", "OS")): \(vitals.osName)")
            Text(verbatim: "•").foregroundStyle(Color.TS.textMuted)
            Text(verbatim: "\(VersionInfoStrings.string("widget.versionInfo.arch", "Arch")): \(vitals.arch)")
        }
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textSecondary)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .accessibilityElement(children: .combine)
    }

    private var statGrid: some View {
        let items = VersionInfoProjection.statItems(from: vitals, isWide: isWide)
        let rows = stride(from: 0, to: items.count, by: 2).map { start in
            Array(items[start ..< min(start + 2, items.count)])
        }
        return Grid(horizontalSpacing: TSSpacing.sm, verticalSpacing: TSSpacing.sm) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                GridRow {
                    ForEach(row) { item in
                        VersionInfoStatTile(
                            label: VersionInfoStrings.string(item.labelKey, item.defaultLabel),
                            value: item.value
                        )
                    }
                }
            }
        }
    }
}
