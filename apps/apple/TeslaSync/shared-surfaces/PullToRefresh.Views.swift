//
//  PullToRefresh.Views.swift
//  TeslaSync — P4 shared surface · 0188 · PullToRefresh (Apple)
//
//  The presentational subviews composed by `PullToRefresh`: the floating pull indicator pill (the
//  parity of the web indicator `<div>` — a glass capsule with a wind-up glyph + the pull / release /
//  refreshing copy) and its glyph. The pill is a pure function of the pull distance + refreshing flag
//  + threshold, so it renders identically in the live surface, the previews, and the snapshot tests.
//
//  Native refinements over the web `Loader2`: the wind-up glyph is the SF Symbol `arrow.clockwise`
//  rotated by `progress * 270°` (web rotates its spinner glyph the same way); the refreshing state
//  shows the system indeterminate `ProgressView` (web `animate-spin`), collapsing to a still glyph
//  under Reduce Motion (the parity of the web `refreshing && !reduce && 'animate-spin'`). The capsule
//  uses `TSMaterial.overlay` vibrancy (web `backdrop-blur`) and the P1/S9 tokens for every color,
//  spacing, and radius. All copy resolves through the P1/S10 facade.
//

import SwiftUI

// MARK: - Indicator pill

/// The floating pull indicator — the web indicator `<div>`: a glass capsule that fades + scales in with
/// the pull, shows a winding glyph that rotates toward the release point, and swaps to a spinner while
/// refreshing. Pure: it derives everything from `pull` / `refreshing` / `threshold` via the projection.
struct PullToRefreshIndicator: View {
    let pull: Double
    let refreshing: Bool
    let threshold: Double

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var progress: Double {
        PullToRefreshProjection.progress(pull: pull, threshold: threshold, refreshing: refreshing)
    }

    private var phase: PullToRefreshPhase {
        PullToRefreshProjection.phase(pull: pull, threshold: threshold, refreshing: refreshing, active: true)
    }

    private var label: String {
        PullToRefreshAccessibility.statusLabel(for: phase, strings: PullToRefreshStrings.string)
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            PullToRefreshGlyph(progress: progress, refreshing: refreshing, reduceMotion: reduceMotion)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.xs)
        .background(TSMaterial.overlay, in: Capsule(style: .continuous))
        .overlay(Capsule(style: .continuous).strokeBorder(Color.TS.border, lineWidth: 1))
        .opacity(PullToRefreshProjection.indicatorOpacity(progress: progress))
        .scaleEffect(PullToRefreshProjection.indicatorScale(progress: progress))
        .padding(.bottom, TSSpacing.xs)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityAddTraits(refreshing ? .updatesFrequently : [])
        .accessibilityHidden(!refreshing)
    }
}

// MARK: - Glyph

/// The indicator glyph — a winding `arrow.clockwise` while pulling (rotated `progress * 270°`, the web
/// spinner sweep), the system `ProgressView` while refreshing, and a still glyph while refreshing under
/// Reduce Motion (the web `!reduce` guard on `animate-spin`).
struct PullToRefreshGlyph: View {
    let progress: Double
    let refreshing: Bool
    let reduceMotion: Bool

    private let dimension: CGFloat = 14

    var body: some View {
        Group {
            if refreshing, !reduceMotion {
                ProgressView()
                    .controlSize(.small)
            } else {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: dimension, weight: .semibold))
                    .foregroundStyle(Color.TS.textSecondary)
                    .rotationEffect(.degrees(
                        PullToRefreshProjection.iconRotationDegrees(progress: progress, refreshing: refreshing)
                    ))
            }
        }
        .frame(width: dimension, height: dimension)
    }
}
