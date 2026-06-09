//
//  XRayControls.swift
//  TeslaSync — P4 feature view · 0033 · XRayControls (Apple)
//
//  The composable Ingest X-Ray controls bar — the SwiftUI parity of
//  features/admin/components/ingest-xray/XRayControls.tsx. Three selectors
//  (Vehicle / Window / Bucket) constrained to the server-accepted values, with
//  the bucket dropdown auto-disabling any bucket that is not strictly finer than
//  the selected window (web `tooBig`, avoiding a server-side "bucket >= window"
//  400). Bound through `XRayControlsModel` (P1/S8); no networking lives here. The
//  vehicle list is the loadable the picker depends on, so its load lifecycle
//  drives the picker's loading / empty / error surfaces; the window and bucket
//  selectors — pure operator selections — stay usable in every state, and the
//  stale/offline freshness banner captions a cached list without ever hiding the
//  bar.
//

import SwiftUI

// MARK: - XRayControls (the feature view)

/// The composable Ingest X-Ray controls bar — the SwiftUI parity of
/// `features/admin/components/ingest-xray/XRayControls.tsx`. Reports operator
/// selections through the bound model (web controlled-component callbacks) and
/// surfaces vehicle-list freshness (stale/offline) without hiding the selectors.
public struct XRayControls: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "XRayControls"

    @State private var model: XRayControlsModel

    public init(model: XRayControlsModel) {
        _model = State(initialValue: model)
    }

    /// The vehicle-picker options (web `vehicleOptions`): the empty sentinel plus
    /// one per cached vehicle, re-derived so a locale change refreshes the labels.
    private var vehicleOptions: [XRayControlOption<Int?>] {
        XRayControlsProjection.vehicleOptions(model.vehicles, localize: XRayControlsStrings.string)
    }

    /// The window-selector options (web `windowOptions`).
    private var windowOptions: [XRayControlOption<IngestXRayWindow>] {
        XRayControlsProjection.windowOptions(localize: XRayControlsStrings.string)
    }

    /// The bucket-selector options (web `bucketOptions`) — disabled per the
    /// `tooBig` guard for the currently-selected window.
    private var bucketOptions: [XRayControlOption<IngestXRayBucket>] {
        XRayControlsProjection.bucketOptions(window: model.window, localize: XRayControlsStrings.string)
    }

    /// The freshness banner shows only when the bound source is not live and we
    /// have a bar with a cached list to caption (never over the skeleton or the
    /// error slot, which speak for themselves).
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
                XRayControlsConnectivityBanner(connection: model.connection)
            }
            XRayControlsLayout {
                vehicleSlot
            } window: {
                windowSelect
            } bucket: {
                bucketSelect
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: model.connection) { _, connection in
            // Stale → auto-refresh once, keeping the cached vehicle list visible.
            if connection == .stale { model.refresh() }
        }
        .accessibilityElement(children: .contain)
    }

    // MARK: Vehicle slot (state-driven)

    @ViewBuilder
    private var vehicleSlot: some View {
        switch model.phase {
        case .loading:
            XRayControlsSkeletonField()
        case .content:
            vehiclePicker
        case .empty:
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                vehiclePicker
                    .disabled(true)
                XRayControlsEmptyHint()
            }
        case let .error(message):
            XRayControlsErrorSlot(message: message) {
                model.refresh()
            }
        }
    }

    private var vehiclePicker: some View {
        XRayControlSelect(
            options: vehicleOptions,
            selection: model.vehicleID,
            accessibilityLabel: XRayControlsStrings.string("admin.xray.controls.vehicleAria", "Vehicle"),
            onSelect: { model.selectVehicle($0) }
        )
    }

    // MARK: Window + bucket selectors (always usable)

    private var windowSelect: some View {
        XRayControlSelect(
            options: windowOptions,
            selection: model.window,
            accessibilityLabel: XRayControlsStrings.string("admin.xray.controls.windowAria", "Window"),
            onSelect: { model.selectWindow($0) }
        )
    }

    private var bucketSelect: some View {
        XRayControlSelect(
            options: bucketOptions,
            selection: model.bucket,
            accessibilityLabel: XRayControlsStrings.string("admin.xray.controls.bucketAria", "Bucket"),
            onSelect: { model.selectBucket($0) }
        )
    }
}
