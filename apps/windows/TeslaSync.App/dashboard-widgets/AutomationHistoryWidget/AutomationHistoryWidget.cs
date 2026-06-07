using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Automation History dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/AutomationHistoryWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (skeleton while loading, a retry surface on error, otherwise a title + PlayCircle + freshness header)
/// wrapping either the compact success-rate hero (1×N — the big percentage, "Success Rate" label and the
/// last-run time), or — when wider — the success-rate <c>Badge</c> header (toned success/warning/danger by
/// the rate, with the total-run count) above a newest-first run feed (status-iconed rows, or a friendly
/// empty state). All data flows through the shared <see cref="AutomationHistoryViewModel"/>; the view never
/// performs HTTP. Every string resolves through the i18n facade and every interactive element carries a
/// Narrator name.
/// </summary>
public sealed partial class AutomationHistoryWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly AutomationHistoryViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly AutomationHistoryDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    public AutomationHistoryWidget(
        IAutomationHistorySource source,
        ILocalizer localizer,
        AutomationHistorySize size,
        AutomationHistoryDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new AutomationHistoryDiagnostics();
        _viewModel = new AutomationHistoryViewModel(source, localizer, size, clock);
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

    /// <summary>The canonical registry id this surface registers under (<c>automation-history</c>).</summary>
    public static string RegistryId => AutomationHistoryRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the rows for the new layout.</summary>
    public AutomationHistorySize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="AutomationHistorySource"/> from the
    /// shared data layer (the dashboard host's P2-core dependencies).
    /// </summary>
    public static AutomationHistoryWidget Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        AutomationHistorySize? size = null,
        AutomationHistoryDiagnostics? diagnostics = null)
    {
        var source = new AutomationHistorySource(api, engine, options);
        return new AutomationHistoryWidget(source, localizer, size ?? AutomationHistoryRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = AutomationRunStatus.PlayGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        _titleText.FontSize = 11;
        _titleText.FontWeight = Microsoft.UI.Text.FontWeights.Medium;
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.automationHistory.refresh", "Refresh automation history"));
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
            case AutomationHistoryState.Loading:
                Content = BuildLoading();
                break;

            case AutomationHistoryState.Error:
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
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody()
    {
        var display = _viewModel.Display;
        if (_viewModel.Size.IsCompact)
        {
            return display.HasItems ? BuildCompactHero(display) : BuildEmpty();
        }

        return BuildWide(display);
    }

    private StackPanel BuildWide(AutomationHistoryDisplay display)
    {
        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(BuildSuccessHeader(display));
        column.Children.Add(display.HasItems ? BuildRows(display.Items) : BuildEmpty());
        return column;
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        for (int i = 0; i < 4; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 16 });
        }

        AutomationProperties.SetName(column, _localizer.GetString("widget.automationHistory.loading", "Loading automation history"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.automationHistory.error", "Couldn't load automation history"),
            ActionText = _localizer.GetString("widget.automationHistory.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = AutomationRunStatus.PlayGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Border BuildSuccessHeader(AutomationHistoryDisplay display)
    {
        var badge = new TsBadge
        {
            Status = display.SuccessRateStatus,
            Content = display.BadgeText,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, display.BadgeText);

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(badge);

        if (display.HasSummary)
        {
            row.Children.Add(new TextBlock
            {
                Text = display.TotalRunsText,
                FontSize = 11,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        return new Border
        {
            Child = row,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
            Padding = new Thickness(0, 0, 0, 6),
        };
    }

    private static StackPanel BuildCompactHero(AutomationHistoryDisplay display)
    {
        var number = new TextBlock
        {
            Text = display.CompactValueText,
            FontSize = 26,
            FontWeight = Microsoft.UI.Text.FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var label = new TextBlock
        {
            Text = display.SuccessRateLabel,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var column = new StackPanel
        {
            Spacing = 2,
            MinHeight = 44,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(number);
        column.Children.Add(label);

        if (!string.IsNullOrEmpty(display.LastRunRelative))
        {
            column.Children.Add(new TextBlock
            {
                Text = display.LastRunRelative,
                FontSize = 12,
                Foreground = DisplayTokens.TextSecondary,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }

        AutomationProperties.SetName(column, display.CompactAutomationName);
        return column;
    }

    private static StackPanel BuildRows(IReadOnlyList<AutomationRunRow> rows)
    {
        var column = new StackPanel { Spacing = 2 };
        foreach (var row in rows)
        {
            column.Children.Add(BuildRow(row));
        }

        return column;
    }

    private static Grid BuildRow(AutomationRunRow row)
    {
        var icon = new FontIcon
        {
            Glyph = row.Glyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush(row.AccentBrushKey),
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var body = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };
        body.Children.Add(new TextBlock
        {
            Text = row.Title,
            FontSize = 14,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });
        body.Children.Add(new TextBlock
        {
            Text = row.Subtitle,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });

        var time = new TextBlock
        {
            Text = row.RelativeTime,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Top,
        };

        var grid = new Grid { ColumnSpacing = 10, Padding = new Thickness(2, 6, 2, 6) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(icon, 0);
        Grid.SetColumn(body, 1);
        Grid.SetColumn(time, 2);
        grid.Children.Add(icon);
        grid.Children.Add(body);
        grid.Children.Add(time);

        AutomationProperties.SetName(grid, row.AutomationName);
        return grid;
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
