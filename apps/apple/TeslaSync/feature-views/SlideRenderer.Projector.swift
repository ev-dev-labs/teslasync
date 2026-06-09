//
//  SlideRenderer.Projector.swift
//  TeslaSync — P4 feature view · 0066 · SlideRenderer (Apple)
//
//  Pure (Foundation-only) projector: SlideDefinitionInput + YearReviewRecap + locale → SlideProjection. Reproduces the
//  web SlideRenderer switch dispatch (incl. the drive-highlight selection it owns). Split from
//  SlideRenderer.Adapter.swift for file-length hygiene.
//

import Foundation

public enum SlideRendererProjector {
    public static func project(
        slide: SlideDefinitionInput,
        recap: YearReviewRecap,
        index: Int,
        localeIdentifier: String = "en_US",
        localize: (String, String) -> String
    ) -> SlideProjection {
        let gradient = SlideRendererGradient.stops(from: slide.background)
        let hero = projectHero(
            slide: slide,
            recap: recap,
            localeIdentifier: localeIdentifier,
            localize: localize
        )
        return SlideProjection(
            index: index,
            kind: slide.kind,
            gradient: gradient,
            hero: hero,
            accessibilityLabel: SlideRendererAccessibility.summary(for: hero, localize: localize)
        )
    }

    private static func projectHero(
        slide: SlideDefinitionInput,
        recap: YearReviewRecap,
        localeIdentifier: String,
        localize loc: (String, String) -> String
    ) -> SlideHero {
        switch slide.kind {
        case .title, .summary:
            recapHero(recap: recap, localeIdentifier: localeIdentifier, localize: loc)
        case .statHero:
            statHero(field: slide.field, recap: recap, localeIdentifier: localeIdentifier, localize: loc)
        case .statChart:
            statHero(field: "drives", recap: recap, localeIdentifier: localeIdentifier, localize: loc)
        case .driveHighlight:
            .driveHighlight(
                driveHighlight(slide: slide, recap: recap, localeIdentifier: localeIdentifier, localize: loc)
            )
        case .chargingBreakdown:
            .chargingBreakdown(
                chargingBreakdown(recap: recap, localeIdentifier: localeIdentifier, localize: loc)
            )
        case .savings:
            statHero(field: "savings", recap: recap, localeIdentifier: localeIdentifier, localize: loc)
        case .environment:
            statHero(field: "environment", recap: recap, localeIdentifier: localeIdentifier, localize: loc)
        case .patterns:
            statHero(field: "patterns", recap: recap, localeIdentifier: localeIdentifier, localize: loc)
        case .comparisons:
            .comparisons(
                emoji: "✨",
                title: loc("slideRenderer.caption.funFacts", "Fun facts about your year"),
                items: recap.comparisons
            )
        case .unknown:
            .none
        }
    }

    /// The title / summary body — the cross-cutting recap identity (`🚗` + the recap year + vehicle).
    private static func recapHero(
        recap: YearReviewRecap,
        localeIdentifier: String,
        localize loc: (String, String) -> String
    ) -> SlideHero {
        .stat(
            emoji: "🚗",
            title: loc("slideRenderer.caption.recap", "Year in Review"),
            value: SlideRendererFormat.integer(recap.year, localeIdentifier: localeIdentifier),
            unit: nil,
            caption: trimmedOrDash(recap.vehicleName)
        )
    }

    /// A single-stat hero — the headline the renderer composes for the stat-driven kinds. `field`
    /// carries the web `stat-hero` field (`distance` / `energy`) plus the synthetic tags the renderer
    /// routes its other single-stat kinds through (`drives` / `savings` / `environment` / `patterns`).
    /// The web stat-hero "% around the Earth" comparison is the StatHeroSlide surface's own concern; the
    /// renderer composes the headline + a neutral owned caption, all in SI. Split across two helpers so
    /// each stays small.
    private static func statHero(
        field: String?,
        recap: YearReviewRecap,
        localeIdentifier: String,
        localize loc: (String, String) -> String
    ) -> SlideHero {
        statHeroPrimary(field: field, recap: recap, localeIdentifier: localeIdentifier, localize: loc)
            ?? statHeroSecondary(field: field, recap: recap, localeIdentifier: localeIdentifier, localize: loc)
    }

    /// The count/energy/savings stat headlines; `nil` for any other field (handled by the secondary).
    private static func statHeroPrimary(
        field: String?,
        recap: YearReviewRecap,
        localeIdentifier: String,
        localize loc: (String, String) -> String
    ) -> SlideHero? {
        switch field {
        case "energy":
            .stat(
                emoji: "⚡",
                title: loc("slideRenderer.caption.energy", "charged"),
                value: fmt(recap.totalEnergyKwh, localeIdentifier),
                unit: "kWh",
                caption: nil
            )
        case "drives":
            .stat(
                emoji: "📊",
                title: loc("slideRenderer.caption.drives", "drives this year"),
                value: fmt(Double(recap.totalDrives), localeIdentifier),
                unit: nil,
                caption: nil
            )
        case "savings":
            .stat(
                emoji: "💰",
                title: loc("slideRenderer.caption.saved", "estimated fuel savings"),
                value: fmt(recap.gasSavings, localeIdentifier),
                unit: nil,
                caption: nil
            )
        default:
            nil
        }
    }

    /// The environment/patterns headlines and the `distance` default (the web `slide.field ?? 'distance'`).
    private static func statHeroSecondary(
        field: String?,
        recap: YearReviewRecap,
        localeIdentifier: String,
        localize loc: (String, String) -> String
    ) -> SlideHero {
        switch field {
        case "environment":
            .stat(
                emoji: "🌍",
                title: loc("slideRenderer.caption.co2", "CO₂ offset"),
                value: fmt(recap.co2OffsetKg, localeIdentifier),
                unit: "kg",
                caption: nil
            )
        case "patterns":
            .stat(
                emoji: "📅",
                title: loc("slideRenderer.caption.mostActiveDay", "most active day"),
                value: trimmedOrDash(recap.mostActiveDayOfWeek),
                unit: nil,
                caption: nil
            )
        default:
            .stat(
                emoji: "🛣️",
                title: loc("slideRenderer.caption.distance", "total distance"),
                value: fmt(recap.totalDistanceKm, localeIdentifier),
                unit: "km",
                caption: nil
            )
        }
    }

    /// `fmtNumber(value, 0)` shorthand bound to a locale.
    private static func fmt(_ value: Double, _ localeIdentifier: String) -> String {
        SlideRendererFormat.number(value, decimals: 0, localeIdentifier: localeIdentifier)
    }

    /// The `drive-highlight` body — the slice the web `SlideRenderer` owns: it selects the drive by
    /// variant, supplies the label key + emoji, and the slide formats route/distance/duration/
    /// efficiency/date. SI display (km, Wh/km).
    private static func driveHighlight(
        slide: SlideDefinitionInput,
        recap: YearReviewRecap,
        localeIdentifier: String,
        localize: (String, String) -> String
    ) -> DriveHighlightHero {
        let variant = slide.driveHighlightVariant
        let label = localize(variant.labelKey, variant.labelFallback)
        guard let drive = recap.drive(for: variant) else {
            return DriveHighlightHero(
                emoji: variant.emoji,
                label: label,
                hasDrive: false,
                noDataText: localize("slideRenderer.driveHighlight.noData", "No drive data for this year"),
                startAddress: "—",
                endAddress: "—",
                distanceText: "—",
                distanceUnit: "km",
                durationText: "—",
                durationLabel: localize("slideRenderer.caption.duration", "duration"),
                efficiencyText: "—",
                efficiencyUnit: "Wh/km",
                date: ""
            )
        }
        let efficiency = drive.efficiencyWhKm > 0
            ? SlideRendererFormat.number(drive.efficiencyWhKm, decimals: 0, localeIdentifier: localeIdentifier)
            : "—"
        return DriveHighlightHero(
            emoji: variant.emoji,
            label: label,
            hasDrive: true,
            noDataText: localize("slideRenderer.driveHighlight.noData", "No drive data for this year"),
            startAddress: nonBlank(drive.startAddress) ?? "—",
            endAddress: nonBlank(drive.endAddress) ?? "—",
            distanceText: SlideRendererFormat.number(drive.distanceKm, decimals: 0, localeIdentifier: localeIdentifier),
            distanceUnit: "km",
            durationText: SlideRendererFormat.duration(minutes: drive.durationMin),
            durationLabel: localize("slideRenderer.caption.duration", "duration"),
            efficiencyText: efficiency,
            efficiencyUnit: "Wh/km",
            date: drive.date
        )
    }

    /// The `charging-breakdown` body — total sessions + average plug-in SOC + the positive mix shares
    /// (web `chartData.filter(d => d.value > 0)`).
    private static func chargingBreakdown(
        recap: YearReviewRecap,
        localeIdentifier: String,
        localize: (String, String) -> String
    ) -> ChargingBreakdownHero {
        let raw: [(String, Double)] = [
            (localize("slideRenderer.charging.supercharger", "Supercharger"), recap.superchargerPct),
            (localize("slideRenderer.charging.dcFast", "DC Fast"), recap.dcFastPct),
            (localize("slideRenderer.charging.acOther", "AC / Other"), recap.acOtherPct)
        ]
        let shares = raw.filter { $0.1 > 0 }.map { label, pct in
            ChargingShare(
                label: label,
                percentText: percent(pct, localeIdentifier: localeIdentifier),
                fraction: max(0, min(pct / 100, 1))
            )
        }
        let socValue = SlideRendererFormat.number(
            recap.avgChargeStartSoc, decimals: 0, localeIdentifier: localeIdentifier
        )
        return ChargingBreakdownHero(
            emoji: "🔌",
            sessionsValue: SlideRendererFormat.integer(recap.totalChargeSessions, localeIdentifier: localeIdentifier),
            sessionsLabel: localize("slideRenderer.charging.sessions", "charge sessions"),
            socCaption: String(
                format: localize("slideRenderer.caption.avgStartSOC", "Average plug-in at %@%% battery"),
                socValue
            ),
            shares: shares
        )
    }

    private static func percent(_ value: Double, localeIdentifier: String) -> String {
        SlideRendererFormat.number(value, decimals: 0, localeIdentifier: localeIdentifier) + "%"
    }

    private static func trimmedOrDash(_ value: String) -> String {
        nonBlank(value) ?? "—"
    }

    private static func nonBlank(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
