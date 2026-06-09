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
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Energy Site dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/EnergySiteInfoWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (skeleton while loading, a retry surface on error, otherwise a Home title + freshness header — both
/// hidden in the single-column compact footprint, exactly as the web passes <c>title</c>/<c>icon</c> =
/// undefined when <c>isCompact</c>) wrapping one of three bodies: the "no Tesla Energy site linked" empty
/// state (web <c>!hasSites</c>); the "no site info available" empty state (web linked site with null
/// <c>info</c>); or — when site info resolves — the <c>WidgetDetailCard</c> of four label/value rows (Solar
/// System, Powerwalls, Gateway Firmware [monospace], Installation Timezone). All data flows through the
/// shared <see cref="EnergySiteInfoViewModel"/>; the view never performs HTTP. Every string resolves through
/// the i18n facade and every row carries a Narrator name.
/// </summary>
public sealed partial class EnergySiteInfoWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C";  // Segoe Fluent — Refresh
    private const string HomeGlyph = "\uE80F";     // Segoe Fluent — Home, web Home

    private readonly EnergySiteInfoViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly EnergySiteInfoDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly FontIcon _icon;
    private readonly TextBlock _titleText = new();
    private readonly StackPanel _titleRow;
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    public EnergySiteInfoWidget(
        IEnergySiteInfoSource source,
        ILocalizer localizer,
        EnergySiteInfoSize size,
        EnergySiteInfoDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new EnergySiteInfoDiagnostics();
        _viewModel = new EnergySiteInfoViewModel(source, localizer, size);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        _icon = new FontIcon
        {
            Glyph = HomeGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush("TsColorSuccessBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        _titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical registry id this surface registers under (<c>energy-site-info</c>).</summary>
    public static string RegistryId => EnergySiteInfoRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the surface for the new layout.</summary>
    public EnergySiteInfoSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="EnergySiteInfoSource"/> from the
    /// shared data layer (the dashboard host's P2-core dependencies).
    /// </summary>
    public static EnergySiteInfoWidget Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        EnergySiteInfoSize? size = null,
        EnergySiteInfoDiagnostics? diagnostics = null)
    {
        var source = new EnergySiteInfoSource(api, engine, options);
        return new EnergySiteInfoWidget(source, localizer, size ?? EnergySiteInfoRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        AutomationProperties.SetAccessibilityView(_icon, AccessibilityView.Raw);

        _titleText.FontSize = 11;
        _titleText.FontWeight = FontWeights.Medium;
        _titleText.Foreground = DisplayTokens.TextMuted;
        _titleText.CharacterSpacing = 80;
        _titleText.VerticalAlignment = VerticalAlignment.Center;

        _titleRow.Children.Add(_icon);
        _titleRow.Children.Add(_titleText);

        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.energySiteInfo.refresh", "Refresh site info"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);

        var header = new Grid { Padding = new Thickness(12, 8, 12, 2) };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_titleRow, 0);
        Grid.SetColumn(actions, 1);
        header.Children.Add(_titleRow);
        header.Children.Add(actions);

        _bodyHost.VerticalScrollMode = ScrollMode.Auto;
        _bodyHost.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _bodyHost.HorizontalScrollMode = ScrollMode.Disabled;
        _bodyHost.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _bodyHost.Padding = new Thickness(12, 0, 12, 12);

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
        switch (_viewModel.State)
        {
            case EnergySiteInfoState.Loading:
                Content = BuildLoading();
                break;

            case EnergySiteInfoState.Error:
                Content = BuildError();
                break;

            default:
                UpdateHeader();
                _bodyHost.Content = BuildBody();
                Content = _root;
                break;
        }
    }

    private void UpdateHeader()
    {
        // Web parity: the title + icon are hidden in the single-column compact footprint.
        bool compact = _viewModel.Display.IsCompact;
        _icon.Visibility = compact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Visibility = compact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = compact ? string.Empty : _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody()
    {
        var display = _viewModel.Display;
        if (!display.HasSites)
        {
            return BuildEmpty(_viewModel.NoSiteMessage);
        }

        if (!display.HasInfo)
        {
            return BuildEmpty(_viewModel.NoDataMessage);
        }

        return BuildDetailCard(display.Entries);
    }

    private static StackPanel BuildDetailCard(IReadOnlyList<EnergySiteDetailEntry> entries)
    {
        var column = new StackPanel();
        for (int i = 0; i < entries.Count; i++)
        {
            column.Children.Add(BuildDetailRow(entries[i], last: i == entries.Count - 1));
        }

        return column;
    }

    private static Border BuildDetailRow(EnergySiteDetailEntry entry, bool last)
    {
        var label = new TextBlock
        {
            Text = entry.Label.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 40,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Left,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var value = new TextBlock
        {
            Text = entry.Value ?? EnergySiteInfoProjection.EmDash,
            FontSize = 14,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
            TextAlignment = TextAlignment.Right,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        if (entry.Mono)
        {
            value.FontFamily = new FontFamily("Consolas");
        }

        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(label, 0);
        Grid.SetColumn(value, 1);
        grid.Children.Add(label);
        grid.Children.Add(value);

        var container = new Border
        {
            Child = grid,
            Padding = new Thickness(4, 8, 4, 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = last ? new Thickness(0) : new Thickness(0, 0, 0, 1),
            MinHeight = 40,
        };
        AutomationProperties.SetName(container, entry.AccessibilityName);
        return container;
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        for (int i = 0; i < EnergySiteInfoSize.MaxEntries; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 16 });
        }

        AutomationProperties.SetName(column, _localizer.GetString("widget.energySiteInfo.loading", "Loading site info"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.energySiteInfo.error", "Couldn't load site info"),
            ActionText = _localizer.GetString("widget.energySiteInfo.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private static TsEmptyState BuildEmpty(string message) => new()
    {
        IconGlyph = HomeGlyph,
        Message = message,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
