//
//  XRayHeader.swift
//  TeslaSync — P4 feature view · 0035 · XRayHeader (Apple)
//
//  The composable Ingest X-Ray header strip — the SwiftUI parity of
//  features/admin/components/ingest-xray/XRayHeader.tsx. Three summary tiles
//  (Total samples / Distinct fields / Window) that describe what the current
//  X-Ray window contains, bound through `XRayHeaderModel` (P1/S8). No networking
//  lives here; the tiles are derived from the model's cached summary + selected
//  window via the pure `XRayHeaderProjection`. Every state from the web source —
//  loading, content, empty, error — plus the live-state surface states the prompt
//  requires — stale, offline — renders here; none is hidden.
//

import SwiftUI

// MARK: - XRayHeader (the feature view)

/// The composable Ingest X-Ray header strip — the SwiftUI parity of
/// `features/admin/components/ingest-xray/XRayHeader.tsx`. Summarizes the current
/// X-Ray window with three tiles and surfaces freshness (stale/offline) without
/// ever hiding the strip behind a null value.
public struct XRayHeader: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "XRayHeader"

    @State private var model: XRayHeaderModel

    public init(model: XRayHeaderModel) {
        _model = State(initialValue: model)
    }

    /// The three view-ready tiles, re-derived from the model's cached summary +
    /// selected window (web `Grid` of `StatCard`s). Kept in the view so a locale
    /// or window change re-derives the labels/echo.
    private var stats: [XRayStat] {
        XRayHeaderProjection.build(
            summary: model.summary,
            window: model.window,
            localize: XRayHeaderStrings.string
        )
    }

    /// The freshness banner shows only when the bound source is not live and we
    /// have a strip on screen to caption (never over the skeleton or the error
    /// state, which speak for themselves).
    private var showsConnectivityBanner: Bool {
        guard model.connection != .live else { return false }
        switch model.phase {
        case .content, .empty: return true
        case .loading, .error: return false
        }
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if showsConnectivityBanner {
                XRayHeaderConnectivityBanner(connection: model.connection)
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: model.connection) { _, connection in
            // Stale → auto-refresh once, keeping the cached counts visible.
            if connection == .stale { model.refresh() }
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            XRayHeaderStrip(stats: stats, isLoading: true)
        case .content:
            XRayHeaderStrip(stats: stats, isLoading: false)
        case .empty:
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                XRayHeaderEmptyNote()
                XRayHeaderStrip(stats: stats, isLoading: false)
            }
        case let .error(message):
            XRayHeaderErrorState(message: message) {
                model.refresh()
            }
        }
    }
}
