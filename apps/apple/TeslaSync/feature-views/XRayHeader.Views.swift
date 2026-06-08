//
//  XRayHeader.Views.swift
//  TeslaSync — P4 feature view · 0035 · XRayHeader (Apple)
//
//  The presentational subviews composed by `XRayHeader`: the responsive
//  three-tile strip (web `Grid cols={{ default: 1, sm: 3 }}` → `ViewThatFits`
//  3-up / 1-up), the individual stat tile (web `StatCard`: label + icon + value +
//  sublabel), the stale/offline freshness banner, the friendly empty note, and
//  the `QueryError`-equivalent error state with a retry affordance. All consume
//  pre-localized strings from the P1/S10 facade and the shared P1/S9 tokens — no
//  networking, no Tailwind ports.
//

import SwiftUI

// MARK: - i18n facade Text helper

extension XRayHeaderStrings {
    /// Resolves a key to a verbatim `Text` (the facade owns the lookup; the view
    /// never embeds a literal).
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Responsive strip (web header `Grid`)

/// The three-tile X-Ray header strip — the native port of the web
/// `Grid cols={{ default: 1, sm: 3 }}`. `ViewThatFits` lays the tiles 3-up when
/// the container is wide enough (each tile keeps a sensible minimum width) and
/// falls back to a single stacked column on compact widths, matching the web
/// `default: 1 / sm: 3` breakpoint intent.
struct XRayHeaderStrip: View {
    let stats: [XRayStat]
    let isLoading: Bool

    var body: some View {
        ViewThatFits(in: .horizontal) {
            horizontal
            vertical
        }
    }

    private var horizontal: some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            ForEach(stats) { stat in
                XRayHeaderStatCard(stat: stat, isLoading: isLoading)
                    .frame(minWidth: 180, maxWidth: .infinity)
            }
        }
    }

    private var vertical: some View {
        VStack(spacing: TSSpacing.md) {
            ForEach(stats) { stat in
                XRayHeaderStatCard(stat: stat, isLoading: isLoading)
                    .frame(maxWidth: .infinity)
            }
        }
    }
}

// MARK: - Stat tile (web `StatCard`)

/// A single stat tile: the metric label, a tinted icon box, the value (a
/// skeleton on the initial load for the streamed numeric tiles, the localized
/// window echo for the always-known window tile), and the sublabel. The whole
/// tile is one VoiceOver element speaking label, value, and sublabel.
struct XRayHeaderStatCard: View {
    let stat: XRayStat
    let isLoading: Bool

    private var showSkeleton: Bool {
        isLoading && stat.isNumeric
    }

    private var tone: TSTone {
        switch stat.kind {
        case .samples: .info
        case .fields: .accent
        case .window: .neutral
        }
    }

    private var label: String {
        XRayHeaderStrings.string(stat.labelKey, stat.labelFallback)
    }

    private var sublabel: String {
        XRayHeaderStrings.string(stat.sublabelKey, stat.sublabelFallback)
    }

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top, spacing: TSSpacing.sm) {
                    Text(verbatim: label)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                    Spacer(minLength: TSSpacing.sm)
                    TSIconBox(systemName: stat.iconSystemName, tone: tone)
                }
                value
                Text(verbatim: sublabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    @ViewBuilder private var value: some View {
        if showSkeleton {
            TSSkeleton(width: 96, height: 28, cornerRadius: TSRadius.sm)
                .accessibilityHidden(true)
        } else {
            XRayHeaderValueText(value: stat.value)
        }
    }

    private var accessibilityLabel: String {
        if showSkeleton {
            let loading = XRayHeaderStrings.string("admin.xray.header.loadingValue", "Loading")
            return "\(label), \(loading), \(sublabel)"
        }
        return XRayHeaderAccessibility.statSummary(stat: stat, localize: XRayHeaderStrings.string)
    }
}

/// The large numeric/echo value, mono-digit with a numeric content transition
/// that honors Reduce Motion (web `AnimatedNumber` intent). Scales down rather
/// than truncating so large grouped counts stay legible under Dynamic Type.
private struct XRayHeaderValueText: View {
    let value: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Text(verbatim: value)
            .font(Font.TS.title)
            .fontWeight(.semibold)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textPrimary)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .contentTransition(.numericText())
            .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.normalDuration), value: value)
    }
}

// MARK: - Freshness banner (stale / offline)

/// The stale/offline banner shown above the strip when the bound source is not
/// live, so the cached counts are clearly labeled (web freshness-indicator
/// intent).
struct XRayHeaderConnectivityBanner: View {
    let connection: XRayHeaderConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "admin.xray.header.offlineBanner" : "admin.xray.header.staleBanner"
        let fallback = isOffline
            ? "Offline — showing the last loaded counts"
            : "Refreshing — these counts may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            XRayHeaderStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty note

/// The friendly empty note shown alongside the strip when the window resolved
/// with no samples — so the surface reads as "nothing yet", never a blank box.
struct XRayHeaderEmptyNote: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "tray")
                .font(.system(size: 11, weight: .semibold))
            XRayHeaderStrings
                .text("admin.xray.header.emptyHint", "No ingest samples observed in this window yet")
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

// MARK: - Error state (web `QueryError`)

/// The `QueryError`-equivalent error state with a retry affordance, rendered in
/// place of the strip when the fetch fails.
struct XRayHeaderErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            XRayHeaderStrings.text("admin.xray.header.errorTitle", "Couldn't load ingest X-Ray")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                XRayHeaderStrings.text("admin.xray.header.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(XRayHeaderStrings.text("admin.xray.header.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .padding(.horizontal, TSSpacing.md)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}
