//
//  WebhookChannelsSection.Views.swift
//  TeslaSync — P4 feature view · 0218 · WebhookChannelsSection (Apple)
//
//  Presentational chrome composed by `WebhookChannelsSection`: the panel header
//  (icon + title + subtitle + freshness chip + "Add webhook"), the stale/offline
//  connectivity banner, one channel row (status pills + Active toggle + Test / Edit /
//  Delete + the inline test-result panel), the "payload variables" docs panel, and
//  the loading / empty / error states. All copy resolves through the P1/S10 facade;
//  all chrome is token-driven (P1/S9). No networking and no Tailwind ports live here.
//

import SwiftUI
#if os(iOS)
    import UIKit
#elseif os(macOS)
    import AppKit
#endif

// MARK: - Shared glyphs + clipboard

enum WebhookGlyph {
    static let webhook = "point.3.connected.trianglepath.dotted"
    static let add = "plus"
    static let test = "paperplane"
    static let edit = "pencil"
    static let delete = "trash"
    static let copy = "doc.on.doc"
    static let error = "exclamationmark.triangle.fill"
}

enum WebhookClipboard {
    static func copy(_ value: String) {
        #if os(iOS)
            UIPasteboard.general.string = value
        #elseif os(macOS)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(value, forType: .string)
        #endif
    }
}

// MARK: - Action button (port of the web `Button`)

/// A small action button with a leading SF Symbol + a loading spinner (port of the
/// web `Button`). Title + a11y label resolve through the surface i18n facade.
struct WebhookButton: View {
    let titleKey: String
    let fallback: String
    var systemImage: String?
    var destructive = false
    var loading = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                if loading {
                    ProgressView().controlSize(.mini).tint(foreground)
                } else if let systemImage {
                    Image(systemName: systemImage).font(.system(size: 12, weight: .semibold))
                }
                WebhookStrings.text(titleKey, fallback)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
            }
            .foregroundStyle(foreground)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .frame(minHeight: 34)
            .background(Color.TS.accent, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(loading)
        .accessibilityLabel(WebhookStrings.text(titleKey, fallback))
    }

    private var foreground: Color {
        destructive ? Color.TS.statusDanger : Color.white
    }
}

/// A compact icon-only button (Test / Edit / Delete row actions).
struct WebhookIconButton: View {
    let systemImage: String
    let labelKey: String
    let fallback: String
    var tone: Color = .TS.textMuted
    var loading = false
    var disabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if loading {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: systemImage).font(.system(size: 14, weight: .semibold))
                }
            }
            .foregroundStyle(tone)
            .frame(width: 32, height: 32)
            .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(disabled || loading)
        .opacity(disabled ? 0.5 : 1)
        .accessibilityLabel(WebhookStrings.text(labelKey, fallback))
    }
}

// MARK: - Pills (ports of the web `Badge`)

/// A tone capsule pill rendering pre-resolved text (port of the web `Badge`).
struct WebhookPill: View {
    let text: String
    var tone: Color = .TS.textMuted

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.opacity(0.3), lineWidth: 1))
    }
}

// MARK: - Header

/// The panel header: webhook icon box, the title + subtitle, the freshness chip, and
/// the "Add webhook" button (web header row + `Add webhook`).
struct WebhookHeader: View {
    let connection: WebhookConnection
    let refreshing: Bool
    let updatedAt: Date?
    let onAdd: () -> Void
    let onRefresh: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                Image(systemName: WebhookGlyph.webhook)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .frame(width: 36, height: 36)
                    .background(
                        Color.TS.accent.opacity(0.12),
                        in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    )
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    WebhookStrings.text("webhookChannels.title", "Webhook channels")
                        .font(Font.TS.section)
                        .foregroundStyle(Color.TS.textPrimary)
                        .accessibilityAddTraits(.isHeader)
                    WebhookStrings.text(
                        "webhookChannels.subtitle",
                        "Forward TeslaSync notifications to Discord, Slack, n8n, Home Assistant, "
                            + "or any HTTP receiver. Each channel can be HMAC-signed so receivers can "
                            + "verify authenticity."
                    )
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: TSSpacing.sm)
                WebhookFreshnessChip(connection: connection, refreshing: refreshing, onRefresh: onRefresh)
            }
            HStack {
                Spacer(minLength: 0)
                WebhookButton(
                    titleKey: "webhookChannels.addButton",
                    fallback: "Add webhook",
                    systemImage: WebhookGlyph.add,
                    action: onAdd
                )
            }
        }
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The tappable header freshness chip reflecting the bound source's live-state
/// (ADR-013). Tapping refreshes the shared query.
struct WebhookFreshnessChip: View {
    let connection: WebhookConnection
    let refreshing: Bool
    let onRefresh: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var spin = false

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(tone).frame(width: 6, height: 6)
                Image(systemName: symbol)
                    .font(.system(size: 9, weight: .semibold))
                    .rotationEffect(.degrees(spin && refreshing && !reduceMotion ? 360 : 0))
                    .animation(spinAnimation, value: spin)
                WebhookStrings.text(labelKey, labelFallback)
                    .font(Font.TS.caption)
            }
            .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .onAppear { spin = refreshing }
        .onChange(of: refreshing) { _, value in spin = value }
        .accessibilityLabel(WebhookStrings.text("webhookChannels.refresh", "Refresh"))
        .accessibilityValue(WebhookStrings.text(labelKey, labelFallback))
    }

    private var spinAnimation: Animation? {
        reduceMotion ? nil : .linear(duration: 1).repeatForever(autoreverses: false)
    }

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var symbol: String {
        switch connection {
        case .live: refreshing ? "arrow.triangle.2.circlepath" : "wifi"
        case .stale: "clock.arrow.circlepath"
        case .offline: "wifi.slash"
        }
    }

    private var labelKey: String {
        switch connection {
        case .live: "webhookChannels.live"
        case .stale: "webhookChannels.stale"
        case .offline: "webhookChannels.offline"
        }
    }

    private var labelFallback: String {
        switch connection {
        case .live: "Live"
        case .stale: "Stale"
        case .offline: "Offline"
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the list when the bound source is not live,
/// so the cached list is clearly labeled.
struct WebhookConnectivityBanner: View {
    let connection: WebhookConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "webhookChannels.offlineBanner" : "webhookChannels.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded webhooks"
            : "Reconnecting — webhook list may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            WebhookStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(tone.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
