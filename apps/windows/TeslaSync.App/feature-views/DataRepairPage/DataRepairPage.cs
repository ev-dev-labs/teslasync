using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.Text;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The native WinUI 3 <c>DataRepairPage</c> — a parity port of the web page
/// <c>web/src/features/system/pages/DataRepairPage.tsx</c> (route <c>/data-repair</c>, nav name <c>Data Repair</c>). It
/// binds to a <see cref="DataRepairPageViewModel"/> and renders every web region with Fluent components and design
/// tokens: the page header (title + dynamic subtitle), the four stat tiles (Total Stale / Stale Charging / Stale Drives
/// / Status), the two-tab switcher (Charging Sessions / Drives with stale-count chips) and the content surface whose
/// body switches between the loading notice, the failure surface (+ Retry), the all-clear empty state and the
/// stale-record list — each row a Fluent <see cref="Expander"/> whose body is the inline edit form (the charging form
/// or the drive form, each a glass panel with the web field set + Save / Close / Discard / Cancel actions). The view is
/// a thin renderer: all branch selection, formatting and i18n happen in the view-model's <see cref="DataRepairDisplay"/>
/// projection. State changes are marshalled onto the UI thread; only the row list is rebuilt, and only when its
/// structure changes, so typing in an open form never loses focus.
/// </summary>
public sealed partial class DataRepairPage : UserControl, IDisposable
{
    private readonly DataRepairPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private string? _rowsSignature;

    // Header.
    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    // Transient mutation toast (web toast.success / toast.error).
    private readonly InfoBar _toast = new() { IsOpen = false, IsClosable = true };

    // Stat tiles (panels Total-Stale / Stale-Charging / Stale-Drives / Status).
    private readonly Grid _statsGrid = new() { ColumnSpacing = 12 };
    private readonly TsMetricCard _totalStale = new();
    private readonly TsMetricCard _staleCharging = new();
    private readonly TsMetricCard _staleDrives = new();
    private readonly TsMetricCard _statusCard = new();

    // Tab switcher.
    private readonly Border _tabBar = new();
    private readonly TsButton _chargingTab = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = DataRepairRegistration.BatteryChargingGlyph };
    private readonly TsBadge _chargingCount = new() { Status = StatusKind.Warning, Visibility = Visibility.Collapsed };
    private readonly TsButton _drivesTab = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = DataRepairRegistration.RouteGlyph };
    private readonly TsBadge _drivesCount = new() { Status = StatusKind.Warning, Visibility = Visibility.Collapsed };

    // State hosts.
    private readonly Grid _stateHost = new();
    private readonly StackPanel _loadingHost = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 16,
        Padding = new Thickness(24),
        VerticalAlignment = VerticalAlignment.Center,
        Visibility = Visibility.Collapsed,
    };

    private readonly TsSpinner _spinner = new();
    private readonly Text _loadingText = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsErrorDisplay _errorState = new() { Visibility = Visibility.Collapsed };

    private readonly StackPanel _contentHost = new() { Spacing = 16, Visibility = Visibility.Collapsed };
    private readonly Grid _contentArea = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = DataRepairRegistration.CheckCircleGlyph, Visibility = Visibility.Collapsed };
    private readonly StackPanel _rowsHost = new() { Spacing = 12, Visibility = Visibility.Collapsed };

    private RepairFormLabels _formLabels = EmptyFormLabels();

    /// <summary>Creates the page over the default no-backend repair feed and the shell resource localizer.</summary>
    public DataRepairPage()
        : this(EmptyDataRepairFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The data-repair data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public DataRepairPage(IDataRepairFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new DataRepairPageViewModel(feed, localizer);

        Content = BuildLayout();

        _chargingTab.Click += (_, _) => _viewModel.SelectTab(RepairTab.Charging);
        _drivesTab.Click += (_, _) => _viewModel.SelectTab(RepairTab.Drives);
        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        _viewModel.ToastRequested += OnToastRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        Render(_viewModel.Display);
    }

    /// <summary>The navigation route name the shell page factory registers this surface under (<c>DataRepair</c>).</summary>
    public static string RouteName => DataRepairRegistration.RouteName;

    /// <summary>The diagnostics surface slug (<c>DataRepairPage</c>).</summary>
    public static string Slug => DataRepairRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_toast);
        stack.Children.Add(BuildStateHost());

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private StackPanel BuildHeader()
    {
        var titles = new StackPanel { Spacing = 4 };
        titles.Children.Add(_title);
        titles.Children.Add(_subtitle);
        return titles;
    }

    private Grid BuildStateHost()
    {
        _loadingHost.Children.Add(_spinner);
        _loadingHost.Children.Add(_loadingText);

        BuildContentHost();

        _stateHost.Children.Add(_loadingHost);
        _stateHost.Children.Add(_errorState);
        _stateHost.Children.Add(_contentHost);
        return _stateHost;
    }

    private void BuildContentHost()
    {
        BuildStats();
        BuildTabs();

        _contentArea.Children.Add(_emptyState);
        _contentArea.Children.Add(_rowsHost);

        _contentHost.Children.Add(_statsGrid);
        _contentHost.Children.Add(_tabBar);
        _contentHost.Children.Add(_contentArea);
    }

    private void BuildStats()
    {
        TsMetricCard[] cards = [_totalStale, _staleCharging, _staleDrives, _statusCard];
        for (int i = 0; i < cards.Length; i++)
        {
            _statsGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            Grid.SetColumn(cards[i], i);
            _statsGrid.Children.Add(cards[i]);
        }
    }

    private void BuildTabs()
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };

        var chargingCell = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        chargingCell.Children.Add(_chargingTab);
        chargingCell.Children.Add(_chargingCount);

        var drivesCell = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        drivesCell.Children.Add(_drivesTab);
        drivesCell.Children.Add(_drivesCount);

        row.Children.Add(chargingCell);
        row.Children.Add(drivesCell);

        _tabBar.Child = row;
        _tabBar.Padding = new Thickness(4);
        _tabBar.CornerRadius = new CornerRadius(12);
        _tabBar.HorizontalAlignment = HorizontalAlignment.Left;
        _tabBar.BorderThickness = new Thickness(1);
        _tabBar.BorderBrush = TokenBrush("TsColorBorderBrush");
        _tabBar.Background = TokenBrush("TsColorSurfaceBrush");
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (_dispatcher.HasThreadAccess)
        {
            Render(_viewModel.Display);
        }
        else
        {
            _dispatcher.TryEnqueue(() => Render(_viewModel.Display));
        }
    }

    private void OnToastRequested(object? sender, DataRepairToast toast)
    {
        void Show()
        {
            _toast.Title = toast.Message;
            _toast.Message = string.Empty;
            _toast.Severity = toast.IsError ? InfoBarSeverity.Error : InfoBarSeverity.Success;
            _toast.IsOpen = true;
        }

        if (_dispatcher.HasThreadAccess)
        {
            Show();
        }
        else
        {
            _dispatcher.TryEnqueue(Show);
        }
    }

    private void Render(DataRepairDisplay display)
    {
        _formLabels = display.FormLabels;

        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        _loadingHost.Visibility = Show(display.ShowLoading);
        _errorState.Visibility = Show(display.ShowError);
        _contentHost.Visibility = Show(display.ShowEmpty || display.ShowSuccess);

        _loadingText.Value = display.Title;

        _errorState.Title = display.ErrorText;
        _errorState.ActionText = display.RetryLabel;
        AutomationProperties.SetName(_errorState, display.ErrorText);

        ApplyMetric(_totalStale, display.TotalStale);
        ApplyMetric(_staleCharging, display.StaleCharging);
        ApplyMetric(_staleDrives, display.StaleDrives);
        ApplyMetric(_statusCard, display.StatusCard);

        _chargingTab.Text = display.ChargingTabLabel;
        _chargingTab.Variant = display.ChargingSelected ? ButtonVariant.Secondary : ButtonVariant.Subtle;
        ApplyCount(_chargingCount, display.ChargingCount);

        _drivesTab.Text = display.DrivesTabLabel;
        _drivesTab.Variant = display.DrivesSelected ? ButtonVariant.Secondary : ButtonVariant.Subtle;
        ApplyCount(_drivesCount, display.DrivesCount);

        _emptyState.Title = display.EmptyTitle;
        _emptyState.Message = display.EmptyMessage;
        _emptyState.Visibility = Show(display.ShowEmpty);

        _rowsHost.Visibility = Show(display.ShowSuccess);
        RenderRows(display);
    }

    private void RenderRows(DataRepairDisplay display)
    {
        string signature = ComputeRowsSignature(display);
        if (signature == _rowsSignature && _rowsHost.Children.Count == display.Rows.Count)
        {
            return;
        }

        _rowsSignature = signature;
        _rowsHost.Children.Clear();
        foreach (var row in display.Rows)
        {
            _rowsHost.Children.Add(BuildRow(row, display.IsChargingTab, display.OpenLabel));
        }
    }

    // Mirrors the web row structure: a clickable glass header (GlassPanel7/8) and, when expanded, the inline edit
    // form (GlassPanel1/2) rendered as a sibling beneath it (web `{expandedId === id && <EditForm/>}`).
    private StackPanel BuildRow(RepairRowDisplay row, bool isCharging, string openLabel)
    {
        var container = new StackPanel { Spacing = 12, HorizontalAlignment = HorizontalAlignment.Stretch };

        var header = new TsGlassPanel
        {
            Glow = GlassGlow.None,
            Content = BuildRowHeader(row, openLabel),
            IsTabStop = true,
        };
        AutomationProperties.SetName(header, string.Concat(row.IdLabel, " ", row.VehicleLabel));

        long id = row.Id;
        header.Tapped += (_, _) => OnRowToggle(id);
        header.KeyDown += (_, e) =>
        {
            if (e.Key is Windows.System.VirtualKey.Enter or Windows.System.VirtualKey.Space)
            {
                OnRowToggle(id);
                e.Handled = true;
            }
        };

        container.Children.Add(header);
        if (row.Expanded)
        {
            container.Children.Add(isCharging ? BuildChargingForm(row) : BuildDriveForm(row));
        }

        return container;
    }

    // Deferred so the toggle (which rebuilds the row list) never runs inside the header's own pointer/key event.
    private void OnRowToggle(long id) => _dispatcher.TryEnqueue(() => _viewModel.ToggleExpanded(id));

    private static StackPanel BuildRowHeader(RepairRowDisplay row, string openLabel)
    {
        var cells = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 16, VerticalAlignment = VerticalAlignment.Center };

        cells.Children.Add(new Code { Value = row.IdLabel, VerticalAlignment = VerticalAlignment.Center });
        cells.Children.Add(new Caption { Value = row.StartLabel, VerticalAlignment = VerticalAlignment.Center });
        cells.Children.Add(new Text { Value = row.BatteryLabel, VerticalAlignment = VerticalAlignment.Center });
        cells.Children.Add(new Caption { Value = row.VehicleLabel, VerticalAlignment = VerticalAlignment.Center });

        var hours = new Text { Value = row.HoursOpenLabel, VerticalAlignment = VerticalAlignment.Center };
        if (TokenBrush("TsColorWarningBrush") is { } warning)
        {
            hours.Foreground = warning;
        }

        cells.Children.Add(hours);
        cells.Children.Add(BuildOpenBadge(openLabel));
        return cells;
    }

    private static TsBadge BuildOpenBadge(string openLabel)
    {
        var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        content.Children.Add(new FontIcon { Glyph = DataRepairRegistration.AlertTriangleGlyph, FontSize = 12 });
        content.Children.Add(new TextBlock { Text = openLabel, VerticalAlignment = VerticalAlignment.Center });
        return new TsBadge { Status = StatusKind.Warning, Content = content };
    }

    private TsGlassPanel BuildChargingForm(RepairRowDisplay row)
    {
        var form = row.ChargingForm ?? new ChargingFormDisplay(string.Empty, string.Empty, string.Empty, string.Empty, string.Empty, string.Empty, RepairBusy.None);
        long id = row.Id;

        var inputs = new List<FrameworkElement>
        {
            BuildInput(_formLabels.EndDateIso, form.EndTs, _formLabels.EndDateHint, _viewModel.SetChargingEndTs),
            BuildInput(_formLabels.EnergyAddedKwh, form.TotalEnergyAddedWh, null, _viewModel.SetChargingEnergy),
            BuildInput(_formLabels.EndBatteryPct, form.EndBatteryPct, null, _viewModel.SetChargingEndBattery),
            BuildInput(_formLabels.ChargerPowerKw, form.PeakPowerW, null, _viewModel.SetChargingPeakPower),
            BuildInput(_formLabels.DurationMin, form.DurationMin, null, _viewModel.SetChargingDuration),
            BuildInput(_formLabels.CostDollar, form.Cost, null, _viewModel.SetChargingCost),
        };

        var actions = BuildFormActions(
            saveBusy: form.Busy == RepairBusy.Update,
            closeBusy: form.Busy == RepairBusy.Close,
            discardBusy: form.Busy == RepairBusy.Discard,
            closeLabel: _formLabels.CloseSession,
            onSave: () => _viewModel.UpdateChargingAsync(id),
            onClose: () => _viewModel.CloseChargingAsync(id),
            onDiscard: () => _viewModel.DiscardChargingAsync(id));

        return BuildFormPanel(inputs, actions);
    }

    private TsGlassPanel BuildDriveForm(RepairRowDisplay row)
    {
        var form = row.DriveForm ?? new DriveFormDisplay(string.Empty, string.Empty, string.Empty, string.Empty, string.Empty, RepairBusy.None);
        long id = row.Id;

        var inputs = new List<FrameworkElement>
        {
            BuildInput(_formLabels.EndDateIso, form.EndTs, _formLabels.EndDateHint, _viewModel.SetDriveEndTs),
            BuildInput(_formLabels.DistanceM, form.DistanceM, null, _viewModel.SetDriveDistance),
            BuildInput(_formLabels.DurationS, form.DurationS, null, _viewModel.SetDriveDuration),
            BuildInput(_formLabels.EndBatteryPct, form.EndBatteryPct, null, _viewModel.SetDriveEndBattery),
            BuildInput(_formLabels.MaxSpeedMps, form.MaxSpeedMps, null, _viewModel.SetDriveMaxSpeed),
        };

        var actions = BuildFormActions(
            saveBusy: form.Busy == RepairBusy.Update,
            closeBusy: form.Busy == RepairBusy.Close,
            discardBusy: form.Busy == RepairBusy.Discard,
            closeLabel: _formLabels.CloseDrive,
            onSave: () => _viewModel.UpdateDriveAsync(id),
            onClose: () => _viewModel.CloseDriveAsync(id),
            onDiscard: () => _viewModel.DiscardDriveAsync(id));

        return BuildFormPanel(inputs, actions);
    }

    private static TsInput BuildInput(string label, string value, string? hint, Action<string> onChanged)
    {
        ArgumentNullException.ThrowIfNull(onChanged);

        var input = new TsInput
        {
            Header = label,
            Text = value ?? string.Empty,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        if (!string.IsNullOrEmpty(hint))
        {
            input.Hint = hint;
        }

        AutomationProperties.SetName(input, label);
        input.TextChanged += (s, _) => onChanged(((TextBox)s).Text);
        return input;
    }

    private StackPanel BuildFormActions(
        bool saveBusy,
        bool closeBusy,
        bool discardBusy,
        string closeLabel,
        Func<System.Threading.Tasks.Task> onSave,
        Func<System.Threading.Tasks.Task> onClose,
        Func<System.Threading.Tasks.Task> onDiscard)
    {
        var save = new TsButton { Variant = ButtonVariant.Secondary, Size = ControlSize.Small, IconGlyph = DataRepairRegistration.SaveGlyph, Text = _formLabels.Save, IsLoading = saveBusy };
        save.Click += (_, _) => InvokeAsync(onSave);

        var close = new TsButton { Variant = ButtonVariant.Secondary, Size = ControlSize.Small, IconGlyph = DataRepairRegistration.ClockGlyph, Text = closeLabel, IsLoading = closeBusy };
        close.Click += (_, _) => InvokeAsync(onClose);

        var discard = new TsButton { Variant = ButtonVariant.Destructive, Size = ControlSize.Small, IconGlyph = DataRepairRegistration.TrashGlyph, Text = _formLabels.Discard, IsLoading = discardBusy };
        discard.Click += (_, _) => InvokeAsync(onDiscard);

        var cancel = new TsButton { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = DataRepairRegistration.CancelGlyph, Text = _formLabels.Cancel, HorizontalAlignment = HorizontalAlignment.Right };
        cancel.Click += (_, _) => _viewModel.CollapseForm();

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Padding = new Thickness(0, 8, 0, 0) };
        row.Children.Add(save);
        row.Children.Add(close);
        row.Children.Add(discard);
        row.Children.Add(cancel);
        return row;
    }

    private static TsGlassPanel BuildFormPanel(List<FrameworkElement> inputs, FrameworkElement actions)
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        for (int c = 0; c < 3; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (inputs.Count + 2) / 3;
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < inputs.Count; i++)
        {
            var element = inputs[i];
            Grid.SetColumn(element, i % 3);
            Grid.SetRow(element, i / 3);
            grid.Children.Add(element);
        }

        var column = new StackPanel { Spacing = 16, Padding = new Thickness(16) };
        column.Children.Add(grid);
        column.Children.Add(actions);

        return new TsGlassPanel { Glow = GlassGlow.None, Content = column };
    }

    private static void ApplyMetric(TsMetricCard card, MetricDisplay metric)
    {
        card.Label = metric.Label;
        card.Value = metric.Value;
        card.AccentBrushKey = metric.AccentBrushKey;
    }

    private static void ApplyCount(TsBadge badge, int count)
    {
        badge.Content = count.ToString(CultureInfo.InvariantCulture);
        badge.Visibility = count > 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private static string ComputeRowsSignature(DataRepairDisplay display)
    {
        var sb = new StringBuilder();
        sb.Append((int)display.State).Append('|')
          .Append(display.IsChargingTab ? 'C' : 'D').Append('|');
        foreach (var row in display.Rows)
        {
            sb.Append(row.Id).Append(':')
              .Append(row.Expanded ? '1' : '0').Append(':');

            RepairBusy busy = row.ChargingForm?.Busy ?? row.DriveForm?.Busy ?? RepairBusy.None;
            sb.Append((int)busy).Append(':')
              .Append(row.StartLabel).Append(':')
              .Append(row.BatteryLabel).Append(':')
              .Append(row.VehicleLabel).Append(';');
        }

        return sb.ToString();
    }

    private static RepairFormLabels EmptyFormLabels() => new(
        EndDateIso: string.Empty,
        EndDateHint: string.Empty,
        EnergyAddedKwh: string.Empty,
        EndBatteryPct: string.Empty,
        ChargerPowerKw: string.Empty,
        DurationMin: string.Empty,
        CostDollar: string.Empty,
        DistanceM: string.Empty,
        DurationS: string.Empty,
        MaxSpeedMps: string.Empty,
        Save: string.Empty,
        CloseSession: string.Empty,
        CloseDrive: string.Empty,
        Discard: string.Empty,
        Cancel: string.Empty);

    /// <summary>Unsubscribe from and dispose the view-model (idempotent; CA1001).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _errorState.ActionInvoked -= OnRetryInvoked;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.ToastRequested -= OnToastRequested;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private static Brush? TokenBrush(string resourceKey) =>
        Application.Current.Resources.TryGetValue(resourceKey, out var value) && value is Brush brush ? brush : null;

    private static async void InvokeAsync(Func<System.Threading.Tasks.Task> action) =>
        await action().ConfigureAwait(true);

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    protected override AutomationPeer OnCreateAutomationPeer() => new DataRepairPageAutomationPeer(this);

    private sealed class DataRepairPageAutomationPeer(DataRepairPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
