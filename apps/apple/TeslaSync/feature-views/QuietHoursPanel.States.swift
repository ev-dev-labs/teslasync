//
//  QuietHoursPanel.States.swift
//  TeslaSync — P4 feature view · 0210 · QuietHoursPanel (Apple)
//
//  The non-content states `QuietHoursPanel` renders — loading (web Spinner row), empty
//  (web `<EmptyState>`), error (a `QueryError`-style panel with retry, the prompt-
//  required first-load-failure envelope), the inline list-error, the live-state
//  freshness chip, the cached-data banner, and the save/delete toast. Every state
//  renders real chrome — never a blank box. Copy via P1/S10; chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (web Spinner + "Loading quiet-hours windows…")

/// The first-paint loading row rendered inside the panel chrome (web `<Spinner/>
/// Loading quiet-hours windows…`), so the layout doesn't reflow when data arrives.
struct QuietHoursLoadingState: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            ProgressView().controlSize(.small)
            QuietHoursStrings.text("quietHours.loading", "Loading quiet-hours windows…")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty (web `<EmptyState>`)

/// The resolved-but-no-windows state (web `<EmptyState>` with the Moon glyph) over a
/// native `ContentUnavailableView`. The primary "Add window" CTA already lives in the
/// panel header, so this state carries no action (web `no-action` comment).
struct QuietHoursEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                QuietHoursStrings.text(
                    "quietHours.empty",
                    "No quiet-hours windows yet. Add one to defer non-critical notifications "
                        + "during sleep or meetings."
                )
            } icon: {
                Image(systemName: "moon.zzz")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (the prompt-required first-load-failure envelope + retry)

/// The fetch-failure state with a retry affordance — a `QueryError`-style panel so a
/// first-load failure with no cached rows isn't a blank box.
struct QuietHoursErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            QuietHoursStrings.text("quietHours.errors.load", "Failed to load quiet-hours windows.")
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
            retryButton
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button(action: onRetry) {
            QuietHoursStrings.text("quietHours.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(QuietHoursStrings.text("quietHours.retry", "Retry"))
    }
}

// MARK: - Inline list-error (native envelope: failed reload with cached rows)

/// The inline list-load error shown above the populated rows when a reload failed but
/// cached rows remain on screen, so the list stays visible while the failure surfaces.
struct QuietHoursInlineError: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            QuietHoursStrings.text("quietHours.errors.load", "Failed to load quiet-hours windows.")
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
struct QuietHoursFreshnessChip: View {
    let connection: QuietHoursConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            QuietHoursStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(QuietHoursStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: QuietHoursConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "quietHours.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "quietHours.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "quietHours.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the content when the bound source is not live, so
/// a cached list is clearly labeled (ADR-013).
struct QuietHoursConnectivityBanner: View {
    let connection: QuietHoursConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "quietHours.offlineBanner" : "quietHours.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded windows"
            : "Reconnecting — this list may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            QuietHoursStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Toast (web `useToast`)

/// The transient save/delete toast surfaced over the panel top (web `toast.success` /
/// `toast.error`). Renders pre-localized copy verbatim with a manual dismiss.
struct QuietHoursToastView: View {
    let toast: QuietHoursToast
    let onDismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: symbol).foregroundStyle(tone).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: toast.title)
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                if !toast.message.isEmpty {
                    Text(verbatim: toast.message)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                }
            }
            Spacer(minLength: TSSpacing.sm)
            Button(action: onDismiss) {
                Image(systemName: "xmark").font(.caption2)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(QuietHoursStrings.text("quietHours.toast.dismiss", "Dismiss"))
        }
        .padding(TSSpacing.md)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
    }

    private var tone: Color {
        switch toast.kind {
        case .success: Color.TS.statusSuccess
        case .error: Color.TS.statusDanger
        }
    }

    private var symbol: String {
        switch toast.kind {
        case .success: "checkmark.circle.fill"
        case .error: "exclamationmark.triangle.fill"
        }
    }
}
