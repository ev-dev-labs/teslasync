//
//  OnboardingWizard.Views.swift
//  TeslaSync — P4 shared surface · 0131 · OnboardingWizard (Apple)
//
//  The presentational pieces of the first-run intro — the native peers of the web elements: the accent
//  resolver (the per-step hex → a P1/S9 semantic `Color`), the step-indicator row (the web dots, active
//  wider + glowing, `i <= currentStep` filled), the accent-tinted icon tile (the web rounded glyph plate),
//  the step content (icon + title + body), the action row (Skip + Next ▸ / Get Started), the ✕ close
//  control, and the glass card that assembles them. All chrome is token-driven (P1/S9); no raw hex, no
//  Tailwind ports. Reduce Motion gates the indicator + presentation animation.
//

import SwiftUI

// MARK: - Accent resolver (web per-step hex → P1/S9 token)

extension OnboardingWizardAccent {
    /// The P1/S9 color for this accent — the native peer of the web per-step hex. Resolved here at the view
    /// boundary so the Foundation-only core never references a `Color`.
    var color: Color {
        switch self {
        case .primary: Color.TS.accent
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .highlight: Color.TS.chartSeriesPower
        }
    }
}

// MARK: - Motion (web framer transitions, Reduce-Motion aware)

/// Builds the surface's animations — the native boundary that turns the web's transitions into token-driven
/// `Animation`s and returns `nil`/identity under Reduce Motion so the modal appears without movement.
public enum OnboardingWizardMotion {
    /// The present / dismiss animation, or `nil` when reduced motion is in effect.
    public static func presentation(reduce: Bool) -> Animation? {
        guard !reduce else { return nil }
        return .easeOut(duration: TSMotion.normalDuration)
    }

    /// The indicator width / glow animation, or `nil` under reduced motion (web `transition-all
    /// duration-normal`).
    public static func indicator(reduce: Bool) -> Animation? {
        guard !reduce else { return nil }
        return .easeInOut(duration: TSMotion.normalDuration)
    }

    /// The card entrance transition — a gentle scale + fade, collapsed to a plain fade under reduced motion.
    public static func cardTransition(reduce: Bool) -> AnyTransition {
        guard !reduce else { return .opacity }
        return .scale(scale: 0.96).combined(with: .opacity)
    }
}

// MARK: - Indicator row (web step-indicator dots)

/// The step-indicator row — the native peer of the web dots: a filled brand-accent capsule for every
/// `i <= currentStep`, a dim capsule otherwise, with the current dot (`i === currentStep`) widened and given
/// an accent glow. The whole row is one VoiceOver element announcing "Step N of M".
struct OnboardingWizardIndicatorRow: View {
    let indicators: [OnboardingWizardIndicator]
    let accent: Color
    let progressLabel: String
    let reduceMotion: Bool

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            ForEach(indicators) { dot in
                Capsule()
                    .fill(dot.isComplete ? accent : Color.TS.border)
                    .frame(width: dot.isActive ? 26 : 8, height: 6)
                    .shadow(
                        color: dot.isActive ? accent.opacity(0.45) : .clear,
                        radius: dot.isActive ? 5 : 0
                    )
                    .animation(OnboardingWizardMotion.indicator(reduce: reduceMotion), value: dot.isActive)
                    .animation(OnboardingWizardMotion.indicator(reduce: reduceMotion), value: dot.isComplete)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: progressLabel))
    }
}

// MARK: - Icon tile (web accent-tinted glyph plate)

/// The accent-tinted icon tile — the native peer of the web rounded plate (`background: ${color}15`, glow
/// `${color}10`) holding the step's SF Symbol. Decorative, so it is hidden from VoiceOver (the title + body
/// carry the meaning).
struct OnboardingWizardIconTile: View {
    let symbolName: String
    let accent: Color

    var body: some View {
        Image(systemName: symbolName)
            .font(.system(size: 30, weight: .semibold))
            .foregroundStyle(accent)
            .frame(width: 64, height: 64)
            .background(accent.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
            .shadow(color: accent.opacity(0.25), radius: 16)
            .accessibilityHidden(true)
    }
}

// MARK: - Step content (web icon + title + description)

/// The centered step content — the icon tile, the bold title (web `text-xl font-bold`), and the muted body
/// (web `text-sm ... leading-relaxed`). Combined into a single VoiceOver element so the step is announced as
/// one phrase. Text grows vertically with Dynamic Type rather than truncating.
struct OnboardingWizardStepContent: View {
    let projection: OnboardingWizardProjection

    var body: some View {
        VStack(spacing: TSSpacing.lg) {
            OnboardingWizardIconTile(symbolName: projection.symbolName, accent: projection.accent.color)
            VStack(spacing: TSSpacing.sm) {
                Text(verbatim: projection.title)
                    .font(Font.TS.title)
                    .foregroundStyle(Color.TS.textPrimary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                Text(verbatim: projection.body)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(projection.title). \(projection.body)"))
    }
}

// MARK: - Action row (web Skip + Next / Get Started)

/// The action row — the web `Skip` text button on the left and the gradient primary button on the right
/// (Next ▸ for a non-final step, Get Started on the last). Both carry explicit VoiceOver labels.
struct OnboardingWizardActions: View {
    let primaryAction: OnboardingWizardPrimaryAction
    let accent: Color
    let onSkip: () -> Void
    let onAdvance: () -> Void

    var body: some View {
        HStack {
            Button(action: onSkip) {
                Text(verbatim: OnboardingWizardStrings.skip)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.sm)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: OnboardingWizardStrings.skip))

            Spacer(minLength: TSSpacing.md)

            Button(action: onAdvance) {
                primaryLabel
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: OnboardingWizardStrings.primaryActionLabel(primaryAction)))
        }
    }

    private var primaryLabel: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: OnboardingWizardStrings.primaryActionLabel(primaryAction))
                .font(Font.TS.body)
                .fontWeight(.medium)
            if primaryAction == .advance {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .accessibilityHidden(true)
            }
        }
        .foregroundStyle(Color.TS.textPrimary)
        .padding(.horizontal, TSSpacing.xl)
        .padding(.vertical, TSSpacing.md)
        .background(primaryBackground, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(accent.opacity(0.4), lineWidth: 1)
        )
    }

    private var primaryBackground: LinearGradient {
        LinearGradient(
            colors: [accent.opacity(0.18), Color.TS.chartSeriesPower.opacity(0.18)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

// MARK: - Close control (web ✕)

/// The ✕ close control overlaid top-trailing — the web icon-only dismiss button. Esc-bound on macOS via the
/// cancel action so the keyboard mirrors the web `Escape` handler; carries an explicit VoiceOver label.
struct OnboardingWizardCloseButton: View {
    let onClose: () -> Void

    var body: some View {
        Button(action: onClose) {
            Image(systemName: "xmark")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .padding(TSSpacing.sm)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .keyboardShortcut(.cancelAction)
        .accessibilityLabel(Text(verbatim: OnboardingWizardStrings.close))
        .accessibilityHint(Text(verbatim: OnboardingWizardStrings.dismissHint))
    }
}

// MARK: - Card (web glass modal)

/// The glass modal card — the native peer of the web bordered, blurred panel. Assembles the indicator row,
/// the step content, and the action row, with the ✕ overlaid top-trailing. Token-driven glass: a
/// `.ultraThinMaterial` base tinted by `Color.TS.surface`, a `TSRadius.lg` corner, and a `Color.TS.border`
/// hairline.
struct OnboardingWizardCard: View {
    let model: OnboardingWizardModel
    let reduceMotion: Bool

    private var projection: OnboardingWizardProjection {
        model.projection
    }

    var body: some View {
        VStack(spacing: TSSpacing.x2xl) {
            OnboardingWizardIndicatorRow(
                indicators: projection.indicators,
                accent: projection.accent.color,
                progressLabel: projection.progressLabel,
                reduceMotion: reduceMotion
            )
            OnboardingWizardStepContent(projection: projection)
            OnboardingWizardActions(
                primaryAction: projection.primaryAction,
                accent: projection.accent.color,
                onSkip: { model.skip() },
                onAdvance: { model.next() }
            )
        }
        .padding(TSSpacing.x2xl)
        .frame(maxWidth: 420)
        .background(cardBackground)
        .overlay(alignment: .topTrailing) {
            OnboardingWizardCloseButton(onClose: { model.skip() })
                .padding(TSSpacing.sm)
        }
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: OnboardingWizardStrings.dialogLabel))
        .accessibilityAddTraits(.isModal)
    }

    private var cardBackground: some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surface.opacity(0.85))
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.5), radius: 30, y: 18)
    }
}

// MARK: - Backdrop (web blurred scrim, tap to dismiss)

/// The blurred backdrop behind the card — the native peer of the web `backdrop-blur-sm` overlay. A tap
/// dismisses the intro (web backdrop `onClick={handleClose}`); it is exposed to VoiceOver as a labelled
/// dismiss affordance so assistive users are not left with an unlabelled full-screen control.
struct OnboardingWizardBackdrop: View {
    let onDismiss: () -> Void

    var body: some View {
        Rectangle()
            .fill(.ultraThinMaterial)
            .ignoresSafeArea()
            .contentShape(Rectangle())
            .onTapGesture { onDismiss() }
            .accessibilityLabel(Text(verbatim: OnboardingWizardStrings.close))
            .accessibilityHint(Text(verbatim: OnboardingWizardStrings.dismissHint))
            .accessibilityAddTraits(.isButton)
    }
}
