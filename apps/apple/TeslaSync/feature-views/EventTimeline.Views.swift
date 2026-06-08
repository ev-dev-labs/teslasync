//
//  EventTimeline.Views.swift
//  TeslaSync — P4 feature view · 0043 · EventTimeline (Apple)
//
//  The presentational subviews composed by `EventTimeline`: the freshness chip, the
//  stale/offline connectivity banner, the timeline row (web `flex … rounded-lg
//  bg-white/[0.02] p-3` with the variant-tinted icon circle + title/subtitle + timestamp),
//  the loading skeleton, the error retry (QueryError equivalent), and the empty state
//  (web `EmptyState`). All consume the P1/S10 facade + the shared P1/S9 tokens / shared
//  components — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Variant → tone (web green / red / gray circle)

/// Maps a timeline variant to its semantic tone, mirroring the web circle classes:
/// positive → green (success), negative → red (danger), neutral → gray (muted).
enum EventTimelineTone {
    static func tone(for variant: EventTimelineVariant) -> TSTone {
        switch variant {
        case .positive: .success
        case .negative: .danger
        case .neutral: .neutral
        }
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct EventTimelineFreshnessChip: View {
    let connection: EventTimelineConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: EventTimelineStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: EventTimelineStrings.string(descriptor.key, descriptor.fallback)))
    }

    private static func descriptor(for connection: EventTimelineConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "admin.security.timeline.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "admin.security.timeline.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "admin.security.timeline.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the list when the bound source is not live, so
/// cached rows are clearly labeled (web `DataFreshness` indicator intent).
struct EventTimelineConnectivityBanner: View {
    let connection: EventTimelineConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "admin.security.timeline.offlineBanner" : "admin.security.timeline.staleBanner"
        let fallback = offline
            ? "Offline — showing the last known security history"
            : "Reconnecting — the security timeline may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: EventTimelineStrings.string(key, fallback)).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Timeline row (web event row)

/// One timeline row: the variant-tinted icon circle + the localized title/subtitle +
/// the absolute timestamp, on the subtle row surface (web `rounded-lg bg-white/[0.02]
/// p-3`). Title/subtitle/icon resolve through the pure adapter + the P1/S10 facade.
struct EventTimelineRow: View {
    let entry: EventTimelineEntry

    private var labels: EventTimelineLabels.Resolved {
        EventTimelineLabels.resolve(for: entry, localize: EventTimelineStrings.string)
    }

    private var tone: TSTone {
        EventTimelineTone.tone(for: entry.variant)
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            iconCircle
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: labels.title)
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                if !labels.subtitle.isEmpty {
                    Text(verbatim: labels.subtitle)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(verbatim: EventTimelineTimestamp.absolute(for: entry.timestamp))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .fixedSize()
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: EventTimelineAccessibility.rowSummary(
            for: entry,
            localize: EventTimelineStrings.string
        )))
    }

    private var iconCircle: some View {
        Image(systemName: EventTimelineAdapter.iconSystemName(kind: entry.kind, variant: entry.variant))
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(tone.color)
            .frame(width: 32, height: 32)
            .background(tone.color.opacity(0.2), in: Circle())
            .accessibilityHidden(true)
    }
}

// MARK: - Loading (web `Skeleton`)

/// The initial-fetch skeleton chrome (web `Skeleton`): a few rows shaped like the icon
/// circle + two text lines, respecting Reduce Motion via the shared `TSSkeleton`.
struct EventTimelineLoadingRows: View {
    let rows: Int

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(0 ..< rows, id: \.self) { _ in
                HStack(alignment: .top, spacing: TSSpacing.md) {
                    TSSkeleton(width: 32, height: 32, cornerRadius: 16)
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(width: 160, height: 12)
                        TSSkeleton(width: 110, height: 10)
                    }
                    Spacer(minLength: TSSpacing.sm)
                    TSSkeleton(width: 48, height: 10)
                }
                .padding(TSSpacing.md)
                .background(
                    Color.TS.surfaceGlass,
                    in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: EventTimelineStrings.string(
            "admin.security.timeline.loadingA11y",
            "Loading security event timeline"
        )))
    }
}

// MARK: - Error (QueryError equivalent — native retry affordance)

/// The failure box: the web leaf has no error chrome (its parent's react-query owns the
/// fetch), so the native surface adds the states-contract `QueryError` equivalent with a
/// retry affordance wired to the model's refresh.
struct EventTimelineErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: EventTimelineStrings.string(
                "admin.security.timeline.errorTitle",
                "Couldn't load the security timeline"
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
                Text(verbatim: EventTimelineStrings.string("admin.security.timeline.retry", "Retry"))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: EventTimelineStrings.string(
                "admin.security.timeline.retry",
                "Retry"
            )))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty (web `EmptyState`)

/// The zero-rows state (web `EmptyState message="No state changes detected in the
/// history."`), over the shared `TSEmptyState` / `ContentUnavailableView`.
struct EventTimelineEmptyView: View {
    private var message: String {
        EventTimelineStrings.string(
            "admin.security.timeline.noEvents",
            "No state changes detected in the history."
        )
    }

    var body: some View {
        TSEmptyState(title: "\(message)", systemImage: "shield.lefthalf.filled")
            .frame(maxWidth: .infinity)
            .padding(.vertical, TSSpacing.md)
    }
}
