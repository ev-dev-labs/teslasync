//
//  InfoTile.Previews.swift
//  TeslaSync — P4 feature view · 0280 · InfoTile (Apple)
//
//  Xcode previews for every branch the surface renders: the value-type projection
//  (text / number / boolean true / boolean false / blank → em dash), each value tint
//  (primary / muted / success / warning / danger / info / accent), with and without a
//  sub line, and the full telemetry grid the web parent composes (Battery / Speed /
//  Inside / Odometer / Charger / Sentry). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

#if DEBUG
    import SwiftUI

    private func framed(_ view: some View) -> some View {
        view
            .frame(width: 168)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Text value + sub") {
        framed(InfoTile(
            systemImage: "battery.75percent",
            label: "Battery",
            value: .text("85%"),
            valueColor: .success,
            sub: "320 km range"
        ))
    }

    #Preview("Number value") {
        framed(InfoTile(
            systemImage: "gauge.with.dots.needle.67percent",
            label: "Odometer",
            value: .number(48213)
        ))
    }

    #Preview("Boolean — Yes") {
        framed(InfoTile(
            systemImage: "eye.fill",
            label: "Sentry",
            value: .bool(true),
            valueColor: .danger
        ))
    }

    #Preview("Boolean — No") {
        framed(InfoTile(
            systemImage: "eye.slash",
            label: "Sentry",
            value: .bool(false),
            valueColor: .muted
        ))
    }

    #Preview("Empty value (em dash)") {
        framed(InfoTile(
            systemImage: "thermometer.medium",
            label: "Inside",
            value: .text("")
        ))
    }

    #Preview("Long value truncates") {
        framed(InfoTile(
            systemImage: "bolt.fill",
            label: "Charger status with a very long label",
            value: .text("Supercharging at 250 kW — full in 18 minutes"),
            valueColor: .success,
            sub: "A long secondary description that should wrap to two lines at most"
        ))
    }

    #Preview("Tints") {
        let tints: [(InfoTileValueColor, String)] = [
            (.primary, "Primary"),
            (.muted, "Muted"),
            (.success, "Success"),
            (.warning, "Warning"),
            (.danger, "Danger"),
            (.info, "Info"),
            (.accent, "Accent")
        ]
        let columns = [GridItem(.flexible(), spacing: TSSpacing.md), GridItem(.flexible(), spacing: TSSpacing.md)]
        return LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(tints, id: \.0) { tint, name in
                InfoTile(systemImage: "circle.fill", label: name, value: .text("Value"), valueColor: tint)
            }
        }
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Telemetry grid") {
        let columns = [GridItem(.flexible(), spacing: TSSpacing.md), GridItem(.flexible(), spacing: TSSpacing.md)]
        return LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            InfoTile(
                systemImage: "battery.75percent",
                label: "Battery",
                value: .text("85%"),
                valueColor: .success,
                sub: "320 km range"
            )
            InfoTile(
                systemImage: "gauge.open.with.lines.needle.33percent",
                label: "Speed",
                value: .text("0 mph"),
                sub: "Parked"
            )
            InfoTile(
                systemImage: "thermometer.medium",
                label: "Inside",
                value: .text("21°C"),
                sub: "Outside: 14°C"
            )
            InfoTile(systemImage: "location.fill", label: "Odometer", value: .text("48,213 km"))
            InfoTile(
                systemImage: "bolt.fill",
                label: "Charger",
                value: .text("Not charging"),
                valueColor: .muted
            )
            InfoTile(systemImage: "eye.fill", label: "Sentry", value: .bool(false), valueColor: .muted)
        }
        .padding()
        .background(Color.TS.bg)
    }
#endif
