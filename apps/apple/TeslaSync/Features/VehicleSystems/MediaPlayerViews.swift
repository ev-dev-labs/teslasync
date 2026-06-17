//
//  MediaPlayerViews.swift
//  TeslaSync — P4 feature view · P7 · MediaPlayer (Apple) — Shared UI + panels
//
//  The shared HIG furniture (the `GlassPanel` peer, the section header, the
//  status badge, the `MetricCard` peer, the staleness chip, the inline error
//  banner) plus two panels: the "Now Playing" card (web GlassPanel 1) and the
//  volume + stats row (web GlassPanel 2 gauge panel + the four `MetricCard`s
//  Unique-Tracks / Top-Source / Avg-Volume / Volume-Step). Materials stand in for
//  the web glass (ADR-005); every color/typography value comes from the generated
//  design tokens (P2); every string from the catalog.
//

import SwiftUI

// MARK: - Shared furniture (web GlassPanel / Badge)

/// The frosted card that stands in for the web `GlassPanel`.
struct MediaPlayerCard<Content: View>: View {
    var padding: CGFloat = TSSpacing.xl
    var glows: Bool = false
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TSRadius.lg))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg)
                    .stroke(glows ? Color.TS.accent.opacity(0.5) : Color.TS.border, lineWidth: 1)
            )
    }
}

/// Section header: an SF Symbol next to a title (web icon + `h3`).
struct MediaPlayerSectionHeader: View {
    let systemImage: String
    let title: String
    var tint: Color = Color.TS.accent

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .foregroundStyle(tint)
                .accessibilityHidden(true)
            Text(title)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        .accessibilityLabel(Text(title))
    }
}

/// Small status pill (web `Badge` with optional leading dot).
struct MediaPlayerStatusBadge: View {
    let text: String
    let tone: MediaPlayerTone
    var showsDot = false

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if showsDot {
                Circle()
                    .fill(tone.color)
                    .frame(width: 6, height: 6)
                    .accessibilityHidden(true)
            }
            Text(text)
                .font(Font.TS.label)
                .fontWeight(.semibold)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .foregroundStyle(tone.color)
        .background(tone.color.opacity(0.15), in: Capsule())
    }
}

/// The summary metric tile (web `MetricCard`): leading icon, big value, caption.
struct MediaPlayerMetricCard: View {
    let label: String
    let value: String
    let systemImage: String
    let accent: Color

    var body: some View {
        MediaPlayerCard(padding: TSSpacing.lg) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Image(systemName: systemImage)
                    .font(Font.TS.panel)
                    .foregroundStyle(accent)
                    .accessibilityHidden(true)
                Text(value)
                    .font(Font.TS.title)
                    .foregroundStyle(Color.TS.textPrimary)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text(label)
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(label): \(value)"))
    }
}

/// Subtle chip surfaced when the last refresh is older than two minutes (ADR-013).
struct MediaPlayerStalenessChip: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "clock.badge.exclamationmark")
            Text(String(localized: "translation.common.staleData", defaultValue: "Data may be out of date"))
        }
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.statusWarning)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.statusWarning.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

/// Web `anyError` inline AlertBanner — shown when a secondary request fails while
/// the latest snapshot still rendered.
struct MediaPlayerInlineError: View {
    let message: String

    var body: some View {
        let prefix = String(localized: "translation.error.loadFailed", defaultValue: "Failed to load data")
        return HStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text("\(prefix): \(message)")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.statusDanger.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.md))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md)
                .stroke(Color.TS.statusDanger.opacity(0.4), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - GlassPanel 1 — Now Playing card

/// The now-playing card (web GlassPanel 1): album-art tile, track title +
/// status badge, artist / album, optional station + source, and a progress bar.
/// Glows cyan and the art pulses while actively playing (web `glow` + animate-pulse).
struct MediaNowPlayingCard: View {
    let latest: MediaPlayerSnapshot?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    private var isPlaying: Bool { latest?.isPlaying ?? false }

    var body: some View {
        MediaPlayerCard(padding: TSSpacing.x2xl, glows: isPlaying) {
            HStack(alignment: .top, spacing: TSSpacing.x2xl) {
                albumArt
                trackInfo
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(accessibilityLabel))
    }

    // MARK: Album art

    private var albumArt: some View {
        RoundedRectangle(cornerRadius: TSRadius.lg)
            .fill(Color.TS.surface.opacity(0.6))
            .frame(width: 112, height: 112)
            .overlay(
                Image(systemName: "music.note")
                    .font(.system(size: 44, weight: .regular))
                    .foregroundStyle(Color.TS.accent.opacity(0.6))
            )
            .opacity(isPlaying && pulsing && !reduceMotion ? 0.6 : 1)
            .animation(pulseAnimation, value: pulsing)
            .onAppear { pulsing = true }
            .accessibilityHidden(true)
    }

    private var pulseAnimation: Animation? {
        guard isPlaying, !reduceMotion else { return nil }
        return .easeInOut(duration: 1.1).repeatForever(autoreverses: true)
    }

    // MARK: Track info

    private var trackInfo: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.md) {
                Text(titleText)
                    .font(Font.TS.title)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                if let latest, latest.playbackStatus != nil {
                    MediaPlayerStatusBadge(
                        text: latest.playbackState.label,
                        tone: latest.playbackState.tone,
                        showsDot: true
                    )
                }
            }
            Text(artistText)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
            if let station = latest?.nowPlayingStation, !station.isEmpty {
                Text(station)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            sourceLine
            progressBar
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var sourceLine: some View {
        if let source = latest?.playbackSource, !source.isEmpty, let kind = latest?.sourceKind {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: kind.symbol)
                    .foregroundStyle(kind.color)
                    .accessibilityHidden(true)
                Text(source)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
    }

    @ViewBuilder
    private var progressBar: some View {
        if let latest, let duration = latest.nowPlayingDuration, duration > 0 {
            HStack(spacing: TSSpacing.sm) {
                Text(MediaPlayerFormat.playTime(milliseconds: latest.nowPlayingElapsed ?? 0))
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textSecondary)
                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.TS.border)
                        Capsule()
                            .fill(Color.TS.accent)
                            .frame(width: geometry.size.width * latest.progressFraction)
                    }
                }
                .frame(height: 6)
                Text(MediaPlayerFormat.playTime(milliseconds: duration))
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .padding(.top, TSSpacing.xs)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(String(localized: "translation.Time", defaultValue: "Time")))
            .accessibilityValue(Text(progressAccessibilityValue(latest: latest, duration: duration)))
        }
    }

    // MARK: Text helpers

    private var titleText: String {
        if let title = latest?.nowPlayingTitle, !title.isEmpty { return title }
        return String(localized: "translation.No track", defaultValue: "No track")
    }

    private var artistText: String {
        let artist: String
        if let value = latest?.nowPlayingArtist, !value.isEmpty {
            artist = value
        } else {
            artist = String(localized: "translation.Unknown artist", defaultValue: "Unknown artist")
        }
        if let album = latest?.nowPlayingAlbum, !album.isEmpty {
            return "\(artist) — \(album)"
        }
        return artist
    }

    private var accessibilityLabel: String {
        "\(titleText). \(artistText)"
    }

    private func progressAccessibilityValue(latest: MediaPlayerSnapshot, duration: Double) -> String {
        let elapsed = MediaPlayerFormat.playTime(milliseconds: latest.nowPlayingElapsed ?? 0)
        return "\(elapsed) / \(MediaPlayerFormat.playTime(milliseconds: duration))"
    }
}

// MARK: - GlassPanel 2 + MetricCards — volume gauge + stats row

/// The volume + stats row (web GlassPanel 2 gauge + the four `MetricCard`s).
/// `GlassPanel2` hosts the volume `RadialGauge`; the four tiles are Unique-Tracks,
/// Top-Source, Avg-Volume and Volume-Step.
struct MediaVolumeStatsRow: View {
    let latest: MediaPlayerSnapshot?
    let stats: MediaPlayerStats
    let volumeMax: Double

    private let columns = [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.lg)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.lg) {
            volumeGaugePanel
            MediaPlayerMetricCard(
                label: String(localized: "translation.Unique Tracks", defaultValue: "Unique Tracks"),
                value: "\(stats.uniqueTracks)",
                systemImage: "music.note.list",
                accent: Color.TS.chartSeriesPower
            )
            MediaPlayerMetricCard(
                label: String(localized: "translation.Top Source", defaultValue: "Top Source"),
                value: stats.topSource,
                systemImage: "antenna.radiowaves.left.and.right",
                accent: Color.TS.statusSuccess
            )
            MediaPlayerMetricCard(
                label: String(localized: "translation.Avg Volume", defaultValue: "Avg Volume"),
                value: MediaPlayerFormat.int(stats.averageVolume),
                systemImage: "speaker.wave.2",
                accent: Color.TS.accent
            )
            MediaPlayerMetricCard(
                label: String(localized: "translation.Volume Step", defaultValue: "Volume Step"),
                value: volumeStepText,
                systemImage: "speaker.wave.2",
                accent: Color.TS.chartSeriesPower
            )
        }
    }

    /// GlassPanel 2 — the volume radial gauge, centered in its own card.
    private var volumeGaugePanel: some View {
        MediaPlayerCard(padding: TSSpacing.lg) {
            MediaPlayerRadialGauge(
                value: latest?.audioVolume ?? 0,
                maximum: volumeMax,
                label: String(localized: "translation.Volume", defaultValue: "Volume"),
                color: TSChartPalette.color(at: 0)
            )
            .frame(maxWidth: .infinity)
        }
    }

    private var volumeStepText: String {
        guard let increment = latest?.audioVolumeIncrement else { return "—" }
        return MediaPlayerFormat.number(increment, fractionDigits: 2)
    }
}
