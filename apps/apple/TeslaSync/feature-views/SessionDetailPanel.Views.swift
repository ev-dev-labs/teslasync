//
//  SessionDetailPanel.Views.swift
//  TeslaSync — P4 feature view · 0091 · SessionDetailPanel (Apple)
//
//  The presentational subviews composed by `SessionDetailPanel`: the panel header (web
//  uppercase tracked title) with the live-state freshness chip, the connectivity banner, the
//  label/value detail row (web `SessionDetailRow`), the rows list, and the loading / error /
//  empty states the Apple HIG states contract requires. All consume pre-localized strings
//  from the P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Header (title + freshness chip)

/// The surface header: the web uppercase tracked `<h3>Session Details</h3>` title paired with
/// the live-state freshness chip (ADR-013).
struct SessionDetailHeader: View {
    let title: String
    let connection: SessionDetailConnection

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: title)
                .font(Font.TS.label)
                .fontWeight(.semibold)
                .textCase(.uppercase)
                .kerning(TSTypeMetrics.labelTracking)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            SessionDetailFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct SessionDetailFreshnessChip: View {
    let connection: SessionDetailConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        let text = SessionDetailStrings.string(descriptor.key, descriptor.fallback)
        return HStack(spacing: TSSpacing.xs) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: text)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: text))
    }

    private static func descriptor(for connection: SessionDetailConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "charging.curve.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "charging.curve.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "charging.curve.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the rows when the bound source is not live, so the
/// cached session is clearly labeled while reconnecting / offline.
struct SessionDetailConnectivityBanner: View {
    let connection: SessionDetailConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "charging.curve.offlineBanner" : "charging.curve.staleBanner"
        let fallback = offline
            ? "Offline — showing last known session details"
            : "Reconnecting — session details may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: SessionDetailStrings.string(key, fallback))
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

// MARK: - Detail row (web `SessionDetailRow`)

/// One label/value line — the native parity of the web `SessionDetailRow` (a justified row
/// with a muted label, a medium-weight value, and the bottom hairline divider).
struct SessionDetailRowView: View {
    let label: String
    let value: String

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
                Text(verbatim: label)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: value)
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                    .multilineTextAlignment(.trailing)
            }
            .padding(.vertical, TSSpacing.sm)
            Rectangle()
                .fill(Color.TS.border)
                .frame(height: 1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: SessionDetailAccessibility.rowSummary(label: label, value: value)))
    }
}

// MARK: - Rows list (web panel body)

/// The ordered detail rows (web `space-y-1` panel body). Each row resolves its label through
/// the P1/S10 facade and renders its pre-formatted value.
struct SessionDetailRowsView: View {
    let rows: [SessionDetailRow]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(rows) { row in
                SessionDetailRowView(
                    label: SessionDetailStrings.string(row.labelKey, row.labelFallback),
                    value: row.value
                )
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Loading state (web `<LoadingSkeleton />`)

/// The initial-fetch skeleton rows (web loading branch), respecting Reduce Motion via the
/// shared `TSSkeleton`.
struct SessionDetailLoadingList: View {
    private let rowCount = 6

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(0 ..< rowCount, id: \.self) { _ in
                VStack(spacing: 0) {
                    HStack(spacing: TSSpacing.md) {
                        TSSkeleton(width: 88, height: 12)
                        Spacer(minLength: TSSpacing.sm)
                        TSSkeleton(width: 64, height: 12)
                    }
                    .padding(.vertical, TSSpacing.sm)
                    Rectangle()
                        .fill(Color.TS.border)
                        .frame(height: 1)
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: SessionDetailStrings.string(
            "charging.curve.loadingA11y", "Loading session details"
        )))
    }
}

// MARK: - Error state (native `QueryError` equivalent + retry)

/// The failure box (web hook error surfaced by the page) with the retry affordance the P4
/// states contract's `QueryError`-equivalent requires.
struct SessionDetailErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Label {
                Text(verbatim: SessionDetailStrings.string(
                    "charging.curve.error", "Couldn't load session details"
                ))
                .font(Font.TS.body)
                .fontWeight(.semibold)
            } icon: {
                Image(systemName: "exclamationmark.triangle.fill")
            }
            .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: onRetry) {
                Text(verbatim: SessionDetailStrings.string("charging.curve.retry", "Retry"))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: SessionDetailStrings.string("charging.curve.retry", "Retry")))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.lg)
        .background(
            Color.TS.statusDanger.opacity(0.06),
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Empty state (friendly, never a blank box)

/// The friendly empty box shown when the query resolved without a selected session — so the
/// surface still renders an explanation rather than a blank box.
struct SessionDetailEmptyView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Image(systemName: "bolt.slash")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: SessionDetailStrings.string(
                "charging.curve.empty", "No charging session selected."
            ))
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textMuted)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
