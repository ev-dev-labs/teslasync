using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.IngestXRay;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The top-level data state the <c>IngestXRayPage</c> surfaces for its primary (ingest X-Ray) query — the
/// native discriminator for the three web data states the page exposes through its
/// <c>PageContainer query={xray}</c> freshness chip and the child surfaces
/// (web/src/features/admin/pages/IngestXRayPage.tsx). The web page never blanks the body — the children always
/// render (the XRayHeader em-dash tiles, the XRayBucketChart / XRayFieldsTable "Loading…" / empty bodies) — so
/// this enum drives only the page-tier indicator + the optional retryable error surface, never a hidden region.
/// It applies only once a vehicle is selected; with no vehicle the page shows the no-vehicle panel instead.
/// </summary>
public enum IngestXRayPageState
{
    /// <summary>The X-Ray query is in flight with no data yet (web <c>xray.isLoading</c>).</summary>
    Loading,

    /// <summary>The X-Ray query resolved with zero samples / fields / buckets (web zero-sample window).</summary>
    Empty,

    /// <summary>The X-Ray query resolved with sample data (web <c>xray.data</c>) — tiles, chart and table render content.</summary>
    Ready,

    /// <summary>The X-Ray query failed (web <c>xray.isError</c>) — show the InfoBar + Retry while the children stay visible.</summary>
    Error,
}

/// <summary>
/// The full per-vehicle ingest X-Ray payload the page reads — the native mirror of the web
/// <c>IngestXRayResponse</c> (web/src/types/admin-diagnostics.ts, sourced from
/// <c>internal/api/ingest_xray_handler.go</c>). It composes the three logical sections the web page fans out to
/// its child surfaces: the aggregate <see cref="Summary"/> (web <c>XRayHeader</c>), the bucketed sample-count
/// time-series <see cref="Buckets"/> (web <c>XRayBucketChart</c>), and the per-field statistics
/// <see cref="Fields"/> (web <c>XRayFieldsTable</c>). Pure data — no WinUI types — so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="Summary">The aggregate header slice (total samples / unique fields / echoed window).</param>
/// <param name="Buckets">The bucketed sample-count time-series for the chart (web <c>buckets</c>).</param>
/// <param name="Fields">The per-field statistics for the table (web <c>fields</c>).</param>
public sealed record IngestXRayPageData(
    IngestXRaySummary Summary,
    IReadOnlyList<XRayBucketPoint> Buckets,
    IReadOnlyList<IngestXRayFieldStat> Fields)
{
    /// <summary>An all-empty payload (the parse fallback for an absent / non-object body).</summary>
    public static IngestXRayPageData Empty { get; } = new(
        IngestXRaySummary.Empty,
        Array.Empty<XRayBucketPoint>(),
        Array.Empty<IngestXRayFieldStat>());

    /// <summary>True when the window carried no samples at all (web zero-sample empty treatment).</summary>
    public bool HasNoData => Summary.TotalSamples == 0 && Buckets.Count == 0 && Fields.Count == 0;
}

// ── Data ports (the two web hooks) ────────────────────────────────────────────────────────────────────────────────

/// <summary>
/// The ingest X-Ray page's read seam (P1/S8 state-holder layer) — the native port of the web page's two data
/// sources (web/src/features/admin/pages/IngestXRayPage.tsx): the <c>useVehicles</c> fleet list that fills the
/// vehicle picker, and the per-vehicle <c>useIngestXRay({ vehicleId, window, bucket, limit })</c> read that fills
/// the header tiles, the bucket chart and the fields table. Each source is fetched independently so the view-model
/// can mirror the web's selection gate (the X-Ray query is enabled only for a positive vehicle id) and its
/// per-source data states. The view never performs HTTP; the contract-client-backed
/// <see cref="IngestXRayPageClientFeed"/> (or a test fake) drives this.
/// </summary>
public interface IIngestXRayPageFeed
{
    /// <summary>Fetch the fleet list for the vehicle picker (web <c>useVehicles → GET /vehicles</c>).</summary>
    Task<IReadOnlyList<VehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Fetch the per-vehicle ingest X-Ray within <paramref name="window"/> at <paramref name="bucket"/>
    /// granularity, capping the field rows at <paramref name="limit"/> (web
    /// <c>useIngestXRay → GET /system/ingest-xray/{vehicleID}?window=&amp;bucket=&amp;limit=</c>).
    /// </summary>
    Task<IngestXRayPageData> FetchXRayAsync(
        int vehicleId,
        IngestXRayWindow window,
        IngestXRayBucket bucket,
        int limit,
        CancellationToken cancellationToken);
}

/// <summary>
/// The default feed — resolves to an empty fleet and an empty X-Ray (the empty data state, no HTTP). It backs the
/// page's parameterless construction (the sibling-W7 host-injection precedent) so the shell can register the
/// surface without a wired client; the generated-client-backed <see cref="IngestXRayPageClientFeed"/> replaces it
/// in production.
/// </summary>
public sealed class EmptyIngestXRayPageFeed : IIngestXRayPageFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyIngestXRayPageFeed Instance { get; } = new();

    private EmptyIngestXRayPageFeed()
    {
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<VehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<VehicleOption>>(Array.Empty<VehicleOption>());
    }

    /// <inheritdoc />
    public Task<IngestXRayPageData> FetchXRayAsync(
        int vehicleId,
        IngestXRayWindow window,
        IngestXRayBucket bucket,
        int limit,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(IngestXRayPageData.Empty);
    }
}

/// <summary>
/// Canonical metadata + localized literals for the <c>IngestXRayPage</c> feature surface — the native mirror of
/// the web page at <c>web/src/features/admin/pages/IngestXRayPage.tsx</c> (route <c>/admin/ingest-xray</c>, nav
/// name <c>IngestXRay</c>). Every visible literal resolves through the i18n facade using the same catalog keys the
/// web source feeds into <c>t()</c> (the Strings/{lang}/Resources.resw catalog stores them under the
/// <c>translation.</c> prefix); the English fallback is the web default verbatim. UI-free so the mapping is
/// asserted without a XAML host.
/// </summary>
public static class IngestXRayPageRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "IngestXRayPage";

    /// <summary>The navigation route name this page registers under (RouteTable <c>IngestXRay</c> → <c>admin/ingest-xray</c>).</summary>
    public const string RouteName = "IngestXRay";

    /// <summary>The generated OpenAPI operation id for the fleet query (web <c>useVehicles</c>, <c>GET /vehicles</c>).</summary>
    public const string VehiclesOperation = "get_api_v1_vehicles";

    /// <summary>The generated OpenAPI operation id for the X-Ray query (web <c>useIngestXRay</c>, <c>GET /system/ingest-xray/{vehicleID}</c>).</summary>
    public const string XRayOperation = "get_api_v1_system_ingest_xray_vehicleID";

    /// <summary>The <c>{vehicleID}</c> path-parameter name the X-Ray operation template declares.</summary>
    public const string VehiclePathParam = "vehicleID";

    /// <summary>The default <c>fields</c> row cap the page requests (web <c>limit: 100</c>).</summary>
    public const int DefaultLimit = 100;

    /// <summary>The page title (web key <c>admin.xray.pageTitle</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Get(localizer, "translation.admin.xray.pageTitle", "Ingest X-Ray");

    /// <summary>The page subtitle (web key <c>admin.xray.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer) =>
        Get(localizer, "translation.admin.xray.subtitle",
            "Per-vehicle telemetry sample counts \u2014 pick a vehicle to inspect what the ingest pipeline is receiving.");

    /// <summary>The field-statistics panel title (web key <c>admin.xray.panels.fields</c>).</summary>
    public static string PanelFields(ILocalizer localizer) =>
        Get(localizer, "translation.admin.xray.panels.fields", "Field statistics");

    /// <summary>The no-vehicle empty-state title (web key <c>admin.xray.noVehicle.title</c>).</summary>
    public static string NoVehicleTitle(ILocalizer localizer) =>
        Get(localizer, "translation.admin.xray.noVehicle.title", "Select a vehicle");

    /// <summary>The no-vehicle empty-state message (web key <c>admin.xray.noVehicle.message</c>).</summary>
    public static string NoVehicleMessage(ILocalizer localizer) =>
        Get(localizer, "translation.admin.xray.noVehicle.message",
            "Pick a vehicle from the dropdown above to load its ingest X-Ray for the selected window.");

    /// <summary>The retry affordance label for the X-Ray-error surface (web PageContainer query retry).</summary>
    public static string RetryLabel(ILocalizer localizer) =>
        Get(localizer, "translation.common.retry", "Retry");

    /// <summary>The X-Ray-error surface message (web PageContainer query error).</summary>
    public static string LoadErrorMessage(ILocalizer localizer) =>
        Get(localizer, "translation.admin.xray.errors.loadFailed", "Couldn't load the ingest X-Ray for this vehicle.");

    private static string Get(ILocalizer localizer, string key, string fallback)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(key, fallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>IngestXRayPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a vehicle id, window, bucket, field name or
/// sample count — so a diagnostics line can never leak which vehicle an operator inspected. Thread-safe.
/// </summary>
public sealed class IngestXRayPageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public IngestXRayPageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=IngestXRayPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={IngestXRayPageRegistration.Slug}");
    }
}
