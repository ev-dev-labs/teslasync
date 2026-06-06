using Microsoft.UI.Dispatching;
using TeslaSync.App.Auth;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Core.Auth;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Push;
using TeslaSync.App.Platform;

namespace TeslaSync.App.Push;

/// <summary>
/// Composition root for Windows push (P2/W6-0002, ADR-009), mirroring <see cref="AppAuth"/>. It wires
/// the headless registration service and foreground router to the real Windows surfaces — the WNS
/// channel provider, the toast service, the device environment and the local settings store — and to
/// the W2 alert banner the shell hosts. Registration follows the auth session: it registers on
/// sign-in, renews before expiry, and unregisters on sign-out.
///
/// <para>The API origin is read from the <c>TESLASYNC_API_BASE</c> environment variable (with a local
/// default) so a deployment can target its own host without a rebuild, exactly like the auth host.
/// Startup is best-effort: in an unpackaged dev run (no WNS/package identity) the graph is built but
/// the service simply parks in <see cref="PushRegistrationState.Failed"/> instead of crashing.</para>
/// </summary>
public static class AppPush
{
    private const string ApiBaseEnvVar = "TESLASYNC_API_BASE";
    private const string DefaultApiBase = "https://teslasync.local";

    private static readonly object Gate = new();

    private static WnsPushChannelProvider? _provider;
    private static PushRegistrationService? _service;
    private static PushSessionController? _controller;
    private static HttpClient? _http;
    private static bool _started;

    /// <summary>The active registration service once <see cref="Start"/> has run, else <see langword="null"/>.</summary>
    public static IPushRegistrationService? Service
    {
        get
        {
            lock (Gate)
            {
                return _service;
            }
        }
    }

    /// <summary>
    /// Builds the push graph against the shell's UI <paramref name="dispatcher"/> and
    /// <paramref name="banner"/> and starts following the auth session. Idempotent and best-effort:
    /// a host without package identity leaves the app running normally.
    /// </summary>
    public static void Start(DispatcherQueue dispatcher, TsAlertBanner banner)
    {
        ArgumentNullException.ThrowIfNull(dispatcher);
        ArgumentNullException.ThrowIfNull(banner);

        lock (Gate)
        {
            if (_started)
            {
                return;
            }

            _started = true;
            try
            {
                BuildAndStart(dispatcher, banner);
            }
            catch (Exception)
            {
                // Best-effort: a missing package identity or unsupported host must not crash launch.
            }
        }
    }

    /// <summary>Stops following the auth session and releases the push graph.</summary>
    public static void Stop()
    {
        lock (Gate)
        {
            _controller?.Dispose();
            _provider?.Dispose();
            _service?.Dispose();
            _http?.Dispose();
            _controller = null;
            _provider = null;
            _service = null;
            _http = null;
            _started = false;
        }
    }

    private static void BuildAndStart(DispatcherQueue dispatcher, TsAlertBanner banner)
    {
        var apiBase = ResolveApiBase();
        var options = new ApiClientOptions { BaseAddress = apiBase, VersionBasePath = "/api/v1" };

        var http = new HttpClient(new AuthHttpHandler(AppAuth.Service.AsTokenProvider(), new HttpClientHandler()))
        {
            BaseAddress = apiBase,
        };
        var client = new DeviceRegistrationClient(http, options);

        var provider = new WnsPushChannelProvider();
        var environment = new PushDeviceEnvironment();
        var store = new LocalSettingsPushRegistrationStore();
        var diagnostics = new PushDiagnostics();

        var inbox = new NotificationInbox();
        var bannerSink = new PushBannerPresenter(dispatcher, banner);
        var toast = new WindowsToastService();
        var router = new ForegroundPushRouter(inbox, bannerSink, toast, diagnostics);

        var service = new PushRegistrationService(provider, client, store, environment, diagnostics);
        var controller = new PushSessionController(service, router, provider, AppAuth.Service);

        _http = http;
        _provider = provider;
        _service = service;
        _controller = controller;

        controller.Start();
    }

    private static Uri ResolveApiBase()
    {
        var value = Environment.GetEnvironmentVariable(ApiBaseEnvVar);
        return !string.IsNullOrWhiteSpace(value) && Uri.TryCreate(value, UriKind.Absolute, out var uri)
            ? uri
            : new Uri(DefaultApiBase, UriKind.Absolute);
    }
}
