using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>A transient toast the page raises after an inline mutation (web <c>toast.success</c> / <c>toast.error</c>).</summary>
/// <param name="Message">The localized toast body.</param>
/// <param name="IsError">True for the failure toast (web <c>toast.error</c>).</param>
public sealed record DataRepairToast(string Message, bool IsError);

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>DataRepairPage</c> view — the native port of the web page's data
/// flow (web/src/features/system/pages/DataRepairPage.tsx). It reads the stale inventory through the injected
/// <see cref="IDataRepairFeed"/> (web <c>useQuery(['stale-sessions'])</c>), owns the active tab + expanded-row + inline
/// edit-form local state (web <c>useState</c>), runs the six inline mutations (web <c>updateMut</c> / <c>closeMut</c> /
/// <c>discardMut</c> for charging and drives), and projects everything through <see cref="DataRepairProjection"/> so the
/// view is a thin renderer. It surfaces the four web data states (loading / empty / error / success) plus the in-flight
/// mutation flag; observable so the view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class DataRepairPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IDataRepairFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly DataRepairDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private IReadOnlyList<StaleChargingSession> _staleCharging = Array.Empty<StaleChargingSession>();
    private IReadOnlyList<StaleDrive> _staleDrives = Array.Empty<StaleDrive>();
    private bool _loading = true;
    private bool _hasError;
    private string? _errorDetail;
    private bool _hasLoaded;

    private RepairTab _tab = RepairTab.Charging;
    private long? _expandedId;
    private ChargingFormState _chargingForm = ChargingFormState.Empty;
    private DriveFormState _driveForm = DriveFormState.Empty;
    private RepairBusy _busy = RepairBusy.None;

    private DataRepairState _state = DataRepairState.Loading;
    private DataRepairDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The data-repair data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic "hours open" formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public DataRepairPageViewModel(
        IDataRepairFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        DataRepairDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new DataRepairDiagnostics();
        _display = DataRepairProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when an inline mutation completes (web <c>toast.success</c> / <c>toast.error</c>).</summary>
    public event EventHandler<DataRepairToast>? ToastRequested;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public DataRepairState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public DataRepairDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch of the inventory is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The localized page title (web <c>t('Data Repair')</c>).</summary>
    public string Title => DataRepairRegistration.Title(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the stale-inventory load (web <c>useQuery(['stale-sessions'])</c>).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_hasLoaded)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            var snapshot = await _feed.FetchStaleAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _staleCharging = snapshot.StaleCharging ?? Array.Empty<StaleChargingSession>();
            _staleDrives = snapshot.StaleDrives ?? Array.Empty<StaleDrive>();
            _hasError = false;
            _errorDetail = null;
            _loading = false;
            _hasLoaded = true;
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (Exception ex)
        {
            // web error: surface the failure panel so the page never renders a blank surface with no explanation.
            _hasError = true;
            _errorDetail = ex.Message;
            _loading = false;
            _staleCharging = Array.Empty<StaleChargingSession>();
            _staleDrives = Array.Empty<StaleDrive>();
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the inventory (web 30s auto-refetch / failure Retry).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    // ── Local state mutators (web useState) ───────────────────────────────────────────────────────────────────

    /// <summary>Switch the active tab (web <c>setTab</c>): collapses any open form (web <c>setExpandedId(null)</c>).</summary>
    public void SelectTab(RepairTab tab)
    {
        _tab = tab;
        _expandedId = null;
        _chargingForm = ChargingFormState.Empty;
        _driveForm = DriveFormState.Empty;
        Reproject();
    }

    /// <summary>
    /// Toggle a row's inline edit form (web <c>setExpandedId</c>): collapse when already open, otherwise expand and
    /// pre-fill the form from the row's current values (web <c>useState</c> initializer).
    /// </summary>
    public void ToggleExpanded(long id)
    {
        if (_expandedId == id)
        {
            _expandedId = null;
            Reproject();
            return;
        }

        _expandedId = id;
        if (_tab == RepairTab.Charging)
        {
            var session = _staleCharging.FirstOrDefault(x => x.Id == id);
            _chargingForm = session is null ? ChargingFormState.Empty : ChargingFormState.FromSession(session);
        }
        else
        {
            var drive = _staleDrives.FirstOrDefault(x => x.Id == id);
            _driveForm = drive is null ? DriveFormState.Empty : DriveFormState.FromDrive(drive);
        }

        Reproject();
    }

    /// <summary>Collapse the open inline form (web <c>onClose</c> / Cancel).</summary>
    public void CollapseForm()
    {
        _expandedId = null;
        Reproject();
    }

    /// <summary>Set the charging form End-Date field (web <c>setForm(end_ts)</c>).</summary>
    public void SetChargingEndTs(string value) => UpdateChargingForm(_chargingForm with { EndTs = value ?? string.Empty });

    /// <summary>Set the charging form Energy-Added field (web <c>setForm(total_energy_added_wh)</c>).</summary>
    public void SetChargingEnergy(string value) => UpdateChargingForm(_chargingForm with { TotalEnergyAddedWh = value ?? string.Empty });

    /// <summary>Set the charging form End-Battery field (web <c>setForm(end_battery_pct)</c>).</summary>
    public void SetChargingEndBattery(string value) => UpdateChargingForm(_chargingForm with { EndBatteryPct = value ?? string.Empty });

    /// <summary>Set the charging form Charger-Power field (web <c>setForm(peak_power_w)</c>).</summary>
    public void SetChargingPeakPower(string value) => UpdateChargingForm(_chargingForm with { PeakPowerW = value ?? string.Empty });

    /// <summary>Set the charging form Duration field (web <c>setForm(duration_min)</c>).</summary>
    public void SetChargingDuration(string value) => UpdateChargingForm(_chargingForm with { DurationMin = value ?? string.Empty });

    /// <summary>Set the charging form Cost field (web <c>setForm(cost)</c>).</summary>
    public void SetChargingCost(string value) => UpdateChargingForm(_chargingForm with { Cost = value ?? string.Empty });

    /// <summary>Set the drive form End-Date field (web <c>setForm(end_ts)</c>).</summary>
    public void SetDriveEndTs(string value) => UpdateDriveForm(_driveForm with { EndTs = value ?? string.Empty });

    /// <summary>Set the drive form Distance field (web <c>setForm(distance_m)</c>).</summary>
    public void SetDriveDistance(string value) => UpdateDriveForm(_driveForm with { DistanceM = value ?? string.Empty });

    /// <summary>Set the drive form Duration field (web <c>setForm(duration_s)</c>).</summary>
    public void SetDriveDuration(string value) => UpdateDriveForm(_driveForm with { DurationS = value ?? string.Empty });

    /// <summary>Set the drive form End-Battery field (web <c>setForm(end_battery_pct)</c>).</summary>
    public void SetDriveEndBattery(string value) => UpdateDriveForm(_driveForm with { EndBatteryPct = value ?? string.Empty });

    /// <summary>Set the drive form Max-Speed field (web <c>setForm(max_speed_mps)</c>).</summary>
    public void SetDriveMaxSpeed(string value) => UpdateDriveForm(_driveForm with { MaxSpeedMps = value ?? string.Empty });

    // ── Charging mutations (web ChargingEditForm) ─────────────────────────────────────────────────────────────

    /// <summary>Apply the charging partial-update (web <c>updateMut</c>): on success toast + reload + collapse; on error toast.</summary>
    public Task UpdateChargingAsync(long id, CancellationToken cancellationToken = default) =>
        RunMutationAsync(
            RepairBusy.Update,
            ct => _feed.UpdateChargingAsync(id, BuildChargingPayload(), ct),
            "Session updated",
            "Failed to update session",
            cancellationToken);

    /// <summary>Close the charging session (web <c>closeMut</c>).</summary>
    public Task CloseChargingAsync(long id, CancellationToken cancellationToken = default) =>
        RunMutationAsync(
            RepairBusy.Close,
            ct => _feed.CloseChargingAsync(id, ct),
            "Session closed",
            "Failed to close session",
            cancellationToken);

    /// <summary>Discard the charging session (web <c>discardMut</c>).</summary>
    public Task DiscardChargingAsync(long id, CancellationToken cancellationToken = default) =>
        RunMutationAsync(
            RepairBusy.Discard,
            ct => _feed.DiscardChargingAsync(id, ct),
            "Session discarded",
            "Failed to discard session",
            cancellationToken);

    // ── Drive mutations (web DriveEditForm) ───────────────────────────────────────────────────────────────────

    /// <summary>Apply the drive partial-update (web <c>updateMut</c>).</summary>
    public Task UpdateDriveAsync(long id, CancellationToken cancellationToken = default) =>
        RunMutationAsync(
            RepairBusy.Update,
            ct => _feed.UpdateDriveAsync(id, BuildDrivePayload(), ct),
            "Drive updated",
            "Failed to update drive",
            cancellationToken);

    /// <summary>Close the drive (web <c>closeMut</c>).</summary>
    public Task CloseDriveAsync(long id, CancellationToken cancellationToken = default) =>
        RunMutationAsync(
            RepairBusy.Close,
            ct => _feed.CloseDriveAsync(id, ct),
            "Drive closed",
            "Failed to close drive",
            cancellationToken);

    /// <summary>Discard the drive (web <c>discardMut</c>).</summary>
    public Task DiscardDriveAsync(long id, CancellationToken cancellationToken = default) =>
        RunMutationAsync(
            RepairBusy.Discard,
            ct => _feed.DiscardDriveAsync(id, ct),
            "Drive discarded",
            "Failed to discard drive",
            cancellationToken);

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

    // ── Internals ─────────────────────────────────────────────────────────────────────────────────────────────

    private async Task RunMutationAsync(
        RepairBusy busy, Func<CancellationToken, Task> action, string successKey, string failureKey, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(action);
        if (_busy != RepairBusy.None)
        {
            return;
        }

        _busy = busy;
        Reproject();

        try
        {
            await action(cancellationToken).ConfigureAwait(false);
            _busy = RepairBusy.None;
            RaiseToast(successKey, isError: false);
            _expandedId = null;
            await LoadAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            _busy = RepairBusy.None;
            Reproject();
        }
        catch (Exception)
        {
            // web onError raises a toast and leaves the row intact so the operator can retry.
            _busy = RepairBusy.None;
            RaiseToast(failureKey, isError: true);
            Reproject();
        }
    }

    private ChargingRepairPayload BuildChargingPayload() => new(
        EndTs: Text(_chargingForm.EndTs),
        TotalEnergyAddedWh: Num(_chargingForm.TotalEnergyAddedWh),
        EndBatteryPct: Num(_chargingForm.EndBatteryPct),
        PeakPowerW: Num(_chargingForm.PeakPowerW),
        DurationMin: Num(_chargingForm.DurationMin),
        Cost: Num(_chargingForm.Cost));

    private DriveRepairPayload BuildDrivePayload() => new(
        EndTs: Text(_driveForm.EndTs),
        DistanceM: Num(_driveForm.DistanceM),
        DurationS: Num(_driveForm.DurationS),
        EndBatteryPct: Num(_driveForm.EndBatteryPct),
        MaxSpeedMps: Num(_driveForm.MaxSpeedMps));

    private void UpdateChargingForm(ChargingFormState form)
    {
        _chargingForm = form;
        Reproject();
    }

    private void UpdateDriveForm(DriveFormState form)
    {
        _driveForm = form;
        Reproject();
    }

    private void RaiseToast(string messageKey, bool isError) =>
        ToastRequested?.Invoke(this, new DataRepairToast(_localizer.GetString(messageKey, messageKey), isError));

    private DataRepairModel BuildModel() => new(
        StaleCharging: _staleCharging,
        StaleDrives: _staleDrives,
        Loading: _loading,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        Tab: _tab,
        ExpandedId: _expandedId,
        ChargingForm: _chargingForm,
        DriveForm: _driveForm,
        Busy: _busy,
        Now: _clock());

    private void Reproject()
    {
        var display = DataRepairProjection.Project(BuildModel(), _localizer);
        Display = display;
        State = display.State;
    }

    private static string? Text(string value) => string.IsNullOrEmpty(value) ? null : value;

    private static double? Num(string value) =>
        !string.IsNullOrEmpty(value) &&
        double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var n)
            ? n
            : null;

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

/// <summary>
/// PII-safe diagnostics for the <c>DataRepairPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a session / drive id, vehicle or count — so a
/// diagnostics line can never leak fleet content. Thread-safe.
/// </summary>
public sealed class DataRepairDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DataRepairDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened (the only diagnostics event this surface emits).</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"{DataRepairRegistration.Slug}.view.opened");
    }
}
