//
//  VehicleConfigSection.Adapter.swift
//  TeslaSync — P4 feature view · 0300 · VehicleConfigSection (Apple)
//
//  Pure (Foundation-only) value types + value resolution for the vehicle-detail
//  "Vehicle Configuration" surface — the faithful port of
//  web/src/features/vehicles/components/vehicle-detail/VehicleConfigSection.tsx.
//
//  The web leaf receives a `VehicleConfigSnapshot | null | undefined` plus a separate
//  `softwareVersion` prop and builds a 12-row key/value list (web `KVList columns={2}`).
//  Each row's value is the web `t()`/`??` ternary: a plain string field falls back to the
//  `—` empty display, a boolean field renders `Yes`/`No`/`—`, and the software row chains
//  `software_update_version ?? softwareVersion ?? '—'`. Those pure rules are ported here
//  1:1 so the native rows show the exact same labels and values. Dependency-free so every
//  value can be pinned by unit tests without a bundle or a rendered view (the SwiftUI
//  chrome layers on top in the .swift / .Views.swift files; the projector + phase live in
//  VehicleConfigSection.Projector.swift).
//

import Foundation

// MARK: - Resolved value strings (web `t('common.yes' | 'common.no')` + empty display)

/// The three localized literals the value ternaries need, resolved once by the model from
/// the P1/S10 facade and handed to the pure projector so value formatting stays bundle-free
/// and testable: the boolean `Yes`/`No` words and the `—` empty display (web
/// `DEFAULT_EMPTY_DISPLAY`).
public struct VCSectionValueStrings: Sendable, Equatable {
    public var yes: String
    public var no: String
    public var dash: String

    public init(yes: String, no: String, dash: String) {
        self.yes = yes
        self.no = no
        self.dash = dash
    }

    /// The web English fallbacks (`'Yes'` / `'No'` / `'—'`) — used by previews, tests, and
    /// the projector's default so a value can be resolved without a bundle.
    public static let fallback = VCSectionValueStrings(yes: "Yes", no: "No", dash: "—")
}

// MARK: - Config field (web `configItems` rows, in source order)

/// The twelve configuration rows, mirroring the web `configItems` array order and the
/// `VehicleConfigSnapshot` fields each reads. Each case carries its i18n label key + the
/// web English fallback and resolves its display value from a snapshot.
public enum VCSectionField: String, Sendable, Equatable, CaseIterable, Identifiable {
    case carType
    case trim
    case exteriorColor
    case wheelType
    case roofColor
    case chargePort
    case rightHandDrive
    case europeVehicle
    case offroadLightbar
    case rearSeatHeaters
    case sunroof
    case software

    public var id: String {
        rawValue
    }

    /// Row order (web renders the rows in this order).
    public var order: Int {
        switch self {
        case .carType: 0
        case .trim: 1
        case .exteriorColor: 2
        case .wheelType: 3
        case .roofColor: 4
        case .chargePort: 5
        case .rightHandDrive: 6
        case .europeVehicle: 7
        case .offroadLightbar: 8
        case .rearSeatHeaters: 9
        case .sunroof: 10
        case .software: 11
        }
    }

    /// The i18n key for this row's label (web `t('vehicles.detail.carType', …)`).
    public var labelKey: String {
        switch self {
        case .carType: "vehicles.detail.carType"
        case .trim: "vehicles.detail.trim"
        case .exteriorColor: "vehicles.detail.color"
        case .wheelType: "vehicles.detail.wheels"
        case .roofColor: "vehicles.detail.roofColor"
        case .chargePort: "vehicles.detail.chargePort"
        case .rightHandDrive: "vehicles.detail.rhd"
        case .europeVehicle: "vehicles.detail.europeVehicle"
        case .offroadLightbar: "vehicles.detail.offroadLightbar"
        case .rearSeatHeaters: "vehicles.detail.rearSeatHeaters"
        case .sunroof: "vehicles.detail.sunroofInstalled"
        case .software: "vehicles.detail.softwareVersion"
        }
    }

    /// The web English fallback for `labelKey`.
    public var labelFallback: String {
        switch self {
        case .carType: "Car Type"
        case .trim: "Trim"
        case .exteriorColor: "Exterior Color"
        case .wheelType: "Wheels"
        case .roofColor: "Roof Color"
        case .chargePort: "Charge Port"
        case .rightHandDrive: "Right-Hand Drive"
        case .europeVehicle: "Europe Vehicle"
        case .offroadLightbar: "Offroad Lightbar"
        case .rearSeatHeaters: "Rear Seat Heaters"
        case .sunroof: "Sunroof"
        case .software: "Software"
        }
    }

    /// The rows in source order.
    public static var ordered: [VCSectionField] {
        allCases.sorted { $0.order < $1.order }
    }

    /// The snapshot string field this row reads, or `nil` for the boolean / software rows.
    private var stringKeyPath: KeyPath<VCSectionSnapshot, String?>? {
        switch self {
        case .carType: \.carType
        case .trim: \.trim
        case .exteriorColor: \.exteriorColor
        case .wheelType: \.wheelType
        case .roofColor: \.roofColor
        case .chargePort: \.chargePort
        case .rearSeatHeaters: \.rearSeatHeaters
        case .sunroof: \.sunroofInstalled
        default: nil
        }
    }

    /// The snapshot boolean field this row reads, or `nil` for the string / software rows.
    private var boolKeyPath: KeyPath<VCSectionSnapshot, Bool?>? {
        switch self {
        case .rightHandDrive: \.rightHandDrive
        case .europeVehicle: \.europeVehicle
        case .offroadLightbar: \.offroadLightbarPresent
        default: nil
        }
    }

    /// The display value for this row — the 1:1 port of the web `configItems` value
    /// expression: a string field nil-coalesces to the `—` empty display, a boolean field
    /// renders `Yes`/`No` (or `—` when unknown), and the software row chains
    /// `software_update_version ?? softwareVersion ?? '—'`.
    public func value(in snapshot: VCSectionSnapshot, strings: VCSectionValueStrings) -> String {
        if let keyPath = stringKeyPath {
            return snapshot[keyPath: keyPath] ?? strings.dash
        }
        if let keyPath = boolKeyPath {
            return Self.yesNo(snapshot[keyPath: keyPath], strings)
        }
        return snapshot.softwareUpdateVersion ?? snapshot.softwareVersion ?? strings.dash
    }

    /// The web boolean ternary: `flag != null ? (flag ? Yes : No) : '—'`.
    private static func yesNo(_ flag: Bool?, _ strings: VCSectionValueStrings) -> String {
        guard let flag else { return strings.dash }
        return flag ? strings.yes : strings.no
    }
}

// MARK: - Snapshot input (web `VehicleConfigSnapshot` + the `softwareVersion` prop)

/// One coalesced configuration reading — the subset of the web `VehicleConfigSnapshot` the
/// surface reads, plus the parent page's separate `softwareVersion` prop used as the
/// software-row fallback. Every field is optional (web `string | undefined` /
/// `boolean | undefined`); a `nil` snapshot is the web `vehicleConfig == null` empty gate.
public struct VCSectionSnapshot: Sendable, Equatable {
    public var carType: String?
    public var trim: String?
    public var exteriorColor: String?
    public var wheelType: String?
    public var roofColor: String?
    public var chargePort: String?
    public var rightHandDrive: Bool?
    public var europeVehicle: Bool?
    public var offroadLightbarPresent: Bool?
    public var rearSeatHeaters: String?
    public var sunroofInstalled: String?
    public var softwareUpdateVersion: String?
    public var softwareVersion: String?

    public init(
        carType: String? = nil,
        trim: String? = nil,
        exteriorColor: String? = nil,
        wheelType: String? = nil,
        roofColor: String? = nil,
        chargePort: String? = nil,
        rightHandDrive: Bool? = nil,
        europeVehicle: Bool? = nil,
        offroadLightbarPresent: Bool? = nil,
        rearSeatHeaters: String? = nil,
        sunroofInstalled: String? = nil,
        softwareUpdateVersion: String? = nil,
        softwareVersion: String? = nil
    ) {
        self.carType = carType
        self.trim = trim
        self.exteriorColor = exteriorColor
        self.wheelType = wheelType
        self.roofColor = roofColor
        self.chargePort = chargePort
        self.rightHandDrive = rightHandDrive
        self.europeVehicle = europeVehicle
        self.offroadLightbarPresent = offroadLightbarPresent
        self.rearSeatHeaters = rearSeatHeaters
        self.sunroofInstalled = sunroofInstalled
        self.softwareUpdateVersion = softwareUpdateVersion
        self.softwareVersion = softwareVersion
    }
}

// MARK: - Projected row (one resolved key/value pair)

/// One view-ready row: its source field (label key + fallback live on it) and the resolved
/// display value (web `configItems[i].value`). String-only and bundle-free.
public struct VCSectionRow: Sendable, Equatable, Identifiable {
    public var field: VCSectionField
    public var value: String

    public var id: String {
        field.rawValue
    }

    /// The i18n key for this row's label (resolved at the view boundary through the facade).
    public var labelKey: String {
        field.labelKey
    }

    /// The web English fallback for `labelKey`.
    public var labelFallback: String {
        field.labelFallback
    }

    public init(field: VCSectionField, value: String) {
        self.field = field
        self.value = value
    }
}

// MARK: - Projection (the view-ready model)

/// The fully-projected surface content: the twelve resolved rows and whether a snapshot was
/// present at all (web `vehicleConfig ? items : []`).
public struct VCSectionProjection: Sendable, Equatable {
    public var rows: [VCSectionRow]
    public var hasSnapshot: Bool

    public init(rows: [VCSectionRow], hasSnapshot: Bool) {
        self.rows = rows
        self.hasSnapshot = hasSnapshot
    }

    /// The web content gate: `configItems.length > 0`, which is true exactly when
    /// `vehicleConfig != null`. When false the surface shows the empty state instead of the
    /// row grid — even when every individual field is null, a present snapshot still renders
    /// the twelve `—` rows.
    public var hasContent: Bool {
        hasSnapshot
    }

    /// The zero-value projection the model holds before any snapshot resolves — drives the
    /// loading skeleton until data arrives.
    public static let empty = VCSectionProjection(rows: [], hasSnapshot: false)
}
