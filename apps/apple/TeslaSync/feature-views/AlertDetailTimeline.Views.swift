//
//  AlertDetailTimeline.Views.swift
//  TeslaSync — P4 feature view · 0001 · AlertDetailTimeline (Apple)
//
//  The presentational subviews composed by `AlertDetailTimeline`: the stale/offline
//  connectivity banner, the connected timeline list + row (web `<Timeline>` — a tint-ringed
//  icon dot on a connector rail, the title/time baseline, and the optional note subtitle),
//  the loading skeleton, the error retry (QueryError equivalent), and the empty state (web
//  `<EmptyState>`). All consume the P1/S10 facade + the shared P1/S9 tokens / shared
//  components — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Tint → token color (web `KIND_COLOR` hex → design token)

/// Maps a semantic timeline tint to its concrete design token. The web uses brand hex
/// literals (`#00f0ff` / `#10b981` / `#f59e0b` / `#a855f7`); each resolves to the exact
/// generated token so the four kinds stay visually distinct without a hardcoded hex.
enum AlertDetailTimelineTintColor {
    static func color(for tint: AlertDetailTimelineTint) -> Color {
        switch tint {
        case .created: Color.TS.accent
        case .acknowledged: Color.TS.statusSuccess
        case .reopened: Color.TS.statusWarning
        case .commented: Color.TS.chartSeriesPower
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the list when the bound source is not live, so cached
/// rows are clearly labeled (web `DataFreshness` indicator intent).
struct AlertDetailTimelineConnectivityBanner: View {
    let connection: AlertDetailTimelineConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "alerts.timeline.offlineBanner" : "alerts.timeline.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded audit timeline"
            : "Reconnecting — the audit timeline may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: AlertDetailTimelineStrings.string(key, fallback))
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Timeline list (web `<Timeline>`)

/// The connected audit timeline (web `Timeline`): a vertical stack of rows joined by a
/// connector rail, preserving the supplied (oldest-first) order.
struct AlertDetailTimelineList: View {
    let entries: [AlertDetailTimelineEntry]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                AlertDetailTimelineRow(entry: entry, isLast: index == entries.count - 1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Timeline row (web Timeline item)

/// One timeline row: the tint-ringed icon dot on a connector rail + the title/time baseline +
/// the optional note subtitle (web `flex gap-3 pl-6` item with the colored dot). Title / icon
/// / tint resolve through the pure adapter + the P1/S10 facade.
struct AlertDetailTimelineRow: View {
    let entry: AlertDetailTimelineEntry
    let isLast: Bool

    private static let dotSize: CGFloat = 22

    private var title: String {
        AlertDetailTimelineLabels.title(for: entry, localize: AlertDetailTimelineStrings.string)
    }

    private var tint: Color {
        AlertDetailTimelineTintColor.color(for: AlertDetailTimelineAdapter.tint(for: entry.kind))
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            iconDot
            content
        }
        .padding(.bottom, isLast ? 0 : TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(alignment: .topLeading) { connector }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: AlertDetailTimelineAccessibility.rowSummary(
            for: entry,
            localize: AlertDetailTimelineStrings.string
        )))
    }

    /// The vertical connector that joins this row's dot to the next row's dot (web `absolute …
    /// top-6 h-full w-px` line). Omitted on the last row; spans the full padded row height so
    /// it bridges the inter-row gap, offset to sit under the dot's center.
    @ViewBuilder
    private var connector: some View {
        if !isLast {
            Rectangle()
                .fill(Color.TS.border)
                .frame(width: 1)
                .frame(maxHeight: .infinity)
                .padding(.top, Self.dotSize)
                .padding(.leading, (Self.dotSize - 1) / 2)
        }
    }

    private var iconDot: some View {
        Image(systemName: AlertDetailTimelineAdapter.iconSystemName(for: entry.kind))
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(tint)
            .frame(width: Self.dotSize, height: Self.dotSize)
            .background(Color.TS.surface, in: Circle())
            .overlay(Circle().strokeBorder(tint, lineWidth: 2))
            .accessibilityHidden(true)
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Text(verbatim: title)
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(verbatim: AlertDetailTimelineTimestamp.absolute(for: entry.timestamp))
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .fixedSize()
            }
            if let note = entry.note, !note.isEmpty {
                Text(verbatim: note)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.top, 1)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Loading (web `Skeleton`)

/// The initial-fetch skeleton chrome (web `Skeleton`): a few rows shaped like the icon dot +
/// two text lines + a timestamp, respecting Reduce Motion via the shared `TSSkeleton`.
struct AlertDetailTimelineLoadingRows: View {
    let rows: Int

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(0 ..< rows, id: \.self) { _ in
                HStack(alignment: .top, spacing: TSSpacing.md) {
                    TSSkeleton(width: 22, height: 22, cornerRadius: 11)
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(width: 180, height: 12)
                        TSSkeleton(width: 120, height: 10)
                    }
                    Spacer(minLength: TSSpacing.sm)
                    TSSkeleton(width: 56, height: 10)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: AlertDetailTimelineStrings.string(
            "alerts.timeline.loadingA11y",
            "Loading audit timeline"
        )))
    }
}

// MARK: - Error (QueryError equivalent — native retry affordance)

/// The failure box: the web leaf has no error chrome (its parent's react-query owns the
/// fetch), so the native surface adds the states-contract `QueryError` equivalent with a
/// retry affordance wired to the model's refresh.
struct AlertDetailTimelineErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: AlertDetailTimelineStrings.string(
                "alerts.timeline.errorTitle",
                "Couldn’t load the audit timeline"
            ))
            .font(Font.TS.body)
            .fontWeight(.semibold)
            .foregroundStyle(Color.TS.textPrimary)
            .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                Text(verbatim: AlertDetailTimelineStrings.string("alerts.timeline.retry", "Retry"))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: AlertDetailTimelineStrings.string(
                "alerts.timeline.retry",
                "Retry"
            )))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty (web `EmptyState`)

/// The zero-rows state (web `EmptyState` icon=bell, title="Audit timeline", message="No
/// events yet"), over the shared `TSEmptyState` / `ContentUnavailableView`.
struct AlertDetailTimelineEmptyView: View {
    private var title: String {
        AlertDetailTimelineStrings.string("alerts.timeline.title", "Audit timeline")
    }

    private var message: String {
        AlertDetailTimelineStrings.string("alerts.timeline.empty", "No events yet")
    }

    var body: some View {
        TSEmptyState(title: "\(title)", message: "\(message)", systemImage: "bell")
            .frame(maxWidth: .infinity)
            .padding(.vertical, TSSpacing.md)
    }
}
