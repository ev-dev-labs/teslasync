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
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Signal Log dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/SignalLogWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (a skeleton while loading, a retry surface on error, otherwise a title + log glyph + freshness
/// header with a Pause/Resume action) wrapping either <c>WidgetEventFeed</c> (the newest-first,
/// source-badged signal rows, or a friendly empty state) at full size, or the <c>WidgetBigNumber</c>
/// signals/second readout when compact (1 column). All data flows through the shared
/// <see cref="SignalLogViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class SignalLogWidget : ContentControl, IDisposable
{
    private const string LogGlyph = "\uE8FD";     // Segoe Fluent — List (the signal log feed)
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const string PauseGlyph = "\uE769";   // Segoe Fluent — Pause
    private const string ResumeGlyph = "\uE768";  // Segoe Fluent — Play

    private readonly SignalLogViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly SignalLogDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();
    private readonly Button _pause = new();
    private readonly FontIcon _pauseIcon = new() { Glyph = PauseGlyph, FontSize = 12 };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its feed source, localizer, footprint, rate source and diagnostics.</summary>
    /// <param name="source">The cache-then-network observation feed source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="size">The widget footprint (registry metadata).</param>
    /// <param name="rateSource">Optional signals/second source for the compact view.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    /// <param name="clock">Injected clock for deterministic relative-time projection.</param>
    public SignalLogWidget(
        ISignalLogSource source,
        ILocalizer localizer,
        SignalLogSize size,
        ISignalRateSource? rateSource = null,
        SignalLogDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new SignalLogDiagnostics();
        _viewModel = new SignalLogViewModel(source, localizer, size, rateSource, clock);
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

    /// <summary>The canonical registry id this surface registers under (<c>signal-log</c>).</summary>
    public static string RegistryId => SignalLogRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the rows and re-evaluates the compact branch.</summary>
    public SignalLogSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="SignalLogSource"/> +
    /// <see cref="SignalRateSource"/> from the shared data layer (the dashboard host's P2-core
    /// dependencies), resolving the primary cached vehicle unless an explicit <paramref name="vehicleId"/>
    /// is supplied.
    /// </summary>
    public static SignalLogWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        SignalLogSize? size = null,
        long? vehicleId = null,
        SignalLogDiagnostics? diagnostics = null)
    {
        var source = new SignalLogSource(vehicles, api, engine, options, vehicleId);
        var rateSource = new SignalRateSource(api, engine, options);
        return new SignalLogWidget(source, localizer, size ?? SignalLogRegistration.DefaultSize, rateSource, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = LogGlyph,
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

        _pause.Content = _pauseIcon;
        _pause.Background = Transparent();
        _pause.BorderThickness = new Thickness(0);
        _pause.Padding = new Thickness(6, 2, 6, 2);
        _pause.MinWidth = 44;
        _pause.MinHeight = 44;
        _pause.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_pause, _viewModel.PauseToggleLabel);
        _pause.Click += OnPauseClick;

        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.signalLog.refresh", "Refresh signals"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_pause);
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
        _bodyHost.Padding = new Thickness(12, 0, 12, 8);

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

    private void OnPauseClick(object sender, RoutedEventArgs e) => _viewModel.TogglePause();

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
            case SignalLogState.Loading:
                Content = BuildLoading();
                break;

            case SignalLogState.Error:
                Content = BuildError();
                break;

            default:
                UpdateHeader();
                _bodyHost.Content = _viewModel.IsCompact
                    ? BuildCompact()
                    : _viewModel.HasRows ? BuildRows(_viewModel.Rows) : BuildEmpty();
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

        // The Pause action only exists at full size (web: `actions={!isCompact ? pauseAction : undefined}`).
        _pause.Visibility = _viewModel.IsCompact ? Visibility.Collapsed : Visibility.Visible;
        _pauseIcon.Glyph = _viewModel.IsPaused ? ResumeGlyph : PauseGlyph;
        AutomationProperties.SetName(_pause, _viewModel.PauseToggleLabel);
    }

    private StackPanel BuildCompact()
    {
        var column = new StackPanel
        {
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var number = new TsAnimatedNumber { Value = _viewModel.Rate, Precision = 0 };
        AutomationProperties.SetName(number, FormattableString.Invariant($"{Math.Round(_viewModel.Rate)} {_viewModel.RatePerSecLabel}"));

        var label = new TextBlock
        {
            Text = _viewModel.RatePerSecLabel,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 80,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        column.Children.Add(number);
        column.Children.Add(label);
        return column;
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        for (int i = 0; i < 4; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 16 });
        }

        AutomationProperties.SetName(column, _localizer.GetString("widget.signalLog.loading", "Loading signals"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.signalLog.error", "Couldn't load the signal log"),
            ActionText = _localizer.GetString("widget.signalLog.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = LogGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static StackPanel BuildRows(IReadOnlyList<SignalLogRow> rows)
    {
        var column = new StackPanel { Spacing = 2 };
        foreach (var row in rows)
        {
            column.Children.Add(BuildRow(row));
        }

        return column;
    }

    private static Grid BuildRow(SignalLogRow row)
    {
        var badge = BuildSourceBadge(row.SourceLabel, row.AccentBrushKey);

        var body = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };
        body.Children.Add(new TextBlock
        {
            Text = row.SignalName,
            FontSize = 14,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });
        body.Children.Add(new TextBlock
        {
            Text = row.Value,
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
        Grid.SetColumn(badge, 0);
        Grid.SetColumn(body, 1);
        Grid.SetColumn(time, 2);
        grid.Children.Add(badge);
        grid.Children.Add(body);
        grid.Children.Add(time);

        AutomationProperties.SetName(grid, row.AutomationName);
        return grid;
    }

    private static Border BuildSourceBadge(string label, string accentBrushKey)
    {
        var accent = DisplayTokens.Brush(accentBrushKey);
        var text = new TextBlock
        {
            Text = label,
            FontSize = 11,
            FontWeight = FontWeights.Medium,
            Foreground = accent,
        };
        AutomationProperties.SetAccessibilityView(text, AccessibilityView.Raw);

        return new Border
        {
            Child = text,
            CornerRadius = DisplayTokens.Radius("TsRadiusPill", 999),
            BorderBrush = accent,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(8, 2, 8, 2),
            VerticalAlignment = VerticalAlignment.Top,
        };
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
