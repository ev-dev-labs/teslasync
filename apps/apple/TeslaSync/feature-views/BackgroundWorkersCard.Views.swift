//
//  BackgroundWorkersCard.Views.swift
//  TeslaSync — P4 feature view · 0240 · BackgroundWorkersCard (Apple)
//
//  The presentational subviews composed by `BackgroundWorkersCard`: the panel
//  header (title + subtitle + freshness/connectivity chips + Refresh), the
//  loading / error / empty states, and the populated body — the two-axis summary,
//  the per-name group cards (header + instance rows + probe-error boxes), the
//  scale-callout footer, and the API-logs link. All consume the P1/S10 facade and
//  the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Severity / status → tone + label (web severityClasses / instanceClasses)

extension WorkerGroupSeverity {
    /// The shared status tone for the group dot + healthy chip (web dot/chip
    /// colour map: healthy → emerald, degraded → amber, down → red, unknown →
    /// neutral).
    var tone: TSTone {
        switch self {
        case .healthy: .success
        case .degraded: .warning
        case .down: .danger
        case .unknown: .neutral
        }
    }
}

extension WorkerInstanceStatus {
    /// The shared status tone for the instance dot + status chip (web
    /// `instanceClasses`: healthy → emerald, unhealthy → amber, down → red).
    var tone: TSTone {
        switch self {
        case .healthy: .success
        case .unhealthy: .warning
        case .down: .danger
        }
    }
}

// MARK: - Runtime chip (mirrors TSBadge tokens for a runtime String)

/// A small tinted capsule mirroring the shared `TSBadge` styling, but taking the
/// runtime string the `LocalizedStringKey`-only `TSBadge` cannot express. Backs
/// the group rollup chip, the per-instance status chip, and the stale / offline
/// header chips.
struct BWChip: View {
    let text: String
    var systemImage: String?
    var tone: TSTone = .neutral

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if let systemImage {
                Image(systemName: systemImage).font(.caption2)
            }
            Text(verbatim: text).font(Font.TS.caption).fontWeight(.medium)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: text))
    }
}

/// A small status dot (web `rounded-full` severity dot).
struct BWStatusDot: View {
    let tone: TSTone
    var size: CGFloat = 10

    var body: some View {
        Circle()
            .fill(tone.color)
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

// MARK: - Panel header (native chrome: title + Refresh + freshness chips)

/// The always-visible panel chrome: the title + subtitle, the stale / offline
/// chips, and the ghost Refresh button (spinner while fetching). The web card is
/// embedded under the page's "Background workers" section header; the native
/// surface owns that header so it can host the P4 freshness affordances.
struct BWPanelHeader: View {
    let isFetching: Bool
    let isStale: Bool
    let isOffline: Bool
    let onRefresh: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: BWStrings.string("backgroundWorkers.title", "Background workers"))
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text(verbatim: BWStrings.string("backgroundWorkers.subtitle", Self.subtitleFallback))
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                chipRow
            }
            Spacer(minLength: 0)
            refreshButton
        }
    }

    @ViewBuilder
    private var chipRow: some View {
        if isStale || isOffline {
            HStack(spacing: TSSpacing.sm) {
                if isStale {
                    BWChip(
                        text: BWStrings.string("backgroundWorkers.stale", "Stale"),
                        systemImage: "clock.arrow.circlepath",
                        tone: .warning
                    )
                }
                if isOffline {
                    BWChip(
                        text: BWStrings.string("backgroundWorkers.offline", "Offline"),
                        systemImage: "wifi.slash",
                        tone: .neutral
                    )
                }
            }
            .padding(.top, 2)
        }
    }

    private var refreshButton: some View {
        TSButton(variant: .ghost, size: .small, isLoading: isFetching, action: onRefresh) {
            Label {
                Text(verbatim: BWStrings.string("backgroundWorkers.refresh", "Refresh"))
            } icon: {
                Image(systemName: "arrow.clockwise")
            }
        }
        .accessibilityLabel(Text(verbatim: BWStrings.string("backgroundWorkers.refresh", "Refresh")))
    }

    private static let subtitleFallback =
        "Per-instance health for the notification, export, and automation workers."
}

// MARK: - Loading / error / empty

/// The first-load state: an inline spinner with the loading caption.
struct BWLoadingView: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            ProgressView().controlSize(.small)
            Text(verbatim: BWStrings.string("backgroundWorkers.loading", "Loading background workers…"))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .padding(.vertical, TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: BWStrings.string(
            "backgroundWorkers.loadingA11y", "Loading background workers"
        )))
    }
}

/// The failure box (warning triangle + message) with the retry affordance the P4
/// states contract's `QueryError`-equivalent requires, wired to the refresh.
struct BWErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(alignment: .top, spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.TS.statusDanger)
                Text(verbatim: BWStrings.string("backgroundWorkers.error", Self.fallback))
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.statusDanger)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button(action: onRetry) {
                Text(verbatim: BWStrings.string("backgroundWorkers.retry", "Retry"))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: BWStrings.string("backgroundWorkers.retry", "Retry")))
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.statusDanger.opacity(0.06),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.3), lineWidth: 1)
        )
    }

    private static let fallback = "Could not load background worker health. Check API logs and try again."
}

/// The zero-workers state (web `!health || workers.length === 0` branch): the
/// friendly explanation that the worker processes must be running + reachable.
struct BWEmptyView: View {
    var body: some View {
        Text(verbatim: BWStrings.string("backgroundWorkers.empty", Self.fallback))
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(TSSpacing.md)
            .background(
                Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
    }

    private static let fallback =
        "No background workers reporting. Ensure the notification, export, and automation worker " +
        "processes are running and reachable on their configured ports."
}
