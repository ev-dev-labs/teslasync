import SwiftUI
import WidgetKit

/// Named families each widget advertises. Accessory families exist on iOS only, so
/// they are appended under `#if os(iOS)` — referencing them on macOS would not
/// compile.
enum WidgetFamilies {
    /// Home Screen system sizes.
    static var system: [WidgetFamily] {
        [.systemSmall, .systemMedium, .systemLarge]
    }

    /// System sizes including the iPad/macOS extra-large size.
    static var systemWide: [WidgetFamily] {
        system + [.systemExtraLarge]
    }

    /// A small Home Screen tile plus all Lock Screen accessories — for glanceable,
    /// single-number widgets (battery, charge, alerts, health).
    static var glanceable: [WidgetFamily] {
        var families: [WidgetFamily] = [.systemSmall, .systemMedium]
        #if os(iOS)
            families += [.accessoryCircular, .accessoryRectangular, .accessoryInline]
        #endif
        return families
    }

    /// Full system sizes plus accessories.
    static var systemAndAccessories: [WidgetFamily] {
        var families = system
        #if os(iOS)
            families += [.accessoryCircular, .accessoryRectangular, .accessoryInline]
        #endif
        return families
    }
}

/// The honest offline/unavailable state, routed to the right presentation for the
/// current family. Shared by every widget so no widget ever renders a blank panel.
struct WidgetOfflineView: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        #if os(iOS)
            if family.isAccessoryFamily {
                WidgetAccessoryUnavailable(family: family)
            } else {
                WidgetUnavailableView()
            }
        #else
            WidgetUnavailableView()
        #endif
    }
}
