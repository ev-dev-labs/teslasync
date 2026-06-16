import SwiftUI

// MARK: - Form panel (web GlassPanel1 — "Plan Your Trip")

/// The route-input form (web GlassPanel1): origin/destination address fields, the current + min-arrival
/// SOC sliders, the driving-speed select, the Plan-Trip + Send-to-Car actions, and the vehicle-battery
/// readout. Binds directly to the `@Observable` model's form state.
struct TripPlannerFormSection: View {
    @Bindable var model: TripPlannerPageModel
    let isCompact: Bool

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                addressFields
                controls
                actions
            }
        }
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "location.north.circle.fill")
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            TSPanelTitle("tripPlanner.form.title")
        }
    }

    /// Web `From` / `To` AddressInputs (the rich autocomplete is the sibling AddressInput parity unit;
    /// here the native text fields capture the address the planner resolves).
    @ViewBuilder
    private var addressFields: some View {
        if isCompact {
            VStack(spacing: TSSpacing.md) {
                originField
                destinationField
            }
        } else {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                originField
                destinationField
            }
        }
    }

    private var originField: some View {
        TSTextField("tripPlanner.form.origin", text: $model.originText, label: "tripPlanner.form.from")
            .frame(maxWidth: .infinity)
    }

    private var destinationField: some View {
        TSTextField("tripPlanner.form.destination", text: $model.destText, label: "tripPlanner.form.to")
            .frame(maxWidth: .infinity)
    }

    /// Web SOC sliders + driving-speed select.
    @ViewBuilder
    private var controls: some View {
        if isCompact {
            VStack(spacing: TSSpacing.md) {
                currentSOCSlider
                minArrivalSlider
                speedSelect
            }
        } else {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                currentSOCSlider.frame(maxWidth: .infinity)
                minArrivalSlider.frame(maxWidth: .infinity)
                speedSelect.frame(maxWidth: .infinity)
            }
        }
    }

    private var currentSOCSlider: some View {
        TSSlider(
            "tripPlanner.form.currentSOC",
            value: $model.currentSOC,
            in: 10 ... 100,
            format: { "\(Int($0))%" }
        )
    }

    private var minArrivalSlider: some View {
        TSSlider(
            "tripPlanner.form.minArrival",
            value: $model.minArrivalSOC,
            in: 5 ... 50,
            format: { "\(Int($0))%" }
        )
    }

    private var speedSelect: some View {
        TSSelect(
            selection: $model.speedOption,
            options: model.speedOptions.map { TSSelectOption($0, $0.titleKey) },
            label: "tripPlanner.form.drivingSpeed"
        )
    }

    /// Web action row: Plan Trip + (when planned) Send to Car + the vehicle-battery readout.
    @ViewBuilder
    private var actions: some View {
        if isCompact {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(spacing: TSSpacing.md) {
                    planButton
                    if model.plan != nil { sendButton }
                }
                batteryReadout
            }
        } else {
            HStack(spacing: TSSpacing.md) {
                planButton
                if model.plan != nil { sendButton }
                batteryReadout
                Spacer(minLength: 0)
            }
        }
    }

    private var planButton: some View {
        TSButton(
            variant: .primary,
            action: { Task { await model.planTrip() } },
            label: {
                HStack(spacing: TSSpacing.xs) {
                    if model.isPlanning {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "arrow.triangle.turn.up.right.diamond.fill")
                    }
                    Text(model.isPlanning ? "tripPlanner.form.planning" : "tripPlanner.form.planTrip")
                }
            }
        )
        .disabled(!model.canPlan || model.isPlanning)
    }

    private var sendButton: some View {
        TSButton(
            variant: .secondary,
            action: { Task { await model.sendToCar() } },
            label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "paperplane.fill")
                    Text("tripPlanner.form.sendToCar")
                }
            }
        )
    }

    @ViewBuilder
    private var batteryReadout: some View {
        if let battery = model.selectedVehicle?.batteryLevel {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "minus.plus.batteryblock.fill")
                    .accessibilityHidden(true)
                Text(verbatim: String(format: String(localized: "tripPlanner.form.vehicleBattery"), Int(battery)))
                    .font(Font.TS.bodySm)
            }
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityElement(children: .combine)
        }
    }
}

// MARK: - Result sections (web disclaimer + stat grid + feasibility + weather)

/// The loaded-plan body (web success state): the straight-line disclaimer, the six summary stat cards,
/// the not-feasible warning, and the weather-impact panel — each shown on the same web condition.
struct TripPlannerResultSections: View {
    let plan: TripPlan
    let units: UnitPreferences
    let currencySymbol: String
    let isCompact: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            if plan.route.isEstimate { disclaimer }
            TripPlannerStatsSection(
                route: plan.route,
                units: units,
                currencySymbol: currencySymbol,
                isCompact: isCompact
            )
            if !plan.route.feasible { feasibility }
            if plan.weatherImpact.efficiencyFactor != 1.0 {
                TripPlannerWeatherSection(weather: plan.weatherImpact)
            }
        }
    }

    /// Web amber estimate disclaimer (`route.is_estimate`).
    private var disclaimer: some View {
        TSAlertBanner(
            tone: .warning,
            systemImage: "exclamationmark.triangle.fill",
            title: "tripPlanner.disclaimer"
        )
    }

    /// Web danger feasibility warning (`!route.feasible`).
    private var feasibility: some View {
        TSAlertBanner(
            tone: .danger,
            systemImage: "exclamationmark.triangle.fill",
            title: "tripPlanner.notFeasible"
        )
    }
}

// MARK: - Summary stat cards (web Distance / Total-Time / Driving / Charging / Energy / Est-Cost)

/// The six trip-summary stat cards (web `StatCard` grid). SI values format at the boundary via
/// `TripPlannerFormat`; the grid reflows two-up on compact iPhone and flows wider on regular width.
struct TripPlannerStatsSection: View {
    let route: TripPlanRoute
    let units: UnitPreferences
    let currencySymbol: String
    let isCompact: Bool

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            TSStatCard(
                title: "tripPlanner.stats.distance",
                value: TripPlannerFormat.distance(route.totalDistanceM, units),
                systemImage: "road.lanes"
            )
            TSStatCard(
                title: "tripPlanner.stats.totalTime",
                value: TripPlannerFormat.duration(seconds: route.totalDurationS),
                systemImage: "clock"
            )
            TSStatCard(
                title: "tripPlanner.stats.drivingTime",
                value: TripPlannerFormat.duration(seconds: route.drivingDurationS),
                systemImage: "location.north.fill"
            )
            TSStatCard(
                title: "tripPlanner.stats.chargingTime",
                value: chargingValue,
                systemImage: "bolt.fill"
            )
            TSStatCard(
                title: "tripPlanner.stats.energy",
                value: TripPlannerFormat.energy(route.totalEnergyWh, units),
                systemImage: "battery.100"
            )
            TSStatCard(
                title: "tripPlanner.stats.cost",
                value: costValue,
                systemImage: "dollarsign.circle"
            )
        }
    }

    private var columns: [GridItem] {
        isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.md), GridItem(.flexible(), spacing: TSSpacing.md)]
            : [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]
    }

    /// Web `route.charging_duration_s > 0 ? formatDuration(...) : '—'`.
    private var chargingValue: String {
        route.chargingDurationS > 0
            ? TripPlannerFormat.duration(seconds: route.chargingDurationS)
            : TripPlannerFormat.emptyValue
    }

    /// Web `route.estimated_cost > 0 ? formatCurrency(...) : t('common.free')`.
    private var costValue: String {
        route.estimatedCost > 0
            ? TripPlannerFormat.currency(route.estimatedCost, units, symbol: currencySymbol)
            : String(localized: "common.free")
    }
}

// MARK: - Weather impact (web GlassPanel8)

/// The weather-impact panel (web GlassPanel8 — shown when `efficiency_factor !== 1.0`): the backend note
/// and, when an average temperature is known, the efficiency-factor line.
struct TripPlannerWeatherSection: View {
    let weather: TripWeatherImpact

    var body: some View {
        TSGlassPanel {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                Image(systemName: "thermometer.medium")
                    .foregroundStyle(Color.TS.statusWarning)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    TSSubhead("tripPlanner.weather.title")
                    Text(verbatim: weather.note)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    if weather.avgTempC != nil {
                        Text(verbatim: factorLine)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var factorLine: String {
        String(
            format: String(localized: "tripPlanner.weather.factor"),
            TripPlannerFormat.weatherFactor(weather.efficiencyFactor)
        )
    }
}
