//
//  Layout.Nav.swift
//  TeslaSync — P4 shared surface · 0169 · Layout (Apple)
//
//  The navigation catalog — the verbatim port of the web `navSections` constant from `Layout.tsx`. Every
//  section and every destination is reproduced with its authored title/label and route; the web `Icons.*`
//  glyph is mapped to its nearest SF Symbol so the native sidebar reads the same. The web visibility flags
//  (`minVehicles`, `requiresAuth`) are carried through verbatim so the pure ``LayoutProjector`` filters
//  identically. Labels are rendered as authored (the web `navI18nKeys` map is intentionally empty), so they
//  are data — not i18n keys; the surface's 20 i18n keys are the CHROME strings (see Layout.Strings.swift).
//
//  A compact `nav(_:_:_:)` factory keeps each row on one line within the line-length budget.
//

import Foundation

/// Compact factory for a catalog row — `to`, `label`, SF Symbol, plus the optional visibility flags.
private func nav(_ to: String, _ label: String, _ sym: String, min: Int = 0, auth: Bool = false) -> LayoutNavItem {
    LayoutNavItem(to: to, label: label, symbol: sym, minVehicles: min, requiresAuth: auth)
}

/// The full navigation catalog — the native peer of the web `navSections` (19 sections, every item).
public enum LayoutNavCatalog {
    /// The canonical sidebar structure, in authored order.
    public static let sections: [LayoutNavSection] = [
        LayoutNavSection(title: "Home", items: [
            nav("/", "Dashboard", "square.grid.2x2.fill"),
            nav("/explore", "Explore Features", "sparkles"),
            nav("/live", "Live Map", "dot.radiowaves.up.forward"),
            nav("/timeline", "Timeline", "clock.fill"),
            nav("/weekly-digest", "Weekly Digest", "calendar.badge.checkmark")
        ]),
        LayoutNavSection(title: "Vehicles", items: [
            nav("/vehicles", "My Vehicles", "car.2.fill"),
            nav("/digital-twin", "Vehicle Live View", "display"),
            nav("/vehicle-comparison", "Compare Vehicles", "arrow.left.arrow.right", min: 2),
            nav("/locations", "Saved Locations", "mappin.and.ellipse")
        ]),
        LayoutNavSection(title: "Driving", items: [
            nav("/drives", "Drives", "steeringwheel"),
            nav("/trips", "Trips", "map.fill"),
            nav("/trip-planner", "Trip Planner", "point.topleft.down.curvedto.point.bottomright.up"),
            nav("/navigation", "Navigation", "location.north.line.fill"),
            nav("/geofences", "Geofences", "mappin.circle.fill"),
            nav("/mileage", "Mileage Log", "road.lanes"),
            nav("/lifetime-stats", "Lifetime Stats", "rosette"),
            nav("/drive-score", "Drive Score", "trophy.fill"),
            nav("/speed-profile", "Speed Profile", "speedometer"),
            nav("/driving-dynamics", "Driving Dynamics", "gauge.with.dots.needle.67percent"),
            nav("/regen-efficiency", "Regen Braking", "arrow.triangle.2.circlepath"),
            nav("/route-efficiency", "Route Efficiency", "point.3.connected.trianglepath.dotted")
        ]),
        LayoutNavSection(title: "Charging", items: [
            nav("/charging", "Charging Overview", "bolt.car.fill"),
            nav("/tesla-charging-history", "Charge History", "list.bullet.rectangle"),
            nav("/charging-curve", "Charging Curve", "chart.line.uptrend.xyaxis"),
            nav("/charging-heatmap", "Charging Patterns", "calendar"),
            nav("/smart-charge", "Smart Charging", "calendar.badge.clock"),
            nav("/powershare", "Powershare", "bolt.fill")
        ]),
        LayoutNavSection(title: "Battery", items: [
            nav("/battery", "Battery Health", "heart.fill"),
            nav("/battery-cells", "Battery Cells", "battery.100"),
            nav("/battery-degradation", "Battery Degradation", "chart.line.downtrend.xyaxis"),
            nav("/projected-range", "Projected Range", "target"),
            nav("/vampire-drain", "Vampire Drain", "moon.fill"),
            nav("/sleep-efficiency", "Sleep Efficiency", "bed.double.fill")
        ]),
        LayoutNavSection(title: "Energy", items: [
            nav("/energy", "Energy Usage", "bolt.fill"),
            nav("/energy-flow", "Energy Flow", "arrow.left.arrow.right.circle"),
            nav("/power-flow", "Power Flow", "bolt.horizontal.fill"),
            nav("/energy-products", "Solar & Powerwall", "house.fill")
        ]),
        LayoutNavSection(title: "Service", items: [
            nav("/tire-pressure", "Tire Pressure", "gauge.with.dots.needle.0percent"),
            nav("/drivetrain-health", "Drivetrain Health", "cpu.fill"),
            nav("/software-updates", "Software Updates", "arrow.down.circle.fill"),
            nav("/maintenance", "Maintenance", "wrench.and.screwdriver.fill")
        ]),
        LayoutNavSection(title: "Cabin", items: [
            nav("/climate-control", "Climate Control", "thermometer.medium"),
            nav("/media-player", "Media Player", "headphones")
        ]),
        LayoutNavSection(title: "Reports", items: [
            nav("/statistics", "Statistics", "chart.pie.fill"),
            nav("/analytics", "Analytics", "chart.bar.fill"),
            nav("/period-compare", "Period Comparison", "calendar"),
            nav("/efficiency", "Efficiency", "leaf.fill"),
            nav("/temperature-impact", "Temperature Impact", "thermometer.sun.fill"),
            nav("/cost-analysis", "Cost Analysis", "dollarsign.circle.fill"),
            nav("/tco", "Cost of Ownership", "wallet.pass.fill")
        ]),
        LayoutNavSection(title: "Commands", items: [
            nav("/commands", "Send Commands", "gamecontroller.fill"),
            nav("/command-history", "Command History", "clock.arrow.circlepath")
        ]),
        LayoutNavSection(title: "Automation", items: [
            nav("/automations", "Automations", "gearshape.2.fill"),
            nav("/notifications/studio", "Alert Studio", "bell.badge.fill"),
            nav("/notifications/rules", "Alert Rules", "line.3.horizontal.decrease.circle")
        ]),
        LayoutNavSection(title: "Notifications", items: [
            nav("/notifications/inbox", "Notification Inbox", "bell.fill"),
            nav("/notifications/alerts", "Alert Center", "exclamationmark.bubble.fill"),
            nav("/notifications/channels", "Notification Channels", "paperplane.fill"),
            nav("/notifications/webhooks", "Webhooks", "cloud.fill"),
            nav("/notifications/browser", "Browser Notifications", "bell.and.waveform.fill"),
            nav("/notifications/quiet-hours", "Quiet Hours", "moon.zzz.fill")
        ]),
        LayoutNavSection(title: "Security", items: [
            nav("/security-access", "Security & Access", "lock.fill"),
            nav("/safety-settings", "Safety Settings", "checkmark.shield.fill"),
            nav("/guard-mode", "Guard Mode", "exclamationmark.shield.fill")
        ]),
        LayoutNavSection(title: "Account", items: [
            nav("/tesla-account", "Tesla Account", "person.fill"),
            nav("/tesla-orders", "Active Orders", "cart.fill"),
            nav("/fleet-api", "Fleet API", "cloud.fill"),
            nav("/tesla-region", "Region & API", "globe"),
            nav("/tesla-features", "Feature Flags", "flag.fill"),
            nav("/account/2fa", "Two-Factor Auth", "checkmark.shield.fill", auth: true),
            nav("/account/sessions", "Active Sessions", "display", auth: true),
            nav("/account/privacy", "Privacy", "hand.raised.fill"),
            nav("/me/activity", "My Activity", "clock.arrow.circlepath", auth: true)
        ]),
        LayoutNavSection(title: "Settings", items: [
            nav("/settings", "General Settings", "gearshape.fill"),
            nav("/chatbot", "Helix Chat", "bubble.left.and.bubble.right.fill"),
            nav("/dev-tools", "Developer Tools", "hammer.fill")
        ]),
        LayoutNavSection(title: "Integrations", items: [
            nav("/integrations/helix", "Helix", "sparkles"),
            nav("/api-keys", "API Keys", "key.fill"),
            nav("/gas-price", "Gas Prices", "fuelpump.fill")
        ]),
        LayoutNavSection(title: "Data", items: [
            nav("/data-export", "Data Export", "square.and.arrow.down.fill"),
            nav("/backup", "Backup & Restore", "externaldrive.fill.badge.timemachine"),
            nav("/data-repair", "Data Repair", "stethoscope")
        ]),
        LayoutNavSection(title: "Diagnostics", items: [
            nav("/system-status", "System Status", "waveform.path.ecg"),
            nav("/db-health", "Database Health", "internaldrive.fill"),
            nav("/anomaly-detection", "Anomaly Detection", "viewfinder.circle.fill"),
            nav("/signals", "Live Signals", "waveform"),
            nav("/admin/live-signals", "Live Signal Inspector", "antenna.radiowaves.left.and.right"),
            nav("/admin/ingest-xray", "Ingest X-Ray", "viewfinder"),
            nav("/admin/dlq", "DLQ Inspector", "exclamationmark.octagon.fill"),
            nav("/admin/flags", "Feature Flags", "flag.fill"),
            nav("/admin/schema-drift", "Schema Drift", "doc.text.magnifyingglass"),
            nav("/admin/slow-queries", "Slow Queries", "timer"),
            nav("/admin/vehicle-cost", "Vehicle Cost", "wallet.pass.fill"),
            nav("/admin/disk-forecast", "Disk Forecast", "internaldrive"),
            nav("/admin/secret-rotation", "Secret Rotation", "key.horizontal.fill"),
            nav("/admin/audit-log", "Audit Log", "clock.arrow.circlepath"),
            nav("/admin/gdpr-exports", "GDPR Exports", "square.and.arrow.down"),
            nav("/state-debugger", "State Debugger", "ladybug.fill"),
            nav("/mqtt-inspector", "MQTT Inspector", "dot.radiowaves.right"),
            nav("/redis-signals", "Redis Signals", "server.rack"),
            nav("/admin/telemetry/coverage", "Telemetry Coverage", "cloud.fill"),
            nav("/api-logs", "API Logs", "doc.text.fill"),
            nav("/api-playground", "API Playground", "terminal.fill")
        ]),
        LayoutNavSection(title: "About", items: [
            nav("/roadmap", "Roadmap", "signpost.right.fill")
        ])
    ]
}
