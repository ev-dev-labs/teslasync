//
//  ElevationProfile.swift
//  TeslaSync — P4 shared surface · 0071 · ElevationProfile (Apple)
//
//  The elevation profile — the SwiftUI parity of `components/charts/ElevationProfile.tsx`. A filled
//  area chart of elevation (metres) against distance along a route, with an `elevGain` ascent/descent
//  subtitle, an optional controlled cursor reference line (web `currentIndex`), and a tap-to-select
//  affordance that reports the tapped sample's index (web `onClickIndex`). The component owns its own
//  copy (web `useTranslation`); the caller supplies the already-display-unit samples + the distance
//  unit label — exactly like the web source.
//
//  Binds through `ElevationProfileModel` (the `@MainActor` owner of the series state, P1/S8, + the
//  controlled cursor); no networking lives in the view. Renders every web branch — the area chart, the
//  empty-state — plus the P4 leaf contract (loading / error / stale / offline) the parent's state
//  holder carries. Emits `view.opened` once on first appearance (P1/S11).
//

import SwiftUI

// MARK: - ElevationProfile (the shared surface)

/// The elevation profile — the SwiftUI parity of `components/charts/ElevationProfile.tsx`. A filled
/// area chart of elevation against distance, binding through `ElevationProfileModel`.
public struct ElevationProfile: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ElevationProfileMeta.surfaceSlug

    @State private var model: ElevationProfileModel
    @Environment(\.locale) private var locale

    /// Designated initializer binding a pre-built model — for hosts that own the series state holder
    /// and wire the cursor / selection / retry callbacks themselves.
    public init(model: ElevationProfileModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer for the common presentational case — the parity of mounting
    /// `<ElevationProfile data=… currentIndex=… onClickIndex=… height=… distanceUnit=… />` with the
    /// data already fetched + converted by the parent.
    public init(
        data: [ElevationProfileSample],
        currentIndex: Int? = nil,
        onClickIndex: (@MainActor (Int) -> Void)? = nil,
        height: Double = ElevationProfileLayout.defaultHeight,
        distanceUnit: String = ElevationProfileLayout.defaultDistanceUnit,
        telemetry: any ElevationProfileTelemetry = OSLogElevationProfileTelemetry()
    ) {
        _model = State(initialValue: ElevationProfileModel(
            state: .loaded(data, stale: false),
            currentIndex: currentIndex,
            distanceUnit: distanceUnit,
            height: height,
            onClickIndex: onClickIndex,
            telemetry: telemetry
        ))
    }

    /// Convenience initializer wiring a cache-then-network series state (P1/S8) — for hosts that drive
    /// the chart from a state holder and want the full loading / error / stale / offline contract. The
    /// `onRetry` handler powers the error-state retry + the freshness-chip refresh.
    public init(
        state: LoadableState<[ElevationProfileSample]>,
        currentIndex: Int? = nil,
        onClickIndex: (@MainActor (Int) -> Void)? = nil,
        onRetry: (@MainActor () -> Void)? = nil,
        height: Double = ElevationProfileLayout.defaultHeight,
        distanceUnit: String = ElevationProfileLayout.defaultDistanceUnit,
        telemetry: any ElevationProfileTelemetry = OSLogElevationProfileTelemetry()
    ) {
        _model = State(initialValue: ElevationProfileModel(
            state: state,
            currentIndex: currentIndex,
            distanceUnit: distanceUnit,
            height: height,
            onClickIndex: onClickIndex,
            onRetry: onRetry,
            telemetry: telemetry
        ))
    }

    public var body: some View {
        ElevationProfilePanel(
            resolved: model.resolved(locale: locale),
            canRetry: model.canRetry,
            locale: locale,
            onSelectDistance: { model.select(distance: $0) },
            onRetry: { model.retry() }
        )
        .onAppear { model.markAppeared() }
    }
}
