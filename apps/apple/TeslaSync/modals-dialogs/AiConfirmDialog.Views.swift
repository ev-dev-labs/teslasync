//
//  AiConfirmDialog.Views.swift
//  TeslaSync — P4 modal / dialog · 0001 · ConfirmDialog (Apple)
//
//  The presented panel + populated content for `AiConfirmDialog`: the panel shell (web `Modal` card,
//  faded in inside a `TSGlassPanel`), the always-on header (assistant glyph + title + freshness chip +
//  close), and the `.content` body — the intro paragraph, the "Tool" block (monospaced name + optional
//  description), the "Arguments" block (the scrollable, monospaced `JSON.stringify` output), and the
//  Cancel / Approve footer (the latter showing a spinner while the continuation POST is in flight). The
//  loading / empty / error envelopes + the freshness chip / cached-data banner live in
//  AiConfirmDialog.States.swift. All copy resolves through the P1/S10 facade; all chrome is
//  token-driven (P1/S9). No web Tailwind ports live here.
//

import SwiftUI

// MARK: - Panel shell (web `Modal` card)

/// The presented dialog: the always-on header, an optional cached-data banner, and the phase body —
/// wrapped in a `TSGlassPanel` (web `Modal` surface). Every phase renders real chrome under the header
/// so the dialog is never a blank box (engineering guideline #6).
struct AiConfirmPanel: View {
    @Bindable var model: AiConfirmModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                AiConfirmHeader(
                    title: model.titleText,
                    connection: model.connection,
                    closeLabel: model.closeAccessibilityLabel
                ) { model.dismiss() }
                if model.connection != .live {
                    AiConfirmConnectivityBanner(connection: model.connection)
                }
                body(for: model.phase)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: 460)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.panelAccessibilityLabel))
    }

    /// The web modal body under the header: the populated approval content for `.content`, else the
    /// loading / empty / error envelopes so no state is hidden behind a blank panel.
    @ViewBuilder
    private func body(for phase: AiConfirmPhase) -> some View {
        switch phase {
        case .loading:
            AiConfirmLoadingState()
        case .empty:
            AiConfirmEmptyState()
        case let .error(message):
            AiConfirmErrorState(message: message) { model.refresh() }
        case .content:
            AiConfirmContent(model: model)
        }
    }
}

// MARK: - Header (web Modal title + close)

/// The dialog header: the accent assistant glyph, the title, the freshness chip, and the trailing close
/// button (web `Modal` close "×" → `onClose`).
struct AiConfirmHeader: View {
    let title: String
    let connection: AiConfirmConnection
    let closeLabel: String
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            iconChip
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                AiConfirmFreshnessChip(connection: connection)
            }
            Spacer(minLength: TSSpacing.sm)
            closeButton
        }
        .accessibilityElement(children: .contain)
    }

    private var iconChip: some View {
        Image(systemName: "sparkles")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Color.TS.accent)
            .frame(width: 32, height: 32)
            .background(Color.TS.accent.opacity(0.15), in: RoundedRectangle(cornerRadius: TSRadius.md))
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

// MARK: - Content (web populated body)

/// The `.content` body: the inline reload error (when a refresh failed while a cached request remains),
/// the intro paragraph, the tool block, the arguments block, and the Cancel / Approve footer.
struct AiConfirmContent: View {
    @Bindable var model: AiConfirmModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if let message = model.inlineErrorMessage {
                AiConfirmInlineError(message: message)
            }
            Text(verbatim: model.introText)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
            AiConfirmToolSection(
                label: model.toolLabelText,
                name: model.toolName,
                description: model.toolDescription,
                accessibilityLabel: model.toolAccessibilityLabel
            )
            AiConfirmArgumentsSection(
                label: model.argsLabelText,
                json: model.argumentsText,
                accessibilityLabel: model.argumentsAccessibilityLabel
            )
            AiConfirmActions(
                cancelLabel: model.cancelLabelText,
                confirmLabel: model.confirmLabelText,
                busy: model.isBusy,
                cancelDisabled: model.cancelDisabled,
                confirmDisabled: model.confirmDisabled,
                onCancel: { model.cancel() },
                onConfirm: { Task { await model.confirm() } }
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Tool section (web Tool label + mono name + description)

/// The "Tool" block: an uppercase section label, the tool name in a monospaced run (web `font-mono`),
/// and the optional human description below it (web `tool.description && …`).
struct AiConfirmToolSection: View {
    let label: String
    let name: String
    let description: String?
    let accessibilityLabel: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            AiConfirmSectionLabel(text: label)
            Text(verbatim: name)
                .font(Font.TS.body.monospaced())
                .foregroundStyle(Color.TS.textPrimary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityHidden(true)
            if let description {
                Text(verbatim: description)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }
}

// MARK: - Arguments section (web `<pre>` JSON block)

/// The "Arguments" block: an uppercase section label and the pretty-printed JSON in a bordered,
/// scrollable, monospaced container (web `<pre className="overflow-auto …">`).
struct AiConfirmArgumentsSection: View {
    let label: String
    let json: String
    let accessibilityLabel: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            AiConfirmSectionLabel(text: label)
            ScrollView([.horizontal, .vertical]) {
                Text(verbatim: json)
                    .font(Font.TS.bodySm.monospaced())
                    .foregroundStyle(Color.TS.textPrimary)
                    .textSelection(.enabled)
                    .padding(TSSpacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 220)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityValue(Text(verbatim: json))
    }
}

// MARK: - Section label (web uppercase tracked caption)

/// The uppercase, letter-spaced section caption (web `text-xs uppercase tracking-wide text-muted`).
struct AiConfirmSectionLabel: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .textCase(.uppercase)
            .tracking(0.6)
            .foregroundStyle(Color.TS.textMuted)
    }
}

// MARK: - Footer (web Cancel / Approve)

/// The footer actions: the secondary "Cancel" (web `variant="secondary"`, bound to Escape) and the
/// primary "Approve" (web `variant="primary"`, bound to Return), both disabled while the continuation
/// POST is in flight and the latter showing a spinner.
struct AiConfirmActions: View {
    let cancelLabel: String
    let confirmLabel: String
    let busy: Bool
    let cancelDisabled: Bool
    let confirmDisabled: Bool
    let onCancel: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: TSSpacing.sm)
            TSButton(variant: .secondary, size: .small, action: onCancel) {
                Text(verbatim: cancelLabel)
            }
            .disabled(cancelDisabled)
            .keyboardShortcut(.cancelAction)
            .accessibilityLabel(Text(verbatim: cancelLabel))
            TSButton(variant: .primary, size: .small, isLoading: busy, action: onConfirm) {
                Text(verbatim: confirmLabel)
            }
            .disabled(confirmDisabled)
            .keyboardShortcut(.defaultAction)
            .accessibilityLabel(Text(verbatim: confirmLabel))
        }
    }
}

// MARK: - Localization Text helper

extension AiConfirmStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values are never
    /// re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
