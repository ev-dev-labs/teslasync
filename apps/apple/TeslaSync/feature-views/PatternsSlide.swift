//
//  PatternsSlide.swift
//  TeslaSync — P4 feature view · 0064 · PatternsSlide (Apple)
//
//  The driving-patterns recap slide — SwiftUI parity of
//  features/analytics/components/review/PatternsSlide.tsx. Binds through `PatternsSlideModel`
//  (no networking in the view); renders every state from the web source (loading / empty / error /
//  content) plus the stale / offline freshness chrome the mandated states require.
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension PatternsStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file) so the
    /// model / adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - PatternsSlide (the feature surface)

/// The driving-patterns recap slide — the SwiftUI parity of `PatternsSlide.tsx`. Renders every state
/// from the web source (loading / empty / error / content) plus stale / offline freshness chrome,
/// binding through `PatternsSlideModel` (P1/S8). No networking lives here.
public struct PatternsSlide: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = PatternsSurface.slug

    @State private var model: PatternsSlideModel

    public init(model: PatternsSlideModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(spacing: TSSpacing.md) {
            topBar
            if model.connection != .live, model.phase == .content {
                connectivityBanner
            }
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(TSSpacing.x2xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.TS.bg)
        .onAppear {
            model.start()
            model.autoRefreshIfStale()
        }
        .onDisappear { model.stop() }
        .onChange(of: model.connection) { _, _ in model.autoRefreshIfStale() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Top bar (native freshness chrome)

extension PatternsSlide {
    private var topBar: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            freshnessChip
            refreshButton
        }
    }

    private var freshnessChip: some View {
        HStack(spacing: 4) {
            Circle().fill(freshnessTone).frame(width: 6, height: 6)
            Text(verbatim: freshnessLabel)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            if let updatedAt = model.updatedAt {
                Text(verbatim: "·")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Text(updatedAt, style: .relative)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: freshnessLabel))
    }

    private var freshnessTone: Color {
        if model.isFetching { return Color.TS.accent }
        switch model.connection {
        case .live: return Color.TS.statusSuccess
        case .stale: return Color.TS.statusWarning
        case .offline: return Color.TS.textMuted
        }
    }

    private var freshnessLabel: String {
        if model.isFetching {
            return PatternsStrings.string("patterns.updating", "Updating")
        }
        switch model.connection {
        case .live: return PatternsStrings.string("patterns.live", "Live")
        case .stale: return PatternsStrings.string("patterns.stale", "Stale")
        case .offline: return PatternsStrings.string("patterns.offline", "Offline")
        }
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise").font(.system(size: 12, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(PatternsStrings.text("patterns.refresh", "Refresh"))
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "patterns.offlineBanner" : "patterns.staleBanner"
        let fallback = isOffline
            ? "Offline — showing your last recap"
            : "Reconnecting — patterns may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            PatternsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Content states

extension PatternsSlide {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            PatternsLoadingChrome()
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            if let projection = model.projection {
                slide(projection)
            } else {
                emptyState
            }
        }
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                PatternsStrings.text("patterns.empty.title", "No driving patterns yet")
            } icon: {
                Image(systemName: "chart.bar.xaxis")
            }
        } description: {
            PatternsStrings.text(
                "patterns.empty.hint",
                "Take a few drives and your patterns will appear here."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 30))
                .foregroundStyle(Color.TS.statusDanger)
            PatternsStrings.text("patterns.error.title", "Couldn't load driving patterns")
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button {
                model.refresh()
            } label: {
                PatternsStrings.text("patterns.retry", "Retry")
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.lg)
                    .padding(.vertical, TSSpacing.sm)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loaded slide (web centered composition)

extension PatternsSlide {
    private func slide(_ projection: PatternsProjection) -> some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            PatternsPopIn {
                Text(verbatim: "📊").font(.system(size: 56))
            }
            .accessibilityHidden(true)
            .padding(.bottom, TSSpacing.x2xl)

            TSFadeIn(delay: 0.2) {
                PatternsStrings.text("yearReview.drivingPatterns", "Your driving patterns")
                    .font(Font.TS.section)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.bottom, TSSpacing.x3xl)

            VStack(spacing: TSSpacing.xl) {
                TSFadeIn(delay: 0.4) {
                    PatternsIconCard(
                        systemImage: "calendar",
                        tint: Color.TS.chartSeriesPower,
                        label: PatternsStrings.string("yearReview.favoriteDay", "Favorite driving day"),
                        value: projection.favoriteDay
                    )
                }
                TSFadeIn(delay: 0.6) {
                    PatternsIconCard(
                        systemImage: "clock",
                        tint: Color.TS.chartSeriesSpeed,
                        label: PatternsStrings.string("yearReview.peakHour", "Peak driving hour"),
                        value: projection.peakHour
                    )
                }
                TSFadeIn(delay: 0.8) {
                    statRow(projection)
                }
            }
            .frame(maxWidth: 380)

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: PatternsAccessibility.summary(for: projection)))
    }

    private func statRow(_ projection: PatternsProjection) -> some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            PatternsMetric(
                value: projection.drivesPerWeek,
                caption: PatternsStrings.string("yearReview.drivesWeek", "drives/week")
            )
            PatternsMetric(
                value: projection.distancePerDrive,
                caption: PatternsStrings.unit(
                    "yearReview.distancePerDrive",
                    "{unit}/drive avg",
                    projection.distanceSymbol
                )
            )
            PatternsMetric(
                value: projection.efficiency,
                caption: "\(projection.efficiencySymbol) \(PatternsStrings.string("yearReview.avg", "avg"))"
            )
        }
    }
}
