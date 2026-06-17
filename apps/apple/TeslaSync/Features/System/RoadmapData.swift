//
//  RoadmapData.swift
//  TeslaSync — P4 feature data · P7 · RoadmapPage (Apple)
//
//  Roadmap data model for TeslaSync features across phases.
//

import Foundation

public enum RoadmapPhase: String, CaseIterable {
    case done
    case current
    case next
    case future

    var label: String {
        switch self {
        case .done: return String(localized: "Completed")
        case .current: return String(localized: "In Progress")
        case .next: return String(localized: "Up Next")
        case .future: return String(localized: "Future")
        }
    }

    var color: String {
        switch self {
        case .done: return "green"
        case .current: return "cyan"
        case .next: return "purple"
        case .future: return "orange"
        }
    }

    var icon: String {
        switch self {
        case .done: return "checkmark.circle.fill"
        case .current: return "bolt.fill"
        case .next: return "star.fill"
        case .future: return "rocket.fill"
        }
    }

    var featureIcon: String {
        switch self {
        case .done: return "checkmark.circle"
        case .current: return "bolt"
        case .next, .future: return "clock"
        }
    }
}

public struct RoadmapEntry: Identifiable {
    public let id = UUID()
    let title: String
    let description: String
    let icon: String
    let phase: RoadmapPhase
    let features: [String]
}

// swiftlint:disable type_body_length
enum RoadmapDataSource {
    static let allItems: [RoadmapEntry] = [
        RoadmapEntry(
            title: "Core Platform",
            description: "Real-time fleet monitoring, analytics, and vehicle control",
            icon: "rocket.fill",
            phase: .done,
            features: [
                "Real-time vehicle state tracking via SSE",
                "Live GPS map with animated markers",
                "Remote vehicle commands (14 commands)",
                "Drive and charging session recording",
                "Energy analytics and efficiency scoring",
                "Battery health monitoring and degradation tracking",
                "PWA support — installable on any device",
                "Command palette (Cmd+K) navigation",
                "Grafana dashboards (16 pre-built)",
                "MQTT telemetry publishing",
                "CSV and JSON data export"
            ]
        ),
        RoadmapEntry(
            title: "Smart Notifications",
            description: "Multi-channel alerts, scheduling, and custom automation rules",
            icon: "bell.fill",
            phase: .done,
            features: [
                "Discord, Slack, and Telegram integrations",
                "Webhook, ntfy, and Pushover channels",
                "Custom alert rules (battery, speed, charge, geofence, sentry)",
                "Battery level thresholds with configurable triggers",
                "Geofence enter/exit notifications",
                "Charging completion alerts",
                "Notification history, analytics, and metrics",
                "Scheduled & recurring notifications",
                "Per-channel notification preferences"
            ]
        ),
        RoadmapEntry(
            title: "Intelligence & Observability",
            description: "Advanced analytics, system health, and background processing",
            icon: "brain",
            phase: .done,
            features: [
                "Fleet analytics with deep drive/charging/battery insights",
                "System status and component health dashboard",
                "Natural language chatbot for vehicle queries",
                "Async export worker (MQTT-backed background jobs)",
                "Audit trail logging",
                "API key management with HMAC authentication",
                "25+ developer tools (VIN decoder, JWT decoder, API diagnostics)",
                "Parallel CI/CD Docker builds"
            ]
        ),
        RoadmapEntry(
            title: "Fleet Telemetry",
            description: "Real-time streaming from vehicles via Tesla Fleet Telemetry",
            icon: "bolt.fill",
            phase: .done,
            features: [
                "Full signal ingestion (50+ signals — driving, charging, climate, TPMS)",
                "Hybrid poll/stream mode (auto-reduces polling when streaming)",
                "Drive & charge session detection from streaming data",
                "Alert evaluation from streaming signals",
                "SSE broadcast of streamed telemetry to frontend",
                "Per-vehicle streaming health monitoring",
                "Bundled or external Fleet Telemetry server support"
            ]
        ),
        RoadmapEntry(
            title: "Premium UI & Design System",
            description: "Shared component library, accessibility, and consistent design language",
            icon: "star.fill",
            phase: .done,
            features: [
                "17-component shared library (Button, Input, Select, Modal, DataTable, etc.)",
                "WCAG AA accessibility — focus traps, keyboard nav, ARIA labels, contrast",
                "Light and dark mode with 5 neon color themes",
                "Glassmorphism design tokens and cn() utility",
                "Error and loading states across all 77 pages",
                "Global decimal precision control (0–20)",
                "SVG car visualization per Tesla model",
                "Page title hooks for screen readers"
            ]
        ),
        RoadmapEntry(
            title: "External Integrations",
            description: "Connect with calendars, weather, and smart home systems",
            icon: "link.circle.fill",
            phase: .current,
            features: [
                "Home Assistant MQTT auto-discovery",
                "Calendar integration for trip planning",
                "Weather-adjusted range predictions",
                "IFTTT and Zapier webhooks",
                "Electricity rate API for cost optimization",
                "Fleet Telemetry deployment wizard"
            ]
        ),
        RoadmapEntry(
            title: "Enhanced Visualization",
            description: "Interactive replays, custom dashboards, and advanced maps",
            icon: "star.fill",
            phase: .next,
            features: [
                "Interactive trip replay with elevation profile",
                "Charging station map overlay",
                "Fleet heatmap showing high-traffic corridors",
                "Custom dashboard builder (drag-and-drop widgets)",
                "Signal-level real-time graphs for Fleet Telemetry",
                "Streaming vs polling cost comparison dashboard"
            ]
        ),
        RoadmapEntry(
            title: "Helix & Predictive Analytics",
            description: "Machine learning models for predictive insights",
            icon: "brain",
            phase: .next,
            features: [
                "Predictive battery degradation modeling",
                "Optimal charging schedule recommendations",
                "Driving pattern analysis and coaching",
                "Anomaly detection for vehicle health",
                "Energy cost forecasting",
                "Range prediction based on weather + route + driving style"
            ]
        ),
        RoadmapEntry(
            title: "Enterprise & Scale",
            description: "Multi-tenant support, advanced security, and horizontal scaling",
            icon: "cloud.fill",
            phase: .future,
            features: [
                "Multi-tenant fleet management",
                "Role-based access control (RBAC)",
                "SSO / SAML authentication",
                "Horizontal scaling with load balancing",
                "Compliance reporting (SOC 2, GDPR)",
                "White-label customization",
                "API rate limiting per tenant",
                "Audit log export and retention policies"
            ]
        ),
        RoadmapEntry(
            title: "Mobile App",
            description: "Native mobile experience for iOS and Android",
            icon: "iphone",
            phase: .future,
            features: [
                "Native iOS and Android apps (React Native)",
                "Widgets for battery level and charging status",
                "Background push notifications",
                "Apple Watch / Wear OS companion",
                "Offline mode with local data caching",
                "Biometric authentication (Face ID / fingerprint)",
                "Quick actions — lock, unlock, climate from home screen"
            ]
        ),
        RoadmapEntry(
            title: "Advanced Fleet Intelligence",
            description: "Fleet-wide insights, benchmarking, and operational optimization",
            icon: "chart.bar.fill",
            phase: .future,
            features: [
                "Fleet-wide efficiency leaderboard and benchmarks",
                "Total cost of ownership (TCO) calculator per vehicle",
                "Maintenance prediction and service scheduling",
                "Driver behavior scoring with gamification",
                "Fleet utilization reports and idle vehicle detection",
                "Carbon offset tracking and sustainability reports",
                "Automated monthly/quarterly fleet digest emails"
            ]
        ),
        RoadmapEntry(
            title: "Smart Routing & Navigation",
            description: "Intelligent trip planning with charging stops and real-time conditions",
            icon: "map.fill",
            phase: .future,
            features: [
                "Multi-stop trip planner with optimal charging stops",
                "Real-time Supercharger availability and queue times",
                "Elevation-aware range estimation",
                "Weather and traffic impact on range calculation",
                "Charging cost comparison across networks (Tesla, ChargePoint, etc.)",
                "Shareable trip plans with ETA and charging schedule",
                "Historical route efficiency analysis"
            ]
        ),
        RoadmapEntry(
            title: "Security & Privacy",
            description: "Advanced security features and privacy controls",
            icon: "shield.fill",
            phase: .future,
            features: [
                "End-to-end encryption for all vehicle data",
                "Geo-restricted access zones (block commands outside regions)",
                "Valet mode monitoring with speed/area alerts",
                "Theft detection with instant notifications and GPS tracking",
                "Data anonymization for shared fleet analytics",
                "Configurable data retention and auto-purge policies",
                "Two-factor authentication for critical commands"
            ]
        ),
        RoadmapEntry(
            title: "Smart Home & EV Ecosystem",
            description: "Deep integration with home energy, solar, and smart devices",
            icon: "leaf.fill",
            phase: .future,
            features: [
                "Tesla Powerwall and Solar Roof integration",
                "Smart charging — charge when solar production is high",
                "Time-of-use electricity rate optimization",
                "Vehicle-to-home (V2H) energy flow monitoring",
                "Smart home scene triggers (arrive home → lights on, garage open)",
                "Amazon Alexa and Google Home voice commands",
                "Apple HomeKit and Matter protocol support"
            ]
        ),
        RoadmapEntry(
            title: "Community & Social",
            description: "Connect with other Tesla owners, share data, and compete",
            icon: "person.3.fill",
            phase: .future,
            features: [
                "Public efficiency leaderboards (opt-in)",
                "Road trip sharing with photos and stats",
                "Community charging station reviews and ratings",
                "Fleet comparison — how does your car stack up?",
                "Achievement badges (100k miles, 1000 charges, etc.)",
                "Community-contributed alert rules marketplace",
                "Regional Tesla meetup and event discovery"
            ]
        ),
        RoadmapEntry(
            title: "Developer Platform",
            description: "Open APIs, plugins, and extensibility for power users",
            icon: "wrench.and.screwdriver.fill",
            phase: .future,
            features: [
                "Public REST API with OAuth 2.0",
                "GraphQL API for flexible data queries",
                "Plugin system for custom dashboard widgets",
                "Custom automation scripting (JavaScript/Python)",
                "Webhook builder with visual flow editor",
                "Community plugin marketplace",
                "CLI tool for headless fleet management"
            ]
        ),
        RoadmapEntry(
            title: "Global & Multi-Brand",
            description: "Expand beyond Tesla to support all electric vehicles",
            icon: "globe",
            phase: .future,
            features: [
                "Rivian, Polestar, and BMW i integration",
                "Ford Mustang Mach-E and F-150 Lightning support",
                "Hyundai/Kia EV platform support",
                "Multi-language localization (20+ languages)",
                "Region-specific charging network integrations",
                "Universal OBD-II dongle support for any EV",
                "Cross-brand fleet management for mixed fleets"
            ]
        )
    ]
}
// swiftlint:enable type_body_length
