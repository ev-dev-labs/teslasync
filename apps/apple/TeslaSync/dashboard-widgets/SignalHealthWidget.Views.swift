//
//  SignalHealthWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0088 · SignalHealthWidget (Apple)
//
//  The native subviews that compose the surface: the freshness chip (web
//  `DataFreshness`), the stale / offline connectivity banner, the coverage badge
//  (web compact `Badge`), the stat tile (web `StatCard`), the status badge (web
//  `Badge` variant), the stale / gap signal list with its per-row name +
//  last-seen, and the self-contained loading skeleton bar. They lean on the
//  shared design tokens so they read identically to the rest of the app.
//

import SwiftUI

// MARK: - Health level → presentation tones

extension SignalHealthLevel {
    /// The semantic tone — the web `healthColor` (`green-400` / `amber-400` /
    /// `red-400` / `--text-muted`).
    var tone: Color {
        switch self {
        case .green:
            Color.TS.statusSuccess
        case .amber:
            Color.TS.statusWarning
        case .red:
            Color.TS.statusDanger
        case .neutral:
            Color.TS.textMuted
        }
    }
}

// MARK: - Freshness chip (web `DataFreshness`)

/// The live / stale / offline freshness chip shown in the header, mirroring the
/// shared `DataFreshness` dot the web `WidgetShell` renders from the stats query.
struct SignalHealthFreshnessChip: View {
    let connection: SignalHealthConnection

    var body: some View {
        let tone: Color
        let label: String
        switch connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = SignalHealthStrings.string("widget.signalHealth.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = SignalHealthStrings.string("widget.signalHealth.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = SignalHealthStrings.string("widget.signalHealth.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Connectivity banner (web stale / offline shell states)

/// The stale / offline banner shown above the coverage when the feed is not live,
/// so cached counts stay visible with an honest freshness cue.
struct SignalHealthConnectivityBanner: View {
    let connection: SignalHealthConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline
            ? "widget.signalHealth.offlineBanner"
            : "widget.signalHealth.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last synced coverage"
            : "Reconnecting — coverage may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            SignalHealthStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Coverage badge (web compact `Badge` active/total)

/// The compact `active / total` coverage chip — the native port of the web
/// compact-layout `Badge`. Tinted by the health level.
struct SignalHealthCoverageBadge: View {
    let level: SignalHealthLevel
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(.semibold)
            .monospacedDigit()
            .foregroundStyle(level.tone)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(level.tone.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(level.tone.opacity(0.3), lineWidth: 1))
    }
}

// MARK: - Status badge (web `Badge` variant)

/// The health status chip — the native port of the web status `Badge`
/// (`success` / `warning` / `danger` / `neutral`). Renders the level's copy with
/// its semantic tone.
struct SignalHealthStatusBadge: View {
    let level: SignalHealthLevel

    var body: some View {
        Text(verbatim: level.statusText)
            .font(Font.TS.caption)
            .fontWeight(.semibold)
            .textCase(.uppercase)
            .tracking(0.4)
            .foregroundStyle(level.tone)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(level.tone.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(level.tone.opacity(0.3), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

// MARK: - Stat tile (web `StatCard`)

/// One summary statistic — the native port of the web `StatCard` (icon + label
/// over value). Animates value changes and honors Reduce Motion.
struct SignalHealthStatTile: View {
    let systemImage: String
    let iconTint: Color
    let label: String
    let value: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: 4) {
                Image(systemName: systemImage)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(iconTint)
                    .accessibilityHidden(true)
                Text(verbatim: label)
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Text(verbatim: value)
                .font(Font.TS.section)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .contentTransition(.numericText())
                .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.normalDuration), value: value)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label). \(value)"))
    }
}

// MARK: - Stale / gap signal list (web wide-layout list)

/// The "Stale / Gap Signals" list — a native port of the web wide-layout list.
/// The rows arrive already sorted (gaps with no last-seen first, then oldest) and
/// capped by the caller; each renders its signal name + last-seen relative time.
struct SignalHealthGapList: View {
    let headerLabel: String
    let rows: [SignalHealthGapRow]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: headerLabel)
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityAddTraits(.isHeader)
            ScrollView {
                LazyVStack(spacing: TSSpacing.xs) {
                    ForEach(rows) { row in
                        SignalHealthGapRowView(row: row)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One stale / gap row: a warning glyph · the signal name · the last-seen relative
/// time, over a subtle surface. Honors the web 28pt minimum row height.
struct SignalHealthGapRowView: View {
    let row: SignalHealthGapRow

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            Text(verbatim: row.name)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: row.lastSeenText)
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .frame(minHeight: 28)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: SignalHealthAccessibility.gapLabel(name: row.name, lastSeen: row.lastSeenText))
        )
    }
}

// MARK: - Skeleton bar (self-contained loading indicator)

/// A single rounded skeleton bar for the loading chrome. Self-contained (no shared
/// skeleton dependency); pulses gently and stays still under Reduce Motion.
struct SignalHealthSkeletonBar: View {
    var width: CGFloat?
    var height: CGFloat = 44
    var cornerRadius: CGFloat = TSRadius.md
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(Color.TS.border.opacity(pulse ? 0.45 : 0.25))
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: TSMotion.slowDuration).repeatForever(autoreverses: true)) {
                    pulse = true
                }
            }
            .accessibilityHidden(true)
    }
}
