//
//  PresetGallery.States.swift
//  TeslaSync — P4 feature view · 0085 · AutomationPresetGallery (Apple)
//
//  The non-content states `PresetGallery` switches over — loading (web four
//  `PresetCardSkeleton`s in the grid), empty (web `EmptyState` with the clock glyph),
//  error (web first-load failure widened to a retry panel), the inline list-error, and
//  the live-state freshness chip + cached-data banner. Every state renders real chrome —
//  never a blank box. Copy via P1/S10; chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Skeleton card (web `PresetCardSkeleton`)

/// One redacted preset card shown while the presets load (web `PresetCardSkeleton`): the
/// icon chip, the name + subtitle lines, the description block, and the action button.
struct AutomationPresetCardSkeleton: View {
    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(alignment: .top, spacing: TSSpacing.md) {
                    TSSkeleton(width: 40, height: 40, cornerRadius: TSRadius.md)
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(width: 128, height: 14)
                        TSSkeleton(width: 80, height: 12)
                    }
                }
                TSSkeleton(height: 32)
                TSSkeleton(height: 28)
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Loading (web four skeletons in the grid)

/// The first-paint loading state: the same responsive grid filled with skeleton cards,
/// so the layout doesn't reflow when the presets arrive (web four `PresetCardSkeleton`).
struct AutomationPresetGalleryLoadingState: View {
    private let skeletonCount = 4

    var body: some View {
        LazyVGrid(columns: AutomationPresetGalleryLayout.columns, spacing: TSSpacing.lg) {
            ForEach(0 ..< skeletonCount, id: \.self) { _ in
                AutomationPresetCardSkeleton()
            }
        }
        .accessibilityLabel(AutomationPresetGalleryStrings.text("automations.presets.loading", "Loading presets…"))
    }
}

// MARK: - Empty (web `EmptyState` with the clock glyph)

/// The resolved-but-no-presets state (web `EmptyState` icon + message) over the shared
/// `TSEmptyState`. Never a blank box.
struct AutomationPresetGalleryEmptyState: View {
    var body: some View {
        TSEmptyState(
            title: LocalizedStringKey(
                AutomationPresetGalleryStrings.string("automations.presets.empty", "No preset templates available")
            ),
            systemImage: "clock"
        )
        .frame(maxWidth: .infinity, minHeight: 200)
    }
}

// MARK: - Error (web first-load failure → retry)

/// The fetch-failure state with a retry affordance (web first-load failure widened to a
/// `QueryError`-style panel so it isn't a blank box).
struct AutomationPresetGalleryErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            AutomationPresetGalleryStrings.text("automations.presets.errors.load", "Failed to load presets.")
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
                AutomationPresetGalleryStrings.text("automations.presets.retry", "Retry")
            }
            .accessibilityLabel(AutomationPresetGalleryStrings.text("automations.presets.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Inline list-error (above the populated grid)

/// The inline list-load error shown above the populated grid when a reload failed but
/// cached items remain (web cached-data refresh failure).
struct AutomationPresetGalleryInlineError: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            AutomationPresetGalleryStrings.text("automations.presets.errors.load", "Failed to load presets.")
                .font(Font.TS.caption)
            if !message.isEmpty {
                Text(verbatim: message).font(Font.TS.caption)
            }
        }
        .foregroundStyle(Color.TS.statusDanger)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct AutomationPresetGalleryFreshnessChip: View {
    let connection: AutomationPresetGalleryConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            AutomationPresetGalleryStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(AutomationPresetGalleryStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: AutomationPresetGalleryConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "automations.presets.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "automations.presets.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "automations.presets.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the content when the bound source is not live, so a
/// cached list is clearly labeled (ADR-013).
struct AutomationPresetGalleryConnectivityBanner: View {
    let connection: AutomationPresetGalleryConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "automations.presets.offlineBanner" : "automations.presets.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded presets"
            : "Reconnecting — this list may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            AutomationPresetGalleryStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
