using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TeslaSync.App.Core.Auth;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.DataDisplay;

namespace TeslaSync.App.Core.Live;

/// <summary>Configuration surface for <see cref="LiveServiceCollectionExtensions.AddTeslaSyncLive"/>.</summary>
public sealed class TeslaSyncLiveOptions
{
    /// <summary>The SSE path (the transport adds the <c>/api/v1</c> prefix).</summary>
    public string Path { get; set; } = SseClientOptions.DefaultPath;

    /// <summary>The freshness window after which an open-but-silent stream is flagged stale.</summary>
    public TimeSpan FreshnessWindow { get; set; } = TimeSpan.FromSeconds(FreshnessLogic.DefaultStaleSeconds);

    /// <summary>Whether to backoff-reconnect after a drop/close.</summary>
    public bool Reconnect { get; set; } = true;

    /// <summary>The first-reconnect backoff base; it doubles per attempt up to <see cref="MaxRetryDelay"/>.</summary>
    public TimeSpan BaseRetryDelay { get; set; } = TimeSpan.FromSeconds(1);

    /// <summary>The upper bound for a single backoff sleep.</summary>
    public TimeSpan MaxRetryDelay { get; set; } = TimeSpan.FromSeconds(30);

    /// <summary>Optional redacting diagnostics sink for the live stream (already PII-safe lines).</summary>
    public Action<string>? Diagnostics { get; set; }
}

/// <summary>
/// Composition root for the Windows live-data layer (P2/W6-0001). It wires the foreground SSE
/// client, its <c>text/event-stream</c> transport, and the live signal state holder on top of the
/// W5 data layer. Call <c>AddTeslaSyncData</c> first (it registers <see cref="ApiClientOptions"/>)
/// and register an <see cref="ITokenProvider"/> (W4 <c>AuthService.AsTokenProvider</c>) so the
/// transport can attach and refresh bearer tokens. An <see cref="IForegroundLifecycle"/> may be
/// registered by the host to enable background pause/resume; otherwise the stream never pauses.
/// </summary>
public static class LiveServiceCollectionExtensions
{
    /// <summary>HTTP client name used for the long-lived SSE pipeline (no idle socket timeout).</summary>
    public const string HttpClientName = "teslasync-sse";

    /// <summary>Registers the live SSE client, transport and signal store.</summary>
    public static IServiceCollection AddTeslaSyncLive(
        this IServiceCollection services,
        Action<TeslaSyncLiveOptions>? configure = null)
    {
        ArgumentNullException.ThrowIfNull(services);

        var options = new TeslaSyncLiveOptions();
        configure?.Invoke(options);

        // A dedicated client for the stream: an infinite timeout so an idle connection between
        // heartbeats is never torn down by the default request timeout. Auth is attached by the
        // transport (via ITokenProvider) so the SseClient owns the 401 refresh/reconnect policy.
        services
            .AddHttpClient(HttpClientName, (sp, client) =>
            {
                client.BaseAddress = sp.GetRequiredService<ApiClientOptions>().BaseAddress;
                client.Timeout = Timeout.InfiniteTimeSpan;
            });

        services.TryAddSingleton<IForegroundLifecycle>(AlwaysForeground.Instance);

        services.AddSingleton<ISseTransport>(sp =>
        {
            var factory = sp.GetRequiredService<IHttpClientFactory>();
            return new HttpClientSseTransport(
                factory.CreateClient(HttpClientName),
                sp.GetRequiredService<ApiClientOptions>(),
                sp.GetRequiredService<ITokenProvider>(),
                options.Diagnostics);
        });

        services.AddSingleton<ISseClient>(sp => new SseClient(
            sp.GetRequiredService<ISseTransport>(),
            sp.GetRequiredService<ITokenProvider>(),
            sp.GetRequiredService<IForegroundLifecycle>(),
            new SseClientOptions
            {
                Path = options.Path,
                FreshnessWindow = options.FreshnessWindow,
                Reconnect = options.Reconnect,
                BaseRetryDelay = options.BaseRetryDelay,
                MaxRetryDelay = options.MaxRetryDelay,
            },
            options.Diagnostics));

        services.AddSingleton(sp => new LiveSignalStore(staleSeconds: (int)options.FreshnessWindow.TotalSeconds));

        return services;
    }
}
