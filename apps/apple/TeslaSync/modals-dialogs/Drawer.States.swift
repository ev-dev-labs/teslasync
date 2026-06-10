//
//  Drawer.States.swift
//  TeslaSync — P4 modal / dialog · 0013 · Drawer (Apple)
//
//  The non-content states the panel body switches over — loading (skeleton rows), empty
//  (`ContentUnavailableView`), error (web `QueryError` with retry), the header freshness chip, and the
//  cached-data connectivity banner. Every state renders real chrome — never a blank box. Copy via
//  P1/S10; chrome via P1/S9 tokens (no web Tailwind ported).
//

import SwiftUI

// MARK: - Loading (skeleton rows)

/// The first-paint loading state — token-driven skeleton rows that mirror the label/value body shape,
/// so the panel doesn't reflow when the rows resolve.
struct DrawerLoadingBody: View {
    var body: some View {
        VStack(spacing: TSSpacing.md) {
            ForEach(0 ..< 5, id: \.self) { _ in
                DrawerSkeletonRow()
            }
        }
        .padding(TSSpacing.x2xl)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(DrawerStrings.text("drawer.loading", "Loading…"))
    }
}

/// One shimmering skeleton row: a short label bar and a wider value bar over the token surface.
private struct DrawerSkeletonRow: View {
    @State private var shimmer = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            bar(width: 96)
            Spacer(minLength: TSSpacing.lg)
            bar(width: 64)
        }
        .opacity(shimmer ? 0.45 : 1)
        .animation(animation, value: shimmer)
        .onAppear { if !reduceMotion { shimmer = true } }
    }

    private func bar(width: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(Color.TS.textMuted.opacity(0.18))
            .frame(width: width, height: 12)
    }

    private var animation: Animation? {
        reduceMotion ? nil : .easeInOut(duration: TSMotion.slowDuration).repeatForever(autoreverses: true)
    }
}

// MARK: - Empty (no rows)

/// The resolved-but-no-rows state over a native `ContentUnavailableView` (never a blank box). The web
/// container would simply host empty children; this surfaces a friendly empty state instead.
struct DrawerEmptyBody: View {
    let message: String

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: message)
            } icon: {
                Image(systemName: "tray")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web `QueryError` with retry)

/// The load-failure state with a retry affordance (web `QueryError` — a first-resolve failure rendered
/// as a panel with a retry, never a blank box).
struct DrawerErrorBody: View {
    let message: String
    let retryLabel: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            DrawerStrings.text("drawer.error.title", "Couldn't load this panel.")
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
        .padding(TSSpacing.x2xl)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button(action: onRetry) {
            Text(verbatim: retryLabel)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.lg)
                .padding(.vertical, TSSpacing.sm)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: retryLabel))
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013). A short word inside a
/// tinted chip, so it reads as a status badge rather than body text.
struct DrawerFreshnessChip: View {
    let connection: DrawerConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            DrawerStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.label)
                .foregroundStyle(descriptor.tone)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(descriptor.tone.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(descriptor.tone.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(DrawerStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: DrawerConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "drawer.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "drawer.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "drawer.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the body when the bound source is not live, so the user knows
/// the rows may be momentarily out of date (ADR-013). Rendered even when the surface is headerless, so
/// the stale / offline states are never silent.
struct DrawerConnectivityBanner: View {
    let connection: DrawerConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "drawer.offlineBanner" : "drawer.staleBanner"
        let fallback = offline
            ? "Offline — showing cached data"
            : "Reconnecting — showing the last loaded data"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            DrawerStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.x2xl)
        .padding(.vertical, TSSpacing.sm)
        .background(tone.opacity(0.12))
        .accessibilityElement(children: .combine)
    }
}
