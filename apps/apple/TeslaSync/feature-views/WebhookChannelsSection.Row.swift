//
//  WebhookChannelsSection.Row.swift
//  TeslaSync — P4 feature view · 0218 · WebhookChannelsSection (Apple)
//
//  One webhook channel row (web `WebhookRow`) — name + enabled/method pills + URL,
//  the Active toggle + Test / Edit / Delete actions — and its inline test-result
//  panel (web `testResult` block). Split from WebhookChannelsSection.Views.swift to
//  respect the house file-length limit. Token-driven + localized; no networking.
//

import SwiftUI

// MARK: - Channel row

/// One webhook channel row (web `WebhookRow`): name + enabled/method pills + URL, the
/// Active toggle + Test / Edit / Delete actions, and the inline test-result panel.
struct WebhookRow: View {
    let channel: WebhookChannel
    let testResult: WebhookTestOutcome?
    let toggling: Bool
    let testing: Bool
    let onToggle: () -> Void
    let onTest: () -> Void
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    HStack(spacing: TSSpacing.sm) {
                        Text(verbatim: channel.name)
                            .font(Font.TS.panel)
                            .foregroundStyle(Color.TS.textPrimary)
                            .lineLimit(1)
                        WebhookPill(
                            text: channel.enabled
                                ? WebhookStrings.string("webhookChannels.row.enabled", "Enabled")
                                : WebhookStrings.string("webhookChannels.row.disabled", "Disabled"),
                            tone: channel.enabled ? Color.TS.statusSuccess : Color.TS.textMuted
                        )
                        WebhookPill(text: channel.method.display, tone: Color.TS.statusInfo)
                    }
                    Text(verbatim: channel.url)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(2)
                        .truncationMode(.middle)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                rowControls
            }
            if let testResult {
                WebhookTestResultPanel(outcome: testResult)
            }
        }
        .padding(TSSpacing.lg)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            Text(verbatim: WebhookChannelsAccessibility.rowLabel(channel, localize: WebhookStrings.string))
        )
    }

    private var rowControls: some View {
        HStack(spacing: TSSpacing.sm) {
            Toggle(isOn: Binding(get: { channel.enabled }, set: { _ in onToggle() })) {
                WebhookStrings.text("webhookChannels.row.toggle", "Active")
            }
            .labelsHidden()
            .toggleStyle(.switch)
            .controlSize(.small)
            .tint(Color.TS.accent)
            .disabled(toggling)
            .accessibilityLabel(WebhookStrings.text("webhookChannels.row.toggle", "Active"))
            WebhookIconButton(
                systemImage: WebhookGlyph.test,
                labelKey: "webhookChannels.row.test",
                fallback: "Test webhook",
                tone: Color.TS.accent,
                loading: testing,
                disabled: toggling,
                action: onTest
            )
            WebhookIconButton(
                systemImage: WebhookGlyph.edit,
                labelKey: "webhookChannels.row.edit",
                fallback: "Edit webhook",
                action: onEdit
            )
            WebhookIconButton(
                systemImage: WebhookGlyph.delete,
                labelKey: "webhookChannels.row.delete",
                fallback: "Delete webhook",
                tone: Color.TS.statusDanger,
                action: onDelete
            )
        }
    }
}

// MARK: - Test-result panel

/// The inline test outcome (web `testResult` block): verdict pill + status + latency,
/// the signature row, the response-body disclosure, and the error line.
struct WebhookTestResultPanel: View {
    let outcome: WebhookTestOutcome

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.sm) {
                WebhookPill(
                    text: outcome.success
                        ? WebhookStrings.string("webhookChannels.test.success", "Success")
                        : WebhookStrings.string("webhookChannels.test.failure", "Failed"),
                    tone: outcome.success ? Color.TS.statusSuccess : Color.TS.statusDanger
                )
                Text(verbatim: WebhookStrings.interpolate(
                    "webhookChannels.test.status", "Status {{status}}",
                    ["status": WebhookFormat.integer(outcome.statusCode)]
                ))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                Text(verbatim: WebhookStrings.interpolate(
                    "webhookChannels.test.latency", "{{ms}} ms",
                    ["ms": WebhookFormat.integer(outcome.latencyMs)]
                ))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .monospacedDigit()
            }
            if let signature = outcome.signature, !signature.isEmpty {
                signatureRow(signature)
            }
            if let body = outcome.bodyPreview, !body.isEmpty {
                bodyDisclosure(body)
            }
            if let error = outcome.error, !error.isEmpty {
                Text(verbatim: error)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.statusDanger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: WebhookChannelsAccessibility.testResultLabel(outcome, localize: WebhookStrings.string))
        )
    }

    private func signatureRow(_ signature: String) -> some View {
        HStack(spacing: TSSpacing.sm) {
            WebhookStrings.text("webhookChannels.test.signature", "Signature:")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: signature)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                WebhookClipboard.copy(signature)
            } label: {
                Image(systemName: WebhookGlyph.copy)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(WebhookStrings.text("webhookChannels.copy", "Copy"))
        }
    }

    private func bodyDisclosure(_ body: String) -> some View {
        DisclosureGroup {
            Text(verbatim: outcome.truncated
                ? body + "\n" + WebhookStrings.string("webhookChannels.test.truncated", "… (truncated)")
                : body)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(Color.TS.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, TSSpacing.xs)
        } label: {
            WebhookStrings.text("webhookChannels.test.body", "Response body")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
        }
        .tint(Color.TS.textMuted)
    }
}
