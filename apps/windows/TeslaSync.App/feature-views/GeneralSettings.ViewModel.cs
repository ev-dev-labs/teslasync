using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="GeneralSettings"/> view — the native port of the web
/// <c>GeneralSettings</c> component (web/src/features/settings/components/GeneralSettings.tsx). It binds the
/// cache-then-network <see cref="IGeneralSettingsSource"/> (the web <c>useSettings</c> read + <c>useSaveSettings</c>
/// save + <c>useVehicles</c> / <c>useCarPreferences</c> reads), hydrates an editable <see cref="Draft"/> from the
/// server snapshot exactly once (the web <c>formInited</c> guard), and exposes the mutually-exclusive
/// <see cref="State"/> plus the freshness flags so the view is a thin renderer. <see cref="SaveAsync"/> sends the
/// whole document through the web full-replace pattern with an optimistic <see cref="IsSaving"/> flag;
/// <see cref="SyncFromCarAsync"/> applies the vehicle's reported units to the draft and saves (the web
/// <c>syncUnitsFromCar</c>). <see cref="IsDirty"/> + <see cref="UnsavedChangesMessage"/> reproduce the web
/// <c>useNavigationGuard</c> contract for the host. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class GeneralSettingsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IGeneralSettingsSource _source;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private bool _disposed;
    private bool _formInited;
    private bool _contextRequested;

    private GeneralSettingsState _state = GeneralSettingsState.Loading;
    private GeneralServerSettings _serverSettings = GeneralServerSettings.Default;
    private GeneralFormValues _draft = GeneralFormValues.Default;
    private CarPreferences? _carPrefs;
    private VehicleSummary? _vehicle;
    private GeneralSettingsDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private bool _isSaving;
    private bool _justSaved;
    private string? _errorMessage;
    private int _attempts;
    private int _formEpoch;

    /// <summary>Creates the holder over its settings source and localizer.</summary>
    /// <param name="source">The cache-then-network settings source (read + save + vehicle/car-pref reads).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public GeneralSettingsViewModel(IGeneralSettingsSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _display = GeneralSettingsProjection.Project(localizer, carPrefs: null);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised with a localized transient notice for the toast surface (web <c>useToast</c>).</summary>
    public event EventHandler<GeneralSettingsNotice>? NoticeRequested;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public GeneralSettingsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display chrome (titles, labels, options, banners).</summary>
    public GeneralSettingsDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
        }
    }

    /// <summary>The current editable form values (the web in-progress <c>form</c>).</summary>
    public GeneralFormValues Draft => _draft;

    /// <summary>The current parsed server-side settings snapshot (the web <c>settings</c>).</summary>
    public GeneralServerSettings ServerSettings => _serverSettings;

    /// <summary>The vehicle whose preferences drive the sync banner (web <c>vehicles?.[0]</c>), or null.</summary>
    public VehicleSummary? Vehicle => _vehicle;

    /// <summary>The vehicle's reported preferences (web <c>carPrefs</c>), or null when unavailable.</summary>
    public CarPreferences? CarPreferences => _carPrefs;

    /// <summary>
    /// Monotonic counter bumped whenever the <see cref="Draft"/> is replaced programmatically (initial hydrate, save
    /// success, sync-from-car). The view re-reads the draft into its controls when this changes; user edits do not
    /// bump it, so a text field keeps focus while typing.
    /// </summary>
    public int FormEpoch
    {
        get => _formEpoch;
        private set => Set(ref _formEpoch, value);
    }

    /// <summary>Last successful update timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background settings refresh is in flight (header chip pulses).</summary>
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

    /// <summary>True when the shown settings document is older than the freshness window (stale or offline).</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>True while a save is in flight (the web <c>saveSettings.isPending</c>).</summary>
    public bool IsSaving
    {
        get => _isSaving;
        private set
        {
            if (Set(ref _isSaving, value))
            {
                Raise(nameof(IsDirty));
            }
        }
    }

    /// <summary>True for the brief window after a successful save (the web 3-second "Settings saved" confirmation).</summary>
    public bool JustSaved
    {
        get => _justSaved;
        private set => Set(ref _justSaved, value);
    }

    /// <summary>Localized error / offline message shown in the error surface or offline chip.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Number of load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>
    /// True when the draft differs from the committed server snapshot and no save is in flight — the web
    /// <c>isDirty</c> diff (<c>JSON.stringify(form) !== JSON.stringify(settings)</c>) that arms the navigation guard.
    /// False until the form is hydrated.
    /// </summary>
    public bool IsDirty => _formInited && !_isSaving && !_draft.Equals(_serverSettings.Form);

    /// <summary>The unsaved-changes prompt for the host navigation guard (web <c>useNavigationGuard</c> message).</summary>
    public string UnsavedChangesMessage =>
        _localizer.GetString("translation.forms.unsavedSettings", "You have unsaved settings.");

    /// <summary>Localized surface title (Narrator name / host chrome).</summary>
    public string Title => GeneralSettingsRegistration.Title(_localizer);

    /// <summary>
    /// Run a cache-then-network settings load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), folds every emission into <see cref="State"/>, and kicks
    /// off the best-effort vehicle/car-preference reads in parallel (the web <c>useVehicles</c> query is independent
    /// of <c>useSettings</c>). A superseding load cancels the prior one.
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
        }

        _ = LoadVehicleContextAsync(cts.Token);

        try
        {
            await foreach (var result in _source.StreamSettingsAsync(cts.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    /// <summary>Retry after a failure — re-runs the load from the top.</summary>
    public Task RetryAsync()
    {
        _contextRequested = false;
        return LoadAsync();
    }

    /// <summary>Set the distance unit on the draft (web <c>setForm({ unit_of_length })</c>).</summary>
    public void SetDistanceUnit(DistanceUnit value) => UpdateDraft(_draft with { DistanceUnit = value });

    /// <summary>Set the temperature unit on the draft (web <c>setForm({ unit_of_temp })</c>).</summary>
    public void SetTemperatureUnit(TemperatureUnit value) => UpdateDraft(_draft with { TemperatureUnit = value });

    /// <summary>Set the tyre-pressure unit on the draft (web <c>setForm({ unit_of_pressure })</c>).</summary>
    public void SetPressureUnit(PressureUnit value) => UpdateDraft(_draft with { PressureUnit = value });

    /// <summary>Set the preferred range on the draft (web <c>setForm({ preferred_range })</c>).</summary>
    public void SetPreferredRange(PreferredRange value) => UpdateDraft(_draft with { PreferredRange = value });

    /// <summary>Set the decimal precision on the draft, clamped to 0–20 (web <c>setForm({ decimal_precision })</c>).</summary>
    public void SetDecimalPrecision(int value) => UpdateDraft(_draft.WithDecimalPrecision(value));

    /// <summary>Set the UI language on the draft (web <c>setForm({ language })</c>).</summary>
    public void SetLanguage(string value) => UpdateDraft(_draft with { Language = value ?? string.Empty });

    /// <summary>Set the currency symbol on the draft (web <c>setForm({ currency_symbol })</c>).</summary>
    public void SetCurrencySymbol(string value) => UpdateDraft(_draft with { CurrencySymbol = value ?? string.Empty });

    /// <summary>Set the number/date locale on the draft (web <c>setForm({ locale })</c>).</summary>
    public void SetLocale(string value) => UpdateDraft(_draft with { Locale = value ?? string.Empty });

    /// <summary>Set the default time-zone display on the draft (web <c>setForm({ tz_display_default })</c>).</summary>
    public void SetTimeZoneDisplay(TimeZoneDisplay value) => UpdateDraft(_draft with { TzDisplayDefault = value });

    /// <summary>Set the IANA time-zone override on the draft (web <c>setForm({ timezone_user })</c>).</summary>
    public void SetTimezoneUser(string value) => UpdateDraft(_draft with { TimezoneUser = value ?? string.Empty });

    /// <summary>Set the electricity cost per kWh on the draft (web <c>setForm({ base_cost_per_kwh })</c>).</summary>
    public void SetBaseCostPerKwh(double value) => UpdateDraft(_draft with { BaseCostPerKwh = value });

    /// <summary>Set the gas price per unit on the draft (web <c>setForm({ gas_price_per_unit })</c>).</summary>
    public void SetGasPricePerUnit(double value) => UpdateDraft(_draft with { GasPricePerUnit = value });

    /// <summary>Set the gas-price denominator on the draft (web <c>setForm({ gas_unit })</c>).</summary>
    public void SetGasUnit(GasUnit value) => UpdateDraft(_draft with { GasUnit = value });

    /// <summary>Set the comparison-vehicle MPG on the draft (web <c>setForm({ gas_efficiency_mpg })</c>).</summary>
    public void SetGasEfficiencyMpg(double value) => UpdateDraft(_draft with { GasEfficiencyMpg = value });

    /// <summary>Save the whole draft with the web full-replace merge (the "Save Settings" button).</summary>
    public Task SaveAsync(CancellationToken cancellationToken = default) =>
        SaveInternalAsync(_draft, SavedNotice, cancellationToken);

    /// <summary>
    /// Apply the vehicle's reported units to the draft and save (the web <c>syncUnitsFromCar</c>): when at least one
    /// unit is detected it merges + saves with the "Units synced from car" notice (web parity: a detected unit is
    /// written even when it already equals the current value); otherwise it raises the "No changes" info notice. A
    /// no-op when no car preferences are available (the web <c>if (!carPrefs) return</c> guard).
    /// </summary>
    public Task SyncFromCarAsync(CancellationToken cancellationToken = default)
    {
        if (_carPrefs is null)
        {
            return Task.CompletedTask;
        }

        DistanceUnit? distance = null;
        TemperatureUnit? temperature = null;
        PressureUnit? pressure = null;

        if (SettingEnumParser.IsMiles(_carPrefs.DistanceUnit))
        {
            distance = DistanceUnit.Mi;
        }
        else if (!string.IsNullOrWhiteSpace(_carPrefs.DistanceUnit))
        {
            distance = DistanceUnit.Km;
        }

        if (SettingEnumParser.IsFahrenheit(_carPrefs.TemperatureUnit))
        {
            temperature = TemperatureUnit.Fahrenheit;
        }
        else if (!string.IsNullOrWhiteSpace(_carPrefs.TemperatureUnit))
        {
            temperature = TemperatureUnit.Celsius;
        }

        if (SettingEnumParser.IsPsi(_carPrefs.PressureUnit))
        {
            pressure = PressureUnit.Psi;
        }
        else if (SettingEnumParser.IsBar(_carPrefs.PressureUnit))
        {
            pressure = PressureUnit.Bar;
        }

        if (distance is null && temperature is null && pressure is null)
        {
            RaiseNotice(new GeneralSettingsNotice(
                GeneralSettingsNoticeKind.Info,
                _localizer.GetString("translation.toast.noChanges", "No changes"),
                _localizer.GetString("translation.toast.noChangesDesc", "Could not detect car unit preferences")));
            return Task.CompletedTask;
        }

        var merged = _draft with
        {
            DistanceUnit = distance ?? _draft.DistanceUnit,
            TemperatureUnit = temperature ?? _draft.TemperatureUnit,
            PressureUnit = pressure ?? _draft.PressureUnit,
        };

        // Reflect the merged units in the controls immediately (the web setForm before the mutation).
        _draft = merged;
        BumpEpoch();
        Raise(nameof(IsDirty));

        var detail = GeneralSettingsProjection.ComposeSyncDetail(_localizer, distance, temperature, pressure);
        return SaveInternalAsync(
            merged,
            () => new GeneralSettingsNotice(
                GeneralSettingsNoticeKind.Success,
                _localizer.GetString("translation.toast.unitsSynced", "Units synced from car"),
                detail),
            cancellationToken);
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
        _state is GeneralSettingsState.Loaded
            or GeneralSettingsState.Empty
            or GeneralSettingsState.Stale
            or GeneralSettingsState.Offline;

    private void Apply(RepositoryResult<GeneralServerSettings> result)
    {
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!HasContent())
                {
                    SetLoading();
                }

                IsFetching = true;
                break;

            case LoadStatus.Cached:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplySnapshot(
        GeneralServerSettings settings,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        _serverSettings = settings;
        HydrateDraftOnce(settings);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? OfflineMessage(error) : null;

        // Freshness wins over emptiness so the stale / offline chip survives, while a fresh document is simply
        // Loaded (the full form always renders for these states).
        State = offline
            ? GeneralSettingsState.Offline
            : stale
                ? GeneralSettingsState.Stale
                : GeneralSettingsState.Loaded;

        Raise(nameof(IsDirty));
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = GeneralSettingsState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        // An empty settings document falls back to defaults; the full form still renders and is writable (the web
        // treats an empty `{}` settings object as truthy, so the controls stay enabled).
        _serverSettings = GeneralServerSettings.Default;
        HydrateDraftOnce(_serverSettings);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = GeneralSettingsState.Empty;
        Raise(nameof(IsDirty));
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = GeneralSettingsState.Error;
    }

    private void HydrateDraftOnce(GeneralServerSettings settings)
    {
        if (_formInited)
        {
            return;
        }

        _formInited = true;
        _draft = settings.Form;
        BumpEpoch();
    }

    private async Task SaveInternalAsync(
        GeneralFormValues form,
        Func<GeneralSettingsNotice> successNotice,
        CancellationToken cancellationToken)
    {
        if (_isSaving)
        {
            return;
        }

        JustSaved = false;
        IsSaving = true;

        try
        {
            var committed = await _source.SaveAsync(_serverSettings.WithForm(form), cancellationToken).ConfigureAwait(false);
            _serverSettings = committed;
            _draft = committed.Form;
            _formInited = true;
            BumpEpoch();
            JustSaved = true;
            RaiseNotice(successNotice());
        }
        catch (OperationCanceledException)
        {
            // Superseded / disposed — leave the draft intact for a later retry.
        }
        catch (Exception)
        {
            // Web parity: keep the edited draft so the user can retry; surface the failure toast.
            RaiseNotice(new GeneralSettingsNotice(
                GeneralSettingsNoticeKind.Error,
                _localizer.GetString("translation.toast.saveFailed", "Failed to save"),
                _localizer.GetString("translation.toast.saveFailedDesc", "Could not update settings")));
        }
        finally
        {
            IsSaving = false;
            Raise(nameof(IsDirty));
        }
    }

    private GeneralSettingsNotice SavedNotice() => new(
        GeneralSettingsNoticeKind.Success,
        _localizer.GetString("translation.toast.saved", "Settings saved"),
        _localizer.GetString("translation.toast.savedDesc", "Your preferences have been updated"));

    private async Task LoadVehicleContextAsync(CancellationToken cancellationToken)
    {
        if (_contextRequested && _carPrefs is not null)
        {
            return;
        }

        _contextRequested = true;

        try
        {
            var vehicle = await _source.GetFirstVehicleAsync(cancellationToken).ConfigureAwait(false);
            if (vehicle is null)
            {
                return;
            }

            _vehicle = vehicle;
            Raise(nameof(Vehicle));

            var prefs = await _source.GetCarPreferencesAsync(vehicle.Id, cancellationToken).ConfigureAwait(false);
            if (prefs is null)
            {
                return;
            }

            _carPrefs = prefs;
            Raise(nameof(CarPreferences));
            Reproject();
        }
        catch (OperationCanceledException)
        {
            // Superseded / disposed — the banners simply do not render.
        }
    }

    private void UpdateDraft(GeneralFormValues next)
    {
        if (_draft.Equals(next))
        {
            return;
        }

        _draft = next;
        if (_justSaved)
        {
            JustSaved = false;
        }

        Raise(nameof(IsDirty));
    }

    private void BumpEpoch() => FormEpoch = _formEpoch + 1;

    private void Reproject() => Display = GeneralSettingsProjection.Project(_localizer, _carPrefs);

    private void RaiseNotice(GeneralSettingsNotice notice) => NoticeRequested?.Invoke(this, notice);

    private string OfflineMessage(RepositoryError? error) => error?.Kind switch
    {
        RepositoryErrorKind.Unauthorized => _localizer.GetString("translation.error.auth", "Sign in to manage settings"),
        _ => _localizer.GetString("translation.error.offline", "You're offline \u2014 showing your last saved settings"),
    };

    private string ErrorTextFor(RepositoryError? error) => error?.Kind switch
    {
        RepositoryErrorKind.Unauthorized => _localizer.GetString("translation.error.auth", "Sign in to manage settings"),
        RepositoryErrorKind.Offline or RepositoryErrorKind.Network => _localizer.GetString(
            "translation.error.offline", "You're offline \u2014 showing your last saved settings"),
        _ => _localizer.GetString("translation.error.loadFailed", "Failed to load data"),
    };

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
}
