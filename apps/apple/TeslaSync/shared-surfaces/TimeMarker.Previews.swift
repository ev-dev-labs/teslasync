//
//  TimeMarker.Previews.swift
//  TeslaSync — P4 shared surface · 0074 · TimeMarker (Apple)
//
//  Xcode previews for every real branch of the alert time-marker: a chart with an alert context (the
//  severity-colored marker is drawn) for each of the four severities, a chart with no context (no
//  marker — the faithful "x absent" branch), and the live composite. DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Composite · critical") {
        TimeMarkerSurfaceSample(severity: .critical)
    }

    #Preview("Composite · warn (default)") {
        TimeMarkerSurfaceSample(severity: .warn)
    }

    #Preview("Marker · info") {
        staged("alert context · info severity") {
            TimeMarkerSampleChart(
                titleKey: "timeMarker.sample.series.withContext",
                titleFallback: "Battery (alert context)",
                severity: .info
            )
            .alertContext(AlertContextModel(params: TimeMarkerSampleData.params))
        }
    }

    #Preview("Marker · success") {
        staged("alert context · success severity") {
            TimeMarkerSampleChart(
                titleKey: "timeMarker.sample.series.withContext",
                titleFallback: "Battery (alert context)",
                severity: .success
            )
            .alertContext(AlertContextModel(params: TimeMarkerSampleData.params))
        }
    }

    #Preview("No context (no marker)") {
        staged("no drill-through params · marker hidden") {
            TimeMarkerSampleChart(
                titleKey: "timeMarker.sample.series.noContext",
                titleFallback: "Battery (no alert context)",
                severity: .warn
            )
            .alertContext(AlertContextModel(params: .none))
        }
    }

    #Preview("Callout chips") {
        staged("severity label chips") {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(MarkerSeverity.allCases, id: \.self) { severity in
                    TimeMarkerCallout(severity: severity, label: severity.localizedName)
                }
            }
        }
    }
#endif
