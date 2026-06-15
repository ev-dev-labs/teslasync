using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The mutually-exclusive surface state of the <c>RoadmapPage</c> — the native mirror of the data states the web
/// page renders (web/src/features/system/pages/RoadmapPage.tsx). The web page consumes no asynchronous data: it
/// only calls <c>useTranslation</c> + <c>usePageTitle</c> and maps a static, intentionally curated roadmap
/// catalog grouped by release phase, so it has no fetch/loading/error branch to mirror. The manifest declares the
/// <see cref="Success"/> state; the honest native union adds a defensive <see cref="Empty"/> branch (the catalog
/// yielded no entries) so the page renders a friendly empty surface rather than a blank region (ADR-011). The
/// phase progress bar is always visible.
/// </summary>
public enum RoadmapState
{
    /// <summary>The catalog yielded at least one entry — render the progress bar + the per-phase card sections.</summary>
    Success,

    /// <summary>Defensively, the catalog yielded no entries — render the progress bar + a friendly empty surface.</summary>
    Empty,
}

/// <summary>
/// A release phase a roadmap entry belongs to — the native union of the web <c>RoadmapPhase</c>
/// (web/src/types/admin) the page groups its cards by. Declared in render order
/// (<see cref="RoadmapProjection.PhaseOrder"/>): shipped → in-flight → planned → future.
/// </summary>
public enum RoadmapPhase
{
    /// <summary>Shipped and available today (web <c>done</c> → "Completed").</summary>
    Done,

    /// <summary>Actively being built (web <c>current</c> → "In Progress").</summary>
    Current,

    /// <summary>Planned as the next increment (web <c>next</c> → "Up Next").</summary>
    Next,

    /// <summary>On the longer-term horizon (web <c>future</c> → "Future").</summary>
    Future,
}

/// <summary>
/// The accent icon a roadmap entry renders with — the native union of the lucide icons the web page keys each
/// card through (web/src/features/system/pages/RoadmapPage.tsx <c>roadmapItems[].icon</c>). Each maps onto a
/// Segoe Fluent / MDL2 glyph by <see cref="RoadmapProjection.Glyph(RoadmapIcon)"/> — the platform-idiomatic
/// equivalent of the web SVG icon, never a ported web asset.
/// </summary>
public enum RoadmapIcon
{
    /// <summary>A launch spark — web <c>Rocket</c>.</summary>
    Rocket,

    /// <summary>A ringer — web <c>Bell</c>.</summary>
    Bell,

    /// <summary>An idea lightbulb — web <c>Brain</c>.</summary>
    Brain,

    /// <summary>A streaming bolt — web <c>Zap</c>.</summary>
    Zap,

    /// <summary>A star — web <c>Star</c>.</summary>
    Star,

    /// <summary>An energy plug — web <c>Plug</c>.</summary>
    Plug,

    /// <summary>A cloud — web <c>Cloud</c>.</summary>
    Cloud,

    /// <summary>A phone — web <c>Smartphone</c>.</summary>
    Smartphone,

    /// <summary>A bar chart — web <c>BarChart3</c>.</summary>
    BarChart,

    /// <summary>A compass — web <c>Map</c>.</summary>
    Map,

    /// <summary>A shield — web <c>Shield</c>.</summary>
    Shield,

    /// <summary>An eco globe — web <c>Leaf</c>.</summary>
    Leaf,

    /// <summary>People — web <c>Users</c>.</summary>
    Users,

    /// <summary>A wrench — web <c>Wrench</c>.</summary>
    Wrench,

    /// <summary>A globe — web <c>Globe</c>.</summary>
    Globe,
}

/// <summary>
/// One curated catalog entry backing the page — the native analogue of a single record in the web
/// <c>roadmapItems</c> array (web/src/features/system/pages/RoadmapPage.tsx). It keeps the entry's
/// <see cref="Title"/>, one-line <see cref="Description"/>, accent <see cref="Icon"/>, release
/// <see cref="Phase"/> and its <see cref="Features"/> bullet list. Pure content data — exactly as the web page
/// hardcodes it (the web does not route these literals through i18n) — so the projection is unit-tested without a
/// UI host.
/// </summary>
/// <param name="Title">The card heading (web <c>item.title</c>).</param>
/// <param name="Description">The one-line summary under the heading (web <c>item.description</c>).</param>
/// <param name="Icon">The accent icon the card renders with (web <c>item.icon</c>).</param>
/// <param name="Phase">The release phase the entry is grouped under (web <c>item.phase</c>).</param>
/// <param name="Features">The capability bullet list (web <c>item.features</c>).</param>
public sealed record RoadmapEntry(
    string Title,
    string Description,
    RoadmapIcon Icon,
    RoadmapPhase Phase,
    IReadOnlyList<string> Features);

/// <summary>
/// The static, curated roadmap catalog — a verbatim port of the web <c>roadmapItems</c> array
/// (web/src/features/system/pages/RoadmapPage.tsx). Five shipped phases, one in-flight, two planned and nine
/// future entries, in the same order the web page declares them.
/// </summary>
public static class RoadmapCatalog
{
    /// <summary>The default curated catalog (17 entries, web order).</summary>
    public static IReadOnlyList<RoadmapEntry> Default { get; } =
    [
        new(
            "Core Platform",
            "Real-time fleet monitoring, analytics, and vehicle control",
            RoadmapIcon.Rocket,
            RoadmapPhase.Done,
            [
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
                "CSV and JSON data export",
            ]),
        new(
            "Smart Notifications",
            "Multi-channel alerts, scheduling, and custom automation rules",
            RoadmapIcon.Bell,
            RoadmapPhase.Done,
            [
                "Discord, Slack, and Telegram integrations",
                "Webhook, ntfy, and Pushover channels",
                "Custom alert rules (battery, speed, charge, geofence, sentry)",
                "Battery level thresholds with configurable triggers",
                "Geofence enter/exit notifications",
                "Charging completion alerts",
                "Notification history, analytics, and metrics",
                "Scheduled & recurring notifications",
                "Per-channel notification preferences",
            ]),
        new(
            "Intelligence & Observability",
            "Advanced analytics, system health, and background processing",
            RoadmapIcon.Brain,
            RoadmapPhase.Done,
            [
                "Fleet analytics with deep drive/charging/battery insights",
                "System status and component health dashboard",
                "Natural language chatbot for vehicle queries",
                "Async export worker (MQTT-backed background jobs)",
                "Audit trail logging",
                "API key management with HMAC authentication",
                "25+ developer tools (VIN decoder, JWT decoder, API diagnostics)",
                "Parallel CI/CD Docker builds",
            ]),
        new(
            "Fleet Telemetry",
            "Real-time streaming from vehicles via Tesla Fleet Telemetry",
            RoadmapIcon.Zap,
            RoadmapPhase.Done,
            [
                "Full signal ingestion (50+ signals — driving, charging, climate, TPMS)",
                "Hybrid poll/stream mode (auto-reduces polling when streaming)",
                "Drive & charge session detection from streaming data",
                "Alert evaluation from streaming signals",
                "SSE broadcast of streamed telemetry to frontend",
                "Per-vehicle streaming health monitoring",
                "Bundled or external Fleet Telemetry server support",
            ]),
        new(
            "Premium UI & Design System",
            "Shared component library, accessibility, and consistent design language",
            RoadmapIcon.Star,
            RoadmapPhase.Done,
            [
                "17-component shared library (Button, Input, Select, Modal, DataTable, etc.)",
                "WCAG AA accessibility — focus traps, keyboard nav, ARIA labels, contrast",
                "Light and dark mode with 5 neon color themes",
                "Glassmorphism design tokens and cn() utility",
                "Error and loading states across all 77 pages",
                "Global decimal precision control (0–20)",
                "SVG car visualization per Tesla model",
                "Page title hooks for screen readers",
            ]),
        new(
            "External Integrations",
            "Connect with calendars, weather, and smart home systems",
            RoadmapIcon.Plug,
            RoadmapPhase.Current,
            [
                "Home Assistant MQTT auto-discovery",
                "Calendar integration for trip planning",
                "Weather-adjusted range predictions",
                "IFTTT and Zapier webhooks",
                "Electricity rate API for cost optimization",
                "Fleet Telemetry deployment wizard",
            ]),
        new(
            "Enhanced Visualization",
            "Interactive replays, custom dashboards, and advanced maps",
            RoadmapIcon.Star,
            RoadmapPhase.Next,
            [
                "Interactive trip replay with elevation profile",
                "Charging station map overlay",
                "Fleet heatmap showing high-traffic corridors",
                "Custom dashboard builder (drag-and-drop widgets)",
                "Signal-level real-time graphs for Fleet Telemetry",
                "Streaming vs polling cost comparison dashboard",
            ]),
        new(
            "Helix & Predictive Analytics",
            "Machine learning models for predictive insights",
            RoadmapIcon.Brain,
            RoadmapPhase.Next,
            [
                "Predictive battery degradation modeling",
                "Optimal charging schedule recommendations",
                "Driving pattern analysis and coaching",
                "Anomaly detection for vehicle health",
                "Energy cost forecasting",
                "Range prediction based on weather + route + driving style",
            ]),
        new(
            "Enterprise & Scale",
            "Multi-tenant support, advanced security, and horizontal scaling",
            RoadmapIcon.Cloud,
            RoadmapPhase.Future,
            [
                "Multi-tenant fleet management",
                "Role-based access control (RBAC)",
                "SSO / SAML authentication",
                "Horizontal scaling with load balancing",
                "Compliance reporting (SOC 2, GDPR)",
                "White-label customization",
                "API rate limiting per tenant",
                "Audit log export and retention policies",
            ]),
        new(
            "Mobile App",
            "Native mobile experience for iOS and Android",
            RoadmapIcon.Smartphone,
            RoadmapPhase.Future,
            [
                "Native iOS and Android apps (React Native)",
                "Widgets for battery level and charging status",
                "Background push notifications",
                "Apple Watch / Wear OS companion",
                "Offline mode with local data caching",
                "Biometric authentication (Face ID / fingerprint)",
                "Quick actions — lock, unlock, climate from home screen",
            ]),
        new(
            "Advanced Fleet Intelligence",
            "Fleet-wide insights, benchmarking, and operational optimization",
            RoadmapIcon.BarChart,
            RoadmapPhase.Future,
            [
                "Fleet-wide efficiency leaderboard and benchmarks",
                "Total cost of ownership (TCO) calculator per vehicle",
                "Maintenance prediction and service scheduling",
                "Driver behavior scoring with gamification",
                "Fleet utilization reports and idle vehicle detection",
                "Carbon offset tracking and sustainability reports",
                "Automated monthly/quarterly fleet digest emails",
            ]),
        new(
            "Smart Routing & Navigation",
            "Intelligent trip planning with charging stops and real-time conditions",
            RoadmapIcon.Map,
            RoadmapPhase.Future,
            [
                "Multi-stop trip planner with optimal charging stops",
                "Real-time Supercharger availability and queue times",
                "Elevation-aware range estimation",
                "Weather and traffic impact on range calculation",
                "Charging cost comparison across networks (Tesla, ChargePoint, etc.)",
                "Shareable trip plans with ETA and charging schedule",
                "Historical route efficiency analysis",
            ]),
        new(
            "Security & Privacy",
            "Advanced security features and privacy controls",
            RoadmapIcon.Shield,
            RoadmapPhase.Future,
            [
                "End-to-end encryption for all vehicle data",
                "Geo-restricted access zones (block commands outside regions)",
                "Valet mode monitoring with speed/area alerts",
                "Theft detection with instant notifications and GPS tracking",
                "Data anonymization for shared fleet analytics",
                "Configurable data retention and auto-purge policies",
                "Two-factor authentication for critical commands",
            ]),
        new(
            "Smart Home & EV Ecosystem",
            "Deep integration with home energy, solar, and smart devices",
            RoadmapIcon.Leaf,
            RoadmapPhase.Future,
            [
                "Tesla Powerwall and Solar Roof integration",
                "Smart charging — charge when solar production is high",
                "Time-of-use electricity rate optimization",
                "Vehicle-to-home (V2H) energy flow monitoring",
                "Smart home scene triggers (arrive home → lights on, garage open)",
                "Amazon Alexa and Google Home voice commands",
                "Apple HomeKit and Matter protocol support",
            ]),
        new(
            "Community & Social",
            "Connect with other Tesla owners, share data, and compete",
            RoadmapIcon.Users,
            RoadmapPhase.Future,
            [
                "Public efficiency leaderboards (opt-in)",
                "Road trip sharing with photos and stats",
                "Community charging station reviews and ratings",
                "Fleet comparison — how does your car stack up?",
                "Achievement badges (100k miles, 1000 charges, etc.)",
                "Community-contributed alert rules marketplace",
                "Regional Tesla meetup and event discovery",
            ]),
        new(
            "Developer Platform",
            "Open APIs, plugins, and extensibility for power users",
            RoadmapIcon.Wrench,
            RoadmapPhase.Future,
            [
                "Public REST API with OAuth 2.0",
                "GraphQL API for flexible data queries",
                "Plugin system for custom dashboard widgets",
                "Custom automation scripting (JavaScript/Python)",
                "Webhook builder with visual flow editor",
                "Community plugin marketplace",
                "CLI tool for headless fleet management",
            ]),
        new(
            "Global & Multi-Brand",
            "Expand beyond Tesla to support all electric vehicles",
            RoadmapIcon.Globe,
            RoadmapPhase.Future,
            [
                "Rivian, Polestar, and BMW i integration",
                "Ford Mustang Mach-E and F-150 Lightning support",
                "Hyundai/Kia EV platform support",
                "Multi-language localization (20+ languages)",
                "Region-specific charging network integrations",
                "Universal OBD-II dongle support for any EV",
                "Cross-brand fleet management for mixed fleets",
            ]),
    ];
}

/// <summary>
/// The pure input to the projection — the curated catalog the page renders from. Mirrors the static
/// <c>roadmapItems</c> the web component closes over; carries no UI state.
/// </summary>
/// <param name="Entries">The curated roadmap entries (defaults to <see cref="RoadmapCatalog.Default"/>).</param>
public sealed record RoadmapModel(IReadOnlyList<RoadmapEntry> Entries)
{
    /// <summary>Creates a model over the default curated catalog.</summary>
    public RoadmapModel()
        : this(RoadmapCatalog.Default)
    {
    }
}

/// <summary>
/// One projected capability row inside a roadmap card — the native analogue of a single
/// <c>item.features.map(...)</c> list item (web/src/features/system/pages/RoadmapPage.tsx). Carries the localized
/// <see cref="Text"/> and the phase-derived leading <see cref="BulletGlyph"/> (web: done → CheckCircle,
/// current → Zap, otherwise Clock).
/// </summary>
/// <param name="Text">The feature copy.</param>
/// <param name="BulletGlyph">The leading Segoe Fluent glyph keyed by the entry's phase.</param>
public sealed record RoadmapFeature(string Text, string BulletGlyph);

/// <summary>
/// A projected, render-ready roadmap card — the native analogue of one web <c>RoadmapCard</c>
/// (web/src/features/system/pages/RoadmapPage.tsx). Everything the view needs is resolved here so the view stays
/// a thin renderer: the accent <see cref="Glyph"/>, the themed <see cref="AccentBrushKey"/> (no ad-hoc hex), the
/// <see cref="BadgeStatus"/> + localized <see cref="PhaseLabel"/> chip, the <see cref="Features"/> rows and the
/// composed Narrator <see cref="AutomationName"/>.
/// </summary>
/// <param name="Title">The card heading.</param>
/// <param name="Description">The one-line summary.</param>
/// <param name="Phase">The release phase the card belongs to.</param>
/// <param name="Glyph">The accent icon glyph (web <c>item.icon</c>).</param>
/// <param name="AccentBrushKey">The themed design-token brush key for the accent (icon tile + ring).</param>
/// <param name="BadgeStatus">The semantic status the phase chip is tinted by (web <c>phaseConfig.variant</c>).</param>
/// <param name="PhaseLabel">The localized phase label shown in the chip (web <c>roadmap.phase.*</c>).</param>
/// <param name="Features">The capability bullet rows.</param>
/// <param name="AutomationName">The composed Narrator name (title + description).</param>
public sealed record RoadmapItem(
    string Title,
    string Description,
    RoadmapPhase Phase,
    string Glyph,
    string AccentBrushKey,
    StatusKind BadgeStatus,
    string PhaseLabel,
    IReadOnlyList<RoadmapFeature> Features,
    string AutomationName);

/// <summary>
/// One entry in the always-visible phase progress bar (web <c>GlassPanel</c> phase legend). Carries the localized
/// <see cref="Label"/>, the themed <see cref="AccentBrushKey"/> dot/text colour, the semantic
/// <see cref="BadgeStatus"/> and the <see cref="Count"/> of entries in that phase.
/// </summary>
/// <param name="Phase">The phase this summary describes.</param>
/// <param name="Label">The localized phase label.</param>
/// <param name="AccentBrushKey">The themed design-token brush key for the dot + label.</param>
/// <param name="BadgeStatus">The semantic status the count chip is tinted by.</param>
/// <param name="Count">The number of catalog entries in this phase.</param>
public sealed record RoadmapPhaseSummary(
    RoadmapPhase Phase,
    string Label,
    string AccentBrushKey,
    StatusKind BadgeStatus,
    int Count);

/// <summary>
/// A projected phase section — the native analogue of one iteration of the web
/// <c>phases.map(...)</c> that renders a phase heading plus its grid of cards. Empty phases are omitted (web
/// returns <c>null</c> for them).
/// </summary>
/// <param name="Phase">The phase this section renders.</param>
/// <param name="Label">The localized phase heading.</param>
/// <param name="AccentBrushKey">The themed design-token brush key for the heading.</param>
/// <param name="HeaderGlyph">The phase heading glyph (web <c>PHASE_ICONS[phase]</c>).</param>
/// <param name="Items">The cards in this phase (web order).</param>
public sealed record RoadmapPhaseGroup(
    RoadmapPhase Phase,
    string Label,
    string AccentBrushKey,
    string HeaderGlyph,
    IReadOnlyList<RoadmapItem> Items);

/// <summary>
/// The projected, render-ready content the <c>RoadmapPage</c> view binds to — the native analogue of the web
/// component's computed render tree (web/src/features/system/pages/RoadmapPage.tsx). Carries the localized
/// <see cref="Title"/> / <see cref="DocumentTitle"/> / <see cref="Subtitle"/>, the derived
/// <see cref="State"/>, the always-visible <see cref="PhaseSummaries"/> (all four phases) and the non-empty
/// phase <see cref="Groups"/>.
/// </summary>
/// <param name="Title">The localized page title (web <c>roadmap.title</c>).</param>
/// <param name="DocumentTitle">The localized window/document title (web <c>usePageTitle</c>).</param>
/// <param name="Subtitle">The localized page subtitle (web <c>roadmap.subtitle</c>).</param>
/// <param name="State">The derived surface state (success / defensive empty).</param>
/// <param name="PhaseSummaries">The four phase legend entries (always present).</param>
/// <param name="Groups">The non-empty phase sections, in render order.</param>
public sealed record RoadmapDisplay(
    string Title,
    string DocumentTitle,
    string Subtitle,
    RoadmapState State,
    IReadOnlyList<RoadmapPhaseSummary> PhaseSummaries,
    IReadOnlyList<RoadmapPhaseGroup> Groups);

/// <summary>
/// The Microsoft.UI-free projection turning a <see cref="RoadmapModel"/> + an <see cref="ILocalizer"/> into a
/// render-ready <see cref="RoadmapDisplay"/> — the single place every branch, label, accent-token and glyph
/// decision lives, so the WinUI view is a thin renderer and the whole mapping is unit-tested headlessly. Mirrors
/// the web component's render logic (web/src/features/system/pages/RoadmapPage.tsx) exactly: same phase order,
/// same phase labels/variants, same per-phase grouping and the same per-feature bullet keying.
/// </summary>
public static class RoadmapProjection
{
    /// <summary>The phases in the order the web page renders them (shipped → in-flight → planned → future).</summary>
    public static IReadOnlyList<RoadmapPhase> PhaseOrder { get; } =
    [
        RoadmapPhase.Done,
        RoadmapPhase.Current,
        RoadmapPhase.Next,
        RoadmapPhase.Future,
    ];

    /// <summary>The localized page title (web <c>roadmap.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(RoadmapRegistration.TitleKey, "Roadmap");
    }

    /// <summary>The localized page subtitle (web <c>roadmap.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            RoadmapRegistration.SubtitleKey,
            "What's been built, what's in progress, and what's coming next");
    }

    /// <summary>
    /// Project the catalog into the render-ready display. Groups the entries by phase in <see cref="PhaseOrder"/>,
    /// resolves every label through the localizer, and derives the success / defensive-empty
    /// <see cref="RoadmapState"/>.
    /// </summary>
    public static RoadmapDisplay Project(RoadmapModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var title = Title(localizer);
        var subtitle = Subtitle(localizer);
        var entries = model.Entries ?? [];

        var summaries = new List<RoadmapPhaseSummary>(PhaseOrder.Count);
        var groups = new List<RoadmapPhaseGroup>(PhaseOrder.Count);

        foreach (var phase in PhaseOrder)
        {
            var label = PhaseLabel(phase, localizer);
            var accentKey = AccentBrushKey(phase);
            var badge = BadgeStatus(phase);

            var phaseEntries = new List<RoadmapEntry>();
            foreach (var entry in entries)
            {
                if (entry.Phase == phase)
                {
                    phaseEntries.Add(entry);
                }
            }

            summaries.Add(new RoadmapPhaseSummary(phase, label, accentKey, badge, phaseEntries.Count));

            if (phaseEntries.Count == 0)
            {
                continue;
            }

            var items = new List<RoadmapItem>(phaseEntries.Count);
            foreach (var entry in phaseEntries)
            {
                items.Add(ProjectItem(entry, label, accentKey, badge));
            }

            groups.Add(new RoadmapPhaseGroup(phase, label, accentKey, PhaseHeaderGlyph(phase), items));
        }

        var state = entries.Count > 0 ? RoadmapState.Success : RoadmapState.Empty;
        return new RoadmapDisplay(title, title, subtitle, state, summaries, groups);
    }

    /// <summary>The localized label for a phase (web <c>roadmap.phase.*</c> with the web English fallback).</summary>
    public static string PhaseLabel(RoadmapPhase phase, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(PhaseLabelKey(phase), PhaseFallback(phase));
    }

    /// <summary>The i18n key for a phase label (web <c>roadmap.phase.${phase}</c>).</summary>
    public static string PhaseLabelKey(RoadmapPhase phase) => $"roadmap.phase.{PhaseSlug(phase)}";

    /// <summary>The stable lowercase slug for a phase (web <c>RoadmapPhase</c> string value).</summary>
    public static string PhaseSlug(RoadmapPhase phase) => phase switch
    {
        RoadmapPhase.Done => "done",
        RoadmapPhase.Current => "current",
        RoadmapPhase.Next => "next",
        _ => "future",
    };

    /// <summary>The themed design-token brush key for a phase accent — matches the web per-phase colour.</summary>
    public static string AccentBrushKey(RoadmapPhase phase) => phase switch
    {
        // done #10B981, current #00F0FF, next #A855F7, future #F59E0B (web phaseConfig.color), resolved to the
        // generated W1 tokens so light/dark/high-contrast flow from the design system, never an ad-hoc hex.
        RoadmapPhase.Done => "TsChartBatteryBrush",
        RoadmapPhase.Current => "TsColorInfoBrush",
        RoadmapPhase.Next => "TsChartPowerBrush",
        _ => "TsChartEnergyBrush",
    };

    /// <summary>The semantic status a phase chip is tinted by (web <c>phaseConfig.variant</c>).</summary>
    public static StatusKind BadgeStatus(RoadmapPhase phase) => phase switch
    {
        RoadmapPhase.Done => StatusKind.Success,
        RoadmapPhase.Current => StatusKind.Info,
        RoadmapPhase.Next => StatusKind.Warning,
        _ => StatusKind.Danger,
    };

    /// <summary>The phase heading glyph (web <c>PHASE_ICONS[phase]</c>: CheckCircle / Zap / Star / Rocket).</summary>
    public static string PhaseHeaderGlyph(RoadmapPhase phase) => phase switch
    {
        RoadmapPhase.Done => "\uE930",     // Completed — web CheckCircle
        RoadmapPhase.Current => "\uE945",  // LightningBolt — web Zap
        RoadmapPhase.Next => "\uE734",     // FavoriteStar — web Star
        _ => "\uE8A7",                     // Forward — web Rocket (the Roadmap route glyph)
    };

    /// <summary>
    /// The leading bullet glyph for a feature row, keyed by phase (web: done → CheckCircle, current → Zap,
    /// otherwise Clock).
    /// </summary>
    public static string BulletGlyph(RoadmapPhase phase) => phase switch
    {
        RoadmapPhase.Done => "\uE930",     // Completed — web CheckCircle
        RoadmapPhase.Current => "\uE945",  // LightningBolt — web Zap
        _ => "\uE823",                     // Recent (clock) — web Clock
    };

    /// <summary>The Segoe Fluent glyph an accent <see cref="RoadmapIcon"/> renders as.</summary>
    public static string Glyph(RoadmapIcon icon) => icon switch
    {
        RoadmapIcon.Rocket => "\uE945",      // LightningBolt (launch)
        RoadmapIcon.Bell => "\uEA8F",        // Ringer
        RoadmapIcon.Brain => "\uEA80",       // Lightbulb (idea)
        RoadmapIcon.Zap => "\uE704",         // Streaming
        RoadmapIcon.Star => "\uE734",        // FavoriteStar
        RoadmapIcon.Plug => "\uE945",        // LightningBolt (power)
        RoadmapIcon.Cloud => "\uE753",       // Cloud
        RoadmapIcon.Smartphone => "\uE8EA",  // CellPhone
        RoadmapIcon.BarChart => "\uE9D9",    // BarChart
        RoadmapIcon.Map => "\uE81E",         // Compass
        RoadmapIcon.Shield => "\uEA18",      // Shield
        RoadmapIcon.Leaf => "\uE909",        // World (eco; no native leaf glyph)
        RoadmapIcon.Users => "\uE716",       // People
        RoadmapIcon.Wrench => "\uE90F",      // Repair
        _ => "\uE774",                       // Globe
    };

    private static RoadmapItem ProjectItem(RoadmapEntry entry, string phaseLabel, string accentKey, StatusKind badge)
    {
        var bullet = BulletGlyph(entry.Phase);
        var sourceFeatures = entry.Features ?? [];
        var features = new List<RoadmapFeature>(sourceFeatures.Count);
        foreach (var feature in sourceFeatures)
        {
            features.Add(new RoadmapFeature(feature, bullet));
        }

        var automationName = $"{entry.Title}. {entry.Description}";
        return new RoadmapItem(
            entry.Title,
            entry.Description,
            entry.Phase,
            Glyph(entry.Icon),
            accentKey,
            badge,
            phaseLabel,
            features,
            automationName);
    }

    private static string PhaseFallback(RoadmapPhase phase) => phase switch
    {
        RoadmapPhase.Done => "Completed",
        RoadmapPhase.Current => "In Progress",
        RoadmapPhase.Next => "Up Next",
        _ => "Future",
    };
}

/// <summary>
/// Canonical metadata for the <c>RoadmapPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/system/pages/RoadmapPage.tsx</c> (web route <c>/roadmap</c>). The Windows shell registers
/// it under the <see cref="RouteName"/> (RouteTable path <c>roadmap</c>, RouteGroup.SystemOps) — a visible nav
/// destination, matching the web's routed status. The page title + subtitle keys resolve here so the registration
/// and the projection share one key.
/// </summary>
public static class RoadmapRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "RoadmapPage";

    /// <summary>The navigation route name this page registers under (RouteTable <c>Roadmap</c>, path <c>roadmap</c>).</summary>
    public const string RouteName = "Roadmap";

    /// <summary>The i18n key for the page title (web <c>roadmap.title</c>).</summary>
    public const string TitleKey = "roadmap.title";

    /// <summary>The i18n key for the page subtitle (web <c>roadmap.subtitle</c>).</summary>
    public const string SubtitleKey = "roadmap.subtitle";

    /// <summary>The i18n key for the defensive empty-state message (no roadmap entries available).</summary>
    public const string EmptyKey = "roadmap.empty";

    /// <summary>The localized page title (web <c>roadmap.title</c>).</summary>
    public static string Title(ILocalizer localizer) => RoadmapProjection.Title(localizer);

    /// <summary>
    /// The localized friendly empty-state message — defensive only (the curated catalog is static and non-empty,
    /// so the empty surface is never normally shown). Routed through the localizer so it is never a hardcoded
    /// literal, mirroring the sibling feature-view pages.
    /// </summary>
    public static string EmptyMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(EmptyKey, "No roadmap entries available");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>RoadmapPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a label or route — so a diagnostics line
/// can never leak anything user-specific. Thread-safe.
/// </summary>
public sealed class RoadmapDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public RoadmapDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=RoadmapPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={RoadmapRegistration.Slug}");
    }
}
