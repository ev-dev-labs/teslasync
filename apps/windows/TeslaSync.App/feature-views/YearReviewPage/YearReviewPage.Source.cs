using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Review;

/// <summary>
/// The data port the <see cref="YearReviewPageViewModel"/> reads through — the native parity of the web page's
/// two hooks (web/src/features/analytics/pages/YearReviewPage.tsx): <c>useVehicles()</c> (GET /vehicles) to
/// populate the vehicle selector and auto-select the first vehicle, and <c>useYearReview(year, vehicleId)</c>
/// (GET /analytics/year-review) to resolve the story-deck payload. The view never performs HTTP itself; the
/// default <see cref="EmptyYearReviewPageFeed"/> resolves to the empty state, and the generated-client-backed
/// <see cref="YearReviewPageClientFeed"/> binds to the generated OpenAPI contract client (ADR-004). A failing
/// fetch throws so the view-model can surface the never-blank error branch (InfoBar + Retry).
/// </summary>
public interface IYearReviewPageFeed
{
    /// <summary>Resolve the user's vehicles for the selector (web <c>useVehicles()</c>).</summary>
    Task<IReadOnlyList<YearReviewVehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the year-review payload for a vehicle + year (web <c>useYearReview(year, vehicleId)</c>).</summary>
    Task<YearReviewReport> FetchYearReviewAsync(int year, long vehicleId, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves to no vehicles and an empty review (the loading/empty data state in the shell).</summary>
public sealed class EmptyYearReviewPageFeed : IYearReviewPageFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyYearReviewPageFeed Instance { get; } = new();

    private EmptyYearReviewPageFeed()
    {
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<YearReviewVehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<YearReviewVehicleOption>>(Array.Empty<YearReviewVehicleOption>());
    }

    /// <inheritdoc />
    public Task<YearReviewReport> FetchYearReviewAsync(int year, long vehicleId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(YearReviewReport.Empty);
    }
}

/// <summary>
/// The generated-client-backed <see cref="IYearReviewPageFeed"/> — the native data adapter for the
/// Year-in-Review page. It binds to the generated OpenAPI contract client (ADR-004):
/// <c>GET /vehicles</c> (generated operation <c>get_api_v1_vehicles</c>) for the vehicle list, and
/// <c>GET /analytics/year-review</c> (generated operation <c>get_api_v1_analytics_year_review</c>) for the
/// review, passing the snake_case <c>year</c> and <c>vehicle_id</c> query parameters exactly as the web hook
/// does. No HTTP touches the view; each response round-trips through the tolerant
/// <see cref="YearReviewReport"/> / <see cref="YearReviewVehicleOption"/> parsers so the snake_case wire shape
/// (and the platform <c>{data:…}</c> envelope) is preserved losslessly. A non-success response surfaces as the
/// client's <see cref="ApiException"/> so the view-model can render the error branch.
/// </summary>
public sealed class YearReviewPageClientFeed : IYearReviewPageFeed
{
    private const string YearQueryParam = "year";
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public YearReviewPageClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<YearReviewVehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(Operations.Vehicles.List);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ParseVehicles(json);
    }

    /// <inheritdoc />
    public async Task<YearReviewReport> FetchYearReviewAsync(int year, long vehicleId, CancellationToken cancellationToken)
    {
        var query = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            [YearQueryParam] = year,
            [VehicleQueryParam] = vehicleId,
        };

        var request = new ApiRequest(Operations.Analytics.YearReview, Query: query);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return YearReviewReport.FromJson(json);
    }

    /// <summary>
    /// Parse the vehicles response, tolerating the platform <c>{data:[…]}</c> envelope and a bare array, and
    /// dropping any non-object / id-less row (the web <c>useVehicles</c> list shape).
    /// </summary>
    private static IReadOnlyList<YearReviewVehicleOption> ParseVehicles(JsonElement root)
    {
        JsonElement arr = root;
        if (root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty("data", out var data))
        {
            arr = data;
        }

        if (arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<YearReviewVehicleOption>();
        }

        var vehicles = new List<YearReviewVehicleOption>(arr.GetArrayLength());
        foreach (var element in arr.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var option = YearReviewVehicleOption.FromJson(element);
            if (option.Id != 0)
            {
                vehicles.Add(option);
            }
        }

        return vehicles;
    }
}

/// <summary>
/// The canonical slide deck the Year-in-Review story player iterates — the native, ordered mirror of the web
/// <c>SLIDE_DEFS</c> (web/src/features/analytics/components/review/slides.ts): the twelve <c>{ type, bg, field }</c>
/// descriptors in the exact same order, so <c>SlideRenderer</c> dispatches each kind and paints the same
/// <c>bg-gradient-to-br</c> gradient the web deck shows. UI-free so the order is asserted without a UI host.
/// </summary>
public static class YearReviewSlideDeck
{
    /// <summary>The twelve ordered slide descriptors (web <c>SLIDE_DEFS</c>).</summary>
    public static IReadOnlyList<SlideDescriptor> Slides { get; } = new[]
    {
        new SlideDescriptor("title", "from-blue-900 via-indigo-900 to-slate-900"),
        new SlideDescriptor("stat-hero", "from-emerald-900 via-green-900 to-teal-900", "distance"),
        new SlideDescriptor("stat-chart", "from-purple-900 via-violet-900 to-indigo-900", "drives"),
        new SlideDescriptor("drive-highlight", "from-amber-900 via-orange-900 to-yellow-900", "longest"),
        new SlideDescriptor("stat-hero", "from-cyan-900 via-sky-900 to-blue-900", "energy"),
        new SlideDescriptor("charging-breakdown", "from-orange-900 via-red-900 to-pink-900"),
        new SlideDescriptor("savings", "from-emerald-900 via-teal-900 to-cyan-900"),
        new SlideDescriptor("environment", "from-green-900 via-emerald-900 to-lime-900"),
        new SlideDescriptor("patterns", "from-indigo-900 via-blue-900 to-violet-900"),
        new SlideDescriptor("drive-highlight", "from-teal-900 via-cyan-900 to-sky-900", "efficient"),
        new SlideDescriptor("comparisons", "from-pink-900 via-rose-900 to-fuchsia-900"),
        new SlideDescriptor("summary", "from-blue-900 via-indigo-900 to-purple-900"),
    };

    /// <summary>The number of slides in the deck (web <c>slides.length</c>).</summary>
    public static int Count => Slides.Count;
}
