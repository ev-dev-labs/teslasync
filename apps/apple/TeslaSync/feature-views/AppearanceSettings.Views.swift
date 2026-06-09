//
//  AppearanceSettings.Views.swift
//  TeslaSync — P4 feature view · 0204 · AppearanceSettings (Apple)
//
//  The presentational chrome the Appearance Settings surface composes from: the
//  header + freshness chip, the connectivity band, the toast, the per-section
//  header (icon + label + optional help glyph), the reusable selectable choice
//  card, the labelled toggle row, the token-styled action button, and the hex →
//  Color swatch helper. Each is a pure function of its inputs; all copy resolves
//  through the P1/S10 facade (no hardcoded English). The composed sections live in
//  `AppearanceSettings.Sections.swift` + `AppearanceSettings.Panels.swift`.
//

import SwiftUI

// MARK: - Header + freshness chip

/// The web header: a tinted palette icon, the "Appearance" title + subtitle, and a
/// trailing freshness chip (the native ADR-013 addition).
struct AppearanceSettingsHeader: View {
    let freshness: AppearanceFreshness
    let updatedAt: Date?
    let onRefresh: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSIconBox(systemName: "paintpalette.fill", tone: .accent)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                AppearanceSettingsStrings.text("theme.title", "Appearance")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                AppearanceSettingsStrings.text("theme.subtitle", "Customize colors and display mode")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: TSSpacing.sm)
            AppearanceFreshnessChip(freshness: freshness, updatedAt: updatedAt, onRefresh: onRefresh)
        }
    }
}

/// The freshness / refresh chip (ADR-013): a status dot, a connectivity glyph, and
/// a relative-time label. Tapping forces a refresh.
struct AppearanceFreshnessChip: View {
    let freshness: AppearanceFreshness
    let updatedAt: Date?
    let onRefresh: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var spin = false

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(tone).frame(width: 6, height: 6)
                Image(systemName: symbol)
                    .font(.system(size: 9, weight: .semibold))
                    .rotationEffect(.degrees(spin ? 360 : 0))
                    .animation(spinAnimation, value: spin)
                Text(verbatim: label).font(Font.TS.caption).monospacedDigit()
            }
            .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .onAppear { spin = freshness == .fetching && !reduceMotion }
        .onChange(of: freshness) { _, value in spin = value == .fetching && !reduceMotion }
        .accessibilityLabel(AppearanceSettingsStrings.text("freshness.refresh", "Refresh"))
        .accessibilityValue(Text(verbatim: AppearanceSettingsAccessibility.freshnessLabel(freshness)))
    }

    private var spinAnimation: Animation? {
        reduceMotion ? nil : .linear(duration: 1).repeatForever(autoreverses: false)
    }

    private var tone: Color {
        switch freshness {
        case .fresh: Color.TS.statusSuccess
        case .fetching: Color.TS.statusInfo
        case .stale: Color.TS.statusWarning
        case .error: Color.TS.statusDanger
        case .offline: Color.TS.textMuted
        }
    }

    private var symbol: String {
        switch freshness {
        case .fresh, .stale: "wifi"
        case .fetching: "arrow.triangle.2.circlepath"
        case .error, .offline: "wifi.slash"
        }
    }

    private var label: String {
        switch freshness {
        case .fetching: AppearanceSettingsStrings.string("freshness.updating", "Updating…")
        case .error: AppearanceSettingsStrings.string("freshness.error", "Error")
        case .offline: AppearanceSettingsStrings.string("freshness.offline", "Offline")
        case .fresh, .stale:
            updatedAt.map { AppearanceSettingsAdapter.relativeTime(since: $0) }
                ?? AppearanceSettingsAccessibility.freshnessLabel(freshness)
        }
    }
}

// MARK: - Connectivity band

/// The cached-data band shown when the live connection is stale or offline.
struct AppearanceConnectivityBanner: View {
    let connection: AppearanceConnection

    var body: some View {
        let offline = connection == .offline
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            AppearanceSettingsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(offline ? Color.TS.textMuted : Color.TS.statusWarning)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(tone.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var tone: Color {
        connection == .offline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var key: String {
        connection == .offline ? "state.offlineBanner" : "state.staleBanner"
    }

    private var fallback: String {
        connection == .offline
            ? "Offline — showing your last saved appearance"
            : "Reconnecting — display preferences may be out of date"
    }
}

// MARK: - Toast

/// A transient toast (web `useToast` / Toast) tinted by tone, with a close button.
struct AppearanceToastView: View {
    let toast: AppearanceToast
    let onDismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: symbol).foregroundStyle(tone).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: toast.title).font(Font.TS.bodySm).fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                if !toast.message.isEmpty {
                    Text(verbatim: toast.message).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
                }
            }
            Spacer(minLength: TSSpacing.sm)
            Button(action: onDismiss) {
                Image(systemName: "xmark").font(.caption2)
            }
            .buttonStyle(.plain).foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(AppearanceSettingsStrings.text("action.dismiss", "Dismiss"))
        }
        .padding(TSSpacing.md)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous).strokeBorder(
                tone.opacity(0.3),
                lineWidth: 1
            )
        )
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
    }

    private var tone: Color {
        switch toast.kind {
        case .success: Color.TS.statusSuccess
        case .info: Color.TS.statusInfo
        case .error: Color.TS.statusDanger
        }
    }

    private var symbol: String {
        switch toast.kind {
        case .success: "checkmark.circle.fill"
        case .info: "info.circle.fill"
        case .error: "exclamationmark.triangle.fill"
        }
    }
}

// MARK: - Section header (icon + uppercase label + optional help glyph)

/// A section label row: a muted SF Symbol, the uppercase tracked label, and an
/// optional help glyph carrying the field-help copy (web `HelpIcon`).
struct AppearanceSectionHeader: View {
    let systemImage: String
    let titleKey: String
    let titleFallback: String
    var helpKey: String?
    var helpFallback: String?

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            AppearanceSettingsStrings.text(titleKey, titleFallback)
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityAddTraits(.isHeader)
            if let helpKey, let helpFallback {
                Image(systemName: "questionmark.circle")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityLabel(AppearanceSettingsStrings.text(helpKey, helpFallback))
            }
        }
    }
}
