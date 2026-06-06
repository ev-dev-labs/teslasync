using System.Globalization;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Vehicles;

namespace TeslaSync.App.Core.Widgets;

/// <summary>
/// The display-boundary projection for the vehicle widget (P2/W8-0003): it folds an SI
/// <see cref="WidgetVehicleSnapshot"/>, the user's <see cref="UnitPref"/>, the
/// <see cref="WidgetPrivacyOptions"/> posture and the current time into a localized, redacted,
/// freshness-aware <see cref="WidgetView"/>. It reuses the shared SI→display formatters and the
/// two-minute freshness logic so the widget shows exactly what the in-app surfaces show, and it never
/// fabricates a value — an unreported field becomes an explicit em dash. Pure and headless.
/// </summary>
public static class WidgetProjection
{
    /// <summary>Projects <paramref name="snapshot"/> into a display-ready <see cref="WidgetView"/>.</summary>
    public static WidgetView Project(
        WidgetVehicleSnapshot snapshot,
        UnitPref unitPref,
        WidgetPrivacyOptions privacy,
        DateTimeOffset now,
        RouteRegistry registry,
        ILocalizer? localizer = null)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(unitPref);
        ArgumentNullException.ThrowIfNull(privacy);
        ArgumentNullException.ThrowIfNull(registry);
        localizer ??= PassthroughLocalizer.Instance;

        double batteryPercent = Math.Clamp(snapshot.BatteryLevel ?? 0, 0, 100);
        var freshness = FreshnessLogic.GetStatus(snapshot.ObservedAt, now);
        var vinText = WidgetRedaction.Vin(snapshot.Vin, privacy.HideVin);
        var locationText = WidgetRedaction.Location(snapshot.Latitude, snapshot.Longitude, privacy.HideLocation);

        return new WidgetView
        {
            VehicleId = snapshot.VehicleId,
            DisplayName = ResolveName(snapshot.DisplayName, localizer),
            StatusLabel = StatusLabel(snapshot.State, localizer),
            BatteryText = ScalarFormatters.FormatPercentage(snapshot.BatteryLevel),
            BatteryPercent = batteryPercent,
            AccentColor = VehicleHeroMetrics.BatteryColor(batteryPercent),
            RangeText = UnitFormatters.FormatDistance(snapshot.RatedRangeMeters, unitPref),
            ChargeStateText = ChargeStateText(snapshot, unitPref, localizer),
            IsCharging = snapshot.IsCharging ?? false,
            LockStateText = LockStateText(snapshot.IsLocked, localizer),
            FreshnessLabel = FreshnessLabel(freshness, localizer),
            Freshness = freshness,
            LastUpdatedText = FreshnessLogic.FormatAge(FreshnessLogic.ComputeAge(snapshot.ObservedAt, now)),
            ShowVin = vinText is not null,
            VinText = vinText,
            ShowLocation = locationText is not null,
            LocationText = locationText,
            Actions = WidgetDeepLinks.Actions(snapshot.VehicleId, registry, localizer),
        };
    }

    private static string ResolveName(string? name, ILocalizer localizer) =>
        string.IsNullOrWhiteSpace(name) ? localizer.GetString("widget.vehicle.unknown", "Vehicle") : name.Trim();

    private static string StatusLabel(string? state, ILocalizer localizer)
    {
        var key = (state ?? string.Empty).Trim().ToLowerInvariant();
        return key switch
        {
            "online" => localizer.GetString("widget.status.online", "Online"),
            "asleep" => localizer.GetString("widget.status.asleep", "Asleep"),
            "offline" => localizer.GetString("widget.status.offline", "Offline"),
            "driving" => localizer.GetString("widget.status.driving", "Driving"),
            "charging" => localizer.GetString("widget.status.charging", "Charging"),
            _ => localizer.GetString("widget.status.unknown", "Unknown"),
        };
    }

    private static string ChargeStateText(WidgetVehicleSnapshot snapshot, UnitPref pref, ILocalizer localizer)
    {
        if (snapshot.IsCharging == true)
        {
            var text = localizer.GetString("widget.charge.charging", "Charging");
            if (snapshot.ChargerPowerWatts is { } watts && double.IsFinite(watts) && watts > 0)
            {
                text += " \u00B7 " + UnitFormatters.FormatPower(watts, pref);
            }

            if (snapshot.TimeToFullChargeHours is { } hours && double.IsFinite(hours) && hours > 0)
            {
                text += " \u00B7 ~" + hours.ToString("0.#", CultureInfo.InvariantCulture) + " h";
            }

            return text;
        }

        return snapshot.IsCharging == false
            ? localizer.GetString("widget.charge.notCharging", "Not charging")
            : localizer.GetString("widget.charge.unknown", "Charge unknown");
    }

    private static string LockStateText(bool? locked, ILocalizer localizer) => locked switch
    {
        true => localizer.GetString("widget.lock.locked", "Locked"),
        false => localizer.GetString("widget.lock.unlocked", "Unlocked"),
        _ => UnitFormatters.DefaultEmptyDisplay,
    };

    private static string FreshnessLabel(FreshnessStatus status, ILocalizer localizer) => status switch
    {
        FreshnessStatus.Fresh => localizer.GetString("widget.freshness.live", "Live"),
        FreshnessStatus.Stale => localizer.GetString("widget.freshness.stale", "Stale"),
        FreshnessStatus.Offline => localizer.GetString("widget.freshness.offline", "Offline"),
        _ => localizer.GetString("widget.freshness.unknown", "No data"),
    };
}
