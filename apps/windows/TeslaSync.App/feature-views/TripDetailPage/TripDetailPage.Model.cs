using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Trips;

/// <summary>
/// One trip aggregate from <c>GET /trips/{trip_id}</c> (web <c>Trip</c> in web/src/api/types.ts) — the single
/// read the page is built around. Distance is SI metres, duration SI seconds and energy SI watt-hours;
/// <see cref="TotalCost"/> is a plain currency amount and the two counts are dimensionless. Parsing is
/// null-tolerant so a partial row never throws and the projection applies the same web <c>?? 0</c> / <c>?? '—'</c>
/// defaults. The web <c>useTrip</c> hook is deprecated (the Go router registers only <c>GET /trips</c>, so the
/// detail read resolves to a 404); the port preserves that contract — a failing read surfaces the never-blank
/// error branch exactly like the web page's <c>PageContainer</c> error path.
/// </summary>
public sealed record TripData(
    long Id,
    long VehicleId,
    string? Name,
    DateTimeOffset? StartDate,
    DateTimeOffset? EndDate,
    double TotalDistanceM,
    double TotalEnergyWh,
    double TotalDurationS,
    double TotalCost,
    long DriveCount,
    long ChargeCount)
{
    /// <summary>Project a <c>GET /trips/{trip_id}</c> response into the trip, or null for a non-object body.</summary>
    public static TripData? FromJson(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new TripData(
            Id: (long)(TripDetailJson.Double(root, "id") ?? 0),
            VehicleId: (long)(TripDetailJson.Double(root, "vehicle_id") ?? 0),
            Name: TripDetailJson.String(root, "name"),
            StartDate: TripDetailJson.Date(root, "start_date"),
            EndDate: TripDetailJson.Date(root, "end_date"),
            TotalDistanceM: TripDetailJson.Double(root, "total_distance_m") ?? 0,
            TotalEnergyWh: TripDetailJson.Double(root, "total_energy_wh") ?? 0,
            TotalDurationS: TripDetailJson.Double(root, "total_duration_s") ?? 0,
            TotalCost: TripDetailJson.Double(root, "total_cost") ?? 0,
            DriveCount: (long)(TripDetailJson.Double(root, "drive_count") ?? 0),
            ChargeCount: (long)(TripDetailJson.Double(root, "charge_count") ?? 0));
    }
}

/// <summary>The single-source snapshot the view-model folds — the resolved trip (or none).</summary>
public sealed record TripDetailSnapshot(TripData? Trip)
{
    /// <summary>The empty snapshot — no trip resolved yet (loading / empty seed).</summary>
    public static TripDetailSnapshot Empty { get; } = new((TripData?)null);

    /// <summary>True once the trip read resolved an object.</summary>
    public bool HasTrip => Trip is not null;
}

/// <summary>The render-time model: the parsed snapshot plus the page lifecycle flags (web query <c>isLoading</c> / error).</summary>
public sealed record TripDetailModel(TripDetailSnapshot Snapshot, bool Loading, string? ErrorDetail)
{
    /// <summary>The initial model: the trip query is in flight with nothing resolved yet.</summary>
    public static TripDetailModel Initial { get; } = new(TripDetailSnapshot.Empty, true, null);
}

/// <summary>The four mutually-exclusive top-level data states the page renders (web isLoading / error / no-trip / ready).</summary>
public enum TripDetailState
{
    /// <summary>The trip read is in flight with nothing to show — the loading skeleton.</summary>
    Loading,

    /// <summary>Resolved with no trip — the friendly "Trip not found" empty surface.</summary>
    Empty,

    /// <summary>The read failed — the retriable error surface.</summary>
    Error,

    /// <summary>A trip resolved — the full detail content.</summary>
    Success,
}

/// <summary>One projected headline stat tile (web <c>StatCard</c>) — WinUI-free so the projection stays testable.</summary>
public sealed record TripStatCardDisplay(string Label, string Value, string Glyph);

/// <summary>One projected key/value row inside the detail panel (web <c>KVList</c> item).</summary>
public sealed record TripKvRow(string Label, string Value);

/// <summary>
/// The fully-resolved, render-ready projection of <c>TripDetailPage</c> — every web region as pure data so the
/// WinUI view is a thin renderer and the projection is unit-tested without a UI host. The four-state flags drive
/// the top-level surfaces; <see cref="StatCards"/> are the four headline tiles (Distance, Energy Used, Efficiency,
/// Cost) and <see cref="DetailRows"/> are the six key/value rows of the detail glass panel.
/// </summary>
public sealed record TripDetailDisplay
{
    public required TripDetailState State { get; init; }
    public required string Title { get; init; }
    public required string Subtitle { get; init; }
    public required string AutomationName { get; init; }

    // ── Panels ──
    public required IReadOnlyList<TripStatCardDisplay> StatCards { get; init; }
    public required string DetailsAccessibleName { get; init; }
    public required IReadOnlyList<TripKvRow> DetailRows { get; init; }

    // ── State surfaces ──
    public required string ErrorText { get; init; }
    public required string RetryLabel { get; init; }
    public required string EmptyMessage { get; init; }

    public bool ShowLoading => State == TripDetailState.Loading;
    public bool ShowError => State == TripDetailState.Error;
    public bool ShowEmpty => State == TripDetailState.Empty;
    public bool ShowContent => State == TripDetailState.Success;

    /// <summary>True once a trip resolved — the success-only subtitle is rendered.</summary>
    public bool ShowSubtitle => ShowContent && Subtitle.Length > 0;
}

/// <summary>
/// The fully-resolved set of localized strings the page renders — every i18n key the web <c>TripDetailPage</c>
/// feeds into <c>t(...)</c> at the page level (the twelve manifest keys), resolved once through the i18n facade so
/// the projection stays readable and the string-coverage test can assert every manifest key in one pass.
/// </summary>
public sealed record TripDetailStrings
{
    public required string Title { get; init; }
    public required string Distance { get; init; }
    public required string Energy { get; init; }
    public required string Efficiency { get; init; }
    public required string Cost { get; init; }
    public required string TripId { get; init; }
    public required string Name { get; init; }
    public required string Started { get; init; }
    public required string Ended { get; init; }
    public required string Drives { get; init; }
    public required string Charges { get; init; }
    public required string NotFound { get; init; }

    /// <summary>Resolve every page-level string through the i18n facade (web key names, verbatim).</summary>
    public static TripDetailStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        return new TripDetailStrings
        {
            Title = localizer.GetString("trips.detail.title", "Trip Detail"),
            Distance = localizer.GetString("trips.detail.distance", "Distance"),
            Energy = localizer.GetString("trips.detail.energy", "Energy Used"),
            Efficiency = localizer.GetString("trips.detail.efficiency", "Efficiency"),
            Cost = localizer.GetString("trips.detail.cost", "Cost"),
            TripId = localizer.GetString("trips.detail.tripId", "Trip ID"),
            Name = localizer.GetString("trips.detail.name", "Name"),
            Started = localizer.GetString("trips.detail.started", "Started"),
            Ended = localizer.GetString("trips.detail.ended", "Ended"),
            Drives = localizer.GetString("trips.detail.drives", "Drives"),
            Charges = localizer.GetString("trips.detail.charges", "Charges"),
            NotFound = localizer.GetString("trips.detail.notFound", "Trip not found"),
        };
    }
}

/// <summary>
/// Pure projection from a <see cref="TripDetailModel"/> to its <see cref="TripDetailDisplay"/> — the native port
/// of web/src/features/trips/pages/TripDetailPage.tsx. It selects the four-state matrix, resolves every page-level
/// label through the i18n facade, reproduces the web subtitle (<c>name ?? "Trip #id"</c>), and assembles the four
/// headline stat cards and the six detail rows — every numeric formatted at the SI display boundary via
/// <see cref="UnitConverters"/> / <see cref="ScalarFormatters"/> with the active unit preference. No WinUI types so
/// the whole contract is unit-tested without a UI host.
/// </summary>
public static class TripDetailProjection
{
    private const string Dash = "\u2014";

    /// <summary>1 mile = 1.609344 km exactly — the web <c>KM_PER_MILE</c> efficiency factor (Wh/km → Wh/mi).</summary>
    private const double KmPerMile = 1.609344;

    /// <summary>Wh is read at the web global precision (2); fmtInt cards round to whole units (0); cost is 2.</summary>
    private const int EnergyPrecision = 2;
    private const int IntPrecision = 0;
    private const int CostPrecision = 2;

    private const string DistanceGlyph = "\uE804";   // Car
    private const string EnergyGlyph = "\uE945";     // Lightning
    private const string EfficiencyGlyph = "\uE9D9"; // Speed
    private const string CostGlyph = "\uE825";       // Currency

    /// <summary>Project <paramref name="model"/> into a render-ready display using the active units + localizer.</summary>
    /// <param name="model">The parsed single-source data plus the page lifecycle flags.</param>
    /// <param name="units">The user's unit-display preference (applied only at this boundary).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">Injectable clock for deterministic date formatting in tests.</param>
    /// <param name="currencySymbol">The settings currency symbol (web <c>useFormatting().currencySymbol</c>).</param>
    public static TripDetailDisplay Project(
        TripDetailModel model,
        UnitPref units,
        ILocalizer localizer,
        DateTimeOffset now,
        string currencySymbol)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        // Resolve every page-level string unconditionally so the manifest keys are requested in every state.
        TripDetailStrings s = TripDetailStrings.Resolve(localizer);
        TripDetailSnapshot snapshot = model.Snapshot;
        TripData? trip = snapshot.Trip;

        TripDetailState state =
            model.Loading && trip is null ? TripDetailState.Loading
            : model.ErrorDetail is not null ? TripDetailState.Error
            : trip is null ? TripDetailState.Empty
            : TripDetailState.Success;

        string loadFailed = localizer.GetString("error.loadFailed", "Failed to load data");
        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail)
            ? loadFailed
            : $"{loadFailed}: {model.ErrorDetail}";
        string retryLabel = localizer.GetString("common.retry", "Retry");

        string symbol = string.IsNullOrEmpty(currencySymbol) ? "$" : currencySymbol;
        string subtitle = trip is { } t ? SubtitleFor(t) : string.Empty;

        IReadOnlyList<TripStatCardDisplay> statCards = trip is { } sc
            ? BuildStatCards(sc, s, units, symbol)
            : Array.Empty<TripStatCardDisplay>();
        IReadOnlyList<TripKvRow> detailRows = trip is { } dr
            ? BuildDetailRows(dr, s, now)
            : Array.Empty<TripKvRow>();

        string automationName = subtitle.Length > 0 ? $"{s.Title}: {subtitle}" : s.Title;

        return new TripDetailDisplay
        {
            State = state,
            Title = s.Title,
            Subtitle = subtitle,
            AutomationName = automationName,
            StatCards = statCards,
            DetailsAccessibleName = s.Title,
            DetailRows = detailRows,
            ErrorText = errorText,
            RetryLabel = retryLabel,
            EmptyMessage = s.NotFound,
        };
    }

    /// <summary>The web subtitle: the trip name, or <c>Trip #id</c> when unnamed.</summary>
    private static string SubtitleFor(TripData trip) =>
        string.IsNullOrEmpty(trip.Name) ? $"Trip #{trip.Id.ToString(CultureInfo.InvariantCulture)}" : trip.Name!;

    private static List<TripStatCardDisplay> BuildStatCards(
        TripData trip, TripDetailStrings s, UnitPref units, string currencySymbol)
    {
        bool imperial = units.Distance == DistanceUnit.Mi;
        string distanceUnit = UnitLabels.Label(units.Distance);
        string efficiencyUnit = imperial ? "Wh/mi" : "Wh/km";

        double distanceDisplay = UnitConverters.DistanceFromSi(trip.TotalDistanceM, units.Distance);

        // web: whPerKm = distance_m > 0 ? energy_wh / (distance_m / 1000) : 0
        double whPerKm = trip.TotalDistanceM > 0
            ? trip.TotalEnergyWh / (trip.TotalDistanceM / 1000.0)
            : 0;
        double efficiencyDisplay = imperial ? whPerKm * KmPerMile : whPerKm;

        return new List<TripStatCardDisplay>
        {
            new(
                s.Distance,
                Stat(ScalarFormatters.FormatNumber(distanceDisplay, IntPrecision), distanceUnit),
                DistanceGlyph),
            new(
                s.Energy,
                Stat(ScalarFormatters.FormatNumber(trip.TotalEnergyWh, EnergyPrecision), "Wh"),
                EnergyGlyph),
            new(
                s.Efficiency,
                Stat(ScalarFormatters.FormatNumber(efficiencyDisplay, IntPrecision), efficiencyUnit),
                EfficiencyGlyph),
            new(
                s.Cost,
                $"{currencySymbol}{ScalarFormatters.FormatNumber(trip.TotalCost, CostPrecision)}",
                CostGlyph),
        };
    }

    private static List<TripKvRow> BuildDetailRows(TripData trip, TripDetailStrings s, DateTimeOffset now) =>
        new()
        {
            new(s.TripId, trip.Id.ToString(CultureInfo.InvariantCulture)),
            new(s.Name, string.IsNullOrEmpty(trip.Name) ? Dash : trip.Name!),
            new(s.Started, DateTimeFormatting.Format(trip.StartDate, DateTimeVariant.Date, now)),
            new(s.Ended, trip.EndDate is null ? Dash : DateTimeFormatting.Format(trip.EndDate, DateTimeVariant.Date, now)),
            new(s.Drives, trip.DriveCount.ToString(CultureInfo.InvariantCulture)),
            new(s.Charges, trip.ChargeCount.ToString(CultureInfo.InvariantCulture)),
        };

    /// <summary>Combine a formatted value with its display unit (web <c>StatCard value + unit</c>).</summary>
    private static string Stat(string value, string unit) =>
        string.IsNullOrEmpty(unit) ? value : $"{value} {unit}";
}

/// <summary>
/// Canonical registration metadata for the <c>TripDetailPage</c> surface — the shell route name, the diagnostics
/// slug, the generated-client operation id for the single read the web page performs
/// (<c>GET /trips/{trip_id}</c>) and the empty-surface glyph.
/// </summary>
public static class TripDetailPageRegistration
{
    /// <summary>The route / page-factory name the shell registers this page under (RouteTable <c>TripDetail</c>).</summary>
    public const string RouteName = "TripDetail";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "TripDetailPage";

    /// <summary>The trip-detail read — web <c>GET /trips/{id}</c> (returns Trip). Path param is <c>trip_id</c>.</summary>
    public const string DetailOperation = "get_api_v1_trips_trip_id";

    /// <summary>The <c>trip_id</c> path-parameter name on the generated endpoint.</summary>
    public const string TripIdParam = "trip_id";

    /// <summary>Segoe Fluent glyph for the page-level empty surface (Car).</summary>
    public const string EmptyGlyph = "\uE804";

    /// <summary>The localized page title (web <c>t('trips.detail.title')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("trips.detail.title", "Trip Detail");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>TripDetailPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a trip id, name or location — so a
/// diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class TripDetailPageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public TripDetailPageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TripDetailPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TripDetailPageRegistration.Slug}");
    }
}

/// <summary>
/// Tolerant <see cref="JsonElement"/> readers for the trip-detail parser (mirrors the sibling feature json
/// helpers). Every read is null-safe so a partial wire object never throws; numeric-strings are tolerated to match
/// the Go API's mixed scalar encoding.
/// </summary>
internal static class TripDetailJson
{
    /// <summary>Reads a numeric (or numeric-string) property, or null when absent / non-numeric / non-finite.</summary>
    public static double? Double(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    /// <summary>Reads a non-empty string property, or null when absent / non-string / blank.</summary>
    public static string? String(JsonElement obj, string name)
    {
        if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String)
        {
            string? str = v.GetString();
            return string.IsNullOrEmpty(str) ? null : str;
        }

        return null;
    }

    /// <summary>Reads an ISO-8601 timestamp property as a <see cref="DateTimeOffset"/>, or null when unparseable.</summary>
    public static DateTimeOffset? Date(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}
