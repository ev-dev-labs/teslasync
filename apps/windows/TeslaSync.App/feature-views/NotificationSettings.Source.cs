using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The OS notification-permission seam the <see cref="NotificationSettingsViewModel"/> binds to (P1/S8) — the
/// native analogue of the web <c>useWebPush</c> hook's <c>permission</c> / <c>requestPermission</c> /
/// <c>isSupported</c> surface. The view never touches the OS directly; the Windows host wires a real
/// toast-capability implementation while the headless core and tests use
/// <see cref="InMemoryNotificationPermissionGateway"/>.
/// </summary>
public interface INotificationPermissionGateway
{
    /// <summary>The current permission status (web <c>permission</c> + <c>isSupported</c>).</summary>
    NotificationPermissionStatus Status { get; }

    /// <summary>Raised whenever <see cref="Status"/> changes.</summary>
    event EventHandler? StatusChanged;

    /// <summary>Request permission and return the resulting status (web <c>requestPermission</c>).</summary>
    Task<NotificationPermissionStatus> RequestAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// A device-free <see cref="INotificationPermissionGateway"/> for the headless core and unit tests. It models
/// the web permission lifecycle: a <see cref="NotificationPermissionStatus.Default"/> gateway transitions to
/// <see cref="NotificationPermissionStatus.Granted"/> on <see cref="RequestAsync"/> (the user accepting the
/// prompt), while a granted / denied / unsupported gateway returns its current status unchanged. The Windows
/// app registers a real toast-capability implementation that overrides this.
/// </summary>
public sealed class InMemoryNotificationPermissionGateway : INotificationPermissionGateway
{
    private NotificationPermissionStatus _status;

    /// <summary>Creates the gateway seeded with <paramref name="status"/> (defaults to not-yet-requested).</summary>
    public InMemoryNotificationPermissionGateway(
        NotificationPermissionStatus status = NotificationPermissionStatus.Default) => _status = status;

    /// <inheritdoc />
    public event EventHandler? StatusChanged;

    /// <inheritdoc />
    public NotificationPermissionStatus Status => _status;

    /// <inheritdoc />
    public Task<NotificationPermissionStatus> RequestAsync(CancellationToken cancellationToken = default)
    {
        if (_status == NotificationPermissionStatus.Default)
        {
            Set(NotificationPermissionStatus.Granted);
        }

        return Task.FromResult(_status);
    }

    /// <summary>Set the current status, raising <see cref="StatusChanged"/> when it changes (host/test hook).</summary>
    public void Set(NotificationPermissionStatus status)
    {
        if (_status == status)
        {
            return;
        }

        _status = status;
        StatusChanged?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The out-of-tab event-preference seam (P1/S8) — the native analogue of the web <c>useNotificationListener</c>
/// hook's <c>{ prefs, setPrefs }</c>. Holds the two per-event gates (alerts / export completions) the web stores
/// in <c>localStorage</c>; the Windows host persists them in <c>ApplicationData.LocalSettings</c>, while the
/// headless core and tests use <see cref="InMemoryWebPushPreferenceStore"/>.
/// </summary>
public interface IWebPushPreferenceStore
{
    /// <summary>The current event preferences (web <c>prefs</c>).</summary>
    WebPushPreferences Current { get; }

    /// <summary>Raised whenever <see cref="Current"/> changes.</summary>
    event EventHandler? Changed;

    /// <summary>Persist <paramref name="preferences"/> (web <c>setPrefs</c>).</summary>
    void Update(WebPushPreferences preferences);
}

/// <summary>An in-memory <see cref="IWebPushPreferenceStore"/> for the headless core and unit tests.</summary>
public sealed class InMemoryWebPushPreferenceStore : IWebPushPreferenceStore
{
    private WebPushPreferences _current;

    /// <summary>Creates the store seeded with <paramref name="initial"/> (defaults to both events on).</summary>
    public InMemoryWebPushPreferenceStore(WebPushPreferences? initial = null) =>
        _current = initial ?? WebPushPreferences.Default;

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public WebPushPreferences Current => _current;

    /// <inheritdoc />
    public void Update(WebPushPreferences preferences)
    {
        ArgumentNullException.ThrowIfNull(preferences);
        if (_current == preferences)
        {
            return;
        }

        _current = preferences;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The per-channel notification-sound seam (P1/S8) — the native analogue of the web
/// <c>useNotificationSoundPrefs</c> store (web/src/lib/notificationSound.ts). Holds the master gate, per-channel
/// gates and volume the web persists in <c>localStorage</c>; the Windows host persists them in
/// <c>ApplicationData.LocalSettings</c>, while the headless core and tests use
/// <see cref="InMemoryNotificationSoundPreferenceStore"/>.
/// </summary>
public interface INotificationSoundPreferenceStore
{
    /// <summary>The current sound preferences (web <c>useNotificationSoundPrefs()</c>).</summary>
    NotificationSoundPreferences Current { get; }

    /// <summary>Raised whenever <see cref="Current"/> changes.</summary>
    event EventHandler? Changed;

    /// <summary>Persist <paramref name="preferences"/> (web <c>setNotificationSoundPrefs</c>).</summary>
    void Update(NotificationSoundPreferences preferences);
}

/// <summary>An in-memory <see cref="INotificationSoundPreferenceStore"/> for the headless core and unit tests.</summary>
public sealed class InMemoryNotificationSoundPreferenceStore : INotificationSoundPreferenceStore
{
    private NotificationSoundPreferences _current;

    /// <summary>Creates the store seeded with <paramref name="initial"/> (defaults to the web defaults).</summary>
    public InMemoryNotificationSoundPreferenceStore(NotificationSoundPreferences? initial = null) =>
        _current = (initial ?? NotificationSoundPreferences.Default).Normalized();

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public NotificationSoundPreferences Current => _current;

    /// <inheritdoc />
    public void Update(NotificationSoundPreferences preferences)
    {
        ArgumentNullException.ThrowIfNull(preferences);
        var normalized = preferences.Normalized();
        if (_current == normalized)
        {
            return;
        }

        _current = normalized;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The browser-tab-signals seam (P1/S8) — the native analogue of the web <c>useSettings</c> /
/// <c>useSaveSettings</c> pair for the two tab-signal flags. It yields the cache-then-network sequence of parsed
/// <see cref="NotificationTabSignals"/> snapshots for <c>GET /settings</c> and persists a change via
/// <c>PUT /settings</c>. The view never performs HTTP; the concrete <see cref="NotificationTabSignalsSource"/>
/// (or a test fake) drives this.
/// </summary>
public interface INotificationTabSignalsSource
{
    /// <summary>Stream the cache-then-network tab-signal snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<NotificationTabSignals>> StreamAsync(CancellationToken cancellationToken = default);

    /// <summary>Persist <paramref name="signals"/> via <c>PUT /settings</c> (full-object upsert, web parity).</summary>
    Task SaveAsync(NotificationTabSignals signals, CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="INotificationTabSignalsSource"/> — the native data adapter for the
/// browser-tab-signals section. It runs one cache-then-network read of <c>GET /settings</c> (the web
/// <c>useSettings</c> query), parsing each emission's <c>tab_badge_enabled</c> / <c>critical_flash_enabled</c>
/// fields into a <see cref="NotificationTabSignals"/>, and persists a toggle via <c>PUT /settings</c>. The save
/// sends the <b>full</b> settings object with the two fields overridden — exactly the web
/// <c>saveSettings.mutate({ ...settings, [key]: value })</c> — so the server-side full-replace upsert never
/// zero-values an unrelated field. No HTTP touches the view.
/// </summary>
public sealed class NotificationTabSignalsSource : INotificationTabSignalsSource
{
    private const string CacheKey = "settings:tab-signals";

    private static readonly ApiRequest GetRequest = new(NotificationSettingsRegistration.SettingsGetOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    private JsonElement _lastSettings;
    private bool _hasSettings;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public NotificationTabSignalsSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<NotificationTabSignals>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(GetRequest, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            if (emission.HasValue && emission.Value.ValueKind == JsonValueKind.Object)
            {
                // Keep the whole settings object so a tab-signal save can round-trip every unrelated field.
                _lastSettings = emission.Value.Clone();
                _hasSettings = true;
            }

            yield return Map(emission);
        }
    }

    /// <inheritdoc />
    public async Task SaveAsync(NotificationTabSignals signals, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(signals);

        var request = new ApiRequest(NotificationSettingsRegistration.SettingsPutOperation, Body: BuildSaveBody(signals));
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    private JsonObject BuildSaveBody(NotificationTabSignals signals)
    {
        JsonObject body = _hasSettings && JsonNode.Parse(_lastSettings.GetRawText()) is JsonObject existing
            ? existing
            : new JsonObject();

        body["tab_badge_enabled"] = signals.TabBadgeEnabled;
        body["critical_flash_enabled"] = signals.CriticalFlashEnabled;
        return body;
    }

    private static RepositoryResult<NotificationTabSignals> Map(RepositoryResult<JsonElement> raw)
    {
        NotificationTabSignals Parse() =>
            raw.HasValue ? NotificationTabSignals.FromSettings(raw.Value) : NotificationTabSignals.Default;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<NotificationTabSignals>.Loading(),
            LoadStatus.Cached => RepositoryResult<NotificationTabSignals>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<NotificationTabSignals>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<NotificationTabSignals>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<NotificationTabSignals>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<NotificationTabSignals>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<NotificationTabSignals>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    // The settings endpoint returns a populated object; a null / non-object body or an empty object carries no
    // tab-signal flags to show (the surface then falls back to the on-by-default values).
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Object => !element.EnumerateObject().MoveNext(),
        _ => true,
    };
}
