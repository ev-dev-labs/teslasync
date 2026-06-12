using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// One energy-site card inside <see cref="EnergyProductsPage"/> — the native port of the web
/// <c>EnergySiteCard</c> + <c>SiteInfoSection</c>. It binds to an <see cref="EnergySiteCardViewModel"/> and
/// renders the card header (resource glyph, name, id sub-line, battery-type chip), the Charge / Capacity /
/// Type stat panels, the capability + storm-mode chips, and the embedded site-configuration section
/// (operation mode + the backup-reserve radial gauge, the Powerwalls / Rated Power / Rated Energy stats,
/// firmware, component chips and the Time-of-Use rate-plan panel) with its own loading / empty / error / success
/// branches. It triggers the configuration load on first render and marshals state changes onto the UI thread.
/// </summary>
internal sealed partial class EnergySiteCardView : UserControl, IDisposable
{
    private readonly EnergySiteCardViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _started;

    // Card header.
    private readonly FontIcon _resourceIcon = new() { FontSize = 20 };
    private readonly PanelTitle _name = new();
    private readonly Caption _subLabel = new();
    private readonly TsBadge _batteryTypeBadge = new() { Status = StatusKind.Info, Visibility = Visibility.Collapsed };

    // Card stats (Charge / Capacity / Type).
    private readonly TsStatCard _charge = new() { Glyph = EnergyProductsProjection.GaugeGlyph };
    private readonly TsStatCard _capacity = new() { Glyph = EnergyProductsProjection.BatteryGlyph };
    private readonly TsStatCard _type = new() { Glyph = EnergyProductsProjection.ActivityGlyph };

    private readonly StackPanel _capabilities = new() { Orientation = Orientation.Horizontal, Spacing = 8 };

    // Site-info section header.
    private readonly Subhead _siteInfoTitle = new();
    private readonly TsButton _siteInfoRefresh = new() { Variant = ButtonVariant.Subtle, IconGlyph = "\uE72C", Size = ControlSize.Small };
    private readonly TsDataFreshness _siteInfoFreshness = new() { VerticalAlignment = VerticalAlignment.Center };

    // Operation mode + backup reserve (GlassPanel4) — the backup gauge is the chart.
    private readonly Caption _opModeLabel = new();
    private readonly Microsoft.UI.Xaml.Controls.TextBlock _opModeValue = new() { TextWrapping = TextWrapping.Wrap };
    private readonly Caption _backupLabel = new();
    private readonly TsRadialGauge _backupGauge = new() { Max = 100, Diameter = 48, Decimals = 0, Unit = "%", Role = ChartRole.Battery };
    private readonly Microsoft.UI.Xaml.Controls.TextBlock _backupValue = new();

    // Rated stats (Powerwalls / Rated Power / Rated Energy).
    private readonly TsStatCard _powerwalls = new() { Glyph = EnergyProductsProjection.BatteryGlyph };
    private readonly TsStatCard _ratedPower = new() { Glyph = EnergyProductsProjection.ZapGlyph };
    private readonly TsStatCard _ratedEnergy = new() { Glyph = EnergyProductsProjection.GaugeGlyph };

    private readonly Caption _firmware = new();
    private readonly StackPanel _components = new() { Orientation = Orientation.Horizontal, Spacing = 6 };

    // Time-of-Use rate-plan panel (GlassPanel13).
    private readonly Border _ratePlanPanel;
    private readonly Caption _ratePlanTitle = new();
    private readonly Microsoft.UI.Xaml.Controls.TextBlock _ratePlanName = new();
    private readonly TsButton _ratePlanUpdate = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };

    private readonly Caption _siteInfoFetched = new();

    // Site-info state branches.
    private readonly StackPanel _siteInfoContent = new() { Spacing = 12 };
    private readonly TsStatSkeleton _siteInfoLoading = new() { Visibility = Visibility.Collapsed };
    private readonly TsEmptyState _siteInfoEmpty = new() { IconGlyph = "\uE946", Visibility = Visibility.Collapsed };
    private readonly TsAlertBanner _siteInfoError = new() { Variant = CalloutVariant.Danger, IsOpen = false, Dismissible = false };

    private readonly Caption _lastFetched = new();

    /// <summary>Creates the card view over its holder and localizer.</summary>
    public EnergySiteCardView(EnergySiteCardViewModel viewModel, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(viewModel);
        ArgumentNullException.ThrowIfNull(localizer);
        _viewModel = viewModel;

        _ratePlanPanel = BuildRatePlanPanel();
        Content = BuildLayout();

        _siteInfoRefresh.Click += OnSiteInfoRefreshClick;
        _ratePlanUpdate.Click += OnRatePlanUpdateClick;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;

        Render();
    }

    /// <summary>Raised when this card's "Update rate plan" action is invoked, carrying the energy-site id.</summary>
    public event EventHandler<long>? RatePlanUpdateRequested;

    private TsGlassPanel BuildLayout()
    {
        var iconBox = new Border
        {
            Width = 40,
            Height = 40,
            CornerRadius = new CornerRadius(10),
            Background = EnergyProductsPage.Brush("TsColorSurfaceBrush"),
            Child = _resourceIcon,
        };
        _resourceIcon.HorizontalAlignment = HorizontalAlignment.Center;
        _resourceIcon.VerticalAlignment = VerticalAlignment.Center;
        _resourceIcon.Foreground = EnergyProductsPage.Brush("TsChartSpeedBrush");

        var nameStack = new StackPanel { Spacing = 2 };
        nameStack.Children.Add(_name);
        nameStack.Children.Add(_subLabel);

        var headerLeft = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        headerLeft.Children.Add(iconBox);
        headerLeft.Children.Add(nameStack);

        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(headerLeft, 0);
        _batteryTypeBadge.VerticalAlignment = VerticalAlignment.Top;
        Grid.SetColumn(_batteryTypeBadge, 1);
        header.Children.Add(headerLeft);
        header.Children.Add(_batteryTypeBadge);

        var stats = EnergyProductsPage.UniformColumns(3, 12, _charge, _capacity, _type);

        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(header);
        column.Children.Add(stats);
        column.Children.Add(_capabilities);
        column.Children.Add(BuildSiteInfoSection());
        column.Children.Add(_lastFetched);

        return new TsGlassPanel { Padding = new Thickness(24), Content = column };
    }

    private StackPanel BuildSiteInfoSection()
    {
        var titleRow = new Grid { Margin = new Thickness(0, 4, 0, 0) };
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleLeft = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        titleLeft.Children.Add(new FontIcon { Glyph = EnergyProductsProjection.SettingsGlyph, FontSize = 14, VerticalAlignment = VerticalAlignment.Center });
        titleLeft.Children.Add(_siteInfoTitle);
        Grid.SetColumn(titleLeft, 0);

        _siteInfoFreshness.Margin = new Thickness(0, 0, 8, 0);
        Grid.SetColumn(_siteInfoFreshness, 1);
        Grid.SetColumn(_siteInfoRefresh, 2);
        titleRow.Children.Add(titleLeft);
        titleRow.Children.Add(_siteInfoFreshness);
        titleRow.Children.Add(_siteInfoRefresh);

        BuildSiteInfoContent();

        var section = new StackPanel { Spacing = 12 };
        section.Children.Add(titleRow);
        section.Children.Add(_siteInfoLoading);
        section.Children.Add(_siteInfoError);
        section.Children.Add(_siteInfoContent);
        section.Children.Add(_siteInfoEmpty);
        return section;
    }

    private void BuildSiteInfoContent()
    {
        // Operation mode + backup reserve grid (GlassPanel4).
        var opModeColumn = new StackPanel { Spacing = 4 };
        opModeColumn.Children.Add(_opModeLabel);
        _opModeValue.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold;
        opModeColumn.Children.Add(_opModeValue);
        var opModeCell = new Border
        {
            CornerRadius = new CornerRadius(10),
            Padding = new Thickness(12),
            BorderThickness = new Thickness(1),
            BorderBrush = EnergyProductsPage.Brush("TsColorBorderBrush"),
            Child = opModeColumn,
        };

        var backupColumn = new StackPanel { Spacing = 4 };
        backupColumn.Children.Add(_backupLabel);
        var backupRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        backupRow.Children.Add(_backupGauge);
        _backupValue.VerticalAlignment = VerticalAlignment.Center;
        _backupValue.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold;
        backupRow.Children.Add(_backupValue);
        backupColumn.Children.Add(backupRow);
        var backupCell = new Border
        {
            CornerRadius = new CornerRadius(10),
            Padding = new Thickness(12),
            BorderThickness = new Thickness(1),
            BorderBrush = EnergyProductsPage.Brush("TsColorBorderBrush"),
            Child = backupColumn,
        };

        _siteInfoContent.Children.Add(EnergyProductsPage.UniformColumns(2, 12, opModeCell, backupCell));
        _siteInfoContent.Children.Add(EnergyProductsPage.UniformColumns(3, 12, _powerwalls, _ratedPower, _ratedEnergy));
        _siteInfoContent.Children.Add(_firmware);
        _siteInfoContent.Children.Add(_components);
        _siteInfoContent.Children.Add(_ratePlanPanel);
        _siteInfoContent.Children.Add(_siteInfoFetched);
        _siteInfoContent.Visibility = Visibility.Collapsed;
    }

    private Border BuildRatePlanPanel()
    {
        var left = new StackPanel { Spacing = 2 };
        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        titleRow.Children.Add(new FontIcon { Glyph = "\uE823", FontSize = 12, VerticalAlignment = VerticalAlignment.Center });
        titleRow.Children.Add(_ratePlanTitle);
        left.Children.Add(titleRow);
        _ratePlanName.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold;
        left.Children.Add(_ratePlanName);
        Grid.SetColumn(left, 0);

        _ratePlanUpdate.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_ratePlanUpdate, 1);

        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.Children.Add(left);
        grid.Children.Add(_ratePlanUpdate);

        return new Border
        {
            CornerRadius = new CornerRadius(10),
            Padding = new Thickness(12),
            BorderThickness = new Thickness(1),
            BorderBrush = EnergyProductsPage.Brush("TsColorBorderBrush"),
            Child = grid,
            Visibility = Visibility.Collapsed,
        };
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _ = _viewModel.LoadSiteInfoAsync();
    }

    private void OnSiteInfoRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RefreshSiteInfoAsync();

    private void OnRatePlanUpdateClick(object sender, RoutedEventArgs e) =>
        RatePlanUpdateRequested?.Invoke(this, _viewModel.EnergySiteId);

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher is null || _dispatcher.HasThreadAccess)
        {
            Render();
        }
        else
        {
            _dispatcher.TryEnqueue(Render);
        }
    }

    private void Render()
    {
        if (_disposed)
        {
            return;
        }

        RenderCard(_viewModel.CardDisplay);
        RenderSiteInfo(_viewModel.SiteInfoDisplay, _viewModel.SiteInfoState);
    }

    private void RenderCard(EnergySiteCardDisplay card)
    {
        _resourceIcon.Glyph = card.ResourceGlyph;
        _name.Value = card.SiteName;
        _subLabel.Value = card.SubLabel;

        if (string.IsNullOrEmpty(card.BatteryType))
        {
            _batteryTypeBadge.Visibility = Visibility.Collapsed;
        }
        else
        {
            _batteryTypeBadge.Content = new TextBlock { Text = card.BatteryType };
            _batteryTypeBadge.Visibility = Visibility.Visible;
            AutomationProperties.SetName(_batteryTypeBadge, card.BatteryType);
        }

        ApplyStat(_charge, card.Charge);
        ApplyStat(_capacity, card.Capacity);
        ApplyStat(_type, card.Type);

        _capabilities.Children.Clear();
        foreach (var cap in card.Capabilities)
        {
            _capabilities.Children.Add(EnergyProductsPage.Chip(
                cap.Active ? StatusKind.Success : StatusKind.Neutral, cap.Glyph, cap.Label));
        }

        if (card.StormActive)
        {
            _capabilities.Children.Add(EnergyProductsPage.Chip(
                StatusKind.Warning, EnergyProductsProjection.StormGlyph, card.StormActiveLabel));
        }

        _lastFetched.Value = card.LastFetchedLabel;
        AutomationProperties.SetName(this, $"{card.SiteName}. {card.SubLabel}");
    }

    private void RenderSiteInfo(EnergySiteInfoDisplay info, EnergyProductsState state)
    {
        _siteInfoTitle.Value = info.Title;
        AutomationProperties.SetName(_siteInfoRefresh, info.RefreshLabel);

        _opModeLabel.Value = info.OperationModeLabel;
        _opModeValue.Text = info.OperationModeValue;

        _backupLabel.Value = info.BackupReserveLabel;
        _backupGauge.Value = info.BackupReservePercent;
        _backupValue.Text = info.BackupReserveValue;
        AutomationProperties.SetName(_backupGauge, $"{info.BackupReserveLabel}: {info.BackupReserveValue}");

        ApplyStat(_powerwalls, info.Powerwalls);
        ApplyStat(_ratedPower, info.RatedPower);
        ApplyStat(_ratedEnergy, info.RatedEnergy);

        if (string.IsNullOrEmpty(info.FirmwareValue) && string.IsNullOrEmpty(info.TimeZone))
        {
            _firmware.Visibility = Visibility.Collapsed;
        }
        else
        {
            var parts = new List<string>();
            if (!string.IsNullOrEmpty(info.FirmwareValue))
            {
                parts.Add($"{info.FirmwareLabel}: {info.FirmwareValue}");
            }

            if (!string.IsNullOrEmpty(info.TimeZone))
            {
                parts.Add(info.TimeZone!);
            }

            _firmware.Value = string.Join(" \u00B7 ", parts);
            _firmware.Visibility = Visibility.Visible;
        }

        _components.Children.Clear();
        foreach (var flag in info.Components)
        {
            _components.Children.Add(EnergyProductsPage.Chip(
                flag.Active ? StatusKind.Success : StatusKind.Neutral, string.Empty, flag.Key));
        }

        _ratePlanTitle.Value = info.RatePlan.SectionTitle;
        _ratePlanName.Text = info.RatePlan.PlanName;
        _ratePlanUpdate.Text = info.RatePlan.UpdateLabel;
        AutomationProperties.SetName(_ratePlanUpdate, info.RatePlan.EditPlanLabel);
        _ratePlanPanel.Visibility = info.ShowRatePlan ? Visibility.Visible : Visibility.Collapsed;

        _siteInfoFetched.Value = info.LastFetchedLabel;
        _siteInfoEmpty.Message = info.EmptyMessage;
        _siteInfoError.Message = _viewModel.ErrorMessage ?? string.Empty;

        _siteInfoRefresh.IsLoading = _viewModel.IsFetching;
        _siteInfoFreshness.UpdatedAt = _viewModel.UpdatedAt;
        _siteInfoFreshness.IsFetching = _viewModel.IsFetching;
        _siteInfoFreshness.IsError = _viewModel.IsError || state == EnergyProductsState.Offline;

        bool content = state is EnergyProductsState.Loaded or EnergyProductsState.Stale or EnergyProductsState.Offline;
        _siteInfoLoading.Visibility = state == EnergyProductsState.Loading ? Visibility.Visible : Visibility.Collapsed;
        _siteInfoContent.Visibility = content ? Visibility.Visible : Visibility.Collapsed;
        _siteInfoEmpty.Visibility = state == EnergyProductsState.Empty ? Visibility.Visible : Visibility.Collapsed;
        _siteInfoError.IsOpen = state == EnergyProductsState.Error;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _siteInfoRefresh.Click -= OnSiteInfoRefreshClick;
        _ratePlanUpdate.Click -= OnRatePlanUpdateClick;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        _viewModel.Dispose();
    }

    private static void ApplyStat(TsStatCard tile, EnergyStat stat)
    {
        tile.Label = stat.Label;
        tile.Value = stat.Value;
        tile.Glyph = stat.Glyph;
        AutomationProperties.SetName(tile, stat.AutomationName);
    }
}
