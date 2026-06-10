//
//  TOUSettingsModal.Views.swift
//  TeslaSync — P4 modal / dialog · 0021 · TOUSettingsModal (Apple)
//
//  The populated content for `TOUSettingsModal`: the modal header (clock glyph + "Update Rate Plan"
//  title + freshness chip + close), the scrolling form body (description, the connectivity banner /
//  inline reload error, the tab bar, the active tab's content, and the shared error line), and the
//  pinned Cancel / "Update Rate Plan" footer. All copy resolves through the P1/S10 facade; all chrome is
//  token-driven (P1/S9). No web Tailwind ports live here — the interactive controls live in
//  TOUSettingsModal.Controls.swift.
//

import SwiftUI

// MARK: - Header (web `Modal` title + close)

/// The dialog header: the clock glyph, the "Update Rate Plan" title + freshness chip, and the trailing
/// close button (web `Modal` title bar with its `onClose` "×").
struct TOUSettingsHeader: View {
    let connection: TOUSettingsConnection
    let title: String
    let closeLabel: String
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            iconChip
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                TOUSettingsFreshnessChip(connection: connection)
            }
            Spacer(minLength: TSSpacing.sm)
            closeButton
        }
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .contain)
    }

    private var iconChip: some View {
        Image(systemName: "clock.fill")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Color.TS.accent)
            .frame(width: 32, height: 32)
            .background(Color.TS.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: TSRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md)
                    .strokeBorder(Color.TS.accent.opacity(0.20), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }

    private var closeButton: some View {
        Button(action: onClose) {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 18))
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: closeLabel))
    }
}

// MARK: - Content (web populated modal body)

/// The populated body shown for `.content`: a scrolling form (description, connectivity banner, inline
/// reload error, tab bar, the active tab, the shared error line) above a pinned footer.
struct TOUSettingsContentView: View {
    @Bindable var model: TOUSettingsModel
    let onCancel: () -> Void
    let onSubmit: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    if model.connection != .live {
                        TOUSettingsConnectivityBanner(connection: model.connection)
                    }
                    if let inline = model.inlineLoadError {
                        TOUSettingsInlineError(message: inline)
                    }
                    TOUSettingsDescription()
                    TOUSettingsTabBar(model: model)
                    tabBody
                    if let error = model.formError {
                        TOUSettingsErrorLine(message: error)
                    }
                }
                .padding(TSSpacing.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Divider().overlay(Color.TS.border)
            TOUSettingsFooter(
                submitting: model.isSubmitting,
                canCancel: model.canCancel,
                cancelTitle: model.localize("common.cancel", "Cancel"),
                submitTitle: model.localize("energy.tou.submit", "Update Rate Plan"),
                onCancel: onCancel,
                onSubmit: onSubmit
            )
            .padding(TSSpacing.lg)
        }
    }

    @ViewBuilder
    private var tabBody: some View {
        switch model.activeTab {
        case .preset:
            TOUSettingsPresetTab(model: model)
        case .custom:
            TOUSettingsCustomTab(model: model)
        }
    }
}

// MARK: - Description (web intro paragraph)

/// The intro paragraph above the tabs (web `energy.tou.description`).
struct TOUSettingsDescription: View {
    var body: some View {
        TOUSettingsStrings.text(
            "energy.tou.description",
            "Configure your utility rate plan so the Powerwall can optimize charging and "
                + "discharging based on electricity pricing."
        )
        .font(Font.TS.body)
        .foregroundStyle(Color.TS.textSecondary)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Preset tab (web `Select` + preview)

/// The Preset-tab body: the rate-plan picker and, once a plan is chosen, its JSON preview (web
/// `{selectedPreset && <pre>…</pre>}`).
struct TOUSettingsPresetTab: View {
    @Bindable var model: TOUSettingsModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TOUSettingsPresetPicker(model: model)
            if let preview = model.selectedPresetPreview {
                TOUSettingsPreviewPane(
                    json: preview,
                    label: model.localize("energy.tou.previewLabel", "Preview")
                )
            }
        }
    }
}

/// The selected preset's JSON preview pane (web `<pre>{JSON.stringify(settings, null, 2)}</pre>`),
/// scrollable + monospaced, capped in height like the web `max-h-48`.
struct TOUSettingsPreviewPane: View {
    let json: String
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            ScrollView {
                Text(verbatim: json)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(Color.TS.textSecondary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 192)
        }
        .padding(TSSpacing.md)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Custom tab (web `Textarea` + hint)

/// The Custom-tab body: the monospaced JSON editor and the schema hint line.
struct TOUSettingsCustomTab: View {
    @Bindable var model: TOUSettingsModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TOUSettingsJSONEditor(model: model)
            TOUSettingsCustomHint(
                text: model.localize(
                    "energy.tou.customHint",
                    "Paste the full tou_settings payload or just the inner object. "
                        + "See Tesla Fleet API docs for the schema."
                )
            )
        }
    }
}

/// The Custom-tab schema hint (web `FileJson` glyph + `energy.tou.customHint`).
struct TOUSettingsCustomHint: View {
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
            Image(systemName: "curlybraces")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: text).font(Font.TS.caption)
        }
        .foregroundStyle(Color.TS.textMuted)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Shared error line (web `error` row)

/// The shared validation / save error line (web `{error && <p>…</p>}` with the `Zap` glyph).
struct TOUSettingsErrorLine: View {
    let message: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: message).font(Font.TS.caption)
        }
        .foregroundStyle(Color.TS.statusDanger)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Footer (web Cancel + Update)

/// The footer: the ghost Cancel (disabled while saving, web `disabled={isPending}`) and the primary
/// "Update Rate Plan" action with its clock glyph + loading state (web `loading={isPending}`).
struct TOUSettingsFooter: View {
    let submitting: Bool
    let canCancel: Bool
    let cancelTitle: String
    let submitTitle: String
    let onCancel: () -> Void
    let onSubmit: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: TSSpacing.sm)
            TSButton(variant: .ghost, size: .medium, action: onCancel) {
                Text(verbatim: cancelTitle)
            }
            .disabled(!canCancel)
            .accessibilityLabel(Text(verbatim: cancelTitle))
            TSButton(variant: .primary, size: .medium, isLoading: submitting, action: onSubmit) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "clock")
                        .font(.system(size: 13, weight: .semibold))
                    Text(verbatim: submitTitle)
                }
            }
            .accessibilityLabel(Text(verbatim: submitTitle))
        }
    }
}

// MARK: - Field label + localization Text helper

/// A form field's visible label (web `<Select label>` / `<Textarea label>`), styled as a token label.
struct TOUSettingsFieldLabel: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension TOUSettingsStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so resolved values are never
    /// re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
