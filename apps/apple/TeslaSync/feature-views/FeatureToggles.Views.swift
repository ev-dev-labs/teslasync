//
//  FeatureToggles.Views.swift
//  TeslaSync — P4 feature view · 0205 · FeatureToggles (Apple)
//
//  Presentational chrome composed by `FeatureToggles`: the icon + title + subtitle
//  + "Synced …" + Refresh header (web `<IconBox>` + heading + `<Button>`), the
//  freshness chip + stale/offline connectivity banner, the three-column
//  Feature / Status / Details table (web `grid-cols-[1fr_auto_2fr]`, adapted to a
//  native Grid on wide widths and stacked cards on compact iPhone widths), the
//  Enabled / Disabled status badge (web `<Badge>`), and the loading / empty /
//  error states. All copy resolves through the P1/S10 facade; all chrome is
//  token-driven (P1/S9). No networking and no Tailwind ports live here.
//

import SwiftUI

/// Web `'—'` fallback for a row with no details (a primitive feature value).
private let featureTogglesEmDash = "\u{2014}"

// MARK: - Header (icon + title + subtitle + synced + refresh)

/// The panel header — web `<div className="flex items-center justify-between">`
/// with the purple `IconBox` (mapped to the adaptive `.accent` tone), the title +
/// subtitle, the "Synced …" label, and the Refresh button.
struct FeatureTogglesHeader: View {
    let syncedLabel: String?
    let refreshing: Bool
    let onRefresh: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            TSIconBox(systemName: "flag.fill", tone: .accent)
            VStack(alignment: .leading, spacing: 2) {
                FeatureTogglesStrings.text("settings.featureConfig.title", "Feature Flags")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                FeatureTogglesStrings.text(
                    "settings.featureConfig.subtitle",
                    "Tesla account feature configuration"
                )
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: TSSpacing.sm)
            if let syncedLabel {
                FeatureTogglesSyncedChip(label: syncedLabel)
            }
            FeatureTogglesRefreshButton(refreshing: refreshing, onRefresh: onRefresh)
        }
        .accessibilityElement(children: .contain)
    }
}

/// The "Synced {time}" label (web `<span>` shown only when `fetched_at` exists).
struct FeatureTogglesSyncedChip: View {
    let label: String

    var body: some View {
        Text(verbatim: label)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .lineLimit(1)
            .truncationMode(.tail)
            .accessibilityLabel(Text(verbatim: label))
    }
}

/// The Refresh button (web secondary `<Button icon={<RefreshCw … animate-spin>}>`):
/// the arrow spins while a refresh is in flight (honoring Reduce Motion) and the
/// control disables, matching the web `disabled={…isPending}`.
struct FeatureTogglesRefreshButton: View {
    let refreshing: Bool
    let onRefresh: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var spinning: Bool {
        refreshing && !reduceMotion
    }

    var body: some View {
        TSButton(variant: .secondary, size: .small, action: onRefresh) {
            Label {
                FeatureTogglesStrings.text("settings.featureConfig.refresh", "Refresh")
            } icon: {
                Image(systemName: "arrow.clockwise")
                    .rotationEffect(.degrees(spinning ? 360 : 0))
                    .animation(
                        spinning ? .linear(duration: 1).repeatForever(autoreverses: false) : .default,
                        value: spinning
                    )
            }
        }
        .disabled(refreshing)
        .accessibilityLabel(FeatureTogglesStrings.text("settings.featureConfig.refresh", "Refresh"))
    }
}

// MARK: - Freshness chip + connectivity banner (P4 stale / offline states)

/// A compact stale / offline chip shown in the header only when the bound source
/// is not live. The web header has no freshness concept (a plain query); this is
/// the P4 surface contract's "stale chip" / "offline chip", kept invisible while
/// live so the normal header matches the web.
struct FeatureTogglesFreshnessChip: View {
    let connection: FeatureTogglesConnection

    var body: some View {
        if let descriptor = Self.descriptor(for: connection) {
            HStack(spacing: 4) {
                Circle().fill(descriptor.tone).frame(width: 6, height: 6)
                FeatureTogglesStrings.text(descriptor.key, descriptor.fallback)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(FeatureTogglesStrings.text(descriptor.key, descriptor.fallback))
        }
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: FeatureTogglesConnection) -> Descriptor? {
        switch connection {
        case .live:
            nil
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "settings.featureConfig.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "settings.featureConfig.offline", fallback: "Offline")
        }
    }
}

/// The stale / offline banner shown above the table when the bound source is not
/// live, so cached config is clearly labeled while reconnecting / offline.
struct FeatureTogglesConnectivityBanner: View {
    let connection: FeatureTogglesConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "settings.featureConfig.offlineBanner" : "settings.featureConfig.staleBanner"
        let fallback = offline
            ? "Offline — showing last known feature config"
            : "Reconnecting — feature config may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            FeatureTogglesStrings.text(key, fallback).font(Font.TS.caption)
            FeatureTogglesFreshnessChip(connection: connection)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Status badge (web `<Badge variant={enabled ? 'success' : 'neutral'}>`)

/// The Enabled / Disabled pill — the native parity of the web `Badge` (success
/// when enabled, neutral otherwise). Copy resolves through the P1/S10 facade and
/// renders verbatim so the per-surface table is honored.
struct FeatureToggleStatusBadge: View {
    let enabled: Bool

    var body: some View {
        let tone = enabled ? Color.TS.statusSuccess : Color.TS.textMuted
        let key = enabled ? "settings.featureConfig.enabled" : "settings.featureConfig.disabled"
        let fallback = enabled ? "Enabled" : "Disabled"
        return Text(verbatim: FeatureTogglesStrings.string(key, fallback))
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.opacity(0.3), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

// MARK: - Table (web `grid-cols-[1fr_auto_2fr]`)

/// The populated feature table — the web responsive grid adapted to a native
/// `Grid` on regular widths and stacked cards on compact iPhone widths, so every
/// device renders a legible Feature / Status / Details layout.
struct FeatureTogglesTable: View {
    let entries: [FeatureToggleEntry]
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var isWide: Bool {
        horizontalSizeClass != .compact
    }

    var body: some View {
        if isWide {
            wideGrid
        } else {
            compactList
        }
    }

    private var wideGrid: some View {
        Grid(alignment: .leading, horizontalSpacing: TSSpacing.lg, verticalSpacing: TSSpacing.sm) {
            GridRow {
                columnHeader("settings.featureConfig.feature", "Feature", flexible: false)
                columnHeader("settings.featureConfig.status", "Status", flexible: false)
                columnHeader("settings.featureConfig.details", "Details", flexible: true)
            }
            Rectangle().fill(Color.TS.border).frame(height: 1).gridCellColumns(3)
            ForEach(entries) { entry in
                gridRow(for: entry)
                if entry.id != entries.last?.id {
                    Rectangle().fill(Color.TS.border.opacity(0.4)).frame(height: 1).gridCellColumns(3)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var compactList: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(entries) { entry in
                FeatureToggleCard(entry: entry)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func columnHeader(_ key: String, _ fallback: String, flexible: Bool) -> some View {
        FeatureTogglesStrings.text(key, fallback)
            .font(Font.TS.label)
            .textCase(.uppercase)
            .tracking(0.6)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: flexible ? .infinity : nil, alignment: .leading)
    }

    private func gridRow(for entry: FeatureToggleEntry) -> some View {
        GridRow {
            Text(verbatim: entry.key)
                .font(Font.TS.body)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .textSelection(.enabled)
            FeatureToggleStatusBadge(enabled: entry.enabled)
            Text(verbatim: entry.details ?? featureTogglesEmDash)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: FeatureTogglesAccessibility.rowLabel(entry)))
    }
}

/// One compact-width feature card (web row collapsed for iPhone): the key + status
/// badge on one line with the details summary below.
struct FeatureToggleCard: View {
    let entry: FeatureToggleEntry

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: entry.key)
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: TSSpacing.sm)
                FeatureToggleStatusBadge(enabled: entry.enabled)
            }
            if let details = entry.details, !details.isEmpty {
                Text(verbatim: details)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(2)
                    .truncationMode(.tail)
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: FeatureTogglesAccessibility.rowLabel(entry)))
    }
}

// MARK: - Loading / empty / error states

/// The initial-fetch skeleton chrome: muted three-column rows under the localized
/// loading label, respecting Reduce Motion (via `TSSkeleton`).
struct FeatureTogglesLoading: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< 4, id: \.self) { _ in
                HStack(spacing: TSSpacing.lg) {
                    TSSkeleton(height: 12)
                    TSSkeleton(width: 72, height: 20, cornerRadius: TSRadius.sm)
                    TSSkeleton(height: 12)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(FeatureTogglesStrings.text("settings.featureConfig.loading", "Loading feature config"))
    }
}

/// The resolved-but-empty state — the web `<EmptyState message={t('…noData')}>`
/// over a native `ContentUnavailableView`. Never a blank box.
struct FeatureTogglesEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                FeatureTogglesStrings.text(
                    "settings.featureConfig.noData",
                    "No feature config data yet. Click Refresh to fetch from Tesla."
                )
            } icon: {
                Image(systemName: "info.circle")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

/// The fetch-failure state with a retry affordance (web `QueryError` equivalent).
struct FeatureTogglesError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            FeatureTogglesStrings.text("settings.featureConfig.errorTitle", "Couldn't load feature config")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton("settings.featureConfig.retry", variant: .secondary, size: .small, action: onRetry)
                .accessibilityLabel(FeatureTogglesStrings.text("settings.featureConfig.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
