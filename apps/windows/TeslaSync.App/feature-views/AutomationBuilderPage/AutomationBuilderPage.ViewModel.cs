using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>AutomationBuilderPage</c> view — the native port of the web
/// page's data flow (web/src/features/automations/pages/AutomationBuilderPage.tsx). It hydrates the editable
/// <see cref="AutomationBuilderForm"/> from the edit-mode automation read or the preset read, loads the vehicle scope
/// + notification channels, runs the web <c>validate()</c> chain on save, writes through the create / update paths and
/// triggers test runs — all through the injected <see cref="IAutomationBuilderFeed"/> so the view performs no HTTP.
/// It surfaces the four web data states (loading / not-found empty / load-error / success) via the projected
/// <see cref="AutomationBuilderDisplay"/>, plus the save-error, in-flight and test-run-started flags. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class AutomationBuilderPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAutomationBuilderFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly AutomationBuilderDiagnostics _diagnostics;
    private readonly AutomationBuilderMode _mode;
    private readonly long? _automationId;
    private readonly string? _presetId;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private AutomationBuilderForm _form = AutomationBuilderForm.InitialCreate();
    private IReadOnlyList<VehicleOptionRow> _vehicles = System.Array.Empty<VehicleOptionRow>();
    private IReadOnlyList<AutomationChannel> _channels = System.Array.Empty<AutomationChannel>();

    private bool _isLoadingAutomation;
    private bool _hasLoadError;
    private string? _loadErrorDetail;
    private bool _automationFound;
    private string _automationName = string.Empty;

    private string? _saveErrorDetail;
    private bool _isSaving;
    private bool _testRunStarted;
    private long? _savedId;

    private AutomationBuilderDisplay _display;

    /// <summary>Creates the holder over its feed, localizer and the route discrimination (edit id / preset id).</summary>
    /// <param name="feed">The automation-builder data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="automationId">The edit-mode automation id (web <c>id</c>), or <see langword="null"/>.</param>
    /// <param name="presetId">The preset id to install (web <c>?preset=…</c>), or <see langword="null"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AutomationBuilderPageViewModel(
        IAutomationBuilderFeed feed,
        ILocalizer localizer,
        long? automationId = null,
        string? presetId = null,
        AutomationBuilderDiagnostics? diagnostics = null)
    {
        System.ArgumentNullException.ThrowIfNull(feed);
        System.ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new AutomationBuilderDiagnostics();
        _automationId = automationId;
        _presetId = presetId;
        _mode = automationId.HasValue
            ? AutomationBuilderMode.Edit
            : !string.IsNullOrEmpty(presetId)
                ? AutomationBuilderMode.Preset
                : AutomationBuilderMode.Create;

        _isLoadingAutomation = _mode == AutomationBuilderMode.Edit;
        _display = AutomationBuilderProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised after a successful save (web <c>navigate('/automations')</c> seam).</summary>
    public event EventHandler? SaveSucceeded;

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public AutomationBuilderDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The current top-level data state.</summary>
    public AutomationBuilderState State => _display.State;

    /// <summary>The notification channels for the hosted <see cref="ActionBuilder"/> notify-action selector.</summary>
    public IReadOnlyList<AutomationChannel> Channels => _channels;

    /// <summary>The current editable form (used to seed the hosted sub-builders on hydration).</summary>
    public AutomationBuilderForm Form => _form;

    /// <summary>How the builder was entered (create / preset / edit).</summary>
    public AutomationBuilderMode Mode => _mode;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run the initial load: hydrate from the automation / preset, then load vehicles + channels.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        if (_mode == AutomationBuilderMode.Edit && _automationId.HasValue)
        {
            _isLoadingAutomation = true;
            Reproject();
            try
            {
                var snapshot = await _feed.LoadAutomationAsync(_automationId.Value, cts.Token).ConfigureAwait(false);
                cts.Token.ThrowIfCancellationRequested();
                _automationFound = snapshot.Found;
                _automationName = snapshot.Name;
                if (snapshot.Found)
                {
                    _form = snapshot.Form;
                }

                _hasLoadError = false;
                _loadErrorDetail = null;
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (ApiException ex)
            {
                _hasLoadError = true;
                _loadErrorDetail = ex.Message;
            }

            _isLoadingAutomation = false;
            Reproject();
        }
        else if (_mode == AutomationBuilderMode.Preset && !string.IsNullOrEmpty(_presetId))
        {
            try
            {
                var preset = await _feed.LoadPresetAsync(_presetId, cts.Token).ConfigureAwait(false);
                cts.Token.ThrowIfCancellationRequested();
                if (preset.Found)
                {
                    _form = preset.Form;
                    Reproject();
                }
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (ApiException)
            {
                // Preset hydration is best-effort; the create form stays on its defaults.
            }
        }

        await LoadOptionsAsync(cts.Token).ConfigureAwait(false);
    }

    /// <summary>Reload the surface (web query refetch / Retry).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Update the automation name (web <c>update('name', …)</c>).</summary>
    public void SetName(string name)
    {
        _form = _form with { Name = name ?? string.Empty };
        Reproject();
    }

    /// <summary>Update the description (web <c>update('description', …)</c>).</summary>
    public void SetDescription(string description)
    {
        _form = _form with { Description = description ?? string.Empty };
        Reproject();
    }

    /// <summary>Update the scoped vehicle id (web <c>update('vehicle_id', …)</c>); <see langword="null"/> means all vehicles.</summary>
    public void SetVehicle(long? vehicleId)
    {
        _form = _form with { VehicleId = vehicleId };
        Reproject();
    }

    /// <summary>Update the enabled flag (web <c>update('enabled', …)</c>).</summary>
    public void SetEnabled(bool enabled)
    {
        _form = _form with { Enabled = enabled };
        Reproject();
    }

    /// <summary>Change the trigger kind (web <c>handleTriggerKindChange</c>): an empty wire clears the trigger.</summary>
    public void SetTriggerKind(string? kindWire)
    {
        AutomationTrigger? trigger = kindWire switch
        {
            "trigger_schedule" => AutomationTrigger.CreateDefault(AutomationTriggerKind.Schedule),
            "trigger_event" => AutomationTrigger.CreateDefault(AutomationTriggerKind.Event),
            "trigger_geofence" => AutomationTrigger.CreateDefault(AutomationTriggerKind.Geofence),
            "trigger_signal" => AutomationTrigger.CreateDefault(AutomationTriggerKind.Signal),
            _ => null,
        };
        _form = _form with { Trigger = trigger };
        Reproject();
    }

    /// <summary>Replace the configured trigger from the hosted <see cref="TriggerConfigurator"/> (web <c>onChange</c>).</summary>
    public void SetTrigger(AutomationTrigger trigger)
    {
        System.ArgumentNullException.ThrowIfNull(trigger);
        _form = _form with { Trigger = trigger };
        Reproject();
    }

    /// <summary>Replace the conditions from the hosted <see cref="ConditionBuilder"/> (web <c>onChange</c>).</summary>
    public void SetConditions(IReadOnlyList<AutomationCondition> conditions)
    {
        System.ArgumentNullException.ThrowIfNull(conditions);
        _form = _form with { Conditions = conditions };
        Reproject();
    }

    /// <summary>Replace the actions from the hosted <see cref="ActionBuilder"/> (web <c>onChange</c>).</summary>
    public void SetActions(IReadOnlyList<AutomationActionStepInput> actions)
    {
        System.ArgumentNullException.ThrowIfNull(actions);
        _form = _form with { Actions = actions };
        Reproject();
    }

    /// <summary>
    /// Validate + persist the automation (web <c>handleSave</c>): a validation failure sets the save-error banner;
    /// otherwise the create / update path runs and, on success, the test-run becomes available and
    /// <see cref="SaveSucceeded"/> fires. Returns <see langword="true"/> on a successful write.
    /// </summary>
    public async Task<bool> SaveAsync(CancellationToken cancellationToken = default)
    {
        string? validationError = AutomationValidator.Validate(_form, _display.Validation);
        if (validationError is not null)
        {
            _saveErrorDetail = validationError;
            Reproject();
            return false;
        }

        _saveErrorDetail = null;
        _isSaving = true;
        Reproject();

        try
        {
            long id = _mode == AutomationBuilderMode.Edit && _automationId.HasValue
                ? await _feed.UpdateAsync(_automationId.Value, _form, cancellationToken).ConfigureAwait(false)
                : await _feed.CreateAsync(_form, cancellationToken).ConfigureAwait(false);
            _savedId = id;
            _isSaving = false;
            Reproject();
            SaveSucceeded?.Invoke(this, EventArgs.Empty);
            return true;
        }
        catch (OperationCanceledException)
        {
            _isSaving = false;
            Reproject();
            return false;
        }
        catch (ApiException ex)
        {
            _saveErrorDetail = ex.Message;
            _isSaving = false;
            Reproject();
            return false;
        }
    }

    /// <summary>Trigger a test run of the saved-or-existing automation (web <c>handleTestRun</c>).</summary>
    public async Task TestRunAsync(CancellationToken cancellationToken = default)
    {
        long? target = _savedId ?? _automationId;
        if (target is null)
        {
            return;
        }

        try
        {
            await _feed.TestRunAsync(target.Value, cancellationToken).ConfigureAwait(false);
            _testRunStarted = true;
            Reproject();
        }
        catch (OperationCanceledException)
        {
            // Superseded / disposed — drop silently.
        }
        catch (ApiException)
        {
            // Test-run failures are non-fatal to the form; the success note simply does not appear.
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
        Cancel(ref _cts);
    }

    private async Task LoadOptionsAsync(CancellationToken cancellationToken)
    {
        try
        {
            _vehicles = await _feed.LoadVehiclesAsync(cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            OnPropertyChanged(nameof(Channels));
            Reproject();
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (ApiException)
        {
            // The vehicle scope list is best-effort; the "All Vehicles" option is always present.
        }

        try
        {
            _channels = await _feed.LoadChannelsAsync(cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            OnPropertyChanged(nameof(Channels));
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (ApiException)
        {
            // Channels are best-effort; the notify-action selector falls back to "no channels configured".
        }
    }

    private AutomationBuilderModel BuildModel() => new(
        Mode: _mode,
        IsLoadingAutomation: _isLoadingAutomation,
        HasLoadError: _hasLoadError,
        LoadErrorDetail: _loadErrorDetail,
        AutomationFound: _automationFound,
        AutomationName: _automationName,
        Form: _form,
        Vehicles: _vehicles,
        HasConflicts: false,
        SaveErrorDetail: _saveErrorDetail,
        IsSaving: _isSaving,
        CanTestRun: (_savedId ?? _automationId).HasValue,
        TestRunStarted: _testRunStarted);

    private void Reproject() => Display = AutomationBuilderProjection.Project(BuildModel(), _localizer);

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

    private void OnPropertyChanged([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));

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
