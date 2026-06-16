import CoreLocation
import MapKit
import SwiftUI

// The Driving detail route map (web `RouteMapSection`). Renders through the P3 MapKit wrapper
// (`TSMapView`) — never a web view — with the drive's trail, start/end markers, and a map-style
// switcher. The speed-band legend mirrors the web's speed-coloured route legend with its
// thresholds converted to the user's speed unit at the render boundary (ADR-005). Resolves its
// own empty / stationary / success states exactly as the web page does.

struct DriveRouteMapSection: View {
    let record: DriveDetailRecord
    let route: [DriveRouteCoordinate]

    @Environment(\.tsUnits) private var units
    @State private var style: TSMapStyle = .standard
    @State private var camera: MapCameraPosition

    init(record: DriveDetailRecord, route: [DriveRouteCoordinate]) {
        self.record = record
        self.route = route
        let coordinates = route.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
        _camera = State(initialValue: TSMapCamera.fitting(coordinates))
    }

    private var coordinates: [CLLocationCoordinate2D] {
        route.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
    }

    private var anchor: CLLocationCoordinate2D? {
        if let first = coordinates.first { return first }
        if let lat = record.startLat, let lon = record.startLon { return CLLocationCoordinate2D(
            latitude: lat,
            longitude: lon
        ) }
        return nil
    }

    private var hasMeaningfulRoute: Bool {
        coordinates.count >= 2
    }

    var body: some View {
        DriveDetailPanel(title: "driveDetail.route", systemImage: "map") {
            if coordinates.isEmpty, anchor == nil {
                emptyState
            } else {
                mapBody
            }
        }
    }

    @ViewBuilder
    private var mapBody: some View {
        ZStack(alignment: .top) {
            TSMapView(camera: $camera, annotations: annotations, route: coordinates, style: style)
                .frame(minHeight: 280)
                .clipShape(RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
            if !hasMeaningfulRoute {
                TSAlertBanner(
                    tone: .info,
                    systemImage: "location.slash",
                    title: "driveDetail.stationaryRouteTitle",
                    message: "driveDetail.stationaryRouteBody"
                )
                .padding(TSSpacing.sm)
            }
        }
        HStack {
            TSMapLayerSwitcher(style: $style).frame(maxWidth: 260)
            Spacer()
        }
        if hasMeaningfulRoute {
            speedLegend
        }
        footer
    }

    private var annotations: [TSMapAnnotation] {
        var result: [TSMapAnnotation] = []
        if let start = coordinates.first ?? anchor {
            result.append(TSMapAnnotation(
                id: "start",
                coordinate: start,
                title: "driveDetail.start",
                tone: .success,
                systemImage: "mappin.circle.fill"
            ))
        }
        if hasMeaningfulRoute, let end = coordinates.last {
            result.append(TSMapAnnotation(
                id: "end",
                coordinate: end,
                title: "driveDetail.end",
                tone: .danger,
                systemImage: "flag.checkered.circle.fill"
            ))
        }
        return result
    }

    private var speedLegend: some View {
        let low = DriveDetailDerivations.speedSegmentLowMps
        let med = DriveDetailDerivations.speedSegmentMedMps
        let high = DriveDetailDerivations.speedSegmentHighMps
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.md) {
                legendChip(.low, "< \(threshold(low))")
                legendChip(.medium, "\(threshold(low))–\(threshold(med))")
                legendChip(.high, "\(threshold(med))–\(threshold(high))")
                legendChip(.veryHigh, "> \(threshold(high))")
                Text(verbatim: units.speed).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            }
        }
        .accessibilityHidden(true)
    }

    private func legendChip(_ band: DriveSpeedBand, _ label: String) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Capsule().fill(TSChartPalette.color(at: band.colorIndex)).frame(width: 14, height: 4)
            Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
    }

    private func threshold(_ mps: Double) -> String {
        DriveDetailFormat.number(Units.convertSpeed(mps, units), decimals: 0)
    }

    private var footer: some View {
        HStack {
            Label {
                Text(
                    verbatim: "\(String(localized: "driveDetail.start")): \(DriveDetailDateText.time(record.startedAt))"
                )
            } icon: {
                Image(systemName: "flag.fill")
            }
            .font(Font.TS.caption).foregroundStyle(Color.TS.statusSuccess)
            Spacer()
            if let end = record.endedAt {
                Label {
                    Text(verbatim: "\(String(localized: "driveDetail.end")): \(DriveDetailDateText.time(end))")
                } icon: {
                    Image(systemName: "flag.checkered")
                }
                .font(Font.TS.caption).foregroundStyle(Color.TS.statusDanger)
            }
        }
    }

    private var emptyState: some View {
        TSEmptyState(title: "driveDetail.noRouteData", systemImage: "map")
            .frame(maxWidth: .infinity, minHeight: 200)
    }
}
