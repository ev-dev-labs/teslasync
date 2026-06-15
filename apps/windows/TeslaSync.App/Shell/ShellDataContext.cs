using System;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using TeslaSync.App.Auth;
using TeslaSync.App.Core.Auth;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Cache;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;
using Windows.Storage;

namespace TeslaSync.App.Shell;

/// <summary>
/// The shared REST data services composed once at launch (P2 data-wiring) and handed to
/// <see cref="ShellWindow"/> so it can register data-backed page factories. Mirrors the
/// manual composition <c>AppPush</c> already uses: a single <see cref="HttpClient"/> through
/// the W4 auth handler, the generated contract client, and the W5 cache-then-network engine.
/// SSE (W6) is intentionally not composed here yet — REST data first.
/// </summary>
/// <remarks>
/// The generated client rides the auth handler (bearer attach + 401 refresh-and-retry); the
/// backend tolerates an absent token, so reads still resolve for an anonymous session. The
/// API origin follows <see cref="ApiClientOptions"/> defaults (the compiled
/// <c>DefaultApiBaseUrl</c>), so a deployment override flows through without touching this seam.
/// </remarks>
public sealed class ShellDataContext
{
    /// <summary>The generated OpenAPI contract client (rides the auth + socket handler chain).</summary>
    public required IApiClient Api { get; init; }

    /// <summary>The shared cache-then-network read engine every repository-backed source streams through.</summary>
    public required CacheThenNetworkEngine Engine { get; init; }

    /// <summary>The shared API client options (origin, version base path, JSON contract).</summary>
    public required ApiClientOptions Options { get; init; }

    /// <summary>The pin store backing list-page "pin to top" affordances.</summary>
    public required IPinStore Pins { get; init; }

    /// <summary>The vehicle scope source (the native analogue of the web <c>useSelectedVehicle</c>).</summary>
    public required IWidgetVehicleSource Vehicles { get; init; }

    /// <summary>The shared shell resource localizer every page resolves labels through.</summary>
    public required ILocalizer Localizer { get; init; }

    /// <summary>
    /// The active (primary) vehicle id for pages that bind a single-vehicle feed. Defaults to
    /// the seeded primary and is refined by <see cref="WarmAsync"/> once the vehicle list resolves.
    /// </summary>
    public long PrimaryVehicleId { get; private set; } = 1;

    /// <summary>Composes the REST data layer against the configured API origin.</summary>
    public static ShellDataContext Create()
    {
        var options = new ApiClientOptions();

        var http = new HttpClient(
            new AuthHttpHandler(AppAuth.Service.AsTokenProvider(), new HttpClientHandler()))
        {
            BaseAddress = options.BaseAddress,
        };

        var api = new GeneratedApiClient(http, options);
        var cache = CreateCache();

        return new ShellDataContext
        {
            Api = api,
            Engine = new CacheThenNetworkEngine(cache),
            Options = options,
            Pins = new InMemoryPinStore(),
            Vehicles = new CacheWidgetVehicleSource(cache, options.Json),
            Localizer = ShellLocalizer.Instance,
        };
    }

    /// <summary>
    /// Populates the vehicle-scope cache (<c>vehicles:list</c>) once at startup so the
    /// vehicle-scoped pages (Drives / Charging / Trips) resolve the active vehicle without
    /// first visiting the Vehicles page. Best-effort: a failure leaves those pages on their
    /// honest empty state (the cache-then-network engine retries on the next read).
    /// </summary>
    public async Task WarmAsync()
    {
        try
        {
            var source = new FeatureViews.Vehicles.VehicleListSource(Api, Engine, Options);
            await foreach (var _ in source.StreamAsync().ConfigureAwait(false))
            {
                // Consume the full stream so the network result is written to the shared cache.
            }

            // Resolve the primary vehicle id for single-vehicle feed pages (Battery, etc.).
            var primary = await Vehicles.GetPrimaryAsync().ConfigureAwait(false);
            if (primary is not null && primary.VehicleId > 0)
            {
                PrimaryVehicleId = primary.VehicleId;
            }
        }
        catch (Exception)
        {
            // Warm-up is best-effort; vehicle-scoped pages fall back to their empty state.
        }
    }

    /// <summary>
    /// Opens the durable SQLite read cache in the package LocalState folder. Falls back to a
    /// process-local in-memory store if the on-disk cache cannot be provisioned so live pages
    /// keep working (the cache-then-network engine treats a missing cache as a network-only read).
    /// </summary>
    private static ICacheStore CreateCache()
    {
        try
        {
            var path = Path.Combine(ApplicationData.Current.LocalFolder.Path, "teslasync-shell-cache.db");
            var sqlite = new SqliteCacheStore(new CacheOptions { ConnectionString = $"Data Source={path}" });
            sqlite.InitializeAsync().GetAwaiter().GetResult();
            return sqlite;
        }
        catch (Exception)
        {
            return new FeatureViews.Admin.DevToolsMemoryCacheStore();
        }
    }
}
