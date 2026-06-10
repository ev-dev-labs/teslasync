using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AISettings"/> view — the native port of the web
/// component's hook composition (web/src/features/settings/components/AISettings.tsx). It drives the
/// cache-then-network settings read through the <see cref="IAiSettingsSource"/> (web <c>useSettings</c>),
/// hydrates the editable Helix draft (web <c>useEffect</c>), owns the mode/feature/provider/restore handlers
/// and the ADR-015 save patch (web <c>handleSave</c> + <c>useSaveAiSettings</c>), and projects today's spend
/// for the cost-cap bar (web <c>AICostCapSpendBar</c> + <c>useAiUsageToday</c>). Every label resolves through
/// the i18n facade so the view is a thin renderer. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class AiSettingsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAiSettingsSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly Dictionary<string, bool> _features = new(StringComparer.Ordinal);

    private CancellationTokenSource? _settingsCts;
    private CancellationTokenSource? _usageCts;
    private AiSettingsSnapshot _snapshot = AiSettingsSnapshot.Empty;
    private AiUsageTodaySnapshot? _usage;
    private string? _appliedSignature;
    private bool _usageStarted;
    private bool _disposed;

    private AiSettingsPanelState _state = AiSettingsPanelState.Loading;
    private AiMode _mode = AiMode.Off;
    private AiProviderDraft _provider = AiProviderDraft.Empty;
    private AiCostCapDisplay _costCapDisplay;
    private bool _restoreDismissed;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private bool _isRefreshing;
    private bool _isSaving;
    private bool _costCapLoading;
    private string? _errorMessage;
    private string? _saveError;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) clock.</summary>
    public AiSettingsViewModel(IAiSettingsSource source, ILocalizer localizer, Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _costCapDisplay = AiSettingsProjection.ProjectCostCap(0, null, false, localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── Panel state ─────────────────────────────────────────────────────────────────────────────────

    /// <summary>The panel's current lifecycle state (loading / loaded / empty / error / stale / offline).</summary>
    public AiSettingsPanelState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The selected Helix mode (web <c>mode</c>).</summary>
    public AiMode Mode
    {
        get => _mode;
        private set
        {
            if (Set(ref _mode, value))
            {
                RaiseDerived();
            }
        }
    }

    /// <summary>The per-feature selection map the save round-trips (web <c>features</c>).</summary>
    public IReadOnlyDictionary<string, bool> Features => _features;

    /// <summary>The editable provider draft (web <c>provider</c>).</summary>
    public AiProviderDraft Provider
    {
        get => _provider;
        private set
        {
            if (Set(ref _provider, value))
            {
                RaiseDerived();
                RecomputeCostCap();
                _ = EnsureCostCapUsageAsync(CancellationToken.None);
            }
        }
    }

    /// <summary>The projected cost-cap spend bar (web <c>AICostCapSpendBar</c>).</summary>
    public AiCostCapDisplay CostCapDisplay
    {
        get => _costCapDisplay;
        private set => Set(ref _costCapDisplay, value);
    }

    /// <summary>True once the user has dismissed (or acted on) the restore prompt this session (web <c>restoreDismissed</c>).</summary>
    public bool RestoreDismissed
    {
        get => _restoreDismissed;
        private set
        {
            if (Set(ref _restoreDismissed, value))
            {
                Raise(nameof(ShowRestorePanel));
            }
        }
    }

    /// <summary>Last successful fetch timestamp (drives the freshness chip).</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background (re)fetch is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last read failed.</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown settings are older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>True while a manual refresh + reload is running (drives the button spinner).</summary>
    public bool IsRefreshing
    {
        get => _isRefreshing;
        private set => Set(ref _isRefreshing, value);
    }

    /// <summary>True while a save is in flight (web <c>saveAi.isPending</c>).</summary>
    public bool IsSaving
    {
        get => _isSaving;
        private set
        {
            if (Set(ref _isSaving, value))
            {
                Raise(nameof(SaveButtonLabel));
                Raise(nameof(CanSave));
            }
        }
    }

    /// <summary>True while today's spend is still loading (web <c>useAiUsageToday().isLoading</c>).</summary>
    public bool CostCapLoading
    {
        get => _costCapLoading;
        private set => Set(ref _costCapLoading, value);
    }

    /// <summary>Localized error message for the read error/offline states (null when not errored).</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Localized message for a failed save (null when the last save succeeded or none ran).</summary>
    public string? SaveError
    {
        get => _saveError;
        private set => Set(ref _saveError, value);
    }

    /// <summary>Load attempts so far (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    // ── Derived flags (web derived state) ──────────────────────────────────────────────────────────

    /// <summary>True when the provider section is shown (web <c>showProviderSection</c> — mode is not off).</summary>
    public bool ShowProviderSection => _mode != AiMode.Off;

    /// <summary>True when the restore prompt is shown (web <c>showRestorePanel</c>).</summary>
    public bool ShowRestorePanel =>
        _mode != AiMode.Off && !_restoreDismissed && _snapshot.HasRestorableArchive;

    /// <summary>True in cloud mode (web <c>isCloud</c>).</summary>
    public bool IsCloud => _mode == AiMode.Cloud;

    /// <summary>True when the cost-cap spend bar is shown (web <c>isCloud &amp;&amp; cost_cap_cents &gt; 0</c>).</summary>
    public bool CostCapVisible => IsCloud && _provider.CostCapCents > 0;

    /// <summary>True when the Save button is enabled (not loading, not already saving).</summary>
    public bool CanSave => !_isSaving && _state != AiSettingsPanelState.Loading;

    // ── Localized copy (web t(...) keys) ─────────────────────────────────────────────────────────────

    /// <summary>Panel title (web <c>ai.settings.title</c>).</summary>
    public string Title => AiSettingsRegistration.Title(_localizer);

    /// <summary>Panel subtitle (web <c>ai.settings.subtitle</c>).</summary>
    public string Subtitle => AiSettingsRegistration.Subtitle(_localizer);

    /// <summary>Mode group legend (web <c>ai.settings.modeLegend</c>).</summary>
    public string ModeLegend => _localizer.GetString("ai.settings.modeLegend", "Helix mode");

    /// <summary>Off mode label (web <c>ai.settings.mode.off</c>).</summary>
    public string ModeOffLabel => _localizer.GetString("ai.settings.mode.off", "Off (default)");

    /// <summary>Off mode description (web <c>ai.settings.mode.offHint</c>).</summary>
    public string ModeOffHint =>
        _localizer.GetString("ai.settings.mode.offHint", "Helix is off. The app works fully without it.");

    /// <summary>Local mode label (web <c>ai.settings.mode.local</c>).</summary>
    public string ModeLocalLabel => _localizer.GetString("ai.settings.mode.local", "Local-only");

    /// <summary>Local mode description (web <c>ai.settings.mode.localHint</c>).</summary>
    public string ModeLocalHint => _localizer.GetString(
        "ai.settings.mode.localHint",
        "Use a private model on your network (e.g. Ollama). No data leaves your install.");

    /// <summary>Cloud mode label (web <c>ai.settings.mode.cloud</c>).</summary>
    public string ModeCloudLabel => _localizer.GetString("ai.settings.mode.cloud", "Cloud");

    /// <summary>Cloud mode description (web <c>ai.settings.mode.cloudHint</c>).</summary>
    public string ModeCloudHint => _localizer.GetString(
        "ai.settings.mode.cloudHint",
        "Use a cloud provider (e.g. OpenAI). Requires an API key.");

    /// <summary>Off-mode banner under the picker (web <c>ai.settings.bannerOff</c>).</summary>
    public string BannerOff => _localizer.GetString(
        "ai.settings.bannerOff",
        "Helix is off. Your app works fully without it. Enable a mode above to opt in.");

    /// <summary>Save button label (web <c>ai.settings.save</c>).</summary>
    public string SaveLabel => _localizer.GetString("ai.settings.save", "Save Helix settings");

    /// <summary>Save button busy label (web <c>ai.settings.saving</c>).</summary>
    public string SavingLabel => _localizer.GetString("ai.settings.saving", "Saving\u2026");

    /// <summary>The save button's current label (busy or idle).</summary>
    public string SaveButtonLabel => _isSaving ? SavingLabel : SaveLabel;

    /// <summary>Loading announcement (native superset state).</summary>
    public string LoadingLabel => _localizer.GetString("ai.settings.loading", "Loading Helix settings\u2026");

    /// <summary>Hard read-failure message (native superset state).</summary>
    public string ErrorMessageDefault => _localizer.GetString(
        "ai.settings.error",
        "Could not load Helix settings. Check the API and try again.");

    /// <summary>Retry affordance label (native superset state).</summary>
    public string RetryLabel => _localizer.GetString("ai.settings.retry", "Retry");

    /// <summary>Default save-failure message (native equivalent of the web error toast).</summary>
    public string SaveErrorDefault => _localizer.GetString(
        "ai.settings.saveError",
        "Could not save Helix settings. Check the API and try again.");

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Run (or re-run) the cache-then-network settings load (web initial query).</summary>
    public Task LoadAsync(CancellationToken cancellationToken = default) => LoadInternalAsync(cancellationToken);

    /// <summary>Manual "Refresh" — re-run the settings load with the button in its busy state.</summary>
    public async Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        if (_isRefreshing)
        {
            return;
        }

        IsRefreshing = true;
        IsFetching = true;
        try
        {
            await LoadInternalAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            IsRefreshing = false;
        }
    }

    /// <summary>Retry after a hard read failure.</summary>
    public Task RetryAsync(CancellationToken cancellationToken = default) => LoadInternalAsync(cancellationToken);

    /// <summary>Change the Helix mode (web <c>handleModeChange</c>); switching to off clears the in-flight selection.</summary>
    public void SetMode(AiMode next)
    {
        if (next == _mode)
        {
            return;
        }

        Mode = next;
        if (next == AiMode.Off && _features.Count > 0)
        {
            _features.Clear();
            Raise(nameof(Features));
        }

        RecomputeCostCap();
        _ = EnsureCostCapUsageAsync(CancellationToken.None);
    }

    /// <summary>Toggle one feature in the local selection (web <c>handleFeatureToggle</c>).</summary>
    public void ToggleFeature(string id, bool value)
    {
        ArgumentNullException.ThrowIfNull(id);
        _features[id] = value;
        Raise(nameof(Features));
    }

    /// <summary>Apply a provider edit, reloading the saved config on a provider-name switch (web <c>handleProviderChange</c>).</summary>
    public void UpdateProvider(AiProviderDraft next)
    {
        ArgumentNullException.ThrowIfNull(next);
        Provider = string.Equals(next.Provider, _provider.Provider, StringComparison.Ordinal)
            ? next
            : AiSettingsProjection.SwitchProvider(_snapshot, next.Provider, next.CostCapCents);
    }

    /// <summary>Apply the archived selection and persist it (web <c>handleRestoreConfirm</c>).</summary>
    public async Task ConfirmRestoreAsync(CancellationToken cancellationToken = default)
    {
        if (!_snapshot.HasRestorableArchive)
        {
            return;
        }

        var restored = new Dictionary<string, bool>(_snapshot.FeaturesArchived, StringComparer.Ordinal);
        _features.Clear();
        foreach (var pair in restored)
        {
            _features[pair.Key] = pair.Value;
        }

        Raise(nameof(Features));
        RestoreDismissed = true;

        var document = AiSettingsPatchBuilder.BuildFeaturesDocument(_mode, restored, _snapshot.DocumentJson);
        await DoSaveAsync(document, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Dismiss the restore prompt for the rest of the session (web <c>handleRestoreDecline</c>).</summary>
    public void DeclineRestore() => RestoreDismissed = true;

    /// <summary>Build the ADR-015 save patch and persist it (web <c>handleSave</c> + <c>useSaveAiSettings</c>).</summary>
    public async Task SaveAsync(CancellationToken cancellationToken = default)
    {
        if (_isSaving)
        {
            return;
        }

        var document = AiSettingsPatchBuilder.BuildSaveDocument(_mode, _features, _provider, _snapshot.DocumentJson);
        await DoSaveAsync(document, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _settingsCts);
        Cancel(ref _usageCts);
        GC.SuppressFinalize(this);
    }

    // ── Internals ────────────────────────────────────────────────────────────────────────────────────

    private async Task StreamSettingsAsync(CancellationToken cancellationToken)
    {
        var cts = Supersede(ref _settingsCts, cancellationToken);
        Attempts++;
        if (_snapshot.DocumentJson is null && !_isRefreshing)
        {
            State = AiSettingsPanelState.Loading;
        }
        else
        {
            IsFetching = true;
        }

        try
        {
            await foreach (var result in _source.StreamSettingsAsync(cts.Token).ConfigureAwait(false))
            {
                ApplySettings(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    private void ApplySettings(RepositoryResult<AiSettingsSnapshot> result)
    {
        _snapshot = NextSnapshot(result, _snapshot);

        if (result.Status is not LoadStatus.Loading and not LoadStatus.Error)
        {
            var signature = _snapshot.Signature();
            if (!string.Equals(signature, _appliedSignature, StringComparison.Ordinal))
            {
                _appliedSignature = signature;
                HydrateDraft(_snapshot);
            }
        }

        var outcome = Classify(result, _snapshot.DocumentJson is not null);
        State = outcome.State;
        IsFetching = outcome.IsFetching;
        IsError = outcome.IsError;
        IsStale = outcome.IsStale;
        ErrorMessage = outcome.ErrorMessage;
        if (outcome.UpdatedAt is { } ts)
        {
            UpdatedAt = ts;
        }

        Raise(nameof(CanSave));
    }

    private void HydrateDraft(AiSettingsSnapshot snapshot)
    {
        _mode = snapshot.Mode;
        _features.Clear();
        foreach (var pair in snapshot.Features)
        {
            _features[pair.Key] = pair.Value;
        }

        _provider = AiSettingsProjection.InitProvider(snapshot);
        _restoreDismissed = false;
        _usageStarted = false;

        Raise(nameof(Mode));
        Raise(nameof(Features));
        Raise(nameof(Provider));
        Raise(nameof(RestoreDismissed));
        RaiseDerived();
        RecomputeCostCap();
    }

    private SectionOutcome Classify(RepositoryResult<AiSettingsSnapshot> result, bool hasContent) =>
        result.Status switch
        {
            LoadStatus.Loading => hasContent
                ? new SectionOutcome(AiSettingsPanelState.Loaded, true, false, false, null, null)
                : new SectionOutcome(AiSettingsPanelState.Loading, true, false, false, null, null),

            LoadStatus.Cached => new SectionOutcome(
                hasContent ? StaleOrLoaded(result.IsStale) : AiSettingsPanelState.Empty,
                true, false, hasContent && result.IsStale, null, result.FetchedAt),

            LoadStatus.Refreshing => new SectionOutcome(
                hasContent ? StaleOrLoaded(result.IsStale) : AiSettingsPanelState.Empty,
                true, false, hasContent && result.IsStale, null, result.FetchedAt),

            LoadStatus.Loaded => new SectionOutcome(
                hasContent ? AiSettingsPanelState.Loaded : AiSettingsPanelState.Empty,
                false, false, false, null, result.FetchedAt),

            LoadStatus.Empty => new SectionOutcome(
                AiSettingsPanelState.Empty, false, false, false, null, result.FetchedAt),

            LoadStatus.Offline => hasContent
                ? new SectionOutcome(AiSettingsPanelState.Offline, false, true, true, ErrorMessageDefault, result.FetchedAt)
                : new SectionOutcome(AiSettingsPanelState.Error, false, true, false, ErrorMessageDefault, result.FetchedAt),

            _ => new SectionOutcome(AiSettingsPanelState.Error, false, true, false, ErrorMessageDefault, null),
        };

    private static AiSettingsPanelState StaleOrLoaded(bool stale) =>
        stale ? AiSettingsPanelState.Stale : AiSettingsPanelState.Loaded;

    private static AiSettingsSnapshot NextSnapshot(
        RepositoryResult<AiSettingsSnapshot> result,
        AiSettingsSnapshot previous) =>
        result.Status switch
        {
            LoadStatus.Loading => previous,
            LoadStatus.Empty or LoadStatus.Error => AiSettingsSnapshot.Empty,
            _ => result.Value ?? previous,
        };

    private async Task DoSaveAsync(System.Text.Json.Nodes.JsonObject document, CancellationToken cancellationToken)
    {
        IsSaving = true;
        SaveError = null;
        try
        {
            var outcome = await _source.SaveAsync(document, cancellationToken).ConfigureAwait(false);
            if (outcome.Success && outcome.Snapshot is { } snapshot)
            {
                ApplySavedSnapshot(snapshot);
            }
            else
            {
                SaveError = outcome.Error?.Message is { Length: > 0 } message ? message : SaveErrorDefault;
            }
        }
        catch (OperationCanceledException)
        {
            // The surface was torn down mid-save — drop the result silently.
        }
        finally
        {
            IsSaving = false;
        }
    }

    private void ApplySavedSnapshot(AiSettingsSnapshot snapshot)
    {
        _snapshot = snapshot;
        _appliedSignature = snapshot.Signature();
        HydrateDraft(snapshot);

        State = AiSettingsPanelState.Loaded;
        IsError = false;
        IsStale = false;
        UpdatedAt = _clock();
        Raise(nameof(CanSave));
    }

    private async Task LoadInternalAsync(CancellationToken cancellationToken)
    {
        await StreamSettingsAsync(cancellationToken).ConfigureAwait(false);
        await EnsureCostCapUsageAsync(cancellationToken).ConfigureAwait(false);
    }

    private void RecomputeCostCap()
    {
        Raise(nameof(CostCapVisible));
        CostCapDisplay = AiSettingsProjection.ProjectCostCap(
            _provider.CostCapCents, _usage, _costCapLoading && _usage is null, _localizer);
    }

    private async Task EnsureCostCapUsageAsync(CancellationToken cancellationToken)
    {
        if (!CostCapVisible || _usageStarted)
        {
            return;
        }

        _usageStarted = true;
        CostCapLoading = _usage is null;
        RecomputeCostCap();
        await StreamUsageAsync(cancellationToken).ConfigureAwait(false);
    }

    private async Task StreamUsageAsync(CancellationToken cancellationToken)
    {
        var cts = Supersede(ref _usageCts, cancellationToken);
        try
        {
            await foreach (var result in _source.StreamUsageTodayAsync(cts.Token).ConfigureAwait(false))
            {
                ApplyUsage(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded (or disposed) — drop silently.
        }
    }

    private void ApplyUsage(RepositoryResult<AiUsageTodaySnapshot> result)
    {
        if (result.Value is { } value)
        {
            _usage = value;
        }

        CostCapLoading = result.Status == LoadStatus.Loading && _usage is null;
        CostCapDisplay = AiSettingsProjection.ProjectCostCap(
            _provider.CostCapCents, _usage, _costCapLoading, _localizer);
    }

    private void RaiseDerived()
    {
        Raise(nameof(ShowProviderSection));
        Raise(nameof(ShowRestorePanel));
        Raise(nameof(IsCloud));
        Raise(nameof(CostCapVisible));
    }

    private static CancellationTokenSource Supersede(ref CancellationTokenSource? slot, CancellationToken cancellationToken)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref slot, cts);
        previous?.Cancel();
        previous?.Dispose();
        return cts;
    }

    private static void Cancel(ref CancellationTokenSource? slot)
    {
        var cts = Interlocked.Exchange(ref slot, null);
        cts?.Cancel();
        cts?.Dispose();
    }

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        Raise(name);
        return true;
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));

    private readonly record struct SectionOutcome(
        AiSettingsPanelState State,
        bool IsFetching,
        bool IsError,
        bool IsStale,
        string? ErrorMessage,
        DateTimeOffset? UpdatedAt);
}
