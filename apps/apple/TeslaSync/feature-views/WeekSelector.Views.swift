//
//  WeekSelector.Views.swift
//  TeslaSync — P4 feature view · 0079 · WeekSelector (Apple)
//
//  The presentational subviews composed by `WeekSelector`: the navigation bar
//  (web `GlassPanel` row — prev `Button` · calendar + label + `Current` badge ·
//  next `Button`), the ghost nav button (web `Button variant="ghost" size="sm"`
//  with its directional chevron), the center label group, and the digest chrome
//  the Apple HIG states contract requires layered under the always-present bar:
//  the loading skeleton, the friendly empty hint, the `QueryError`-equivalent
//  inline error with retry, and the stale/offline freshness banner (ADR-013). All
//  consume pre-localized strings from the P1/S10 facade and the shared P1/S9
//  tokens — no networking, no Tailwind ports.
//
//  HIG note: the web renders both chevrons as leading icons; the native bar keeps
//  Previous's chevron leading and moves Next's chevron to the trailing edge — the
//  platform-idiomatic pagination affordance the prompt's "native Apple-idiomatic"
//  mandate calls for. The composition (a directional chevron + its directional
//  label + the badge) and every i18n key are preserved.
//

import SwiftUI

// MARK: - i18n facade helpers

extension WeekSelectorStrings {
    /// Resolves a key to a verbatim `Text` (the facade owns the lookup; the view
    /// never embeds a literal).
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// Resolved value wrapped as a `LocalizedStringKey` for shared components that
    /// only accept `LocalizedStringKey` (e.g. `TSBadge`); the resolved string is
    /// not a main-catalog key, so SwiftUI renders it verbatim.
    static func key(_ key: String, _ fallback: String) -> LocalizedStringKey {
        LocalizedStringKey(string(key, fallback))
    }
}

// MARK: - Navigation bar (web `GlassPanel` row)

/// The week selector bar — the native port of the web `GlassPanel` flex row:
/// the previous-week button, the centered calendar + label + `Current` badge
/// group, and the next-week button (disabled on the current week).
struct WeekSelectorBar: View {
    let weekLabel: String
    let isCurrentWeek: Bool
    let canGoToNextWeek: Bool
    let onPrev: () -> Void
    let onNext: () -> Void

    var body: some View {
        TSGlassPanel {
            HStack(spacing: TSSpacing.sm) {
                WeekSelectorNavButton(
                    systemImage: "chevron.left",
                    placement: .leading,
                    titleKey: "analytics.weeklyDigest.prevWeek",
                    titleFallback: "Previous",
                    a11yKey: "analytics.weeklyDigest.a11yPrev",
                    a11yFallback: "Show previous week",
                    isEnabled: true,
                    action: onPrev
                )
                Spacer(minLength: TSSpacing.sm)
                WeekSelectorLabelGroup(weekLabel: weekLabel, isCurrentWeek: isCurrentWeek)
                Spacer(minLength: TSSpacing.sm)
                WeekSelectorNavButton(
                    systemImage: "chevron.right",
                    placement: .trailing,
                    titleKey: "analytics.weeklyDigest.nextWeek",
                    titleFallback: "Next",
                    a11yKey: "analytics.weeklyDigest.a11yNext",
                    a11yFallback: "Show next week",
                    isEnabled: canGoToNextWeek,
                    action: onNext
                )
            }
        }
    }
}

// MARK: - Ghost nav button (web `Button variant="ghost" size="sm"`)

/// A ghost navigation button with a directional chevron + label — the native
/// port of the web `Button variant="ghost" size="sm" icon={…}`. Disabled on the
/// current week (web `disabled`, dimmed to match `disabled:opacity-50`).
struct WeekSelectorNavButton: View {
    enum Placement { case leading, trailing }

    let systemImage: String
    let placement: Placement
    let titleKey: String
    let titleFallback: String
    let a11yKey: String
    let a11yFallback: String
    let isEnabled: Bool
    let action: () -> Void

    var body: some View {
        TSButton(variant: .ghost, size: .small, action: action) {
            HStack(spacing: TSSpacing.xs) {
                if placement == .leading { chevron }
                WeekSelectorStrings.text(titleKey, titleFallback)
                if placement == .trailing { chevron }
            }
        }
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1 : 0.5)
        .accessibilityLabel(WeekSelectorStrings.text(a11yKey, a11yFallback))
    }

    private var chevron: some View {
        Image(systemName: systemImage)
            .font(.system(size: 13, weight: .semibold))
            .accessibilityHidden(true)
    }
}

// MARK: - Center label group (calendar + label + `Current` badge)

/// The centered week label — a calendar glyph, the week range, and the `Current`
/// badge on the current week (web `<span>` with the `Calendar` icon + `weekLabel`
/// + `{isCurrentWeek && <Badge variant="info">}`). One combined VoiceOver element.
struct WeekSelectorLabelGroup: View {
    let weekLabel: String
    let isCurrentWeek: Bool

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "calendar")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(true)
            Text(verbatim: weekLabel)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            if isCurrentWeek {
                TSBadge(WeekSelectorStrings.key("analytics.weeklyDigest.current", "Current"), tone: .info)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var accessibilityLabel: String {
        WeekSelectorAccessibility.weekSummary(
            weekLabel: weekLabel,
            isCurrentWeek: isCurrentWeek,
            localize: WeekSelectorStrings.string
        )
    }
}

// MARK: - Digest chrome (loading / empty / error) under the bar

/// The state chrome shown beneath the always-present bar: a skeleton on the
/// initial digest load, a friendly empty hint when the selected week has no
/// activity, and a `QueryError`-equivalent inline error with retry on failure.
/// `content` adds no chrome (the bar speaks for itself).
struct WeekSelectorStatusLine: View {
    let phase: WeekSelectorModel.Phase
    let onRetry: () -> Void

    var body: some View {
        switch phase {
        case .loading:
            WeekSelectorLoadingHint()
        case .empty:
            WeekSelectorEmptyHint()
        case let .error(message):
            WeekSelectorErrorHint(message: message, onRetry: onRetry)
        case .content:
            EmptyView()
        }
    }
}

/// The initial-load skeleton — a one-line stand-in for the week's digest
/// summary while the drives/charging/alerts queries resolve.
struct WeekSelectorLoadingHint: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            TSSkeleton(width: 120, height: 12, cornerRadius: TSRadius.sm)
            TSSkeleton(width: 72, height: 12, cornerRadius: TSRadius.sm)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.sm)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(WeekSelectorStrings.text(
            "analytics.weeklyDigest.loadingHint",
            "Loading this week's digest…"
        ))
    }
}

/// The friendly empty hint when the selected week has no drives or charges — so
/// the surface reads as "nothing this week", never a blank strip (web `hasData`
/// is false).
struct WeekSelectorEmptyHint: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "tray")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            WeekSelectorStrings
                .text("analytics.weeklyDigest.emptyHint", "No drives or charges recorded this week")
                .font(Font.TS.caption)
        }
        .foregroundStyle(Color.TS.textMuted)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(
            Color.TS.textMuted.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }
}

/// The `QueryError`-equivalent inline error with a retry affordance, shown under
/// the bar so navigation stays usable while the digest is refetched.
struct WeekSelectorErrorHint: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                WeekSelectorStrings
                    .text("analytics.weeklyDigest.errorTitle", "Couldn't load this week's digest")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textPrimary)
                if !message.isEmpty {
                    Text(verbatim: message)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: TSSpacing.sm)
            Button(action: onRetry) {
                WeekSelectorStrings.text("analytics.weeklyDigest.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(WeekSelectorStrings.text("analytics.weeklyDigest.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(
            Color.TS.statusDanger.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
    }
}

// MARK: - Freshness banner (stale / offline)

/// The stale/offline banner shown above the bar when the bound source is not
/// live, so a cached week is clearly labeled (ADR-013 live-state intent).
struct WeekSelectorConnectivityBanner: View {
    let connection: WeekSelectorConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "analytics.weeklyDigest.offlineBanner" : "analytics.weeklyDigest.staleBanner"
        let fallback = isOffline
            ? "Offline — showing the last loaded week"
            : "Refreshing — this week's digest may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            WeekSelectorStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
