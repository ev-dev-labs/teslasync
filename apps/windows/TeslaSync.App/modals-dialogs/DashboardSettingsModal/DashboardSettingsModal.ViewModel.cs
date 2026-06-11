using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="DashboardSettingsModal"/> view — the native port of
/// the web <c>DashboardSettingsModal</c> component
/// (web/src/features/dashboard/components/DashboardSettingsModal.tsx). The web component is a controlled form: its
/// only data dependency is <c>useTranslation</c>, while the dashboard and the vehicle list arrive as props from
/// the parent page. This holder reproduces that exactly — <see cref="Open"/> seeds the editable fields from the
/// supplied dashboard (the web <c>useEffect</c> reset on open / dashboard change), projects the vehicle + refresh
/// dropdown options and the localized chrome through <see cref="DashboardSettingsModalProjection"/> /
/// <see cref="DashboardSettingsModalRegistration"/>, and <see cref="Save"/> assembles the web <c>handleSave</c>
/// diff, raises it through <see cref="SaveRequested"/>, records the diagnostic and requests the close. Because
/// there is no asynchronous read, there is deliberately no loading / error / stale / offline branch (see
/// <see cref="DashboardSettingsModalState"/>); the empty-data branch is the vehicle filter degrading to the lone
/// "All Vehicles" option (<see cref="HasVehicles"/>). The view never performs HTTP. Drive it from one confinement
/// (the UI thread); it is not internally synchronised. Dispose it with the view.
/// </summary>
public sealed class DashboardSettingsModalViewModel : INotifyPropertyChanged, IDisposable
{
    private static readonly IReadOnlyList<VehicleOption> NoVehicles = Array.Empty<VehicleOption>();
    private static readonly IReadOnlyList<DashboardSelectOption> NoOptions =
        Array.Empty<DashboardSelectOption>();

    private readonly ILocalizer _localizer;
    private readonly DashboardSettingsModalDiagnostics _diagnostics;
    private readonly IReadOnlyList<string> _emojis = DashboardSettingsModalProjection.Emojis();

    private SavedDashboardInput? _original;
    private IReadOnlyList<VehicleOption> _vehicles = NoVehicles;

    private DashboardSettingsModalState _state = DashboardSettingsModalState.Closed;
    private IReadOnlyList<DashboardSelectOption> _vehicleOptions = NoOptions;
    private IReadOnlyList<DashboardSelectOption> _refreshOptions;
    private bool _hasVehicles;

    private string _name = string.Empty;
    private string _icon = DashboardSettingsModalRegistration.DefaultIcon;
    private long? _vehicleId;
    private int _refreshIntervalSeconds;
    private bool _showWidgetBorders;
    private bool _compactMode;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade and (optional) diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (web <c>useTranslation</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink (defaults to a no-op collector).</param>
    public DashboardSettingsModalViewModel(
        ILocalizer localizer, DashboardSettingsModalDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
        _diagnostics = diagnostics ?? new DashboardSettingsModalDiagnostics();
        _refreshOptions = DashboardSettingsModalProjection.RefreshOptions(localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when the modal is saved, carrying the diff the host applies (web <c>handleSave</c>).</summary>
    public event EventHandler<DashboardSettingsSaveResult>? SaveRequested;

    /// <summary>Raised when the modal should close (web <c>onClose</c>): after a save or a cancel.</summary>
    public event EventHandler? CloseRequested;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public DashboardSettingsModalState State
    {
        get => _state;
        private set
        {
            if (_state == value)
            {
                return;
            }

            _state = value;
            Raise(nameof(State));
            Raise(nameof(IsOpen));
        }
    }

    /// <summary>True while the controlled modal is open (web <c>open === true</c>).</summary>
    public bool IsOpen => _state == DashboardSettingsModalState.Ready;

    /// <summary>True when at least one vehicle is available to scope the dashboard to.</summary>
    public bool HasVehicles
    {
        get => _hasVehicles;
        private set => Set(ref _hasVehicles, value);
    }

    /// <summary>The selectable dashboard icons in web render order (the picker grid).</summary>
    public IReadOnlyList<string> Emojis => _emojis;

    /// <summary>The vehicle-filter options ("All Vehicles" first, then one per vehicle).</summary>
    public IReadOnlyList<DashboardSelectOption> VehicleOptions
    {
        get => _vehicleOptions;
        private set => Set(ref _vehicleOptions, value);
    }

    /// <summary>The auto-refresh options (value token + localized label) in web render order.</summary>
    public IReadOnlyList<DashboardSelectOption> RefreshOptions
    {
        get => _refreshOptions;
        private set => Set(ref _refreshOptions, value);
    }

    /// <summary>The editable dashboard name (web <c>name</c>).</summary>
    public string Name
    {
        get => _name;
        set => Set(ref _name, value ?? string.Empty);
    }

    /// <summary>The editable dashboard icon glyph (web <c>icon</c>).</summary>
    public string Icon
    {
        get => _icon;
        set => Set(ref _icon, value ?? DashboardSettingsModalRegistration.DefaultIcon);
    }

    /// <summary>The selected vehicle scope, or <c>null</c> for all vehicles (web <c>settings.vehicleId</c>).</summary>
    public long? VehicleId
    {
        get => _vehicleId;
        set => Set(ref _vehicleId, value);
    }

    /// <summary>The selected auto-refresh interval in seconds (web <c>settings.refreshInterval</c>).</summary>
    public int RefreshIntervalSeconds
    {
        get => _refreshIntervalSeconds;
        set => Set(ref _refreshIntervalSeconds, value);
    }

    /// <summary>Whether widget borders are shown (web <c>settings.showWidgetBorders</c>).</summary>
    public bool ShowWidgetBorders
    {
        get => _showWidgetBorders;
        set => Set(ref _showWidgetBorders, value);
    }

    /// <summary>Whether compact mode is enabled (web <c>settings.compactMode</c>).</summary>
    public bool CompactMode
    {
        get => _compactMode;
        set => Set(ref _compactMode, value);
    }

    /// <summary>Modal title (web <c>dashSettings.title</c>).</summary>
    public string Title => DashboardSettingsModalRegistration.Title(_localizer);

    /// <summary>Identity section heading (web <c>dashSettings.identity</c>).</summary>
    public string IdentityLabel => DashboardSettingsModalRegistration.Identity(_localizer);

    /// <summary>Name field label (web <c>dashSettings.nameLabel</c>).</summary>
    public string NameLabel => DashboardSettingsModalRegistration.NameLabel(_localizer);

    /// <summary>Name field prompt (web <c>dashSettings.name</c>).</summary>
    public string NamePrompt => DashboardSettingsModalRegistration.NamePrompt(_localizer);

    /// <summary>Icon picker label (web <c>dashSettings.iconLabel</c>).</summary>
    public string IconLabel => DashboardSettingsModalRegistration.IconLabel(_localizer);

    /// <summary>Vehicle-filter section heading (web <c>dashSettings.vehicleFilter</c>).</summary>
    public string VehicleFilterLabel => DashboardSettingsModalRegistration.VehicleFilter(_localizer);

    /// <summary>Vehicle-filter description (web <c>dashSettings.vehicleFilterDesc</c>).</summary>
    public string VehicleFilterDescription =>
        DashboardSettingsModalRegistration.VehicleFilterDescription(_localizer);

    /// <summary>Auto-refresh section heading (web <c>dashSettings.refresh</c>).</summary>
    public string RefreshLabel => DashboardSettingsModalRegistration.Refresh(_localizer);

    /// <summary>Display section heading (web <c>dashSettings.display</c>).</summary>
    public string DisplayLabel => DashboardSettingsModalRegistration.Display(_localizer);

    /// <summary>Show-widget-borders toggle label (web <c>dashSettings.showBorders</c>).</summary>
    public string ShowBordersLabel => DashboardSettingsModalRegistration.ShowBorders(_localizer);

    /// <summary>Compact-mode toggle label (web <c>dashSettings.compactMode</c>).</summary>
    public string CompactModeLabel => DashboardSettingsModalRegistration.CompactMode(_localizer);

    /// <summary>Cancel action label (web <c>common.cancel</c>).</summary>
    public string CancelLabel => DashboardSettingsModalRegistration.Cancel(_localizer);

    /// <summary>Save action label (web <c>common.save</c>).</summary>
    public string SaveLabel => DashboardSettingsModalRegistration.Save(_localizer);

    /// <summary>
    /// Open the modal for <paramref name="dashboard"/>, seeding every editable field from it and projecting the
    /// vehicle options from <paramref name="vehicles"/> — the native analogue of the web <c>useEffect</c> that
    /// resets the form state when the modal opens or the target dashboard changes. Emits the <c>view.opened</c>
    /// diagnostic.
    /// </summary>
    /// <param name="dashboard">The dashboard whose settings are edited.</param>
    /// <param name="vehicles">The vehicles offered in the vehicle-filter dropdown (may be empty).</param>
    public void Open(SavedDashboardInput dashboard, IReadOnlyList<VehicleOption> vehicles)
    {
        ArgumentNullException.ThrowIfNull(dashboard);
        ArgumentNullException.ThrowIfNull(vehicles);
        if (_disposed)
        {
            return;
        }

        _original = dashboard;
        _vehicles = vehicles;

        DashboardSettingsValues settings = DashboardSettingsModalProjection.ResolveSettings(dashboard.Settings);
        Name = dashboard.Name;
        Icon = DashboardSettingsModalProjection.NormalizeIcon(dashboard.Icon);
        VehicleId = settings.VehicleId;
        RefreshIntervalSeconds = settings.RefreshIntervalSeconds;
        ShowWidgetBorders = settings.ShowWidgetBorders;
        CompactMode = settings.CompactMode;

        VehicleOptions = DashboardSettingsModalProjection.VehicleOptions(vehicles, _localizer);
        HasVehicles = vehicles.Count > 0;

        State = DashboardSettingsModalState.Ready;
        _diagnostics.RecordViewOpened();
    }

    /// <summary>
    /// Assemble and raise the save diff (web <c>handleSave</c>): a trimmed, non-empty, changed name and a changed
    /// icon are carried, the settings are always carried, the <c>settings.saved</c> diagnostic is recorded, and a
    /// close is requested (web <c>onClose</c>). Returns the diff that was raised.
    /// </summary>
    public DashboardSettingsSaveResult Save()
    {
        DashboardSettingsValues settings = CurrentSettings();
        SavedDashboardInput original =
            _original ?? new SavedDashboardInput(string.Empty, _name, _icon, settings);

        DashboardSettingsSaveResult result =
            DashboardSettingsModalProjection.BuildSaveResult(original, _name, _icon, settings);

        SaveRequested?.Invoke(this, result);
        _diagnostics.RecordSettingsSaved();
        RequestClose();
        return result;
    }

    /// <summary>Dismiss the modal without saving (web <c>Cancel</c> / <c>onClose</c>).</summary>
    public void Cancel() => RequestClose();

    /// <summary>
    /// Re-resolve every localized label and re-project the option lists — the native analogue of react-i18next
    /// re-rendering after the active language changes. The edited field values are unaffected.
    /// </summary>
    public void Reload()
    {
        RefreshOptions = DashboardSettingsModalProjection.RefreshOptions(_localizer);
        VehicleOptions = DashboardSettingsModalProjection.VehicleOptions(_vehicles, _localizer);
        RaiseAllLabels();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        GC.SuppressFinalize(this);
    }

    private DashboardSettingsValues CurrentSettings() =>
        new(_refreshIntervalSeconds, _vehicleId, _showWidgetBorders, _compactMode);

    private void RequestClose()
    {
        State = DashboardSettingsModalState.Closed;
        CloseRequested?.Invoke(this, EventArgs.Empty);
    }

    private void RaiseAllLabels()
    {
        Raise(nameof(Title));
        Raise(nameof(IdentityLabel));
        Raise(nameof(NameLabel));
        Raise(nameof(NamePrompt));
        Raise(nameof(IconLabel));
        Raise(nameof(VehicleFilterLabel));
        Raise(nameof(VehicleFilterDescription));
        Raise(nameof(RefreshLabel));
        Raise(nameof(DisplayLabel));
        Raise(nameof(ShowBordersLabel));
        Raise(nameof(CompactModeLabel));
        Raise(nameof(CancelLabel));
        Raise(nameof(SaveLabel));
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        Raise(name);
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
