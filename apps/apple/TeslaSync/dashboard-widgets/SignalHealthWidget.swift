//
//  SignalHealthWidget.swift
//  TeslaSync — P4 dashboard widget · 0088 · SignalHealthWidget (Apple)
//
//  The composable Signal Health dashboard surface — the SwiftUI parity of
//  features/dashboard/widgets/SignalHealthWidget.tsx. Binds through
//  SignalHealthModel (no networking in the view); renders every state and honors
//  the same 1×2…4×40 grid envelope as the web registry. A 1-column instance
//  collapses to the compact coverage badge + count layout, a 3-plus-column
//  instance adds the stale / gap signal list — exactly like the source.
//

import Foundation
import SwiftUI

// MARK: - SignalHealthWidget (the dashboard surface)

/// The Signal Health dashboard widget — SwiftUI parity of
/// `features/dashboard/widgets/SignalHealthWidget.tsx`. Renders every state
/// (loading / empty / error / content, plus stale + offline freshness) inside a
/// glass widget shell, binding through `SignalHealthModel` (P1/S8). No networking
/// lives here.
public struct SignalHealthWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SignalHealthWidget"

    /// Canonical registry metadata (registry/telemetry.ts → "signal-health").
    public static let registration = DashboardWidgetRegistration(
        id: "signal-health",
        nameKey: "widget.signalHealth.title",
        descriptionKey: "widget.signalHealth.description",
        category: "telemetry",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: SignalHealthModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: SignalHealthModel,
        size: DashboardWidgetSize = SignalHealthWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = SignalHealthWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// A single-column instance collapses to the compact layout — the web
    /// `size.cols <= 1` branch.
    private var isCompact: Bool {
        SignalHealthModel.isCompact(for: size)
    }

    /// A three-plus-column instance shows the stale / gap list — the web
    /// `size.cols >= 3` branch.
    private var isWide: Bool {
        SignalHealthModel.isWide(for: size)
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

extension SignalHealthWidget {
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
                Image(systemName: "waveform.path.ecg")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(model.projection.healthLevel.tone)
                    .accessibilityHidden(true)
                SignalHealthStrings.text("widget.signalHealth.title", "Signal Health")
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
        SignalHealthFreshnessChip(connection: model.connection)
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(SignalHealthStrings.text("widget.signalHealth.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                SignalHealthStrings.text("widget.signalHealth.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            SignalHealthStrings.text("widget.signalHealth.openA11y", "Open the live signals page")
        )
    }
}

// MARK: - Content states

extension SignalHealthWidget {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case let .error(message):
            errorState(message)
        case .empty:
            emptyState
        case .content:
            if isCompact {
                compactContent
            } else {
                fullContent
            }
        }
    }

    // MARK: Compact (web `size.cols <= 1`)

    private var compactContent: some View {
        let projection = model.projection
        return VStack(spacing: TSSpacing.sm) {
            if model.connection != .live {
                SignalHealthConnectivityBanner(connection: model.connection)
            }
            Spacer(minLength: 0)
            SignalHealthCoverageBadge(level: projection.healthLevel, text: projection.coveredText)
            Text(verbatim: projection.totalSignalsText)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            SignalHealthStrings.text("widget.signalHealth.signals", "signals")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            if projection.freshnessAgeSeconds != nil {
                Text(verbatim: projection.freshnessText)
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(projection.healthLevel.tone)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: SignalHealthAccessibility.summary(for: projection)))
    }

    // MARK: Standard / wide (web `else` branch)

    private var fullContent: some View {
        let projection = model.projection
        return VStack(alignment: .leading, spacing: TSSpacing.md) {
            if model.connection != .live {
                SignalHealthConnectivityBanner(connection: model.connection)
            }
            statsGrid(projection)
            statusRow(projection)
            if isWide, projection.hasGapSignals {
                Divider().overlay(Color.TS.border)
                SignalHealthGapList(
                    headerLabel: SignalHealthStrings.string(
                        "widget.signalHealth.staleSignals",
                        "Stale / Gap Signals"
                    ),
                    rows: projection.displayedGapSignals(max: SignalHealthAdapter.wideMaxGapRows)
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: SignalHealthAccessibility.summary(for: projection)))
    }

    private func statsGrid(_ projection: SignalHealthProjection) -> some View {
        VStack(spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.sm) {
                SignalHealthStatTile(
                    systemImage: "waveform.path.ecg",
                    iconTint: Color.TS.accent,
                    label: SignalHealthStrings.string("widget.signalHealth.totalSignals", "Total Signals"),
                    value: projection.totalSignalsText
                )
                SignalHealthStatTile(
                    systemImage: "checkmark.circle.fill",
                    iconTint: Color.TS.statusSuccess,
                    label: SignalHealthStrings.string("widget.signalHealth.active", "Active"),
                    value: projection.activeCountText
                )
            }
            HStack(spacing: TSSpacing.sm) {
                SignalHealthStatTile(
                    systemImage: "exclamationmark.triangle.fill",
                    iconTint: Color.TS.statusWarning,
                    label: SignalHealthStrings.string("widget.signalHealth.withGaps", "With Gaps"),
                    value: projection.staleCountText
                )
                SignalHealthStatTile(
                    systemImage: "clock",
                    iconTint: Color.TS.textSecondary,
                    label: SignalHealthStrings.string("widget.signalHealth.freshness", "Freshness"),
                    value: projection.freshnessText
                )
            }
        }
    }

    private func statusRow(_ projection: SignalHealthProjection) -> some View {
        HStack {
            SignalHealthStrings.text("widget.signalHealth.status", "Status")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            SignalHealthStatusBadge(level: projection.healthLevel)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: "\(SignalHealthStrings.string("widget.signalHealth.status", "Status")). "
                + projection.healthLevel.statusText)
        )
    }

    // MARK: Loading

    private var loadingChrome: some View {
        Group {
            if isCompact {
                VStack(spacing: TSSpacing.sm) {
                    SignalHealthSkeletonBar(width: 64, height: 20, cornerRadius: TSRadius.sm)
                    SignalHealthSkeletonBar(width: 80, height: 28, cornerRadius: TSRadius.sm)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack(spacing: TSSpacing.md) {
                    HStack(spacing: TSSpacing.sm) {
                        SignalHealthSkeletonBar(height: 56)
                        SignalHealthSkeletonBar(height: 56)
                    }
                    HStack(spacing: TSSpacing.sm) {
                        SignalHealthSkeletonBar(height: 56)
                        SignalHealthSkeletonBar(height: 56)
                    }
                    SignalHealthSkeletonBar(height: 24, cornerRadius: TSRadius.sm)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(SignalHealthStrings.text("widget.signalHealth.loading", "Loading signal health"))
    }

    // MARK: Empty (web `!hasData`)

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                SignalHealthStrings.text("widget.signalHealth.noData", "No signal health data")
            } icon: {
                Image(systemName: "waveform.path.ecg")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: Error (native QueryError-equivalent)

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: isCompact ? 20 : 26))
                .foregroundStyle(Color.TS.statusDanger)
            if !isCompact {
                SignalHealthStrings.text("widget.signalHealth.errorTitle", "Couldn't load signal health")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .multilineTextAlignment(.center)
                if !message.isEmpty {
                    Text(verbatim: message)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .multilineTextAlignment(.center)
                }
            }
            retryButton(emphasized: !isCompact)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: errorAccessibilityLabel(message)))
    }

    private func retryButton(emphasized: Bool) -> some View {
        Button {
            model.refresh()
        } label: {
            if emphasized {
                SignalHealthStrings.text("widget.signalHealth.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            } else {
                SignalHealthStrings.text("widget.signalHealth.retry", "Retry")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.accent)
            }
        }
        .buttonStyle(.plain)
    }

    private func errorAccessibilityLabel(_ message: String) -> String {
        let title = SignalHealthStrings.string("widget.signalHealth.errorTitle", "Couldn't load signal health")
        return message.isEmpty ? title : "\(title). \(message)"
    }
}
