using Microsoft.Extensions.DependencyInjection;
using TeslaSync.App.Core.Auth;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Cache;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.Repositories;

namespace TeslaSync.App.Core.Data;

/// <summary>Configuration surface for <see cref="DataServiceCollectionExtensions.AddTeslaSyncData"/>.</summary>
public sealed class TeslaSyncDataOptions
{
    /// <summary>The API origin (scheme + host[:port]).</summary>
    public Uri BaseAddress { get; set; } = new("https://teslasync.local", UriKind.Absolute);

    /// <summary>The version segment applied once to versioned endpoints.</summary>
    public string VersionBasePath { get; set; } = "/api/v1";

    /// <summary>The SQLite connection string for the offline cache (never contains credentials).</summary>
    public string CacheConnectionString { get; set; } = "Data Source=teslasync-cache.db";

    /// <summary>The maximum number of cached rows before bounded eviction kicks in.</summary>
    public int MaxCacheEntries { get; set; } = 500;

    /// <summary>The retry/backoff policy applied by the resilience handler.</summary>
    public RetryPolicy RetryPolicy { get; set; } = RetryPolicy.Default;

    /// <summary>Consecutive failures before the circuit breaker trips.</summary>
    public int CircuitFailureThreshold { get; set; } = 5;

    /// <summary>How long the circuit stays open before allowing a probe.</summary>
    public TimeSpan CircuitOpenDuration { get; set; } = TimeSpan.FromSeconds(30);

    /// <summary>
    /// Optional redacting diagnostics sink. Lines are already passed through
    /// <c>TokenRedaction</c> before they reach this callback.
    /// </summary>
    public Action<string>? Diagnostics { get; set; }
}

/// <summary>
/// Composition root for the Windows data layer (P2/W5-0001). Wires the generated
/// contract client through DI together with the W4 auth handler, the resilience
/// (retry + circuit) handler, the SQLite cache and every domain repository.
/// </summary>
public static class DataServiceCollectionExtensions
{
    /// <summary>HTTP client name used for the contract client pipeline.</summary>
    public const string HttpClientName = "teslasync-api";

    /// <summary>
    /// Registers the data layer. The caller must also register an
    /// <see cref="ITokenProvider"/> (from W4 <c>AuthService.AsTokenProvider</c>) so the
    /// auth handler can attach and refresh bearer tokens.
    /// </summary>
    public static IServiceCollection AddTeslaSyncData(
        this IServiceCollection services,
        Action<TeslaSyncDataOptions>? configure = null)
    {
        ArgumentNullException.ThrowIfNull(services);

        var options = new TeslaSyncDataOptions();
        configure?.Invoke(options);

        services.AddSingleton(new ApiClientOptions
        {
            BaseAddress = options.BaseAddress,
            VersionBasePath = options.VersionBasePath,
        });

        services.AddSingleton(new CacheOptions
        {
            ConnectionString = options.CacheConnectionString,
            MaxEntries = options.MaxCacheEntries,
        });

        services.AddSingleton<ICacheStore>(sp => new SqliteCacheStore(sp.GetRequiredService<CacheOptions>()));
        services.AddSingleton(sp => new CacheThenNetworkEngine(sp.GetRequiredService<ICacheStore>()));

        services.AddSingleton(options.RetryPolicy);
        services.AddSingleton(_ => new CircuitBreaker(options.CircuitFailureThreshold, options.CircuitOpenDuration));

        // Auth handler (W4) and resilience handler are transient per-pipeline.
        services.AddTransient(sp => new AuthHttpHandler(sp.GetRequiredService<ITokenProvider>()));
        services.AddTransient(sp => new ResilienceHandler(
            sp.GetRequiredService<RetryPolicy>(),
            sp.GetRequiredService<CircuitBreaker>()));

        // Pipeline order: ResilienceHandler (outermost) → AuthHttpHandler → socket handler,
        // so a retried request re-runs auth and re-attaches a fresh token.
        services
            .AddHttpClient(HttpClientName, client => client.BaseAddress = options.BaseAddress)
            .AddHttpMessageHandler<ResilienceHandler>()
            .AddHttpMessageHandler<AuthHttpHandler>();

        services.AddSingleton<IApiClient>(sp =>
        {
            var factory = sp.GetRequiredService<IHttpClientFactory>();
            return new GeneratedApiClient(
                factory.CreateClient(HttpClientName),
                sp.GetRequiredService<ApiClientOptions>(),
                options.Diagnostics);
        });

        AddRepositories(services);
        return services;
    }

    private static void AddRepositories(IServiceCollection services)
    {
        services.AddSingleton<IVehicleRepository, VehicleRepository>();
        services.AddSingleton<IDriveRepository, DriveRepository>();
        services.AddSingleton<ITripRepository, TripRepository>();
        services.AddSingleton<IChargingRepository, ChargingRepository>();
        services.AddSingleton<IEnergyRepository, EnergyRepository>();
        services.AddSingleton<IAnalyticsRepository, AnalyticsRepository>();
        services.AddSingleton<ILocationRepository, LocationRepository>();
        services.AddSingleton<IVehicleSystemsRepository, VehicleSystemsRepository>();
        services.AddSingleton<IAutomationRepository, AutomationRepository>();
        services.AddSingleton<INotificationRepository, NotificationRepository>();
        services.AddSingleton<ITelemetrySignalsRepository, TelemetrySignalsRepository>();
        services.AddSingleton<ISystemAdminRepository, SystemAdminRepository>();
        services.AddSingleton<ISettingsRepository, SettingsRepository>();
        services.AddSingleton<IExportRepository, ExportRepository>();
        services.AddSingleton<ISharingRepository, SharingRepository>();
    }
}
