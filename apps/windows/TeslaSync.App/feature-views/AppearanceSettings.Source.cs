using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.Repositories;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The server-settings data port the <see cref="AppearanceSettingsViewModel"/> binds to (P1/S8 state-holder
/// seam). It yields the cache-then-network sequence of the parsed appearance settings (the web
/// <c>useSettings()</c> read of <c>GET /settings</c>) and performs the full-replace save (the web
/// <c>useSaveSettings()</c> <c>PUT /settings</c>). The view never performs HTTP itself; the concrete
/// <see cref="AppearanceSettingsSource"/> (or a test fake) drives this.
/// </summary>
public interface IAppearanceSettingsSource
{
    /// <summary>Stream the cache-then-network appearance-settings snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<AppearanceServerSettings>> StreamAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Persist <paramref name="settings"/> with a full-replace <c>PUT /settings</c> (the web partial-merge
    /// pattern), returning the committed snapshot. Throws on a transport/HTTP failure so the caller can
    /// revert its optimistic update and surface the error.
    /// </summary>
    Task<AppearanceServerSettings> SaveAsync(AppearanceServerSettings settings, CancellationToken cancellationToken = default);
}

/// <summary>
/// Maps each <see cref="RepositoryResult{T}"/> of the raw settings JSON (from
/// <see cref="ISettingsRepository.GetSettingsAsync"/>) into a parsed
/// <see cref="RepositoryResult{T}"/> of <see cref="AppearanceServerSettings"/>, preserving the lifecycle
/// status, fetch time, staleness and error so the freshness chips and per-state branches survive the parse.
/// An empty / absent document parses to <see cref="AppearanceServerSettings.Default"/>. WinUI-free so the
/// mapping is unit-tested without a UI host.
/// </summary>
public static class AppearanceSettingsResultMapper
{
    /// <summary>Project one raw settings emission into a parsed appearance-settings emission.</summary>
    public static RepositoryResult<AppearanceServerSettings> Map(RepositoryResult<JsonElement> result)
    {
        ArgumentNullException.ThrowIfNull(result);

        return result.Status switch
        {
            LoadStatus.Loading => RepositoryResult<AppearanceServerSettings>.Loading(),
            LoadStatus.Cached => RepositoryResult<AppearanceServerSettings>.Cached(
                Parse(result.Value), result.FetchedAt!.Value, result.IsStale),
            LoadStatus.Refreshing => RepositoryResult<AppearanceServerSettings>.Refreshing(
                Parse(result.Value), result.FetchedAt!.Value, result.IsStale),
            LoadStatus.Loaded => RepositoryResult<AppearanceServerSettings>.Loaded(
                Parse(result.Value), result.FetchedAt!.Value),
            LoadStatus.Empty => RepositoryResult<AppearanceServerSettings>.Empty(result.FetchedAt),
            LoadStatus.Offline => RepositoryResult<AppearanceServerSettings>.OfflineCached(
                Parse(result.Value), result.FetchedAt!.Value, result.Error!),
            _ => RepositoryResult<AppearanceServerSettings>.Failure(
                result.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Couldn't load appearance settings")),
        };
    }

    private static AppearanceServerSettings Parse(JsonElement? value) =>
        value is { } element ? AppearanceServerSettings.FromJson(element) : AppearanceServerSettings.Default;
}

/// <summary>
/// The repository-backed <see cref="IAppearanceSettingsSource"/> — the native data adapter for the
/// Appearance surface. The read runs one cache-then-network stream of <c>GET /settings</c> through the
/// shared <see cref="ISettingsRepository"/> (the same <c>settings:get</c> cache key the rest of the app
/// shares) and parses each emission via <see cref="AppearanceSettingsResultMapper"/>. The save reproduces
/// the web full-replace merge: it serializes the whole settings document (every preserved field plus the
/// three appearance keys from the typed choices) and sends it through the generated <c>put_api_v1_settings</c>
/// operation. No HTTP touches the view.
/// </summary>
public sealed class AppearanceSettingsSource : IAppearanceSettingsSource
{
    /// <summary>The generated OpenAPI operation id for <c>PUT /api/v1/settings</c> (full-replace).</summary>
    private const string SaveOperation = "put_api_v1_settings";

    private readonly ISettingsRepository _settings;
    private readonly IApiClient _api;

    /// <summary>Creates the source over the shared settings repository and contract client.</summary>
    /// <param name="settings">The cache-then-network settings repository (the web <c>useSettings</c> read).</param>
    /// <param name="api">The generated contract client used for the full-replace save.</param>
    public AppearanceSettingsSource(ISettingsRepository settings, IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentNullException.ThrowIfNull(api);
        _settings = settings;
        _api = api;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<AppearanceServerSettings>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await foreach (var emission in _settings.GetSettingsAsync(cancellationToken).ConfigureAwait(false))
        {
            yield return AppearanceSettingsResultMapper.Map(emission);
        }
    }

    /// <inheritdoc />
    public async Task<AppearanceServerSettings> SaveAsync(
        AppearanceServerSettings settings,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(settings);

        var request = new ApiRequest(SaveOperation, Body: settings.ToRequestBody());
        var response = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);

        // The endpoint echoes the saved document; parse it so the committed snapshot reflects any
        // server-side normalization, falling back to the optimistic value when the echo is not an object.
        return response.ValueKind == JsonValueKind.Object
            ? AppearanceServerSettings.FromJson(response)
            : settings;
    }
}

/// <summary>
/// The persistence seam for the per-device, client-only appearance preferences (sidebar style, status-bar
/// prefs, celebration prefs). It mirrors the web localStorage hooks (<c>useSidebarStyle</c>,
/// <c>useStatusBarPrefs</c>, <c>useAchievementCelebrationPrefs</c>): synchronous, instant and offline. The
/// app wires the durable <c>ApplicationData.LocalSettings</c>-backed implementation (in the view file);
/// headless callers and unit tests use <see cref="InMemoryAppearanceLocalPreferences"/>. Implementations
/// must be best-effort — an unreadable store returns <see cref="AppearanceLocalPreferences.Default"/> and a
/// failed save is swallowed rather than thrown.
/// </summary>
public interface IAppearanceLocalPreferences
{
    /// <summary>Returns the persisted preferences, or <see cref="AppearanceLocalPreferences.Default"/> when absent.</summary>
    AppearanceLocalPreferences Load();

    /// <summary>Persists <paramref name="preferences"/>, replacing any previously stored values.</summary>
    void Save(AppearanceLocalPreferences preferences);
}

/// <summary>
/// An in-memory <see cref="IAppearanceLocalPreferences"/> used by unit tests (and as the headless fallback).
/// It is intentionally non-durable; the real app binds the LocalSettings-backed store. Seed it to exercise
/// a specific starting state.
/// </summary>
public sealed class InMemoryAppearanceLocalPreferences : IAppearanceLocalPreferences
{
    private AppearanceLocalPreferences _preferences;

    /// <summary>Creates the store seeded with <paramref name="initial"/> (defaults when omitted).</summary>
    public InMemoryAppearanceLocalPreferences(AppearanceLocalPreferences? initial = null) =>
        _preferences = (initial ?? AppearanceLocalPreferences.Default).Normalized();

    /// <summary>Number of times <see cref="Save"/> has been invoked.</summary>
    public int SaveCount { get; private set; }

    /// <inheritdoc />
    public AppearanceLocalPreferences Load() => _preferences;

    /// <inheritdoc />
    public void Save(AppearanceLocalPreferences preferences)
    {
        ArgumentNullException.ThrowIfNull(preferences);
        SaveCount++;
        _preferences = preferences.Normalized();
    }
}
