//
//  MoreDetailsPanel.Projection.swift
//  TeslaSync — P4 feature view · 0145 · MoreDetailsPanel (Apple)
//
//  The pure tile-group projection: the cached drive aggregate (`MoreDetailsInput`) + the user's
//  display-unit preferences (`MoreDetailsUnitPrefs`) → the two view-ready `MoreDetailsTiles`
//  groups the web `MoreDetailsPanel` renders, plus the render-phase resolution. Reproduces the
//  web source's exact per-tile expressions (the `&& … : '—'` / `!= null ? … : '?'` guards, the
//  `> 1000 ? kWh : Wh` energy threshold, the `toEfficiencyDisplay` conversion, the raw battery
//  subtraction, and the two conditional temperature tiles). No store, no bundle, no rendered
//  view — only value types — so it is fully unit-testable.
//

import Foundation

public enum MoreDetailsProjection {
    /// Projects the cached aggregate + unit preferences into the two view-ready tile groups. A
    /// `nil` `input` projects the zeroed aggregate, so the surface still renders every tile with
    /// its em-dash / zero fallback — the "never a blank box" empty contract.
    public static func tiles(from input: MoreDetailsInput?, prefs: MoreDetailsUnitPrefs) -> MoreDetailsTiles {
        let ctx = Context(stats: input ?? MoreDetailsInput(), prefs: prefs, locale: resolvedLocale(prefs))
        return MoreDetailsTiles(primary: primary(ctx), secondary: secondary(ctx))
    }

    /// Resolves the surface render phase. The skeleton shows only on the initial fetch (no value
    /// yet); a resolved payload renders content; a resolved-but-empty payload renders the tile
    /// grid with fallbacks; a failure with cached data stays content (the chip/banner flag
    /// staleness), and a failure with no cached data shows the retryable error.
    public static func resolvePhase(_ status: MoreDetailsLoadStatus, hasValue: Bool) -> MoreDetailsPhase {
        switch status {
        case .loading:
            hasValue ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasValue ? .content : .empty
        case let .failed(message):
            hasValue ? .content : .error(message)
        }
    }

    // MARK: - Shared per-build context

    /// The values every tile builder needs, bundled so the builders stay short + signature-light.
    private struct Context {
        let stats: MoreDetailsInput
        let prefs: MoreDetailsUnitPrefs
        let locale: Locale
        var dp: Int {
            prefs.precision
        }
    }

    /// A tile's static identity (id + localized label key/fallback + accent), bundled so the
    /// value-specific builders stay within the parameter budget.
    private struct Spec {
        let id: String
        let key: String
        let fallback: String
        let accent: MoreDetailsAccent
    }

    // MARK: - Groups (web first + second grids)

    private static func primary(_ ctx: Context) -> [MoreDetailsTile] {
        [
            odometerTile(ctx),
            rangeTile(ctx),
            elevationTile(ctx),
            energyTile(
                Spec(
                    id: "energyConsumed",
                    key: "driveDetail.energyConsumed",
                    fallback: "Energy Consumed",
                    accent: .amber
                ),
                wh: ctx.stats.energyWh,
                ctx
            ),
            energyTile(
                Spec(
                    id: "energyRecovered",
                    key: "driveDetail.energyRecovered",
                    fallback: "Energy Recovered",
                    accent: .green
                ),
                wh: ctx.stats.regenWh,
                ctx
            ),
            consumptionTile(ctx)
        ]
    }

    private static func secondary(_ ctx: Context) -> [MoreDetailsTile] {
        var tiles = [avgPowerTile(ctx)]
        if let outside = ctx.stats.avgOutsideTemp {
            tiles.append(tempTile(
                Spec(
                    id: "avgOutsideTemp",
                    key: "driveDetail.avgOutsideTemp",
                    fallback: "Avg Outside Temp",
                    accent: .blue
                ),
                celsius: outside,
                ctx
            ))
        }
        if let inside = ctx.stats.avgInsideTemp {
            tiles.append(tempTile(
                Spec(
                    id: "avgInsideTemp",
                    key: "driveDetail.avgInsideTemp",
                    fallback: "Avg Inside Temp",
                    accent: .orange
                ),
                celsius: inside,
                ctx
            ))
        }
        tiles.append(minSpeedTile(ctx))
        tiles.append(batteryTile(ctx))
        tiles.append(energyTile(
            Spec(id: "netEnergy", key: "driveDetail.netEnergy", fallback: "Net Consumption", accent: .cyan),
            wh: ctx.stats.energyWh - ctx.stats.regenWh,
            ctx
        ))
        return tiles
    }

    // MARK: - Tile builders (one web stat cell each)

    private static func odometerTile(_ ctx: Context) -> MoreDetailsTile {
        MoreDetailsTile(
            id: "odometer",
            labelKey: "driveDetail.odometer",
            labelFallback: "Odometer (From → To)",
            accent: .cyan,
            value: .mutedUnit(value: odometerValue(ctx), unit: ctx.prefs.distance)
        )
    }

    private static func rangeTile(_ ctx: Context) -> MoreDetailsTile {
        MoreDetailsTile(
            id: "range",
            labelKey: "driveDetail.rangeStartEnd",
            labelFallback: "Range (Start → End)",
            accent: .green,
            value: .mutedUnit(value: rangeValue(ctx), unit: ctx.prefs.distance)
        )
    }

    private static func elevationTile(_ ctx: Context) -> MoreDetailsTile {
        MoreDetailsTile(
            id: "elevation",
            labelKey: "driveDetail.elevSummary",
            labelFallback: "Elevation Summary",
            accent: .neutral,
            value: .elevation(
                gain: "\(num(ctx.stats.elevGain, ctx)) m",
                loss: "\(num(ctx.stats.elevLoss, ctx)) m"
            )
        )
    }

    private static func consumptionTile(_ ctx: Context) -> MoreDetailsTile {
        MoreDetailsTile(
            id: "consumption",
            labelKey: "driveDetail.consumptionRate",
            labelFallback: "Consumption",
            accent: .purple,
            value: .mutedUnit(
                value: consumptionValue(ctx),
                unit: MoreDetailsFormat.efficiencyUnit(distance: ctx.prefs.distance)
            )
        )
    }

    private static func avgPowerTile(_ ctx: Context) -> MoreDetailsTile {
        MoreDetailsTile(
            id: "avgPower",
            labelKey: "driveDetail.avgPower",
            labelFallback: "Avg Power",
            accent: .amber,
            value: .mutedUnit(value: num(ctx.stats.avgPower, ctx), unit: "kW")
        )
    }

    private static func tempTile(_ spec: Spec, celsius: Double, _ ctx: Context) -> MoreDetailsTile {
        MoreDetailsTile(
            id: spec.id,
            labelKey: spec.key,
            labelFallback: spec.fallback,
            accent: spec.accent,
            value: .plain("\(num(celsius, ctx))\(ctx.prefs.temperature)")
        )
    }

    private static func minSpeedTile(_ ctx: Context) -> MoreDetailsTile {
        MoreDetailsTile(
            id: "minSpeed",
            labelKey: "driveDetail.minSpeed",
            labelFallback: "Min Speed",
            accent: .neutral,
            value: .plain(
                "\(MoreDetailsFormat.fmtNumber(ctx.stats.minSpd, decimals: 0, locale: ctx.locale)) \(ctx.prefs.speed)"
            )
        )
    }

    private static func batteryTile(_ ctx: Context) -> MoreDetailsTile {
        MoreDetailsTile(
            id: "batteryUsed",
            labelKey: "driveDetail.batteryUsed",
            labelFallback: "Battery Used",
            accent: .amber,
            value: .plain(batteryValue(ctx))
        )
    }

    private static func energyTile(_ spec: Spec, wh: Double, _ ctx: Context) -> MoreDetailsTile {
        MoreDetailsTile(
            id: spec.id,
            labelKey: spec.key,
            labelFallback: spec.fallback,
            accent: spec.accent,
            value: .plain(energyValue(wh, ctx))
        )
    }

    // MARK: - Per-tile value rules (web expressions)

    /// Web `start && end ? '${fmtNumber(start)} → ${fmtNumber(end)}' : '—'` — a zero on either side
    /// is falsy and falls back to the em-dash.
    private static func odometerValue(_ ctx: Context) -> String {
        guard ctx.stats.odometerStart != 0, ctx.stats.odometerEnd != 0 else { return MoreDetailsFormat.emDash }
        return "\(num(ctx.stats.odometerStart, ctx)) → \(num(ctx.stats.odometerEnd, ctx))"
    }

    /// Web `startRange != null ? '${fmtNumber(startRange)} → ${endRange != null ? fmtNumber(endRange) : '?'}' : '—'`.
    private static func rangeValue(_ ctx: Context) -> String {
        guard let start = ctx.stats.startRange else { return MoreDetailsFormat.emDash }
        let end = ctx.stats.endRange.map { num($0, ctx) } ?? "?"
        return "\(num(start, ctx)) → \(end)"
    }

    /// Web `consumptionWhKm > 0 ? fmtNumber(toEfficiencyDisplay(consumptionWhKm)) : '—'`.
    private static func consumptionValue(_ ctx: Context) -> String {
        guard ctx.stats.consumptionWhKm > 0 else { return MoreDetailsFormat.emDash }
        let display = MoreDetailsFormat.toEfficiencyDisplay(ctx.stats.consumptionWhKm, distance: ctx.prefs.distance)
        return num(display, ctx)
    }

    /// Web `wh > 1000 ? fmtWithUnit(wh / 1000, 'kWh') : '${fmtNumber(wh)} Wh'`.
    private static func energyValue(_ wh: Double, _ ctx: Context) -> String {
        wh > 1000 ? "\(num(wh / 1000, ctx)) kWh" : "\(num(wh, ctx)) Wh"
    }

    /// Web `start != null && end != null ? '${start - end}%' : '—'` — a raw integer subtraction
    /// (no locale grouping), the battery percentages being integers.
    private static func batteryValue(_ ctx: Context) -> String {
        guard let start = ctx.stats.startBatteryPct,
              let end = ctx.stats.endBatteryPct else { return MoreDetailsFormat.emDash }
        return "\(start - end)%"
    }

    /// `fmtNumber` at the global precision the web reads (`numberFormat.ts` default 2).
    private static func num(_ value: Double, _ ctx: Context) -> String {
        MoreDetailsFormat.fmtNumber(value, decimals: ctx.dp, locale: ctx.locale)
    }

    private static func resolvedLocale(_ prefs: MoreDetailsUnitPrefs) -> Locale {
        prefs.locale.map(Locale.init(identifier:)) ?? Locale(identifier: "en-US")
    }
}
