//
//  DensityToggle.Views.swift
//  TeslaSync — P4 shared surface · 0153 · DensityToggle (Apple)
//
//  The presentational pieces of the list-density selector — the native peers of the web elements: the
//  segmented track (web `role="radiogroup"` — an inline-flex pill bar), one segment (web `role="radio"`
//  button — icon + label), and the friendly empty-state view. All chrome is token-driven (P1/S9); no raw
//  hex, no Tailwind ports. The decorative SF Symbol is hidden from VoiceOver; each segment is a real
//  `Button` carrying its density label and the `.isSelected` trait when chosen (web `aria-checked`). The
//  track is one focusable element that decodes Left / Right arrows into a selection move (web `onKeyDown`),
//  reproducing the WAI-ARIA radiogroup arrow pattern while keeping each segment individually tappable +
//  VoiceOver-reachable (the `.contain` group). Selection animates with the standard token unless the user
//  has Reduce Motion on; the visible text label collapses on a compact width, the native peer of the web
//  `hidden sm:inline`.
//

import SwiftUI

// MARK: - Layout constants (web control metrics)

/// The selector's precise control metrics — the native peers of the web Tailwind utilities (`p-0.5` /
/// `gap-0.5` = 2pt, `h-3.5 w-3.5` = 14pt, `ring-2` = 2pt). Kept as named constants so the small,
/// control-specific values are documented rather than scattered magic numbers.
enum DensityToggleLayout {
    /// Inset of the segments inside the track (web `p-0.5`).
    static let trackPadding: CGFloat = 2
    /// Gap between segments (web `gap-0.5`).
    static let segmentSpacing: CGFloat = 2
    /// Icon glyph size (web `h-3.5 w-3.5`).
    static let iconSize: CGFloat = 14
    /// Focus-ring stroke width (web `focus-visible:ring-2`).
    static let focusRingWidth: CGFloat = 2
}

// MARK: - Track (web `role="radiogroup"`)

/// The segmented track — the native parity of the web `<div role="radiogroup">`. Lays the segments in a
/// horizontal pill bar, hugs its content (web `inline-flex`), and is the single focusable element that
/// turns Left / Right arrows into a selection move (web `onKeyDown`). VoiceOver sees it as one container
/// (`.contain`) labelled with the group name, with each segment reachable inside.
struct DensityToggleTrack: View {
    let projection: DensityToggleProjection
    let showsLabels: Bool
    let reduceMotion: Bool
    let onSelect: (Density) -> Void
    let onMove: (DensityToggleProjector.Direction) -> Void

    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: DensityToggleLayout.segmentSpacing) {
            ForEach(projection.segments) { segment in
                DensitySegmentButton(
                    segment: segment,
                    showsLabel: showsLabels,
                    reduceMotion: reduceMotion,
                    identifier: projection.segmentIdentifier(for: segment.density)
                ) {
                    onSelect(segment.density)
                }
            }
        }
        .padding(DensityToggleLayout.trackPadding)
        .background(
            Color.TS.surface.opacity(0.4),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(
                    isFocused ? Color.TS.accent : Color.TS.border,
                    lineWidth: isFocused ? DensityToggleLayout.focusRingWidth : 1
                )
        )
        .fixedSize()
        .focusable()
        .focused($isFocused)
        .onKeyPress(.leftArrow) {
            onMove(.backward)
            return .handled
        }
        .onKeyPress(.rightArrow) {
            onMove(.forward)
            return .handled
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: projection.groupLabel))
        .accessibilityIdentifier(projection.resolvedIdentifier)
    }
}

// MARK: - Segment (web `role="radio"` button)

/// One density option — the native parity of the web `<button role="radio">`: an SF Symbol plus (on a wide
/// enough layout) the i18n'd label. The selected segment fills with the raised surface and primary text;
/// the rest read as secondary text on a clear ground (web `text-primary` vs `text-secondary`). It is a real
/// `Button`, so tap, VoiceOver, Switch Control, and Full Keyboard Access all work; the `.isSelected` trait
/// announces the chosen one (web `aria-checked`). The glyph is decorative (hidden from VoiceOver) since the
/// label already names the option.
struct DensitySegmentButton: View {
    let segment: DensitySegment
    let showsLabel: Bool
    let reduceMotion: Bool
    let identifier: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: segment.systemImage)
                    .font(.system(size: DensityToggleLayout.iconSize, weight: .medium))
                    .accessibilityHidden(true)
                if showsLabel {
                    Text(verbatim: segment.label)
                        .font(Font.TS.caption)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .foregroundStyle(segment.isSelected ? Color.TS.textPrimary : Color.TS.textSecondary)
            .background(segmentBackground)
            .contentShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        }
        .buttonStyle(.plain)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.fastDuration), value: segment.isSelected)
        .accessibilityLabel(Text(verbatim: segment.label))
        .accessibilityAddTraits(segment.isSelected ? [.isButton, .isSelected] : .isButton)
        .accessibilityIdentifier(identifier)
    }

    /// The raised fill behind the selected segment (web `bg-[var(--surface-2)]`); unselected segments sit on
    /// a clear ground so only the track's translucent surface shows through.
    @ViewBuilder
    private var segmentBackground: some View {
        if segment.isSelected {
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .fill(Color.TS.surface)
        } else {
            Color.clear
        }
    }
}

// MARK: - Empty state (native — never a blank box)

/// The friendly empty state shown when no options are supplied. The web would render an empty radiogroup;
/// the native HIG calls for a labelled empty state rather than a bare box, so the surface still reads as a
/// density control with nothing to choose.
struct DensityToggleEmptyView: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "square.dashed")
                .font(.system(size: 12))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: DensityToggleStrings.empty)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(
            Color.TS.surface.opacity(0.4),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .fixedSize()
        .accessibilityElement(children: .combine)
    }
}
