using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Dashboard;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="QuickStatsPageViewModel"/> can be in — the native
/// union of the loading / success / empty / error branches the web <c>QuickStatsPage</c> renders through
/// <c>PageContainer</c> (web/src/features/dashboard/pages/QuickStatsPage.tsx). Every branch maps onto a
/// visible surface; none is hidden. <see cref="Empty"/> models the resolved-but-no-data snapshot (no vehicle
/// and no fleet analytics) rather than an empty HTTP body.
/// </summary>
public enum QuickStatsState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome (web <c>loading</c>).</summary>
    Loading,

    /// <summary>A resolved snapshot with a vehicle and/or fleet analytics to show (web success).</summary>
    Loaded,

    /// <summary>A resolved snapshot carrying no vehicle and no analytics — render the empty affordance.</summary>
    Empty,

    /// <summary>The request failed with no cached snapshot — render the failure surface + retry.</summary>
    Error,
}

/// <summary>
/// The primary vehicle identity the page reads from <c>GET /vehicles</c> (web <c>useVehicles</c>, selecting
/// <c>vehicles[0]</c>). Only the fields the web card renders are kept: the user-set
/// <see cref="DisplayName"/> (web <c>display_name</c>) and the <see cref="Model"/> code (web <c>model</c>),
/// plus the <see cref="Id"/> used to read that vehicle's live state. Parsing is null-tolerant so a partial
/// body never throws.
/// </summary>
/// <param name="Id">The vehicle id (web <c>id</c>).</param>
/// <param name="DisplayName">The user-set name (web <c>display_name</c>).</param>
/// <param name="Model">The model code (web <c>model</c>).</param>
public sealed record QuickStatsVehicle(long Id, string DisplayName, string Model)
{
    /// <summary>Resolve the first usable vehicle from a <c>GET /vehicles</c> array (web <c>vehicles?.[0]</c>).</summary>
    /// <param name="root">The parsed <c>GET /vehicles</c> body.</param>
    /// <returns>The first object entry projected, or <see langword="null"/> when none is available.</returns>
    public static QuickStatsVehicle? FromVehiclesArray(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        foreach (var element in root.EnumerateArray())
        {
            if (element.ValueKind == JsonValueKind.Object)
            {
                return new QuickStatsVehicle(
                    Id: QuickStatsJson.Long(element, "id") ?? 0,
                    DisplayName: QuickStatsJson.String(element, "display_name") ?? string.Empty,
                    Model: QuickStatsJson.String(element, "model") ?? string.Empty);
            }
        }

        return null;
    }
}

/// <summary>
/// The single live-state field the page card shows: the FSM status string from
/// <c>GET /vehicles/{vehicleID}/state</c> (web <c>stateData?.state?.state</c>). A <see langword="null"/>
/// <see cref="Status"/> models the web optional chain resolving to undefined (the projection then falls back
/// to <c>offline</c>).
/// </summary>
/// <param name="Status">The FSM state string (web <c>state.state</c>), or <see langword="null"/> when absent.</param>
public sealed record QuickStatsLiveState(string? Status)
{
    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/state</c> response into the status slice, mirroring the web
    /// <c>stateData?.state?.state</c> read: the canonical <c>state</c> object's <c>state</c> string.
    /// </summary>
    /// <param name="root">The parsed state response body.</param>
    /// <returns>The parsed status, or <see langword="null"/> when the vehicle reports no live state.</returns>
    public static QuickStatsLiveState? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (QuickStatsJson.Object(root, "state") is { } state)
        {
            string? status = QuickStatsJson.String(state, "state");
            return status is null ? null : new QuickStatsLiveState(status);
        }

        return null;
    }
}

/// <summary>
/// The fleet analytics rollup from <c>GET /analytics/fleet</c> (web <c>useAnalyticsSummary(30)</c>). Only the
/// four totals the page renders are kept; field names mirror the Go API's snake_case JSON tags
/// (<c>total_distance_km</c>, <c>total_drives</c>, <c>total_energy_kwh</c>, <c>total_cost</c>). Distance is
/// kilometres and is converted to the user's display unit only at projection time.
/// </summary>
/// <param name="TotalDistanceKm">Lifetime distance in kilometres (web <c>totalDistanceKm</c>).</param>
/// <param name="TotalDrives">Total number of drives (web <c>totalDrives</c>).</param>
/// <param name="TotalEnergyKwh">Total energy consumed in kWh (web <c>totalEnergyKwh</c>).</param>
/// <param name="TotalCost">Total cost in the user's currency (web <c>totalCost</c>).</param>
public sealed record QuickStatsAnalytics(
    double TotalDistanceKm,
    long TotalDrives,
    double TotalEnergyKwh,
    double TotalCost)
{
    /// <summary>An all-zero rollup — the parse fallback for an absent / non-object body.</summary>
    public static QuickStatsAnalytics Empty { get; } = new(0, 0, 0, 0);

    /// <summary>True when any total is non-zero (gates the page-level empty classification).</summary>
    [JsonIgnore]
    public bool HasData => TotalDistanceKm > 0 || TotalDrives > 0 || TotalEnergyKwh > 0 || TotalCost > 0;

    /// <summary>Project a <c>GET /analytics/fleet</c> JSON object into a tolerant rollup.</summary>
    /// <param name="element">The parsed fleet-analytics body.</param>
    /// <returns>The parsed rollup, or <see cref="Empty"/> for a non-object body.</returns>
    public static QuickStatsAnalytics FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new QuickStatsAnalytics(
            TotalDistanceKm: QuickStatsJson.Double(element, "total_distance_km") ?? 0,
            TotalDrives: QuickStatsJson.Long(element, "total_drives") ?? 0,
            TotalEnergyKwh: QuickStatsJson.Double(element, "total_energy_kwh") ?? 0,
            TotalCost: QuickStatsJson.Double(element, "total_cost") ?? 0);
    }
}

/// <summary>
/// The resolved reading cached by the source: the (nullable) primary <see cref="Vehicle"/>, that vehicle's
/// (nullable) live <see cref="State"/> and the always-present fleet <see cref="Analytics"/>. A null
/// <see cref="Vehicle"/> mirrors the web <c>vehicle</c> being falsy (the card shows its empty state).
/// Serialized to the cache as JSON so the cache-then-network read round-trips losslessly.
/// </summary>
/// <param name="Vehicle">The primary vehicle, or <see langword="null"/> when none resolved.</param>
/// <param name="State">The primary vehicle's live state, or <see langword="null"/> when asleep / absent.</param>
/// <param name="Analytics">The fleet analytics rollup (always present; <see cref="QuickStatsAnalytics.Empty"/> when none).</param>
public sealed record QuickStatsSnapshot(
    QuickStatsVehicle? Vehicle,
    QuickStatsLiveState? State,
    QuickStatsAnalytics Analytics)
{
    /// <summary>The "nothing resolved" snapshot — the parse / loading fallback.</summary>
    public static QuickStatsSnapshot Empty { get; } = new(null, null, QuickStatsAnalytics.Empty);

    /// <summary>True when a primary vehicle backs the snapshot (web <c>vehicle</c> truthy).</summary>
    [JsonIgnore]
    public bool HasVehicle => Vehicle is not null;

    /// <summary>True when there is anything to show — a vehicle or some fleet analytics (gates the empty state).</summary>
    [JsonIgnore]
    public bool HasData => HasVehicle || Analytics.HasData;
}

/// <summary>
/// One projected, render-ready metric tile — the native analogue of one web <c>&lt;MetricCard&gt;</c>. Holds
/// a stable <see cref="Key"/> (for parity assertions), the localized <see cref="Label"/>, the already-formatted
/// <see cref="Value"/>, the token brush key for the accent rail and a Narrator automation name. Pure data — no
/// WinUI types.
/// </summary>
/// <param name="Key">Stable identity (<c>distance</c> / <c>drives</c> / <c>energy</c> / <c>cost</c>).</param>
/// <param name="Label">The localized tile label.</param>
/// <param name="Value">The pre-formatted display value.</param>
/// <param name="AccentBrushKey">The design-token brush key for the accent rail.</param>
/// <param name="AutomationName">The composed "label: value" Narrator name.</param>
public sealed record QuickStatsMetric(
    string Key,
    string Label,
    string Value,
    string AccentBrushKey,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the page — the native analogue of everything the web component
/// computes before returning JSX. Holds the localized header, the vehicle-card content (or its empty-state
/// message), the four metric tiles, the footer line and the failure-surface labels. Pure data so the
/// projection is unit-tested without a UI host.
/// </summary>
/// <param name="State">The mutually-exclusive lifecycle state.</param>
/// <param name="Title">The localized page title (web <c>quickStats.title</c>).</param>
/// <param name="AutomationName">The page-level Narrator name.</param>
/// <param name="HasVehicle">True when the vehicle card shows a vehicle (false renders its empty state).</param>
/// <param name="VehicleName">The vehicle display name (web <c>display_name || defaultName</c>).</param>
/// <param name="VehicleSubtitle">The "model · state" sub-line (web <c>{model} · {state}</c>).</param>
/// <param name="VehicleAutomationName">The vehicle card's composed Narrator name.</param>
/// <param name="NoVehicleMessage">The card empty-state message (web <c>quickStats.noVehicle</c>).</param>
/// <param name="Metrics">The four metric tiles (distance / drives / energy / cost).</param>
/// <param name="FooterText">The footer brand line (web <c>quickStats.footer</c>).</param>
/// <param name="OpenDashboardText">The dashboard link label (web <c>quickStats.openDashboard</c>).</param>
/// <param name="ErrorText">The failure-surface heading (shared <c>error.loadFailed</c>).</param>
/// <param name="RetryText">The retry-affordance label (shared <c>common.retry</c>).</param>
public sealed record QuickStatsDisplay(
    QuickStatsState State,
    string Title,
    string AutomationName,
    bool HasVehicle,
    string VehicleName,
    string VehicleSubtitle,
    string VehicleAutomationName,
    string NoVehicleMessage,
    IReadOnlyList<QuickStatsMetric> Metrics,
    string FooterText,
    string OpenDashboardText,
    string ErrorText,
    string RetryText)
{
    /// <summary>True when the loading skeleton should be shown.</summary>
    [JsonIgnore]
    public bool ShowLoading => State == QuickStatsState.Loading;

    /// <summary>True when the failure surface should be shown.</summary>
    [JsonIgnore]
    public bool ShowError => State == QuickStatsState.Error;

    /// <summary>True when the content region (card + metrics + footer) should be shown.</summary>
    [JsonIgnore]
    public bool ShowContent => State is QuickStatsState.Loaded or QuickStatsState.Empty;
}

/// <summary>
/// Pure projection from a raw <see cref="QuickStatsSnapshot"/> to the <see cref="QuickStatsDisplay"/> — the
/// native port of everything the web component renders. SI is converted to the user's display unit here (and
/// only here); every label resolves through the i18n facade with the same web key names.
/// </summary>
public static class QuickStatsProjection
{
    /// <summary>Accent rail brush for the distance tile (web <c>color="cyan"</c>).</summary>
    public const string CyanAccentBrushKey = "TsChartSpeedBrush";

    /// <summary>Accent rail brush for the drives tile (web <c>color="green"</c>).</summary>
    public const string GreenAccentBrushKey = "TsChartBatteryBrush";

    /// <summary>Accent rail brush for the energy tile (web <c>color="amber"</c>).</summary>
    public const string AmberAccentBrushKey = "TsColorWarningBrush";

    /// <summary>Accent rail brush for the cost tile (web <c>color="purple"</c>).</summary>
    public const string PurpleAccentBrushKey = "TsChartPowerBrush";

    /// <summary>The Fluent glyph for the vehicle card (web <c>Car</c> lucide icon).</summary>
    public const string CarGlyph = "\uE804";

    private const string OfflineState = "offline";
    private const string MiddleDot = " \u00B7 ";

    /// <summary>Project <paramref name="snapshot"/> in <paramref name="state"/> using the user's units + currency.</summary>
    /// <param name="snapshot">The resolved reading.</param>
    /// <param name="state">The lifecycle state to render.</param>
    /// <param name="units">The user's display-unit preference (web <c>useUnits().unitPrefs</c>).</param>
    /// <param name="currencySymbol">The currency symbol for the cost tile (web <c>useFormatting()</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready display model.</returns>
    public static QuickStatsDisplay Project(
        QuickStatsSnapshot snapshot,
        QuickStatsState state,
        UnitPref units,
        string currencySymbol,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string symbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;
        string title = localizer.GetString("quickStats.title", "Quick Stats");
        string defaultName = localizer.GetString("quickStats.defaultName", "Tesla");
        string noVehicle = localizer.GetString("quickStats.noVehicle", "No vehicle found");

        bool hasVehicle = snapshot.Vehicle is not null;
        string vehicleName = hasVehicle && !string.IsNullOrWhiteSpace(snapshot.Vehicle!.DisplayName)
            ? snapshot.Vehicle.DisplayName.Trim()
            : defaultName;
        string status = snapshot.State?.Status is { } s && !string.IsNullOrWhiteSpace(s) ? s.Trim() : OfflineState;
        string model = snapshot.Vehicle?.Model?.Trim() ?? string.Empty;
        string vehicleSubtitle = string.IsNullOrEmpty(model) ? status : model + MiddleDot + status;
        string vehicleAutomationName = hasVehicle
            ? string.Format(CultureInfo.CurrentCulture, "{0}, {1}", vehicleName, vehicleSubtitle)
            : noVehicle;

        var analytics = snapshot.Analytics;
        var distanceUnit = units.Distance;
        string distanceUnitLabel = UnitLabels.Label(distanceUnit);

        double displayDistance = UnitConverters.DistanceFromSi(analytics.TotalDistanceKm * 1000.0, distanceUnit);
        string distanceValue = ScalarFormatters.FormatNumber(displayDistance, 0);
        string drivesValue = ScalarFormatters.FormatNumber(analytics.TotalDrives, 0);
        string energyValue = ScalarFormatters.FormatNumber(analytics.TotalEnergyKwh, 0);
        string costValue = ScalarFormatters.FormatCurrency(analytics.TotalCost, symbol, 0);

        string distanceLabel = localizer
            .GetString("quickStats.distance", "{{unit}} Driven")
            .Replace("{{unit}}", distanceUnitLabel, StringComparison.Ordinal)
            .Replace("{unit}", distanceUnitLabel, StringComparison.Ordinal);
        string drivesLabel = localizer.GetString("quickStats.drives", "Drives");
        string energyLabel = localizer.GetString("quickStats.energy", "kWh Used");
        string costLabel = localizer.GetString("quickStats.cost", "Total Cost");

        var metrics = new List<QuickStatsMetric>(4)
        {
            new("distance", distanceLabel, distanceValue, CyanAccentBrushKey, MetricAutomationName(distanceLabel, distanceValue)),
            new("drives", drivesLabel, drivesValue, GreenAccentBrushKey, MetricAutomationName(drivesLabel, drivesValue)),
            new("energy", energyLabel, energyValue, AmberAccentBrushKey, MetricAutomationName(energyLabel, energyValue)),
            new("cost", costLabel, costValue, PurpleAccentBrushKey, MetricAutomationName(costLabel, costValue)),
        };

        return new QuickStatsDisplay(
            State: state,
            Title: title,
            AutomationName: title,
            HasVehicle: hasVehicle,
            VehicleName: vehicleName,
            VehicleSubtitle: vehicleSubtitle,
            VehicleAutomationName: vehicleAutomationName,
            NoVehicleMessage: noVehicle,
            Metrics: metrics,
            FooterText: localizer.GetString("quickStats.footer", "Powered by TeslaSync"),
            OpenDashboardText: localizer.GetString("quickStats.openDashboard", "Open Dashboard"),
            ErrorText: localizer.GetString("error.loadFailed", "Failed to load data"),
            RetryText: localizer.GetString("common.retry", "Retry"));
    }

    private static string MetricAutomationName(string label, string value) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value);
}

/// <summary>
/// Canonical registry metadata for the Quick Stats surface — the native mirror of the web route entry
/// (route <c>/quick-stats</c>, nav name <c>QuickStats</c>). The shell page factory binds this surface under
/// the same route name.
/// </summary>
public static class QuickStatsRegistration
{
    /// <summary>The shell route name (matches <c>RouteTable</c> Standalone("QuickStats", …)).</summary>
    public const string RouteName = "QuickStats";

    /// <summary>The web route path the page mirrors.</summary>
    public const string Route = "quick-stats";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "QuickStatsPage";

    /// <summary>The trailing analytics window the page requests (web <c>useAnalyticsSummary(30)</c>).</summary>
    public const int AnalyticsDays = 30;

    /// <summary>The shared cache key for the assembled quick-stats snapshot.</summary>
    public const string CacheKey = "dashboard:quick-stats";

    /// <summary>The localized page title (web <c>quickStats.title</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized title.</returns>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("quickStats.title", "Quick Stats");
    }
}

/// <summary>
/// PII-safe diagnostics for the Quick Stats surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a fleet metric, VIN or vehicle name —
/// so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class QuickStatsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to (null discards).</param>
    public QuickStatsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=QuickStatsPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={QuickStatsRegistration.Slug}");
    }
}

/// <summary>
/// The data port the <see cref="QuickStatsPageViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of resolved <see cref="QuickStatsSnapshot"/> readings — the native analogue of
/// the web page's <c>useVehicles</c> + <c>useVehicleState</c> + <c>useAnalyticsSummary</c> composition. The
/// view never performs HTTP itself; the concrete <see cref="QuickStatsSource"/> (or a test fake) drives this.
/// </summary>
public interface IQuickStatsSource
{
    /// <summary>Stream the cache-then-network quick-stats snapshots, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read when a newer load supersedes it.</param>
    /// <returns>The ordered cache-then-network emissions for one logical read.</returns>
    IAsyncEnumerable<RepositoryResult<QuickStatsSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The default <see cref="IQuickStatsSource"/> — resolves every read to the empty snapshot (the empty data
/// state). The shell uses this until a host wires the generated-client-backed <see cref="QuickStatsSource"/>.
/// </summary>
public sealed class EmptyQuickStatsSource : IQuickStatsSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyQuickStatsSource Instance { get; } = new();

    private EmptyQuickStatsSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<QuickStatsSnapshot>> StreamAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<QuickStatsSnapshot>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}

/// <summary>Null-tolerant JSON readers shared by the quick-stats parsers (snake_case primary, camelCase fallback).</summary>
internal static class QuickStatsJson
{
    public static JsonElement? Object(JsonElement parent, string name) =>
        parent.ValueKind == JsonValueKind.Object
        && parent.TryGetProperty(name, out var v)
        && v.ValueKind == JsonValueKind.Object
            ? v
            : null;

    public static string? String(JsonElement parent, string name)
    {
        var v = Property(parent, name);
        return v?.ValueKind == JsonValueKind.String ? v.Value.GetString() : null;
    }

    public static long? Long(JsonElement parent, string name)
    {
        var v = Property(parent, name);
        if (v is not { } e)
        {
            return null;
        }

        return e.ValueKind switch
        {
            JsonValueKind.Number when e.TryGetInt64(out var n) => n,
            JsonValueKind.Number when e.TryGetDouble(out var d) => (long)d,
            JsonValueKind.String when long.TryParse(e.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    public static double? Double(JsonElement parent, string name)
    {
        var v = Property(parent, name);
        if (v is not { } e)
        {
            return null;
        }

        return e.ValueKind switch
        {
            JsonValueKind.Number when e.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(e.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    private static JsonElement? Property(JsonElement parent, string snakeName)
    {
        if (parent.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (parent.TryGetProperty(snakeName, out var direct))
        {
            return direct;
        }

        string camel = ToCamelCase(snakeName);
        return !string.Equals(camel, snakeName, StringComparison.Ordinal) && parent.TryGetProperty(camel, out var alt)
            ? alt
            : null;
    }

    private static string ToCamelCase(string snake)
    {
        if (!snake.Contains('_', StringComparison.Ordinal))
        {
            return snake;
        }

        var parts = snake.Split('_', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0)
        {
            return snake;
        }

        var builder = new System.Text.StringBuilder(parts[0]);
        for (var i = 1; i < parts.Length; i++)
        {
            string part = parts[i];
            builder.Append(char.ToUpperInvariant(part[0]));
            if (part.Length > 1)
            {
                builder.Append(part, 1, part.Length - 1);
            }
        }

        return builder.ToString();
    }
}
