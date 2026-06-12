using System.Globalization;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The render states the <c>MapTileLayer</c> surface resolves to — the native projection of the web
/// <c>MapTileLayer</c>'s data lifecycle (web/src/components/maps/MapTileLayer.tsx L54-69, the
/// <c>useQuery(['map-config'], getMapConfig)</c> result that selects the provider tile table). The web component
/// renders a Leaflet <c>TileLayer</c> immediately on the free-tile fallback and swaps in the configured
/// provider's tiles once the query resolves; the shared-surface framework additionally requires every load state
/// to render, so the map always paints (free fallback) while these states drive the overlay chrome on top.
/// </summary>
public enum MapTileLayerVisualState
{
    /// <summary>The map-config query is in flight with no cached value — the busy overlay shows over free tiles.</summary>
    Loading,

    /// <summary>A fresh map config resolved — the configured provider's tiles render with no chrome.</summary>
    Ready,

    /// <summary>The query resolved with no provider config — the free community tiles render with a note.</summary>
    Empty,

    /// <summary>The query failed with no cached config — free tiles render with an error chip + retry affordance.</summary>
    Error,

    /// <summary>A cached config older than the freshness window is shown while a refresh runs — a stale chip shows.</summary>
    Stale,

    /// <summary>The network failed but a cached config is still shown — an offline chip shows over the cached tiles.</summary>
    Offline,
}

/// <summary>
/// One immutable, render-ready snapshot of the surface — the resolved map configuration plus the tile source it
/// selects for the active style, derived from a cache-then-network <see cref="RepositoryResult{T}"/> exactly as
/// the web <c>MapTileLayer</c> derives its tile table from the <c>useQuery</c> result
/// (web/src/components/maps/MapTileLayer.tsx L54-69). Pure data (no WinUI types) so the
/// <see cref="MapTileLayerProjection"/> and the view-model are verified headlessly. The
/// <see cref="MapConfig.ApiKey"/> is carried so the view can hand it to the tile renderer, but it is never
/// surfaced to automation, the accessible name or diagnostics.
/// </summary>
/// <param name="State">The resolved render state.</param>
/// <param name="Config">The resolved map configuration (the free default when none resolved).</param>
/// <param name="Style">The requested base-map style (the web <c>style</c> prop).</param>
/// <param name="Tile">The tile source the <see cref="Style"/> selects under <see cref="Config"/>.</param>
/// <param name="FetchedAt">When the underlying value was fetched, when known.</param>
/// <param name="Error">The repository failure for the error / offline states, when present.</param>
public sealed record MapTileLayerSnapshot(
    MapTileLayerVisualState State,
    MapConfig Config,
    MapStyleKind Style,
    TileSource Tile,
    DateTimeOffset? FetchedAt,
    RepositoryError? Error)
{
    /// <summary>The selected provider (the web <c>mapConfig.provider</c> branch).</summary>
    public MapProvider Provider => Config.Provider;

    /// <summary>True when a provider key is present (Azure / Google tiles are active rather than the free fallback).</summary>
    public bool HasApiKey => !string.IsNullOrEmpty(Config.ApiKey);

    /// <summary>The provider's required attribution text for the active tile source (a brand string).</summary>
    public string Attribution => Tile.Attribution;

    /// <summary>The ready free-tile snapshot for a style — the web initial render before the config query resolves.</summary>
    /// <param name="style">The base-map style to resolve free tiles for.</param>
    public static MapTileLayerSnapshot Ready(MapStyleKind style)
    {
        var config = new MapConfig();
        return new MapTileLayerSnapshot(
            MapTileLayerVisualState.Ready, config, style, MapTileProvider.Resolve(style, config), null, null);
    }

    /// <summary>
    /// Derive a snapshot from a cache-then-network <see cref="RepositoryResult{T}"/> for the active
    /// <paramref name="style"/> — the native port of the web <c>useQuery</c> tile-table selection
    /// (web/src/components/maps/MapTileLayer.tsx L54-69). A value-bearing emission (cached / refreshing / loaded /
    /// offline-cached) resolves its provider tiles; a value-less load / empty / hard-error emission falls back to
    /// the free community tiles exactly as the web defaults to <c>freeTiles</c> when <c>mapConfig</c> is undefined,
    /// while still surfacing the load state for the overlay chrome.
    /// </summary>
    /// <param name="result">The repository emission to project.</param>
    /// <param name="style">The requested base-map style.</param>
    public static MapTileLayerSnapshot FromRepositoryResult(RepositoryResult<MapConfig> result, MapStyleKind style)
    {
        ArgumentNullException.ThrowIfNull(result);

        var config = result.Value ?? new MapConfig();
        var state = MapTileLayerRegistration.ClassifyState(result.Status, result.IsStale);
        var tile = MapTileProvider.Resolve(style, config);
        return new MapTileLayerSnapshot(state, config, style, tile, result.FetchedAt, result.Error);
    }
}

/// <summary>
/// Canonical metadata for the MapTileLayer surface — the diagnostics slug, the automation ids, the i18n keys
/// (each with the English fallback the surface renders; the web <c>MapTileLayer</c> has no <c>t()</c> calls — its
/// only literals are the brand tile attributions, which are intentionally not localized — so these keys are
/// introduced for the WinUI i18n catalogue), the Segoe Fluent glyphs standing in for the web Leaflet/Lucide
/// chrome, and the pure <see cref="ClassifyState"/> / provider+style label helpers the projection reuses. UI-free
/// so it is asserted in tests.
/// </summary>
public static class MapTileLayerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "MapTileLayer";

    /// <summary>The automation id the surface root is resolved by.</summary>
    public const string RootAutomationId = "map-tile-layer";

    /// <summary>The automation id the hosted map is resolved by.</summary>
    public const string MapAutomationId = "map-tile-layer-map";

    /// <summary>The automation id the busy overlay is resolved by.</summary>
    public const string LoadingAutomationId = "map-tile-layer-loading";

    /// <summary>The automation id the error overlay is resolved by.</summary>
    public const string ErrorAutomationId = "map-tile-layer-error";

    /// <summary>The automation id the stale / offline status chip is resolved by.</summary>
    public const string StatusChipAutomationId = "map-tile-layer-status";

    /// <summary>The automation id the fullscreen toggle is resolved by.</summary>
    public const string FullscreenAutomationId = "map-tile-layer-fullscreen";

    /// <summary>ARIA live urgency the status chip declares (a polite, non-interrupting announcement).</summary>
    public const string LiveSetting = "polite";

    /// <summary>The web map-config <c>staleTime</c> (5 minutes) — the freshness window cached config is judged against.</summary>
    public static TimeSpan FreshnessWindow { get; } = TimeSpan.FromMinutes(5);

    /// <summary>Segoe Fluent "map" glyph — the native stand-in for the web map chrome.</summary>
    public const string MapGlyph = "\uE707";

    /// <summary>Segoe Fluent "offline" glyph — the native stand-in for the web Lucide <c>WifiOff</c> icon.</summary>
    public const string OfflineGlyph = "\uEB5E";

    /// <summary>Segoe Fluent "recent / history" glyph — the stale-cache chip indicator.</summary>
    public const string StaleGlyph = "\uE81C";

    /// <summary>i18n key for the busy overlay label.</summary>
    public const string LoadingKey = "translation.mapTileLayer.loading";

    /// <summary>English fallback for <see cref="LoadingKey"/> (ASCII ellipsis).</summary>
    public const string LoadingFallback = "Loading map...";

    /// <summary>i18n key for the error overlay heading.</summary>
    public const string ErrorTitleKey = "translation.mapTileLayer.error.title";

    /// <summary>English fallback for <see cref="ErrorTitleKey"/>.</summary>
    public const string ErrorTitleFallback = "Map settings unavailable";

    /// <summary>i18n key for the error overlay message.</summary>
    public const string ErrorMessageKey = "translation.mapTileLayer.error.message";

    /// <summary>English fallback for <see cref="ErrorMessageKey"/>.</summary>
    public const string ErrorMessageFallback = "Couldn't load the map configuration. Showing default community tiles.";

    /// <summary>i18n key for the error retry button label.</summary>
    public const string RetryKey = "translation.mapTileLayer.retry";

    /// <summary>English fallback for <see cref="RetryKey"/>.</summary>
    public const string RetryFallback = "Retry";

    /// <summary>i18n key for the fullscreen toggle accessible label (web <c>FullscreenButton</c> aria-label).</summary>
    public const string FullscreenKey = "translation.mapTileLayer.fullscreen";

    /// <summary>English fallback for <see cref="FullscreenKey"/>.</summary>
    public const string FullscreenFallback = "Toggle fullscreen map";

    /// <summary>i18n key for the stale-cache chip.</summary>
    public const string StaleKey = "translation.mapTileLayer.stale";

    /// <summary>English fallback for <see cref="StaleKey"/>.</summary>
    public const string StaleFallback = "Showing cached map settings";

    /// <summary>i18n key for the offline chip.</summary>
    public const string OfflineKey = "translation.mapTileLayer.offline";

    /// <summary>English fallback for <see cref="OfflineKey"/> (ASCII hyphen).</summary>
    public const string OfflineFallback = "Offline - showing cached map settings";

    /// <summary>i18n key for the empty-state note shown when no provider is configured.</summary>
    public const string EmptyNoteKey = "translation.mapTileLayer.empty";

    /// <summary>English fallback for <see cref="EmptyNoteKey"/>.</summary>
    public const string EmptyNoteFallback = "Using default community map tiles";

    /// <summary>i18n key for the surface accessible name (<c>{0}</c>=provider, <c>{1}</c>=style).</summary>
    public const string AccessibleNameKey = "translation.mapTileLayer.accessibleName";

    /// <summary>English fallback for <see cref="AccessibleNameKey"/> with the positional format arguments.</summary>
    public const string AccessibleNameFallback = "Map base tiles - {0}, {1} style";

    /// <summary>i18n key for the free community provider label.</summary>
    public const string ProviderCommunityKey = "translation.mapTileLayer.provider.community";

    /// <summary>English fallback for <see cref="ProviderCommunityKey"/>.</summary>
    public const string ProviderCommunityFallback = "Community";

    /// <summary>i18n key for the Azure Maps provider label.</summary>
    public const string ProviderAzureKey = "translation.mapTileLayer.provider.azure";

    /// <summary>English fallback for <see cref="ProviderAzureKey"/> (a brand name).</summary>
    public const string ProviderAzureFallback = "Azure Maps";

    /// <summary>i18n key for the Google Maps provider label.</summary>
    public const string ProviderGoogleKey = "translation.mapTileLayer.provider.google";

    /// <summary>English fallback for <see cref="ProviderGoogleKey"/> (a brand name).</summary>
    public const string ProviderGoogleFallback = "Google Maps";

    /// <summary>
    /// Classify a cache-then-network <see cref="LoadStatus"/> (plus its staleness flag) into a render state — the
    /// pure core of <see cref="MapTileLayerSnapshot.FromRepositoryResult"/>. Cached / refreshing emissions render
    /// as <see cref="MapTileLayerVisualState.Stale"/> only when past the freshness window, otherwise as
    /// <see cref="MapTileLayerVisualState.Ready"/>.
    /// </summary>
    /// <param name="status">The repository emission status.</param>
    /// <param name="isStale">Whether the cached value is past the freshness window.</param>
    public static MapTileLayerVisualState ClassifyState(LoadStatus status, bool isStale) => status switch
    {
        LoadStatus.Loading => MapTileLayerVisualState.Loading,
        LoadStatus.Empty => MapTileLayerVisualState.Empty,
        LoadStatus.Error => MapTileLayerVisualState.Error,
        LoadStatus.Offline => MapTileLayerVisualState.Offline,
        LoadStatus.Cached or LoadStatus.Refreshing => isStale
            ? MapTileLayerVisualState.Stale
            : MapTileLayerVisualState.Ready,
        _ => MapTileLayerVisualState.Ready,
    };

    /// <summary>The localized display label for a provider (the web provider branch made human-readable).</summary>
    /// <param name="provider">The selected provider.</param>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    public static string ProviderLabel(MapProvider provider, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return provider switch
        {
            MapProvider.Azure => localizer.GetString(ProviderAzureKey, ProviderAzureFallback),
            MapProvider.Google => localizer.GetString(ProviderGoogleKey, ProviderGoogleFallback),
            _ => localizer.GetString(ProviderCommunityKey, ProviderCommunityFallback),
        };
    }

    /// <summary>The localized display label for a base-map style (mirrors the web style union).</summary>
    /// <param name="style">The base-map style.</param>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    public static string StyleLabel(MapStyleKind style, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        string id = MapStyles.Id(style);
        string fallback = style switch
        {
            MapStyleKind.Satellite => "Satellite",
            MapStyleKind.Streets => "Streets",
            MapStyleKind.Terrain => "Terrain",
            _ => "Dark",
        };
        return localizer.GetString("translation.mapTileLayer.style." + id, fallback);
    }
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="MapTileLayerSnapshot"/> — everything the
/// <c>MapTileLayer</c> view needs to render without re-deriving anything: the resolved state, the configuration
/// the tile renderer consumes, the (brand) attribution, every overlay/chip visibility gate, the localized
/// strings each renders, and the accessible name. Computed by <see cref="Project"/>. A pure value type so every
/// branch is asserted headlessly; the carried <see cref="MapConfig.ApiKey"/> is consumed only by the tile
/// renderer and never appears in <see cref="AccessibleName"/>.
/// </summary>
public readonly record struct MapTileLayerProjection
{
    private MapTileLayerProjection(
        MapTileLayerVisualState state,
        MapConfig config,
        MapStyleKind style,
        string attribution,
        string loadingLabel,
        string errorTitle,
        string errorMessage,
        string retryLabel,
        string staleLabel,
        string offlineLabel,
        string emptyNote,
        string providerLabel,
        string styleLabel,
        string accessibleName)
    {
        State = state;
        Config = config;
        Style = style;
        Attribution = attribution;
        LoadingLabel = loadingLabel;
        ErrorTitle = errorTitle;
        ErrorMessage = errorMessage;
        RetryLabel = retryLabel;
        StaleLabel = staleLabel;
        OfflineLabel = offlineLabel;
        EmptyNote = emptyNote;
        ProviderLabelText = providerLabel;
        StyleLabelText = styleLabel;
        AccessibleName = accessibleName;
    }

    /// <summary>The resolved render state.</summary>
    public MapTileLayerVisualState State { get; }

    /// <summary>The map configuration the tile renderer consumes (carries the provider key; never logged).</summary>
    public MapConfig Config { get; }

    /// <summary>The active base-map style.</summary>
    public MapStyleKind Style { get; }

    /// <summary>The provider's required attribution text (a brand string, not localized).</summary>
    public string Attribution { get; }

    /// <summary>The busy overlay label.</summary>
    public string LoadingLabel { get; }

    /// <summary>The error overlay heading.</summary>
    public string ErrorTitle { get; }

    /// <summary>The error overlay message.</summary>
    public string ErrorMessage { get; }

    /// <summary>The error retry button label.</summary>
    public string RetryLabel { get; }

    /// <summary>The stale-cache chip text.</summary>
    public string StaleLabel { get; }

    /// <summary>The offline chip text.</summary>
    public string OfflineLabel { get; }

    /// <summary>The empty-state note text.</summary>
    public string EmptyNote { get; }

    /// <summary>The localized provider label.</summary>
    public string ProviderLabelText { get; }

    /// <summary>The localized style label.</summary>
    public string StyleLabelText { get; }

    /// <summary>The accessible name a screen reader announces for the surface (provider + style; no key material).</summary>
    public string AccessibleName { get; }

    /// <summary>True while the map-config query is in flight with no value — the busy overlay shows.</summary>
    public bool ShowLoading => State == MapTileLayerVisualState.Loading;

    /// <summary>True when the config query hard-failed with no value — the error overlay + retry show.</summary>
    public bool ShowError => State == MapTileLayerVisualState.Error;

    /// <summary>True when a cached config past the freshness window is shown — the stale chip shows.</summary>
    public bool ShowStaleChip => State == MapTileLayerVisualState.Stale;

    /// <summary>True while offline with a cached config — the offline chip shows.</summary>
    public bool ShowOfflineChip => State == MapTileLayerVisualState.Offline;

    /// <summary>True when no provider resolved and the free community tiles are shown — the empty note shows.</summary>
    public bool ShowEmptyNote => State == MapTileLayerVisualState.Empty;

    /// <summary>
    /// Project a snapshot into a render-ready value, reproducing the web <c>MapTileLayer</c>
    /// (web/src/components/maps/MapTileLayer.tsx): the configured provider tiles always render (free fallback when
    /// unset), the brand attribution is carried verbatim, and the load state drives the overlay chrome. Every
    /// localized string resolves through <paramref name="localizer"/>.
    /// </summary>
    /// <param name="snapshot">The snapshot to project.</param>
    /// <param name="localizer">The i18n facade every string resolves through.</param>
    public static MapTileLayerProjection Project(MapTileLayerSnapshot snapshot, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        string providerLabel = MapTileLayerRegistration.ProviderLabel(snapshot.Provider, localizer);
        string styleLabel = MapTileLayerRegistration.StyleLabel(snapshot.Style, localizer);
        string accessibleName = string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString(MapTileLayerRegistration.AccessibleNameKey, MapTileLayerRegistration.AccessibleNameFallback),
            providerLabel,
            styleLabel);

        return new MapTileLayerProjection(
            snapshot.State,
            snapshot.Config,
            snapshot.Style,
            snapshot.Attribution,
            localizer.GetString(MapTileLayerRegistration.LoadingKey, MapTileLayerRegistration.LoadingFallback),
            localizer.GetString(MapTileLayerRegistration.ErrorTitleKey, MapTileLayerRegistration.ErrorTitleFallback),
            localizer.GetString(MapTileLayerRegistration.ErrorMessageKey, MapTileLayerRegistration.ErrorMessageFallback),
            localizer.GetString(MapTileLayerRegistration.RetryKey, MapTileLayerRegistration.RetryFallback),
            localizer.GetString(MapTileLayerRegistration.StaleKey, MapTileLayerRegistration.StaleFallback),
            localizer.GetString(MapTileLayerRegistration.OfflineKey, MapTileLayerRegistration.OfflineFallback),
            localizer.GetString(MapTileLayerRegistration.EmptyNoteKey, MapTileLayerRegistration.EmptyNoteFallback),
            providerLabel,
            styleLabel,
            accessibleName);
    }
}

/// <summary>
/// PII-safe diagnostics collector for the MapTileLayer surface — emits exactly the <c>view.opened</c> event with
/// the surface slug (P1/S11 contract), mirroring the web component mount. It records no provider key, coordinates
/// or other sensitive material.
/// </summary>
public sealed class MapTileLayerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public MapTileLayerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=MapTileLayer</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={MapTileLayerRegistration.Slug}");
    }
}
