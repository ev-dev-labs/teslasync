//
//  WebhookChannelsSection.States.swift
//  TeslaSync — P4 feature view · 0218 · WebhookChannelsSection (Apple)
//
//  The payload-variables docs panel (web docs block) and the loading / empty / error
//  states (web `Spinner` / `EmptyState` / `loadError` branches). Split from
//  WebhookChannelsSection.Views.swift to respect the house file-length limit. Every
//  state renders real chrome — never a blank box. Token-driven + localized.
//

import SwiftUI

// MARK: - Docs panel (web "Available payload variables")

/// The documented payload-variables panel (web docs block): the title, the intro,
/// and a bullet list of the JSON envelope fields with localized descriptions.
struct WebhookDocsPanel: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            WebhookStrings.text("webhookChannels.docs.title", "Available payload variables")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            WebhookStrings.text(
                "webhookChannels.docs.intro",
                "Webhook receivers get a JSON envelope with these fields:"
            )
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textMuted)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                ForEach(WebhookChannelsContent.payloadVariables) { variable in
                    WebhookDocsRow(variable: variable)
                }
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
    }
}

/// One payload-variable bullet: the code token + its localized description.
struct WebhookDocsRow: View {
    let variable: WebhookChannelsContent.PayloadVariable

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: "•").foregroundStyle(Color.TS.textMuted).accessibilityHidden(true)
            Text(verbatim: variable.code)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(Color.TS.accent)
            WebhookStrings.text("webhookChannels.docs.dash", "—")
                .foregroundStyle(Color.TS.textMuted)
            WebhookStrings.text(variable.descriptionKey, variable.descriptionFallback)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading / empty / error states

/// The initial-fetch skeleton chrome (web `<Spinner>` loading branch), widened to a
/// representative list skeleton so the surface never shows a blank box.
struct WebhookLoadingChrome: View {
    var body: some View {
        VStack(spacing: TSSpacing.md) {
            ForEach(0 ..< 3, id: \.self) { _ in
                TSSkeleton(height: 88, cornerRadius: TSRadius.md)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(WebhookStrings.text("webhookChannels.loading", "Loading webhook channels"))
    }
}

/// The resolved-but-empty state (web `EmptyState` — "No webhooks yet"), with the
/// "Add your first webhook" call to action. Never a blank box.
struct WebhookEmptyState: View {
    let onAdd: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: WebhookGlyph.webhook)
                .font(.system(size: 30))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            WebhookStrings.text("webhookChannels.empty.title", "No webhooks yet")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            WebhookStrings.text(
                "webhookChannels.empty.message",
                "Add a webhook to forward TeslaSync events to your favourite chat or automation tool."
            )
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textSecondary)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            WebhookButton(
                titleKey: "webhookChannels.empty.action",
                fallback: "Add your first webhook",
                systemImage: WebhookGlyph.add,
                action: onAdd
            )
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.x3xl)
        .accessibilityElement(children: .combine)
    }
}

/// The fetch-failure state with a retry affordance (web `loadError` branch).
struct WebhookErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: WebhookGlyph.error)
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: WebhookStrings.interpolate(
                "webhookChannels.loadError", "Failed to load webhook channels: {{error}}",
                ["error": message]
            ))
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textSecondary)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            WebhookButton(
                titleKey: "webhookChannels.retry",
                fallback: "Retry",
                systemImage: "arrow.clockwise",
                action: onRetry
            )
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.x3xl)
        .accessibilityElement(children: .combine)
    }
}
