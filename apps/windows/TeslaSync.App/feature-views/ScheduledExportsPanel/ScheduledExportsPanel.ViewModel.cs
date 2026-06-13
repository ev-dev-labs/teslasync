using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Exports;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>ScheduledExportsPanel</c> view — the native port of the web
/// panel's data + inline-form flow (web/src/features/system/pages/ScheduledExportsPanel.tsx). It owns the schedule
/// list, the three data states (loading / empty / success), the inline create/edit form (web <c>showForm</c> /
/// <c>editingId</c> / <c>form</c>), the per-row run-now busy id and the submit-pending flag; reads the list through
/// the injected <see cref="IScheduledExportsFeed"/> (web <c>useScheduledExports</c>); writes create / update /
/// delete / run-now back through the same port (web <c>useCreateScheduledExport</c> /
/// <c>useUpdateScheduledExport</c> / <c>useDeleteScheduledExport</c> / <c>useRunScheduledExportNow</c>); and
/// projects the result through <see cref="ScheduledExportsProjection"/> so the view is a thin renderer. Observable
/// so the view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is
/// not internally synchronised.
/// </summary>
public sealed class ScheduledExportsPanelViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IScheduledExportsFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _now;
    private readonly ScheduledExportsDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private IReadOnlyList<ScheduledExport> _items = Array.Empty<ScheduledExport>();
    private bool _loading = true;
    private bool _showForm;
    private long? _editingId;
    private ScheduledExportFormState _form = ScheduledExportFormState.Empty();
    private bool _submitting;
    private long? _runningId;
    private int _formEpoch;

    private ScheduledExportsState _state = ScheduledExportsState.Loading;
    private ScheduledExportsDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer, clock and (optional) diagnostics.</summary>
    /// <param name="feed">The schedule-list + mutation data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The clock used to format the run timestamps (UTC by default).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ScheduledExportsPanelViewModel(
        IScheduledExportsFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? now = null,
        ScheduledExportsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _now = now ?? (() => DateTimeOffset.UtcNow);
        _diagnostics = diagnostics ?? new ScheduledExportsDiagnostics();
        _display = ScheduledExportsProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / success).</summary>
    public ScheduledExportsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public ScheduledExportsDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch or mutation is in flight (web <c>isFetching</c> / mutation pending).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The localized panel title (web <c>dataExport.scheduled.title</c>).</summary>
    public string Title => ScheduledExportsRegistration.Title(_localizer);

    /// <summary>The current editable form state (web <c>form</c>).</summary>
    public ScheduledExportFormState Form => _form;

    /// <summary>Whether the inline create/edit form is open (web <c>showForm</c>).</summary>
    public bool IsFormOpen => _showForm;

    /// <summary>The id being edited, or null for a create (web <c>editingId</c>).</summary>
    public long? EditingId => _editingId;

    /// <summary>
    /// Monotonically-increasing token that changes only when a NEW form session opens (create / edit). The view
    /// repopulates the inline inputs from <see cref="Form"/> only when this changes, so per-keystroke reprojections
    /// never clobber the field the user is editing.
    /// </summary>
    public int FormEpoch => _formEpoch;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the schedule-list load (web <c>useScheduledExports</c> query).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (_items.Count == 0)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            var schedules = await _feed.FetchAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _items = schedules ?? Array.Empty<ScheduledExport>();
            _loading = false;
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (Exception)
        {
            // web useScheduledExports uses `select: safeArray`, so a failed query resolves to an empty list and the
            // panel falls back to its empty state (there is no separate error region on this surface).
            _items = Array.Empty<ScheduledExport>();
            _loading = false;
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the schedule list (web query refetch).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Open a blank inline form for a new schedule (web <c>startCreate</c>).</summary>
    public void StartCreate()
    {
        _form = ScheduledExportFormState.Empty();
        _editingId = null;
        _showForm = true;
        _formEpoch++;
        Reproject();
    }

    /// <summary>Open the inline form seeded from an existing schedule (web <c>startEdit(row)</c>).</summary>
    /// <param name="id">The schedule id to edit.</param>
    public void StartEdit(long id)
    {
        var row = _items.FirstOrDefault(r => r.Id == id);
        if (row is null)
        {
            return;
        }

        _form = ScheduledExportFormState.FromRow(row);
        _editingId = id;
        _showForm = true;
        _formEpoch++;
        Reproject();
    }

    /// <summary>Close the inline form and reset it to blank (web <c>closeForm</c>).</summary>
    public void CloseForm()
    {
        _showForm = false;
        _editingId = null;
        _form = ScheduledExportFormState.Empty();
        Reproject();
    }

    /// <summary>Update the form name (web controlled <c>name</c> input).</summary>
    public void SetName(string value) => UpdateForm(_form with { Name = value ?? string.Empty });

    /// <summary>Update the cron expression (web controlled <c>schedule_cron</c> input).</summary>
    public void SetScheduleCron(string value) => UpdateForm(_form with { ScheduleCron = value ?? string.Empty });

    /// <summary>Update the range window (web controlled <c>range_window</c> input).</summary>
    public void SetRangeWindow(string value) => UpdateForm(_form with { RangeWindow = value ?? string.Empty });

    /// <summary>Update the export type (web <c>export_type</c> select).</summary>
    public void SetExportType(string value) => UpdateForm(_form with { ExportType = value ?? _form.ExportType });

    /// <summary>Update the format (web <c>format</c> select).</summary>
    public void SetFormat(string value) => UpdateForm(_form with { Format = value ?? _form.Format });

    /// <summary>Update the delivery kind (web <c>delivery.kind</c> select) — toggles the delivery-target field.</summary>
    public void SetDeliveryKind(string value) => UpdateForm(_form with { DeliveryKind = value ?? _form.DeliveryKind });

    /// <summary>Update the delivery target (web <c>delivery.target</c> input).</summary>
    public void SetDeliveryTarget(string value) => UpdateForm(_form with { DeliveryTarget = value ?? string.Empty });

    /// <summary>
    /// Submit the inline form (web <c>submit</c>): create when there is no <see cref="EditingId"/>, otherwise update;
    /// on success the form closes and the list reloads. On failure the form stays open (web swallows the error — a
    /// toast is surfaced by the mutation hook). Returns true when the write was attempted.
    /// </summary>
    public async Task<bool> SubmitAsync(CancellationToken cancellationToken = default)
    {
        _submitting = true;
        IsFetching = true;
        Reproject();

        try
        {
            if (_editingId is { } editId)
            {
                await _feed.UpdateAsync(editId, _form, cancellationToken).ConfigureAwait(false);
            }
            else
            {
                await _feed.CreateAsync(_form, cancellationToken).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            _submitting = false;
            IsFetching = false;
            return false;
        }
        catch (Exception)
        {
            // web: the submit catch is empty (the mutation hook surfaces the toast); the form stays open.
            _submitting = false;
            IsFetching = false;
            Reproject();
            return true;
        }

        _submitting = false;
        _showForm = false;
        _editingId = null;
        _form = ScheduledExportFormState.Empty();
        await LoadAsync(cancellationToken).ConfigureAwait(false);
        return true;
    }

    /// <summary>Flip a schedule's enabled flag (web <c>toggleEnabled(row)</c>), then reload.</summary>
    /// <param name="id">The schedule id to toggle.</param>
    public async Task ToggleEnabledAsync(long id, CancellationToken cancellationToken = default)
    {
        var row = _items.FirstOrDefault(r => r.Id == id);
        if (row is null)
        {
            return;
        }

        var form = ScheduledExportFormState.FromRow(row) with { Enabled = !row.Enabled };

        IsFetching = true;
        try
        {
            await _feed.UpdateAsync(id, form, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            IsFetching = false;
            return;
        }
        catch (Exception)
        {
            // web: toggleEnabled swallows the error (toast surfaced by the mutation hook).
            IsFetching = false;
            return;
        }

        await LoadAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Trigger a manual run for a schedule (web <c>runNow.mutate(id)</c>), then reload.</summary>
    /// <param name="id">The schedule id to run now.</param>
    public async Task RunNowAsync(long id, CancellationToken cancellationToken = default)
    {
        _runningId = id;
        IsFetching = true;
        Reproject();

        try
        {
            await _feed.RunNowAsync(id, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            _runningId = null;
            IsFetching = false;
            Reproject();
            return;
        }
        catch (Exception)
        {
            // web: runNow swallows the error (toast surfaced by the mutation hook).
            _runningId = null;
            IsFetching = false;
            Reproject();
            return;
        }

        _runningId = null;
        await LoadAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Delete a schedule (web <c>remove.mutate(id)</c> after the confirm dialog), then reload.</summary>
    /// <param name="id">The schedule id to delete.</param>
    public async Task DeleteAsync(long id, CancellationToken cancellationToken = default)
    {
        IsFetching = true;
        try
        {
            await _feed.DeleteAsync(id, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            IsFetching = false;
            return;
        }
        catch (Exception)
        {
            // web: the delete error is surfaced by the mutation hook's toast; the list is left as-is.
            IsFetching = false;
            return;
        }

        await LoadAsync(cancellationToken).ConfigureAwait(false);
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

    private void UpdateForm(ScheduledExportFormState next)
    {
        _form = next;
        Reproject();
    }

    private ScheduledExportsModel BuildModel() => new(
        Items: _items,
        Loading: _loading,
        ShowForm: _showForm,
        EditingId: _editingId,
        Form: _form,
        Submitting: _submitting,
        RunningId: _runningId,
        Now: _now());

    private void Reproject()
    {
        var display = ScheduledExportsProjection.Project(BuildModel(), _localizer);
        Display = display;
        State = display.State;
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
