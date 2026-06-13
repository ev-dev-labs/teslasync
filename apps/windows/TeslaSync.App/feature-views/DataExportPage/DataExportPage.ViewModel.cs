using System.ComponentModel;
using System.Globalization;
using System.Linq;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>A toast the page raises after a submit (web <c>toast.success</c> / <c>toast.error</c>).</summary>
/// <param name="Title">The localized toast title.</param>
/// <param name="Message">The localized toast body.</param>
/// <param name="IsError">True for the failure toast (web <c>toast.error</c>).</param>
public sealed record DataExportToast(string Title, string Message, bool IsError);

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>DataExportPage</c> view — the native port of the web page's data
/// flow (web/src/features/system/pages/DataExportPage.tsx). It reads the export-jobs history + vehicles through the
/// injected <see cref="IDataExportFeed"/> (web <c>useQuery</c>), owns the wizard / account / column-picker local state
/// (web <c>ExportWizard</c> / <c>AccountExportPanel</c> / <c>ColumnPickerSection</c>), runs the generic submit and the
/// account export (web <c>submitExport</c> / <c>useCreateAccountExport</c>), and projects everything through
/// <see cref="DataExportProjection"/> so the view is a thin renderer. It surfaces the four web data states
/// (loading / empty / error / success) plus the in-flight + busy flags; observable so the view re-renders on
/// <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class DataExportPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IDataExportFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly DataExportDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private CancellationTokenSource? _columnsCts;
    private bool _disposed;

    private IReadOnlyList<ExportJobSummary> _jobs = Array.Empty<ExportJobSummary>();
    private IReadOnlyList<VehicleSummary> _vehicles = Array.Empty<VehicleSummary>();
    private bool _jobsLoading = true;
    private bool _vehiclesLoading = true;
    private bool _hasError;
    private string? _errorDetail;
    private bool _hasLoaded;
    private bool _submitBusy;
    private bool _accountBusy;

    private WizardSelection _wizard = WizardSelection.Default;
    private ColumnCatalogState _columns = ColumnCatalogState.Idle;
    private AccountSelection _account = AccountSelection.Default;

    private DataExportState _state = DataExportState.Loading;
    private DataExportDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The data-export data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic created-timestamp formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public DataExportPageViewModel(
        IDataExportFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        DataExportDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new DataExportDiagnostics();
        _display = DataExportProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when a submit completes (web <c>toast.success</c> / <c>toast.error</c>).</summary>
    public event EventHandler<DataExportToast>? ToastRequested;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public DataExportState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public DataExportDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch of the history / vehicles is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The localized page title (web <c>dataExport.title</c>).</summary>
    public string Title => DataExportRegistration.Title(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the history + vehicles load (web <c>useQuery</c> pair).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_hasLoaded)
        {
            _jobsLoading = true;
            _vehiclesLoading = true;
            Reproject();
        }

        try
        {
            var jobsTask = _feed.FetchJobsAsync(cts.Token);
            var vehiclesTask = _feed.FetchVehiclesAsync(cts.Token);
            await Task.WhenAll(jobsTask, vehiclesTask).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _jobs = jobsTask.Result.Jobs ?? Array.Empty<ExportJobSummary>();
            _vehicles = vehiclesTask.Result.Vehicles ?? Array.Empty<VehicleSummary>();
            _hasError = false;
            _errorDetail = null;
            _jobsLoading = false;
            _vehiclesLoading = false;
            _hasLoaded = true;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            // web jobsError: surface the failure panel; the history/stats fall back to the error branch.
            _hasError = true;
            _errorDetail = ex.Message;
            _jobsLoading = false;
            _vehiclesLoading = false;
            _jobs = Array.Empty<ExportJobSummary>();
            _vehicles = Array.Empty<VehicleSummary>();
        }

        IsFetching = false;
        Reproject();

        // Resolve the initial column catalog for the default export type (web useExportColumns runs on mount).
        await RefreshColumnsAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Refresh the history (web manual Refresh / 10s poll).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    // ── Wizard mutators (web ExportWizard) ──────────────────────────────────────────────────────────────────

    /// <summary>Select the export type (web <c>handleExportTypeChange</c>): resets the column selection and refetches.</summary>
    public async Task SelectTypeAsync(string type, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(type);
        _wizard = _wizard with { Type = type, SelectedColumns = null };
        Reproject();
        await RefreshColumnsAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Select the export format (web <c>setExportFormat</c>).</summary>
    public void SelectFormat(string format)
    {
        ArgumentNullException.ThrowIfNull(format);
        _wizard = _wizard with { Format = format };
        Reproject();
    }

    /// <summary>Scope the export to a vehicle (web <c>setVehicleId</c>).</summary>
    public void SelectVehicle(string vehicleId)
    {
        _wizard = _wizard with { VehicleId = vehicleId ?? string.Empty };
        Reproject();
    }

    /// <summary>Choose a date preset (web <c>handlePresetChange</c>): leaves custom-range mode.</summary>
    public void SelectPreset(int days)
    {
        _wizard = _wizard with { PresetDays = days, UseCustomRange = false };
        Reproject();
    }

    /// <summary>Toggle the custom-range mode (web <c>setUseCustomRange</c>).</summary>
    public void ToggleCustomRange()
    {
        _wizard = _wizard with { UseCustomRange = !_wizard.UseCustomRange };
        Reproject();
    }

    /// <summary>Set the custom-range start date (web <c>setCustomStart</c>).</summary>
    public void SetCustomStart(string value)
    {
        _wizard = _wizard with { CustomStart = value ?? string.Empty };
        Reproject();
    }

    /// <summary>Set the custom-range end date (web <c>setCustomEnd</c>).</summary>
    public void SetCustomEnd(string value)
    {
        _wizard = _wizard with { CustomEnd = value ?? string.Empty };
        Reproject();
    }

    /// <summary>Toggle one column in the picker (web <c>toggleColumn</c>): required columns are immovable.</summary>
    public void ToggleColumn(string name)
    {
        ArgumentNullException.ThrowIfNull(name);
        var catalog = _columns.Catalog;
        var required = catalog.Columns.Where(c => c.AlwaysIncluded).Select(c => c.Name).ToHashSet(StringComparer.Ordinal);
        if (required.Contains(name))
        {
            return;
        }

        var allNames = catalog.Columns.Select(c => c.Name).ToList();
        var effective = new HashSet<string>(_wizard.SelectedColumns ?? allNames, StringComparer.Ordinal);
        if (!effective.Remove(name))
        {
            effective.Add(name);
        }

        var ordered = allNames.Where(effective.Contains).ToList();
        _wizard = _wizard with { SelectedColumns = ordered.Count == allNames.Count ? null : ordered };
        Reproject();
    }

    /// <summary>Re-select every column (web <c>handleSelectAll</c>): collapses to the legacy "all" state.</summary>
    public void SelectAllColumns()
    {
        _wizard = _wizard with { SelectedColumns = null };
        Reproject();
    }

    /// <summary>Clear the selection, keeping the always-included columns (web <c>handleClear</c>).</summary>
    public void ClearColumns()
    {
        var catalog = _columns.Catalog;
        var allNames = catalog.Columns.Select(c => c.Name).ToList();
        var required = catalog.Columns.Where(c => c.AlwaysIncluded).Select(c => c.Name).ToList();
        _wizard = _wizard with { SelectedColumns = required.Count == allNames.Count ? null : required };
        Reproject();
    }

    /// <summary>Submit the wizard export (web <c>handleSubmit</c> → <c>submitExport</c>): builds the payload like web.</summary>
    public async Task SubmitAsync(CancellationToken cancellationToken = default)
    {
        if (_submitBusy)
        {
            return;
        }

        var payload = BuildSubmitPayload();
        _submitBusy = true;
        Reproject();

        try
        {
            await _feed.SubmitExportAsync(payload, cancellationToken).ConfigureAwait(false);
            _submitBusy = false;
            RaiseToast(success: true);
            await LoadAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            _submitBusy = false;
        }
        catch (Exception)
        {
            _submitBusy = false;
            RaiseToast(success: false);
            Reproject();
        }
    }

    // ── Account export mutators (web AccountExportPanel) ────────────────────────────────────────────────────

    /// <summary>Scope the account export to a vehicle (web <c>setVehicleId</c>).</summary>
    public void SetAccountVehicle(string vehicleId)
    {
        _account = _account with { VehicleId = vehicleId ?? "all" };
        Reproject();
    }

    /// <summary>Set the account export start date (web <c>setStartDate</c>).</summary>
    public void SetAccountStart(string value)
    {
        _account = _account with { Start = value ?? string.Empty };
        Reproject();
    }

    /// <summary>Set the account export end date (web <c>setEndDate</c>).</summary>
    public void SetAccountEnd(string value)
    {
        _account = _account with { End = value ?? string.Empty };
        Reproject();
    }

    /// <summary>Queue the full account export (web <c>handleStart</c> → <c>useCreateAccountExport</c>).</summary>
    public async Task RunAccountExportAsync(CancellationToken cancellationToken = default)
    {
        if (_accountBusy)
        {
            return;
        }

        var payload = BuildAccountPayload();
        _accountBusy = true;
        Reproject();

        try
        {
            await _feed.CreateAccountExportAsync(payload, cancellationToken).ConfigureAwait(false);
            _accountBusy = false;
            await LoadAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            _accountBusy = false;
        }
        catch (Exception)
        {
            _accountBusy = false;
            Reproject();
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
        Cancel(ref _columnsCts);
    }

    // ── Internals ───────────────────────────────────────────────────────────────────────────────────────────

    private async Task RefreshColumnsAsync(CancellationToken cancellationToken)
    {
        string catalogType = DataExportRegistration.CatalogTypeFor(_wizard.Type);
        if (string.IsNullOrEmpty(catalogType))
        {
            _columns = ColumnCatalogState.Idle;
            Reproject();
            return;
        }

        var cts = Supersede(ref _columnsCts, cancellationToken);
        _columns = new ColumnCatalogState(catalogType, Loading: true, HasError: false, ExportColumnsCatalog.Empty);
        Reproject();

        try
        {
            var catalog = await _feed.FetchColumnsAsync(catalogType, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();
            _columns = new ColumnCatalogState(catalogType, Loading: false, HasError: false, catalog);
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            _columns = new ColumnCatalogState(catalogType, Loading: false, HasError: true, ExportColumnsCatalog.Empty);
        }

        Reproject();
    }

    private ExportSubmitPayload BuildSubmitPayload()
    {
        long? vehicleId = null;
        if (!string.IsNullOrEmpty(_wizard.VehicleId) &&
            long.TryParse(_wizard.VehicleId, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
        {
            vehicleId = parsed;
        }

        string? start = null;
        string? end = null;
        var now = _clock();
        if (_wizard.UseCustomRange && !string.IsNullOrEmpty(_wizard.CustomStart))
        {
            start = _wizard.CustomStart;
            end = string.IsNullOrEmpty(_wizard.CustomEnd) ? IsoDate(now) : _wizard.CustomEnd;
        }
        else if (_wizard.PresetDays > 0)
        {
            start = IsoDate(now.AddDays(-_wizard.PresetDays));
            end = IsoDate(now);
        }

        IReadOnlyList<string>? columns =
            _wizard.SelectedColumns is { Count: > 0 } cols ? cols : null;

        return new ExportSubmitPayload(_wizard.Type, _wizard.Format, vehicleId, start, end, columns);
    }

    private AccountExportPayload BuildAccountPayload()
    {
        long? vehicleId = null;
        if (!string.Equals(_account.VehicleId, "all", StringComparison.Ordinal) &&
            long.TryParse(_account.VehicleId, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
        {
            vehicleId = parsed;
        }

        string? start = string.IsNullOrEmpty(_account.Start) ? null : ToIsoInstant(_account.Start);
        string? end = string.IsNullOrEmpty(_account.End) ? null : ToIsoInstant(_account.End);
        return new AccountExportPayload(vehicleId, start, end);
    }

    private void RaiseToast(bool success)
    {
        var toast = success
            ? new DataExportToast(
                _localizer.GetString("Export Started", "Export Started"),
                _localizer.GetString("Export Started Msg", "Export Started Msg"),
                IsError: false)
            : new DataExportToast(
                _localizer.GetString("Export Failed", "Export Failed"),
                _localizer.GetString("Export Failed Msg", "Export Failed Msg"),
                IsError: true);
        ToastRequested?.Invoke(this, toast);
    }

    private DataExportModel BuildModel() => new(
        Jobs: _jobs,
        Vehicles: _vehicles,
        JobsLoading: _jobsLoading,
        VehiclesLoading: _vehiclesLoading,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        Wizard: _wizard,
        Columns: _columns,
        Account: _account,
        AccountBusy: _accountBusy,
        SubmitBusy: _submitBusy,
        DownloadBase: _feed.DownloadBaseUri,
        Now: _clock());

    private void Reproject()
    {
        var display = DataExportProjection.Project(BuildModel(), _localizer);
        Display = display;
        State = display.State;
    }

    private static string IsoDate(DateTimeOffset value) =>
        value.UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static string ToIsoInstant(string date) =>
        DateTimeOffset.TryParse(date, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var value)
            ? value.UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture)
            : date;

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
/// PII-safe diagnostics for the <c>DataExportPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a job id, type, vehicle or count — so a
/// diagnostics line can never leak fleet content. Thread-safe.
/// </summary>
public sealed class DataExportDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DataExportDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened (the only diagnostics event this surface emits).</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"{DataExportRegistration.Slug}.view.opened");
    }
}
