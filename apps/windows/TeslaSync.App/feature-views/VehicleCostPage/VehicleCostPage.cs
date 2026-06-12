using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 <c>VehicleCostPage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/VehicleCostPage.tsx</c> (route <c>/admin/vehicle-cost</c>, nav name
/// <c>VehicleCost</c>). It binds to a <see cref="VehicleCostPageViewModel"/> and renders every web region with Fluent
/// components and design tokens: the page header (title + subtitle), the HTTP-503 subsystem-unavailable banner (web
/// <c>subsystemMissing</c>), the loading shimmer, the generic failure surface (InfoBar-equivalent + Retry), the four
/// fleet-total stat cards (Total rows / Total bytes / Rate / DLQ failures) and the per-vehicle breakdown
/// <see cref="TsGlassPanel"/> (the window selector plus either the shared <see cref="TsDataTable"/> or the
/// "no vehicle cost data" <see cref="TsEmptyState"/>). The view is a thin renderer: all branch selection, formatting
/// and i18n happen in the view-model's <see cref="VehicleCostDisplay"/> projection. State changes are marshalled onto
/// the UI thread.
/// </summary>
public sealed partial class VehicleCostPage : UserControl, IDisposable
{
    private readonly VehicleCostPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    private readonly TsAlertBanner _subsystemBanner = new() { Variant = CalloutVariant.Warning, IsOpen = false, Dismissible = false };

    private readonly StackPanel _loadingSkeleton = new() { Spacing = 24 };
    private readonly TsQueryError _errorState = new();

    private readonly StackPanel _contentRoot = new() { Spacing = 24 };
    private readonly TsStatCard _totalRowsCard = new();
    private readonly TsStatCard _totalBytesCard = new();
    private readonly TsStatCard _totalRateCard = new();
    private readonly TsStatCard _totalFailuresCard = new();

    private readonly TsGlassPanel _breakdownPanel = new();
    private readonly PanelTitle _breakdownTitle = new();
    private readonly Caption _windowCaption = new();
    private readonly TsSelect _windowSelect = new();
    private readonly ContentControl _tableHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsDataTable _table = new() { Selectable = false, PageSize = VehicleCostProjection.RowLimit };
    private readonly TsEmptyState _emptyState = new() { IconGlyph = VehicleCostRegistration.EmptyGlyph };

    private bool _windowOptionsPopulated;
    private bool _suppressWindowChange;

    /// <summary>Creates the page over the default local-state feed and the shell resource localizer.</summary>
    public VehicleCostPage()
        : this(EmptyVehicleCostFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The vehicle-cost data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public VehicleCostPage(IVehicleCostFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new VehicleCostPageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        BuildContent();

        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _windowSelect.SelectionChanged += OnWindowSelectionChanged;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>VehicleCostPage</c>).</summary>
    public static string Slug => VehicleCostRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_subsystemBanner);
        stack.Children.Add(_loadingSkeleton);
        stack.Children.Add(_errorState);
        stack.Children.Add(_contentRoot);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private StackPanel BuildHeader()
    {
        var header = new StackPanel { Spacing = 4 };
        header.Children.Add(_title);
        header.Children.Add(_subtitle);
        return header;
    }

    private void BuildLoadingSkeleton()
    {
        _loadingSkeleton.Children.Add(new TsStatGridSkeleton(4));
        _loadingSkeleton.Children.Add(new TsTableSkeleton());
    }

    private void BuildContent()
    {
        _contentRoot.Children.Add(BuildEqualColumns(16, _totalRowsCard, _totalBytesCard, _totalRateCard, _totalFailuresCard));

        var body = new StackPanel { Spacing = 16, Padding = new Thickness(24) };

        var headerRow = new Grid { ColumnSpacing = 16 };
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _breakdownTitle.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_breakdownTitle, 0);

        var windowRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        _windowCaption.VerticalAlignment = VerticalAlignment.Center;
        windowRow.Children.Add(_windowCaption);
        windowRow.Children.Add(_windowSelect);
        Grid.SetColumn(windowRow, 1);

        headerRow.Children.Add(_breakdownTitle);
        headerRow.Children.Add(windowRow);

        body.Children.Add(headerRow);
        body.Children.Add(_tableHost);

        _breakdownPanel.Padding = new Thickness(24);
        _breakdownPanel.Content = body;
        _contentRoot.Children.Add(_breakdownPanel);
    }

    // A grid of equal-width star columns hosting each child, matching the web responsive card grid.
    private static Grid BuildEqualColumns(double spacing, params FrameworkElement[] children)
    {
        var grid = new Grid { ColumnSpacing = spacing };
        for (var i = 0; i < children.Length; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            Grid.SetColumn(children[i], i);
            grid.Children.Add(children[i]);
        }

        return grid;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _errorState.ActionInvoked -= OnRetryInvoked;
        _windowSelect.SelectionChanged -= OnWindowSelectionChanged;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
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

    private void Render(VehicleCostDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        // Subsystem-unavailable banner (web 503 subsystemMissing).
        _subsystemBanner.Title = display.SubsystemTitle;
        _subsystemBanner.Message = display.SubsystemMessage;
        _subsystemBanner.IsOpen = display.ShowSubsystemUnavailable;
        _subsystemBanner.Visibility = Show(display.ShowSubsystemUnavailable);

        // Loading shimmer.
        _loadingSkeleton.Visibility = Show(display.ShowLoading);

        // Generic failure surface (InfoBar-equivalent + Retry).
        _errorState.Visibility = Show(display.ShowError);
        _errorState.Title = display.ErrorText;
        _errorState.ActionText = display.RetryLabel;
        AutomationProperties.SetName(_errorState, display.ErrorText);

        // Content region (web totals cards + per-vehicle breakdown panel).
        _contentRoot.Visibility = Show(display.ShowContent);

        _totalRowsCard.Label = display.TotalRowsLabel;
        _totalRowsCard.Value = display.TotalRowsValue;
        _totalRowsCard.Sublabel = display.TotalRowsSub;

        _totalBytesCard.Label = display.TotalBytesLabel;
        _totalBytesCard.Value = display.TotalBytesValue;
        _totalBytesCard.Sublabel = display.TotalBytesSub;

        _totalRateCard.Label = display.TotalRateLabel;
        _totalRateCard.Value = display.TotalRateValue;
        _totalRateCard.Sublabel = display.TotalRateSub;

        _totalFailuresCard.Label = display.TotalFailuresLabel;
        _totalFailuresCard.Value = display.TotalFailuresValue;
        _totalFailuresCard.Sublabel = display.TotalFailuresSub;

        _breakdownTitle.Value = display.TableTitle;
        _windowCaption.Value = display.WindowLabel;
        AutomationProperties.SetName(_windowSelect, display.WindowLabel);
        RenderWindowSelector(display);

        RenderTable(display);
    }

    private void RenderWindowSelector(VehicleCostDisplay display)
    {
        _suppressWindowChange = true;
        try
        {
            if (!_windowOptionsPopulated)
            {
                var labels = new List<string>(display.WindowOptions.Count);
                foreach (var option in display.WindowOptions)
                {
                    labels.Add(option.Label);
                }

                _windowSelect.ItemsSource = labels;
                _windowOptionsPopulated = true;
            }

            int selectedIndex = -1;
            for (var i = 0; i < display.WindowOptions.Count; i++)
            {
                if (display.WindowOptions[i].IsSelected)
                {
                    selectedIndex = i;
                    break;
                }
            }

            _windowSelect.SelectedIndex = selectedIndex;
        }
        finally
        {
            _suppressWindowChange = false;
        }
    }

    private void RenderTable(VehicleCostDisplay display)
    {
        if (display.ShowTable)
        {
            _table.Columns = BuildColumns(display.Columns);
            _table.Rows = BuildRows(display.Rows);
            _table.EmptyMessage = display.EmptyTableMessage;
            AutomationProperties.SetName(_table, display.TableTitle);
            _tableHost.Content = _table;
        }
        else
        {
            _emptyState.Title = display.EmptyTitle;
            _emptyState.Message = display.EmptyMessage;
            AutomationProperties.SetName(_emptyState, display.EmptyTitle);
            _tableHost.Content = _emptyState;
        }
    }

    private static List<TsDataColumn> BuildColumns(IReadOnlyList<VehicleCostColumn> columns)
    {
        var built = new List<TsDataColumn>(columns.Count);
        foreach (var column in columns)
        {
            built.Add(new TsDataColumn
            {
                Key = column.Key,
                Header = column.Header,
                IsNumeric = column.IsNumeric,
            });
        }

        return built;
    }

    private static List<TsDataRow> BuildRows(IReadOnlyList<VehicleCostRowDisplay> rows)
    {
        var built = new List<TsDataRow>(rows.Count);
        foreach (var row in rows)
        {
            var values = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["vehicle"] = row.Vehicle,
                ["rows"] = row.Rows,
                ["bytes"] = row.Bytes,
                ["rate"] = row.Rate,
                ["failures"] = row.Failures,
                ["last"] = row.LastSeen,
            };
            built.Add(new TsDataRow(row.VehicleId, values));
        }

        return built;
    }

    private void OnWindowSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressWindowChange)
        {
            return;
        }

        int index = _windowSelect.SelectedIndex;
        if (index < 0 || index >= VehicleCostProjection.WindowChoices.Count)
        {
            return;
        }

        int days = VehicleCostProjection.WindowChoices[index];
        InvokeAsync(() => _viewModel.SetWindowAsync(days));
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private static async void InvokeAsync(Func<Task> action)
    {
        await action().ConfigureAwait(true);
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    protected override AutomationPeer OnCreateAutomationPeer() => new VehicleCostPageAutomationPeer(this);

    private sealed class VehicleCostPageAutomationPeer(VehicleCostPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
