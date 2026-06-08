//
//  MediaNowPlayingWidget.swift
//  TeslaSync — P4 dashboard widget · 0063 · MediaNowPlayingWidget (Apple)
//
//  The composable "Now Playing" dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/MediaNowPlayingWidget.tsx. Binds through
//  MediaNowPlayingModel (no networking in the view); renders every state.
//

import Foundation
import SwiftUI

// MARK: - MediaNowPlayingWidget (the dashboard surface)

/// The composable "Now Playing" dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/MediaNowPlayingWidget.tsx`. It renders every state
/// from the web source (loading / empty / error / stale / offline / content)
/// inside a glass widget shell, binding through `MediaNowPlayingModel` (P1/S8).
/// No networking lives here.
public struct MediaNowPlayingWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "MediaNowPlayingWidget"

    /// Canonical registry metadata (registry/media.ts → "media-now-playing").
    public static let registration = DashboardWidgetRegistration(
        id: "media-now-playing",
        nameKey: "widget.nowPlaying",
        descriptionKey: "widget.nowPlaying.description",
        category: "media",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: MediaNowPlayingModel
    private let size: DashboardWidgetSize

    public init(
        model: MediaNowPlayingModel,
        size: DashboardWidgetSize = MediaNowPlayingWidget.registration.defaultSize
    ) {
        _model = State(initialValue: model)
        self.size = MediaNowPlayingWidget.registration.clamp(size)
    }

    /// Web `isCompact = size.cols === 1 && size.rows === 1`.
    var isCompact: Bool {
        size.cols == 1 && size.rows == 1
    }

    /// Web `isTall = size.rows >= 2`.
    var isTall: Bool {
        size.rows >= 2
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if !isCompact { header }
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .overlay(alignment: .topTrailing) {
            if isCompact { compactFreshnessDot.padding(TSSpacing.sm) }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

extension MediaNowPlayingWidget {
    // MARK: Header (web `WidgetShell` chrome)

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "music.note")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            MediaNowPlayingStrings.text("widget.nowPlaying", "Now Playing")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
        }
    }

    private var freshnessChip: some View {
        let display = connectionDisplay
        return HStack(spacing: 4) {
            Circle().fill(display.tone).frame(width: 6, height: 6)
            Text(verbatim: display.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: display.label))
    }

    private var compactFreshnessDot: some View {
        Circle()
            .fill(connectionDisplay.tone)
            .frame(width: 8, height: 8)
            .accessibilityLabel(Text(verbatim: connectionDisplay.label))
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(MediaNowPlayingStrings.text("widget.media.refresh", "Refresh"))
    }

    private var connectionDisplay: (tone: Color, label: String) {
        switch model.connection {
        case .live:
            (Color.TS.statusSuccess, MediaNowPlayingStrings.string("widget.media.live", "Live"))
        case .stale:
            (Color.TS.statusWarning, MediaNowPlayingStrings.string("widget.media.stale", "Stale"))
        case .offline:
            (Color.TS.textMuted, MediaNowPlayingStrings.string("widget.media.offline", "Offline"))
        }
    }

    // MARK: Content states (every web state renders)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            contentBody
        }
    }

    private var contentBody: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live, !isCompact { connectivityBanner }
            if let media = model.media {
                MediaNowPlayingContent(media: media, isCompact: isCompact, isTall: isTall)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.md) {
                TSSkeleton(width: 40, height: 40, cornerRadius: TSRadius.md)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    TSSkeleton(height: 12).frame(maxWidth: 140)
                    TSSkeleton(height: 10).frame(maxWidth: 90)
                }
            }
            TSSkeleton(height: 4, cornerRadius: TSRadius.pill)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement()
        .accessibilityLabel(MediaNowPlayingStrings.text("widget.media.loading", "Loading media"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                MediaNowPlayingStrings.text("widget.noMedia", "Nothing playing")
            } icon: {
                Image(systemName: "music.note")
            }
        } description: {
            MediaNowPlayingStrings.text(
                "widget.media.emptyHint",
                "Start playback in your vehicle to see it here."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            MediaNowPlayingStrings.text("widget.media.errorTitle", "Couldn't load media")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button {
                model.refresh()
            } label: {
                MediaNowPlayingStrings.text("widget.media.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.media.offlineBanner" : "widget.media.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known media"
            : "Reconnecting — media may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            MediaNowPlayingStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
