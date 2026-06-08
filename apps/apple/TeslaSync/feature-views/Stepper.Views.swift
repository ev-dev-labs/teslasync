//
//  Stepper.Views.swift
//  TeslaSync — P4 feature view · 0195 · OnboardingStepper (Apple)
//
//  The presentational core composed by the surface: the indicator circle (web
//  `<Check/>` / `<Loader2 animate-spin/>` / numeric `<span>`), the connector
//  line, the step row (title + description + while-current CTA), and the P4
//  states-contract chrome the web leaf delegates to its parent — the loading
//  skeleton, the never-a-blank-box empty state, the query-error retry, and the
//  stale/offline status chips. All consume the P1/S10 facade + shared P1/S9
//  tokens (Color.TS / Font.TS / TSSpacing / TSRadius) and the shared P4
//  components (`TSButton`, `TSSkeleton`) — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Tone → token mapping

/// Maps the projection's SwiftUI-free tone to the design-system color (web
/// emerald = success, cyan = accent, neutral = muted).
extension StepperTone {
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .accent: Color.TS.accent
        case .muted: Color.TS.textMuted
        }
    }
}

// MARK: - Indicator circle (web `flex h-9 w-9 ... rounded-full border`)

/// The leading 36×36 circle: a green check (done), a working spinner (current),
/// or the 1-based index (pending), tinted by tone (fill 0.2 / stroke 0.5, the
/// exact web `bg-{c}/20 border-{c}/50` scale). Decorative — the spoken state
/// lives on the row summary, so the circle is hidden from VoiceOver (web
/// `aria-hidden`). The spinner collapses to a static glyph under Reduce Motion.
struct StepperIndicatorView: View {
    let kind: StepperIndicatorKind
    let tone: StepperTone
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let diameter: CGFloat = 36

    var body: some View {
        ZStack {
            Circle()
                .fill(tone.color.opacity(0.2))
                .overlay(Circle().strokeBorder(tone.color.opacity(0.5), lineWidth: 1))
            glyph
        }
        .frame(width: diameter, height: diameter)
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private var glyph: some View {
        switch kind {
        case .check:
            Image(systemName: "checkmark")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(tone.color)
        case .spinner:
            if reduceMotion {
                Image(systemName: "circle.dashed")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(tone.color)
            } else {
                ProgressView()
                    .controlSize(.small)
                    .tint(tone.color)
            }
        case let .number(value):
            Text(verbatim: "\(value)")
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(tone.color)
        }
    }
}

// MARK: - Connector (web `mt-1 w-px flex-1 min-h-[28px]`)

/// The vertical line under a non-last row. Green (web emerald/40) when the row
/// is done, the muted surface line otherwise. Purely decorative.
struct StepperConnectorView: View {
    let isComplete: Bool

    var body: some View {
        Rectangle()
            .fill(isComplete ? Color.TS.statusSuccess.opacity(0.4) : Color.TS.border)
            .frame(width: 1)
            .frame(minHeight: 28, maxHeight: .infinity)
            .padding(.top, TSSpacing.xs)
            .accessibilityHidden(true)
    }
}

// MARK: - Step row (web `<li className="flex gap-4">`)

/// One onboarding step: the indicator column (circle + connector) beside the
/// title, description, and — only while current — the CTA. The title/description
/// are combined into a single VoiceOver element carrying the full summary
/// (title, "Step N of M", state, description); the CTA stays a separate focus
/// stop so it remains actionable.
struct StepperRowView: View {
    let row: StepperRow
    let onActivate: (StepperRow) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            VStack(spacing: 0) {
                StepperIndicatorView(kind: row.indicator, tone: row.tone)
                if !row.isLast {
                    StepperConnectorView(isComplete: row.connectorIsComplete)
                }
            }

            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: row.title)
                    .font(Font.TS.panel)
                    .foregroundStyle(titleColor)
                Text(verbatim: row.description)
                    .font(Font.TS.body)
                    .foregroundStyle(descriptionColor)
                    .fixedSize(horizontal: false, vertical: true)
                if row.showsCTA, let cta = row.cta {
                    StepperCTAButton(cta: cta) { onActivate(row) }
                        .padding(.top, TSSpacing.sm)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: row.showsCTA ? .contain : .ignore)
            .accessibilityLabel(Text(verbatim: summary))
        }
        .accessibilityElement(children: .contain)
    }

    private var titleColor: Color {
        row.state == .pending ? Color.TS.textSecondary : Color.TS.textPrimary
    }

    private var descriptionColor: Color {
        row.state == .pending ? Color.TS.textMuted : Color.TS.textSecondary
    }

    private var summary: String {
        let positionClause = StepperAccessibility.position(
            format: StepperCopy.positionFormat.resolved(StepperStrings.string),
            position: row.position,
            total: row.total
        )
        return StepperAccessibility.stepSummary(
            title: row.title,
            position: positionClause,
            stateWord: StepperCopy.stateWord(for: row.state).resolved(StepperStrings.string),
            description: row.description
        )
    }
}

// MARK: - CTA (web `<Button variant="primary" size="sm" icon={<ArrowRight/>}>`)

/// The while-current call-to-action: the shared primary `TSButton` with a
/// leading forward arrow (the web `Button` renders its `icon` before the
/// children), disabled per `cta.isDisabled`. Its label is the step's localized
/// CTA text and doubles as the VoiceOver label.
struct StepperCTAButton: View {
    let cta: StepperStepCTA
    let action: () -> Void

    var body: some View {
        TSButton(variant: .primary, size: .small, action: action) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "arrow.right")
                    .font(.system(size: 11, weight: .semibold))
                    .accessibilityHidden(true)
                Text(verbatim: cta.label)
            }
        }
        .disabled(cta.isDisabled)
        .accessibilityLabel(Text(verbatim: cta.label))
    }
}

// MARK: - List (web `<ol aria-label="Onboarding steps" className="flex flex-col gap-6">`)

/// The ordered list of step rows. Carries the web `aria-label` as the group's
/// VoiceOver label and contains its rows for navigation.
struct StepperListView: View {
    let rows: [StepperRow]
    let onActivate: (StepperRow) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            ForEach(rows) { row in
                StepperRowView(row: row, onActivate: onActivate)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: StepperCopy.listLabel.resolved(StepperStrings.string)))
    }
}

// MARK: - Loading chrome (P4 states contract)

/// The initial step-derivation load: redacted indicator + text rows over the
/// shared `TSSkeleton`, never a frozen/blank panel.
struct StepperLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            ForEach(0 ..< 3, id: \.self) { _ in
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    TSSkeleton(width: 36, height: 36, cornerRadius: TSRadius.pill)
                    VStack(alignment: .leading, spacing: TSSpacing.sm) {
                        TSSkeleton(width: 160, height: 14)
                        TSSkeleton(height: 12)
                    }
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: StepperCopy.loading.resolved(StepperStrings.string)))
    }
}

// MARK: - Empty state (native treatment of an onboarding flow with no steps)

/// The "nothing left to configure" outcome — a friendly `ContentUnavailableView`
/// (the primitive the shared empty state wraps) so the panel is never blank.
struct StepperEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: StepperCopy.emptyTitle.resolved(StepperStrings.string))
            } icon: {
                Image(systemName: "checkmark.seal")
            }
        } description: {
            Text(verbatim: StepperCopy.emptyMessage.resolved(StepperStrings.string))
        }
        .accessibilityLabel(Text(verbatim: emptyA11y))
    }

    private var emptyA11y: String {
        let title = StepperCopy.emptyTitle.resolved(StepperStrings.string)
        let message = StepperCopy.emptyMessage.resolved(StepperStrings.string)
        return "\(title). \(message)"
    }
}

// MARK: - Error chrome (web `QueryError` equivalent — parent query failure)

/// The step-derivation failure branch: a danger glyph, the localized message,
/// and a retry control wired to the bound source's `refresh`.
struct StepperErrorView: View {
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: StepperCopy.errorMessage.resolved(StepperStrings.string))
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
            StepperRetryButton(action: onRetry)
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .contain)
    }
}

/// The native retry control (states-contract affordance, wired to `refresh`).
struct StepperRetryButton: View {
    let action: () -> Void

    var body: some View {
        let label = StepperCopy.retry.resolved(StepperStrings.string)
        return Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11, weight: .semibold))
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.accent.opacity(0.16), in: Capsule())
            .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Status chips (P4 stale + offline chrome)

/// A tinted status chip mirroring `TSBadge` (capsule, tone fill 0.15 + stroke
/// 0.3) but resolving its label through the per-surface facade. Used for the
/// stale + offline banners the web leaf has no notion of.
struct StepperStatusChip: View {
    let copy: StepperText
    let tone: StepperTone
    let systemImage: String

    var body: some View {
        let label = copy.resolved(StepperStrings.string)
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage)
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityLabel(Text(verbatim: label))
    }
}
