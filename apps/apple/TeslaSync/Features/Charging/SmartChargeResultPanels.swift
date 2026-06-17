//
//  SmartChargeResultPanels.swift
//  TeslaSync — P4-APPLE P7 · page:charging/SmartCharge (Apple) — Result panels
//
//  The optimize-result sections that appear once a schedule is computed: the
//  Rate Timeline panel (web "24-Hour Rate Timeline" + optimal-window caption) and
//  GlassPanel6, the Recommended Schedule panel (the SOC / start / end detail grid,
//  the Apply action with its applied confirmation + apply-error surface, and the
//  alternative windows list). Bound to the page model through `@Bindable`.
//

import SwiftUI

// MARK: - Rate timeline panel (web Rate Timeline section)

struct SmartChargeRateTimelinePanel: View {
    let result: SmartChargeOptimization
    let chargeWindow: SmartChargeWindowHours?

    var body: some View {
        SmartChargePanel(
            icon: "clock.fill",
            titleKey: "chargePlanner.rateTimeline",
            titleFallback: "24-Hour Rate Timeline"
        ) {
            SmartChargeRateTimeline(rates: result.hourlyRates, chargeWindow: chargeWindow)
            Text(verbatim: windowInfo)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    private var windowInfo: String {
        SmartChargeStrings.windowInfo(
            start: SmartChargeFormat.time(result.schedule.startTime),
            end: SmartChargeFormat.time(result.schedule.endTime)
        )
    }
}

// MARK: - Schedule panel (web Schedule Details & Apply → GlassPanel6)

struct SmartChargeSchedulePanel: View {
    @Bindable var model: SmartChargePageModel
    let result: SmartChargeOptimization

    private var detailColumns: [GridItem] {
        [GridItem(.adaptive(minimum: 130), spacing: TSSpacing.lg, alignment: .top)]
    }

    var body: some View {
        SmartChargePanel(
            icon: "calendar.badge.clock",
            titleKey: "chargePlanner.schedule",
            titleFallback: "Recommended Schedule",
            trailing: { applyControl },
            content: { scheduleContent }
        )
    }

    @ViewBuilder
    private var scheduleContent: some View {
        if let message = model.applyErrorMessage {
            Text(verbatim: message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.statusDanger)
        }
        LazyVGrid(columns: detailColumns, alignment: .leading, spacing: TSSpacing.lg) {
            detail("chargePlanner.currentSoc", "Current SOC", "\(result.currentSoc)%")
            detail("chargePlanner.targetSocLabel", "Target SOC", "\(result.targetSoc)%")
            detail("chargePlanner.startTime", "Start Time", SmartChargeFormat.time(result.schedule.startTime))
            detail("chargePlanner.endTime", "End Time", SmartChargeFormat.time(result.schedule.endTime))
        }
        if !result.alternativeWindows.isEmpty {
            alternativesSection
        }
    }

    // MARK: Apply control (web button / applied chip)

    @ViewBuilder
    private var applyControl: some View {
        if model.isApplied {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "checkmark.circle.fill").accessibilityHidden(true)
                Text(verbatim: SmartChargeStrings.text("chargePlanner.applied", "Schedule Applied!"))
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
            }
            .foregroundStyle(Color.TS.statusSuccess)
            .accessibilityElement(children: .combine)
        } else {
            TSButton(
                isLoading: model.isApplying,
                action: { Task { await model.apply() } },
                label: {
                    Label(SmartChargeStrings.key("chargePlanner.applySchedule"), systemImage: "bolt.fill")
                }
            )
        }
    }

    private func detail(_ key: String, _ fallback: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: SmartChargeStrings.text(key, fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: value)
                .font(Font.TS.body)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Alternatives (web Alternative Windows)

    private var alternativesSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Divider().overlay(Color.TS.border)
            Text(verbatim: SmartChargeStrings.text("chargePlanner.alternatives", "Alternative Windows"))
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textSecondary)
            ForEach(result.alternativeWindows) { window in
                alternativeRow(window)
            }
        }
    }

    private func alternativeRow(_ window: SmartChargeWindow) -> some View {
        HStack(spacing: TSSpacing.md) {
            Text(verbatim: "\(SmartChargeFormat.time(window.startTime)) — \(SmartChargeFormat.time(window.endTime))")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: window.rateTier)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: SmartChargeFormat.currency(window.estimatedCost))
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surface.opacity(0.5), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
