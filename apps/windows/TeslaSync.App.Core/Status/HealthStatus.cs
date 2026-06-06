namespace TeslaSync.App.Core.Status;

/// <summary>
/// Overall health state for the status surfaces (port of the web <c>HeroStatus</c>
/// union shared by StatusHero / HealthRow / UptimeHeatmap / StickyCompactHero).
/// </summary>
public enum HealthStatus
{
    /// <summary>All systems operational.</summary>
    Healthy,

    /// <summary>Degraded performance.</summary>
    Degraded,

    /// <summary>Service outage.</summary>
    Unhealthy,

    /// <summary>Status not known.</summary>
    Unknown,

    /// <summary>Scheduled maintenance.</summary>
    Maintenance,
}

/// <summary>Resource-usage severity derived from a percentage (port of the web thresholds).</summary>
public enum ResourceSeverity
{
    /// <summary>Below the warning threshold.</summary>
    Normal,

    /// <summary>At or above 70%.</summary>
    Warn,

    /// <summary>At or above 90%.</summary>
    Critical,
}

/// <summary>One day in the uptime heatmap (port of the web <c>UptimeDay</c>).</summary>
/// <param name="Date">ISO date (yyyy-MM-dd).</param>
/// <param name="Status">That day's health status.</param>
/// <param name="Summary">Optional short description shown in the tooltip.</param>
public sealed record UptimeDay(string Date, HealthStatus Status, string? Summary = null);

/// <summary>
/// Pure presentation + maths for the status surfaces (labels, semantic accent hex,
/// glyphs, headline defaults, uptime percentage, resource severity). Headless so the
/// thresholds and uptime computation are unit-tested without WinUI.
/// </summary>
public static class StatusPresentation
{
    /// <summary>Healthy / operational accent.</summary>
    public const string HealthyHex = "#22C55E";

    /// <summary>Degraded accent.</summary>
    public const string DegradedHex = "#FBBF24";

    /// <summary>Unhealthy / outage accent.</summary>
    public const string UnhealthyHex = "#EF4444";

    /// <summary>Unknown / neutral accent.</summary>
    public const string UnknownHex = "#94A3B8";

    /// <summary>Maintenance accent.</summary>
    public const string MaintenanceHex = "#3B82F6";

    /// <summary>Semantic accent hex for a status.</summary>
    public static string AccentHex(HealthStatus status) => status switch
    {
        HealthStatus.Healthy => HealthyHex,
        HealthStatus.Degraded => DegradedHex,
        HealthStatus.Unhealthy => UnhealthyHex,
        HealthStatus.Maintenance => MaintenanceHex,
        _ => UnknownHex,
    };

    /// <summary>Short status label (port of the web <c>STATUS_LABEL</c>).</summary>
    public static string Label(HealthStatus status) => status switch
    {
        HealthStatus.Healthy => "Operational",
        HealthStatus.Degraded => "Degraded",
        HealthStatus.Unhealthy => "Outage",
        HealthStatus.Maintenance => "Maintenance",
        _ => "Unknown",
    };

    /// <summary>Full hero headline (port of the web <c>defaultHeadline</c>).</summary>
    public static string DefaultHeadline(HealthStatus status) => status switch
    {
        HealthStatus.Healthy => "All systems operational",
        HealthStatus.Degraded => "Degraded performance",
        HealthStatus.Unhealthy => "Service outage",
        HealthStatus.Maintenance => "Scheduled maintenance",
        _ => "Status unknown",
    };

    /// <summary>Compact hero headline (port of the web <c>SHORT_HEADLINE</c>).</summary>
    public static string ShortHeadline(HealthStatus status) => status switch
    {
        HealthStatus.Healthy => "All operational",
        HealthStatus.Degraded => "Degraded",
        HealthStatus.Unhealthy => "Outage",
        HealthStatus.Maintenance => "Maintenance",
        _ => "Status unknown",
    };

    /// <summary>Segoe Fluent / MDL2 glyph for a status icon.</summary>
    public static string Glyph(HealthStatus status) => status switch
    {
        HealthStatus.Healthy => "\uEC61",
        HealthStatus.Degraded => "\uE7BA",
        HealthStatus.Unhealthy => "\uEA39",
        HealthStatus.Maintenance => "\uE90F",
        _ => "\uE897",
    };

    /// <summary>
    /// Rolling uptime percentage across the window: healthy + maintenance days count
    /// as "up" (port of the web <c>uptimePct</c>). Null for an empty window.
    /// </summary>
    public static double? UptimePercent(IReadOnlyList<UptimeDay> days)
    {
        ArgumentNullException.ThrowIfNull(days);
        if (days.Count == 0)
        {
            return null;
        }

        int up = 0;
        foreach (var day in days)
        {
            if (day.Status is HealthStatus.Healthy or HealthStatus.Maintenance)
            {
                up++;
            }
        }

        return (double)up / days.Count * 100.0;
    }

    /// <summary>Resource severity from a percent (warn ≥ 70, critical ≥ 90).</summary>
    public static ResourceSeverity Severity(double? percent) => percent switch
    {
        null => ResourceSeverity.Normal,
        >= 90 => ResourceSeverity.Critical,
        >= 70 => ResourceSeverity.Warn,
        _ => ResourceSeverity.Normal,
    };

    /// <summary>Accent hex for a resource severity.</summary>
    public static string SeverityHex(ResourceSeverity severity) => severity switch
    {
        ResourceSeverity.Critical => UnhealthyHex,
        ResourceSeverity.Warn => DegradedHex,
        _ => HealthyHex,
    };
}
