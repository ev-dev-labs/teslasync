//
//  VehiclePhotoGallery.States.swift
//  TeslaSync — P4 feature view · 0306 · VehiclePhotoGallery (Apple)
//
//  The non-data states `VehiclePhotoGallery` renders — a loading skeleton grid (initial fetch),
//  the empty-state card (the web dashed empty card when `photos` is empty), a first-load error
//  with retry (the leaf contract, `QueryError`-style), plus the inline list-error above a
//  cached grid, the live-state freshness chip, and the cached-data banner. Every state renders
//  real chrome — never a blank box. Copy via P1/S10; chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (initial fetch → skeleton grid)

/// The initial-fetch chrome — a grid of shimmering square tiles sized like the thumbnails, so
/// the surface keeps its shape while the photos resolve (web query `isLoading`). Responsive
/// columns mirror the data grid.
struct PhotoGalleryLoadingGrid: View {
    private let tileCount = 8
    @State private var columns = 3

    var body: some View {
        LazyVGrid(columns: gridItems, spacing: TSSpacing.md) {
            ForEach(0 ..< tileCount, id: \.self) { _ in
                PhotoGallerySkeletonTile()
            }
        }
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.width
        } action: { width in
            columns = PhotoGalleryLayout.columnCount(forWidth: width)
        }
        .accessibilityElement()
        .accessibilityLabel(PhotoGalleryStrings.text("vehicles.photos.gallery.loadingA11y", "Loading photos"))
    }

    private var gridItems: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: max(columns, 1))
    }
}

/// One square shimmer tile for the loading grid — the redacted analogue of a thumbnail.
/// Shimmer respects Reduce Motion (static fill when reduced).
struct PhotoGallerySkeletonTile: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shimmer = false

    var body: some View {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .fill(Color.TS.border.opacity(0.3))
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if !reduceMotion {
                    GeometryReader { geo in
                        LinearGradient(
                            colors: [.clear, Color.TS.surface.opacity(0.7), .clear],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                        .frame(width: geo.size.width * 0.4)
                        .offset(x: shimmer ? geo.size.width : -geo.size.width * 0.4)
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) { shimmer = true }
            }
            .accessibilityHidden(true)
    }
}

// MARK: - Empty (web dashed empty card)

/// The resolved-but-no-photos state — the native parity of the web empty card: a centred glyph
/// over two lines of copy inside a dashed rounded border, never a blank box.
struct PhotoGalleryEmptyState: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "photo.on.rectangle.angled")
                .font(.system(size: 32, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            PhotoGalleryStrings.text("vehicles.photos.empty", "No photos uploaded yet.")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
            PhotoGalleryStrings.text(
                "vehicles.photos.emptyHelp",
                "Photos uploaded for this vehicle will appear here."
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, TSSpacing.x2xl)
        .padding(.vertical, TSSpacing.x3xl)
        .background(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .fill(Color.TS.textPrimary.opacity(0.03))
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, style: StrokeStyle(lineWidth: 1.5, dash: [6, 4]))
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (first-load failure → retry)

/// The fetch-failure state with a retry affordance — a `QueryError`-style block so a first-load
/// failure with no cached photos isn't a blank box (leaf contract).
struct PhotoGalleryErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            PhotoGalleryStrings.text("vehicles.photos.gallery.errorTitle", "Couldn't load photos")
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
            retryButton
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button(action: onRetry) {
            PhotoGalleryStrings.text("vehicles.photos.gallery.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(PhotoGalleryStrings.text("vehicles.photos.gallery.retry", "Retry"))
    }
}

// MARK: - Inline error (failed reload with the cached grid still on screen)

/// The inline error shown above a still-visible cached grid when a reload failed, so the
/// thumbnails stay put while the failure surfaces (web keeps the prior list).
struct PhotoGalleryInlineError: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.caption)
                .lineLimit(2)
        }
        .foregroundStyle(Color.TS.statusDanger)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The freshness chip reflecting the bound source's live-state (ADR-013).
struct PhotoGalleryFreshnessChip: View {
    let connection: PhotoGalleryConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            PhotoGalleryStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(descriptor.tone.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(PhotoGalleryStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: PhotoGalleryConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "vehicles.photos.gallery.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "vehicles.photos.gallery.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "vehicles.photos.gallery.offlineChip", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the grid when the bound source is not live, so a cached
/// set is clearly labelled (ADR-013).
struct PhotoGalleryConnectivityBanner: View {
    let connection: PhotoGalleryConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "vehicles.photos.gallery.offlineBanner" : "vehicles.photos.gallery.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded photos"
            : "Reconnecting — these photos may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            PhotoGalleryStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
