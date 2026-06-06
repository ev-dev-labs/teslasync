using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.Core.Push;

/// <summary>Configuration surface for <see cref="PushServiceCollectionExtensions.AddTeslaSyncPush"/>.</summary>
public sealed class TeslaSyncPushOptions
{
    /// <summary>Renew the channel when it expires within this window. Default: 3 days.</summary>
    public TimeSpan RenewBeforeExpiry { get; set; } = TimeSpan.FromDays(3);

    /// <summary>Optional redacting diagnostics sink (lines are already PII-safe).</summary>
    public Action<string>? Diagnostics { get; set; }
}

/// <summary>
/// Composition root for the Windows push layer (P2/W6-0002). It wires the device-registration
/// client onto the same authenticated, resilient <see cref="HttpClient"/> pipeline the data layer
/// registers, plus the registration service, the foreground router, and the inbox. Call
/// <c>AddTeslaSyncData</c> first (it registers <see cref="ApiClientOptions"/> and the
/// <c>teslasync-api</c> client) and register the platform surfaces — <see cref="IPushChannelProvider"/>,
/// and (in the app) the real <see cref="IToastService"/> / <see cref="IPushBannerSink"/> /
/// <see cref="IPushEnvironment"/> / <see cref="IPushRegistrationStore"/> — which override the headless
/// defaults below.
/// </summary>
public static class PushServiceCollectionExtensions
{
    /// <summary>Registers the push registration service, device client, router and inbox.</summary>
    public static IServiceCollection AddTeslaSyncPush(
        this IServiceCollection services,
        Action<TeslaSyncPushOptions>? configure = null)
    {
        ArgumentNullException.ThrowIfNull(services);

        var options = new TeslaSyncPushOptions();
        configure?.Invoke(options);

        services.AddSingleton(new PushDiagnostics(options.Diagnostics));

        // Headless defaults; the app overrides the platform-specific ones via TryAddSingleton.
        services.TryAddSingleton<IPushRegistrationStore, InMemoryPushRegistrationStore>();
        services.TryAddSingleton<INotificationInbox>(_ => new NotificationInbox());
        services.TryAddSingleton<IToastService, NullToastService>();
        services.TryAddSingleton<IPushBannerSink, NullPushBannerSink>();

        services.AddSingleton<IDeviceRegistrationClient>(sp =>
        {
            var factory = sp.GetRequiredService<IHttpClientFactory>();
            return new DeviceRegistrationClient(
                factory.CreateClient(DataServiceCollectionExtensions.HttpClientName),
                sp.GetRequiredService<ApiClientOptions>(),
                options.Diagnostics);
        });

        services.AddSingleton<IForegroundPushRouter>(sp => new ForegroundPushRouter(
            sp.GetRequiredService<INotificationInbox>(),
            sp.GetRequiredService<IPushBannerSink>(),
            sp.GetRequiredService<IToastService>(),
            sp.GetRequiredService<PushDiagnostics>()));

        services.AddSingleton<IPushRegistrationService>(sp => new PushRegistrationService(
            sp.GetRequiredService<IPushChannelProvider>(),
            sp.GetRequiredService<IDeviceRegistrationClient>(),
            sp.GetRequiredService<IPushRegistrationStore>(),
            sp.GetRequiredService<IPushEnvironment>(),
            sp.GetRequiredService<PushDiagnostics>(),
            new PushRegistrationOptions { RenewBeforeExpiry = options.RenewBeforeExpiry }));

        return services;
    }
}
