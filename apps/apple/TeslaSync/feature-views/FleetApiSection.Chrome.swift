//
//  FleetApiSection.Chrome.swift
//  TeslaSync — P4 feature view · 0004 · FleetApiSection (Apple)
//
//  The surface-local chrome primitives the tool cards compose: the tone→color
//  mapping (port of `ICON_COLOR_MAP`), the status badge (port of the web `Badge`),
//  the action button (port of `Button`), the labeled text field / textarea / vehicle
//  picker (ports of `Input` / `Textarea` / `Select`), the copy button + code row,
//  the amber warning callout, the section header, and the tappable freshness chip.
//  All are token-driven + resolve their copy through this surface's i18n facade so
//  the surface stays self-contained and localized.
//

import SwiftUI
#if os(iOS)
    import UIKit
#elseif os(macOS)
    import AppKit
#endif

// MARK: - Tone → color (port of ICON_COLOR_MAP)

extension FleetTone {
    var color: Color {
        switch self {
        case .cyan: Color.TS.accent
        case .green: Color.TS.statusSuccess
        case .purple: Color.TS.chartSeriesPower
        case .amber: Color.TS.statusWarning
        case .red: Color.TS.statusDanger
        case .neutral: Color.TS.textMuted
        }
    }
}

// MARK: - Clipboard (port of CopyButton)

enum FleetClipboard {
    static func copy(_ text: String) {
        #if os(iOS)
            UIPasteboard.general.string = text
        #elseif os(macOS)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
        #endif
    }
}

// MARK: - Section header (port of the section `h2`)

/// A section heading ("Setup Wizard", "Fleet API Tools").
struct FleetSectionHeader: View {
    let key: String
    let fallback: String

    var body: some View {
        FleetApiStrings.text(key, fallback)
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Badge (port of the web `Badge`)

/// A tone capsule badge with an optional status dot, rendering pre-resolved text.
struct FleetBadge: View {
    let text: Text
    var tone: FleetTone = .neutral
    var dot: Bool = false

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if dot {
                Circle().fill(tone.color).frame(width: 6, height: 6)
            }
            text
                .font(Font.TS.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(tone.color.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.25), lineWidth: 1))
    }
}

// MARK: - Button (port of the web `Button`)

enum FleetButtonVariant { case primary, secondary, ghost, destructive }

/// A small action button with a leading SF Symbol, a loading spinner, and a
/// disabled state — the native port of the web `Button` size="sm".
struct FleetButton: View {
    let titleKey: String
    let fallback: String
    var variant: FleetButtonVariant = .secondary
    var systemImage: String?
    var loading: Bool = false
    var disabled: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                if loading {
                    ProgressView().controlSize(.mini).tint(foreground)
                } else if let systemImage {
                    Image(systemName: systemImage).font(.system(size: 12, weight: .semibold))
                }
                FleetApiStrings.text(titleKey, fallback)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
            }
            .foregroundStyle(foreground)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .frame(minHeight: 34)
            .background(background, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(disabled || loading)
        .opacity(disabled ? 0.5 : 1)
        .accessibilityLabel(FleetApiStrings.text(titleKey, fallback))
    }

    private var tone: Color {
        variant == .destructive ? Color.TS.statusDanger : Color.TS.accent
    }

    private var foreground: Color {
        switch variant {
        case .primary: Color.TS.surface
        case .secondary, .ghost: Color.TS.textPrimary
        case .destructive: Color.TS.statusDanger
        }
    }

    private var background: Color {
        switch variant {
        case .primary: Color.TS.accent
        case .secondary: Color.TS.surfaceGlass
        case .ghost: Color.clear
        case .destructive: Color.TS.statusDanger.opacity(0.12)
        }
    }

    private var border: Color {
        switch variant {
        case .primary: Color.clear
        case .secondary, .ghost: Color.TS.border
        case .destructive: Color.TS.statusDanger.opacity(0.3)
        }
    }
}
