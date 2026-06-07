import SwiftUI
import WidgetKit

/// Preview fixtures for the widgets. These render in the Xcode canvas (and under the
/// `xcodebuild` test/snapshot gate) across families, freshness states, color scheme,
/// and Dynamic Type. They use only the non-personal sample snapshot.
extension TeslaSyncWidgetEntry {
    static func preview(_ freshness: WidgetFreshness = .fresh, reference: Date = .now) -> TeslaSyncWidgetEntry {
        TeslaSyncWidgetEntry(date: reference, snapshot: .sample(reference: reference), freshness: freshness)
    }

    static func previewOffline(reference: Date = .now) -> TeslaSyncWidgetEntry {
        TeslaSyncWidgetEntry(
            date: reference,
            snapshot: .empty(generatedAt: reference.addingTimeInterval(-7200)),
            freshness: .offline
        )
    }
}

#Preview("Vehicle · Small", as: .systemSmall) {
    VehicleStatusWidget()
} timeline: {
    TeslaSyncWidgetEntry.preview(.fresh)
    TeslaSyncWidgetEntry.preview(.stale)
    TeslaSyncWidgetEntry.previewOffline()
}

#Preview("Vehicle · Medium", as: .systemMedium) {
    VehicleStatusWidget()
} timeline: {
    TeslaSyncWidgetEntry.preview(.fresh)
}

#Preview("Charging · Small", as: .systemSmall) {
    ChargingProgressWidget()
} timeline: {
    TeslaSyncWidgetEntry.preview(.fresh)
}

#Preview("Recent Drive · Medium", as: .systemMedium) {
    RecentDriveWidget()
} timeline: {
    TeslaSyncWidgetEntry.preview(.fresh)
}

#Preview("Alerts · Small", as: .systemSmall) {
    AlertCountWidget()
} timeline: {
    TeslaSyncWidgetEntry.preview(.fresh)
}

#Preview("Energy · Medium", as: .systemMedium) {
    EnergySnapshotWidget()
} timeline: {
    TeslaSyncWidgetEntry.preview(.fresh)
}

#Preview("System · Small", as: .systemSmall) {
    SystemHealthWidget()
} timeline: {
    TeslaSyncWidgetEntry.preview(.fresh)
}

#if os(iOS)
    #Preview("Vehicle · Circular", as: .accessoryCircular) {
        VehicleStatusWidget()
    } timeline: {
        TeslaSyncWidgetEntry.preview(.fresh)
    }

    #Preview("Charging · Rectangular", as: .accessoryRectangular) {
        ChargingProgressWidget()
    } timeline: {
        TeslaSyncWidgetEntry.preview(.fresh)
    }
#endif

// Dark mode + Dynamic Type checks on the entry views directly. The entry view reads
// `widgetFamily` from the environment, which defaults to `.systemMedium` in this
// preview context (the value is read-only and cannot be set on a plain-view #Preview).
#Preview("Vehicle · Dark", traits: .fixedLayout(width: 360, height: 170)) {
    VehicleStatusEntryView(entry: .preview(.fresh))
        .environment(\.colorScheme, .dark)
}

#Preview("Vehicle · XL Type", traits: .fixedLayout(width: 360, height: 170)) {
    VehicleStatusEntryView(entry: .preview(.stale))
        .environment(\.dynamicTypeSize, .accessibility3)
}

#Preview("Offline · Medium", traits: .fixedLayout(width: 360, height: 170)) {
    VehicleStatusEntryView(entry: .previewOffline())
}
