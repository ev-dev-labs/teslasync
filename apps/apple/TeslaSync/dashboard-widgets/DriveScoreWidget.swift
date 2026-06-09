//
//  DriveScoreWidget.swift
//  TeslaSync — P4 dashboard widget · 0040 · DriveScoreWidget (Apple)
//
//  The composable Driving Score dashboard surface — the SwiftUI parity of
//  features/dashboard/widgets/DriveScoreWidget.tsx. Renders every state from the web
//  source (loading / empty / error / stale / offline / content) inside a glass widget
//  shell, binding through `DriveScoreModel` (P1/S8). No networking lives here; the gauge
//  readout is derived from the model's cached analytics via the pure
//  `DriveScoreProjection`.
//

import Foundation
import SwiftUI

// MARK: - DriveScoreWidget (the dashboard surface)

/// The composable Driving Score dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/DriveScoreWidget.tsx`. Shows a radial score gauge derived
/// from the fleet's weekly average efficiency, tinted by the score band, with the
/// efficiency stat beneath it.
public struct DriveScoreWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "DriveScoreWidget"

    /// Canonical registry metadata (registry/driving.ts → "drive-score").
    public static let registration = DashboardWidgetRegistration(
        id: "drive-score",
        nameKey: "widget.driveScore.title",
        descriptionKey: "widget.driveScore.description",
        category: "driving",
        defaultSize: DashboardWidgetSize(cols: 1, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 2, rows: 40)
    )

    @State private var model: DriveScoreModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: DriveScoreModel,
        size: DashboardWidgetSize = DriveScoreWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = DriveScoreWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `isCompact = size.cols === 1 && size.rows === 1` — shrinks the gauge and drops
    /// the stat. The registry min is 1×2, so a clamped size never trips this in the grid;
    /// it is preserved verbatim for parity with the web conditional.
    private var isCompact: Bool {
        size.cols == 1 && size.rows == 1
    }

    /// The gauge readout, re-derived from the model's cached analytics (web `useMemo` +
    /// `WidgetGaugeHero`). `nil` when there is no analytics object (the empty branch).
    private var readout: DriveScoreReadout? {
        guard let analytics = model.analytics else { return nil }
        return DriveScoreProjection.build(analytics: analytics, unit: model.unit)
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

extension DriveScoreWidget {
    // MARK: Header

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            DriveScoreStrings.text("widget.driveScore.title", "Driving Score")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
            if onOpen != nil { openButton }
        }
    }

    private var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = DriveScoreStrings.string("widget.driveScore.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = DriveScoreStrings.string("widget.driveScore.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = DriveScoreStrings.string("widget.driveScore.offline", "Offline")
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
        .accessibilityLabel(DriveScoreStrings.text("widget.driveScore.refresh", "Refresh"))
    }

    private var openButton: some View {
        let openLabel = DriveScoreStrings.text("widget.driveScore.openA11y", "Open the Driving Score page")
        return Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                DriveScoreStrings.text("widget.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(openLabel)
    }

    // MARK: Content states

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case .empty:
            DriveScoreEmpty()
        case let .error(message):
            errorState(message)
        case .content:
            loadedContent
        }
    }

    private var loadingChrome: some View {
        VStack(spacing: TSSpacing.md) {
            Circle()
                .fill(Color.TS.border.opacity(0.3))
                .frame(width: 104, height: 104)
            TSSkeleton(width: 88, height: 12)
            TSSkeleton(width: 64, height: 10)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(DriveScoreStrings.text("widget.driveScore.loading", "Loading driving score"))
    }

    private var loadedContent: some View {
        VStack(spacing: TSSpacing.md) {
            if model.connection != .live {
                DriveScoreConnectivityBanner(connection: model.connection)
            }
            if let readout {
                DriveScoreGaugeHero(readout: readout, compact: isCompact)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                DriveScoreEmpty()
            }
        }
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            DriveScoreStrings.text("widget.driveScore.errorTitle", "Couldn't load driving score")
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
                DriveScoreStrings.text("widget.driveScore.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(DriveScoreStrings.text("widget.driveScore.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}
