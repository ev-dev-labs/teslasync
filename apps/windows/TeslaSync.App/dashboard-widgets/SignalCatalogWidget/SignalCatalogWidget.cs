using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Signal Catalog dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/SignalCatalogWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (skeleton while loading, otherwise a title + book icon + freshness header with a refresh retry)
/// wrapping either the compact total-count + "signals available" caption (1×N), or — when standard
/// (≥2 cols) — a fixed search field above the category-grouped, scrollable signal list (each row: the
/// mono signal name, the optional value-kind badge, and the right-aligned observation count). A
/// friendly "No signals in catalog" empty state covers a missing catalog and a "No matching signals"
/// empty state covers a search with no hits. Faithful to the web component, a catalog fetch failure is
/// surfaced through the freshness "Error" chip plus the refresh button rather than replacing the body.
/// All data flows through the shared <see cref="SignalCatalogViewModel"/>; the view never performs HTTP.
/// Every string resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class SignalCatalogWidget : ContentControl, IDisposable
{
    private const string HeaderGlyph = "\uE8F1";  // Segoe Fluent — Library (web BookOpen)
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly SignalCatalogViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly SignalCatalogDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ContentControl _bodyHost = new();
    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private Grid? _standardPanel;
    private TsInput? _search;
    private ScrollViewer? _listScroll;

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    public SignalCatalogWidget(
        ISignalCatalogSource source,
        ILocalizer localizer,
        SignalCatalogSize size,
        SignalCatalogDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new SignalCatalogDiagnostics();
        _viewModel = new SignalCatalogViewModel(source, localizer, size);
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

    /// <summary>The canonical registry id this surface registers under (<c>signal-catalog</c>).</summary>
    public static string RegistryId => SignalCatalogRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the surface for the new layout.</summary>
    public SignalCatalogSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="SignalCatalogSource"/> from the
    /// shared data layer (the dashboard host's P2-core dependencies + the widget vehicle source).
    /// </summary>
    public static SignalCatalogWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        SignalCatalogSize? size = null,
        long? vehicleId = null,
        SignalCatalogDiagnostics? diagnostics = null)
    {
        var source = new SignalCatalogSource(vehicles, api, engine, options, vehicleId);
        return new SignalCatalogWidget(source, localizer, size ?? SignalCatalogRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = HeaderGlyph,
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
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.signalCatalog.refresh", "Refresh signal catalog"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);

        var header = new Grid { Padding = new Thickness(12, 8, 12, 2) };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(titleRow, 0);
        Grid.SetColumn(actions, 1);
        header.Children.Add(titleRow);
        header.Children.Add(actions);

        _bodyHost.IsTabStop = false;
        _bodyHost.HorizontalContentAlignment = HorizontalAlignment.Stretch;
        _bodyHost.VerticalContentAlignment = VerticalAlignment.Stretch;
        _bodyHost.Padding = new Thickness(12, 4, 12, 10);

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(header, 0);
        Grid.SetRow(_bodyHost, 1);
        _root.Children.Add(header);
        _root.Children.Add(_bodyHost);
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

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        if (_search is { } search)
        {
            search.TextChanged -= OnSearchTextChanged;
        }

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
        if (_viewModel.State == SignalCatalogState.Loading)
        {
            Content = BuildLoading();
            return;
        }

        UpdateHeader();
        _bodyHost.Content = BuildBody();
        Content = _root;
    }

    private void UpdateHeader()
    {
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody()
    {
        var display = _viewModel.Display;
        if (!display.HasEntries)
        {
            return BuildNoData();
        }

        return display.IsCompact ? BuildCompact(display) : BuildStandard(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        column.Children.Add(new TsSkeleton { BlockHeight = 36, Radius = 8 });
        for (int i = 0; i < 4; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 16 });
        }

        AutomationProperties.SetName(column, _localizer.GetString("widget.signalCatalog.loading", "Loading signal catalog"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsEmptyState BuildNoData() => new()
    {
        IconGlyph = HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private TsEmptyState BuildNoResults() => new()
    {
        IconGlyph = HeaderGlyph,
        Message = _viewModel.NoResultsMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // Web parity: the compact (1-col) layout shows the total signal count above the "signals available"
    // caption. Reachable only below the registered 2-col minimum, implemented for full source parity.
    private static StackPanel BuildCompact(SignalCatalogDisplay display)
    {
        var number = new TextBlock
        {
            Text = display.TotalCountText,
            FontSize = 30,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var caption = new TextBlock
        {
            Text = display.SignalsAvailableLabel,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };

        var column = new StackPanel
        {
            Spacing = 4,
            MinHeight = 44,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(number);
        column.Children.Add(caption);
        AutomationProperties.SetName(column, display.CompactAutomationName);
        return column;
    }

    // Web parity: a fixed search field above the scrollable, category-grouped signal list.
    private Grid BuildStandard(SignalCatalogDisplay display)
    {
        EnsureStandardPanel();
        _listScroll!.Content = display.HasMatches ? BuildGroups(display) : BuildNoResults();
        return _standardPanel!;
    }

    private void EnsureStandardPanel()
    {
        if (_standardPanel is not null)
        {
            return;
        }

        _search = new TsInput
        {
            MinHeight = 44,
            Margin = new Thickness(0, 0, 0, 8),
            Hint = _viewModel.SearchHint,
            Text = _viewModel.Search,
        };
        AutomationProperties.SetName(_search, _viewModel.SearchHint);
        _search.TextChanged += OnSearchTextChanged;

        _listScroll = new ScrollViewer
        {
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };

        _standardPanel = new Grid();
        _standardPanel.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _standardPanel.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_search, 0);
        Grid.SetRow(_listScroll, 1);
        _standardPanel.Children.Add(_search);
        _standardPanel.Children.Add(_listScroll);
    }

    private void OnSearchTextChanged(object sender, TextChangedEventArgs e)
    {
        if (_search is { } search)
        {
            _viewModel.Search = search.Text;
        }
    }

    private static StackPanel BuildGroups(SignalCatalogDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        foreach (var group in display.Groups)
        {
            column.Children.Add(BuildGroup(group));
        }

        return column;
    }

    private static StackPanel BuildGroup(SignalCatalogGroup group)
    {
        var section = new StackPanel { Spacing = 2 };

        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            Margin = new Thickness(2, 0, 2, 2),
        };
        header.Children.Add(new TextBlock
        {
            Text = group.Category.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 10,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 80,
            VerticalAlignment = VerticalAlignment.Center,
        });
        header.Children.Add(new TextBlock
        {
            Text = group.CountLabel,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });
        AutomationProperties.SetName(header, group.AutomationName);
        section.Children.Add(header);

        foreach (var row in group.Rows)
        {
            section.Children.Add(BuildRow(row));
        }

        return section;
    }

    private static Grid BuildRow(SignalCatalogRow row)
    {
        var grid = new Grid { ColumnSpacing = 8, Padding = new Thickness(2, 4, 2, 4) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var name = new TextBlock
        {
            Text = row.Name,
            FontSize = 12,
            FontFamily = MonoFont,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };
        Grid.SetColumn(name, 0);
        grid.Children.Add(name);

        if (row.HasUnit)
        {
            var badge = new TsBadge
            {
                Status = StatusKind.Neutral,
                Content = row.UnitLabel,
                VerticalAlignment = VerticalAlignment.Center,
            };
            Grid.SetColumn(badge, 1);
            grid.Children.Add(badge);
        }

        var count = new TextBlock
        {
            Text = row.ObservationCountText,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            MinWidth = 36,
            TextAlignment = TextAlignment.Right,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(count, 2);
        grid.Children.Add(count);

        AutomationProperties.SetName(grid, row.AutomationName);
        return grid;
    }

    private static FontFamily MonoFont { get; } = new("Consolas");

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
