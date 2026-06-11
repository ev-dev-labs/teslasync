//
//  TimelineScrubber.Views.swift
//  TeslaSync — P4 shared surface · 0107 · TimelineScrubber (Apple)
//
//  The interactive scrubber track — the SwiftUI parity of the web `TimelineScrubber` happy path: a
//  thin track with a buffered band + neon fill + an optional decorative background, keyframe marker
//  ticks (tint by kind + clustered-count badge + tap-to-seek + tooltip), a hover ghost playhead, the
//  active playhead thumb (it grows + gains a ring while dragging), and a hover / drag preview bubble
//  (time over the formatted speed / power / SoC / elevation the host sampled). Drag-to-scrub emits
//  intermediate seeks throttled to `SCRUB_INTERVAL_MS`; a tap (zero-distance drag) seeks once on
//  release. The track is one Apple-idiomatic adjustable slider (VoiceOver swipe to scrub). Reduce
//  Motion drops the fill / thumb transition, matching the web `prefers-reduced-motion` branch. All
//  color comes from the P1/S9 tokens; all copy from the P1/S10 facade.
//

import SwiftUI

// MARK: - Track

/// The trip-replay timeline track. Controlled: it reports normalized 0…1 positions through `onSeek`
/// (intermediate emits throttled while dragging; the final position always emits on release) and never
/// owns the progress itself.
struct TimelineScrubberTrack: View {
    let progress: Double
    let buffered: Double?
    let valueText: String
    let markers: [TimelineScrubberMarker]
    let preview: (@MainActor (Double) -> TimelineScrubberPreview?)?
    let durationSeconds: Double
    let onSeek: (Double) -> Void
    let background: AnyView?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hoverAt: Double?
    @State private var isDragging = false
    @State private var lastEmit = Date.distantPast

    private let trackAreaHeight: CGFloat = 32

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            ZStack(alignment: .topLeading) {
                backgroundLayer(width: width)
                trackLayer(width: width)
                markerLayer(width: width)
                hoverGhost(width: width)
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
        .accessibilityLabel(Text(verbatim: TimelineScrubberStrings.string(
            "timelineScrubber.progress", "Playback progress"
        )))
        .accessibilityValue(Text(verbatim: valueText))
        .accessibilityAdjustableAction(adjust)
    }

    // MARK: Layers

    @ViewBuilder
    private func backgroundLayer(width: CGFloat) -> some View {
        if let background {
            background
                .frame(width: width, height: 24)
                .opacity(0.2)
                .clipped()
                .position(x: width / 2, y: trackAreaHeight / 2)
                .allowsHitTesting(false)
        }
    }

    private func trackLayer(width: CGFloat) -> some View {
        ZStack(alignment: .leading) {
            Capsule().fill(Color.TS.border.opacity(0.5)).frame(height: 6)
            if let buffered {
                Capsule()
                    .fill(Color.TS.textMuted.opacity(0.25))
                    .frame(width: max(0, width * buffered), height: 6)
            }
            Capsule()
                .fill(Color.TS.accent)
                .frame(width: max(0, width * clamp(progress)), height: 6)
                .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.fastDuration), value: progress)
        }
        .frame(maxHeight: .infinity, alignment: .center)
    }

    private func markerLayer(width: CGFloat) -> some View {
        ForEach(markers) { marker in
            TimelineScrubberMarkerTick(marker: marker, onSeek: onSeek)
                .position(x: width * clamp(marker.at), y: trackAreaHeight / 2)
        }
    }

    @ViewBuilder
    private func hoverGhost(width: CGFloat) -> some View {
        if let hoverAt, !isDragging {
            Capsule()
                .fill(Color.TS.textMuted)
                .frame(width: 1, height: 14)
                .position(x: width * clamp(hoverAt), y: trackAreaHeight / 2)
                .allowsHitTesting(false)
        }
    }

    private func playhead(width: CGFloat) -> some View {
        Circle()
            .fill(Color.white)
            .frame(width: isDragging ? 16 : 12, height: isDragging ? 16 : 12)
            .overlay(Circle().strokeBorder(Color.TS.accent.opacity(0.4), lineWidth: isDragging ? 2 : 0))
            .shadow(color: Color.black.opacity(0.25), radius: 2, y: 1)
            .position(x: width * clamp(progress), y: trackAreaHeight / 2)
            .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.fastDuration), value: progress)
            .allowsHitTesting(false)
    }

    @ViewBuilder
    private func previewLayer(width: CGFloat) -> some View {
        if let position = hoverAt ?? (isDragging ? progress : nil) {
            TimelineScrubberPreviewTooltip(
                point: preview?(position),
                time: TimelineScrubberAdapter.timeText(durationSeconds: durationSeconds, progress: position)
            )
            .position(x: clampedTooltipX(width * clamp(position), width: width), y: -2)
            .allowsHitTesting(false)
        }
    }

    // MARK: Interaction

    private func scrubGesture(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                isDragging = true
                let at = clamp(value.location.x / max(1, width))
                hoverAt = at
                let now = Date()
                if TimelineScrubberAdapter.shouldEmit(now: now, last: lastEmit) {
                    lastEmit = now
                    onSeek(at)
                }
            }
            .onEnded { value in
                onSeek(clamp(value.location.x / max(1, width)))
                isDragging = false
                hoverAt = nil
            }
    }

    private func updateHover(_ phase: HoverPhase, width: CGFloat) {
        switch phase {
        case let .active(location):
            if !isDragging { hoverAt = clamp(location.x / max(1, width)) }
        case .ended:
            if !isDragging { hoverAt = nil }
        }
    }

    private func adjust(_ direction: AccessibilityAdjustmentDirection) {
        switch direction {
        case .increment: onSeek(clamp(progress + TimelineScrubberMeta.adjustStep))
        case .decrement: onSeek(clamp(progress - TimelineScrubberMeta.adjustStep))
        @unknown default: break
        }
    }

    private func clamp(_ value: Double) -> Double {
        TimelineScrubberAdapter.clamp01(value)
    }

    /// Keeps the centered tooltip from overflowing the track edges.
    private func clampedTooltipX(_ x: CGFloat, width: CGFloat) -> CGFloat {
        max(44, min(width - 44, x))
    }
}

// MARK: - Marker tick

/// One keyframe tick — a colored bar the user can tap to jump to that moment. Carries a spoken label
/// (+ clustered-count suffix), a pointer tooltip (web marker `Tooltip`), and a count badge when
/// `count > 1`.
struct TimelineScrubberMarkerTick: View {
    let marker: TimelineScrubberMarker
    let onSeek: (Double) -> Void

    var body: some View {
        Button {
            onSeek(marker.at)
        } label: {
            RoundedRectangle(cornerRadius: 1, style: .continuous)
                .fill(tint)
                .frame(width: 3, height: 14)
                .overlay(alignment: .top) { countBadge }
        }
        .buttonStyle(.plain)
        .help(Text(verbatim: tooltipText))
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    @ViewBuilder
    private var countBadge: some View {
        if let count = marker.count, count > 1 {
            Text(verbatim: "\(count)")
                .font(.system(size: 8, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .padding(.horizontal, 2)
                .background(Color.TS.surface, in: Capsule())
                .offset(y: -11)
        }
    }

    private var tooltipText: String {
        if let label = marker.label, !label.isEmpty { return label }
        return TimelineScrubberStrings.string("timelineScrubber.markers.\(marker.kind.rawValue)", marker.kind.rawValue)
    }

    private var accessibilityLabel: String {
        let base = TimelineScrubberAccessibility.markerLabel(marker, strings: TimelineScrubberStrings.string)
        guard let count = marker.count, count > 1 else { return base }
        let suffix = TimelineScrubberAccessibility.markerCountLabel(count, strings: TimelineScrubberStrings.string)
        return "\(base), \(suffix)"
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
struct TimelineScrubberPreviewTooltip: View {
    let point: TimelineScrubberPreview?
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
