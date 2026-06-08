//
//  AlertMessageEditor.States.swift
//  TeslaSync — P4 feature view · 0180 · AlertMessageEditor (Apple)
//
//  The load-state chrome for the message-template editor: the autocomplete spinner / no-matches row,
//  the live-preview loading / empty / error rows, the preset gallery loading / empty / error states,
//  the live-state freshness chip, and the stale / offline connectivity banner. Token-driven (P1/S9);
//  copy via the P1/S10 facade. Never a blank panel.
//

import SwiftUI

// MARK: - Token autocomplete states (web spinner / no-matches text)

/// The spinner row shown while the token catalog is in flight (web `Loading…`).
struct TokenAutocompleteLoadingRow: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            ProgressView()
                .controlSize(.small)
                .accessibilityHidden(true)
            AlertMessageEditorStrings.text("common.loading", "Loading…")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

/// The resolved-but-empty row (web autocomplete "no matches" text).
struct TokenAutocompleteEmptyRow: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "text.badge.xmark")
                .font(.system(size: 13))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            AlertMessageEditorStrings.text("alertEditor.autocompleteEmpty", "No matching suggestions")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Live preview states (web PreviewPanel branches)

/// The "rendering" row shown while the first preview is in flight (web `Loading…`).
struct PreviewLoadingRow: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            ProgressView().controlSize(.small).accessibilityHidden(true)
            AlertMessageEditorStrings.text("common.loading", "Loading…")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// The pre-typing empty hint (web "Start typing to see a preview").
struct PreviewEmptyRow: View {
    var body: some View {
        AlertMessageEditorStrings.text("alertEditor.previewEmpty", "Start typing to see a preview")
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
    }
}

/// The preview-failure row (web red `previewError`).
struct PreviewErrorRow: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 12))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.statusDanger)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: message))
    }
}

// MARK: - Preset gallery states (web modal loading / empty + native error)

/// The centered preset loading state (web `Loading…`).
struct PresetGalleryLoadingState: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ProgressView().controlSize(.regular).accessibilityHidden(true)
            AlertMessageEditorStrings.text("common.loading", "Loading…")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, minHeight: 140)
        .accessibilityElement(children: .combine)
    }
}

/// The "no presets match this filter" state (web empty gallery), a friendly `ContentUnavailableView`.
struct PresetGalleryEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                AlertMessageEditorStrings.text("alertEditor.presetEmpty", "No presets match this filter")
            } icon: {
                Image(systemName: "rectangle.on.rectangle.slash")
            }
        } description: {
            AlertMessageEditorStrings.text(
                "alertEditor.presetEmptyHint",
                "Clear the filter or pick a different category."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 140)
    }
}

/// The preset load-failure state with a retry affordance (web `QueryError` intent; the gallery modal
/// has room, and the prompt requires a visible error).
struct PresetGalleryErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            AlertMessageEditorStrings.text("alertEditor.presetErrorTitle", "Couldn't load presets")
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
            Button(action: onRetry) {
                AlertMessageEditorStrings.text("alertEditor.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(AlertMessageEditorStrings.text("alertEditor.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip + connectivity banner (ADR-013)

/// The freshness chip reflecting the bound source's live-state.
struct AlertEditorFreshnessChip: View {
    let connection: AlertMessageConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            AlertMessageEditorStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(AlertMessageEditorStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: AlertMessageConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "alertEditor.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "alertEditor.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "alertEditor.offline", fallback: "Offline")
        }
    }
}

/// The stale / offline banner shown above the editor when the bound source is not live, so cached
/// catalogs are clearly labelled.
struct AlertEditorConnectivityBanner: View {
    let connection: AlertMessageConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "alertEditor.offlineBanner" : "alertEditor.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded presets and suggestions"
            : "Reconnecting — preset and suggestion data may be delayed"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            AlertMessageEditorStrings.text(key, fallback).font(Font.TS.caption)
            Spacer(minLength: 0)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
