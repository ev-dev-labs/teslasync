//
//  TimeMarker.Views.swift
//  TeslaSync — P4 shared surface · 0074 · TimeMarker (Apple)
//
//  The presentational pieces of the alert time-marker: the reference-line mark (the native parity of
//  the web `<ReferenceLine x stroke strokeWidth label>` that `<TimeMarker>` renders) and a DEBUG-only
//  sample that wires a chart to the alert-context environment so the previews + view-composition
//  tests have a concrete reference implementation. All copy resolves through P1/S10; all chrome is
//  token-driven (P1/S9); no raw hex, no Tailwind ports.
//

import Charts
import SwiftUI

// MARK: - Marker label chip (web `<ReferenceLine label={{ value, position: 'top' }}>`)

/// The label rendered at the top of the marker — the native peer of the web `ReferenceLine` `label`
/// prop (`{ value, position: 'top', fill: stroke }`). A severity-tinted capsule with the matching
/// SF Symbol + text, colored from the design tokens. VoiceOver reads the severity + label as one
/// element.
public struct TimeMarkerCallout: View {
    private let severity: MarkerSeverity
    private let label: String

    public init(severity: MarkerSeverity, label: String) {
        self.severity = severity
        self.label = label
    }

    public var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: severity.symbolName)
                .font(Font.TS.caption)
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.label)
                .lineLimit(1)
        }
        .foregroundStyle(severity.stroke)
        .padding(.horizontal, TSSpacing.xs)
        .padding(.vertical, 2)
        .background(severity.tint, in: Capsule())
        .overlay(Capsule().strokeBorder(severity.border, lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }

    private var accessibilityText: String {
        let template = TimeMarkerStrings.string("timeMarker.callout.aria", "%@ marker: %@")
        return String(format: template, severity.localizedName, label)
    }
}

// MARK: - Reference line (web `<ReferenceLine x stroke strokeWidth strokeDasharray label>`)

/// Draws the alert marker inside a `Chart { … }` — the native parity of the web
/// `<TimeMarker>` → `<ReferenceLine>`. Renders nothing when `value` is `nil` (web `if (x == null ||
/// x === '') return null`), so a chart embeds it unconditionally. Handles a `.date` x (the idiomatic
/// time-axis case), a numeric x, and a category-string x — whichever the chart's x-scale uses.
@MainActor
@ChartContentBuilder
public func tsTimeMarkerRule(
    at value: TimeMarkerValue?,
    severity: MarkerSeverity = .markerDefault,
    label: String,
    strokeWidth: Double = 2,
    dashPattern: [Double]? = nil
) -> some ChartContent {
    if let value {
        let style = StrokeStyle(
            lineWidth: CGFloat(strokeWidth),
            dash: (dashPattern ?? []).map { CGFloat($0) }
        )
        switch value {
        case let .date(date):
            RuleMark(x: .value(label, date))
                .foregroundStyle(severity.stroke)
                .lineStyle(style)
                .annotation(position: .top, alignment: .leading, spacing: TSSpacing.xs) {
                    TimeMarkerCallout(severity: severity, label: label)
                }
        case let .number(number):
            RuleMark(x: .value(label, number))
                .foregroundStyle(severity.stroke)
                .lineStyle(style)
                .annotation(position: .top, alignment: .leading, spacing: TSSpacing.xs) {
                    TimeMarkerCallout(severity: severity, label: label)
                }
        case let .text(text):
            RuleMark(x: .value(label, text))
                .foregroundStyle(severity.stroke)
                .lineStyle(style)
                .annotation(position: .top, alignment: .leading, spacing: TSSpacing.xs) {
                    TimeMarkerCallout(severity: severity, label: label)
                }
        }
    }
}

/// Draws a resolved marker — the ergonomic overload taking the projected ``TimeMarkerResolved`` (the
/// `hidden` case contributes no content, exactly the web `return null`).
@MainActor
@ChartContentBuilder
public func tsTimeMarkerRule(_ resolved: TimeMarkerResolved) -> some ChartContent {
    tsTimeMarkerRule(
        at: resolved.value,
        severity: resolved.severity,
        label: resolved.label,
        strokeWidth: resolved.strokeWidth,
        dashPattern: resolved.dashPattern
    )
}

#if DEBUG

    // MARK: - Sample data (DEBUG previews + view-composition tests)

    /// One sample row used by the DEBUG sample chart — a stand-in for the time series a real page
    /// (e.g. Battery Health) feeds its chart while drilling through from an alert.
    struct TimeMarkerSamplePoint: Identifiable {
        let date: Date
        let value: Double

        var id: Date {
            date
        }
    }

    enum TimeMarkerSampleData {
        /// A deterministic base instant (a fixed 2026 moment) so previews + tests never depend on the
        /// wall clock.
        static let base = Date(timeIntervalSince1970: 1_777_000_000)
        static let step: TimeInterval = 5 * 60
        static let alertIndex = 12

        static let series: [TimeMarkerSamplePoint] = (0 ..< 24).map { index in
            TimeMarkerSamplePoint(
                date: base.addingTimeInterval(Double(index) * step),
                value: 78 - 0.6 * Double(index) + 4 * sin(Double(index) / 2.4)
            )
        }

        /// The ISO timestamp of the alert moment (mid-series), the value a drill-through URL's `?t=`
        /// would carry.
        static let alertISO = TimeMarkerDateParser.iso(series[alertIndex].date)

        /// Drill-through params with a full alert context (vehicle + timestamp + signal).
        static let params = TimeMarkerParams(
            vehicleID: "12",
            timestamp: alertISO,
            signal: "BatteryLevel"
        )
    }

    // MARK: - Sample chart (the reference wiring a real chart copies)

    /// A single sample chart. It reads the alert context from the environment (web
    /// `useAlertContext()`), projects the marker, and draws it on a `Date` x-axis. With no context in
    /// the environment (`alertContext == nil` or `hasContext == false`) it renders as an ordinary
    /// chart with no marker — the faithful "no context" / "x absent" branch.
    struct TimeMarkerSampleChart: View {
        let titleKey: String
        let titleFallback: String
        let severity: MarkerSeverity

        @Environment(\.alertContext) private var alertContext

        private var marker: TimeMarkerResolved {
            alertContext?.resolvedMarker(severity: severity) ?? .hidden
        }

        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: TimeMarkerStrings.string(titleKey, titleFallback))
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textSecondary)
                chart
            }
        }

        private var chart: some View {
            Chart {
                ForEach(TimeMarkerSampleData.series) { point in
                    LineMark(
                        x: .value(xAxisLabel, point.date),
                        y: .value(yAxisLabel, point.value)
                    )
                    .foregroundStyle(TSChartPalette.color(at: 0))
                    .interpolationMethod(.monotone)
                }
                tsTimeMarkerRule(marker)
            }
            .chartLegend(.hidden)
            .frame(height: 160)
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: TimeMarkerStrings.string(
                "timeMarker.sample.chart.aria",
                "Battery level over time with alert marker"
            )))
            .accessibilityValue(Text(verbatim: markerAccessibilityValue))
        }

        private var xAxisLabel: String {
            TimeMarkerStrings.string("timeMarker.sample.axis.x", "Time")
        }

        private var yAxisLabel: String {
            TimeMarkerStrings.string("timeMarker.sample.axis.y", "Battery %")
        }

        /// The VoiceOver readout of the marker — present so the marked state is announced, not just
        /// drawn.
        private var markerAccessibilityValue: String {
            guard marker.isVisible else {
                return TimeMarkerStrings.string("timeMarker.sample.marker.none", "No alert marker")
            }
            let template = TimeMarkerStrings.string(
                "timeMarker.sample.marker.at",
                "%@ alert marked"
            )
            return String(format: template, marker.severity.localizedName)
        }
    }

    // MARK: - Sample composite (previews + tests)

    /// The DEBUG sample composite: one chart hosted with a full alert context (so the severity-colored
    /// marker is drawn) and one chart hosted with no context (the faithful "no marker" branch). Each
    /// chart owns a fresh ``AlertContextModel`` so the sample never touches shared state.
    struct TimeMarkerSurfaceSample: View {
        let severity: MarkerSeverity
        @State private var withContext: AlertContextModel
        @State private var withoutContext: AlertContextModel

        init(severity: MarkerSeverity = .critical) {
            self.severity = severity
            _withContext = State(initialValue: AlertContextModel(params: TimeMarkerSampleData.params))
            _withoutContext = State(initialValue: AlertContextModel(params: .none))
        }

        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TimeMarkerSampleChart(
                    titleKey: "timeMarker.sample.series.withContext",
                    titleFallback: "Battery (alert context)",
                    severity: severity
                )
                .alertContext(withContext)

                TimeMarkerSampleChart(
                    titleKey: "timeMarker.sample.series.noContext",
                    titleFallback: "Battery (no alert context)",
                    severity: severity
                )
                .alertContext(withoutContext)
            }
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.bg)
        }
    }
#endif
