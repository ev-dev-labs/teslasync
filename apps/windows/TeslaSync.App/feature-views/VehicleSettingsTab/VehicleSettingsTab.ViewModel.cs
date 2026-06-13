using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Vehicles;

/// <summary>The tone of a transient notice raised for the toast surface (web <c>useMutationToast</c>).</summary>
public enum VehicleSettingsTabNoticeKind
{
    /// <summary>A successful mutation (web <c>toast.success</c>).</summary>
    Success,

    /// <summary>A failed mutation (web <c>toast.error</c>).</summary>
    Error,
}

/// <summary>A localized transient notice for the toast surface (web mutation <c>onSuccess</c> / <c>onError</c>).</summary>
public sealed record VehicleSettingsTabNotice(VehicleSettingsTabNoticeKind Kind, string Message);

/// <summary>
/// UI-thread-free state holder for one editable per-vehicle setting row — the native port of the web
/// <c>VehicleSettingRow</c> sub-component. It seeds an editable <see cref="Draft"/> from the resolved effective value
/// (re-seeding only when the effective value actually changes — the web <c>useEffect([initialDraft])</c> guard, which
/// keeps a field's edits while a background refresh runs), exposes the dirty diff that arms the Save button and the
/// override flag that arms the Reset button, and carries the projected <see cref="Display"/> (label, help, source
/// pill). All mutation orchestration lives on the parent <see cref="VehicleSettingsTabViewModel"/>; this row only
/// holds the per-row edit state.
/// </summary>
public sealed class VehicleSettingRowViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;

    private string _initialDraft = string.Empty;
    private string _draft = string.Empty;
    private string? _validationError;
    private bool _isSaving;
    private bool _isResetting;
    private VehicleSettingRowDisplay _display;

    /// <summary>Creates the row over its descriptor and the i18n facade, seeded from an (optional) effective value.</summary>
    /// <param name="descriptor">The static per-key descriptor (kind, options, length).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="effective">The resolved effective value, or null when the key has no resolved row.</param>
    public VehicleSettingRowViewModel(VehicleSettingDescriptor descriptor, ILocalizer localizer, EffectiveSettingData? effective)
    {
        ArgumentNullException.ThrowIfNull(descriptor);
        ArgumentNullException.ThrowIfNull(localizer);

        Descriptor = descriptor;
        _localizer = localizer;
        _display = VehicleSettingsTabProjection.ProjectRow(descriptor, effective, localizer);
        _initialDraft = _display.InitialDraft;
        _draft = _initialDraft;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The static per-key descriptor (kind, options, max length, autocomplete).</summary>
    public VehicleSettingDescriptor Descriptor { get; }

    /// <summary>The setting key (web <c>descriptor.key</c>).</summary>
    public string Key => Descriptor.Key;

    /// <summary>The projected, render-ready row chrome (label, help, source pill, automation ids).</summary>
    public VehicleSettingRowDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The current editable draft (always a string so every kind renders uniformly).</summary>
    public string Draft
    {
        get => _draft;
        set
        {
            if (Set(ref _draft, value ?? string.Empty))
            {
                Raise(nameof(IsDirty));
                Raise(nameof(CanSave));
            }
        }
    }

    /// <summary>The inline validation error to show under the input, or null when valid (web <c>validationError</c>).</summary>
    public string? ValidationError
    {
        get => _validationError;
        private set
        {
            if (Set(ref _validationError, value))
            {
                Raise(nameof(HasValidationError));
            }
        }
    }

    /// <summary>True while this row's upsert is in flight (web <c>upsert.isPending</c>).</summary>
    public bool IsSaving
    {
        get => _isSaving;
        internal set
        {
            if (Set(ref _isSaving, value))
            {
                Raise(nameof(CanSave));
            }
        }
    }

    /// <summary>True while this row's reset is in flight (web <c>reset.isPending</c>).</summary>
    public bool IsResetting
    {
        get => _isResetting;
        internal set
        {
            if (Set(ref _isResetting, value))
            {
                Raise(nameof(CanReset));
            }
        }
    }

    /// <summary>True when the draft differs from the seeded effective value (web <c>dirty</c>).</summary>
    public bool IsDirty => !string.Equals(_draft, _initialDraft, StringComparison.Ordinal);

    /// <summary>True when an inline validation error is present.</summary>
    public bool HasValidationError => _validationError is not null;

    /// <summary>True when the resolved value is a per-vehicle override (the only source that can be reset).</summary>
    public bool IsOverride => _display.IsOverride;

    /// <summary>True when the Save button is enabled (dirty and not already saving).</summary>
    public bool CanSave => IsDirty && !_isSaving;

    /// <summary>True when the Reset button is enabled (an override that is not already resetting).</summary>
    public bool CanReset => IsOverride && !_isResetting;

    /// <summary>The seeded draft the dirty diff compares against (the web <c>initialDraft</c>).</summary>
    public string InitialDraft => _initialDraft;

    /// <summary>
    /// Fold a new resolved effective value into the row. The source pill / display always refreshes; the editable
    /// draft is re-seeded (and the validation error cleared) only when the seeded value actually changes — the web
    /// <c>useEffect([initialDraft])</c> dependency, so a field keeps its in-progress edits during a background refresh.
    /// </summary>
    public void UpdateEffective(EffectiveSettingData? effective)
    {
        Display = VehicleSettingsTabProjection.ProjectRow(Descriptor, effective, _localizer);
        Raise(nameof(IsOverride));
        Raise(nameof(CanReset));

        string nextInitial = Display.InitialDraft;
        if (!string.Equals(nextInitial, _initialDraft, StringComparison.Ordinal))
        {
            _initialDraft = nextInitial;
            ValidationError = null;
            Draft = nextInitial;
            Raise(nameof(InitialDraft));
        }
        else
        {
            Raise(nameof(IsDirty));
            Raise(nameof(CanSave));
        }
    }

    /// <summary>Clear the inline validation error at the start of a save attempt (web <c>setValidationError(null)</c>).</summary>
    internal void ClearValidationError() => ValidationError = null;

    /// <summary>Surface an inline validation error (web <c>setValidationError(...)</c>).</summary>
    internal void SetValidationError(string message) => ValidationError = message;

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
        return true;
    }

    private void Raise(string name) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>VehicleSettingsTab</c> view — the native port of the web
/// component (web/src/features/vehicles/components/VehicleSettingsTab.tsx). It streams the cache-then-network
/// per-vehicle settings (the web <c>useVehicleSettings</c> read) through the injected
/// <see cref="IVehicleSettingsTabSource"/>, folds every emission into the mutually-exclusive <see cref="State"/>
/// (loading / loaded / empty / error / stale / offline) and the header freshness flags, and keeps one stable
/// <see cref="VehicleSettingRowViewModel"/> per descriptor whose effective value is refreshed in place. The per-key
/// <see cref="SaveRowAsync"/> / <see cref="ResetRowAsync"/> reproduce the web upsert / reset mutations — validating
/// the draft, surfacing the toast and re-reading the resolver so the saved value flows back (the web
/// <c>invalidateAndBroadcast</c>). Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class VehicleSettingsTabViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IVehicleSettingsTabSource _source;
    private readonly ILocalizer _localizer;
    private readonly VehicleSettingsTabDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;
    private readonly long _vehicleId;
    private readonly IReadOnlyList<VehicleSettingRowViewModel> _rows;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private VehicleSettingsData _settings = VehicleSettingsData.Empty;
    private VehicleSettingsTabState _state = VehicleSettingsTabState.Loading;
    private VehicleSettingsTabDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, vehicle id and (optional) clock / diagnostics.</summary>
    /// <param name="source">The per-vehicle settings data port (read + upsert + reset).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="vehicleId">The vehicle id from the route (web <c>vehicleId</c> prop).</param>
    /// <param name="clock">Injectable clock for deterministic freshness in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public VehicleSettingsTabViewModel(
        IVehicleSettingsTabSource source,
        ILocalizer localizer,
        long vehicleId,
        Func<DateTimeOffset>? clock = null,
        VehicleSettingsTabDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _vehicleId = vehicleId;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new VehicleSettingsTabDiagnostics();

        _rows = VehicleSettingDescriptor.All
            .Select(descriptor => new VehicleSettingRowViewModel(descriptor, localizer, _settings.Find(descriptor.Key)))
            .ToArray();
        _display = VehicleSettingsTabProjection.Project(_state, _settings, localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised with a localized transient notice for the toast surface (web <c>useMutationToast</c>).</summary>
    public event EventHandler<VehicleSettingsTabNotice>? NoticeRequested;

    /// <summary>The current top-level data state (loading / loaded / empty / error / stale / offline).</summary>
    public VehicleSettingsTabState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready surface chrome the view binds to.</summary>
    public VehicleSettingsTabDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The stable per-descriptor row state holders (one per whitelist key, in render order).</summary>
    public IReadOnlyList<VehicleSettingRowViewModel> Rows => _rows;

    /// <summary>True while a (re)fetch is in flight (the header freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed with no cache (drives the error surface + header chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown payload is older than the freshness window (stale or offline).</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>The localized error / offline message (web <c>ErrorDisplay</c> text), or null when healthy.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Last successful update timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>Number of load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>The vehicle id this holder is bound to.</summary>
    public long VehicleId => _vehicleId;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Run (or re-run) the cache-then-network settings load: counts the attempt, shows the skeleton only when nothing
    /// is already visible (otherwise keeps the rows while refreshing), and folds every emission into
    /// <see cref="State"/>. A superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Attempts++;
        if (!HasContent())
        {
            SetLoading();
        }
        else
        {
            IsFetching = true;
            Reproject();
        }

        try
        {
            await foreach (var result in _source.StreamSettingsAsync(_vehicleId, cts.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    /// <summary>Refresh the settings (web query refetch).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Retry after a failure — re-runs the load from the top (web <c>ErrorDisplay onRetry</c>).</summary>
    public Task RetryAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>
    /// Save one row (web <c>handleSave</c> + <c>useUpsertVehicleSetting</c>): clears any prior error, validates the
    /// draft (empty → "required"; invalid → the kind-specific message), then upserts the typed value. On success it
    /// raises the saved toast and re-reads the resolver so the committed value flows back; on failure it raises the
    /// error toast and keeps the edited draft for a retry. Concurrent saves of the same row are ignored.
    /// </summary>
    public async Task SaveRowAsync(VehicleSettingRowViewModel row, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(row);
        if (_disposed || row.IsSaving)
        {
            return;
        }

        row.ClearValidationError();

        var parsed = VehicleSettingDraft.ParseDraft(row.Descriptor, row.Draft);
        switch (parsed.Status)
        {
            case VehicleSettingParseStatus.Empty:
                row.SetValidationError(_display.RequiredMessage);
                return;
            case VehicleSettingParseStatus.Invalid:
                row.SetValidationError(_localizer.GetString(parsed.MessageKey!, parsed.Fallback!));
                return;
        }

        row.IsSaving = true;
        try
        {
            await _source.UpsertAsync(_vehicleId, row.Key, parsed.Value!, cancellationToken).ConfigureAwait(false);
            RaiseNotice(VehicleSettingsTabNoticeKind.Success, _display.SavedToast);
            await LoadAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Superseded / disposed — leave the draft intact for a later retry.
        }
        catch (Exception)
        {
            RaiseNotice(VehicleSettingsTabNoticeKind.Error, _display.SaveFailedToast);
        }
        finally
        {
            row.IsSaving = false;
        }
    }

    /// <summary>
    /// Reset one row to its default (web <c>handleReset</c> + <c>useResetVehicleSetting</c>): a no-op unless the row
    /// is a per-vehicle override. On success it raises the reverted toast and re-reads the resolver; on failure it
    /// raises the error toast. Concurrent resets of the same row are ignored.
    /// </summary>
    public async Task ResetRowAsync(VehicleSettingRowViewModel row, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(row);
        if (_disposed || row.IsResetting || !row.IsOverride)
        {
            return;
        }

        row.IsResetting = true;
        try
        {
            await _source.ResetAsync(_vehicleId, row.Key, cancellationToken).ConfigureAwait(false);
            RaiseNotice(VehicleSettingsTabNoticeKind.Success, _display.ResetToast);
            await LoadAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Superseded / disposed.
        }
        catch (Exception)
        {
            RaiseNotice(VehicleSettingsTabNoticeKind.Error, _display.ResetFailedToast);
        }
        finally
        {
            row.IsResetting = false;
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
        GC.SuppressFinalize(this);
    }

    private bool HasContent() =>
        _state is VehicleSettingsTabState.Loaded
            or VehicleSettingsTabState.Empty
            or VehicleSettingsTabState.Stale
            or VehicleSettingsTabState.Offline;

    private void Apply(RepositoryResult<VehicleSettingsData> result)
    {
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!HasContent())
                {
                    SetLoading();
                }

                IsFetching = true;
                Reproject();
                break;

            case LoadStatus.Cached:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: false, offline: false);
                break;

            case LoadStatus.Refreshing:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: true, offline: false);
                break;

            case LoadStatus.Loaded:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: false, fetching: false, offline: false);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: true, fetching: false, offline: true);
                break;

            default:
                SetError();
                break;
        }
    }

    private void ApplySnapshot(
        VehicleSettingsData settings,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        bool offline)
    {
        _settings = settings;
        UpdateRows(settings);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? _localizer.GetString("vehicleSettings.error", "Could not load vehicle settings.") : null;

        State = offline
            ? VehicleSettingsTabState.Offline
            : stale
                ? VehicleSettingsTabState.Stale
                : VehicleSettingsTabState.Loaded;

        Reproject();
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = VehicleSettingsTabState.Loading;
        Reproject();
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        // The resolver always returns the full key whitelist, so an empty payload is unusual; the rows still render
        // with their system defaults (web maps the static descriptor list regardless of the payload).
        _settings = VehicleSettingsData.Empty;
        UpdateRows(_settings);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = VehicleSettingsTabState.Empty;
        Reproject();
    }

    private void SetError()
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        // Web passes a fixed `t('vehicleSettings.error')` to ErrorDisplay regardless of the underlying failure.
        ErrorMessage = _localizer.GetString("vehicleSettings.error", "Could not load vehicle settings.");
        State = VehicleSettingsTabState.Error;
        Reproject();
    }

    private void UpdateRows(VehicleSettingsData settings)
    {
        foreach (var row in _rows)
        {
            row.UpdateEffective(settings.Find(row.Key));
        }
    }

    private void Reproject() => Display = VehicleSettingsTabProjection.Project(_state, _settings, _localizer);

    private void RaiseNotice(VehicleSettingsTabNoticeKind kind, string message) =>
        NoticeRequested?.Invoke(this, new VehicleSettingsTabNotice(kind, message));

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
