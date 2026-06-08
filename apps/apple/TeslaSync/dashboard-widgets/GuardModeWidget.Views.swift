//
//  GuardModeWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0054 · GuardModeWidget (Apple)
//
//  The presentational subviews composed by `GuardModeWidget`: the tinted status
//  chip, the connectivity banner, the compact (1×2) row, the standard (2×4) status
//  card, and the event feed + its rows. All consume pre-localized strings from the
//  P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - GuardChip (tinted capsule — web `Badge`)

/// A capsule status chip styled with the shared `TSBadge` tokens, taking a
/// pre-localized `String` (which the shared `TSBadge` — `LocalizedStringKey`-only —
/// can't express for our per-surface table) plus an optional leading SF Symbol.
struct GuardChip: View {
    let tone: TSTone
    let label: String
    var systemImage: String?

    var body: some View {
        HStack(spacing: 4) {
            if let systemImage {
                Image(systemName: systemImage).font(.system(size: 9, weight: .semibold))
            }
            Text(verbatim: label).font(Font.TS.caption).fontWeight(.medium)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the content when the bound source is not
/// live, so cached values are clearly labeled (web freshness-indicator intent).
struct GuardConnectivityBanner: View {
    let connection: GuardConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.guardOfflineBanner" : "widget.guardStaleBanner"
        let fallback = isOffline ? "Offline — showing last known status" : "Reconnecting — status may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            GuardStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Compact row (web `CompactView`, 1×2)

/// The 1×2 layout: a shield glyph + armed/disarmed chip on the leading edge, with
/// the event-count chip trailing (web `CompactView`).
struct GuardCompactRow: View {
    let status: GuardStatus

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: status.enabled ? "checkmark.shield.fill" : "shield.slash.fill")
                .font(.system(size: 16))
                .foregroundStyle(status.enabled ? Color.TS.statusSuccess : Color.TS.textMuted)
                .accessibilityHidden(true)
            GuardChip(
                tone: status.enabled ? .success : .neutral,
                label: status.enabled
                    ? GuardStrings.string("widget.guardArmed", "Armed")
                    : GuardStrings.string("widget.guardDisarmed", "Disarmed")
            )
            Spacer(minLength: TSSpacing.xs)
            GuardChip(tone: status.eventCount > 0 ? .warning : .neutral, label: eventCountLabel)
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: GuardAccessibility.statusSummary(
            for: status,
            localize: GuardStrings.string
        )))
    }

    private var eventCountLabel: String {
        "\(status.eventCount.formatted()) \(GuardStrings.string("widget.guardEvents", "events"))"
    }
}

// MARK: - Status card (web `StandardView` header)

/// The 2×4 status card: shield glyph, armed/disarmed + sensitivity/auto-panic
/// caption, and the ON/OFF chip (web `StandardView`'s status row).
struct GuardStatusCard: View {
    let status: GuardStatus

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: status.enabled ? "checkmark.shield.fill" : "shield.slash.fill")
                .font(.system(size: 20))
                .foregroundStyle(status.enabled ? Color.TS.statusSuccess : Color.TS.textMuted)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: status.enabled
                    ? GuardStrings.string("widget.guardArmed", "Armed")
                    : GuardStrings.string("widget.guardDisarmed", "Disarmed"))
                    .font(Font.TS.bodySm).fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                Text(verbatim: detailText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: TSSpacing.sm)
            GuardChip(
                tone: status.enabled ? .success : .neutral,
                label: status.enabled
                    ? GuardStrings.string("widget.guardOn", "ON")
                    : GuardStrings.string("widget.guardOff", "OFF")
            )
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: GuardAccessibility.statusSummary(
            for: status,
            localize: GuardStrings.string
        )))
    }

    private var detailText: String {
        let sensitivity = "\(GuardStrings.string("widget.guardSensitivity", "Sensitivity")): \(status.sensitivity)"
        guard status.autoPanic else { return sensitivity }
        return "\(sensitivity) · \(GuardStrings.string("widget.guardAutoPanic", "Auto-panic"))"
    }
}

// MARK: - Event feed (web `WidgetEventFeed`)

/// The newest-first event feed with a friendly empty state — the native port of
/// the web `WidgetEventFeed`. The already-sorted items are capped at `maxItems`.
struct GuardEventFeed: View {
    let items: [GuardFeedItem]
    let maxItems: Int

    var body: some View {
        let shown = Array(items.prefix(maxItems))
        if shown.isEmpty {
            GuardEmptyFeed()
        } else {
            let now = Date()
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                ForEach(Array(shown.enumerated()), id: \.element.id) { offset, item in
                    GuardEventRow(item: item, isLast: offset == shown.count - 1, now: now)
                }
            }
            .frame(maxWidth: .infinity, alignment: .top)
        }
    }
}

/// The feed-level empty state (web `WidgetEventFeed` `emptyMessage` "No guard
/// events"). Always rendered in place of a blank panel.
struct GuardEmptyFeed: View {
    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "shield.fill")
                .font(.system(size: 18))
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: GuardStrings.string("widget.guardNoEvents", "No guard events"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

/// A single event row: connected timeline dot/icon in the event color, the
/// localized title + relative time, and the acknowledged/unacknowledged subtitle
/// (web `TimelineItem`).
struct GuardEventRow: View {
    let item: GuardFeedItem
    let isLast: Bool
    let now: Date

    var body: some View {
        let visual = GuardEventCatalog.visual(for: item.eventType)
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            VStack(spacing: 0) {
                Image(systemName: visual.systemImage)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(visual.dotColor)
                    .frame(width: 18, height: 18)
                if !isLast {
                    Rectangle().fill(Color.TS.border).frame(width: 2).frame(maxHeight: .infinity)
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                    Text(verbatim: item.title)
                        .font(Font.TS.bodySm).fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                        .lineLimit(1)
                    Spacer(minLength: TSSpacing.xs)
                    Text(verbatim: GuardRelativeTime.string(for: item.timestamp, relativeTo: now))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
                Text(verbatim: item.subtitle)
                    .font(Font.TS.caption)
                    .foregroundStyle(item.acknowledged ? Color.TS.textMuted : Color.TS.statusWarning)
            }
            .padding(.bottom, isLast ? 0 : TSSpacing.sm)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: GuardAccessibility.eventSummary(for: item)))
    }
}
