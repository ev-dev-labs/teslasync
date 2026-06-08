//
//  MediaNowPlayingWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0063 · MediaNowPlayingWidget (Apple)
//
//  Reusable presentation pieces for the Now Playing surface (artwork badge,
//  progress + volume meters, the "Playing" chip, an info row) and the
//  `MediaNowPlayingContent` composition that reproduces the web compact /
//  standard / tall layouts. Styled exclusively with the generated design tokens.
//

import SwiftUI

// MARK: - Atoms

/// 40×40 rounded artwork stand-in for the now-playing track (web `bg-neon-cyan/10`
/// icon box with a Music glyph). Decorative — the surrounding text carries the label.
struct MediaArtworkBadge: View {
    var body: some View {
        Image(systemName: "music.note")
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(Color.TS.accent)
            .frame(width: 40, height: 40)
            .background(
                Color.TS.accent.opacity(0.1),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .accessibilityHidden(true)
    }
}

/// Thin track-progress bar (web song `ProgressBar`): a muted track with an accent
/// fill clamped to `fraction` (0…1).
struct MediaProgressBar: View {
    let fraction: Double

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.TS.border.opacity(0.6))
                Capsule()
                    .fill(Color.TS.accent)
                    .frame(width: clampedWidth(geo.size.width))
            }
        }
        .frame(height: 4)
        .accessibilityHidden(true)
    }

    private func clampedWidth(_ total: CGFloat) -> CGFloat {
        total * min(max(fraction, 0), 1)
    }
}

/// Thin volume meter (web volume bar): a muted track with a quiet fill, reading as
/// a level indicator rather than a primary control.
struct MediaMeterBar: View {
    let fraction: Double

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.TS.border.opacity(0.6))
                Capsule()
                    .fill(Color.TS.textMuted.opacity(0.7))
                    .frame(width: geo.size.width * min(max(fraction, 0), 1))
            }
        }
        .frame(height: 4)
        .accessibilityHidden(true)
    }
}

/// The "Playing" chip shown when playback is active (web `bg-green-500/10
/// text-green-400`).
struct NowPlayingChip: View {
    let label: String

    var body: some View {
        Text(verbatim: label)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(Color.TS.statusSuccess)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.statusSuccess.opacity(0.12), in: Capsule())
            .accessibilityLabel(Text(verbatim: label))
    }
}

/// A muted icon + single-line text row (web source / station line).
struct MediaInfoRow: View {
    let systemImage: String
    let text: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage)
                .font(.system(size: 11, weight: .regular))
                .accessibilityHidden(true)
            Text(verbatim: text)
                .font(Font.TS.caption)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .foregroundStyle(Color.TS.textSecondary)
    }
}

// MARK: - Content composition (web compact / standard / tall branches)

/// Renders the now-playing track for a resolved snapshot. Switches between the
/// web's compact (1×1) and standard/tall layouts; the tall layout (rows ≥ 2)
/// adds the album line, source, and volume meter — a faithful port of the web
/// `isCompact` / `isTall` branches.
struct MediaNowPlayingContent: View {
    let media: MediaNowPlaying
    let isCompact: Bool
    let isTall: Bool

    var body: some View {
        if isCompact {
            compactBody
        } else {
            standardBody
        }
    }

    /// ── Compact 1×1 ──
    private var compactBody: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "music.note")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: media.title)
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            Text(verbatim: media.artist)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .multilineTextAlignment(.center)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: MediaNowPlayingAccessibility.summary(for: media)))
    }

    /// ── Standard / Tall ──
    private var standardBody: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            trackHeader
            if media.hasProgress { progressBlock }
            if isTall {
                tallExtras
            } else if let source = media.source {
                MediaInfoRow(systemImage: "dot.radiowaves.left.and.right", text: source)
                    .frame(maxHeight: .infinity, alignment: .bottom)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var trackHeader: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            MediaArtworkBadge()
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: media.title)
                    .font(Font.TS.body)
                    .fontWeight(.bold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                Text(verbatim: media.artist)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                if isTall, let album = media.album {
                    Text(verbatim: album)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if media.isPlaying {
                NowPlayingChip(label: MediaNowPlayingStrings.string("widget.playing", "Playing"))
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: MediaNowPlayingAccessibility.summary(for: media)))
    }

    private var progressBlock: some View {
        VStack(spacing: TSSpacing.xs) {
            MediaProgressBar(fraction: media.progressFraction)
            HStack {
                Text(verbatim: MediaProjectionBuilder.formatDurationClock(media.elapsedMs))
                Spacer()
                Text(verbatim: MediaProjectionBuilder.formatDurationClock(media.durationMs))
            }
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .monospacedDigit()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(progressAccessibilityLabel)
    }

    private var progressAccessibilityLabel: Text {
        let elapsed = MediaProjectionBuilder.formatDurationClock(media.elapsedMs)
        let duration = MediaProjectionBuilder.formatDurationClock(media.durationMs)
        let value = MediaNowPlayingStrings.format("widget.media.a11yProgress", "%@ of %@", elapsed, duration)
        return Text(verbatim: value)
    }

    private var tallExtras: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            if let source = media.source {
                MediaInfoRow(systemImage: "dot.radiowaves.left.and.right", text: source)
            }
            if media.hasVolume { volumeRow }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
    }

    private var volumeRow: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "speaker.wave.2.fill")
                .font(.system(size: 11, weight: .regular))
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(true)
            MediaMeterBar(fraction: media.volumeFraction)
            Text(verbatim: volumeText)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .monospacedDigit()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: volumeAccessibilityLabel))
    }

    private var volumeText: String {
        guard let volume = media.volume else { return MediaNowPlaying.dash }
        return String(format: "%g", volume)
    }

    private var volumeAccessibilityLabel: String {
        MediaNowPlayingStrings.format("widget.media.a11yVolume", "Volume %@", volumeText)
    }
}
