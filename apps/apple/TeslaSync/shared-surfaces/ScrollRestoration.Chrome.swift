//
//  ScrollRestoration.Chrome.swift
//  TeslaSync — P4 shared surface · 0173 · ScrollRestoration (Apple)
//
//  The presentational vocabulary for the scroll-restoration status surface: the phase → style
//  descriptor, the compact status chip, and the degraded banner. The production scroll-restoration
//  behavior is invisible (the web component renders `null`), so these pieces back the NATIVE status
//  surface the P4 "render every state" contract requires — a faithful, legible visualization of which
//  branch the restoration logic took, never a blank box. Every label resolves through the P1/S10 facade;
//  every color, font, radius and spacing is a P1/S9 token; there are no raw hex values and no Tailwind
//  ports. Each phase maps to a REAL branch of the web source (see ``ScrollRestorationPhase``).
//

import SwiftUI

// MARK: - ScrollRestorationPhaseStyle (phase → tone + glyph + copy)

/// The view-ready style for a restoration phase — its semantic tone (mapped to a P1/S9 status token), an
/// SF Symbol, and the localized title + description. A pure projection from ``ScrollRestorationPhase`` so
/// the chip + status view are pure functions of the phase and the copy stays in one place. View-layer
/// only (it carries a ``TSTone``), so it is intentionally not `Sendable` — built + read on the main actor.
public struct ScrollRestorationPhaseStyle {
    public let tone: TSTone
    public let systemImage: String
    public let titleKey: String
    public let titleFallback: String
    public let descriptionKey: String
    public let descriptionFallback: String

    /// The localized phase title (web has none — native status chrome).
    public var title: String {
        ScrollRestorationStrings.string(titleKey, titleFallback)
    }

    /// The localized phase description (web has none — native status chrome).
    public var description: String {
        ScrollRestorationStrings.string(descriptionKey, descriptionFallback)
    }

    /// The style for a phase. Tones follow the leaf mapping: a successful restore reads as success, a
    /// fresh / no-saved top reads as informational / neutral, the disabled store reads as a warning.
    public static func style(for phase: ScrollRestorationPhase) -> ScrollRestorationPhaseStyle {
        switch phase {
        case .preparing:
            ScrollRestorationPhaseStyle(
                tone: .neutral,
                systemImage: "clock.arrow.circlepath",
                titleKey: "scrollRestoration.phase.preparing.title",
                titleFallback: "Preparing",
                descriptionKey: "scrollRestoration.phase.preparing.description",
                descriptionFallback: "Waiting for the first navigation."
            )
        case .restored:
            ScrollRestorationPhaseStyle(
                tone: .success,
                systemImage: "arrow.uturn.backward.circle.fill",
                titleKey: "scrollRestoration.phase.restored.title",
                titleFallback: "Position restored",
                descriptionKey: "scrollRestoration.phase.restored.description",
                descriptionFallback: "Returned to your last scroll position on this view."
            )
        case .freshTop:
            ScrollRestorationPhaseStyle(
                tone: .info,
                systemImage: "arrow.up.to.line",
                titleKey: "scrollRestoration.phase.freshTop.title",
                titleFallback: "Scrolled to top",
                descriptionKey: "scrollRestoration.phase.freshTop.description",
                descriptionFallback: "Opened a new view at the top."
            )
        case .noSavedTop:
            ScrollRestorationPhaseStyle(
                tone: .neutral,
                systemImage: "arrow.up.to.line.compact",
                titleKey: "scrollRestoration.phase.noSavedTop.title",
                titleFallback: "Top of view",
                descriptionKey: "scrollRestoration.phase.noSavedTop.description",
                descriptionFallback: "No saved position for this view yet."
            )
        case .unavailable:
            ScrollRestorationPhaseStyle(
                tone: .warning,
                systemImage: "externaldrive.badge.xmark",
                titleKey: "scrollRestoration.phase.unavailable.title",
                titleFallback: "Restoration unavailable",
                descriptionKey: "scrollRestoration.phase.unavailable.description",
                descriptionFallback: "Scroll positions can't be saved on this device."
            )
        }
    }
}

// MARK: - ScrollRestorationStatusChip (compact phase indicator)

/// A compact, tinted chip naming the current restoration phase — the leading glyph + the localized
/// title, in the phase's semantic tone. Token-driven (no raw hex), and exposed to VoiceOver as a single
/// combined element reading the phase title.
public struct ScrollRestorationStatusChip: View {
    private let phase: ScrollRestorationPhase

    public init(phase: ScrollRestorationPhase) {
        self.phase = phase
    }

    public var body: some View {
        let style = ScrollRestorationPhaseStyle.style(for: phase)
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: style.systemImage)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(style.tone.color)
            Text(verbatim: style.title)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(style.tone.color.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(style.tone.color.opacity(0.30), lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: style.title))
        .accessibilityAddTraits(.isStaticText)
    }
}

// MARK: - ScrollRestorationDegradedBanner (web private-mode / quota degrade)

/// The degraded banner shown when the session store cannot persist offsets — the visible counterpart of
/// the web `try/catch` branch where `sessionStorage` is unavailable (private mode, quota exceeded) and
/// restoration is silently lost. Token-driven warning chrome, combined into one VoiceOver announcement.
public struct ScrollRestorationDegradedBanner: View {
    public init() {}

    private var title: String {
        ScrollRestorationStrings.string(
            "scrollRestoration.degraded.title",
            "Scroll restoration is off"
        )
    }

    private var message: String {
        ScrollRestorationStrings.string(
            "scrollRestoration.degraded.message",
            "This device can't save scroll positions, so views always open at the top."
        )
    }

    public var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: title)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.statusWarning.opacity(0.10),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusWarning.opacity(0.30), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(title). \(message)"))
    }
}
