//
//  AddAnnotationPopover.States.swift
//  TeslaSync — P4 modal/dialog · 0002 · AddAnnotationPopover (Apple)
//
//  The non-content states `AddAnnotationPopover` switches over — loading (web Spinner), empty
//  (resolved with no annotatable target), error (web `QueryError` with retry), the inline reload
//  error, and the live-state freshness chip + cached-data banner. Every state renders real chrome —
//  never a blank box. Copy via P1/S10; chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (web Spinner)

/// The first-paint loading state rendered under the header (web `<Spinner/>`), so the layout doesn't
/// reflow when the draft context resolves.
struct AddAnnotationLoadingState: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            ProgressView().controlSize(.small)
            AddAnnotationStrings.text("addAnnotation.loading", "Preparing annotation…")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty (resolved with no annotatable target)

/// The resolved-but-no-target state over a native `ContentUnavailableView` (never a blank box). The
/// web always has a timestamp; this guards the no-anchor edge (a fixed date that fails to normalise
/// and no editable date) so the surface always renders something friendly.
struct AddAnnotationEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                AddAnnotationStrings.text("addAnnotation.empty", "No point selected to annotate")
            } icon: {
                Image(systemName: "mappin.slash")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web `QueryError` with retry)

/// The load-failure state with a retry affordance (web `QueryError` — a first-load failure rendered
/// as a panel with a retry, never a blank box).
struct AddAnnotationErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            AddAnnotationStrings.text("addAnnotation.errors.load", "Couldn't open the annotation form.")
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
        .frame(maxWidth: .infinity, minHeight: 180)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button(action: onRetry) {
            AddAnnotationStrings.text("addAnnotation.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(AddAnnotationStrings.text("addAnnotation.retry", "Retry"))
    }
}

// MARK: - Inline reload error (web cached-context-with-failure)

/// The inline reload error shown above the form when a refresh failed but a cached context remains
/// (web reload-failure-with-cached-data).
struct AddAnnotationInlineError: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            AddAnnotationStrings.text("addAnnotation.errors.load", "Couldn't open the annotation form.")
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
struct AddAnnotationFreshnessChip: View {
    let connection: AddAnnotationConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            AddAnnotationStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(AddAnnotationStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: AddAnnotationConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "addAnnotation.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "addAnnotation.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "addAnnotation.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the form when the bound source is not live, so the user knows
/// a saved annotation may not have synced yet (ADR-013).
struct AddAnnotationConnectivityBanner: View {
    let connection: AddAnnotationConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "addAnnotation.offlineBanner" : "addAnnotation.staleBanner"
        let fallback = offline
            ? "Offline — your annotation will sync when you reconnect"
            : "Reconnecting — your annotation may not be saved yet"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            AddAnnotationStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
