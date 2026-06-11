//
//  PlaybackControls.Scrubber.swift
//  TeslaSync — P4 shared surface · 0096 · PlaybackControls (Apple)
//
//  The native `TimelineScrubber` (web `components/data-display/TimelineScrubber.tsx`): a thin track
//  with a fill + playhead, keyframe marker ticks, drag-to-scrub with throttled intermediate seeks
//  (web `SCRUB_INTERVAL_MS`), a hover / drag preview tooltip (time + formatted speed / power / SoC /
//  elevation), and an Apple-idiomatic accessible adjustable slider (VoiceOver swipe to scrub). Reduce
//  Motion drops the playhead transition, matching the web `prefers-reduced-motion` branch.
//

import SwiftUI

// MARK: - Scrubber

/// The trip-replay timeline track. Controlled: it reports normalized 0…1 positions through `onSeek`
/// (intermediate emits are throttled while dragging; the final position always emits on release) and
/// never owns the progress itself.
struct PlaybackControlsScrubber: View {
    let progress: Double
    let durationMs: Double?
    let valueText: String?
    let markers: [PlaybackControlsMarker]
    let preview: (@MainActor (Double) -> PlaybackControlsPreview?)?
    let onSeek: (Double) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hoverAt: Double?
    @State private var isDragging = false
    @State private var lastEmit = Date.distantPast

    private let trackAreaHeight: CGFloat = 28

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            ZStack(alignment: .topLeading) {
                track(width: width)
                markerLayer(width: width)
                playhead(width: width)
                previewLayer(width: width)
            }
            .frame(height: trackAreaHeight)
            .contentShape(Rectangle())
            .gesture(scrubGesture(width: width))
            .onContinuousHover { updateHover($0, width: width) }
        }
        .frame(height: trackAreaHeight)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: PlaybackControlsStrings.string(
            "replay.controls.progress", "Playback progress"
        )))
        .accessibilityValue(Text(verbatim: valueText ?? "\(Int((progress * 100).rounded()))%"))
        .accessibilityAdjustableAction(adjust)
    }

    // MARK: Layers

    private func track(width: CGFloat) -> some View {
        ZStack(alignment: .leading) {
            Capsule()
                .fill(Color.TS.border.opacity(0.5))
                .frame(height: 4)
            Capsule()
                .fill(Color.TS.accent)
                .frame(width: max(0, width * clamped(progress)), height: 4)
                .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.fastDuration), value: progress)
        }
        .frame(maxHeight: .infinity, alignment: .center)
    }

    private func markerLayer(width: CGFloat) -> some View {
        ForEach(markers) { marker in
            PlaybackControlsMarkerTick(marker: marker, onSeek: onSeek)
                .position(x: width * clamped(marker.at), y: trackAreaHeight / 2)
        }
    }

    private func playhead(width: CGFloat) -> some View {
        Circle()
            .fill(Color.white)
            .frame(width: isDragging ? 16 : 12, height: isDragging ? 16 : 12)
            .overlay(Circle().strokeBorder(Color.TS.accent.opacity(0.5), lineWidth: isDragging ? 2 : 0))
            .shadow(color: Color.black.opacity(0.25), radius: 2, y: 1)
            .position(x: width * clamped(progress), y: trackAreaHeight / 2)
            .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.fastDuration), value: progress)
            .allowsHitTesting(false)
    }

    @ViewBuilder
    private func previewLayer(width: CGFloat) -> some View {
        if let position = hoverAt ?? (isDragging ? progress : nil) {
            PlaybackControlsPreviewTooltip(
                point: preview?(position),
                time: PlaybackControlsProjection.timeText(durationMs: durationMs, progress: position)
            )
            .position(x: clampedTooltipX(width * clamped(position), width: width), y: -2)
            .allowsHitTesting(false)
        }
    }

    // MARK: Interaction

    private func scrubGesture(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                isDragging = true
                let at = clamped(value.location.x / max(1, width))
                hoverAt = at
                let now = Date()
                if now.timeIntervalSince(lastEmit) >= PlaybackControlsMeta.scrubInterval {
                    lastEmit = now
                    onSeek(at)
                }
            }
            .onEnded { value in
                let at = clamped(value.location.x / max(1, width))
                onSeek(at)
                isDragging = false
                hoverAt = nil
            }
    }

    private func updateHover(_ phase: HoverPhase, width: CGFloat) {
        switch phase {
        case let .active(location):
            if !isDragging { hoverAt = clamped(location.x / max(1, width)) }
        case .ended:
            if !isDragging { hoverAt = nil }
        }
    }

    private func adjust(_ direction: AccessibilityAdjustmentDirection) {
        let step = 0.05
        switch direction {
        case .increment: onSeek(clamped(progress + step))
        case .decrement: onSeek(clamped(progress - step))
        @unknown default: break
        }
    }

    private func clamped(_ value: Double) -> Double {
        max(0, min(1, value))
    }

    /// Keeps the centered tooltip from overflowing the track edges.
    private func clampedTooltipX(_ x: CGFloat, width: CGFloat) -> CGFloat {
        max(40, min(width - 40, x))
    }
}

// MARK: - Marker tick

/// One keyframe tick — a colored bar the user can tap to jump to that moment. Carries a spoken label
/// + a pointer tooltip (web marker `Tooltip`), and a clustered-count badge when `count > 1`.
struct PlaybackControlsMarkerTick: View {
    let marker: PlaybackControlsMarker
    let onSeek: (Double) -> Void

    var body: some View {
        Button {
            onSeek(marker.at)
        } label: {
            RoundedRectangle(cornerRadius: 1, style: .continuous)
                .fill(tint)
                .frame(width: 3, height: 12)
                .overlay(alignment: .top) { countBadge }
        }
        .buttonStyle(.plain)
        .help(Text(verbatim: marker.label ?? marker.kind.rawValue))
        .accessibilityLabel(Text(verbatim: PlaybackControlsAccessibility.markerLabel(
            marker, strings: PlaybackControlsStrings.string
        )))
    }

    @ViewBuilder
    private var countBadge: some View {
        if let count = marker.count, count > 1 {
            Text(verbatim: "\(count)")
                .font(.system(size: 8, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .padding(.horizontal, 2)
                .background(Color.TS.surface, in: Capsule())
                .offset(y: -10)
        }
    }

    private var tint: Color {
        switch marker.kind {
        case .start, .chargeStart: Color.TS.statusSuccess
        case .stop, .lowSoc: Color.TS.statusDanger
        case .chargeStop, .fastSegment: Color.TS.statusWarning
        case .regenPeak: Color.TS.accent
        case .event: Color.TS.textMuted
        }
    }
}

// MARK: - Preview tooltip

/// The hover / drag preview bubble — the formatted time over the formatted speed / power / SoC /
/// elevation the host sampled. Rendered verbatim (the scrubber does no number formatting).
struct PlaybackControlsPreviewTooltip: View {
    let point: PlaybackControlsPreview?
    let time: String?

    var body: some View {
        VStack(spacing: 2) {
            if let time {
                Text(verbatim: time).foregroundStyle(Color.TS.textSecondary)
            }
            if let speed = point?.speed {
                Text(verbatim: speed).foregroundStyle(Color.TS.accent)
            }
            if let power = point?.power {
                Text(verbatim: power).foregroundStyle(Color.TS.statusWarning)
            }
            if let soc = point?.soc {
                Text(verbatim: soc).foregroundStyle(Color.TS.statusSuccess)
            }
            if let elevation = point?.elevation {
                Text(verbatim: elevation).foregroundStyle(Color.TS.textSecondary)
            }
        }
        .font(.system(size: 11, design: .monospaced))
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(TSMaterial.overlay, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .fixedSize()
        .accessibilityHidden(true)
    }
}
