using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>The transient action phase of the switcher — which modal surface (if any) is open.</summary>
public enum LayoutSwitcherActionPhase
{
    /// <summary>No modal action is in progress (the menu may still be open).</summary>
    Idle,

    /// <summary>The save-as name prompt is open (web <c>window.prompt</c> equivalent).</summary>
    PromptingSaveAs,

    /// <summary>The reset-to-default confirmation dialog is open (web <c>confirm(...)</c>).</summary>
    ConfirmingReset,
}

/// <summary>Event payload carrying the layout id a switch / duplicate / pin action targets.</summary>
public sealed class LayoutIdEventArgs : EventArgs
{
    /// <summary>Creates the payload for <paramref name="layoutId"/>.</summary>
    /// <param name="layoutId">The target layout id.</param>
    public LayoutIdEventArgs(string layoutId)
    {
        ArgumentNullException.ThrowIfNull(layoutId);
        LayoutId = layoutId;
    }

    /// <summary>The target layout id (web callback's <c>id</c> argument).</summary>
    public string LayoutId { get; }
}

/// <summary>Event payload carrying the name a new layout should be created with (web <c>onCreate(name)</c>).</summary>
public sealed class LayoutCreateEventArgs : EventArgs
{
    /// <summary>Creates the payload for <paramref name="name"/>.</summary>
    /// <param name="name">The trimmed, non-empty new layout name.</param>
    public LayoutCreateEventArgs(string name)
    {
        ArgumentNullException.ThrowIfNull(name);
        Name = name;
    }

    /// <summary>The trimmed, non-empty new layout name.</summary>
    public string Name { get; }
}

/// <summary>
/// Event payload for the pin-to-vehicle toggle (web <c>onPinToVehicle(id, vehicleId)</c>): the layout to
/// (un)pin and the target vehicle id (<see langword="null"/> unpins it to user-global scope).
/// </summary>
public sealed class LayoutPinEventArgs : EventArgs
{
    /// <summary>Creates the payload pinning <paramref name="layoutId"/> to <paramref name="vehicleId"/>.</summary>
    /// <param name="layoutId">The layout to (un)pin.</param>
    /// <param name="vehicleId">The vehicle id to pin to, or null to unpin to user-global scope.</param>
    public LayoutPinEventArgs(string layoutId, long? vehicleId)
    {
        ArgumentNullException.ThrowIfNull(layoutId);
        LayoutId = layoutId;
        VehicleId = vehicleId;
    }

    /// <summary>The layout to (un)pin.</summary>
    public string LayoutId { get; }

    /// <summary>The vehicle id to pin to, or null to unpin to user-global scope.</summary>
    public long? VehicleId { get; }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="LayoutSwitcher"/> view — the native port of the
/// web <c>LayoutSwitcher</c> hook composition + handlers
/// (web/src/features/dashboard/components/LayoutSwitcher.tsx). It owns the controlled inputs (the web props
/// surfaced through <see cref="Model"/> and the per-field setters), the menu-open flag (web
/// <c>useState(open)</c>) and the modal <see cref="Phase"/> (the web <c>window.prompt</c> / <c>useConfirm</c>
/// flows), re-projects through <see cref="LayoutSwitcherProjection"/> whenever an input changes, and exposes
/// the resulting <see cref="Display"/> so the view is a thin renderer. The action commands reproduce the web
/// handlers (<c>handleSaveAs</c>, <c>handleReset</c>, <c>handlePinToggle</c>, the per-row switch and the edit
/// toggle) and raise the parent-owned callbacks as events (the web <c>onSwitch</c> / <c>onCreate</c> /
/// <c>onDuplicate</c> / <c>onReset</c> / <c>onToggleEdit</c> / <c>onPinToVehicle</c> props). The view never
/// performs HTTP; the only seam is the i18n facade (the web's single <c>useTranslation</c> hook). Drive it
/// from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class LayoutSwitcherViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly LayoutSwitcherDiagnostics _diagnostics;

    private LayoutSwitcherModel _model;
    private LayoutSwitcherDisplay _display;
    private bool _isMenuOpen;
    private LayoutSwitcherActionPhase _phase = LayoutSwitcherActionPhase.Idle;

    /// <summary>Creates the holder over the i18n facade, an optional initial model and optional diagnostics.</summary>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    /// <param name="model">The initial inputs; defaults to <see cref="LayoutSwitcherModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the action counters.</param>
    public LayoutSwitcherViewModel(
        ILocalizer localizer,
        LayoutSwitcherModel? model = null,
        LayoutSwitcherDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new LayoutSwitcherDiagnostics();
        _model = model ?? LayoutSwitcherModel.Empty;
        _display = Project();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised to switch to a layout (web <c>onSwitch(id)</c>).</summary>
    public event EventHandler<LayoutIdEventArgs>? SwitchRequested;

    /// <summary>Raised to create a new layout from the prompted name (web <c>onCreate(name)</c>).</summary>
    public event EventHandler<LayoutCreateEventArgs>? CreateRequested;

    /// <summary>Raised to duplicate the active layout (web <c>onDuplicate(id)</c>).</summary>
    public event EventHandler<LayoutIdEventArgs>? DuplicateRequested;

    /// <summary>Raised to (un)pin the active layout to a vehicle (web <c>onPinToVehicle(id, vehicleId)</c>).</summary>
    public event EventHandler<LayoutPinEventArgs>? PinToVehicleRequested;

    /// <summary>Raised when the user confirms reset-to-default (web <c>onReset()</c>).</summary>
    public event EventHandler? ResetRequested;

    /// <summary>Raised to toggle dashboard edit mode (web <c>onToggleEdit()</c>).</summary>
    public event EventHandler? ToggleEditRequested;

    /// <summary>The current inputs; reassigning re-projects and re-renders the surface.</summary>
    public LayoutSwitcherModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            if (ReferenceEquals(_model, value))
            {
                return;
            }

            _model = value;
            Display = Project();
        }
    }

    /// <summary>The projected, render-ready display for the current inputs.</summary>
    public LayoutSwitcherDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
        }
    }

    /// <summary>True while the saved-layouts menu is open (web <c>open</c> state).</summary>
    public bool IsMenuOpen
    {
        get => _isMenuOpen;
        private set
        {
            if (Set(ref _isMenuOpen, value))
            {
                Raise(nameof(IsMenuOpen));
            }
        }
    }

    /// <summary>The current modal action phase.</summary>
    public LayoutSwitcherActionPhase Phase => _phase;

    /// <summary>True while the save-as name prompt should be open.</summary>
    public bool IsSaveAsPromptOpen => _phase == LayoutSwitcherActionPhase.PromptingSaveAs;

    /// <summary>True while the reset confirmation dialog should be open.</summary>
    public bool IsResetConfirmOpen => _phase == LayoutSwitcherActionPhase.ConfirmingReset;

    // ── Input setters (web prop updates) ─────────────────────────────────────────────────────────────

    /// <summary>Update the saved-layouts list (web <c>dashboards</c> prop).</summary>
    /// <param name="dashboards">The new saved-layouts list.</param>
    public void SetDashboards(IReadOnlyList<LayoutSummary> dashboards)
    {
        ArgumentNullException.ThrowIfNull(dashboards);
        Model = _model with { Dashboards = dashboards };
    }

    /// <summary>Update the active layout id (web <c>activeId</c> prop).</summary>
    /// <param name="activeId">The new active layout id.</param>
    public void SetActiveId(string activeId)
    {
        ArgumentNullException.ThrowIfNull(activeId);
        Model = _model with { ActiveId = activeId };
    }

    /// <summary>Update the unsaved-changes flag (web <c>dirty</c> prop).</summary>
    /// <param name="dirty">Whether the active layout has unsaved changes.</param>
    public void SetDirty(bool dirty) => Model = _model with { Dirty = dirty };

    /// <summary>Update the edit-mode flag (web <c>editMode</c> prop).</summary>
    /// <param name="editMode">Whether the dashboard is in edit mode.</param>
    public void SetEditMode(bool editMode) => Model = _model with { EditMode = editMode };

    /// <summary>Update the selected vehicle (web <c>useSelectedVehicle()</c> result).</summary>
    /// <param name="vehicleId">The selected vehicle id used to scope the layout list.</param>
    /// <param name="vehicle">The selected vehicle's labels for the pinned badge, or null.</param>
    public void SetSelectedVehicle(long? vehicleId, LayoutSwitcherVehicle? vehicle) =>
        Model = _model with { SelectedVehicleId = vehicleId, SelectedVehicle = vehicle };

    // ── Menu open/close (web setOpen) ────────────────────────────────────────────────────────────────

    /// <summary>Toggle the saved-layouts menu (web trigger <c>onClick={() =&gt; setOpen(v =&gt; !v)}</c>).</summary>
    public void ToggleMenu() => IsMenuOpen = !_isMenuOpen;

    /// <summary>Open the saved-layouts menu.</summary>
    public void OpenMenu() => IsMenuOpen = true;

    /// <summary>Close the saved-layouts menu (web <c>setOpen(false)</c>).</summary>
    public void CloseMenu() => IsMenuOpen = false;

    // ── Commands (web handlers) ──────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Switch to <paramref name="layoutId"/> and close the menu (web per-row
    /// <c>onClick={() =&gt; { onSwitch(d.id); setOpen(false); }}</c>).
    /// </summary>
    /// <param name="layoutId">The layout id to switch to.</param>
    public void Switch(string layoutId)
    {
        ArgumentNullException.ThrowIfNull(layoutId);
        CloseMenu();
        _diagnostics.RecordLayoutSwitched();
        SwitchRequested?.Invoke(this, new LayoutIdEventArgs(layoutId));
    }

    /// <summary>
    /// Begin the save-as flow: close the menu and open the name prompt (web <c>handleSaveAs</c> up to
    /// <c>window.prompt</c>). The pre-filled suggestion is <see cref="LayoutSwitcherDisplay.SaveAsSuggestion"/>.
    /// </summary>
    public void BeginSaveAs()
    {
        CloseMenu();
        SetPhase(LayoutSwitcherActionPhase.PromptingSaveAs);
    }

    /// <summary>
    /// Commit the save-as prompt with the entered <paramref name="name"/> (web <c>handleSaveAs</c> tail): an
    /// empty / whitespace name is a no-op; otherwise the active layout is duplicated when the host supports it
    /// (web <c>onDuplicate &amp;&amp; active</c>), else a new layout is created with the trimmed name.
    /// </summary>
    /// <param name="name">The entered name (null is treated as empty).</param>
    public void CommitSaveAs(string? name)
    {
        SetPhase(LayoutSwitcherActionPhase.Idle);

        string trimmed = name?.Trim() ?? string.Empty;
        if (trimmed.Length == 0)
        {
            return;
        }

        LayoutSummary? active = _model.Active;
        if (_model.CanDuplicate && active is { } a)
        {
            _diagnostics.RecordLayoutCreated();
            DuplicateRequested?.Invoke(this, new LayoutIdEventArgs(a.Id));
            return;
        }

        _diagnostics.RecordLayoutCreated();
        CreateRequested?.Invoke(this, new LayoutCreateEventArgs(trimmed));
    }

    /// <summary>Dismiss the save-as prompt without creating a layout (web prompt cancel).</summary>
    public void CancelSaveAs()
    {
        if (_phase == LayoutSwitcherActionPhase.PromptingSaveAs)
        {
            SetPhase(LayoutSwitcherActionPhase.Idle);
        }
    }

    /// <summary>Begin the reset flow: close the menu and open the confirmation dialog (web <c>handleReset</c>).</summary>
    public void BeginReset()
    {
        CloseMenu();
        SetPhase(LayoutSwitcherActionPhase.ConfirmingReset);
    }

    /// <summary>Confirm reset-to-default (web <c>if (ok) onReset()</c>).</summary>
    public void ConfirmReset()
    {
        if (_phase != LayoutSwitcherActionPhase.ConfirmingReset)
        {
            return;
        }

        SetPhase(LayoutSwitcherActionPhase.Idle);
        _diagnostics.RecordLayoutReset();
        ResetRequested?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Dismiss the reset confirmation without resetting (web confirm cancel).</summary>
    public void CancelReset()
    {
        if (_phase == LayoutSwitcherActionPhase.ConfirmingReset)
        {
            SetPhase(LayoutSwitcherActionPhase.Idle);
        }
    }

    /// <summary>
    /// Toggle the active layout's vehicle pin and close the menu (web <c>handlePinToggle</c>): no-ops when the
    /// host does not support pinning or there is no active layout; an active layout pinned to a vehicle is
    /// unpinned (to user-global), otherwise it is pinned to the selected vehicle when one is selected.
    /// </summary>
    public void TogglePin()
    {
        LayoutSummary? active = _model.Active;
        if (!_model.CanPin || active is not { } a)
        {
            return;
        }

        CloseMenu();

        if (a.VehicleId is not null)
        {
            _diagnostics.RecordPinToggled();
            PinToVehicleRequested?.Invoke(this, new LayoutPinEventArgs(a.Id, null));
        }
        else if (_model.SelectedVehicleId is { } vehicleId)
        {
            _diagnostics.RecordPinToggled();
            PinToVehicleRequested?.Invoke(this, new LayoutPinEventArgs(a.Id, vehicleId));
        }
    }

    /// <summary>Toggle dashboard edit mode (web inline edit button <c>onClick={onToggleEdit}</c>).</summary>
    public void ToggleEdit()
    {
        if (!_model.CanToggleEdit)
        {
            return;
        }

        ToggleEditRequested?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>
    /// Re-resolve every label from the localizer and re-project the current inputs — the native analogue of
    /// react-i18next re-rendering after the active language changes.
    /// </summary>
    public void Reload() => Display = Project();

    private LayoutSwitcherDisplay Project() => LayoutSwitcherProjection.Project(_model, _localizer);

    private void SetPhase(LayoutSwitcherActionPhase value)
    {
        if (_phase == value)
        {
            return;
        }

        _phase = value;
        Raise(nameof(Phase));
        Raise(nameof(IsSaveAsPromptOpen));
        Raise(nameof(IsResetConfirmOpen));
    }

    private static bool Set<T>(ref T field, T value)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        return true;
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
