//
//  WidgetFlowDiagram.Adapter.swift
//  TeslaSync — P4 widget primitive · 0006 · WidgetFlowDiagram (Apple)
//
//  The Foundation-only core for the flow-diagram widget primitive — the SwiftUI parity of
//  `features/dashboard/widgets/shared/WidgetFlowDiagram.tsx`. This file owns the surface identity (the
//  diagnostics slug), the data value types (``FlowNode`` / ``FlowArrow`` — the native peers of the web
//  `FlowNode` / `FlowArrow`), the node position → viewBox-coordinate mapping (web `POSITION_COORDS`), the
//  props (``WidgetFlowInput``), the resolved view-ready projection (``FlowDiagramCanvas`` with its
//  ``ProjectedFlowNode`` / ``ProjectedFlowArrow``), the ``WidgetFlowDiagramProjection`` render decision,
//  the pure geometry helpers (``FlowDiagramGeometry`` — the `strokeForValue` / `maxArrowValue` /
//  `arrowColor` / endpoint-offset / compact-top-3 / label-compaction math that ports the web `useMemo`
//  bodies + the per-element render logic), the pure ``WidgetFlowDiagramProjector`` that ports the render
//  branch (`nodes.length === 0 ? <EmptyState/> : <svg/>`), and the accessibility label builders. No
//  SwiftUI, no `@Observable`, so every rule is unit-testable in isolation on a plain host.
//
//  Faithful-parity note: the web `<WidgetFlowDiagram>` is a PURE presentational widget primitive (a shared
//  widget building block). It takes its data as plain props (`nodes`, `arrows`, `compact`, `emptyMessage`)
//  and draws an SVG flow graph, with no fetch, no React-Query cache, and no Promise — so it has NO
//  loading / error / stale / offline branch (there is nothing to fetch, fail, age, or lose connectivity
//  to; the host widget that owns the query — e.g. EnergyFlowWidget, LivePowerFlowWidget — renders those in
//  its own shell). Inventing such chrome would fabricate states the source does not have, so this surface
//  reproduces ONLY the source's REAL branches — exactly as the sibling presentational primitives
//  WidgetChartSummary (0002), WidgetComparisonCard (0003) and WidgetMapView (0008) did. The real branches:
//    • empty leaf   (web `nodes.length === 0` → `<EmptyState message={emptyMessage} />`)
//    • populated graph (web `<svg>`: arrows behind nodes)
//    • `compact`    (a REAL branch: smaller node radius, the top-3-by-magnitude arrow slice, and the
//                    3-letter-uppercase label compaction)
//    • `active`     (a REAL per-arrow branch: the animated marching-ants dash)
//    • arrow tone   (a REAL per-arrow branch: web `value > 0` emerald / `< 0` red / `== 0` muted, with a
//                    caller `color` override)
//
//  Color mapping (web Tailwind → native tokens; no Tailwind classes / raw hex in native, per the design
//  system the sibling primitives followed): the web `arrowColor` returns a Tailwind text-color class
//  (`text-emerald-400` / `text-red-400` / `text-[var(--text-muted)]`) and the web `color?` override is an
//  arbitrary Tailwind class (real callers pass `text-cyan-400` / `text-amber-400` / `text-yellow-400` /
//  `text-blue-400`). The native peer resolves the value-sign default to the semantic status tokens
//  (positive → `statusSuccess`, negative → `statusDanger`, zero → `textMuted`) and maps the optional
//  caller override to the index-stable brand chart palette (``FlowArrowTone/palette(_:)`` →
//  `TSChartPalette`), so distinct arrows keep distinct, token-driven colors without a single hardcoded hue.
//

import CoreGraphics
import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum WidgetFlowDiagramSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "WidgetFlowDiagram"
}

// MARK: - FlowNodePosition (web `FlowNode['position']` + `POSITION_COORDS`)

/// Where a node sits in the diagram — the native peer of the web position union
/// (`'top' | 'bottom' | 'left' | 'right' | 'center'`). ``point`` is the node center in the web's fixed
/// `100 × 100` viewBox (web `POSITION_COORDS`); the SwiftUI canvas scales that box uniformly to the live
/// size (SVG `preserveAspectRatio="xMidYMid meet"`).
public enum FlowNodePosition: String, CaseIterable, Sendable {
    case top
    case bottom
    case left
    case right
    case center

    /// The node center in the `100 × 100` viewBox — verbatim from the web `POSITION_COORDS` table.
    public var point: CGPoint {
        switch self {
        case .top: CGPoint(x: 50, y: 12)
        case .bottom: CGPoint(x: 50, y: 88)
        case .left: CGPoint(x: 12, y: 50)
        case .right: CGPoint(x: 88, y: 50)
        case .center: CGPoint(x: 50, y: 50)
        }
    }

    /// Web label placement: the `bottom` node's label sits BELOW it (`cy + r + 5`); every other node's
    /// label sits ABOVE it (`cy - r - 2`).
    public var placesLabelAbove: Bool {
        self != .bottom
    }
}

// MARK: - FlowArrowTone (web `arrowColor` result → native token)

/// The resolved color intent for an arrow — the native, token-driven peer of the web `arrowColor`
/// result + the `color?` override. The value-sign defaults map to the semantic status tokens; an explicit
/// caller override maps to the index-stable brand chart palette (so distinct flows keep distinct hues
/// without any Tailwind class or raw hex). Resolved to a concrete `Color` at the view boundary (P1/S9).
public enum FlowArrowTone: Equatable, Sendable {
    /// Web `value > 0` (`text-emerald-400`) → `Color.TS.statusSuccess`.
    case positive
    /// Web `value < 0` (`text-red-400`) → `Color.TS.statusDanger`.
    case negative
    /// Web `value === 0` (`text-[var(--text-muted)]`) → `Color.TS.textMuted`.
    case neutral
    /// Web `color?` override (an arbitrary Tailwind class) → a brand chart-palette index (`TSChartPalette`).
    case palette(Int)
}

// MARK: - FlowNode (web `FlowNode`)

/// One node in the flow graph — the native peer of the web `FlowNode` interface
/// (`{ id, label, value, formattedValue, icon?, position }`). `value` is the live numeric magnitude the
/// node renders as an animated number (web `<AnimatedNumber value={node.value} decimals={1} />`);
/// `formattedValue` is the caller's already-formatted string (web `formattedValue`) — unused by the web
/// SVG render but kept for data-contract parity and reused as the node's VoiceOver value (a native a11y
/// gain). `systemImage` is the optional SF Symbol peer of the web optional `icon: ReactNode`.
public struct FlowNode: Identifiable, Equatable, Sendable {
    /// Stable node identity (web `id`) — the arrow endpoints reference it, and it keys the render.
    public let id: String
    /// The node's display label (web `label`) — caller-supplied + already localized, rendered verbatim
    /// (compacted to 3 uppercase letters in `compact` mode, web `slice(0, 3).toUpperCase()`).
    public let label: String
    /// The live numeric magnitude (web `value`) — rendered as an animated number with 1 decimal.
    public let value: Double
    /// The caller's already-formatted value (web `formattedValue`) — reused as the VoiceOver value.
    public let formattedValue: String
    /// Optional SF Symbol name (the native peer of the web optional `icon: ReactNode`).
    public let systemImage: String?
    /// Where the node sits (web `position`).
    public let position: FlowNodePosition

    public init(
        id: String,
        label: String,
        value: Double,
        formattedValue: String,
        systemImage: String? = nil,
        position: FlowNodePosition
    ) {
        self.id = id
        self.label = label
        self.value = value
        self.formattedValue = formattedValue
        self.systemImage = systemImage
        self.position = position
    }
}

// MARK: - FlowArrow (web `FlowArrow`)

/// One directed edge in the flow graph — the native peer of the web `FlowArrow` interface
/// (`{ from, to, value, active, color? }`). `from` / `to` reference ``FlowNode/id``; `value` drives the
/// stroke width + sign-tone; `active` selects the animated marching-ants dash (web `strokeDasharray`);
/// `colorPaletteIndex` is the native peer of the web `color?` override (a brand-palette index instead of a
/// Tailwind class — see the file header).
public struct FlowArrow: Equatable, Sendable {
    /// Source node id (web `from`).
    public let from: String
    /// Destination node id (web `to`).
    public let to: String
    /// Signed magnitude (web `value`) — its absolute value drives the stroke width; its sign the tone.
    public let value: Double
    /// Whether the edge animates the marching-ants dash (web `active`).
    public let active: Bool
    /// Optional brand chart-palette index override (the native peer of the web `color?` Tailwind class).
    public let colorPaletteIndex: Int?

    public init(
        from: String,
        to: String,
        value: Double,
        active: Bool,
        colorPaletteIndex: Int? = nil
    ) {
        self.from = from
        self.to = to
        self.value = value
        self.active = active
        self.colorPaletteIndex = colorPaletteIndex
    }
}

// MARK: - WidgetFlowInput (web props)

/// The flow-diagram primitive's props — the native peer of the web `WidgetFlowDiagramProps`. `nodes` /
/// `arrows` are the graph; `compact` (default `false`) shrinks the node radius, slices the arrows to the
/// top three by magnitude, and compacts the labels (web `compact`). Equatable so a rebind re-renders only
/// on a real change; Sendable so it crosses actors. `emptyMessage` is NOT held here — it is resolved at
/// the view boundary through the P1/S10 facade, the same way the web default
/// `emptyMessage = 'No flow data available'` is applied at render.
public struct WidgetFlowInput: Equatable, Sendable {
    /// The graph nodes (web `nodes`), rendered in order.
    public let nodes: [FlowNode]
    /// The graph edges (web `arrows`).
    public let arrows: [FlowArrow]
    /// Whether to render the dense compact variant (web `compact`).
    public let compact: Bool

    public init(nodes: [FlowNode], arrows: [FlowArrow], compact: Bool = false) {
        self.nodes = nodes
        self.arrows = arrows
        self.compact = compact
    }
}

// MARK: - ProjectedFlowNode / ProjectedFlowArrow (resolved, view-ready)

/// A resolved, view-ready node — the pure derivation the SwiftUI canvas places + draws. `center` is the
/// node center in the `100 × 100` viewBox; `displayValue` is the animated number (web `node.value`);
/// `displayLabel` is the (possibly compacted) on-canvas label; `label` / `formattedValue` are the full,
/// un-compacted strings reused for VoiceOver; `placesLabelAbove` ports the web label placement.
public struct ProjectedFlowNode: Identifiable, Equatable, Sendable {
    public let id: String
    public let center: CGPoint
    public let displayValue: Double
    public let label: String
    public let displayLabel: String
    public let formattedValue: String
    public let systemImage: String?
    public let placesLabelAbove: Bool

    public init(
        id: String,
        center: CGPoint,
        displayValue: Double,
        label: String,
        displayLabel: String,
        formattedValue: String,
        systemImage: String?,
        placesLabelAbove: Bool
    ) {
        self.id = id
        self.center = center
        self.displayValue = displayValue
        self.label = label
        self.displayLabel = displayLabel
        self.formattedValue = formattedValue
        self.systemImage = systemImage
        self.placesLabelAbove = placesLabelAbove
    }
}

/// A resolved, view-ready edge — the pure derivation the SwiftUI canvas strokes. `start` / `end` are the
/// radius-offset endpoints in the `100 × 100` viewBox (web line endpoints offset by the node radius so the
/// line touches the circle edges, not the centers); `strokeWidth` is in viewBox units (web
/// `strokeForValue`, `1...4`); `tone` is the resolved color intent; `active` selects the animated dash.
public struct ProjectedFlowArrow: Identifiable, Equatable, Sendable {
    /// Web key `${from}-${to}`.
    public let id: String
    public let from: String
    public let to: String
    public let start: CGPoint
    public let end: CGPoint
    public let strokeWidth: CGFloat
    public let tone: FlowArrowTone
    public let active: Bool

    public init(
        from: String,
        to: String,
        start: CGPoint,
        end: CGPoint,
        strokeWidth: CGFloat,
        tone: FlowArrowTone,
        active: Bool
    ) {
        id = "\(from)->\(to)"
        self.from = from
        self.to = to
        self.start = start
        self.end = end
        self.strokeWidth = strokeWidth
        self.tone = tone
        self.active = active
    }
}

// MARK: - FlowDiagramCanvas (resolved graph)

/// The resolved, view-ready graph — a pure value the SwiftUI canvas turns into stroked lines + node chips.
/// `nodeRadius` is in viewBox units (web `r`, `14` or `10` in compact). Equatable so the canvas redraws
/// only on a real change; Sendable so it crosses actors.
public struct FlowDiagramCanvas: Equatable, Sendable {
    public let nodeRadius: CGFloat
    public let nodes: [ProjectedFlowNode]
    public let arrows: [ProjectedFlowArrow]

    public init(nodeRadius: CGFloat, nodes: [ProjectedFlowNode], arrows: [ProjectedFlowArrow]) {
        self.nodeRadius = nodeRadius
        self.nodes = nodes
        self.arrows = arrows
    }
}

// MARK: - WidgetFlowDiagramProjection (web render decision)

/// The resolved render decision — the native peer of the web `nodes.length === 0 ? <EmptyState/> : <svg/>`.
/// Only the source's REAL branches exist (see the faithful-parity note above): the empty leaf and the
/// populated graph. Equatable + Sendable so it is a pure, testable read.
public enum WidgetFlowDiagramProjection: Equatable, Sendable {
    /// Web `nodes.length === 0` → the friendly empty leaf (peer of `<EmptyState message={emptyMessage} />`).
    case empty
    /// Web populated `<svg>` graph, carrying the resolved geometry.
    case diagram(FlowDiagramCanvas)
}
