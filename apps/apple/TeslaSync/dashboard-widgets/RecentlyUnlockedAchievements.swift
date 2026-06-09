//
//  RecentlyUnlockedAchievements.swift
//  TeslaSync — P4 dashboard widget · 0080 · RecentlyUnlockedAchievements (Apple)
//
//  The composable "Recently Unlocked" dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/RecentlyUnlockedAchievements.tsx. Binds through
//  RecentlyUnlockedModel (no networking in the view); renders every state (loading / disabled /
//  empty / error / stale / offline / content) and wraps the most-recently-unlocked achievement
//  badges in a flow strip that deep-links into Lifetime Stats on tap.
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension RecentlyUnlockedStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file)
    /// so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - RecentlyUnlockedAchievementsWidget (the dashboard surface)

/// The composable "Recently Unlocked" dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/RecentlyUnlockedAchievements.tsx`. Renders every state from the
/// web source inside a glass widget shell, binding through `RecentlyUnlockedModel` (P1/S8). No
/// networking lives here; tapping a badge calls `onSelect` so the host can deep-link into the
/// Lifetime Stats surface (`/lifetime?achievement={id}`).
public struct RecentlyUnlockedAchievementsWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = RecentlyUnlockedSurface.slug

    /// Canonical registry metadata (registry/analytics.ts → "recently-unlocked-achievements").
    public static let registration = RecentlyUnlockedSurface.registration

    @State private var model: RecentlyUnlockedModel
    private let size: DashboardWidgetSize
    private let onSelect: ((RecentlyUnlockedItem) -> Void)?

    public init(
        model: RecentlyUnlockedModel,
        size: DashboardWidgetSize = RecentlyUnlockedAchievementsWidget.registration.defaultSize,
        onSelect: ((RecentlyUnlockedItem) -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = RecentlyUnlockedAchievementsWidget.registration.clamp(size)
        self.onSelect = onSelect
    }

    /// Wide layouts (≥ 3 columns) show five badges; narrower layouts show three — the web
    /// `const isWide = size.cols >= 3`.
    private var isWide: Bool {
        size.cols >= 3
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
        .onAppear {
            model.start()
            model.autoRefreshIfStale()
        }
        .onDisappear { model.stop() }
        .onChange(of: model.connection) { _, _ in model.autoRefreshIfStale() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header

extension RecentlyUnlockedAchievementsWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "trophy.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            RecentlyUnlockedStrings.text("widget.recentlyUnlocked.title", "Recently Unlocked")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            if model.phase != .disabled {
                freshnessChip
                refreshButton
            }
        }
    }

    private var freshnessChip: some View {
        HStack(spacing: 4) {
            Circle().fill(freshnessTone).frame(width: 6, height: 6)
            Text(verbatim: freshnessLabel)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            if isWide, let updatedAt = model.updatedAt {
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
            return RecentlyUnlockedStrings.string("widget.recentlyUnlocked.updating", "Updating")
        }
        switch model.connection {
        case .live: return RecentlyUnlockedStrings.string("widget.recentlyUnlocked.live", "Live")
        case .stale: return RecentlyUnlockedStrings.string("widget.recentlyUnlocked.stale", "Stale")
        case .offline: return RecentlyUnlockedStrings.string("widget.recentlyUnlocked.offline", "Offline")
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
        .accessibilityLabel(RecentlyUnlockedStrings.text("widget.recentlyUnlocked.refresh", "Refresh"))
    }
}

// MARK: - Content states

extension RecentlyUnlockedAchievementsWidget {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingStrip
        case .disabled:
            compactEmpty(
                RecentlyUnlockedStrings.text(
                    "widget.recentlyUnlocked.disabled",
                    "Recently unlocked achievements are hidden in your settings."
                )
            )
        case .empty:
            compactEmpty(
                RecentlyUnlockedStrings.text(
                    "achievements.noneYet",
                    "Drive, charge, and explore — achievements will appear here as you unlock them"
                )
            )
        case let .error(message):
            errorState(message)
        case .content:
            loadedContent
        }
    }

    /// Initial-fetch skeleton: badge-shaped shimmer blocks laid out in the same wrapping strip the
    /// real badges use, so the chrome doesn't jump when content arrives.
    private var loadingStrip: some View {
        RecentlyUnlockedFlowLayout(spacing: TSSpacing.md) {
            ForEach(0 ..< (isWide ? RecentlyUnlockedLimits.wide : RecentlyUnlockedLimits.narrow), id: \.self) { _ in
                TSSkeleton(
                    width: RecentlyUnlockedMetrics.badgeWidth,
                    height: RecentlyUnlockedMetrics.badgeHeight,
                    cornerRadius: TSRadius.md
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(RecentlyUnlockedStrings.text(
            "widget.recentlyUnlocked.loading",
            "Loading recent achievements"
        ))
    }

    /// Compact icon + message empty state (web `EmptyState` with `className="py-4"`), shared by the
    /// settings opt-out (`disabled`) and the no-unlocks-yet (`empty`) branches.
    private func compactEmpty(_ message: Text) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "trophy.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            message
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            RecentlyUnlockedStrings.text("widget.recentlyUnlocked.errorTitle", "Couldn't load achievements")
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
                RecentlyUnlockedStrings.text("widget.recentlyUnlocked.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var loadedContent: some View {
        let items = model.projection.items(isWide: isWide)
        return VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            RecentlyUnlockedFlowLayout(spacing: TSSpacing.md) {
                ForEach(items) { item in
                    Button {
                        onSelect?(item)
                    } label: {
                        AchievementBadgeView(item: item)
                    }
                    .buttonStyle(.plain)
                    .accessibilityElement(children: .ignore)
                    .accessibilityAddTraits(.isButton)
                    .accessibilityLabel(Text(verbatim: item.accessibilityLabel))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: RecentlyUnlockedAccessibility.summary(for: items)))
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.recentlyUnlocked.offlineBanner" : "widget.recentlyUnlocked.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known badges"
            : "Reconnecting — badges may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            RecentlyUnlockedStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
