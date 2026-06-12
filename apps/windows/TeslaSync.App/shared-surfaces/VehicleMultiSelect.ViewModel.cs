using System.ComponentModel;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="VehicleMultiSelect"/> view — the native port of the
/// web <c>VehicleMultiSelect</c> component body (web/src/components/forms/VehicleMultiSelect.tsx). It composes
/// the shared, unit-tested Core selection engine (<see cref="VehicleMultiSelectController"/> +
/// <see cref="VehicleSelectionOps"/> + <see cref="VehicleLabels"/>, P1/S8) rather than re-implementing the
/// discriminated-union value, and binds the fleet read seam (<see cref="IVehicleMultiSelectFleetSource"/>, the
/// native <c>useVehicles</c>). It reproduces every branch the web source renders — the trigger summary
/// (all / none / one / partial / count), the disabled empty-fleet state with its help text (web
/// <c>isFleetEmpty</c>), the inline validation error (web <c>errorKey</c>), the open/closed listbox, the
/// "All vehicles (current + future)" sentinel mutually exclusive with the per-vehicle subset (toggling it off
/// restores the prior subset), and the stored-but-missing "Unknown" rows that are never silently dropped — and
/// adds the loading / error / stale / offline chrome the fleet query has but the web prop-fed component does
/// not. Selection changes are announced through the shared announcer (<see cref="IAnnouncerBus"/>). The view
/// binds the projected state and performs no I/O. Drive it from one confinement (the UI thread).
/// </summary>
public sealed class VehicleMultiSelectViewModel : INotifyPropertyChanged, IDisposable
{
    private const string SentinelAutomationId = "vehicle-multiselect-option-all_sticky_sentinel";

    private static readonly PropertyChangedEventArgs AllProperties = new(string.Empty);
    private static readonly IReadOnlyList<VehicleOption> NoVehicles = Array.Empty<VehicleOption>();

    private readonly IVehicleMultiSelectFleetSource _fleetSource;
    private readonly VehicleMultiSelectController _controller;
    private readonly ILocalizer _localizer;
    private readonly IAnnouncerBus _announcer;
    private readonly VehicleMultiSelectDiagnostics _diagnostics;
    private readonly CancellationTokenSource _cts = new();

    private IReadOnlyList<VehicleOption> _vehicles = NoVehicles;
    private VehicleMultiSelectFleetState _fleetState = VehicleMultiSelectFleetState.Loading;
    private string? _validationErrorKey;
    private bool _disabled;
    private bool _open;
    private bool _disposed;

    /// <summary>Creates the holder over the fleet read seam, the i18n facade and optional seams.</summary>
    /// <param name="fleetSource">The fleet read port (web <c>useVehicles</c>); the surface's P1/S8 seam.</param>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10).</param>
    /// <param name="initialSelection">The initial value (web <c>value</c> prop); defaults to the fleet-wide sentinel.</param>
    /// <param name="announcer">The screen-reader announcer bus (web <c>useAnnouncer()</c>); defaults to the shared bus.</param>
    /// <param name="validationErrorKey">An inline validation error i18n key (web <c>errorKey</c> prop); null when valid.</param>
    /// <param name="disabled">When true the trigger is non-interactive (web <c>disabled</c> prop).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public VehicleMultiSelectViewModel(
        IVehicleMultiSelectFleetSource fleetSource,
        ILocalizer localizer,
        VehicleMultiSelection? initialSelection = null,
        IAnnouncerBus? announcer = null,
        string? validationErrorKey = null,
        bool disabled = false,
        VehicleMultiSelectDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(fleetSource);
        ArgumentNullException.ThrowIfNull(localizer);

        _fleetSource = fleetSource;
        _localizer = localizer;
        _announcer = announcer ?? AnnouncerBus.Shared;
        _diagnostics = diagnostics ?? new VehicleMultiSelectDiagnostics();
        _validationErrorKey = validationErrorKey;
        _controller = new VehicleMultiSelectController(initialSelection);
        _controller.PropertyChanged += OnControllerChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised whenever the committed selection changes (web <c>onChange(next)</c>).</summary>
    public event EventHandler<VehicleMultiSelection>? SelectionChanged;

    // ── Fleet lifecycle ──────────────────────────────────────────────────────────────────────────────────

    /// <summary>The fleet read's render state (web <c>useVehicles</c> lifecycle, projected to the prompt's matrix).</summary>
    public VehicleMultiSelectFleetState FleetState => _fleetState;

    /// <summary>True while the fleet is loading and no cached list is visible (web query <c>isLoading</c>).</summary>
    public bool IsLoading => _fleetState == VehicleMultiSelectFleetState.Loading;

    /// <summary>True when the fleet load failed with no cached list (web query <c>isError</c>).</summary>
    public bool IsFleetError => _fleetState == VehicleMultiSelectFleetState.Error;

    /// <summary>True when the fleet resolved with no vehicles — the web <c>isFleetEmpty</c> branch.</summary>
    public bool IsFleetEmpty => _fleetState == VehicleMultiSelectFleetState.Empty;

    /// <summary>True when a cached fleet is shown past its freshness window (stale chip + auto-refresh).</summary>
    public bool IsStale => _fleetState == VehicleMultiSelectFleetState.Stale;

    /// <summary>True when the network failed but a cached fleet remains usable (offline chip + cached value).</summary>
    public bool IsOffline => _fleetState == VehicleMultiSelectFleetState.Offline;

    /// <summary>True when at least one vehicle is available to pick.</summary>
    public bool HasFleet => _vehicles.Count > 0;

    /// <summary>The loaded fleet (empty until loaded).</summary>
    public IReadOnlyList<VehicleOption> Vehicles => _vehicles;

    // ── Selection value ──────────────────────────────────────────────────────────────────────────────────

    /// <summary>The current selection value (web <c>value</c>).</summary>
    public VehicleMultiSelection Selection => _controller.Value;

    /// <summary>The wire sub-payload for the current selection (web <c>buildVehiclePayload</c>).</summary>
    public (bool AllVehicles, IReadOnlyList<long> VehicleIds) Payload =>
        VehicleSelectionOps.BuildPayload(_controller.Value);

    /// <summary>Replace the selection (web controlled <c>value</c> update); remembers the prior subset for the sentinel.</summary>
    public void SetSelection(VehicleMultiSelection selection)
    {
        ArgumentNullException.ThrowIfNull(selection);
        _controller.Value = selection;
    }

    /// <summary>
    /// Toggle the "All vehicles" sentinel (web <c>handleToggleAll</c>). Turning it on moves to the fleet-wide
    /// value; turning it off restores the previously-selected subset (empty when none).
    /// </summary>
    public void ToggleAll() => _controller.ToggleAll();

    /// <summary>Toggle a single vehicle in the subset (web <c>handleToggleVehicle</c>).</summary>
    public void ToggleVehicle(long vehicleId) => _controller.ToggleVehicle(vehicleId);

    // ── Trigger / popover ────────────────────────────────────────────────────────────────────────────────

    /// <summary>Whether the trigger is non-interactive — web <c>disabled || isFleetEmpty</c>.</summary>
    public bool IsDisabled => _disabled || IsFleetEmpty;

    /// <summary>The consumer-supplied disabled flag (web <c>disabled</c> prop).</summary>
    public bool Disabled
    {
        get => _disabled;
        set
        {
            if (_disabled == value)
            {
                return;
            }

            _disabled = value;
            if (!CanOpen)
            {
                _open = false;
            }

            RaiseAll();
        }
    }

    /// <summary>True only when the listbox can be opened — enabled, with a pickable (non-empty) fleet present.</summary>
    private bool CanOpen => !_disabled && HasFleet;

    /// <summary>Whether the option listbox is open (web <c>open</c>); never open while disabled, loading or fleet-empty.</summary>
    public bool IsOpen => _open && CanOpen;

    /// <summary>Open the listbox (web <c>setOpen(true)</c>); a no-op while disabled, loading or fleet-empty.</summary>
    public void Open()
    {
        if (_disposed || !CanOpen || _open)
        {
            return;
        }

        _open = true;
        RaiseAll();
    }

    /// <summary>Close the listbox (web <c>setOpen(false)</c>).</summary>
    public void Close()
    {
        if (!_open)
        {
            return;
        }

        _open = false;
        RaiseAll();
    }

    /// <summary>Toggle the listbox open/closed (web trigger <c>onClick</c>).</summary>
    public void Toggle()
    {
        if (IsOpen)
        {
            Close();
        }
        else
        {
            Open();
        }
    }

    /// <summary>The trigger summary chip text (web <c>triggerSummary</c>): all / none / one / partial / count.</summary>
    public string TriggerSummary =>
        VehicleMultiSelectRegistration.Summary(_localizer, _controller.Summarize(_vehicles));

    /// <summary>
    /// The ordered popover rows the listbox renders — the sentinel, then each known vehicle, then any
    /// stored-but-missing "Unknown" rows (web L282-L410). Each row carries its checked state + automation id;
    /// the view renders the chrome and routes taps back to <see cref="ToggleAll"/> / <see cref="ToggleVehicle"/>.
    /// </summary>
    public IReadOnlyList<VehicleMultiSelectOption> Options
    {
        get
        {
            VehicleMultiSelection value = _controller.Value;
            var rows = new List<VehicleMultiSelectOption>(_vehicles.Count + 1)
            {
                new(
                    VehicleMultiSelectOptionKind.AllSentinel,
                    0,
                    VehicleMultiSelectRegistration.AllOption(_localizer),
                    value.IsAll,
                    SentinelAutomationId),
            };

            foreach (VehicleOption vehicle in _vehicles)
            {
                bool checkedRow = value.Kind == VehicleSelectionKind.Specific
                    && value.VehicleIds.Contains(vehicle.Id);
                rows.Add(new VehicleMultiSelectOption(
                    VehicleMultiSelectOptionKind.Vehicle,
                    vehicle.Id,
                    VehicleLabels.Detailed(vehicle),
                    checkedRow,
                    $"vehicle-multiselect-option-{vehicle.Id}"));
            }

            foreach (long id in UnknownIds)
            {
                rows.Add(new VehicleMultiSelectOption(
                    VehicleMultiSelectOptionKind.Unknown,
                    id,
                    VehicleMultiSelectRegistration.UnknownLabel(_localizer, id),
                    true,
                    $"vehicle-multiselect-option-unknown-{id}"));
            }

            return rows;
        }
    }

    /// <summary>The selected ids that are not in the current fleet (web <c>unknownIds</c>); never dropped.</summary>
    public IReadOnlyList<long> UnknownIds =>
        VehicleSelectionOps.UnknownIds(_controller.Value, _vehicles.Select(v => v.Id));

    // ── Inline validation (web errorKey) ─────────────────────────────────────────────────────────────────

    /// <summary>The inline validation error i18n key (web <c>errorKey</c> prop); null when valid.</summary>
    public string? ValidationErrorKey
    {
        get => _validationErrorKey;
        set
        {
            if (string.Equals(_validationErrorKey, value, StringComparison.Ordinal))
            {
                return;
            }

            _validationErrorKey = value;
            RaiseAll();
        }
    }

    /// <summary>True when an inline validation error is shown (web <c>hasError</c>).</summary>
    public bool HasValidationError => !string.IsNullOrEmpty(_validationErrorKey);

    /// <summary>The resolved inline validation error text, or null when valid (web <c>errorText</c>).</summary>
    public string? ValidationError =>
        _validationErrorKey is { Length: > 0 } key ? _localizer.GetString(key, key) : null;

    // ── Localized chrome labels ──────────────────────────────────────────────────────────────────────────

    /// <summary>The field + listbox accessible name (web <c>label</c>).</summary>
    public string Label => VehicleMultiSelectRegistration.Label(_localizer);

    /// <summary>The empty-fleet help text shown beneath a disabled trigger (web <c>vehiclesEmptyFleetHelp</c>).</summary>
    public string EmptyFleetHelp => VehicleMultiSelectRegistration.EmptyFleetHelp(_localizer);

    /// <summary>The fleet-loading caption.</summary>
    public string LoadingLabel => VehicleMultiSelectRegistration.Loading(_localizer);

    /// <summary>The fleet-load error title.</summary>
    public string ErrorTitle => VehicleMultiSelectRegistration.ErrorTitle(_localizer);

    /// <summary>The retry affordance label.</summary>
    public string RetryLabel => VehicleMultiSelectRegistration.Retry(_localizer);

    /// <summary>The stale chip caption.</summary>
    public string StaleLabel => VehicleMultiSelectRegistration.Stale(_localizer);

    /// <summary>The offline chip caption.</summary>
    public string OfflineLabel => VehicleMultiSelectRegistration.Offline(_localizer);

    /// <summary>The unknown-vehicle warning badge text.</summary>
    public string UnknownBadge => VehicleMultiSelectRegistration.UnknownBadge(_localizer);

    // ── Fleet read ───────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Drive the cache-then-network fleet read (web <c>useVehicles</c>): consume the source's snapshot
    /// sequence, projecting each onto the render state. Safe to call again to refresh; a superseded read is
    /// dropped.
    /// </summary>
    /// <param name="cancellationToken">Cancellation linked to the surface lifetime.</param>
    public async Task LoadVehiclesAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed)
        {
            return;
        }

        if (!HasContent())
        {
            SetFleetState(VehicleMultiSelectFleetState.Loading);
        }

        using var linked = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token, cancellationToken);
        try
        {
            await foreach (RepositoryResult<IReadOnlyList<VehicleOption>> result in
                _fleetSource.StreamVehiclesAsync(linked.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop silently (web parity for an aborted query).
        }
    }

    /// <summary>Retry the fleet load after a failure — re-runs the cache-then-network read from the top.</summary>
    /// <param name="cancellationToken">Cancellation linked to the surface lifetime.</param>
    public Task RetryVehiclesAsync(CancellationToken cancellationToken = default) =>
        LoadVehiclesAsync(cancellationToken);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _controller.PropertyChanged -= OnControllerChanged;
        _cts.Cancel();
        _cts.Dispose();
    }

    private bool HasContent() => _fleetState is VehicleMultiSelectFleetState.Loaded
        or VehicleMultiSelectFleetState.Empty
        or VehicleMultiSelectFleetState.Stale
        or VehicleMultiSelectFleetState.Offline;

    private void Apply(RepositoryResult<IReadOnlyList<VehicleOption>> result)
    {
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!HasContent())
                {
                    SetFleetState(VehicleMultiSelectFleetState.Loading);
                }

                break;

            case LoadStatus.Cached:
                ApplyFleet(
                    result.Value,
                    result.IsStale ? VehicleMultiSelectFleetState.Stale : VehicleMultiSelectFleetState.Loaded);
                break;

            case LoadStatus.Refreshing:
                ApplyFleet(result.Value, VehicleMultiSelectFleetState.Stale);
                break;

            case LoadStatus.Loaded:
                ApplyFleet(result.Value, VehicleMultiSelectFleetState.Loaded);
                break;

            case LoadStatus.Empty:
                SetFleet(NoVehicles);
                SetFleetState(VehicleMultiSelectFleetState.Empty);
                break;

            case LoadStatus.Offline:
                ApplyFleet(result.Value, VehicleMultiSelectFleetState.Offline);
                break;

            default:
                SetFleetState(VehicleMultiSelectFleetState.Error);
                break;
        }
    }

    private void ApplyFleet(IReadOnlyList<VehicleOption>? fleet, VehicleMultiSelectFleetState state)
    {
        IReadOnlyList<VehicleOption> vehicles = fleet ?? NoVehicles;
        if (vehicles.Count == 0)
        {
            // A resolved-but-empty fleet is the web isFleetEmpty branch regardless of freshness.
            SetFleet(NoVehicles);
            SetFleetState(VehicleMultiSelectFleetState.Empty);
            return;
        }

        SetFleet(vehicles);
        SetFleetState(state);
    }

    private void SetFleet(IReadOnlyList<VehicleOption> vehicles)
    {
        _vehicles = vehicles;
        RaiseAll();
    }

    private void SetFleetState(VehicleMultiSelectFleetState state)
    {
        if (_fleetState == state)
        {
            return;
        }

        _fleetState = state;

        // A fleet that is no longer pickable (empty / loading / error) cannot keep an open listbox.
        if (!CanOpen)
        {
            _open = false;
        }

        RaiseAll();
    }

    private void OnControllerChanged(object? sender, PropertyChangedEventArgs e)
    {
        // The committed value changed (web onChange): re-project, announce the new summary, and notify the host.
        SelectionChanged?.Invoke(this, _controller.Value);
        _announcer.Announce(TriggerSummary);
        RaiseAll();
    }

    private void RaiseAll() => PropertyChanged?.Invoke(this, AllProperties);
}
