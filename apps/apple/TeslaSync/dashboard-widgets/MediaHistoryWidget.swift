//
//  MediaHistoryWidget.swift
//  TeslaSync — P4 dashboard widget · 0062 · MediaHistoryWidget (Apple)
//
//  The composable Media History dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/MediaHistoryWidget.tsx. Binds through
//  MediaHistoryModel (no networking in the view); renders every state.
//

import Foundation
import SwiftUI

// MARK: - MediaHistoryWidget (the dashboard surface)

/// The composable Media History dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/MediaHistoryWidget.tsx`. Renders every state from
/// the web source (loading / empty / error / stale / offline / content) inside a
/// glass widget shell, binding through `MediaHistoryModel` (P1/S8). No networking
/// lives here.
public struct MediaHistoryWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "MediaHistoryWidget"

    /// Canonical registry metadata (registry/media.ts → "media-history"). Reuses
    /// the shared dashboard registry types declared by the DigitalTwin sibling.
    public static let registration = DashboardWidgetRegistration(
        id: "media-history",
        nameKey: "widget.mediaHistory",
        descriptionKey: "widget.mediaHistory.description",
        category: "media",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: MediaHistoryModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: MediaHistoryModel,
        size: DashboardWidgetSize = MediaHistoryWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = MediaHistoryWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// The web `size.cols <= 1` single-track compact layout.
    private var isCompact: Bool {
        size.cols <= 1
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

extension MediaHistoryWidget {
    // MARK: Header (web WidgetShell title row)

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "music.note.list")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            MediaHistoryStrings.text("widget.mediaHistory", "Media History")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
            if onOpen != nil { openButton }
        }
    }

    private var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = MediaHistoryStrings.string("widget.media.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = MediaHistoryStrings.string("widget.media.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = MediaHistoryStrings.string("widget.media.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(MediaHistoryStrings.text("widget.media.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                MediaHistoryStrings.text("widget.media.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(MediaHistoryStrings.text("widget.media.openA11y", "Open the media history page"))
    }

    // MARK: Content states

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case .empty:
            MediaEmptyState()
        case let .error(message):
            errorState(message)
        case .content:
            contentBody
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< (isCompact ? 1 : 4), id: \.self) { _ in
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 24, height: 24, cornerRadius: TSRadius.pill)
                    VStack(alignment: .leading, spacing: 4) {
                        TSSkeleton(height: 10)
                        TSSkeleton(width: 80, height: 8)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(MediaHistoryStrings.text("widget.media.loading", "Loading media history"))
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            MediaHistoryStrings.text("widget.media.errorTitle", "Couldn't load media history")
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
                MediaHistoryStrings.text("widget.media.retry", "Retry")
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

    private var contentBody: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            if isCompact {
                MediaCompactView(track: model.latestTrack)
            } else {
                MediaFeedView(tracks: model.feedTracks)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.media.offlineBanner" : "widget.media.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known tracks"
            : "Reconnecting — history may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            MediaHistoryStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
