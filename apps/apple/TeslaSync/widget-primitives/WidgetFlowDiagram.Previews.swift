//
//  WidgetFlowDiagram.Previews.swift
//  TeslaSync — P4 widget primitive · 0006 · WidgetFlowDiagram (Apple)
//
//  Xcode previews for every real branch of the flow-diagram primitive: the populated energy-flow graph
//  (battery ⇄ motor with a charger feed), the dense `compact` variant (smaller chips, top-3 arrows,
//  3-letter labels), an all-active power-flow graph (solar / grid / home / battery with marching-ants on
//  every edge), and the friendly empty leaf. DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope. The sample data mirrors the real web callers (EnergyFlowWidget /
//  LivePowerFlowWidget); the Lucide icons map to SF Symbols and the Tailwind override hues to brand-palette
//  indices.
//

import SwiftUI

#if DEBUG
    private enum FlowDiagramPreviewData {
        /// Energy flow: battery (left) ⇄ motor (right), charger (top) feeding the battery.
        static let energyNodes: [FlowNode] = [
            FlowNode(
                id: "battery",
                label: "Battery",
                value: 78,
                formattedValue: "78%",
                systemImage: "battery.100.bolt",
                position: .left
            ),
            FlowNode(
                id: "motor",
                label: "Consuming",
                value: 12.4,
                formattedValue: "12.4 kW",
                systemImage: "bolt.fill",
                position: .right
            ),
            FlowNode(
                id: "charger",
                label: "Charger",
                value: 7.2,
                formattedValue: "7.2 kW",
                systemImage: "powerplug.fill",
                position: .top
            )
        ]

        static let energyArrows: [FlowArrow] = [
            FlowArrow(from: "battery", to: "motor", value: 12.4, active: true, colorPaletteIndex: 4),
            FlowArrow(from: "motor", to: "battery", value: 0, active: false, colorPaletteIndex: 2),
            FlowArrow(from: "charger", to: "battery", value: 7.2, active: true, colorPaletteIndex: 1)
        ]

        /// Live power flow: solar (top), grid (left), home (right), battery (bottom) — all edges active.
        static let powerNodes: [FlowNode] = [
            FlowNode(
                id: "solar",
                label: "Solar",
                value: 4.1,
                formattedValue: "4.1 kW",
                systemImage: "sun.max.fill",
                position: .top
            ),
            FlowNode(
                id: "grid",
                label: "Grid",
                value: 1.3,
                formattedValue: "1.3 kW",
                systemImage: "bolt.horizontal.fill",
                position: .left
            ),
            FlowNode(
                id: "home",
                label: "Home",
                value: 3.6,
                formattedValue: "3.6 kW",
                systemImage: "house.fill",
                position: .right
            ),
            FlowNode(
                id: "battery",
                label: "Battery",
                value: 1.8,
                formattedValue: "1.8 kW",
                systemImage: "battery.100",
                position: .bottom
            )
        ]

        static let powerArrows: [FlowArrow] = [
            FlowArrow(from: "solar", to: "home", value: 3.6, active: true, colorPaletteIndex: 3),
            FlowArrow(from: "solar", to: "battery", value: 1.8, active: true, colorPaletteIndex: 3),
            FlowArrow(from: "grid", to: "home", value: 1.3, active: true, colorPaletteIndex: 0),
            FlowArrow(from: "battery", to: "home", value: 0.5, active: true, colorPaletteIndex: 6)
        ]
    }

    private func stagedFlow(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
                .padding(TSSpacing.md)
                .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md))
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 360, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Populated — energy flow") {
        stagedFlow("battery ⇄ motor · charger feed · active marching-ants") {
            WidgetFlowDiagram(
                nodes: FlowDiagramPreviewData.energyNodes,
                arrows: FlowDiagramPreviewData.energyArrows
            )
            .frame(height: 240)
        }
    }

    #Preview("Compact — top-3 arrows · 3-letter labels") {
        stagedFlow("compact · smaller chips · BAT / CON / CHA") {
            WidgetFlowDiagram(
                nodes: FlowDiagramPreviewData.energyNodes,
                arrows: FlowDiagramPreviewData.energyArrows,
                compact: true
            )
            .frame(width: 150, height: 150)
        }
    }

    #Preview("Populated — live power flow (all active)") {
        stagedFlow("solar / grid / home / battery · every edge active") {
            WidgetFlowDiagram(
                nodes: FlowDiagramPreviewData.powerNodes,
                arrows: FlowDiagramPreviewData.powerArrows
            )
            .frame(height: 260)
        }
    }

    #Preview("Empty — no flow data") {
        stagedFlow("nodes.isEmpty · friendly empty leaf · never a bare box") {
            WidgetFlowDiagram(nodes: [], arrows: [])
                .frame(height: 200)
        }
    }
#endif
