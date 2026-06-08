//
//  LiveControls.States.swift
//  TeslaSync — P4 feature view · 0233 · LiveControls (Apple)
//
//  The P4 states-contract chrome the web controlled leaf delegates to its parent:
//  the loading skeleton, the query-error retry (web `QueryError` equivalent), and
//  the stale/offline status chips. All render inside the shared `LiveControlsPanel`
//  (defined in LiveControls.Views.swift) so the surface keeps a consistent toolbar
//  shape and never flashes a blank box. Copy resolves through the P1/S10 facade;
//  color comes from the P1/S9 tokens via the `LiveControlsTone` mapping.
//

import SwiftUI

// MARK: - Loading chrome (P4 states contract)

/// The initial buffer-query load: redacted control + counter blocks over the shared
/// `TSSkeleton`, inside the same panel chrome so the surface never flashes blank.
struct LiveControlsLoadingView: View {
    var body: some View {
        LiveControlsPanel {
            HStack(spacing: TSSpacing.sm) {
                TSSkeleton(width: 64, height: 28, cornerRadius: TSRadius.md)
                TSSkeleton(width: 64, height: 28, cornerRadius: TSRadius.md)
                TSSkeleton(width: 28, height: 28, cornerRadius: TSRadius.md)
                TSSkeleton(width: 28, height: 28, cornerRadius: TSRadius.md)
                TSSkeleton(width: 80, height: 28, cornerRadius: TSRadius.md)
                Spacer(minLength: TSSpacing.sm)
                TSSkeleton(width: 96, height: 12)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: LiveControlsCopy.loading.resolved(LiveControlsStrings.string)))
    }
}

// MARK: - Error chrome (web `QueryError` equivalent — parent query failure)

/// The buffer-query failure branch: a danger glyph, the localized message, and a
/// retry control wired to the bound source's `refresh`, inside the panel chrome.
struct LiveControlsErrorView: View {
    let onRetry: () -> Void

    var body: some View {
        LiveControlsPanel {
            HStack(spacing: TSSpacing.md) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: LiveControlsCopy.errorMessage.resolved(LiveControlsStrings.string))
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: TSSpacing.sm)
                LiveControlsRetryButton(action: onRetry)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

/// The native retry control (states-contract affordance, wired to `refresh`).
struct LiveControlsRetryButton: View {
    let action: () -> Void

    var body: some View {
        let label = LiveControlsCopy.retry.resolved(LiveControlsStrings.string)
        return Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11, weight: .semibold))
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.accent.opacity(0.16), in: Capsule())
            .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Status chips (P4 stale + offline chrome)

/// A tinted status chip mirroring `TSBadge` (capsule, tone fill 0.15 + stroke 0.3)
/// but resolving its label through the per-surface facade. Used for the stale +
/// offline banners the web leaf has no notion of.
struct LiveControlsStatusChip: View {
    let copy: LiveControlsText
    let tone: LiveControlsTone
    let systemImage: String

    var body: some View {
        let label = copy.resolved(LiveControlsStrings.string)
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage)
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityLabel(Text(verbatim: label))
    }
}
