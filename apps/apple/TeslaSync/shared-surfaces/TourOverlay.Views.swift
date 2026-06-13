//
//  TourOverlay.Views.swift
//  TeslaSync — P4 shared surface · 0145 · TourOverlay (Apple)
//
//  The presentational subviews composed by the surface in its data state: the dimmed scrim with the
//  transparent spotlight cutout (the native parity of the web `clip-path` polygon — reproduced with an
//  even-odd mask so the rounded cutout is exact), the accent border-glow around the spotlight (web
//  `border-2 border-primary/40` + glow shadow), the tooltip card (web tooltip: close "×", step counter,
//  title, description, Skip / Back / Next-or-"Get Started!", and the progress dots), the progress-dot
//  row, and the freshness chip (P4 connectivity axis). All consume the P1/S10 facade and the shared
//  P1/S9 tokens / components — no networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web spotlight border / active dot use
//  `--theme-primary`, mapped to the brand `Color.TS.accent`; the inactive dots + tooltip border map to
//  `Color.TS.border`; the scrim is a neutral dark veil (the web `--surface-overlay`).
//
//  Accessibility note: the tooltip is one VoiceOver container labelled by the web `tour.dialogLabel`,
//  while the close / skip / back / next controls stay individually focusable with their own labels (web
//  real `<button>`s). The scrim is the web overlay's `onClick={onSkip}` — a labelled dismiss control.
//

import SwiftUI

// MARK: - Spotlight cutout mask (web `clip-path` polygon)

/// The even-odd mask shape for the dimmed scrim — a full-bleed rect with the rounded spotlight rect
/// punched out. Filled with `eoFill`, the overlapping hole becomes transparent, exactly reproducing the
/// web `clip-path` polygon that carves the spotlight out of the overlay.
struct TourOverlaySpotlightMaskShape: Shape {
    let hole: CGRect
    let cornerRadius: CGFloat

    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.addRect(rect)
        if hole.width > 0, hole.height > 0 {
            path.addRoundedRect(
                in: hole,
                cornerSize: CGSize(width: cornerRadius, height: cornerRadius),
                style: .continuous
            )
        }
        return path
    }
}

// MARK: - Spotlight border glow (web `border-2 border-primary/40` + glow)

/// The accent ring drawn around the spotlight — the native parity of the web spotlight border +
/// `shadow-[0_0_20px_…primary…]`. Non-interactive; positioned at the spotlight's top-left origin.
struct TourOverlaySpotlightBorder: View {
    let spotlight: TourOverlaySpotlight

    var body: some View {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .strokeBorder(Color.TS.accent.opacity(0.45), lineWidth: 2)
            .frame(width: spotlight.width, height: spotlight.height)
            .shadow(color: Color.TS.accent.opacity(0.25), radius: 10)
            .offset(x: spotlight.x, y: spotlight.y)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

// MARK: - Progress dots (web progress-dot row)

/// The progress-dot row — the wide accent pill for the current step, narrow muted dots otherwise (web
/// `w-4 bg-primary` vs `w-1.5`). Decorative: the tooltip's dialog label already speaks the step count.
struct TourOverlayProgressDotsView: View {
    let dots: [TourOverlayProgressDot]
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(dots) { dot in
                Capsule()
                    .fill(dot.state.isCurrent ? Color.TS.accent : Color.TS.border)
                    .frame(width: dot.state.isCurrent ? 16 : 6, height: 4)
                    .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.fastDuration), value: dot.state)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityHidden(true)
    }
}

// MARK: - Tooltip card (web tooltip)

/// The tour tooltip — the native parity of the web tooltip card: the close "×", the step counter, the
/// title + description, the Skip / Back / Next-or-"Get Started!" controls, and the progress dots. One
/// VoiceOver container labelled by `tour.dialogLabel`; every control keeps its own label.
struct TourOverlayTooltipCard: View {
    let title: String
    let detail: String
    let counter: String
    let nav: TourOverlayNavModel
    let dots: [TourOverlayProgressDot]
    let dialogLabel: String
    let inlineError: String?
    let onNext: () -> Void
    let onPrev: () -> Void
    let onSkip: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: counter)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: title)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Text(verbatim: detail)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if let inlineError, !inlineError.isEmpty {
                inlineErrorRow(inlineError)
            }
            navRow
            TourOverlayProgressDotsView(dots: dots)
                .padding(.top, TSSpacing.xs)
        }
        .padding(TSSpacing.lg)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .overlay(alignment: .topTrailing) { closeButton }
        .shadow(color: Color.black.opacity(0.25), radius: 16, y: 6)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: dialogLabel))
    }

    /// The close "×" — a 44pt VoiceOver / touch target (web `min-w-[44px] min-h-[44px]`).
    private var closeButton: some View {
        Button(action: onSkip) {
            Image(systemName: "xmark")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: TourOverlayStrings.string("tour.close", "Close tour")))
    }

    /// The inline refresh-failure line shown above the controls while a cached anchor is still on screen.
    private func inlineErrorRow(_ message: String) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.statusWarning)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The web nav row: Skip on the left, Back (when not the first step) + Next/"Get Started!" on the
    /// right.
    private var navRow: some View {
        HStack(spacing: TSSpacing.sm) {
            Button(action: onSkip) {
                Text(verbatim: TourOverlayStrings.string("tour.skip", "Skip tour"))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: TourOverlayStrings.string("tour.skip", "Skip tour")))

            Spacer(minLength: TSSpacing.sm)

            HStack(spacing: TSSpacing.sm) {
                if nav.showsBack {
                    TSButton(variant: .ghost, size: .small, action: onPrev) {
                        HStack(spacing: TSSpacing.xs) {
                            Image(systemName: "arrow.left").font(.system(size: 11, weight: .semibold))
                            Text(verbatim: TourOverlayStrings.string("tour.prev", "Back"))
                        }
                    }
                    .accessibilityLabel(Text(verbatim: TourOverlayStrings.string("tour.prev", "Back")))
                }
                TSButton(variant: .primary, size: .small, action: onNext) {
                    HStack(spacing: TSSpacing.xs) {
                        Text(verbatim: TourOverlayStrings.string(nav.primaryTitleKey, nav.primaryTitleFallback))
                        if nav.showsNextArrow {
                            Image(systemName: "arrow.right").font(.system(size: 11, weight: .semibold))
                        }
                    }
                }
                .accessibilityLabel(Text(verbatim: TourOverlayStrings.string(
                    nav.primaryTitleKey, nav.primaryTitleFallback
                )))
            }
        }
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown when the live tour state is not fresh — a coloured dot + a label (`Stale` /
/// `Offline`). A button so VoiceOver + pointer users can re-request a re-measure, with an explicit label.
struct TourOverlayFreshnessChip: View {
    let connection: TourOverlayConnection
    let onRefresh: () -> Void

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: TourOverlayStrings.string("tour.live", "Live")
        case .stale: TourOverlayStrings.string("tour.stale", "Stale")
        case .offline: TourOverlayStrings.string("tour.offline", "Offline")
        }
    }

    private var accessibilityText: String {
        switch connection {
        case .live:
            label
        case .stale:
            TourOverlayStrings.string("tour.staleA11y", "Stale — tap to refresh")
        case .offline:
            TourOverlayStrings.string("tour.offlineA11y", "Offline — showing the last known position")
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(tone).frame(width: 6, height: 6)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.opacity(0.25), lineWidth: 1))
            .background(Color.TS.surface, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}

// MARK: - Active spotlight view (web data render)

/// The data render — the dimmed scrim with the spotlight cutout, the accent border-glow, and the
/// tooltip card anchored by the web `getTooltipPosition` geometry. Binds the model's pure derivations;
/// no geometry maths live here beyond resolving the measured tooltip size to a top-left origin.
struct TourOverlayActiveView: View {
    let model: TourOverlayModel
    let viewport: TourOverlayViewport

    @State private var tooltipSize: CGSize = .zero
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack(alignment: .topLeading) {
            scrim
            if let spotlight = model.spotlight {
                TourOverlaySpotlightBorder(spotlight: spotlight)
            }
            tooltip
        }
        .frame(width: viewport.width, height: viewport.height, alignment: .topLeading)
    }

    /// The dimmed veil with the spotlight punched out; tapping it skips the tour (web overlay
    /// `onClick={onSkip}`).
    private var scrim: some View {
        Rectangle()
            .fill(Color.black.opacity(0.55))
            .mask(
                TourOverlaySpotlightMaskShape(
                    hole: model.spotlight?.rect ?? .zero,
                    cornerRadius: TSRadius.md
                )
                .fill(style: FillStyle(eoFill: true))
            )
            .frame(width: viewport.width, height: viewport.height)
            .contentShape(Rectangle())
            .onTapGesture { model.skip() }
            .accessibilityLabel(Text(verbatim: TourOverlayStrings.string("tour.close", "Close tour")))
            .accessibilityAddTraits(.isButton)
    }

    private var tooltip: some View {
        let layout = model.tooltipLayout(viewport: viewport)
        let origin = model.tooltipOrigin(viewport: viewport, tooltipSize: tooltipSize) ?? .zero
        return TourOverlayTooltipCard(
            title: model.step?.title ?? "",
            detail: model.step?.detail ?? "",
            counter: model.stepCounterText,
            nav: model.navModel,
            dots: model.progressDots,
            dialogLabel: model.dialogAccessibilityLabel,
            inlineError: model.inlineErrorMessage,
            onNext: { model.next() },
            onPrev: { model.prev() },
            onSkip: { model.skip() }
        )
        .frame(width: layout?.maxWidth ?? TourOverlayTooltipPositioner.maxTooltipWidth, alignment: .leading)
        .onGeometryChange(for: CGSize.self) { proxy in proxy.size } action: { tooltipSize = $0 }
        .offset(x: origin.x, y: origin.y)
        .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.normalDuration), value: origin)
    }
}
