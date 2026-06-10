//
//  SLOTrackingCard.Views.swift
//  TeslaSync — P4 feature view · 0253 · SLOTrackingCard (Apple)
//
//  Presentational chrome composed by `SLOTrackingCard`, the SwiftUI parity of the
//  web card body: the header (Target glyph + "Uptime & SLO" title + the inline
//  personal-target editor), the big tone-colored percentage + "window · X / Y
//  components healthy" subtitle, the window selector pills (web `role="tablist"`),
//  the snapshot caveat (web `Info` callout), and the stale / offline freshness chip
//  + connectivity banner (the P4 live-state contract). All copy resolves through
//  the P1/S10 facade; all chrome is token-driven (P1/S9). No networking and no
//  Tailwind ports live here. The loading / empty / error states live in `.States`.
//

import SwiftUI

// MARK: - Tone palette (web `tone` color classes → adaptive semantic tokens)

/// The figure-tone → color mapping. The web uses `green-300` / `amber-300` /
/// `red-300` / muted; native uses the adaptive semantic tokens so light / dark /
/// high-contrast all resolve.
enum SLOTonePalette {
    static func color(for tone: SLOTone) -> Color {
        switch tone {
        case .onTarget: Color.TS.statusSuccess
        case .nearTarget: Color.TS.statusWarning
        case .belowTarget: Color.TS.statusDanger
        case .unknown: Color.TS.textMuted
        }
    }
}

// MARK: - Header (web title row + target editor)

/// The card header — the Target glyph + "Uptime & SLO" title on the left, the
/// inline personal-target editor on the right (web `flex items-start justify-
/// between`). The title is marked as the surface's accessibility header.
struct SLOTrackingHeader: View {
    let titleKey: String
    let titleFallback: String
    let connection: SLOConnection
    let targetToken: String
    let isEditing: Bool
    @Binding var draft: String
    let onEdit: () -> Void
    let onSave: () -> Void
    let onCancel: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "target")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.TS.textSecondary)
                    .accessibilityHidden(true)
                Text(verbatim: SLOTrackingStrings.string(titleKey, titleFallback))
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                SLOTrackingFreshnessChip(connection: connection)
            }
            Spacer(minLength: TSSpacing.sm)
            SLOTargetEditor(
                targetToken: targetToken,
                isEditing: isEditing,
                draft: $draft,
                onEdit: onEdit,
                onSave: onSave,
                onCancel: onCancel
            )
        }
    }
}

// MARK: - Target editor (web `editing ? <input+save+cancel> : <label+edit>`)

/// The inline personal-target control — the native parity of the web header
/// accessory: a "Target …%" label + Edit button, swapping to a numeric field with
/// Save / Cancel while editing (web `Input type=number` + `Button`s).
struct SLOTargetEditor: View {
    let targetToken: String
    let isEditing: Bool
    @Binding var draft: String
    let onEdit: () -> Void
    let onSave: () -> Void
    let onCancel: () -> Void

    var body: some View {
        if isEditing {
            editingControls
        } else {
            displayControls
        }
    }

    private var displayControls: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: "\(SLOTrackingStrings.string("Target", "Target")) \(targetToken)%")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityLabel(Text(verbatim: targetAccessibilityLabel))
            TSButton(variant: .ghost, size: .small, action: onEdit) {
                Text(verbatim: SLOTrackingStrings.string("Edit", "Edit"))
            }
            .accessibilityLabel(Text(verbatim: SLOTrackingStrings.string("Edit Target", "Edit target")))
        }
    }

    private var editingControls: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: SLOTrackingStrings.string("Target", "Target"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            targetField
            Text(verbatim: "%")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TSButton(variant: .primary, size: .small, action: onSave) {
                Text(verbatim: SLOTrackingStrings.string("Save", "Save"))
            }
            TSButton(variant: .ghost, size: .small, action: onCancel) {
                Text(verbatim: SLOTrackingStrings.string("Cancel", "Cancel"))
            }
        }
    }

    private var targetField: some View {
        TextField("", text: $draft)
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .multilineTextAlignment(.trailing)
            .frame(width: 56)
            .padding(.horizontal, TSSpacing.xs)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .modifier(SLODecimalKeyboard())
            .accessibilityLabel(Text(verbatim: SLOTrackingStrings.string(
                "Target uptime percentage",
                "Target uptime percentage"
            )))
    }

    private var targetAccessibilityLabel: String {
        let prefix = SLOTrackingStrings.string("Target", "Target")
        let suffix = SLOTrackingStrings.string("percent", "percent")
        return "\(prefix) \(targetToken) \(suffix)"
    }
}

/// Applies the decimal keypad to the target field on iOS; a no-op elsewhere
/// (macOS has no software keyboard). Factored into a modifier so the field's view
/// type stays uniform across platforms.
private struct SLODecimalKeyboard: ViewModifier {
    func body(content: Content) -> some View {
        #if os(iOS)
            content.keyboardType(.decimalPad)
        #else
            content
        #endif
    }
}

// MARK: - Figure (web big percentage + subtitle)

/// The headline figure — the large tone-colored percentage (web `text-3xl tabular-
/// nums`) over the "window · X / Y components healthy" subtitle. The figure is a
/// polite live region (web `aria-live="polite"`).
struct SLOFigureView: View {
    let percentText: String
    let tone: SLOTone
    let windowLabel: String
    let componentsClause: String
    let accessibilitySummary: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: percentText)
                .font(.system(size: 34, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(SLOTonePalette.color(for: tone))
            Text(verbatim: "\(windowLabel) · \(componentsClause)")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
        .accessibilityAddTraits(.updatesFrequently)
    }
}

// MARK: - Window selector (web `role="tablist"` pill buttons)

/// The uptime-window selector — the native parity of the web pill tablist
/// (`24h / 7d / 30d / 90d / 1y`). Each pill is a real button carrying `.isSelected`
/// for VoiceOver; the selected pill uses the accent tint (web cyan ring).
struct SLOWindowSelector: View {
    let selected: SLOWindow
    let onSelect: (SLOWindow) -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(SLOWindow.allCases) { window in
                pill(for: window)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: SLOTrackingStrings.string(
            "Uptime window selector",
            "Uptime window selector"
        )))
    }

    @ViewBuilder
    private func pill(for window: SLOWindow) -> some View {
        let isSelected = window == selected
        let label = SLOTrackingStrings.string(window.shortLabelKey, window.shortLabelKey)
        Button {
            onSelect(window)
        } label: {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(isSelected ? Color.TS.accent : Color.TS.textSecondary)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(
                    isSelected ? Color.TS.accent.opacity(0.16) : Color.TS.surface,
                    in: Capsule()
                )
                .overlay(
                    Capsule().strokeBorder(
                        isSelected ? Color.TS.accent.opacity(0.4) : Color.TS.border,
                        lineWidth: 1
                    )
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: SLOTrackingStrings.string(window.longLabelKey, window.longLabelKey)))
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Snapshot caveat (web `Info` callout)

/// The "current snapshot" caveat — shown when the figure is not a real per-window
/// series (web `historical_source !== 'series'`): an Info glyph + the source note
/// or the default caveat copy.
struct SLOHistoricalCaveat: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.xs) {
            Image(systemName: "info.circle")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            Text(verbatim: text)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.statusWarning)
                .fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(.leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Stale / Offline)

/// A small live-state chip shown next to the header when the bound source is not
/// live (ADR-013). The web card has no freshness concept; this is the prompt's
/// "stale chip" / "offline chip", invisible while live so the normal header
/// matches the web.
struct SLOTrackingFreshnessChip: View {
    let connection: SLOConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
        let symbol: String
    }

    var body: some View {
        if let descriptor = Self.descriptor(for: connection) {
            HStack(spacing: 4) {
                Image(systemName: descriptor.symbol)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(descriptor.tone)
                Text(verbatim: SLOTrackingStrings.string(descriptor.key, descriptor.fallback))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(descriptor.tone.opacity(0.12), in: Capsule())
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: SLOTrackingStrings.string(descriptor.key, descriptor.fallback)))
        }
    }

    private static func descriptor(for connection: SLOConnection) -> Descriptor? {
        switch connection {
        case .live:
            nil
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "Stale", fallback: "Stale", symbol: "clock.arrow.circlepath")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "Offline", fallback: "Offline", symbol: "wifi.slash")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale / offline banner shown above the figure when the bound source is not
/// live, so a cached uptime snapshot is clearly labeled.
struct SLOTrackingConnectivityBanner: View {
    let connection: SLOConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "Offline Banner" : "Stale Banner"
        let fallback = offline
            ? "Offline — showing last known uptime"
            : "Reconnecting — uptime may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: SLOTrackingStrings.string(key, fallback))
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
