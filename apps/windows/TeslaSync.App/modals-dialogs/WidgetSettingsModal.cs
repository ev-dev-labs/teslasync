using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Forms;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The native WinUI 3 <c>WidgetSettingsModal</c> surface — a parity port of
/// web/src/features/dashboard/components/WidgetSettingsModal.tsx. It presents a <see cref="TsModal"/>
/// ("{widget} Settings") whose body stacks the web form: a vehicle-scope dropdown (only for vehicle widgets — web
/// <c>isVehicleWidget</c>), a refresh-interval dropdown (always), a chart time-range dropdown (only for chart
/// widgets — web <c>isChartWidget</c>) and a show-title toggle (always), closed by Cancel / Save. The vehicle
/// dropdown is fed by the cache-then-network <c>useVehicles</c> read and renders every state — loading, loaded,
/// empty, a retryable error, plus stale / offline chips over a cached list — so no state is a blank box. The
/// primary action raises the save callback with the working config and closes (web <c>onSave</c> + <c>onClose</c>);
/// Cancel closes without saving. The view never performs HTTP or holds business logic — it binds the shared
/// <see cref="WidgetSettingsModalViewModel"/>. Every string resolves through the i18n facade, every interactive
/// element carries a Narrator name, and the surface adds no bespoke motion so reduced-motion is honoured by
/// construction.
/// </summary>
public sealed partial class WidgetSettingsModal : ContentControl, IDisposable
{
    private const double FormMinWidth = 360;
    private const double FormMaxHeight = 560;
    private const double FieldSpacing = 16;
    private const double GroupSpacing = 8;

    private readonly WidgetSettingsModalViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;
    private readonly StackPanel _form = new() { Spacing = FieldSpacing, MinWidth = FormMinWidth };
    private readonly TsFormSection _vehicleSection = new();
    private readonly TsSelect _vehicleSelect = new();
    private readonly TsSpinner _vehicleSpinner = new();
    private readonly TsErrorDisplay _vehicleError = new();
    private readonly TsEmptyState _vehicleEmpty = new();
    private readonly InfoBar _vehicleFreshnessBar = new() { IsOpen = false, IsClosable = false };
    private readonly Grid _vehicleStateHost = new();
    private readonly TsFormSection _refreshSection = new();
    private readonly TsSelect _refreshSelect = new();
    private readonly TsFormSection _timeRangeSection = new();
    private readonly TsSelect _timeRangeSelect = new();
    private readonly TsFormSection _appearanceSection = new();
    private readonly TsToggle _showTitleToggle = new();

    private TsModal? _dialog;
    private bool _started;
    private bool _shown;
    private bool _closeRaised;
    private bool _suppressVehicleSelection;
    private bool _disposed;

    /// <summary>Creates the surface over the widget definition, initial config, vehicle source, localizer and sink.</summary>
    /// <param name="def">The widget definition (web <c>def</c>) — supplies the title name and category.</param>
    /// <param name="initialConfig">The widget's persisted config (web <c>widget.config</c>), or null for empty.</param>
    /// <param name="vehicleSource">The fleet read port (web <c>useVehicles</c>).</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public WidgetSettingsModal(
        WidgetCatalogEntry def,
        WidgetConfig? initialConfig,
        IWidgetSettingsVehicleSource vehicleSource,
        ILocalizer localizer,
        WidgetSettingsModalDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(def);
        ArgumentNullException.ThrowIfNull(vehicleSource);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new WidgetSettingsModalViewModel(def, initialConfig, vehicleSource, localizer, diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        AutomationProperties.SetAutomationId(this, "widget-settings-modal");
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildForm();
        Content = _form;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.SettingsSaved += OnViewModelSettingsSaved;
        _viewModel.CloseRequested += OnViewModelCloseRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>Raised when the user saves (web <c>onSave</c>): carries the working config.</summary>
    public event EventHandler<WidgetConfig>? SettingsSaved;

    /// <summary>Raised once the modal has closed (for any reason): save, cancel, or dismiss.</summary>
    public event EventHandler? Closed;

    /// <summary>The canonical surface slug (<c>WidgetSettingsModal</c>).</summary>
    public static string SurfaceId => WidgetSettingsRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public WidgetSettingsModalViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory wiring the contract-client-backed <see cref="WidgetSettingsVehicleSource"/>. The host
    /// supplies the shared contract client, cache-then-network engine and client options.
    /// </summary>
    /// <param name="def">The widget definition (web <c>def</c>).</param>
    /// <param name="initialConfig">The widget's persisted config (web <c>widget.config</c>), or null.</param>
    /// <param name="api">The shared generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public static WidgetSettingsModal Create(
        WidgetCatalogEntry def,
        WidgetConfig? initialConfig,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        WidgetSettingsModalDiagnostics? diagnostics = null) =>
        new(def, initialConfig, new WidgetSettingsVehicleSource(api, engine, options), localizer, diagnostics);

    /// <summary>
    /// Present the modal over <paramref name="xamlRoot"/> (web <c>&lt;Modal open&gt;</c>). Idempotent: a second
    /// call while the dialog is showing is a no-op. Resolves when the modal has closed.
    /// </summary>
    /// <param name="xamlRoot">The XAML root the dialog anchors to.</param>
    public async Task ShowAsync(XamlRoot xamlRoot)
    {
        ArgumentNullException.ThrowIfNull(xamlRoot);
        if (_shown || _disposed)
        {
            return;
        }

        _shown = true;
        var dialog = new TsModal
        {
            Title = _viewModel.Title,
            PrimaryButtonText = _viewModel.SaveLabel,
            CloseButtonText = _viewModel.CancelLabel,
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = xamlRoot,
            Content = new ScrollViewer
            {
                Content = _form,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollMode = ScrollMode.Disabled,
                MaxHeight = FormMaxHeight,
            },
        };
        AutomationProperties.SetAutomationId(dialog, "widget-settings-dialog");
        AutomationProperties.SetName(dialog, _viewModel.Title);
        dialog.PrimaryButtonClick += OnPrimaryButtonClick;
        dialog.CloseButtonClick += OnCloseButtonClick;
        dialog.Closed += OnDialogClosed;
        _dialog = dialog;

        try
        {
            await dialog.ShowAsync();
        }
        catch (COMException)
        {
            // Another ContentDialog is already open on this XamlRoot — the host owns ordering; surface nothing.
            _shown = false;
            _dialog = null;
        }
    }

    /// <summary>Detach from the view-model, dismiss the dialog and cancel in-flight work (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.SettingsSaved -= OnViewModelSettingsSaved;
        _viewModel.CloseRequested -= OnViewModelCloseRequested;
        DismissDialog();
        _viewModel.Dispose();
    }

    private void BuildForm()
    {
        if (_viewModel.ShowVehicleSection)
        {
            _form.Children.Add(BuildVehicleSection());
        }

        _form.Children.Add(BuildRefreshSection());

        if (_viewModel.ShowTimeRangeSection)
        {
            _form.Children.Add(BuildTimeRangeSection());
        }

        _form.Children.Add(BuildAppearanceSection());
    }

    private TsFormSection BuildVehicleSection()
    {
        _vehicleSpinner.Label = _viewModel.VehiclesLoadingLabel;

        _vehicleEmpty.Title = _viewModel.VehiclesEmptyTitle;
        _vehicleEmpty.Message = _viewModel.VehiclesEmptyMessage;

        _vehicleError.Title = _viewModel.VehiclesErrorTitle;
        _vehicleError.ActionText = _viewModel.RetryLabel;
        _vehicleError.ActionInvoked += OnVehicleRetryInvoked;

        AutomationProperties.SetName(_vehicleSelect, _viewModel.VehicleLabel);
        AutomationProperties.SetAutomationId(_vehicleSelect, "widget-settings-vehicle");
        _vehicleSelect.SelectionChanged += OnVehicleSelectionChanged;

        AutomationProperties.SetAutomationId(_vehicleFreshnessBar, "widget-settings-vehicle-freshness");
        LiveRegion.Configure(_vehicleFreshnessBar, assertive: false);

        var loaded = new StackPanel { Spacing = GroupSpacing };
        loaded.Children.Add(_vehicleFreshnessBar);
        loaded.Children.Add(_vehicleSelect);

        _vehicleStateHost.Children.Add(_vehicleSpinner);
        _vehicleStateHost.Children.Add(_vehicleError);
        _vehicleStateHost.Children.Add(_vehicleEmpty);
        _vehicleStateHost.Children.Add(loaded);

        RebuildVehicleOptions();
        ApplyVehiclesState();

        _vehicleSection.Title = _viewModel.VehicleLabel;
        _vehicleSection.SectionContent = _vehicleStateHost;
        AutomationProperties.SetName(_vehicleSection, _viewModel.VehicleLabel);
        return _vehicleSection;
    }

    private TsFormSection BuildRefreshSection()
    {
        AutomationProperties.SetName(_refreshSelect, _viewModel.RefreshIntervalLabel);
        AutomationProperties.SetAutomationId(_refreshSelect, "widget-settings-refresh");
        PopulateSelect(_refreshSelect, _viewModel.RefreshOptions, _viewModel.SelectedRefreshValue);
        _refreshSelect.SelectionChanged += OnRefreshSelectionChanged;

        _refreshSection.Title = _viewModel.RefreshIntervalLabel;
        _refreshSection.SectionContent = _refreshSelect;
        AutomationProperties.SetName(_refreshSection, _viewModel.RefreshIntervalLabel);
        return _refreshSection;
    }

    private TsFormSection BuildTimeRangeSection()
    {
        AutomationProperties.SetName(_timeRangeSelect, _viewModel.TimeRangeLabel);
        AutomationProperties.SetAutomationId(_timeRangeSelect, "widget-settings-timerange");
        PopulateSelect(_timeRangeSelect, _viewModel.TimeRangeOptions, _viewModel.SelectedTimeRangeValue);
        _timeRangeSelect.SelectionChanged += OnTimeRangeSelectionChanged;

        _timeRangeSection.Title = _viewModel.TimeRangeLabel;
        _timeRangeSection.SectionContent = _timeRangeSelect;
        AutomationProperties.SetName(_timeRangeSection, _viewModel.TimeRangeLabel);
        return _timeRangeSection;
    }

    private TsFormSection BuildAppearanceSection()
    {
        _showTitleToggle.Header = _viewModel.ShowTitleToggleLabel;
        _showTitleToggle.IsOn = _viewModel.ShowTitle;
        AutomationProperties.SetName(_showTitleToggle, _viewModel.ShowTitleToggleLabel);
        AutomationProperties.SetAutomationId(_showTitleToggle, "widget-settings-showtitle");
        _showTitleToggle.Toggled += OnShowTitleToggled;

        _appearanceSection.Title = _viewModel.AppearanceLabel;
        _appearanceSection.SectionContent = _showTitleToggle;
        AutomationProperties.SetName(_appearanceSection, _viewModel.AppearanceLabel);
        return _appearanceSection;
    }

    private static void PopulateSelect(
        TsSelect select, IReadOnlyList<WidgetSettingsOption> options, string selectedValue)
    {
        select.Items.Clear();
        ComboBoxItem? selected = null;
        foreach (WidgetSettingsOption option in options)
        {
            var item = new ComboBoxItem { Content = option.Label, Tag = option.Value };
            AutomationProperties.SetName(item, option.Label);
            select.Items.Add(item);
            if (string.Equals(option.Value, selectedValue, StringComparison.Ordinal))
            {
                selected = item;
            }
        }

        select.SelectedItem = selected;
    }

    private void RebuildVehicleOptions()
    {
        _suppressVehicleSelection = true;
        PopulateSelect(_vehicleSelect, _viewModel.VehicleOptions, _viewModel.SelectedVehicleValue);
        _suppressVehicleSelection = false;
    }

    private void ApplyVehiclesState()
    {
        WidgetSettingsVehiclesState state = _viewModel.VehiclesState;
        _vehicleSpinner.Visibility = Vis(state == WidgetSettingsVehiclesState.Loading);
        _vehicleError.Visibility = Vis(state == WidgetSettingsVehiclesState.Error);
        _vehicleEmpty.Visibility = Vis(state == WidgetSettingsVehiclesState.Empty);

        bool showSelect = state is WidgetSettingsVehiclesState.Loaded
            or WidgetSettingsVehiclesState.Stale
            or WidgetSettingsVehiclesState.Offline;
        _vehicleSelect.Visibility = Vis(showSelect);

        _vehicleError.Message = _viewModel.VehiclesErrorMessage ?? string.Empty;

        switch (state)
        {
            case WidgetSettingsVehiclesState.Stale:
                _vehicleFreshnessBar.Severity = InfoBarSeverity.Informational;
                _vehicleFreshnessBar.Message = _viewModel.VehiclesStaleLabel;
                _vehicleFreshnessBar.IsOpen = true;
                break;
            case WidgetSettingsVehiclesState.Offline:
                _vehicleFreshnessBar.Severity = InfoBarSeverity.Warning;
                _vehicleFreshnessBar.Message = _viewModel.VehiclesOfflineLabel;
                _vehicleFreshnessBar.IsOpen = true;
                break;
            default:
                _vehicleFreshnessBar.IsOpen = false;
                break;
        }
    }

    private static Visibility Vis(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
        _ = _viewModel.LoadVehiclesAsync();
        if (XamlRoot is { } xamlRoot)
        {
            _ = ShowAsync(xamlRoot);
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnVehicleRetryInvoked(object? sender, EventArgs e) => _ = _viewModel.RetryVehiclesAsync();

    private void OnVehicleSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressVehicleSelection)
        {
            return;
        }

        if (_vehicleSelect.SelectedItem is ComboBoxItem { Tag: string value })
        {
            _viewModel.SelectedVehicleValue = value;
        }
    }

    private void OnRefreshSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_refreshSelect.SelectedItem is ComboBoxItem { Tag: string value })
        {
            _viewModel.SelectedRefreshValue = value;
        }
    }

    private void OnTimeRangeSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_timeRangeSelect.SelectedItem is ComboBoxItem { Tag: string value })
        {
            _viewModel.SelectedTimeRangeValue = value;
        }
    }

    private void OnShowTitleToggled(object? sender, EventArgs e) =>
        _viewModel.ShowTitle = _showTitleToggle.IsOn;

    private void OnPrimaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args) =>
        _viewModel.Save();

    private void OnViewModelSettingsSaved(object? sender, WidgetConfig config) =>
        SettingsSaved?.Invoke(this, config);

    private void OnCloseButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args) =>
        _viewModel.RequestClose();

    private void OnDialogClosed(ContentDialog sender, ContentDialogClosedEventArgs args)
    {
        sender.PrimaryButtonClick -= OnPrimaryButtonClick;
        sender.CloseButtonClick -= OnCloseButtonClick;
        sender.Closed -= OnDialogClosed;
        _dialog = null;
        RaiseClosed();
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(() => ApplyViewModelState(e.PropertyName));

    private void ApplyViewModelState(string? propertyName)
    {
        switch (propertyName)
        {
            case nameof(WidgetSettingsModalViewModel.VehicleOptions):
                RebuildVehicleOptions();
                break;
            case nameof(WidgetSettingsModalViewModel.VehiclesState):
            case nameof(WidgetSettingsModalViewModel.VehiclesErrorMessage):
                ApplyVehiclesState();
                break;
            default:
                break;
        }
    }

    private void OnViewModelCloseRequested(object? sender, EventArgs e) => Marshal(DismissDialog);

    private void DismissDialog() => _dialog?.Hide();

    private void RaiseClosed()
    {
        if (_closeRaised)
        {
            return;
        }

        _closeRaised = true;
        Closed?.Invoke(this, EventArgs.Empty);
    }

    private void Marshal(DispatcherQueueHandler action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(action);
        }
        else
        {
            action();
        }
    }
}
