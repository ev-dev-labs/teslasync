//
//  AutomationActivityFeed.Rows.swift
//  TeslaSync — P4 feature view · 0081 · AutomationActivityFeed (Apple)
//
//  The list rows + state views composed by `AutomationActivityFeed`: the live-event row
//  (web `LiveEventRow`), the history row (web `HistoryRow`), the cached-data banner, and
//  the loading / empty / error states. Split from `AutomationActivityFeed.Views.swift`
//  (which holds the token extensions + header chrome) to keep each file under the house
//  400-line limit. All consume pre-localized strings from the P1/S10 facade and the shared
//  P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Live-event row (web `LiveEventRow`)

/// One live SSE row (web `LiveEventRow`): a pulsing kind icon, the automation name, an
/// optional error / reason line, and the neutral kind badge, on a faint accent background.
struct AutomationLiveEventRowView: View {
    let row: AutomationLiveEventRow

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Image(systemName: row.kind.symbolName)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(row.kind.tint)
                .automationPulse(true)
                .accessibilityHidden(true)
            textColumn
            Spacer(minLength: TSSpacing.sm)
            AutomationNeutralBadge(text: AutomationFeedStrings.string(row.kind.badgeKey, row.kind.badgeSuffix))
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.accent.opacity(0.05), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityValue))
    }

    private var textColumn: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: row.name)
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            if let error = row.error {
                detail(error, tone: Color.TS.statusDanger)
            } else if let reason = row.reason {
                detail(reason, tone: Color.TS.textMuted)
            }
        }
    }

    private func detail(_ text: String, tone: Color) -> some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .foregroundStyle(tone)
            .lineLimit(1)
    }

    private var accessibilityValue: String {
        AutomationFeedAccessibility.liveEventSummary(for: row, AutomationFeedStrings.string)
    }
}

// MARK: - History row (web `HistoryRow`)

/// One execution-history row (web `HistoryRow`): a status icon, the automation name, an
/// optional error, and the trailing time-ago / duration / actions metadata.
struct AutomationHistoryRowView: View {
    let row: AutomationHistoryRow

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Image(systemName: row.status.symbolName)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(row.status.tint)
                .accessibilityHidden(true)
            nameColumn
            Spacer(minLength: TSSpacing.sm)
            meta(timeText)
            meta(row.durationText)
            if let actions = row.actionsText {
                meta(actions)
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityValue))
    }

    private var nameColumn: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: row.name)
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            if let error = row.error {
                Text(verbatim: error)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusDanger)
                    .lineLimit(1)
            }
        }
    }

    private func meta(_ value: String) -> some View {
        Text(verbatim: value)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .lineLimit(1)
    }

    private var timeText: String {
        guard let date = row.triggeredAt else { return AutomationFeedFormat.dash }
        return AutomationFeedFormat.relative(for: date)
    }

    private var accessibilityValue: String {
        AutomationFeedAccessibility.historyRowSummary(for: row, AutomationFeedStrings.string)
    }
}

// MARK: - Cached-data banner (stale / offline)

/// The stale/offline banner shown above the feed when the bound source is not fully live,
/// so cached rows are clearly labeled (the P4 states-contract cached-data indicator).
struct AutomationFeedConnectivityBanner: View {
    let connection: AutomationFeedConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "automations.offlineBanner" : "automations.staleBanner"
        let fallback = offline
            ? "Offline — showing last known activity"
            : "Reconnecting — activity may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: AutomationFeedStrings.string(key, fallback))
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

// MARK: - Loading (web 5 × `<Skeleton h-10 />`)

/// The initial-fetch skeleton chrome: five redacted rows that respect Reduce Motion via the
/// shared `TSSkeleton`, exposed as one labeled accessibility element.
struct AutomationFeedLoadingView: View {
    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            ForEach(0 ..< 5, id: \.self) { _ in
                TSSkeleton(height: 36, cornerRadius: TSRadius.sm)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: AutomationFeedStrings.string(
            "automations.loadingA11y", "Loading recent activity"
        )))
    }
}

// MARK: - Empty (web `<EmptyState message="No execution history yet" />`)

/// The zero-history state (web `EmptyState`): a friendly Activity glyph + the localized
/// "No execution history yet" message, never a blank surface.
struct AutomationFeedEmptyView: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: AutomationFeedStrings.string("automations.noHistory", "No execution history yet"))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (native QueryError-equivalent + retry)

/// The failure state (the P4 states contract's `QueryError`-equivalent): an icon, a title,
/// the optional upstream message, and a retry affordance wired to the model. The web leaf
/// has no error branch — its parent owns the query — so this is native chrome for a failed
/// parent fetch surfaced through the source's error snapshot.
struct AutomationFeedErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: AutomationFeedStrings.string("automations.errorTitle", "Couldn't load recent activity"))
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            retryButton
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .contain)
    }

    private var retryButton: some View {
        Button(action: onRetry) {
            Text(verbatim: AutomationFeedStrings.string("automations.retry", "Retry"))
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: AutomationFeedStrings.string("automations.retry", "Retry")))
    }
}
