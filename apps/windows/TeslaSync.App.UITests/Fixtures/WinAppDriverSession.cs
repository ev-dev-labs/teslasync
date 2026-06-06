using TeslaSync.App.UITests.Drivers;
using Xunit;

namespace TeslaSync.App.UITests.Fixtures;

/// <summary>
/// The shared WinAppDriver session for the whole UI automation collection. On
/// <see cref="InitializeAsync"/> it probes the environment; when a runner and app are present it
/// starts the seeded <see cref="FakeApiServer"/>, builds a deterministic <see cref="TestProfile"/>,
/// starts WinAppDriver (when only the executable — not a live endpoint — is available), and opens a
/// driver session against the packaged app with the profile injected as environment. When the runner
/// or app is absent it records the precise reason and every test that calls <see cref="EnsureReady"/>
/// fails with it — the suite is never silently skipped. Screenshots and the UIA tree are captured on
/// failure through <see cref="RunAsync"/>.
/// </summary>
public sealed class WinAppDriverSession : IAsyncLifetime
{
    private FakeApiServer? _server;
    private TestProfile? _profile;
    private WinAppDriverProcess? _driverProcess;
    private WinAppDriverClient? _client;
    private RunnerAvailability _availability =
        new(false, false, null, new Uri(RunnerAvailability.DefaultDriverUrl), "not probed");
    private Exception? _initError;
    private bool _authenticated = true;

    /// <summary>Captures failure screenshots / UIA trees under the project's artifacts directory.</summary>
    public ScreenshotRecorder Artifacts { get; } = new(
        Path.Combine(AppContext.BaseDirectory, "artifacts"));

    /// <summary>The seeded fake API the app is pointed at (only set when the runner is available).</summary>
    public FakeApiServer Server =>
        _server ?? throw new UiAutomationUnavailableException(_availability.Reason);

    /// <summary>The live WinAppDriver client (only set when the runner is available).</summary>
    public WinAppDriverClient Client =>
        _client ?? throw new UiAutomationUnavailableException(_availability.Reason);

    /// <summary>The result of the environment capability probe.</summary>
    public RunnerAvailability Availability => _availability;

    /// <inheritdoc />
    public async Task InitializeAsync()
    {
        _availability = RunnerAvailability.Probe();
        Artifacts.Log($"probe: available={_availability.Available} reason={_availability.Reason}");

        if (!_availability.Available)
        {
            return;
        }

        try
        {
            await StartSessionAsync(_authenticated).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is WinAppDriverException or IOException)
        {
            _initError = ex;
            Artifacts.Log($"init error: {ex.Message}");
        }
    }

    /// <inheritdoc />
    public async Task DisposeAsync() => await TeardownSessionAsync().ConfigureAwait(false);

    /// <summary>
    /// Throw the precise BLOCKED reason when the runner/app is absent, or rethrow a session-start
    /// failure; otherwise return so the calling test can drive the live app.
    /// </summary>
    public void EnsureReady()
    {
        if (!_availability.Available)
        {
            throw new UiAutomationUnavailableException(_availability.Reason);
        }

        if (_initError is not null)
        {
            throw new WinAppDriverException(
                "WinAppDriver session could not be started: " + _initError.Message, _initError);
        }
    }

    /// <summary>
    /// Re-launch the app under test with an authenticated or signed-out profile. Used by the auth
    /// flow tests to start from a known session state.
    /// </summary>
    public async Task RestartAsync(bool authenticated, CancellationToken cancellationToken = default)
    {
        EnsureReady();
        if (authenticated == _authenticated && _client is not null)
        {
            return;
        }

        await TeardownClientAsync().ConfigureAwait(false);
        _authenticated = authenticated;
        await StartSessionAsync(authenticated, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Run <paramref name="body"/> against the live client, capturing a screenshot + UIA tree and
    /// appending a log entry if it throws, then rethrowing so the test still fails.
    /// </summary>
    public async Task RunAsync(string testName, Func<WinAppDriverClient, Task> body)
    {
        EnsureReady();
        var client = Client;
        try
        {
            await body(client).ConfigureAwait(false);
            Artifacts.Log($"PASS {testName}");
        }
        catch (Exception ex)
        {
            await Artifacts.CaptureAsync(client, testName, ex).ConfigureAwait(false);
            throw;
        }
    }

    private async Task StartSessionAsync(bool authenticated, CancellationToken cancellationToken = default)
    {
        _server ??= StartServer();
        _profile = TestProfile.Create(_server.BaseUrl, authenticated);

        if (!RunnerAvailability.IsDriverReachable(_availability.DriverUri, TimeSpan.FromMilliseconds(750)))
        {
            _driverProcess ??= WinAppDriverProcess.Locate();
            _driverProcess.Start(_availability.DriverUri.Host, _availability.DriverUri.Port);
            await WaitForDriverAsync(TimeSpan.FromSeconds(15), cancellationToken).ConfigureAwait(false);
        }

        var client = new WinAppDriverClient(_availability.DriverUri);
        await client.CreateSessionAsync(
            _availability.AppIdentity!,
            _profile.Environment,
            implicitWait: TimeSpan.FromSeconds(5),
            cancellationToken).ConfigureAwait(false);
        _client = client;
        Artifacts.Log($"session started: app={_availability.AppIdentity} authenticated={authenticated}");
    }

    private FakeApiServer StartServer()
    {
        var server = new FakeApiServer();
        server.Start();
        Artifacts.Log($"fake api server: {server.BaseUrl}");
        return server;
    }

    private async Task WaitForDriverAsync(TimeSpan timeout, CancellationToken cancellationToken)
    {
        var deadline = DateTimeOffset.UtcNow + timeout;
        while (DateTimeOffset.UtcNow < deadline)
        {
            if (RunnerAvailability.IsDriverReachable(_availability.DriverUri, TimeSpan.FromMilliseconds(500)))
            {
                return;
            }

            await Task.Delay(250, cancellationToken).ConfigureAwait(false);
        }
    }

    private async Task TeardownSessionAsync()
    {
        await TeardownClientAsync().ConfigureAwait(false);
        _driverProcess?.Dispose();
        _driverProcess = null;
        _server?.Dispose();
        _server = null;
        _profile?.Cleanup();
        _profile = null;
    }

    private Task TeardownClientAsync()
    {
        try
        {
            _client?.Dispose();
        }
        catch (WinAppDriverException)
        {
            // Best-effort teardown.
        }

        _client = null;
        return Task.CompletedTask;
    }
}

/// <summary>
/// The xUnit collection that shares a single <see cref="WinAppDriverSession"/> across every UI
/// automation test class, so the app is launched once for the whole suite.
/// </summary>
[CollectionDefinition(Name)]
public sealed class WinAppDriverCollection : ICollectionFixture<WinAppDriverSession>
{
    /// <summary>The collection name applied to every UI automation test class.</summary>
    public const string Name = "WinAppDriver UI automation";
}
