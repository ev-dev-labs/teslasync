import Foundation

/// Stable WidgetKit `kind` identifiers. WidgetKit persists user-placed widgets by
/// these strings, so they must never change once shipped.
enum WidgetKind {
    static let vehicleStatus = "io.teslasync.widget.vehicle-status"
    static let charging = "io.teslasync.widget.charging"
    static let recentDrive = "io.teslasync.widget.recent-drive"
    static let alerts = "io.teslasync.widget.alerts"
    static let energy = "io.teslasync.widget.energy"
    static let systemHealth = "io.teslasync.widget.system-health"
}
