using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Maps;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>GeofencesPage</c> view — the native port of the web page's
/// data + CRUD flow (web/src/features/maps/pages/GeofencesPage.tsx). It owns the geofence list, the vehicle and
/// pin side-reads, the four data states (loading / empty / error / success), the bulk selection (web
/// <c>useBulkSelection</c>) and the client-side name <see cref="Search"/>, reads everything through the injected
/// <see cref="IGeofencesFeed"/> (web <c>useQuery</c> / <c>useVehicles</c> / <c>usePinned</c>), writes the create /
/// update / toggle / single-delete / bulk-delete mutations back through the same port (web <c>createMut</c> /
/// <c>updateMut</c> / <c>toggleMut</c> / <c>renameMut</c> / <c>deleteMut</c> / <c>useBulkGeofencesDelete</c>), and
/// projects the result through <see cref="GeofencesProjection"/> so the view is a thin renderer. A monotonic
/// <see cref="ToastSequence"/> surfaces the web <c>toast.*</c> notifications. Observable so the view re-renders on
/// <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class GeofencesPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IGeofencesFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly GeofencesDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private IReadOnlyList<Geofence> _items = Array.Empty<Geofence>();
    private IReadOnlyList<GeofenceVehicleOption> _vehicles = Array.Empty<GeofenceVehicleOption>();
    private IReadOnlyList<GeofencePin> _pins = Array.Empty<GeofencePin>();
    private readonly HashSet<long> _selected = new();
    private bool _loading = true;
    private bool _hasError;
    private string? _errorDetail;
    private string _search = string.Empty;

    private GeofencesState _state = GeofencesState.Loading;
    private GeofencesDisplay _display;
    private bool _isFetching;
    private DateTimeOffset? _updatedAt;

    private string _toastMessage = string.Empty;
    private bool _toastIsError;
    private int _toastSequence;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The geofence list + mutation data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic freshness in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public GeofencesPageViewModel(
        IGeofencesFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        GeofencesDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new GeofencesDiagnostics();
        _display = GeofencesProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public GeofencesState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public GeofencesDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch or mutation is in flight (the header freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed (drives the header freshness chip's error state).</summary>
    public bool IsError => _hasError;

    /// <summary>Last successful update timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>The localized page title (web <c>t('Geofences')</c>).</summary>
    public string Title => GeofencesRegistration.Title(_localizer);

    /// <summary>The vehicle options for the create-modal location picker (web <c>useVehicles</c>).</summary>
    public IReadOnlyList<GeofenceVehicleOption> Vehicles => _vehicles;

    /// <summary>The ids currently in the bulk selection (web <c>sel.selectedIds</c>).</summary>
    public IReadOnlyList<long> SelectedIds => _selected.ToArray();

    /// <summary>The latest toast message (web <c>toast.*</c>); read together with <see cref="ToastSequence"/>.</summary>
    public string ToastMessage => _toastMessage;

    /// <summary>True when the latest toast is an error (web <c>toast.error</c>).</summary>
    public bool ToastIsError => _toastIsError;

    /// <summary>Monotonic counter bumped on every toast so the view can re-show an identical message.</summary>
    public int ToastSequence => _toastSequence;

    /// <summary>The address search query; reassigning re-projects the current list without a refetch.</summary>
    public string Search
    {
        get => _search;
        set
        {
            string next = value ?? string.Empty;
            if (string.Equals(_search, next, StringComparison.Ordinal))
            {
                return;
            }

            _search = next;
            Reproject();
        }
    }

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Look up a loaded geofence by id (used to build the full rename payload). Null when absent.</summary>
    public Geofence? FindById(long id) => _items.FirstOrDefault(g => g.Id == id);

    /// <summary>Run (or re-run) the geofence list load and the vehicle / pin side-reads (web queries).</summary>
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
            var geofences = await _feed.FetchGeofencesAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _items = geofences ?? Array.Empty<Geofence>();
            PruneSelection();
            _hasError = false;
            _errorDetail = null;
            _loading = false;
            _updatedAt = _clock();
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (Exception ex)
        {
            // web error branch: PageContainer renders the error surface; the list falls back to its empty branch.
            _hasError = true;
            _errorDetail = ex.Message;
            _loading = false;
            _items = Array.Empty<Geofence>();
            _selected.Clear();
        }

        await LoadSideReadsAsync(cts.Token).ConfigureAwait(false);

        IsFetching = false;
        UpdatedAt = _updatedAt;
        Reproject();
    }

    /// <summary>Refresh the geofence list (web query refetch / Retry).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Toggle a single row's selection (web <c>sel.toggle(id)</c>).</summary>
    public void ToggleSelect(long id)
    {
        if (!_selected.Remove(id))
        {
            _selected.Add(id);
        }

        Reproject();
    }

    /// <summary>Clear the bulk selection (web <c>sel.clear()</c>).</summary>
    public void ClearSelection()
    {
        if (_selected.Count == 0)
        {
            return;
        }

        _selected.Clear();
        Reproject();
    }

    /// <summary>Create a geofence from the validated form (web <c>createMut</c>); returns true on success.</summary>
    public Task<bool> CreateAsync(GeofenceFormState form, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(form);
        var write = GeofenceWrite.FromForm(form);
        return RunWriteAsync(
            t => _feed.CreateAsync(write, t),
            successKey: "Geofence created",
            errorKey: "Failed to create geofence",
            cancellationToken);
    }

    /// <summary>Update a geofence from the validated form (web <c>updateMut</c>); returns true on success.</summary>
    public Task<bool> UpdateAsync(long id, GeofenceFormState form, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(form);
        var write = GeofenceWrite.FromForm(form);
        return RunWriteAsync(
            t => _feed.UpdateAsync(id, write, t),
            successKey: "Geofence updated",
            errorKey: "Failed to update geofence",
            cancellationToken);
    }

    /// <summary>Toggle a geofence's enabled flag (web <c>toggleMut</c>); no success toast, error toast on failure.</summary>
    public Task<bool> ToggleAsync(long id, bool enabled, CancellationToken cancellationToken = default) =>
        RunWriteAsync(
            t => _feed.ToggleAsync(id, enabled, t),
            successKey: null,
            errorKey: "Failed to toggle geofence",
            cancellationToken);

    /// <summary>Delete a single geofence (web <c>deleteMut</c>); returns true on success.</summary>
    public Task<bool> DeleteAsync(long id, CancellationToken cancellationToken = default) =>
        RunWriteAsync(
            t => _feed.DeleteAsync(id, t),
            successKey: "Geofence deleted",
            errorKey: "Failed to delete geofence",
            cancellationToken);

    /// <summary>
    /// Inline-rename a geofence (web <c>renameMut</c>): sends the full merged payload with the new name. Errors
    /// are surfaced inline by the editor (web has no rename toast), so this swallows the failure and returns false.
    /// Returns true when the write succeeded.
    /// </summary>
    public async Task<bool> RenameAsync(long id, string name, CancellationToken cancellationToken = default)
    {
        var existing = FindById(id);
        if (existing is null)
        {
            return false;
        }

        var write = GeofenceWrite.FromRename(existing, name);
        IsFetching = true;
        try
        {
            await _feed.UpdateAsync(id, write, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            IsFetching = false;
            return false;
        }
        catch (Exception)
        {
            // web: renameMut has no onError toast — the editor restores the persisted name.
            IsFetching = false;
            Reproject();
            return false;
        }

        await LoadAsync(cancellationToken).ConfigureAwait(false);
        return true;
    }

    /// <summary>
    /// Bulk-delete the supplied ids (web <c>onBulkDelete → useBulkGeofencesDelete</c>), then clear the selection
    /// and reload. Returns true when the delete was accepted.
    /// </summary>
    public async Task<bool> BulkDeleteAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(ids);
        bool ok = await RunWriteAsync(
            t => _feed.BulkDeleteAsync(ids, t),
            successKey: null,
            errorKey: "Failed to delete geofence",
            cancellationToken,
            reload: false).ConfigureAwait(false);

        if (!ok)
        {
            return false;
        }

        _selected.Clear();
        PushToast(_localizer.GetString("toast.geofence.bulkDelete.success", "Geofences deleted"), isError: false);
        await LoadAsync(cancellationToken).ConfigureAwait(false);
        return true;
    }

    /// <summary>Resolve a vehicle's latest position to seed the form (web <c>handleGetLocation</c> vehicle branch).</summary>
    public Task<GeofencePosition?> GetLatestPositionAsync(long vehicleId, CancellationToken cancellationToken = default) =>
        _feed.FetchLatestPositionAsync(vehicleId, cancellationToken);

    /// <summary>Surface a transient toast (web <c>toast.success</c> / <c>toast.error</c>) from a view-level flow.</summary>
    public void PushToast(string message, bool isError)
    {
        _toastMessage = message ?? string.Empty;
        _toastIsError = isError;
        _toastSequence++;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(ToastSequence)));
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

    private async Task LoadSideReadsAsync(CancellationToken cancellationToken)
    {
        try
        {
            var vehicles = await _feed.FetchVehiclesAsync(cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            _vehicles = vehicles ?? Array.Empty<GeofenceVehicleOption>();
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            // web: useVehicles is an independent query — its failure never blocks the geofence list.
            _vehicles = Array.Empty<GeofenceVehicleOption>();
        }

        try
        {
            var pins = await _feed.FetchPinnedAsync(cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            _pins = pins ?? Array.Empty<GeofencePin>();
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            // web: usePinned always resolves to an array — treat a failure as "no pins" (unsorted list).
            _pins = Array.Empty<GeofencePin>();
        }
    }

    private async Task<bool> RunWriteAsync(
        Func<CancellationToken, Task> mutation,
        string? successKey,
        string errorKey,
        CancellationToken cancellationToken,
        bool reload = true)
    {
        IsFetching = true;
        try
        {
            await mutation(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            IsFetching = false;
            return false;
        }
        catch (Exception)
        {
            PushToast(_localizer.GetString(errorKey, errorKey), isError: true);
            IsFetching = false;
            Reproject();
            return false;
        }

        if (successKey is not null)
        {
            PushToast(_localizer.GetString(successKey, successKey), isError: false);
        }

        if (reload)
        {
            await LoadAsync(cancellationToken).ConfigureAwait(false);
        }
        else
        {
            IsFetching = false;
        }

        return true;
    }

    private void PruneSelection()
    {
        if (_selected.Count == 0)
        {
            return;
        }

        var present = new HashSet<long>(_items.Select(g => g.Id));
        _selected.RemoveWhere(id => !present.Contains(id));
    }

    private GeofencesModel BuildModel() => new(
        Items: _items,
        Pins: _pins,
        Loading: _loading,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        Search: _search,
        SelectedIds: _selected);

    private void Reproject()
    {
        var display = GeofencesProjection.Project(BuildModel(), _localizer);
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
