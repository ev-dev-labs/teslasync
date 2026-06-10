//
//  KioskSettingsModal.States.swift
//  TeslaSync — P4 modal / dialog · 0025 · KioskSettingsModal (Apple)
//
//  The chrome + leaf states `KioskSettingsModal` composes: the pinned header (title + freshness chip
//  + close), the live-state freshness chip + connectivity / inline-error banners, the populated
//  container (scrolling form sections + pinned footer), the footer (Cancel + Enter Kiosk Mode), and
//  the loading / empty / error leaf states. Every state renders real chrome — never a blank box
//  (engineering guideline #6). The form sections live in KioskSettingsModal.Sections.swift and
//  KioskSettingsModal.Transparency.swift. Copy via P1/S10 (`KioskSettingsStrings`); chrome via P1/S9
//  tokens.
//

import SwiftUI

// MARK: - Header (web Modal header)

/// The pinned header: the dialog title, an optional freshness chip, and the Close button (web Modal
/// `title` + the `×` close). Close maps to the web `onClose`.
struct KioskSettingsHeader: View {
    @Bindable var model: KioskSettingsModel
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "display")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                Text(verbatim: KioskSettingsStrings.string("kiosk.settings", "Kiosk Settings"))
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
            }
            Spacer(minLength: TSSpacing.sm)
            if model.connection != .live {
                KioskSettingsFreshnessChip(connection: model.connection)
            }
            closeButton
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
    }

    private var closeButton: some View {
        Button(action: onClose) {
            Image(systemName: "xmark")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .frame(width: 30, height: 30)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: KioskSettingsStrings.string("kiosk.close", "Close")))
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct KioskSettingsFreshnessChip: View {
    let connection: KioskConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: KioskSettingsStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(descriptor.tone.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: KioskSettingsStrings.string(descriptor.key, descriptor.fallback)))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: KioskConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "kiosk.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "kiosk.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "kiosk.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity + inline-error banners

/// The cached-data banner shown above the form when the bound source is not live, so cached settings
/// are clearly labeled while reconnecting / offline (ADR-013).
struct KioskSettingsConnectivityBanner: View {
    let connection: KioskConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "kiosk.offlineBanner" : "kiosk.staleBanner"
        let fallback = offline
            ? "Offline — showing your last saved kiosk settings"
            : "Reconnecting — these settings may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: KioskSettingsStrings.string(key, fallback))
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.1))
        .accessibilityElement(children: .combine)
    }
}

/// The inline reload error shown above the form when a reload failed but cached settings remain (web
/// has no analog; added so a failed refresh never blanks the editable form).
struct KioskSettingsInlineErrorBanner: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: KioskSettingsStrings.string("kiosk.reloadError", "Couldn't refresh your kiosk settings"))
                .font(Font.TS.caption)
            if !message.isEmpty {
                Text(verbatim: message).font(Font.TS.caption).lineLimit(1)
            }
        }
        .foregroundStyle(Color.TS.statusDanger)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Populated container (web form body + footer)

/// The full settings form: an optional connectivity / inline-error banner, the scrolling form
/// sections (rotation / display / transparency + hint), and the pinned footer.
struct KioskSettingsPopulatedView: View {
    @Bindable var model: KioskSettingsModel
    let onCancel: () -> Void
    let onEnter: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            if model.connection != .live {
                KioskSettingsConnectivityBanner(connection: model.connection)
            }
            if let message = model.inlineErrorMessage {
                KioskSettingsInlineErrorBanner(message: message)
            }
            form
            Divider().overlay(Color.TS.border)
            KioskSettingsFooter(model: model, onCancel: onCancel, onEnter: onEnter)
        }
    }

    private var form: some View {
        ScrollView {
            VStack(spacing: TSSpacing.lg) {
                KioskRotationSection(model: model)
                KioskDisplaySection(model: model)
                KioskTransparencySection(model: model)
                KioskHintBanner()
            }
            .padding(.horizontal, TSSpacing.lg)
            .padding(.vertical, TSSpacing.md)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Footer (web Modal footer actions)

/// The pinned footer: the Cancel (web `variant="ghost"`) + "Enter Kiosk Mode" (web primary, with the
/// maximize glyph) actions. Enter commits the rotation selection and enters kiosk mode.
struct KioskSettingsFooter: View {
    @Bindable var model: KioskSettingsModel
    let onCancel: () -> Void
    let onEnter: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            TSButton(variant: .ghost, size: .small, action: onCancel) {
                Text(verbatim: KioskSettingsStrings.string("common.cancel", "Cancel"))
            }
            TSButton(variant: .primary, size: .small, action: onEnter) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .font(.system(size: 11, weight: .semibold))
                    Text(verbatim: KioskSettingsStrings.string("kiosk.enter", "Enter Kiosk Mode"))
                }
            }
            .accessibilityLabel(Text(verbatim: KioskSettingsAccessibility.enterLabel(localize: model.localize)))
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
    }
}

// MARK: - Loading (skeleton chrome)

/// The first-load skeleton (dashboards / config fetch in flight, no cached settings): a redaction-
/// free outline of a few form sections so the layout doesn't reflow when the data resolves. A gentle
/// opacity pulse runs unless Reduce Motion is on.
struct KioskSettingsLoadingState: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 3, id: \.self) { _ in
                bar(width: 160, height: 18)
                bar(width: nil, height: 44)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .opacity(pulsing ? 0.55 : 1)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: TSMotion.slowDuration).repeatForever(autoreverses: true)) {
                pulsing = true
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: KioskSettingsStrings.string("kiosk.loading", "Loading kiosk settings…")))
    }

    private func bar(width: CGFloat?, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(Color.TS.textMuted.opacity(0.16))
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
    }
}

// MARK: - Empty (no dashboards)

/// The resolved-but-empty state (no saved dashboards to display), over a native
/// `ContentUnavailableView` so the dialog is never a blank box.
struct KioskSettingsEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: KioskSettingsStrings.string("kiosk.emptyTitle", "No dashboards to display"))
            } icon: {
                Image(systemName: "rectangle.on.rectangle.slash")
            }
        } description: {
            Text(verbatim: KioskSettingsStrings.string(
                "kiosk.emptyMessage", "Create a dashboard before starting kiosk mode."
            ))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (load failed)

/// The first-load failure state with a retry affordance (no cached settings to fall back on), so the
/// dialog isn't a blank box.
struct KioskSettingsErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: KioskSettingsStrings.string("kiosk.error", "Couldn't load kiosk settings"))
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: KioskSettingsStrings.string("kiosk.retry", "Retry"))
            }
            .padding(.top, TSSpacing.xs)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
