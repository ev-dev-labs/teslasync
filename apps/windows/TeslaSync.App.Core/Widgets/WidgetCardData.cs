using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.Core.Widgets;

/// <summary>
/// Builds the Adaptive Card data payload (P2/W8-0003) that binds into <see cref="WidgetTemplate"/>.
/// It maps a projected <see cref="WidgetView"/> — already localized, unit-converted and redacted — into
/// the flat <c>${…}</c> keys the template references, including the localized field titles and the
/// fixed quick-action slots (each gated by a <c>has…</c> flag so a missing route hides its button).
/// The output is the <c>Data</c> the provider hands to <c>WidgetManager.UpdateWidget</c> alongside the
/// template. Pure and headless so the binding contract is unit-tested without the widget host.
/// </summary>
public static class WidgetCardData
{
    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);

    /// <summary>Serializes the Adaptive Card data for <paramref name="view"/> as a JSON object string.</summary>
    public static string Build(WidgetView view, ILocalizer? localizer = null)
    {
        ArgumentNullException.ThrowIfNull(view);
        localizer ??= PassthroughLocalizer.Instance;

        var data = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["displayName"] = view.DisplayName,
            ["statusLabel"] = view.StatusLabel,
            ["batteryTitle"] = localizer.GetString("widget.field.battery", "Battery"),
            ["batteryText"] = view.BatteryText,
            ["batteryPercent"] = view.BatteryPercent,
            ["accentColor"] = view.AccentColor,
            ["rangeTitle"] = localizer.GetString("widget.field.range", "Range"),
            ["rangeText"] = view.RangeText,
            ["chargeTitle"] = localizer.GetString("widget.field.charge", "Charge"),
            ["chargeStateText"] = view.ChargeStateText,
            ["isCharging"] = view.IsCharging,
            ["lockTitle"] = localizer.GetString("widget.field.lock", "Lock"),
            ["lockStateText"] = view.LockStateText,
            ["freshnessLabel"] = view.FreshnessLabel,
            ["lastUpdatedText"] = view.LastUpdatedText,
            ["showVin"] = view.ShowVin,
            ["vinText"] = view.VinText ?? string.Empty,
            ["showLocation"] = view.ShowLocation,
            ["locationText"] = view.LocationText ?? string.Empty,
        };

        ApplyAction(data, view, WidgetDeepLinks.OpenVehicleVerb, "openVehicle");
        ApplyAction(data, view, WidgetDeepLinks.OpenChargingVerb, "openCharging");
        ApplyAction(data, view, WidgetDeepLinks.OpenLiveMapVerb, "openLiveMap");
        ApplyAction(data, view, WidgetDeepLinks.OpenCommandsVerb, "openCommands");

        return JsonSerializer.Serialize(data, SerializerOptions);
    }

    private static void ApplyAction(
        Dictionary<string, object?> data,
        WidgetView view,
        string verb,
        string prefix)
    {
        var action = view.Actions.FirstOrDefault(a => string.Equals(a.Verb, verb, StringComparison.Ordinal));
        bool has = !string.IsNullOrEmpty(action.Uri);

        data["has" + char.ToUpperInvariant(prefix[0]) + prefix[1..]] = has;
        data[prefix + "Url"] = has ? action.Uri : string.Empty;
        data[prefix + "Title"] = has ? action.Title : string.Empty;
    }
}
