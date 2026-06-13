using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Sharing;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="SharingTripsPageViewModel"/> renders for its single
/// data source (the web page's <c>useTrips({ vehicle_id, limit: 20 })</c> hook,
/// web/src/features/sharing/pages/SharingTripsPage.tsx). It is the native union of the recent-trips panel's
/// three web branches — <c>isLoading ? &lt;Skeleton…&gt; : allTrips.length === 0 ? &lt;EmptyState&gt; :
/// &lt;ul&gt;…</c>. Every branch maps onto a visible region inside GlassPanel1; none is ever blank. Faithful
/// to the web page (which surfaces no dedicated trips-error UI — a failed query simply leaves the list empty),
/// a hard transport failure with no cached rows folds into <see cref="Empty"/>.
/// </summary>
public enum SharingTripsState
{
    /// <summary>Initial fetch with no cached trips — render the skeleton rows.</summary>
    Loading,

    /// <summary>At least one shareable trip resolved — render the selectable recent-trips list.</summary>
    Success,

    /// <summary>The query resolved with no trips (or failed with no cache) — render the friendly empty state.</summary>
    Empty,
}

/// <summary>
/// One trip projected from the trip list (web <c>Trip</c> in web/src/api/types.ts). Only the fields the web
/// SharingTripsPage reads are kept: the optional human <c>name</c>, the <c>start_date</c> / <c>end_date</c>
/// instants (for the date label and the duration), the SI distance in meters (<c>total_distance_m</c>), the
/// <c>drive_count</c> segment tally, and the SI energy in watt-hours (<c>total_energy_wh</c>). Field names
/// mirror the Go API's snake_case JSON tags; parsing is null-tolerant so a partial row never throws.
/// </summary>
/// <param name="Id">The trip id (web <c>trip.id</c>).</param>
/// <param name="Name">The human trip name, or null (web <c>trip.name</c>).</param>
/// <param name="StartInstant">Parsed <c>start_date</c> instant (date label + duration start), or null.</param>
/// <param name="EndInstant">Parsed <c>end_date</c> instant (duration end), or null.</param>
/// <param name="TotalDistanceM">Total distance travelled in meters (web <c>total_distance_m</c>).</param>
/// <param name="DriveCount">Number of drive segments (web <c>trip.drive_count</c>).</param>
/// <param name="TotalEnergyWh">Total energy used in watt-hours (web <c>total_energy_wh</c>).</param>
public sealed record SharingTrip(
    long Id,
    string? Name,
    DateTimeOffset? StartInstant,
    DateTimeOffset? EndInstant,
    double TotalDistanceM,
    long DriveCount,
    double TotalEnergyWh)
{
    /// <summary>Parse a trip-list JSON array into a tolerant list of rows, preserving server order.</summary>
    /// <param name="element">The parsed <c>GET /trips</c> body.</param>
    /// <returns>The parsed rows (empty when the body is not an array).</returns>
    public static IReadOnlyList<SharingTrip> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SharingTrip>();
        }

        var list = new List<SharingTrip>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single trip JSON object into a tolerant row.</summary>
    /// <param name="obj">One trip object from the list.</param>
    /// <returns>The parsed, null-tolerant row.</returns>
    public static SharingTrip FromJson(JsonElement obj) => new(
        GetLong(obj, "id"),
        GetString(obj, "name"),
        GetDateTime(obj, "start_date"),
        GetDateTime(obj, "end_date"),
        GetDouble(obj, "total_distance_m") ?? 0,
        (long)Math.Round(GetDouble(obj, "drive_count") ?? 0, MidpointRounding.AwayFromZero),
        GetDouble(obj, "total_energy_wh") ?? 0);

    private static long GetLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return 0;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => 0,
        };
    }

    private static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
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

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static DateTimeOffset? GetDateTime(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var dt)
            ? dt
            : null;
    }
}

/// <summary>
/// One projected, display-ready recent-trip row the WinUI view binds to — the native analogue of a single
/// <c>&lt;li&gt;&lt;button role="option"&gt;</c> in the web recent-trips list. Holds the resolved name, the
/// short date label, the duration label, the "{n} drives" segment text, the unit-converted distance, the
/// watt-hour energy, and a Narrator automation name. Pure data — no WinUI types — so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="Id">The trip id (selection key; web <c>trip.id</c>).</param>
/// <param name="Name">Resolved trip name or the "Trip #{id}" fallback (web <c>trip.name ?? `Trip #…`</c>).</param>
/// <param name="DateText">Short start-date label (web <c>formatDate(trip.start_date)</c>).</param>
/// <param name="DurationText">Duration label (web <c>formatDuration(start, end)</c>), or the em-dash.</param>
/// <param name="DrivesText">Drive-segment tally text (web <c>{{count}} drives</c>).</param>
/// <param name="DistanceText">Display-unit distance (web <c>fmtInt(convertDistanceFromSI(…)) + unit</c>).</param>
/// <param name="EnergyText">Watt-hour energy (web <c>fmtNumber(total_energy_wh) + " Wh"</c>).</param>
/// <param name="AutomationName">Narrator name folding the row labels together.</param>
public sealed record SharingTripRow(
    long Id,
    string Name,
    string DateText,
    string DurationText,
    string DrivesText,
    string DistanceText,
    string EnergyText,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the SharingTrips page for one trip list + state — the native
/// analogue of everything the web component computes before returning JSX. Carries the active
/// <see cref="State"/>, the projected recent-trip rows (success only), and every localized literal the page
/// renders (header title/subtitle, the recent-trips heading + empty message, and the static-hint
/// heading/body), so the view is a thin renderer and the tests assert every string + state through this model.
/// </summary>
/// <param name="State">The current recent-trips lifecycle state.</param>
/// <param name="Rows">The projected recent-trip rows (non-empty only in <see cref="SharingTripsState.Success"/>).</param>
/// <param name="Title">The page title (web <c>sharing.trips.title</c>).</param>
/// <param name="Subtitle">The page sub-heading (web <c>sharing.trips.subtitle</c>).</param>
/// <param name="RecentHeading">The recent-trips panel heading (web <c>sharing.trips.recent.heading</c>).</param>
/// <param name="EmptyMessage">The empty-state message (web <c>sharing.trips.recent.empty</c>).</param>
/// <param name="StaticHintHeading">The static-share-card heading (web <c>sharing.trips.staticHint.heading</c>).</param>
/// <param name="StaticHintBody">The static-share-card body (web <c>sharing.trips.staticHint.body</c>).</param>
public sealed record SharingTripsDisplay(
    SharingTripsState State,
    IReadOnlyList<SharingTripRow> Rows,
    string Title,
    string Subtitle,
    string RecentHeading,
    string EmptyMessage,
    string StaticHintHeading,
    string StaticHintBody)
{
    /// <summary>True when the success list is shown (web truthy <c>allTrips.length &gt; 0</c>).</summary>
    public bool HasRows => State == SharingTripsState.Success && Rows.Count > 0;
}

/// <summary>
/// Pure projection from the parsed trip list + lifecycle state to the render-ready
/// <see cref="SharingTripsDisplay"/> — the native port of the recent-trips row mapping, the SI→display distance
/// conversion, the watt-hour energy readout, the date label, and the custom duration formatter in
/// web/src/features/sharing/pages/SharingTripsPage.tsx. Distances are converted from SI meters to the user's
/// display unit exactly as the web <c>convertDistanceFromSI</c> does (and only here); the duration mirrors the
/// page's own <c>formatDuration(start, end)</c>. Every literal resolves through the i18n facade with the web
/// key names and verbatim English defaults. Kept pure (no WinUI types) so it is unit-tested headlessly.
/// </summary>
public static class SharingTripsProjection
{
    /// <summary>How many trips the page fetches (web <c>useTrips({ limit: 20 })</c>).</summary>
    public const int FetchLimit = 20;

    private const string EmDash = "\u2014";
    private const double MillisecondsPerHour = 3_600_000.0;
    private const double MillisecondsPerMinute = 60_000.0;

    /// <summary>Project <paramref name="trips"/> for <paramref name="state"/> using the user's distance unit.</summary>
    /// <param name="trips">The parsed trip list (server order).</param>
    /// <param name="state">The resolved lifecycle state.</param>
    /// <param name="units">The user's unit preference (web <c>unitPrefs</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The clock used for any relative formatting (date labels are absolute).</param>
    /// <returns>The render-ready display model.</returns>
    public static SharingTripsDisplay Project(
        IReadOnlyList<SharingTrip> trips,
        SharingTripsState state,
        UnitPref units,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(trips);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        IReadOnlyList<SharingTripRow> rows = state == SharingTripsState.Success
            ? BuildRows(trips, units, localizer, now)
            : Array.Empty<SharingTripRow>();

        return new SharingTripsDisplay(
            State: state,
            Rows: rows,
            Title: Title(localizer),
            Subtitle: Subtitle(localizer),
            RecentHeading: RecentHeading(localizer),
            EmptyMessage: EmptyMessage(localizer),
            StaticHintHeading: StaticHintHeading(localizer),
            StaticHintBody: StaticHintBody(localizer));
    }

    /// <summary>The localized page title (web <c>sharing.trips.title</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized title.</returns>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("sharing.trips.title", "Share a trip");
    }

    /// <summary>The localized page sub-heading (web <c>sharing.trips.subtitle</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized subtitle.</returns>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "sharing.trips.subtitle",
            "Pick a recent trip to share as a static link, postcard, or image.");
    }

    /// <summary>The localized recent-trips heading (web <c>sharing.trips.recent.heading</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized heading.</returns>
    public static string RecentHeading(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("sharing.trips.recent.heading", "Recent trips");
    }

    /// <summary>The localized empty-state message (web <c>sharing.trips.recent.empty</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized message.</returns>
    public static string EmptyMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "sharing.trips.recent.empty",
            "No recent trips. Drive your vehicle to populate this list.");
    }

    /// <summary>The localized static-share-card heading (web <c>sharing.trips.staticHint.heading</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized heading.</returns>
    public static string StaticHintHeading(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("sharing.trips.staticHint.heading", "Static share cards");
    }

    /// <summary>The localized static-share-card body (web <c>sharing.trips.staticHint.body</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized body.</returns>
    public static string StaticHintBody(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "sharing.trips.staticHint.body",
            "Every drive in TeslaSync can be published as a static, redacted share card from the drive detail "
            + "page. Open a drive, click \"Share\", and copy the public link \u2014 anyone with the link can view "
            + "the static card, no AI required.");
    }

    /// <summary>
    /// Format the trip duration exactly as the web page's own <c>formatDuration(startDate, endDate)</c>: the
    /// em-dash for a missing end (or unparseable endpoints), "{m}m" when under an hour, "{h}h {m}m" when the
    /// rounded minutes reach a half-minute, otherwise "{h}h".
    /// </summary>
    /// <param name="start">The trip start instant.</param>
    /// <param name="end">The trip end instant, or null.</param>
    /// <returns>The formatted duration label.</returns>
    public static string FormatDuration(DateTimeOffset? start, DateTimeOffset? end)
    {
        if (start is not { } s || end is not { } e)
        {
            return EmDash;
        }

        double ms = (e - s).TotalMilliseconds;
        if (double.IsNaN(ms) || double.IsInfinity(ms))
        {
            return EmDash;
        }

        long hours = (long)Math.Floor(ms / MillisecondsPerHour);
        double minsRaw = ms % MillisecondsPerHour / MillisecondsPerMinute;
        if (hours == 0)
        {
            return ScalarFormatters.FormatNumber(minsRaw, 0) + "m";
        }

        return minsRaw >= 0.5
            ? string.Create(CultureInfo.InvariantCulture, $"{hours}h ") + ScalarFormatters.FormatNumber(minsRaw, 0) + "m"
            : string.Create(CultureInfo.InvariantCulture, $"{hours}h");
    }

    /// <summary>Format an SI-meters distance as "{value} {unit}" (web <c>fmtInt(convertDistanceFromSI(…)) + unit</c>).</summary>
    /// <param name="meters">The SI distance in meters.</param>
    /// <param name="units">The user's unit preference.</param>
    /// <returns>The display distance with its unit label.</returns>
    public static string FormatDistance(double meters, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(units);
        double value = UnitConverters.DistanceFromSi(meters, units.Distance);
        return ScalarFormatters.FormatNumber(value, 0) + " " + UnitLabels.Label(units.Distance);
    }

    /// <summary>Format an SI watt-hour energy as "{value} Wh" (web <c>fmtNumber(total_energy_wh) + " Wh"</c>).</summary>
    /// <param name="wattHours">The SI energy in watt-hours.</param>
    /// <returns>The watt-hour readout.</returns>
    public static string FormatEnergy(double wattHours) =>
        ScalarFormatters.FormatNumber(wattHours, 0) + " Wh";

    /// <summary>Resolve a trip's display name, falling back to "Trip #{id}" (web <c>trip.name ?? `Trip #…`</c>).</summary>
    /// <param name="name">The raw trip name, or null.</param>
    /// <param name="id">The trip id used in the fallback.</param>
    /// <param name="localizer">The i18n facade resolving the "Trip" label.</param>
    /// <returns>The resolved name.</returns>
    public static string ResolveName(string? name, long id, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        if (!string.IsNullOrWhiteSpace(name))
        {
            return name;
        }

        string tripWord = localizer.GetString("sharing.trips.row.trip", "Trip");
        return string.Create(CultureInfo.InvariantCulture, $"{tripWord} #{id}");
    }

    /// <summary>Format the "{n} drives" segment tally (web <c>t('sharing.trips.row.drives', '{{count}} drives')</c>).</summary>
    /// <param name="driveCount">The number of drive segments.</param>
    /// <param name="localizer">The i18n facade resolving the count template.</param>
    /// <returns>The localized drive-count text.</returns>
    public static string DrivesText(long driveCount, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        string template = localizer.GetString("sharing.trips.row.drives", "{0} drives");
        return string.Format(CultureInfo.CurrentCulture, template, driveCount);
    }

    private static List<SharingTripRow> BuildRows(
        IReadOnlyList<SharingTrip> trips, UnitPref units, ILocalizer localizer, DateTimeOffset now)
    {
        var rows = new List<SharingTripRow>(trips.Count);
        foreach (var trip in trips)
        {
            string name = ResolveName(trip.Name, trip.Id, localizer);
            string dateText = DateTimeFormatting.Format(trip.StartInstant, DateTimeVariant.Date, now);
            string durationText = FormatDuration(trip.StartInstant, trip.EndInstant);
            string drivesText = DrivesText(trip.DriveCount, localizer);
            string distanceText = FormatDistance(trip.TotalDistanceM, units);
            string energyText = FormatEnergy(trip.TotalEnergyWh);
            string automationName = string.Join(", ", name, dateText, durationText, drivesText, distanceText, energyText);
            rows.Add(new SharingTripRow(trip.Id, name, dateText, durationText, drivesText, distanceText, energyText, automationName));
        }

        return rows;
    }
}

/// <summary>
/// Static identity + i18n helpers for the Trip Sharing page (web
/// <c>web/src/features/sharing/pages/SharingTripsPage.tsx</c>, route <c>/sharing/trips</c>, nav name
/// <c>SharingTrips</c>). The shell page factory binds the view under <see cref="RouteName"/>.
/// </summary>
public static class SharingTripsRegistration
{
    /// <summary>The shell route name (matches <c>RouteTable</c> Page("SharingTrips", "sharing/trips", …)).</summary>
    public const string RouteName = "SharingTrips";

    /// <summary>The web route path the page mirrors.</summary>
    public const string Route = "sharing/trips";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SharingTripsPage";

    /// <summary>The shared cache key prefix for the vehicle-scoped recent-trips read.</summary>
    public const string CacheKeyPrefix = "sharing:trips";

    /// <summary>The deep link the copy-link affordance writes (the native analogue of <c>window.location.href</c>).</summary>
    public const string CopyLink = "teslasync://sharing/trips";

    /// <summary>The AI feature id gating the trip-postcard drafter (web <c>withAiFeature(...)</c> id).</summary>
    public const string AiFeatureId = "trip-postcard-share-card-image-generation";

    /// <summary>Segoe Fluent "MapDirections" glyph mirroring the web lucide <c>Route</c> icon for the empty state.</summary>
    public const string RouteGlyph = "\uE816";
}

/// <summary>
/// PII-safe diagnostics for the Trip Sharing surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a trip name, distance, date, energy or
/// vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class SharingTripsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to (null discards).</param>
    public SharingTripsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SharingTripsPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SharingTripsRegistration.Slug}");
    }
}

/// <summary>
/// The data port the <see cref="SharingTripsPageViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed recent-trip lists — the native analogue of the web page's
/// <c>useTrips({ vehicle_id, limit: 20 })</c> hook. The view never performs HTTP itself; the concrete
/// <see cref="SharingTripsSource"/> (or a test fake) drives this.
/// </summary>
public interface ISharingTripsSource
{
    /// <summary>Stream the cache-then-network recent-trip snapshots, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read when a newer load supersedes it.</param>
    /// <returns>The ordered cache-then-network emissions for one logical read.</returns>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<SharingTrip>>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The default <see cref="ISharingTripsSource"/> — resolves every read to the empty list (the empty data
/// state). The shell registration uses this until a host wires the generated-client-backed
/// <see cref="SharingTripsSource"/> via <see cref="SharingTripsPage.Create"/>.
/// </summary>
public sealed class EmptySharingTripsSource : ISharingTripsSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptySharingTripsSource Instance { get; } = new();

    private EmptySharingTripsSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<SharingTrip>>> StreamAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<IReadOnlyList<SharingTrip>>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}
