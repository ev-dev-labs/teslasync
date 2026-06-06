using TeslaSync.App.Core.DataDisplay;

namespace TeslaSync.App.Core.Widgets;

/// <summary>
/// The fully projected, display-ready content for a vehicle widget (P2/W8-0003). Every string is
/// already localized and unit-converted at the display boundary, every privacy-sensitive field is
/// already redacted (with a <c>Show…</c> flag the Adaptive Card binds to <c>$when</c>), and the
/// freshness marker reflects the two-minute live-state contract. The provider turns this into widget
/// data without any further formatting, so the WinUI layer stays dumb.
/// </summary>
public sealed record WidgetView
{
    /// <summary>The vehicle id this view was projected for.</summary>
    public long VehicleId { get; init; }

    /// <summary>The vehicle display name (or a localized fallback).</summary>
    public string DisplayName { get; init; } = string.Empty;

    /// <summary>The coarse lifecycle status label (Online / Asleep / Driving / …).</summary>
    public string StatusLabel { get; init; } = string.Empty;

    /// <summary>The battery state-of-charge text (e.g. <c>72%</c>).</summary>
    public string BatteryText { get; init; } = string.Empty;

    /// <summary>The battery percentage clamped to 0–100 for the progress bar.</summary>
    public double BatteryPercent { get; init; }

    /// <summary>The accent colour (hex) for the battery readout.</summary>
    public string AccentColor { get; init; } = string.Empty;

    /// <summary>The rated-range text in the user's display distance unit.</summary>
    public string RangeText { get; init; } = string.Empty;

    /// <summary>The charge-state text (Charging · power / Not charging / unknown).</summary>
    public string ChargeStateText { get; init; } = string.Empty;

    /// <summary>True while the vehicle is actively charging.</summary>
    public bool IsCharging { get; init; }

    /// <summary>The lock-state text (Locked / Unlocked / unknown).</summary>
    public string LockStateText { get; init; } = string.Empty;

    /// <summary>The freshness marker (Live / Stale / Offline / no data).</summary>
    public string FreshnessLabel { get; init; } = string.Empty;

    /// <summary>The underlying freshness status (drives the marker colour).</summary>
    public FreshnessStatus Freshness { get; init; }

    /// <summary>The relative last-updated label (e.g. <c>2m ago</c>).</summary>
    public string LastUpdatedText { get; init; } = string.Empty;

    /// <summary>Whether the VIN row is shown (false by default per the privacy posture).</summary>
    public bool ShowVin { get; init; }

    /// <summary>The redacted VIN text when <see cref="ShowVin"/>, otherwise <see langword="null"/>.</summary>
    public string? VinText { get; init; }

    /// <summary>Whether the location row is shown (false by default per the privacy posture).</summary>
    public bool ShowLocation { get; init; }

    /// <summary>The coarsened location text when <see cref="ShowLocation"/>, otherwise <see langword="null"/>.</summary>
    public string? LocationText { get; init; }

    /// <summary>The quick actions (validated deep links) the widget surfaces.</summary>
    public IReadOnlyList<WidgetAction> Actions { get; init; } = Array.Empty<WidgetAction>();
}
