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

namespace TeslaSync.App.DashboardWidgets.TelemetryErrors;

/// <summary>
/// The native WinUI 3 Telemetry Errors dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/TelemetryErrorsWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (a full skeleton while loading, a retry surface on error, a title + freshness header in the standard
/// layout, or an overlaid freshness chip in the title-less compact layout) wrapping either the centred
/// compact hero (active error-VIN count + "error VINs" + a Healthy/Errors status chip) or the standard
/// stats header plus the aggregated error feed (per VIN + error code, newest first, with a "recent" tag,
/// an "×N" count and a relative timestamp). When neither read carries data it shows a friendly empty
/// state. The data merges two reads — the error-VIN list and the error feed — through the shared
/// <see cref="TelemetryErrorsViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class TelemetryErrorsWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly TelemetryErrorsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly TelemetryErrorsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _headerFreshness = new();
    private readonly Button _refresh = new();
    private readonly Border _bodyHost = new();
    private readonly StackPanel _overlay = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 4,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Top,
        Margin = new Thickness(0, 6, 6, 0),
    };

    private readonly TsDataFreshness _overlayFreshness = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    public TelemetryErrorsWidget(
        ITelemetryErrorsSource source,
        ILocalizer localizer,
        TelemetryErrorsSize size,
        TelemetryErrorsDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new TelemetryErrorsDiagnostics();
        _viewModel = new TelemetryErrorsViewModel(source, localizer, size, clock);
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

    /// <summary>The canonical registry id this surface registers under (<c>telemetry-errors</c>).</summary>
    public static string RegistryId => TelemetryErrorsRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the surface for the new layout.</summary>
    public TelemetryErrorsSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="TelemetryErrorsSource"/> from the
    /// shared data layer (the dashboard host's P2-core dependencies).
    /// </summary>
    public static TelemetryErrorsWidget Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        TelemetryErrorsSize? size = null,
        TelemetryErrorsDiagnostics? diagnostics = null)
    {
        var source = new TelemetryErrorsSource(api, engine, options);
        return new TelemetryErrorsWidget(source, localizer, size ?? TelemetryErrorsRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = TelemetryErrorsProjection.HeaderGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush("TsColorDangerBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        _titleText.FontSize = 11;
        _titleText.FontWeight = FontWeights.Medium;
        _titleText.Foreground = DisplayTokens.TextMuted;
        _titleText.CharacterSpacing = 80;
        _titleText.VerticalAlignment = VerticalAlignment.Center;

        _titleRow.Children.Add(icon);
        _titleRow.Children.Add(_titleText);

        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.telemetryErrors.refresh", "Refresh telemetry errors"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_headerFreshness);
        actions.Children.Add(_refresh);

        _header.Padding = new Thickness(12, 8, 12, 2);
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_titleRow, 0);
        Grid.SetColumn(actions, 1);
        _header.Children.Add(_titleRow);
        _header.Children.Add(actions);

        _bodyHost.HorizontalAlignment = HorizontalAlignment.Stretch;
        _bodyHost.VerticalAlignment = VerticalAlignment.Stretch;

        _overlay.Children.Add(_overlayFreshness);

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_header, 0);
        Grid.SetRow(_bodyHost, 1);
        Grid.SetRow(_overlay, 0);
        Grid.SetRowSpan(_overlay, 2);
        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);
        _root.Children.Add(_overlay);
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
            case TelemetryErrorsState.Loading:
                Content = BuildLoading();
                break;

            case TelemetryErrorsState.Error:
                Content = BuildError();
                break;

            default:
                UpdateChrome();
                _bodyHost.Child = BuildBody();
                Content = _root;
                break;
        }
    }

    private void UpdateChrome()
    {
        var display = _viewModel.Display;
        bool compact = display.IsCompact;

        _headerFreshness.UpdatedAt = _viewModel.UpdatedAt;
        _headerFreshness.IsFetching = _viewModel.IsFetching;
        _headerFreshness.IsError = _viewModel.IsError;
        _overlayFreshness.UpdatedAt = _viewModel.UpdatedAt;
        _overlayFreshness.IsFetching = _viewModel.IsFetching;
        _overlayFreshness.IsError = _viewModel.IsError;

        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _refresh.IsEnabled = !_viewModel.IsFetching;

        // Web parity: title-less compact (overlaid freshness) vs the full title header.
        _header.Visibility = compact ? Visibility.Collapsed : Visibility.Visible;
        _overlay.Visibility = compact ? Visibility.Visible : Visibility.Collapsed;
    }

    private UIElement BuildBody()
    {
        var display = _viewModel.Display;
        if (!display.HasData)
        {
            return BuildEmpty();
        }

        return display.IsCompact ? BuildCompact(display) : BuildStandard(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        for (int i = 0; i < 3; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 16 });
        }

        AutomationProperties.SetName(column, _localizer.GetString("widget.telemetryErrors.loading", "Loading telemetry errors"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.telemetryErrors.error", "Couldn't load telemetry errors"),
            ActionText = _localizer.GetString("widget.telemetryErrors.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = TelemetryErrorsProjection.HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Compact hero (web 1×2) ──────────────────────────────────────────────────────────────────────
    private static StackPanel BuildCompact(TelemetryErrorsDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Padding = new Thickness(12),
            MinHeight = 44,
        };

        column.Children.Add(new TextBlock
        {
            Text = display.ActiveVinCountValue,
            FontSize = 20,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        column.Children.Add(new TextBlock
        {
            Text = display.ErrorVinsLabel,
            FontSize = 11,
            Foreground = DisplayTokens.TextSecondary,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        column.Children.Add(BuildStatusBadge(display, 12));

        AutomationProperties.SetName(column, display.CompactAutomationName);
        return column;
    }

    // ── Standard layout (web 2×4) ───────────────────────────────────────────────────────────────────
    private Grid BuildStandard(TelemetryErrorsDisplay display)
    {
        var panel = new Grid { Padding = new Thickness(12, 0, 12, 12), RowSpacing = 8 };
        panel.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        panel.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        // Header stats: "{n} VINs with errors" + status chip.
        var statsRow = new Grid();
        statsRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        statsRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var summary = new TextBlock
        {
            Text = display.ActiveVinsSummary,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };
        var badge = BuildStatusBadge(display, 10);
        badge.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(summary, 0);
        Grid.SetColumn(badge, 1);
        statsRow.Children.Add(summary);
        statsRow.Children.Add(badge);
        Grid.SetRow(statsRow, 0);
        panel.Children.Add(statsRow);

        var feed = new ScrollViewer
        {
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Content = display.HasEntries ? BuildFeed(display) : BuildNoErrors(display),
        };
        Grid.SetRow(feed, 1);
        panel.Children.Add(feed);

        return panel;
    }

    private static TextBlock BuildNoErrors(TelemetryErrorsDisplay display) => new()
    {
        Text = display.NoErrorsMessage,
        FontSize = 12,
        Foreground = DisplayTokens.TextMuted,
        HorizontalAlignment = HorizontalAlignment.Center,
        TextAlignment = TextAlignment.Center,
        Margin = new Thickness(0, 16, 0, 16),
    };

    private StackPanel BuildFeed(TelemetryErrorsDisplay display)
    {
        var column = new StackPanel { Spacing = 4 };
        foreach (var entry in display.Entries)
        {
            column.Children.Add(BuildEntryRow(entry));
        }

        return column;
    }

    private Border BuildEntryRow(TelemetryErrorEntry entry)
    {
        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        // Left: VIN (+ "recent" chip) over the error code.
        var left = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };

        var vinRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        vinRow.Children.Add(new TextBlock
        {
            Text = entry.Vin,
            FontSize = 12,
            FontFamily = new FontFamily("Consolas"),
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            MaxWidth = 160,
            VerticalAlignment = VerticalAlignment.Center,
        });

        if (entry.IsRecent)
        {
            vinRow.Children.Add(new TsBadge
            {
                Status = StatusKind.Danger,
                Dot = true,
                Content = _localizer.GetString("widget.telemetryErrors.recent", "recent"),
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        left.Children.Add(vinRow);
        left.Children.Add(new TextBlock
        {
            Text = entry.ErrorCode,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });

        // Right: "×N" over the relative last-seen time.
        var right = new StackPanel { Spacing = 1, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
        right.Children.Add(new TextBlock
        {
            Text = entry.CountLabel,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextSecondary,
            HorizontalAlignment = HorizontalAlignment.Right,
        });
        right.Children.Add(new TextBlock
        {
            Text = entry.LastSeenRelative,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Right,
        });

        Grid.SetColumn(left, 0);
        Grid.SetColumn(right, 1);
        grid.Children.Add(left);
        grid.Children.Add(right);

        var row = new Border
        {
            Child = grid,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush"),
            Padding = new Thickness(8, 6, 8, 6),
            MinHeight = 44,
        };
        AutomationProperties.SetName(row, entry.AutomationName);
        return row;
    }

    private static TsBadge BuildStatusBadge(TelemetryErrorsDisplay display, double fontSize) => new()
    {
        Status = display.Status,
        Content = new TextBlock { Text = display.StatusLabel, FontSize = fontSize },
    };

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
