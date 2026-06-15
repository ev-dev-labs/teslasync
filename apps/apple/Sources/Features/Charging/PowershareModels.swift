import Foundation

// Value types + pure derivations for the Powershare surface (web
// `web/src/features/charging/pages/PowersharePage.tsx`, route `/powershare`). The page
// reads five cold signals from `signal_observations` (ADR-005 typed-only hot schema;
// everything else → observations): PowershareStatus, PowershareType,
// PowershareStopReason (text) and PowershareHoursLeft, PowershareInstantaneousPowerKW
// (numeric). Each value is the latest observation's already-materialized display value —
// the power signal is delivered in kW and hours-left in hours by the field itself, so no
// further SI conversion happens here (nothing is stored/computed; the view renders the
// observation verbatim exactly like the web `latestNumeric` / `latestText` extractors).
// The web's inline `statusVariant` / `stopReasonVariant` → Badge-tone maps and the
// `hasData` guard live here as pure, unit-tested functions.

// MARK: - Vehicle (web `useSelectedVehicle` → `GET /vehicles`)

/// One selectable vehicle (web `vehicle.display_name || vehicle.vin`). Identity + label
/// strings only, so they round-trip verbatim (no SI measurements here).
public struct PowershareVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String
    public let vin: String

    public init(id: Int64, displayName: String, vin: String) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
    }

    /// Web `vehicle.display_name || vehicle.vin` — the label shown in the selector.
    public var name: String {
        displayName.isEmpty ? vin : displayName
    }
}

// MARK: - Snapshot (web's five `useSignalObservations` results → latest values)

/// The latest Powershare telemetry for the selected vehicle. Each field is the most
/// recent observation of its signal (web `latestText` / `latestNumeric`), or `nil` when
/// the signal has not been reported yet. `powerKw` is instantaneous power in kW and
/// `hoursLeft` is remaining runtime in hours — the units the signals are delivered in,
/// mirrored to the render boundary unchanged (web `fmtNumber(powerKw, 2)` / `(…, 1)`).
public struct PowershareSnapshot: Hashable, Sendable {
    public let status: String?
    public let shareType: String?
    public let stopReason: String?
    public let hoursLeft: Double?
    public let powerKw: Double?

    public init(
        status: String?,
        shareType: String?,
        stopReason: String?,
        hoursLeft: Double?,
        powerKw: Double?
    ) {
        self.status = status
        self.shareType = shareType
        self.stopReason = stopReason
        self.hoursLeft = hoursLeft
        self.powerKw = powerKw
    }

    /// The all-nil snapshot (web: no vehicle selected or no signals reported yet). Every
    /// section then renders its own empty state, never a blank region.
    public static let empty = PowershareSnapshot(
        status: nil, shareType: nil, stopReason: nil, hoursLeft: nil, powerKw: nil
    )

    /// Web `hasData = status != null || shareType != null || stopReason != null ||
    /// hoursLeft != null || powerKw != null` — gates the status panel's metric grid vs.
    /// its no-data empty state.
    public var hasData: Bool {
        status != nil || shareType != nil || stopReason != nil || hoursLeft != nil || powerKw != nil
    }

    /// Web `stopReason ? <Badge/help> : <EmptyState>` — whether the Stop Reason panel
    /// shows the recorded reason (any non-nil value, including `"None"`) vs. its empty.
    public var hasStopReason: Bool {
        stopReason != nil
    }

    /// Web `statusVariant(status)` → the status badge tone.
    public var statusTone: TSTone {
        PowershareTone.status(status)
    }

    /// Web `stopReasonVariant(stopReason)` → the stop-reason badge tone.
    public var stopReasonTone: TSTone {
        PowershareTone.stopReason(stopReason)
    }
}

// MARK: - Badge-tone maps (web `statusVariant` / `stopReasonVariant`)

/// Pure status/stop-reason → badge-tone derivations mirroring the web page's two
/// `BadgeVariant` helpers verbatim. Kept SwiftUI-free so they are unit-testable; the view
/// resolves `TSTone` to a colour at render time.
public enum PowershareTone {
    /// Web `statusVariant`: null → neutral; active/on → success; error/fail → danger;
    /// inactive/off → neutral; otherwise → warning.
    public static func status(_ status: String?) -> TSTone {
        guard let status else { return .neutral }
        let value = status.lowercased()
        if value.contains("active") || value.contains("on") { return .success }
        if value.contains("error") || value.contains("fail") { return .danger }
        if value.contains("inactive") || value.contains("off") { return .neutral }
        return .warning
    }

    /// Web `stopReasonVariant`: null → neutral; none/"" → neutral; user → warning;
    /// error/fault/low → danger; otherwise → warning.
    public static func stopReason(_ reason: String?) -> TSTone {
        guard let reason else { return .neutral }
        let value = reason.lowercased()
        if value == "none" || value.isEmpty { return .neutral }
        if value.contains("user") { return .warning }
        if value.contains("error") || value.contains("fault") || value.contains("low") { return .danger }
        return .warning
    }
}

// MARK: - Page phase (web `isLoading ? Skeleton : error ? errorRegion : body`)

/// The page's terminal phase. `.ready` is the web body — both panels always render, each
/// resolving its own success/empty content from the snapshot (web shows no page-level
/// empty). `.error` is a retryable failure of the observation fetch (web `PageContainer
/// error`); `.loading` is the initial fetch (web `Skeleton`).
public enum PowersharePhase: Equatable, Sendable {
    case loading
    case error(String)
    case ready
}
