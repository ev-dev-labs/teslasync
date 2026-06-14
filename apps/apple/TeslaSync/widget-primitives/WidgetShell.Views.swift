//
//  WidgetShell.Views.swift
//  TeslaSync — P4 widget primitive · 0013 · WidgetShell (Apple)
//
//  The presentational chrome pieces composed by the WidgetShell surface — the native peers of the web
//  building blocks the shell pulls in:
//    • WidgetShellFreshnessChip — the native port of `@/components/data-display` `DataFreshness`
//      (four-state dot + icon + relative-time label, compact dot-only variant, manual refresh).
//    • WidgetShellHelpButton    — the native port of `@/components/ui` `HelpTooltip` driven by the
//      `WidgetHelp` metadata (resolved text + optional "Learn more" link).
//    • WidgetShellPinButton     — the native port of `@/components/ui` `PinButton` (pin/unpin toggle).
//  All chrome is token-driven (P1/S9); no raw hex, no Tailwind ports. Animations honor Reduce Motion.
//

import SwiftUI

// MARK: - WidgetShellFreshnessStatus → design tokens (SwiftUI projection of the pure model)

extension WidgetShellFreshnessStatus {
    /// The chip tint — the theme-aware projection of the web `FRESHNESS_COLORS`
    /// (`fresh→emerald, fetching→sky, stale→amber, error→red`) onto the semantic status tokens.
    var tone: TSTone {
        switch self {
        case .fresh: .success
        case .fetching: .info
        case .stale: .warning
        case .error: .danger
        }
    }

    /// SF Symbol for the status — the native peer of the web lucide glyphs
    /// (`fresh/stale → Wifi`, `fetching → RefreshCw`, `error → WifiOff`).
    var symbolName: String {
        switch self {
        case .fresh, .stale: "wifi"
        case .fetching: "arrow.triangle.2.circlepath"
        case .error: "wifi.slash"
        }
    }
}

// MARK: - Data freshness chip (web `DataFreshness`)

/// Query-result-driven freshness chip: a status dot + SF Symbol + relative-time label that surfaces
/// the health of a data fetch in a widget header. The native parity of the web `DataFreshness` —
/// same four states (`fresh / fetching / stale / error`), same compact (dot-only) variant for
/// title-less widgets, and the same optional manual-refresh affordance. The relative-time label is
/// recomputed on a 30 s cadence (web `setInterval(…, 30_000)`) via `TimelineView`.
struct WidgetShellFreshnessChip: View {
    let updatedAtMillis: Double?
    let isFetching: Bool
    let isStale: Bool
    let isError: Bool
    let compact: Bool
    let onRefresh: (@MainActor () -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var status: WidgetShellFreshnessStatus {
        .resolve(isError: isError, isFetching: isFetching, isStale: isStale)
    }

    var body: some View {
        // Re-render every 30 s so the relative-time label stays accurate (web 30 s tick).
        TimelineView(.periodic(from: .now, by: 30)) { context in
            chip(now: context.date)
        }
    }

    @ViewBuilder private func chip(now: Date) -> some View {
        let label = WidgetShellFreshnessLabel.resolve(
            updatedAtMillis: updatedAtMillis,
            isFetching: isFetching,
            isError: isError,
            nowMillis: now.timeIntervalSince1970 * 1000
        )

        let row = HStack(spacing: compact ? 2 : TSSpacing.xs) {
            WidgetShellFreshnessDot(tone: status.tone, isAnimating: status == .fetching)
            WidgetShellFreshnessIcon(systemName: status.symbolName, isSpinning: status == .fetching, compact: compact)
            if !compact {
                // Reserve a stable width so the label changing never reflows neighbouring header
                // items (web `min-w-[4.5rem] tabular-nums`).
                Text(verbatim: labelText(label))
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .lineLimit(1)
                    .frame(minWidth: 64, alignment: .leading)
            }
        }
        .foregroundStyle(status.tone.color.opacity(0.85))

        Group {
            if let onRefresh {
                Button {
                    // Web: `if (onRefresh && !isFetching) onRefresh()`.
                    if !isFetching { onRefresh() }
                } label: {
                    row
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: WidgetShellStrings.string("freshness.refresh", "Refresh")))
            } else {
                row
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text(verbatim: accessibilityStatusLabel))
            }
        }
        .help(Text(verbatim: helpTooltip))
    }

    // MARK: Label resolution (P1/S10)

    private func labelText(_ label: WidgetShellFreshnessLabel) -> String {
        switch label {
        case let .relative(bucket): relativeText(bucket)
        case .updating: WidgetShellStrings.string("freshness.updating", "updating…")
        case .error: WidgetShellStrings.string("freshness.error", "error")
        case .none: ""
        }
    }

    private func relativeText(_ bucket: WidgetShellRelativeTimeBucket) -> String {
        switch bucket {
        case .justNow:
            WidgetShellStrings.string("freshness.justNow", "just now")
        case let .minutes(value):
            String(format: WidgetShellStrings.string("freshness.minutes", "%lldm ago"), value)
        case let .hours(value):
            String(format: WidgetShellStrings.string("freshness.hours", "%lldh ago"), value)
        case let .days(value):
            String(format: WidgetShellStrings.string("freshness.days", "%lldd ago"), value)
        case let .weeks(value):
            String(format: WidgetShellStrings.string("freshness.weeks", "%lldw ago"), value)
        }
    }

    private var accessibilityStatusLabel: String {
        WidgetShellAccessibility.dataFreshnessLabel(
            format: WidgetShellStrings.string("a11y.dataFreshness", "Data freshness: %@"),
            status: WidgetShellStrings.string(status.localizationKey, status.rawValue)
        )
    }

    /// Hover/long-press tooltip (web `title=`): "Updating…" under Reduce Motion while fetching,
    /// else the absolute last-updated time, else "Never updated".
    private var helpTooltip: String {
        if isFetching, reduceMotion {
            return WidgetShellStrings.string("freshness.updatingTooltip", "Updating…")
        }
        if let updatedAtMillis, updatedAtMillis > 0 {
            let time = Date(timeIntervalSince1970: updatedAtMillis / 1000)
                .formatted(date: .omitted, time: .shortened)
            return String(format: WidgetShellStrings.string("freshness.lastUpdated", "Last updated: %@"), time)
        }
        return WidgetShellStrings.string("freshness.neverUpdated", "Never updated")
    }
}

// MARK: - Freshness dot + icon (animated, Reduce-Motion-aware)

/// The status dot with a gentle "ping" ring while fetching (web `animate-ping`). The ring is only
/// visible during fetch and is fully suppressed under Reduce Motion.
private struct WidgetShellFreshnessDot: View {
    let tone: TSTone
    let isAnimating: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var ping = false

    var body: some View {
        ZStack {
            Circle()
                .fill(tone.color)
                .frame(width: 6, height: 6)
                .scaleEffect(ping ? 2.2 : 1)
                .opacity(isAnimating && !reduceMotion ? (ping ? 0 : 0.4) : 0)
            Circle()
                .fill(tone.color)
                .frame(width: 6, height: 6)
        }
        .frame(width: 6, height: 6)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeOut(duration: 1).repeatForever(autoreverses: false)) {
                ping = true
            }
        }
        .accessibilityHidden(true)
    }
}

/// The status SF Symbol, spinning while fetching (web `animate-spin` on the RefreshCw icon).
private struct WidgetShellFreshnessIcon: View {
    let systemName: String
    let isSpinning: Bool
    let compact: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var angle: Double = 0

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: compact ? 8 : 10, weight: .semibold))
            .rotationEffect(.degrees(isSpinning && !reduceMotion ? angle : 0))
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 1).repeatForever(autoreverses: false)) {
                    angle = 360
                }
            }
            .accessibilityHidden(true)
    }
}

// MARK: - Contextual help (web `HelpTooltip` driven by `WidgetHelp`)

/// A compact "?" trigger that reveals the widget's help text (and an optional "Learn more" link) in a
/// popover — the native port of the web `HelpTooltip`, fed by the `WidgetHelp` metadata. Renders
/// nothing when the help text resolves empty (web `if (!resolved) return null`).
struct WidgetShellHelpButton: View {
    let title: String
    let help: WidgetHelp

    @State private var isShowing = false

    var body: some View {
        if let resolved = help.resolvedText(localize: WidgetShellStrings.string) {
            Button {
                isShowing.toggle()
            } label: {
                Image(systemName: "questionmark.circle")
                    .font(.system(size: 11, weight: .regular))
                    .foregroundStyle(Color.TS.textMuted)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: WidgetShellAccessibility.helpLabel(
                format: WidgetShellStrings.string("widget.shell.help.ariaLabel", "More info about %@"),
                title: title
            )))
            .popover(isPresented: $isShowing) {
                helpBody(resolved)
            }
            .help(Text(verbatim: resolved))
        }
    }

    private func helpBody(_ resolved: String) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: resolved)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            if let learnMore = help.learnMore {
                Link(destination: learnMore.url) {
                    HStack(spacing: TSSpacing.xs) {
                        Text(verbatim: learnMore.label
                            ?? WidgetShellStrings.string("common.learnMore", "Learn more"))
                        Image(systemName: "arrow.up.right.square")
                    }
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                }
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 260, alignment: .leading)
        .presentationCompactAdaptation(.popover)
    }
}

// MARK: - Pin toggle (web `PinButton`)

/// A focusable icon-only button that toggles the widget's pin state — the native port of the web
/// `PinButton`. Presentation-only: the host owns persistence (web composes a `usePinned` mutation;
/// the shell receives the resolved `isPinned` + a toggle callback).
struct WidgetShellPinButton: View {
    let isPinned: Bool
    let onToggle: @MainActor () -> Void

    var body: some View {
        Button {
            onToggle()
        } label: {
            Image(systemName: isPinned ? "pin.slash" : "pin")
                .font(.system(size: 11, weight: .regular))
                .foregroundStyle(isPinned ? Color.TS.statusWarning : Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: isPinned
                ? WidgetShellStrings.string("pin.unpin", "Unpin")
                : WidgetShellStrings.string("pin.pin", "Pin")))
        .accessibilityAddTraits(isPinned ? [.isSelected] : [])
    }
}
