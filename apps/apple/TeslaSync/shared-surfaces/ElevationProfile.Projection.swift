//
//  ElevationProfile.Projection.swift
//  TeslaSync — P4 shared surface · 0071 · ElevationProfile (Apple)
//
//  The pure projection from a cache-then-network `LoadableState` (P1/S8) to the resolved, view-ready
//  state — the native port of the web `ElevationProfile` body (the `data.length === 0` empty branch vs
//  the area chart, the `elevGain` subtitle, the `cursorDistance` reference line) plus the P4 leaf
//  contract (loading / error / stale / offline). Localisation is applied here (P1/S10, via an injected
//  resolver) so the view is a pure function of the result and every branch is unit tested without a
//  store or SwiftUI.
//

import Foundation

// MARK: - Localisation resolver

/// A localisation resolver — `(key, englishFallback) -> resolved`. Defaults to the P1/S10 facade; the
/// tests inject an identity resolver so the projection is asserted against the web English fallbacks.
/// `@Sendable` because resolvers are pure (the facade reads `NSLocalizedString`) and are threaded
/// through value-typed projections under Swift 6 strict concurrency.
public typealias ElevationProfileResolve = @Sendable (String, String) -> String

// MARK: - Input (the coalesced snapshot the projection consumes)

/// The pure, view-free snapshot the projection consumes — the availability of the sample series plus
/// the freshness axis and the controlled cursor position. Built from a `LoadableState` by
/// ``from(_:currentIndex:)`` (the "cached → projection" adapter), or directly in previews / tests.
public struct ElevationProfileInput: Sendable, Equatable {
    /// Whether the series has resolved, is still loading, or failed with no cached value.
    public enum Availability: Sendable, Equatable {
        case loading
        case failed(retryable: Bool)
        case resolved([ElevationProfileSample])
    }

    public let availability: Availability
    public let connection: ElevationProfileConnection
    /// The controlled cursor — an ARRAY position into the plotted series (web `currentIndex`).
    public let currentIndex: Int?

    public init(availability: Availability, connection: ElevationProfileConnection, currentIndex: Int?) {
        self.availability = availability
        self.connection = connection
        self.currentIndex = currentIndex
    }
}

public extension ElevationProfileInput {
    /// Projects the shared-core cache-then-network ``LoadableState`` (P1/S8) into the pure input.
    ///
    /// A cached value (carried by `loading` and `failed`) is kept on screen behind the freshness axis:
    /// a connectivity failure surfaces it as offline, a `stale` flag as stale. A failure with no cache
    /// becomes the error chrome; an in-flight load with no cache becomes the loading chrome.
    static func from(
        _ state: LoadableState<[ElevationProfileSample]>,
        currentIndex: Int?
    ) -> ElevationProfileInput {
        switch state {
        case .idle:
            return ElevationProfileInput(availability: .loading, connection: .live, currentIndex: currentIndex)
        case let .loading(cached, stale):
            if let cached {
                return ElevationProfileInput(
                    availability: .resolved(cached),
                    connection: stale ? .stale : .live,
                    currentIndex: currentIndex
                )
            }
            return ElevationProfileInput(availability: .loading, connection: .live, currentIndex: currentIndex)
        case let .loaded(data, stale):
            return ElevationProfileInput(
                availability: .resolved(data),
                connection: stale ? .stale : .live,
                currentIndex: currentIndex
            )
        case let .empty(stale):
            return ElevationProfileInput(
                availability: .resolved([]),
                connection: stale ? .stale : .live,
                currentIndex: currentIndex
            )
        case let .failed(error, cached, stale):
            if let cached {
                return ElevationProfileInput(
                    availability: .resolved(cached),
                    connection: connection(for: error, stale: stale),
                    currentIndex: currentIndex
                )
            }
            return ElevationProfileInput(
                availability: .failed(retryable: error.isRetryable),
                connection: .live,
                currentIndex: currentIndex
            )
        }
    }

    /// Connectivity failures surface a cached value as offline; other failures keep the stale axis.
    private static func connection(for error: FacadeError, stale: Bool) -> ElevationProfileConnection {
        switch error {
        case .offline, .network, .timeout, .circuitOpen:
            .offline
        case .api, .decode, .auth, .cancelled, .unknown:
            stale ? .stale : .live
        }
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beside the title when the snapshot is not live — the localised label, the
/// VoiceOver label, and whether it represents the offline (vs stale) tone.
public struct ElevationProfileFreshness: Sendable, Equatable {
    public let label: String
    public let accessibilityLabel: String
    public let isOffline: Bool

    public init(label: String, accessibilityLabel: String, isOffline: Bool) {
        self.label = label
        self.accessibilityLabel = accessibilityLabel
        self.isOffline = isOffline
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state. `body` selects the rendered chart area; `subtitle` + `freshness`
/// decorate the title bar. `accessibilityLabel` is the web `ariaLabel` — the no-data variant for the
/// empty branch, the along-the-route variant for the populated branch.
public struct ElevationProfileResolved: Sendable, Equatable {
    /// The chart-area body — the web render branch layered with the P4 loading / error chrome.
    public enum Body: Sendable, Equatable {
        case loading
        case error(message: String, retryable: Bool)
        case empty(message: String)
        case chart(ElevationProfilePlotted)
    }

    public let title: String
    public let accessibilityLabel: String
    public let subtitle: String?
    public let subtitleAccessibilityLabel: String?
    public let freshness: ElevationProfileFreshness?
    public let body: Body
    public let height: Double

    public init(
        title: String,
        accessibilityLabel: String,
        subtitle: String?,
        subtitleAccessibilityLabel: String?,
        freshness: ElevationProfileFreshness?,
        body: Body,
        height: Double
    ) {
        self.title = title
        self.accessibilityLabel = accessibilityLabel
        self.subtitle = subtitle
        self.subtitleAccessibilityLabel = subtitleAccessibilityLabel
        self.freshness = freshness
        self.body = body
        self.height = height
    }

    /// The plotted profile, if the body is a chart.
    public var plotted: ElevationProfilePlotted? {
        if case let .chart(plotted) = body { return plotted }
        return nil
    }
}

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the coalesced input to the resolved view-state — the native port of the web
/// `ElevationProfile` body (the empty / chart branch, the `elevGain` subtitle, the `cursorDistance`
/// reference line) plus the P4 leaf contract. Localisation is applied here so the view is a pure
/// function of the result and every branch is unit tested without a store or SwiftUI.
public enum ElevationProfileProjection {
    /// The localised, view-independent inputs threaded through the projection helpers.
    private struct Context {
        let title: String
        let height: Double
        let distanceUnit: String
        let locale: Locale
        let strings: ElevationProfileResolve
    }

    public static func resolve(
        _ input: ElevationProfileInput,
        height: Double = ElevationProfileLayout.defaultHeight,
        distanceUnit: String = ElevationProfileLayout.defaultDistanceUnit,
        locale: Locale = .current,
        strings: @escaping ElevationProfileResolve = ElevationProfileStrings.string
    ) -> ElevationProfileResolved {
        let context = Context(
            title: strings("replay.elevation.title", "Elevation Profile"),
            height: height,
            distanceUnit: distanceUnit,
            locale: locale,
            strings: strings
        )
        switch input.availability {
        case .loading:
            return leaf(body: .loading, accessibilityLabel: context.title, context: context)
        case let .failed(retryable):
            let message = strings("replay.elevation.error.message", "Couldn't load the elevation profile.")
            return leaf(
                body: .error(message: message, retryable: retryable),
                accessibilityLabel: context.title,
                context: context
            )
        case let .resolved(rawSamples):
            return resolvedBranch(
                rawSamples,
                connection: input.connection,
                currentIndex: input.currentIndex,
                context: context
            )
        }
    }

    // MARK: Loading / error leaf (no series, no freshness)

    private static func leaf(
        body: ElevationProfileResolved.Body,
        accessibilityLabel: String,
        context: Context
    ) -> ElevationProfileResolved {
        ElevationProfileResolved(
            title: context.title,
            accessibilityLabel: accessibilityLabel,
            subtitle: nil,
            subtitleAccessibilityLabel: nil,
            freshness: nil,
            body: body,
            height: context.height
        )
    }

    // MARK: Resolved branch (web `data.length === 0 ? EmptyState : AreaChart`)

    private static func resolvedBranch(
        _ rawSamples: [ElevationProfileSample],
        connection: ElevationProfileConnection,
        currentIndex: Int?,
        context: Context
    ) -> ElevationProfileResolved {
        let samples = ElevationProfileLogic.sanitized(rawSamples)
        let freshness = freshness(for: connection, strings: context.strings)

        guard !samples.isEmpty else {
            return ElevationProfileResolved(
                title: context.title,
                accessibilityLabel: context.strings(
                    "replay.elevation.aria",
                    "Elevation profile chart — no data available yet"
                ),
                subtitle: nil,
                subtitleAccessibilityLabel: nil,
                freshness: freshness,
                body: .empty(message: context.strings("replay.elevation.noData", "No elevation data available")),
                height: context.height
            )
        }

        let plotted = plot(samples, currentIndex: currentIndex, context: context)
        return ElevationProfileResolved(
            title: context.title,
            accessibilityLabel: context.strings(
                "replay.elevation.ariaPopulated",
                "Elevation profile chart along the route, with total gain and loss in meters"
            ),
            subtitle: subtitle(for: plotted.gainLoss, context: context),
            subtitleAccessibilityLabel: subtitleAccessibility(for: plotted.gainLoss, context: context),
            freshness: freshness,
            body: .chart(plotted),
            height: context.height
        )
    }

    private static func plot(
        _ samples: [ElevationProfileSample],
        currentIndex: Int?,
        context: Context
    ) -> ElevationProfilePlotted {
        let gainLoss = ElevationProfileLogic.gainLoss(samples)
        return ElevationProfilePlotted(
            samples: samples,
            gainLoss: gainLoss,
            cursorDistance: ElevationProfileLogic.cursorDistance(samples, currentIndex: currentIndex),
            axisDistanceValues: ElevationProfileLogic.axisDistanceValues(samples),
            elevationDomain: ElevationProfileLogic.elevationDomain(samples),
            distanceUnit: context.distanceUnit,
            metresUnit: context.strings("replay.elevation.unit.m", "m"),
            seriesLabel: context.strings("replay.elevation.label", "Elevation"),
            accessibilitySummary: ElevationProfileLogic.accessibilitySummary(
                samples,
                gainLoss: gainLoss,
                distanceUnit: context.distanceUnit,
                locale: context.locale,
                strings: context.strings
            )
        )
    }

    // MARK: Subtitle (web `↑ ${gain}m  ↓ ${loss}m`)

    private static func subtitle(for gainLoss: ElevationProfileGainLoss, context: Context) -> String {
        String(
            format: context.strings("replay.elevation.gainLoss", "↑ %1$@ m  ↓ %2$@ m"),
            ElevationProfileFormat.number(Double(gainLoss.gain), places: 0, locale: context.locale),
            ElevationProfileFormat.number(Double(gainLoss.loss), places: 0, locale: context.locale)
        )
    }

    private static func subtitleAccessibility(for gainLoss: ElevationProfileGainLoss, context: Context) -> String {
        String(
            format: context.strings(
                "replay.elevation.gainLossA11y",
                "Total ascent %1$@ metres, total descent %2$@ metres"
            ),
            ElevationProfileFormat.number(Double(gainLoss.gain), places: 0, locale: context.locale),
            ElevationProfileFormat.number(Double(gainLoss.loss), places: 0, locale: context.locale)
        )
    }

    // MARK: Freshness (P4 connectivity axis)

    private static func freshness(
        for connection: ElevationProfileConnection,
        strings: ElevationProfileResolve
    ) -> ElevationProfileFreshness? {
        switch connection {
        case .live:
            nil
        case .stale:
            ElevationProfileFreshness(
                label: strings("replay.elevation.freshness.stale", "Stale"),
                accessibilityLabel: strings(
                    "replay.elevation.freshness.staleA11y",
                    "Showing stale data — tap to refresh"
                ),
                isOffline: false
            )
        case .offline:
            ElevationProfileFreshness(
                label: strings("replay.elevation.freshness.offline", "Offline"),
                accessibilityLabel: strings(
                    "replay.elevation.freshness.offlineA11y",
                    "Offline — showing the last known data"
                ),
                isOffline: true
            )
        }
    }
}
