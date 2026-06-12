//
//  StatusBar.Segments.swift
//  TeslaSync — P4 shared surface · 0182 · StatusBar (Apple)
//
//  The presentational segments that pair a tone with an SF Symbol (color is never the sole encoder) — the
//  native parity of the web `ConnectionSegment`, `LiveTelemetrySegment`, and `HelpSegment`. The vehicle +
//  background popovers live in StatusBar.Popovers.swift; the version segment + About sheet in
//  StatusBar.Version.swift. Every segment renders the resolved view model and never recomputes logic; all
//  copy is pre-localized (P1/S10), all color comes from P1/S9 tokens, and each interactive element carries a
//  VoiceOver label + a `help` tooltip (the native peer of the web `<Tooltip>`).
//

import SwiftUI

// MARK: - Tone → token color (P1/S9)

extension StatusBarTone {
    /// The design-token color for this tone — the native peer of the web `emerald` / `amber` / `rose` /
    /// muted classes. Resolved from the semantic status tokens so light theme + high contrast track.
    var color: Color {
        switch self {
        case .positive: Color.TS.statusSuccess
        case .caution: Color.TS.statusWarning
        case .critical: Color.TS.statusDanger
        case .neutral: Color.TS.textMuted
        }
    }
}

// MARK: - Connection (web ConnectionSegment)

/// The API-connection segment — a status dot + an SF Symbol + the "API" label, the latency chip, and the
/// offline suffix. Tapping opens the system-status route (web `<Link to="/system-status">`).
public struct StatusBarConnectionView: View {
    private let vm: StatusBarConnectionVM
    private let iconOnly: Bool
    private let onOpen: () -> Void

    public init(vm: StatusBarConnectionVM, iconOnly: Bool, onOpen: @escaping () -> Void) {
        self.vm = vm
        self.iconOnly = iconOnly
        self.onOpen = onOpen
    }

    public var body: some View {
        Button(action: onOpen) {
            HStack(spacing: TSSpacing.xs) {
                Circle()
                    .fill(vm.tone.color)
                    .frame(width: 6, height: 6)
                    .accessibilityHidden(true)
                Image(systemName: vm.symbol)
                    .font(Font.TS.caption)
                    .foregroundStyle(vm.tone.color)
                    .accessibilityHidden(true)
                if !iconOnly {
                    Text(verbatim: vm.shortLabel)
                        .font(Font.TS.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(vm.tone.color)
                    if vm.showsLatency, let latency = vm.latencyText {
                        StatusBarMutedSuffix(text: latency)
                    }
                    if let offline = vm.offlineSuffix {
                        StatusBarMutedSuffix(text: offline)
                    }
                }
            }
            .padding(.horizontal, TSSpacing.xs)
            .padding(.vertical, 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(vm.tooltip)
        .accessibilityLabel(Text(verbatim: vm.accessibilityLabel))
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - Live telemetry (web LiveTelemetrySegment)

/// The live-telemetry segment — a status dot + an SF Symbol (spinning while reconnecting, Reduce-Motion
/// aware) + the "Live" label and the periodic last-message age. Tapping opens the live signal explorer.
public struct StatusBarLiveView: View {
    private let vm: StatusBarLiveVM
    private let iconOnly: Bool
    private let reduceMotion: Bool
    private let onOpen: () -> Void

    public init(vm: StatusBarLiveVM, iconOnly: Bool, reduceMotion: Bool, onOpen: @escaping () -> Void) {
        self.vm = vm
        self.iconOnly = iconOnly
        self.reduceMotion = reduceMotion
        self.onOpen = onOpen
    }

    public var body: some View {
        Button(action: onOpen) {
            HStack(spacing: TSSpacing.xs) {
                Circle()
                    .fill(vm.tone.color)
                    .frame(width: 6, height: 6)
                    .accessibilityHidden(true)
                StatusBarSpinningSymbol(systemName: vm.symbol, spinning: vm.spins, reduceMotion: reduceMotion)
                    .font(Font.TS.caption)
                    .foregroundStyle(vm.tone.color)
                if !iconOnly {
                    Text(verbatim: vm.shortLabel)
                        .font(Font.TS.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(vm.tone.color)
                    if let age = vm.ageText {
                        StatusBarMutedSuffix(text: age)
                    }
                }
            }
            .padding(.horizontal, TSSpacing.xs)
            .padding(.vertical, 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(vm.tooltip)
        .accessibilityLabel(Text(verbatim: vm.accessibilityLabel))
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - Help (web HelpSegment)

/// The help segment — keyboard-shortcuts / take-a-tour / report-bug actions. Each is an icon-led button with
/// a tooltip; the expanded variant adds the `?` key cap (shortcuts) and the action labels (tour / feedback).
public struct StatusBarHelpView: View {
    private let vm: StatusBarHelpVM
    private let iconOnly: Bool
    private let onShortcuts: () -> Void
    private let onTour: () -> Void
    private let onFeedback: () -> Void

    public init(
        vm: StatusBarHelpVM,
        iconOnly: Bool,
        onShortcuts: @escaping () -> Void,
        onTour: @escaping () -> Void,
        onFeedback: @escaping () -> Void
    ) {
        self.vm = vm
        self.iconOnly = iconOnly
        self.onShortcuts = onShortcuts
        self.onTour = onTour
        self.onFeedback = onFeedback
    }

    public var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Button(action: onShortcuts) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "keyboard").font(Font.TS.caption).accessibilityHidden(true)
                    if !iconOnly { StatusBarKeyCap(text: vm.shortcutKeyCap) }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .help(vm.shortcuts.tooltip)
            .accessibilityLabel(Text(verbatim: vm.shortcuts.accessibilityLabel))

            StatusBarHelpButton(
                systemName: "questionmark.circle",
                action: onTour,
                iconOnly: iconOnly,
                label: vm.tour.label,
                tooltip: vm.tour.tooltip,
                accessibilityLabel: vm.tour.accessibilityLabel
            )
            StatusBarHelpButton(
                systemName: "ladybug",
                action: onFeedback,
                iconOnly: iconOnly,
                label: vm.feedback.label,
                tooltip: vm.feedback.tooltip,
                accessibilityLabel: vm.feedback.accessibilityLabel
            )
        }
    }
}

/// One icon-led help button with an optional expanded label — the tour / feedback affordances.
public struct StatusBarHelpButton: View {
    let systemName: String
    let action: () -> Void
    let iconOnly: Bool
    let label: String
    let tooltip: String
    let accessibilityLabel: String

    public var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: systemName).font(Font.TS.caption).accessibilityHidden(true)
                if !iconOnly {
                    Text(verbatim: label).font(Font.TS.caption)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .help(tooltip)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }
}

// MARK: - Small shared chrome

/// A muted "· value" suffix — the native peer of the web `· {latency}` / `· {age}` muted spans.
public struct StatusBarMutedSuffix: View {
    let text: String

    public var body: some View {
        Text(verbatim: "· \(text)")
            .font(Font.TS.caption)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textMuted)
    }
}

/// The `?` keyboard key cap — web `<kbd>`.
public struct StatusBarKeyCap: View {
    let text: String

    public var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .padding(.horizontal, TSSpacing.xs)
            .background(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .fill(Color.TS.textPrimary.opacity(0.08))
            )
            .accessibilityHidden(true)
    }
}
