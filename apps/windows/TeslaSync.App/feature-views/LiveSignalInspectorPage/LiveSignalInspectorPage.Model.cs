using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The top-level data state the <c>LiveSignalInspectorPage</c> can be in — the native union of the three web
/// data states the page renders (web/src/features/admin/pages/LiveSignalInspectorPage.tsx): the initial fleet
/// load (<see cref="Loading"/>), the no-vehicle guard (web <c>vehicleId === null</c>, <see cref="Empty"/>) and
/// the selected-vehicle live snapshot (<see cref="Success"/>). Every branch maps onto a visible surface; none is
/// ever hidden. The page has no top-level error branch — the web source raises none (a <c>useVehicles</c> failure
/// degrades to the empty fleet / no-vehicle guard, and the per-second live read's loading / empty / error / stale
/// branches all live inside the composed <see cref="TeslaSync.App.FeatureViews.LiveSignalsTable"/> snapshot).
/// </summary>
public enum LiveSignalInspectorState
{
    /// <summary>Initial fleet fetch with nothing resolved yet — render the picker's loading affordance.</summary>
    Loading,

    /// <summary>No vehicle is selected (web <c>vehicleId === null</c>) — render the "select a vehicle" empty state.</summary>
    Empty,

    /// <summary>A vehicle is selected — render the live snapshot panel.</summary>
    Success,
}

/// <summary>
/// One render-ready entry of the vehicle picker — the native port of an option in the web page's
/// <c>vehicleOptions</c> array (web L41-L50: <c>{ value: String(v.id), label: v.display_name || v.vin ||
/// `Vehicle ${v.id}` }</c>). <see cref="Id"/> is the numeric scope id the trigger round-trips and
/// <see cref="Label"/> is the human-facing trigger text resolved through the shared
/// <see cref="VehicleLabels.Short"/> rule (display name → VIN → "Vehicle {id}").
/// </summary>
/// <param name="Id">The numeric vehicle id (web <c>v.id</c>).</param>
/// <param name="Label">The trigger label (web <c>display_name || vin || `Vehicle ${id}`</c>).</param>
public sealed record LiveSignalVehicleOption(long Id, string Label);

/// <summary>
/// The Microsoft.UI-free input to <see cref="LiveSignalInspectorProjection.Project"/> — the page's full state
/// snapshot (web local <c>useState</c> + the <c>useVehicles</c> query result). Pure data so the projection is
/// asserted headlessly.
/// </summary>
/// <param name="Vehicles">The loaded fleet filling the picker (web <c>vehicles.data ?? []</c>).</param>
/// <param name="SelectedVehicleId">The page-local selected vehicle (web <c>vehicleId</c>), or null when none.</param>
/// <param name="Loading">True while the initial fleet fetch is in flight (web <c>vehicles.isLoading</c>).</param>
public sealed record LiveSignalInspectorModel(
    IReadOnlyList<VehicleOption> Vehicles,
    long? SelectedVehicleId,
    bool Loading);

/// <summary>
/// The fully projected, render-ready view of the Live Signal Inspector page — the native analogue of the web
/// component's render output. The WinUI view is a thin renderer: every visible literal, every per-region
/// visibility flag and the picker option list are computed here so the page's three web data states are
/// asserted without a XAML host.
/// </summary>
public sealed record LiveSignalInspectorDisplay(
    LiveSignalInspectorState State,
    string Title,
    string Subtitle,
    string AutomationName,
    string SelectVehiclePrompt,
    string VehicleAriaLabel,
    IReadOnlyList<LiveSignalVehicleOption> VehicleOptions,
    long? SelectedVehicleId,
    bool ShowVehicleLoading,
    bool ShowLiveIndicator,
    bool ShowNoVehicle,
    string NoVehicleTitle,
    string NoVehicleMessage,
    bool ShowSnapshot,
    string SnapshotTitle,
    string VehicleLoadingText)
{
    /// <summary>The empty projection used before the first model is available.</summary>
    public static LiveSignalInspectorDisplay Empty { get; } = new(
        LiveSignalInspectorState.Loading,
        "Live Signal Inspector",
        string.Empty,
        "Live Signal Inspector",
        "Select vehicle\u2026",
        "Vehicle",
        Array.Empty<LiveSignalVehicleOption>(),
        null,
        true,
        false,
        false,
        "Select a vehicle",
        string.Empty,
        false,
        "Live snapshot",
        "Loading\u2026");
}

/// <summary>
/// The pure, Microsoft.UI-free projection from <see cref="LiveSignalInspectorModel"/> to
/// <see cref="LiveSignalInspectorDisplay"/> — the native port of the web component's render logic
/// (web/src/features/admin/pages/LiveSignalInspectorPage.tsx). It resolves every string through the i18n facade
/// with the web key names, maps the loaded fleet to picker options via the shared <see cref="VehicleLabels.Short"/>
/// rule, and selects the data state: loading while the first fleet fetch is in flight, the no-vehicle guard while
/// nothing is selected (web <c>vehicleId === null</c>) and the live snapshot once a vehicle is picked.
/// </summary>
public static class LiveSignalInspectorProjection
{
    /// <summary>Project <paramref name="model"/> into the render-ready display through <paramref name="localizer"/>.</summary>
    public static LiveSignalInspectorDisplay Project(LiveSignalInspectorModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        bool hasSelection = model.SelectedVehicleId is { } id && id > 0;
        bool loading = model.Loading && model.Vehicles.Count == 0 && !hasSelection;

        LiveSignalInspectorState state = hasSelection
            ? LiveSignalInspectorState.Success
            : loading
                ? LiveSignalInspectorState.Loading
                : LiveSignalInspectorState.Empty;

        string title = LiveSignalInspectorRegistration.Title(localizer);

        return new LiveSignalInspectorDisplay(
            State: state,
            Title: title,
            Subtitle: LiveSignalInspectorRegistration.Subtitle(localizer),
            AutomationName: title,
            SelectVehiclePrompt: localizer.GetString("admin.liveSignals.controls.selectVehicle", "Select vehicle\u2026"),
            VehicleAriaLabel: localizer.GetString("admin.liveSignals.controls.vehicleAria", "Vehicle"),
            VehicleOptions: BuildOptions(model.Vehicles),
            SelectedVehicleId: hasSelection ? model.SelectedVehicleId : null,
            ShowVehicleLoading: state == LiveSignalInspectorState.Loading,
            ShowLiveIndicator: hasSelection,
            ShowNoVehicle: state == LiveSignalInspectorState.Empty,
            NoVehicleTitle: localizer.GetString("admin.liveSignals.noVehicle.title", "Select a vehicle"),
            NoVehicleMessage: localizer.GetString(
                "admin.liveSignals.noVehicle.message",
                "Pick a vehicle from the dropdown above to start streaming its live signal cache."),
            ShowSnapshot: hasSelection,
            SnapshotTitle: localizer.GetString("admin.liveSignals.panels.snapshot", "Live snapshot"),
            VehicleLoadingText: localizer.GetString("admin.liveSignals.table.loading", "Loading\u2026"));
    }

    private static IReadOnlyList<LiveSignalVehicleOption> BuildOptions(IReadOnlyList<VehicleOption> vehicles)
    {
        if (vehicles.Count == 0)
        {
            return Array.Empty<LiveSignalVehicleOption>();
        }

        var options = new List<LiveSignalVehicleOption>(vehicles.Count);
        foreach (var vehicle in vehicles)
        {
            options.Add(new LiveSignalVehicleOption(vehicle.Id, VehicleLabels.Short(vehicle)));
        }

        return options;
    }
}

/// <summary>
/// Registration metadata for the <c>LiveSignalInspectorPage</c> surface — the W4 shell page-factory slug, the
/// generated-client operation the fleet picker binds to, and the localized page title / subtitle. The route name
/// is the one the <see cref="TeslaSync.App.Core.Navigation.RouteTable"/> already maps
/// (<c>LiveSignalInspector → admin/live-signals</c>).
/// </summary>
public static class LiveSignalInspectorRegistration
{
    /// <summary>The diagnostics surface slug.</summary>
    public const string Slug = "LiveSignalInspectorPage";

    /// <summary>The shell route name (web nav name / <c>RouteTable</c> id).</summary>
    public const string RouteName = "LiveSignalInspector";

    /// <summary>The generated OpenAPI operation for the fleet picker (web <c>useVehicles → GET /vehicles</c>).</summary>
    public const string VehiclesOperation = "get_api_v1_vehicles";

    /// <summary>The localized page title (web <c>admin.liveSignals.pageTitle</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("admin.liveSignals.pageTitle", "Live Signal Inspector");
    }

    /// <summary>The localized page subtitle (web <c>admin.liveSignals.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "admin.liveSignals.subtitle",
            "Realtime view of the Redis-cached live signal snapshot. Refreshes every second while this tab is in the foreground.");
    }
}

/// <summary>
/// Tolerant parser for the <c>GET /vehicles</c> JSON the fleet picker binds to (web <c>useVehicles</c>). Reads the
/// numeric <c>id</c>, the <c>display_name</c> (camelCase fallback) and the <c>vin</c> so the shared
/// <see cref="VehicleLabels.Short"/> rule reproduces the web <c>display_name || vin || `Vehicle ${id}`</c> label.
/// Null-tolerant: a non-array body, a non-object entry or a missing field never throws.
/// </summary>
public static class LiveSignalInspectorVehicles
{
    /// <summary>Parse a <c>GET /vehicles</c> JSON array into a tolerant list of <see cref="VehicleOption"/>.</summary>
    public static IReadOnlyList<VehicleOption> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<VehicleOption>();
        }

        var list = new List<VehicleOption>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            long id = ReadId(item);
            if (id <= 0)
            {
                continue;
            }

            list.Add(new VehicleOption(
                id,
                ReadString(item, "display_name") ?? ReadString(item, "displayName"),
                ReadString(item, "vin")));
        }

        return list;
    }

    private static string? ReadString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static long ReadId(JsonElement obj)
    {
        if (!obj.TryGetProperty("id", out var value))
        {
            return 0;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(
                value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => 0,
        };
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>LiveSignalInspectorPage</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a vehicle id, signal name or value — so a
/// diagnostics line can never leak telemetry. Thread-safe.
/// </summary>
public sealed class LiveSignalInspectorDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public LiveSignalInspectorDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=LiveSignalInspectorPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(CultureInfo.InvariantCulture, $"view.opened slug={LiveSignalInspectorRegistration.Slug}"));
    }
}
