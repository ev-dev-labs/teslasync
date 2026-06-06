import Foundation

/// Shared identifiers for the TeslaSync widget data channel.
///
/// The app (writer) and the WidgetKit extensions (readers) live in separate
/// processes/sandboxes, so the only place they can exchange data is the App Group
/// container. These constants are the single source of truth for that channel and
/// for the deep-link scheme, so the app and the widgets can never disagree.
public enum WidgetAppGroup {
    /// The App Group both the apps and the widget extensions are entitled to.
    /// Mirrors the `com.apple.security.application-groups` value in every target's
    /// entitlements (`io.teslasync` bundle prefix, ADR-002).
    public static let identifier = "group.io.teslasync.app"

    /// File the cached snapshot is persisted under inside the group container.
    public static let snapshotFileName = "widget-snapshot.json"
}

/// Custom URL scheme the widgets deep-link into and the app resolves to a route.
public enum WidgetURLScheme {
    public static let scheme = "teslasync"
}
