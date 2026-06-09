//
//  XRayControls.Adapter.swift
//  TeslaSync — P4 feature view · 0033 · XRayControls (Apple)
//
//  The testable projection core for the Ingest X-Ray controls bar: the cached
//  vehicle list (web `vehicles` prop) + the operator-selected window (web
//  `windowSel`) → the three view-ready option lists the bar renders (Vehicle /
//  Window / Bucket). Pure + Foundation-only (no SwiftUI, no bundle) so the
//  option projections, the bucket-versus-window guard (web `tooBig`), the
//  vehicle display-label fallback, and the VoiceOver summary unit-test without a
//  store or a rendered view.
//
//  Parity source: web/src/features/admin/components/ingest-xray/XRayControls.tsx
//  — three `Select`s whose options come from `vehicleOptions` (the empty
//  "Select vehicle…" sentinel + one per vehicle), `windowOptions`
//  (``t(`admin.xray.windowOption.${w}`, w)`` for every window), and
//  `bucketOptions` (``t(`admin.xray.bucketOption.${b}`, b)`` for every bucket,
//  with `BUCKET_SECS[b] >= WINDOW_SECS[windowSel]` disabled). `IngestXRayWindow`
//  is owned by the sibling XRayHeader surface and reused here verbatim.
//

import Foundation

// MARK: - Aggregation bucket (web `IngestXRayBucket` + `BUCKET_SECS`)

/// The operator-selected aggregation bucket — the native port of the web
/// `IngestXRayBucket` union (`'30s' | '1m' | '5m' | '15m' | '1h'`). The raw value
/// is the exact server-accepted wire token; `seconds` carries the web
/// `BUCKET_SECS` width used to disable any bucket that is not strictly finer than
/// the selected window.
public enum IngestXRayBucket: String, Sendable, Equatable, CaseIterable {
    case s30 = "30s"
    case m1 = "1m"
    case m5 = "5m"
    case m15 = "15m"
    case h1 = "1h"

    /// The server-accepted wire token (web union literal).
    public var wire: String {
        rawValue
    }

    /// The i18n key for the bucket option (web ``t(`admin.xray.bucketOption.${b}`, b)``).
    public var labelKey: String {
        "admin.xray.bucketOption.\(rawValue)"
    }

    /// The web option fallback — the raw bucket token itself (web default `b`).
    public var labelFallback: String {
        rawValue
    }

    /// The bucket width in seconds (web `BUCKET_SECS`), used by the window guard.
    public var seconds: Int {
        switch self {
        case .s30: 30
        case .m1: 60
        case .m5: 5 * 60
        case .m15: 15 * 60
        case .h1: 60 * 60
        }
    }

    /// Resolves a wire token into a bucket, defaulting to one minute (the web
    /// page's initial selection) for any unrecognized value so the bar never
    /// renders a blank bucket selector.
    public static func from(wire: String) -> IngestXRayBucket {
        IngestXRayBucket(rawValue: wire) ?? .m1
    }
}

// MARK: - Cached vehicle reference (web `Vehicle`)

/// The slice of the web `Vehicle` the controls bar reads to label its picker —
/// the id plus the optional display name / VIN. `displayLabel` reproduces the web
/// `v.display_name || v.vin || \`Vehicle ${v.id}\`` fallback chain (empty strings
/// are treated as absent, matching the JS `||` truthiness), with the final
/// numbered fallback routed through the i18n facade so the view holds no literal.
public struct XRayVehicleRef: Identifiable, Sendable, Equatable {
    public let id: Int
    public let displayName: String?
    public let vin: String?

    public init(id: Int, displayName: String? = nil, vin: String? = nil) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
    }

    /// The picker label for this vehicle: the first non-empty of display name /
    /// VIN, else the localized numbered fallback (web `Vehicle ${id}`).
    public func displayLabel(localize: (String, String) -> String) -> String {
        if let displayName, !displayName.isEmpty { return displayName }
        if let vin, !vin.isEmpty { return vin }
        return String(format: localize("admin.xray.controls.vehicleFallback", "Vehicle %lld"), id)
    }
}

// MARK: - Projected option (web `SelectOption`)

/// One projected option a controls selector renders — the native port of a web
/// `SelectOption` (`value` + `label` + optional `disabled`). The title is already
/// localized at projection time (via the injected `localize`) so the view renders
/// it verbatim; `isDisabled` carries the web `tooBig` guard for buckets.
public struct XRayControlOption<Value: Hashable & Sendable>: Identifiable, Sendable {
    public let id: String
    public let value: Value
    public let title: String
    public let isDisabled: Bool

    public init(id: String, value: Value, title: String, isDisabled: Bool = false) {
        self.id = id
        self.value = value
        self.title = title
        self.isDisabled = isDisabled
    }
}

extension XRayControlOption: Equatable {}

// MARK: - Projection (web `vehicleOptions` / `windowOptions` / `bucketOptions`)

/// Builds the three option lists the controls bar renders, reproducing the web
/// `XRayControls`. Pure + bundle-free: every label is resolved through the
/// injected `localize`, so the projection unit-tests without `.main`.
public enum XRayControlsProjection {
    /// The vehicle-picker options: the empty "Select vehicle…" sentinel first
    /// (web `{ value: '', label: t('admin.xray.controls.selectVehicle', …) }`)
    /// then one option per vehicle, labeled by the web fallback chain. `nil` is
    /// the sentinel value (web empty string → `onVehicleChange(null)`).
    public static func vehicleOptions(
        _ vehicles: [XRayVehicleRef],
        localize: (String, String) -> String
    ) -> [XRayControlOption<Int?>] {
        var options: [XRayControlOption<Int?>] = [
            XRayControlOption(
                id: "",
                value: nil,
                title: localize("admin.xray.controls.selectVehicle", "Select vehicle…")
            )
        ]
        for vehicle in vehicles {
            options.append(
                XRayControlOption(
                    id: String(vehicle.id),
                    value: vehicle.id,
                    title: vehicle.displayLabel(localize: localize)
                )
            )
        }
        return options
    }

    /// The window-selector options — every `IngestXRayWindow`, labeled by
    /// ``t(`admin.xray.windowOption.${w}`, w)`` (the web fallback is the raw
    /// window token, e.g. "5m").
    public static func windowOptions(
        localize: (String, String) -> String
    ) -> [XRayControlOption<IngestXRayWindow>] {
        IngestXRayWindow.allCases.map { window in
            XRayControlOption(
                id: window.wire,
                value: window,
                title: localize("admin.xray.windowOption.\(window.wire)", window.wire)
            )
        }
    }

    /// The bucket-selector options — every `IngestXRayBucket`, labeled by
    /// ``t(`admin.xray.bucketOption.${b}`, b)`` and disabled when the bucket is
    /// not strictly finer than the selected window (web
    /// `BUCKET_SECS[b] >= WINDOW_SECS[windowSel]`).
    public static func bucketOptions(
        window: IngestXRayWindow,
        localize: (String, String) -> String
    ) -> [XRayControlOption<IngestXRayBucket>] {
        IngestXRayBucket.allCases.map { bucket in
            XRayControlOption(
                id: bucket.wire,
                value: bucket,
                title: localize("admin.xray.bucketOption.\(bucket.wire)", bucket.wire),
                isDisabled: isBucketDisabled(bucket, window: window)
            )
        }
    }

    /// The selected window's width in seconds (web `WINDOW_SECS`).
    public static func windowSeconds(_ window: IngestXRayWindow) -> Int {
        switch window {
        case .m5: 5 * 60
        case .m15: 15 * 60
        case .h1: 60 * 60
        case .h6: 6 * 60 * 60
        case .h24: 24 * 60 * 60
        }
    }

    /// Whether a bucket must be disabled for the selected window — the web
    /// `tooBig` guard (`BUCKET_SECS[b] >= WINDOW_SECS[windowSel]`) that prevents a
    /// server-side "bucket >= window" 400 before it is ever round-tripped.
    public static func isBucketDisabled(_ bucket: IngestXRayBucket, window: IngestXRayWindow) -> Bool {
        bucket.seconds >= windowSeconds(window)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver sentence for one selector. Pure + public so the spoken
/// content is unit-testable without rendering the view: "<aria label>,
/// <selected option title>".
public enum XRayControlsAccessibility {
    public static func selectionSummary(label: String, selectedTitle: String) -> String {
        "\(label), \(selectedTitle)"
    }
}
