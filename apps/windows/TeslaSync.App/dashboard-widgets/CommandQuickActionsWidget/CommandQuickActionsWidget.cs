using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Quick Actions dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/CommandQuickActionsWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (skeleton while the vehicle list loads, otherwise — when not compact — a title + <c>Zap</c> icon +
/// freshness header with a refresh retry) wrapping a responsive grid of command buttons. Each tile is a
/// shared <see cref="TsButton"/> (subtle/ghost) carrying the command's Segoe Fluent glyph (token-tinted) and,
/// when not compact, its localized label; the active command swaps in a <see cref="ProgressRing"/> and the
/// whole grid disables while a command is in flight (web <c>disabled={!!activeCommand}</c>). The size-driven
/// command slice (four compact / six default / all eight wide) and grid columns reproduce the web responsive
/// layout. When no vehicle resolves, a friendly "No vehicle selected" empty state renders in place of the grid
/// — never a blank panel. A vehicle-list fetch failure surfaces through the freshness "Error" chip + refresh
/// (the retry affordance) rather than replacing the grid. All data and command flow through the shared
/// <see cref="CommandQuickActionsViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade, every interactive element carries a Narrator name, and each settled command is announced
/// through a polite live region.
/// </summary>
public sealed partial class CommandQuickActionsWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly CommandQuickActionsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly CommandQuickActionsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Grid _header = new();
    private readonly Border _bodyHost = new();
    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();
    private readonly TextBlock _announcer = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private string? _announced;

    /// <summary>Creates the surface over its data source, command sender, localizer, footprint and diagnostics.</summary>
    public CommandQuickActionsWidget(
        ICommandQuickActionsSource source,
        IVehicleCommandSender commandSender,
        ILocalizer localizer,
        CommandQuickActionsSize size,
        CommandQuickActionsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(commandSender);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new CommandQuickActionsDiagnostics();
        _viewModel = new CommandQuickActionsViewModel(source, commandSender, localizer, size);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical registry id this surface registers under (<c>command-quick-actions</c>).</summary>
    public static string RegistryId => CommandQuickActionsRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the command grid for the new layout.</summary>
    public CommandQuickActionsSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="CommandQuickActionsSource"/> +
    /// <see cref="VehicleCommandSender"/> from the shared data layer (the dashboard host's P2-core
    /// dependencies).
    /// </summary>
    public static CommandQuickActionsWidget Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        CommandQuickActionsSize? size = null,
        long? vehicleId = null,
        CommandQuickActionsDiagnostics? diagnostics = null)
    {
        var source = new CommandQuickActionsSource(api, engine, options, vehicleId);
        var sender = new VehicleCommandSender(api);
        return new CommandQuickActionsWidget(
            source,
            sender,
            localizer,
            size ?? CommandQuickActionsRegistration.DefaultSize,
            diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = CommandQuickActionsProjection.ZapGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        _titleText.FontSize = 11;
        _titleText.FontWeight = FontWeights.Medium;
        _titleText.Foreground = DisplayTokens.TextMuted;
        _titleText.CharacterSpacing = 80;
        _titleText.VerticalAlignment = VerticalAlignment.Center;

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        titleRow.Children.Add(icon);
        titleRow.Children.Add(_titleText);

        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.Transparent);
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _viewModel.RefreshLabel);
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);

        _header.Padding = new Thickness(12, 8, 12, 2);
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(titleRow, 0);
        Grid.SetColumn(actions, 1);
        _header.Children.Add(titleRow);
        _header.Children.Add(actions);

        _bodyHost.Padding = new Thickness(12, 4, 12, 8);
        _bodyHost.VerticalAlignment = VerticalAlignment.Stretch;
        _bodyHost.HorizontalAlignment = HorizontalAlignment.Stretch;

        _announcer.FontSize = 11;
        _announcer.Foreground = DisplayTokens.TextMuted;
        _announcer.TextWrapping = TextWrapping.Wrap;
        _announcer.Padding = new Thickness(12, 0, 12, 8);
        _announcer.Visibility = Visibility.Collapsed;
        LiveRegion.Configure(_announcer);

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        Grid.SetRow(_header, 0);
        Grid.SetRow(_bodyHost, 1);
        Grid.SetRow(_announcer, 2);
        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);
        _root.Children.Add(_announcer);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model and cancel any in-flight load/command (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        if (_viewModel.State == CommandQuickActionsState.Loading)
        {
            Content = BuildLoading();
            return;
        }

        UpdateHeader();
        _bodyHost.Child = BuildBody();
        UpdateAnnouncer();
        Content = _root;
    }

    private void UpdateHeader()
    {
        _header.Visibility = _viewModel.ShowHeader ? Visibility.Visible : Visibility.Collapsed;
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
        AutomationProperties.SetName(_refresh, _viewModel.RefreshLabel);
    }

    private UIElement BuildBody() =>
        _viewModel.HasVehicle ? BuildGrid() : BuildEmpty();

    private Grid BuildGrid()
    {
        var display = _viewModel.Display;
        int columns = Math.Max(1, display.Columns);
        int count = display.Tiles.Count;
        int rows = (count + columns - 1) / columns;

        var grid = new Grid
        {
            ColumnSpacing = 8,
            RowSpacing = 8,
            VerticalAlignment = display.IsCompact ? VerticalAlignment.Stretch : VerticalAlignment.Top,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };

        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        var rowHeight = display.IsCompact ? new GridLength(1, GridUnitType.Star) : GridLength.Auto;
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = rowHeight });
        }

        bool busy = _viewModel.IsBusy;
        for (int i = 0; i < count; i++)
        {
            var tile = BuildTile(display.Tiles[i], display.IsCompact, busy);
            Grid.SetColumn(tile, i % columns);
            Grid.SetRow(tile, i / columns);
            grid.Children.Add(tile);
        }

        AutomationProperties.SetName(grid, _viewModel.Title);
        return grid;
    }

    private TsButton BuildTile(CommandTile tile, bool compact, bool busy)
    {
        bool running = string.Equals(_viewModel.ActiveCommand, tile.Command, StringComparison.Ordinal);

        var content = new StackPanel
        {
            Orientation = Orientation.Vertical,
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (running)
        {
            content.Children.Add(new ProgressRing { IsActive = true, Width = 16, Height = 16 });
        }
        else
        {
            var glyph = new FontIcon
            {
                Glyph = tile.Glyph,
                FontSize = 16,
                Foreground = DisplayTokens.Brush(tile.AccentBrushKey),
            };
            AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);
            content.Children.Add(glyph);
        }

        if (!compact)
        {
            content.Children.Add(new TextBlock
            {
                Text = tile.Label,
                FontSize = 11,
                Foreground = DisplayTokens.TextSecondary,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
                HorizontalAlignment = HorizontalAlignment.Center,
                TextAlignment = TextAlignment.Center,
            });
        }

        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Content = content,
            IsEnabled = !busy,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
            Padding = new Thickness(4, 8, 4, 8),
            MinHeight = 56,
        };
        AutomationProperties.SetName(button, tile.AutomationName);
        button.Click += (_, _) => _ = _viewModel.ExecuteCommandAsync(tile.Command);
        return button;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = CommandQuickActionsProjection.ZapGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private StackPanel BuildLoading()
    {
        var display = _viewModel.Display;
        int columns = Math.Max(1, display.Columns);
        int count = Math.Max(columns, display.Tiles.Count);
        int rows = (count + columns - 1) / columns;

        var grid = new Grid { ColumnSpacing = 8, RowSpacing = 8, Padding = new Thickness(12, 12, 12, 12) };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < count; i++)
        {
            var block = new TsSkeleton { BlockHeight = 56, Radius = 8 };
            Grid.SetColumn(block, i % columns);
            Grid.SetRow(block, i / columns);
            grid.Children.Add(block);
        }

        var column = new StackPanel { Spacing = 0 };
        column.Children.Add(grid);
        AutomationProperties.SetName(column, _viewModel.LoadingLabel);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private void UpdateAnnouncer()
    {
        string? message = _viewModel.LastCommandAnnouncement;
        if (string.IsNullOrEmpty(message))
        {
            _announcer.Visibility = Visibility.Collapsed;
            _announced = null;
            return;
        }

        _announcer.Text = message;
        _announcer.Visibility = Visibility.Visible;
        AutomationProperties.SetName(_announcer, message);

        if (!string.Equals(_announced, message, StringComparison.Ordinal))
        {
            _announced = message;
            LiveRegion.Announce(_announcer);
        }
    }
}
