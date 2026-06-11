//
//  ExportModal.States.swift
//  TeslaSync — P4 modal / dialog · 0023 · ExportModal (Apple)
//
//  The chrome + leaf states `ExportModal` composes: the pinned header (export glyph + title + freshness
//  chip + close), the live-state freshness chip + connectivity / inline-error banners, and the loading /
//  empty / error leaf states. Every state renders real chrome — never a blank box (engineering guideline
//  #6). The populated export panel lives in ExportModal.Views.swift. Copy via P1/S10 (`ExportStrings`);
//  chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Header (web `Modal` title bar)

/// The pinned header: the export glyph, the "Export Dashboard" title + freshness chip, and the trailing
/// close button (web `Modal` title bar with its `onClose` "×").
struct ExportHeader: View {
    let connection: ExportConnection
    let title: String
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
                if connection != .live {
                    ExportFreshnessChip(connection: connection)
                }
            }
            Spacer(minLength: TSSpacing.sm)
            closeButton
        }
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .contain)
    }

    private var iconChip: some View {
        Image(systemName: "square.and.arrow.up")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Color.TS.accent)
            .frame(width: 32, height: 32)
            .background(Color.TS.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: TSRadius.md))
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

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound dashboard source's live-state (ADR-013).
struct ExportFreshnessChip: View {
    let connection: ExportConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            ExportStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(descriptor.tone.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(ExportStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: ExportConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "export.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "export.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "export.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity + inline-error banners

/// The cached-data banner shown above the panel when the bound dashboard source is not live, so a cached
/// dashboard is clearly labeled while reconnecting / offline (ADR-013).
struct ExportConnectivityBanner: View {
    let connection: ExportConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "export.offlineBanner" : "export.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded dashboard"
            : "Reconnecting — this dashboard may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            ExportStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// The inline reload error shown above the panel when a reload failed but the cached dashboard remains
/// (added so a failed refresh never blanks the export panel).
struct ExportInlineErrorBanner: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            ExportStrings.text("export.reloadError", "Couldn't refresh this dashboard")
                .font(Font.TS.caption)
            if !message.isEmpty {
                Text(verbatim: message).font(Font.TS.caption).lineLimit(1)
            }
        }
        .foregroundStyle(Color.TS.statusDanger)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading (outline chrome)

/// The first-load outline (the dashboard in flight): a redaction-free outline of the summary + the three
/// action rows so the layout doesn't reflow when the data resolves. A gentle opacity pulse runs unless
/// Reduce Motion is on.
struct ExportLoadingState: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                bar(width: 120, height: 80)
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    bar(width: 160, height: 16)
                    bar(width: 120, height: 14)
                    bar(width: 90, height: 12)
                }
            }
            ForEach(0 ..< 3, id: \.self) { _ in
                bar(width: nil, height: 40)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .opacity(pulsing ? 0.55 : 1)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: TSMotion.slowDuration).repeatForever(autoreverses: true)) {
                pulsing = true
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(ExportStrings.text("export.loading", "Loading export…"))
    }

    private func bar(width: CGFloat?, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(Color.TS.textMuted.opacity(0.16))
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
    }
}

// MARK: - Empty (dashboard not found)

/// The resolved-but-absent dashboard state (e.g. it was deleted while the sheet was opening), over a
/// native `ContentUnavailableView` so the dialog is never a blank box.
struct ExportEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                ExportStrings.text("export.emptyTitle", "Dashboard unavailable")
            } icon: {
                Image(systemName: "square.dashed")
            }
        } description: {
            ExportStrings.text(
                "export.emptyMessage",
                "This dashboard couldn't be found. It may have been deleted."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (load failed)

/// The first-load failure state with a retry affordance (no resolved dashboard to fall back on), so the
/// dialog isn't a blank box.
struct ExportErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            ExportStrings.text("export.error", "Couldn't load this dashboard")
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
                ExportStrings.text("export.retry", "Retry")
            }
            .padding(.top, TSSpacing.xs)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Localization Text helper

extension ExportStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so resolved values are never
    /// re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
