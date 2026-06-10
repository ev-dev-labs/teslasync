//
//  SignalCategoryTree.Models.swift
//  TeslaSync — P4 feature view · 0265 · SignalCategoryTree (Apple)
//
//  Foundation-only value types for the categorized signal picker — the SwiftUI
//  parity of features/telemetry/components/SignalCategoryTree.tsx.
//
//  These mirror the web data contract: `useAvailableSignals` returns
//  `AvailableSignalsResponse.signals`, an array of `SignalDescriptor`
//  ({ name, category, value_kind, unit_kind, is_compound, is_setting_unit }).
//  The web wrapper groups those descriptors by `category` into the generic
//  `TreeGroup<SignalDescriptor>` / `TreeLeaf<SignalDescriptor>` shape the
//  `TreeSelect` primitive renders. `SignalCategoryGroup` / `SignalCategoryLeaf`
//  are the native equivalents, and `SignalSelectionState` models the tri-state
//  group checkbox (none / partial / all). Everything here is pure + `Sendable`
//  so the adapter can be exercised by a host harness and the XCTest suite
//  without rendering a view.
//

import Foundation

// MARK: - Signal value kind (web `SignalKind`)

/// The compact value discriminator carried by a descriptor (web `SignalKind`,
/// normalized from `protomodel.ValueKind`). The picker renders it as the leaf's
/// trailing kind chip; `isNumeric` mirrors the web `SignalSparklinePreview`
/// numeric/non-numeric split (string / time / unknown are non-numeric).
public enum SignalValueKind: String, Sendable, CaseIterable {
    case string
    case bool
    case int
    case float
    case time
    case unknown

    /// Whether the kind has a meaningful numeric trend (web `NON_NUMERIC` set is
    /// `string` / `unknown` / `time`; everything else is numeric).
    public var isNumeric: Bool {
        switch self {
        case .bool, .int, .float: true
        case .string, .time, .unknown: false
        }
    }

    /// The compact token shown in the leaf's kind chip (web renders `valueKind`
    /// verbatim, e.g. "float"). It is a protocol-level identifier, not prose.
    public var token: String {
        rawValue
    }
}

// MARK: - Signal unit kind (web `SignalUnitKind`)

/// The unit discriminator carried by a descriptor (web `SignalUnitKind`). Kept on
/// the model for parity + future unit-aware affordances; the picker itself does
/// not convert (all SI per ADR — conversion is a display-boundary concern).
public enum SignalUnitKind: String, Sendable, CaseIterable {
    case none
    case distance
    case temperature
    case pressure
    case charge
    case speed
}

// MARK: - Descriptor (web `SignalDescriptor`)

/// One available-signal catalog entry (web `SignalDescriptor`). `name` is the
/// canonical proto field name (the leaf id + label); `category` keys the group.
public struct SignalDescriptor: Equatable, Sendable {
    public let name: String
    public let category: String
    public let valueKind: SignalValueKind
    public let unitKind: SignalUnitKind
    public let isCompound: Bool
    public let isSettingUnit: Bool

    public init(
        name: String,
        category: String,
        valueKind: SignalValueKind,
        unitKind: SignalUnitKind = .none,
        isCompound: Bool = false,
        isSettingUnit: Bool = false
    ) {
        self.name = name
        self.category = category
        self.valueKind = valueKind
        self.unitKind = unitKind
        self.isCompound = isCompound
        self.isSettingUnit = isSettingUnit
    }
}

// MARK: - Tree leaf (web `TreeLeaf<SignalDescriptor>`)

/// A single signal row under a category group. `id` is the signal name (the web
/// `leaf.id`), unique within the catalog; `descriptor` backs the kind chip.
public struct SignalCategoryLeaf: Identifiable, Equatable, Sendable {
    public let descriptor: SignalDescriptor

    public var id: String {
        descriptor.name
    }

    /// The display label (web `leaf.label` is the signal `name`).
    public var label: String {
        descriptor.name
    }

    public init(descriptor: SignalDescriptor) {
        self.descriptor = descriptor
    }
}

// MARK: - Tree group (web `TreeGroup<SignalDescriptor>`)

/// A category group: the routing-category id, its friendly label, and the
/// name-sorted leaves (web `TreeGroup` produced by the `groups` `useMemo`).
public struct SignalCategoryGroup: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let leaves: [SignalCategoryLeaf]

    public init(id: String, label: String, leaves: [SignalCategoryLeaf]) {
        self.id = id
        self.label = label
        self.leaves = leaves
    }

    /// The leaf ids in this group (web `g.leaves.map(l => l.id)`).
    public var leafIDs: [String] {
        leaves.map(\.id)
    }
}

// MARK: - Tri-state selection (web `Checkbox` checked / indeterminate)

/// The tri-state a group / select-all checkbox can be in (web `checked` +
/// `indeterminate`): no visible leaves selected, some, or all.
public enum SignalSelectionState: String, Sendable, Equatable {
    case none
    case partial
    case all
}

// MARK: - Projection (web `groups` + count `useMemo`s)

/// The unfiltered, default-ordered projection produced from a catalog: the
/// category groups (web `groups`) plus the convenience counts the header renders.
/// The model applies the live search filter on top of `groups` for display,
/// mirroring the web `groups` → `filtered` chain.
public struct SignalCategoryTreeProjection: Equatable, Sendable {
    public let groups: [SignalCategoryGroup]

    public init(groups: [SignalCategoryGroup]) {
        self.groups = groups
    }

    /// Whether any signal is in the catalog (web `signals.length === 0`).
    public var hasData: Bool {
        !groups.isEmpty
    }

    /// Total leaf count across every group (web `totalLeafCount` reduce).
    public var totalLeafCount: Int {
        groups.reduce(0) { $0 + $1.leaves.count }
    }

    /// Every leaf id in catalog order (group order, then name order).
    public var allLeafIDs: [String] {
        groups.flatMap(\.leafIDs)
    }

    /// An empty projection (no catalog).
    public static let empty = SignalCategoryTreeProjection(groups: [])
}
