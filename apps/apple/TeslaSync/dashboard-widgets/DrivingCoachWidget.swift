//
//  DrivingCoachWidget.swift
//  TeslaSync — P4 dashboard widget · 0043 · DrivingCoachWidget (Apple)
//
//  The composable Driving Coach dashboard surface — the SwiftUI parity of
//  features/dashboard/widgets/DrivingCoachWidget.tsx. Renders every state from the web
//  source (loading / empty / error / stale / offline / content) inside a glass widget
//  shell, binding through `DrivingCoachModel` (P1/S8). No networking lives here; the
//  size-responsive score header + tip cards are derived from the model's cached coach
//  payload via the pure `DrivingCoachProjection`.
//

import Foundation
import SwiftUI

// MARK: - DrivingCoachWidget (the dashboard surface)

/// The composable Driving Coach dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/DrivingCoachWidget.tsx`. Surfaces the Helix driving score,
/// the best-vs-current efficiency savings chip, and the personalized tip cards, with a
/// compact (cols ≤ 1) score-only layout.
public struct DrivingCoachWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "DrivingCoachWidget"

    /// Canonical registry metadata (registry/driving.ts → "driving-coach").
    public static let registration = DashboardWidgetRegistration(
        id: "driving-coach",
        nameKey: "widget.drivingCoach.title",
        descriptionKey: "widget.drivingCoach.description",
        category: "driving",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: DrivingCoachModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: DrivingCoachModel,
        size: DashboardWidgetSize = DrivingCoachWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = DrivingCoachWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `isCompact = size.cols <= 1` — the score-only single-column layout.
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

extension DrivingCoachWidget {
    // MARK: Header

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "lightbulb.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.statusWarning)
                    .accessibilityHidden(true)
                DrivingCoachStrings.text("widget.drivingCoach.title", "Driving Coach")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
            if !isCompact, onOpen != nil { openButton }
        }
    }

    private var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = DrivingCoachStrings.string("widget.drivingCoach.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = DrivingCoachStrings.string("widget.drivingCoach.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = DrivingCoachStrings.string("widget.drivingCoach.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            if !isCompact {
                Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            }
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
        .accessibilityLabel(DrivingCoachStrings.text("widget.drivingCoach.refresh", "Refresh"))
    }

    private var openButton: some View {
        let openLabel = DrivingCoachStrings.text("widget.drivingCoach.openA11y", "Open the Driving Coach page")
        return Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                DrivingCoachStrings.text("widget.open", "Open").font(Font.TS.caption)
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
            DrivingCoachEmpty()
        case let .error(message):
            errorState(message)
        case .content:
            loadedContent
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(width: 72, height: 28, cornerRadius: TSRadius.sm)
            if !isCompact {
                ForEach(0 ..< 3, id: \.self) { _ in
                    TSSkeleton(height: 52, cornerRadius: TSRadius.md)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(DrivingCoachStrings.text("widget.drivingCoach.loading", "Loading driving coach"))
    }

    @ViewBuilder
    private var loadedContent: some View {
        if let coach = model.coach {
            let scoreText = DrivingCoachProjection.formatScore(coach.overallScore)
            let savingsPct = DrivingCoachProjection.savingsPercent(
                currentEff: coach.efficiencyWhKm,
                bestEff: coach.bestEfficiencyWhKm
            )
            let tips = DrivingCoachProjection.tips(from: coach.recommendations, localize: DrivingCoachStrings.string)
            if isCompact {
                compactContent(scoreText: scoreText, savingsPct: savingsPct, tips: tips)
            } else {
                standardContent(scoreText: scoreText, savingsPct: savingsPct, tips: tips)
            }
        } else {
            DrivingCoachEmpty()
        }
    }

    /// Compact (cols ≤ 1): the centered score, the savings chip when positive, and the
    /// "No tips available" empty state only when there is neither a saving nor a tip
    /// (web compact branch).
    private func compactContent(scoreText: String, savingsPct: Int, tips: [CoachTip]) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Text(verbatim: scoreText)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityLabel(Text(verbatim: DrivingCoachAccessibility.scoreSummary(
                    scoreText: scoreText,
                    savingsPct: savingsPct,
                    localize: DrivingCoachStrings.string
                )))
            if savingsPct > 0 {
                DrivingCoachSavingsChip(pct: savingsPct)
            } else if tips.isEmpty {
                DrivingCoachTipsEmpty()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Standard (cols ≥ 2): the stale/offline banner, the score header, and the tip-card
    /// list (web standard branch).
    private func standardContent(scoreText: String, savingsPct: Int, tips: [CoachTip]) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if model.connection != .live {
                DrivingCoachConnectivityBanner(connection: model.connection)
            }
            DrivingCoachScoreHeader(scoreText: scoreText, savingsPct: savingsPct)
            DrivingCoachTipList(tips: tips)
                .frame(maxHeight: .infinity, alignment: .top)
        }
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            DrivingCoachStrings.text("widget.drivingCoach.errorTitle", "Couldn't load driving coach")
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
                DrivingCoachStrings.text("widget.drivingCoach.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(DrivingCoachStrings.text("widget.drivingCoach.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}
