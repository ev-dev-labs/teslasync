//
//  KioskOverlay.Previews.swift
//  TeslaSync — P4 feature view · 0124 · KioskOverlay (Apple)
//
//  Xcode previews covering every branch the web source carries: the dim layer
//  on/off (and its `1 - dimLevel` strength), the clock in each of the four corners,
//  the rotation indicator (multi-dashboard) vs. its absence (single dashboard), the
//  cursor-hidden flag, plus light/dark appearances and an accessibility Dynamic Type
//  size. The exit chip is force-revealed so its glass styling is visible at rest.
//  DEBUG-only.
//

import SwiftUI

#if DEBUG
    /// Renders a `KioskOverlay` over a representative dashboard backdrop so the
    /// translucent chrome (dim, clock, dots, exit chip) is visible in isolation.
    private struct KioskOverlayPreviewStage: View {
        let config: KioskOverlayConfig
        var isDimmed = false
        var isCursorHidden = false
        var dashboardCount = 1
        var currentIndex = 0

        var body: some View {
            ZStack {
                backdrop
                KioskOverlay(
                    presentation: KioskOverlayPresentation(
                        config: config,
                        isDimmed: isDimmed,
                        isCursorHidden: isCursorHidden,
                        dashboardCount: dashboardCount,
                        currentIndex: currentIndex
                    ),
                    onExit: {},
                    exitInitiallyRevealed: true
                )
            }
        }

        /// A simple tiled grid standing in for the rotating dashboard underneath.
        private var backdrop: some View {
            LazyVGrid(columns: Array(repeating: GridItem(spacing: TSSpacing.md), count: 2), spacing: TSSpacing.md) {
                ForEach(0 ..< 6, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                        .fill(Color.TS.surface)
                        .frame(height: 96)
                }
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(Color.TS.bg)
        }
    }

    #Preview("Dimmed · clock bottom-right · dots · Dark") {
        KioskOverlayPreviewStage(
            config: KioskOverlayConfig(dimLevel: 0.4, showClock: true, clockPosition: .bottomRight, rotateInterval: 30),
            isDimmed: true,
            dashboardCount: 5,
            currentIndex: 2
        )
        .preferredColorScheme(.dark)
    }

    #Preview("Clock top-left · no dim · Light") {
        KioskOverlayPreviewStage(
            config: KioskOverlayConfig(dimLevel: 0.5, showClock: true, clockPosition: .topLeft, rotateInterval: 30),
            dashboardCount: 3,
            currentIndex: 0
        )
        .preferredColorScheme(.light)
    }

    #Preview("Clock top-right · cursor hidden · Dark") {
        KioskOverlayPreviewStage(
            config: KioskOverlayConfig(dimLevel: 0.5, showClock: true, clockPosition: .topRight, rotateInterval: 30),
            isCursorHidden: true,
            dashboardCount: 4,
            currentIndex: 3
        )
        .preferredColorScheme(.dark)
    }

    #Preview("Clock bottom-left · single dashboard (no dots) · Dark") {
        KioskOverlayPreviewStage(
            config: KioskOverlayConfig(dimLevel: 0.5, showClock: true, clockPosition: .bottomLeft, rotateInterval: 0),
            dashboardCount: 1,
            currentIndex: 0
        )
        .preferredColorScheme(.dark)
    }

    #Preview("No clock · heavy dim · Dynamic Type XXL") {
        KioskOverlayPreviewStage(
            config: KioskOverlayConfig(
                dimLevel: 0.15,
                showClock: false,
                clockPosition: .bottomRight,
                rotateInterval: 30
            ),
            isDimmed: true,
            dashboardCount: 6,
            currentIndex: 4
        )
        .preferredColorScheme(.dark)
        .environment(\.dynamicTypeSize, .accessibility2)
    }
#endif
