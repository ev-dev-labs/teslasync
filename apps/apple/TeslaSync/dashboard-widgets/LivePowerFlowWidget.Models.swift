//
//  LivePowerFlowWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0056 · LivePowerFlowWidget (Apple)
//
//  Domain value types for the live power-flow surface — the cached DTO inputs
//  (Tesla Energy site + live-status snapshot) and the flow-diagram projection
//  (nodes + directional arrows) ported from features/dashboard/widgets/
//  LivePowerFlowWidget.tsx and shared/WidgetFlowDiagram.tsx.
//

import Foundation

// MARK: - Cached DTO inputs (the shapes the P1/S8 source decodes for the view)

/// Value-typed projection of a `TeslaEnergySite` row (web `useTeslaEnergySites`).
/// Only the identity the widget needs to resolve the live-status query; the web
/// reads `sites[0].energy_site_id`.
public struct PowerFlowSite: Sendable, Equatable, Identifiable {
    public let energySiteID: Int
    public var siteName: String?
    public var hasSolar: Bool
    public var hasBattery: Bool
    public var hasGrid: Bool

    public var id: Int {
        energySiteID
    }

    public init(
        energySiteID: Int,
        siteName: String? = nil,
        hasSolar: Bool = false,
        hasBattery: Bool = false,
        hasGrid: Bool = false
    ) {
        self.energySiteID = energySiteID
        self.siteName = siteName
        self.hasSolar = hasSolar
        self.hasBattery = hasBattery
        self.hasGrid = hasGrid
    }
}

/// Value-typed projection of a `TeslaEnergyLiveStatus` snapshot (web
/// `useTeslaEnergyLiveStatus`). Powers are SI watts on the wire; `nil` models
/// the web `?? 0` fallbacks. Sign convention matches Tesla: battery > 0 charging,
/// battery < 0 discharging; grid > 0 importing, grid < 0 exporting.
public struct PowerFlowLiveStatus: Sendable, Equatable {
    public var solarPowerW: Double?
    public var batteryPowerW: Double?
    public var loadPowerW: Double?
    public var gridPowerW: Double?

    public init(
        solarPowerW: Double? = nil,
        batteryPowerW: Double? = nil,
        loadPowerW: Double? = nil,
        gridPowerW: Double? = nil
    ) {
        self.solarPowerW = solarPowerW
        self.batteryPowerW = batteryPowerW
        self.loadPowerW = loadPowerW
        self.gridPowerW = gridPowerW
    }

    /// Solar production in kW (web `solarW / 1000`).
    public var solarKw: Double {
        (solarPowerW ?? 0) / 1000
    }

    /// Battery power in kW; signed (web `batteryW / 1000`).
    public var batteryKw: Double {
        (batteryPowerW ?? 0) / 1000
    }

    /// Home load in kW (web `homeW / 1000`).
    public var homeKw: Double {
        (loadPowerW ?? 0) / 1000
    }

    /// Grid power in kW; signed (web `gridW / 1000`).
    public var gridKw: Double {
        (gridPowerW ?? 0) / 1000
    }
}

// MARK: - Flow-diagram projection (port of shared/WidgetFlowDiagram.tsx)

/// The four routing endpoints of the power-flow diagram (web `FlowNode.id`).
public enum PowerFlowNodeID: String, Sendable, CaseIterable {
    case solar
    case grid
    case home
    case battery
}

/// Anchor position of a node in the diagram's 100×100 space (web
/// `FlowNode.position` → `POSITION_COORDS`).
public enum PowerFlowPosition: String, Sendable {
    case top
    case bottom
    case left
    case right
    case center

    /// Normalized anchor (`cx`, `cy`) in the 0…100 viewBox (web `POSITION_COORDS`).
    public var coord: (cx: Double, cy: Double) {
        switch self {
        case .top: (50, 12)
        case .bottom: (50, 88)
        case .left: (12, 50)
        case .right: (88, 50)
        case .center: (50, 50)
        }
    }
}

/// A routing endpoint with its current magnitude (web `FlowNode`). `valueKw` is
/// the non-negative magnitude shown in the node; `label`/`icon` are resolved at
/// render time from `id`, keeping the model free of view concerns.
public struct PowerFlowNode: Sendable, Equatable, Identifiable {
    public let id: PowerFlowNodeID
    public var position: PowerFlowPosition
    public var valueKw: Double

    public init(id: PowerFlowNodeID, position: PowerFlowPosition, valueKw: Double) {
        self.id = id
        self.position = position
        self.valueKw = valueKw
    }
}

/// A directional power transfer between two nodes (web `FlowArrow`). `colorNode`
/// is the node whose semantic color the arrow inherits (the web sets the source
/// node's color on every arrow); `active` drives the animated dash flow.
public struct PowerFlowArrow: Sendable, Equatable, Identifiable {
    public let from: PowerFlowNodeID
    public let to: PowerFlowNodeID
    public var valueKw: Double
    public var active: Bool
    public var colorNode: PowerFlowNodeID

    public var id: String {
        "\(from.rawValue)-\(to.rawValue)"
    }

    public init(
        from: PowerFlowNodeID,
        to: PowerFlowNodeID,
        valueKw: Double,
        active: Bool,
        colorNode: PowerFlowNodeID
    ) {
        self.from = from
        self.to = to
        self.valueKw = valueKw
        self.active = active
        self.colorNode = colorNode
    }
}

/// The fully-resolved diagram (web memoized `nodes` + `arrows`). `hasData` mirrors
/// the web `liveStatus != null` gate that drives the "No live power data" branch.
public struct PowerFlowProjection: Sendable, Equatable {
    public var nodes: [PowerFlowNode]
    public var arrows: [PowerFlowArrow]
    public var hasData: Bool

    public init(nodes: [PowerFlowNode] = [], arrows: [PowerFlowArrow] = [], hasData: Bool = false) {
        self.nodes = nodes
        self.arrows = arrows
        self.hasData = hasData
    }

    /// Empty projection — no live status resolved yet (web `nodes.length === 0`).
    public static let empty = PowerFlowProjection()

    /// Looks up a node by id (web `nodeMap.get`).
    public func node(_ id: PowerFlowNodeID) -> PowerFlowNode? {
        nodes.first { $0.id == id }
    }
}
