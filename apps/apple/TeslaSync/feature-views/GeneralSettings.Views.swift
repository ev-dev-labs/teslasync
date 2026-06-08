//
//  GeneralSettings.Views.swift
//  TeslaSync — P4 feature view · 0207 · GeneralSettings (Apple)
//
//  The presentational chrome the General Settings surface composes from: the
//  header + freshness chip, the connectivity + draft-recovery banners, the
//  loading / empty / error states, the sync-from-car + car-clock panels, the save
//  bar, the toast, and the shared token-styled button. Each is a pure function of
//  its inputs; all copy resolves through the P1/S10 facade (no hardcoded English),
//  and the form fields live in `GeneralSettings.Fields.swift`.
//

import SwiftUI

// MARK: - Header + freshness chip

/// The web header: a tinted gear icon, the "Application" title + subtitle, and a
/// trailing freshness chip (the native ADR-013 addition).
struct SettingsHeader: View {
    let freshness: SettingsFreshness
    let updatedAt: Date?
    let onRefresh: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSIconBox(systemName: "gearshape.fill", tone: .accent)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                GeneralSettingsStrings.text("app.title", "Application")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                GeneralSettingsStrings.text("app.subtitle", "Units, language, and cost preferences")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: TSSpacing.sm)
            SettingsFreshnessChip(freshness: freshness, updatedAt: updatedAt, onRefresh: onRefresh)
        }
    }
}

/// The freshness / refresh chip (ADR-013): a status dot, a connectivity glyph,
/// and a relative-time label. Tapping forces a refresh.
struct SettingsFreshnessChip: View {
    let freshness: SettingsFreshness
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
        .accessibilityLabel(GeneralSettingsStrings.text("freshness.refresh", "Refresh"))
        .accessibilityValue(Text(verbatim: GeneralSettingsAccessibility.freshnessLabel(freshness)))
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
        case .fetching: GeneralSettingsStrings.string("freshness.updating", "Updating…")
        case .error: GeneralSettingsStrings.string("freshness.error", "Error")
        case .offline: GeneralSettingsStrings.string("freshness.offline", "Offline")
        case .fresh, .stale:
            updatedAt.map { GeneralSettingsAdapter.relativeTime(since: $0) }
                ?? GeneralSettingsAccessibility.freshnessLabel(freshness)
        }
    }
}

// MARK: - Connectivity + draft banners

/// The cached-data band shown when the live connection is stale or offline.
struct SettingsConnectivityBanner: View {
    let connection: SettingsConnection

    var body: some View {
        let offline = connection == .offline
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            GeneralSettingsStrings.text(key, fallback).font(Font.TS.caption)
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
            ? "Offline — showing the last saved settings"
            : "Reconnecting — preferences may be out of date"
    }
}

/// The recovered-draft banner (web `DraftRecoveryBanner`) with a discard action.
struct SettingsDraftBanner: View {
    let savedAt: Date?
    let onDiscard: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: "arrow.uturn.backward").foregroundStyle(Color.TS.statusInfo)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: title).font(Font.TS.bodySm).fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                GeneralSettingsStrings.text("draft.restoredHint", "Your in-progress edits were recovered.")
                    .font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
            }
            Spacer(minLength: TSSpacing.sm)
            SettingsButton(titleKey: "draft.discard", fallback: "Discard", variant: .secondary, action: onDiscard)
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.statusInfo.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusInfo.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    private var title: String {
        let noun = GeneralSettingsStrings.string("draft.noun.settings", "Settings")
        return GeneralSettingsStrings.format("draft.restoredTitle", "Unsaved %@ draft restored", noun)
    }
}

// MARK: - Save bar + toast + button

/// The save action row with the post-save confirmation chip (web Save button +
/// the `saved` animated confirmation).
struct SettingsSaveBar: View {
    let status: SettingsSaveStatus
    let onSave: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            SettingsButton(
                titleKey: "app.save", fallback: "Save Settings",
                variant: .primary, systemImage: "square.and.arrow.down",
                loading: status == .saving, action: onSave
            )
            if status == .saved {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "checkmark.circle.fill")
                    GeneralSettingsStrings.text("app.settingsSaved", "Settings saved").font(Font.TS.bodySm)
                }
                .foregroundStyle(Color.TS.statusSuccess)
                .transition(.opacity)
                .accessibilityElement(children: .combine)
            }
            Spacer(minLength: 0)
        }
        .animation(.easeInOut(duration: TSMotion.fastDuration), value: status)
    }
}

/// A transient toast (web `useToast` / Toast) tinted by tone, with a close button.
struct SettingsToastView: View {
    let toast: SettingsToast
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
            .accessibilityLabel(GeneralSettingsStrings.text("action.dismiss", "Dismiss"))
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

/// Visual emphasis for the local `SettingsButton`.
enum SettingsButtonVariant { case primary, secondary }

/// A small token-styled action button with a leading SF Symbol + loading state —
/// the native port of the web `Button` (size sm). Resolves its title through the
/// surface i18n facade so no English literal is hardcoded.
struct SettingsButton: View {
    let titleKey: String
    let fallback: String
    var variant: SettingsButtonVariant = .secondary
    var systemImage: String?
    var loading: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                if loading {
                    ProgressView().controlSize(.mini).tint(foreground)
                } else if let systemImage {
                    Image(systemName: systemImage).font(.system(size: 12, weight: .semibold))
                }
                GeneralSettingsStrings.text(titleKey, fallback).font(Font.TS.caption).fontWeight(.semibold)
            }
            .foregroundStyle(foreground)
            .padding(.horizontal, TSSpacing.md).padding(.vertical, TSSpacing.sm)
            .frame(minHeight: 34)
            .background(background, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous).strokeBorder(border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(loading)
        .opacity(loading ? 0.7 : 1)
        .accessibilityLabel(GeneralSettingsStrings.text(titleKey, fallback))
    }

    private var foreground: Color {
        variant == .primary ? Color.white : Color.TS.textPrimary
    }

    private var background: Color {
        variant == .primary ? Color.TS.accent : Color.TS.surfaceGlass
    }

    private var border: Color {
        variant == .primary ? Color.clear : Color.TS.border
    }
}
