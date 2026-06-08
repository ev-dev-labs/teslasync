//
//  LiveControls.Views.swift
//  TeslaSync — P4 feature view · 0233 · LiveControls (Apple)
//
//  The presentational core composed by the surface: the toolbar panel (web
//  `rounded-lg border … px-3 py-2`), the Live/Freeze toggles (web variant + the
//  pulsing status dot), the step-previous / step-next ghost buttons, the divider,
//  the Window menu picker (web `<Select>`), the Clear button, the right-aligned
//  buffer counter (web `Tooltip`-wrapped `Caption`), and the P4 states-contract
//  chrome the web leaf delegates to its parent — the loading skeleton, the
//  query-error retry, and the stale/offline status chips. All consume the P1/S10
//  facade + shared P1/S9 tokens (Color.TS / Font.TS / TSSpacing / TSRadius) and the
//  shared P4 components (`TSButton`, `TSSkeleton`) — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Tone → token mapping

/// Maps the projection's SwiftUI-free tone to the design-system color (web
/// emerald-300 = live, neutral = muted, cyan = accent).
extension LiveControlsTone {
    var color: Color {
        switch self {
        case .live: Color.TS.statusSuccess
        case .muted: Color.TS.textMuted
        case .accent: Color.TS.accent
        }
    }
}

// MARK: - Panel chrome (web `rounded-lg border … bg-white/[0.02] px-3 py-2`)

/// The bordered glass panel every branch of the surface renders inside, so the
/// toolbar keeps a consistent shape across loading / ready / error.
struct LiveControlsPanel<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        content()
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}

// MARK: - Status dot (web `h-2 w-2 rounded-full … animate-pulse`)

/// The Live button's leading dot: an emerald pulse while streaming, a muted dot
/// when frozen. Decorative — the Live/Freeze state is spoken via the button's
/// selected trait — and the pulse collapses to a steady dot under Reduce Motion.
struct LiveControlsStatusDot: View {
    let isOn: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        Circle()
            .fill((isOn ? LiveControlsTone.live : LiveControlsTone.muted).color)
            .frame(width: 8, height: 8)
            .opacity(isOn && !reduceMotion && pulse ? 0.35 : 1)
            .onAppear {
                guard isOn, !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { pulse = true }
            }
            .accessibilityHidden(true)
    }
}

// MARK: - Toggle button (web Live / Freeze `<Button>`)

/// A Live or Freeze toggle: the shared `TSButton` (primary while its mode is active,
/// secondary otherwise), with the optional pulsing dot on the Live button. The
/// active button reads as a selected trait for VoiceOver (web `aria-pressed`).
struct LiveControlsToggleButton: View {
    let title: String
    let isActive: Bool
    let showsLiveDot: Bool
    let isLiveOn: Bool
    let action: () -> Void

    var body: some View {
        TSButton(variant: isActive ? .primary : .secondary, size: .small, action: action) {
            HStack(spacing: TSSpacing.xs) {
                if showsLiveDot {
                    LiveControlsStatusDot(isOn: isLiveOn)
                }
                Text(verbatim: title)
            }
        }
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }
}

// MARK: - Step button (web ← / → ghost `<Button>`)

/// The direction a step button advances the buffer cursor (web ← / →).
enum LiveControlsStepDirection {
    case previous
    case next

    var systemImage: String {
        switch self {
        case .previous: "arrow.left"
        case .next: "arrow.right"
        }
    }
}

/// A step-previous / step-next ghost button: an SF Symbol arrow (the HIG-native
/// form of the web ← / → glyphs), disabled per `canStep…`, carrying the web
/// `aria-label` as its VoiceOver label.
struct LiveControlsStepButton: View {
    let direction: LiveControlsStepDirection
    let label: String
    let isEnabled: Bool
    let action: () -> Void

    var body: some View {
        TSButton(variant: .ghost, size: .small, action: action) {
            Image(systemName: direction.systemImage)
                .font(.system(size: 13, weight: .semibold))
        }
        .disabled(!isEnabled)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Divider (web `h-5 w-px bg-[var(--surface-2)]`)

/// The 1×20 vertical separator between control groups. Purely decorative.
struct LiveControlsDivider: View {
    var body: some View {
        Rectangle()
            .fill(LiveControlsTone.muted.color.opacity(0.4))
            .frame(width: 1, height: 20)
            .accessibilityHidden(true)
    }
}

// MARK: - Window picker (web `<Select>` → native menu Picker)

/// The Window dropdown — a native `Menu` (the primitive `TSSelect` wraps),
/// resolving each option label through the per-surface facade. The trigger shows
/// the active window; the open menu checkmarks the current value. Carries the web
/// `aria-label` ("Window") + the current value for VoiceOver.
struct LiveControlsWindowPicker: View {
    let options: [LiveControlsWindowOption]
    let selectedMinutes: Int
    let onSelect: (Int) -> Void

    private var windowLabel: String {
        LiveControlsCopy.window.resolved(LiveControlsStrings.string)
    }

    private var currentLabel: String {
        let match = options.first { $0.minutes == selectedMinutes }
        return (match?.label ?? LiveControlsCopy.window).resolved(LiveControlsStrings.string)
    }

    var body: some View {
        Menu {
            ForEach(options) { option in
                Button { onSelect(option.minutes) } label: {
                    optionLabel(
                        option.label.resolved(LiveControlsStrings.string),
                        selected: option.minutes == selectedMinutes
                    )
                }
            }
        } label: {
            trigger
        }
        .accessibilityLabel(Text(verbatim: windowLabel))
        .accessibilityValue(Text(verbatim: currentLabel))
    }

    private var trigger: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: currentLabel)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            Image(systemName: "chevron.up.chevron.down")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .frame(minWidth: 72, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }

    @ViewBuilder
    private func optionLabel(_ title: String, selected: Bool) -> some View {
        if selected {
            Label(title, systemImage: "checkmark")
        } else {
            Text(verbatim: title)
        }
    }
}

// MARK: - Counter (web `Tooltip`-wrapped `Caption`)

/// The right-aligned buffer counter: the single- or dual-scope label (or the
/// friendly empty hint when nothing is buffered), with the scope explanation
/// attached as the macOS hover tooltip (web `Tooltip`) and the VoiceOver hint.
struct LiveControlsCounterView: View {
    let counter: LiveControlsCounter
    let windowMinutes: Int

    private var label: String {
        LiveControlsFormat.counterLabel(
            counter: counter,
            single: LiveControlsCopy.buffered.resolved(LiveControlsStrings.string),
            dual: LiveControlsCopy.bufferedDual.resolved(LiveControlsStrings.string)
        )
    }

    private var emptyLabel: String {
        LiveControlsCopy.empty.resolved(LiveControlsStrings.string)
    }

    private var tooltip: String {
        LiveControlsFormat.tooltipLabel(
            format: LiveControlsCopy.bufferedTooltip.resolved(LiveControlsStrings.string),
            minutes: windowMinutes,
            outside: counter.outside
        )
    }

    var body: some View {
        Text(verbatim: counter.isEmpty ? emptyLabel : label)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .monospacedDigit()
            .lineLimit(1)
            .help(Text(verbatim: tooltip))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: counter.isEmpty ? emptyLabel : label))
            .accessibilityHint(Text(verbatim: tooltip))
    }
}

// MARK: - Toolbar (web container — the populated `ready` branch)

/// The populated toolbar: the Live/Freeze toggles, the step buttons, the Window
/// picker, Clear buffer, and the trailing counter. Adapts between a single row
/// (counter pushed trailing, web `ml-auto`) and a compact two-row layout (scrolling
/// controls + trailing counter) via `ViewThatFits`, so nothing clips under large
/// Dynamic Type or narrow widths.
struct LiveControlsToolbar: View {
    let projection: LiveControlsProjection
    let onToggleLive: (Bool) -> Void
    let onStepPrev: () -> Void
    let onStepNext: () -> Void
    let onWindowChange: (Int) -> Void
    let onClearBuffer: () -> Void

    var body: some View {
        LiveControlsPanel {
            ViewThatFits(in: .horizontal) {
                singleRow
                twoRow
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: LiveControlsCopy.toolbarLabel.resolved(LiveControlsStrings.string)))
    }

    private var singleRow: some View {
        HStack(spacing: TSSpacing.sm) {
            controls
            Spacer(minLength: TSSpacing.sm)
            counter
        }
    }

    private var twoRow: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ScrollView(.horizontal, showsIndicators: false) {
                controls.padding(.vertical, 1)
            }
            HStack(spacing: 0) {
                Spacer(minLength: 0)
                counter
            }
        }
    }

    private var controls: some View {
        HStack(spacing: TSSpacing.sm) {
            LiveControlsToggleButton(
                title: LiveControlsCopy.live.resolved(LiveControlsStrings.string),
                isActive: projection.isLive,
                showsLiveDot: true,
                isLiveOn: projection.isLive,
                action: { onToggleLive(true) }
            )
            LiveControlsToggleButton(
                title: LiveControlsCopy.freeze.resolved(LiveControlsStrings.string),
                isActive: !projection.isLive,
                showsLiveDot: false,
                isLiveOn: false,
                action: { onToggleLive(false) }
            )
            LiveControlsDivider()
            LiveControlsStepButton(
                direction: .previous,
                label: LiveControlsCopy.stepPrev.resolved(LiveControlsStrings.string),
                isEnabled: projection.canStepPrev,
                action: onStepPrev
            )
            LiveControlsStepButton(
                direction: .next,
                label: LiveControlsCopy.stepNext.resolved(LiveControlsStrings.string),
                isEnabled: projection.canStepNext,
                action: onStepNext
            )
            LiveControlsDivider()
            Text(verbatim: LiveControlsCopy.window.resolved(LiveControlsStrings.string))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            LiveControlsWindowPicker(
                options: projection.options,
                selectedMinutes: projection.windowMinutes,
                onSelect: onWindowChange
            )
            TSButton(variant: .ghost, size: .small, action: onClearBuffer) {
                Text(verbatim: LiveControlsCopy.clear.resolved(LiveControlsStrings.string))
            }
        }
    }

    private var counter: some View {
        LiveControlsCounterView(counter: projection.counter, windowMinutes: projection.windowMinutes)
    }
}
