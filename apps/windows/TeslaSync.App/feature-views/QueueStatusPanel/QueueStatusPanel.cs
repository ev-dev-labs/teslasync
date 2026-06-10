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

namespace TeslaSync.App.FeatureViews;

/// <summary>Carries the worker id whose card was activated (web: clicking a card opens the per-worker drawer).</summary>
public sealed class QueueWorkerActivatedEventArgs : EventArgs
{
    /// <summary>Creates the event over the activated worker id.</summary>
    public QueueWorkerActivatedEventArgs(string worker) => Worker = worker;

    /// <summary>The stable worker identifier (web <c>QueueStat.worker</c>) to route the drawer.</summary>
    public string Worker { get; }
}

/// <summary>
/// The native WinUI 3 background-worker queue surface — a parity port of
/// web/src/features/admin/components/QueueStatusPanel.tsx. It composes the web's single <c>GlassPanel</c>: a
/// header (title, subtitle, "Updated {when}" caption and a Refresh button) above a body that renders one card
/// per worker the backend reports under <c>GET /system/queues</c> — each card carrying the worker name, the
/// host/version footnote, a severity-toned heartbeat band label + chevron, the queue-depth bar (with the
/// "{pending} pending · {inProgress} in progress" sublabel), the succeeded / failed 24h counts, the heartbeat
/// caption and the optional "Oldest pending: {duration}" backlog caption. Each card is a focusable, Narrator-
/// named button that raises <see cref="WorkerActivated"/> (the web card opens <c>QueueJobDrawer</c>, a separate
/// surface). Every state renders — loading spinner, populated cards, friendly empty text, an explicit retry
/// surface on hard failure, plus stale and offline freshness chips. The card grid reflows from three columns
/// to one as the panel narrows (web <c>grid-cols-1 md:grid-cols-3</c>). All data flows through the shared
/// <see cref="QueueStatusViewModel"/>; the view never performs HTTP. Every string resolves through the i18n
/// facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class QueueStatusPanel : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C";  // Segoe Fluent — Refresh
    private const string ChevronGlyph = "\uE76C";  // Segoe Fluent — ChevronRight
    private const string EmptyGlyph = "\uE9F5";     // Segoe Fluent — Processing (worker activity)

    private const double CardMinWidth = 240;
    private const double CardGap = 16;
    private const int MaxColumns = 3;

    private readonly QueueStatusViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly QueueStatusDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 16 };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private int _columns = MaxColumns;

    /// <summary>Creates the surface over its data source, localizer and diagnostics.</summary>
    /// <param name="source">The cache-then-network data port (P1/S8 state-holder seam).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">Injected clock for the relative heartbeat / "Updated" stamps (defaults to now).</param>
    public QueueStatusPanel(
        IQueueStatusSource source,
        ILocalizer localizer,
        QueueStatusDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new QueueStatusDiagnostics();
        _viewModel = new QueueStatusViewModel(source, localizer, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, QueueStatusRegistration.Title(localizer));

        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>Raised when a worker card is activated — the host opens the per-worker job drawer.</summary>
    public event EventHandler<QueueWorkerActivatedEventArgs>? WorkerActivated;

    /// <summary>The canonical surface id (<c>queue-status-panel</c>).</summary>
    public static string SurfaceId => QueueStatusRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public QueueStatusViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="QueueStatusSource"/> from the shared
    /// data layer (the host's P2-core dependencies).
    /// </summary>
    public static QueueStatusPanel Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        QueueStatusDiagnostics? diagnostics = null)
    {
        var source = new QueueStatusSource(api, engine, options);
        return new QueueStatusPanel(source, localizer, diagnostics);
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

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    // web `grid-cols-1 md:grid-cols-3`: reflow the worker cards from three columns to one as the panel
    // narrows, recomputing only when the column count actually changes (and only while cards are shown).
    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        double width = e.NewSize.Width;
        if (width <= 0)
        {
            return;
        }

        double available = Math.Max(0, width - 40); // TsGlassPanel padding (20 each side).
        int desired = Math.Clamp(
            (int)Math.Floor((available + CardGap) / (CardMinWidth + CardGap)),
            1,
            MaxColumns);

        if (desired == _columns)
        {
            return;
        }

        _columns = desired;
        if (_viewModel.Display.HasRows && IsCardState(_viewModel.State))
        {
            ScheduleRender();
        }
    }

    private static bool IsCardState(QueuePanelState state) =>
        state is QueuePanelState.Loaded or QueuePanelState.Stale or QueuePanelState.Offline;

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
        _root.Children.Clear();
        _root.Children.Add(BuildPanel());
    }

    private TsGlassPanel BuildPanel()
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(BuildHeader());
        column.Children.Add(BuildBody());

        return new TsGlassPanel
        {
            Padding = new Thickness(20),
            Content = column,
        };
    }

    // ── Header ───────────────────────────────────────────────────────────────────────────────────────

    private Grid BuildHeader()
    {
        var titleColumn = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Top };
        titleColumn.Children.Add(new PanelTitle { Value = _viewModel.Title });
        titleColumn.Children.Add(new Text
        {
            Value = _viewModel.Subtitle,
            Foreground = DisplayTokens.TextSecondary,
            MaxWidth = 680,
            HorizontalAlignment = HorizontalAlignment.Left,
        });
        if (_viewModel.UpdatedLabel is { } updated)
        {
            titleColumn.Children.Add(new Caption { Value = updated });
        }

        var controls = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Top,
        };
        controls.Children.Add(BuildRefreshButton());
        controls.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.IsError,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(titleColumn, 0);
        Grid.SetColumn(controls, 1);
        grid.Children.Add(titleColumn);
        grid.Children.Add(controls);
        return grid;
    }

    private TsButton BuildRefreshButton()
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = _viewModel.RefreshLabel,
            IconGlyph = RefreshGlyph,
            IsLoading = _viewModel.IsRefreshing,
            IsEnabled = !_viewModel.IsFetching,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(button, _viewModel.RefreshLabel);
        button.Click += OnRefresh;
        return button;
    }

    private void OnRefresh(object sender, RoutedEventArgs e) => _ = _viewModel.RefreshAsync();

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    // ── Body (state switch) ──────────────────────────────────────────────────────────────────────────

    private FrameworkElement BuildBody() => _viewModel.State switch
    {
        QueuePanelState.Loading => BuildLoading(),
        QueuePanelState.Error => BuildError(),
        QueuePanelState.Empty => BuildEmpty(),
        _ => _viewModel.Display.HasRows ? BuildCards() : BuildEmpty(),
    };

    private Grid BuildCards()
    {
        var rows = _viewModel.Display.Rows;
        int columns = Math.Clamp(_columns, 1, Math.Max(1, rows.Count));
        int rowCount = (int)Math.Ceiling(rows.Count / (double)columns);

        var grid = new Grid { ColumnSpacing = CardGap, RowSpacing = CardGap };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < rowCount; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < rows.Count; i++)
        {
            var card = BuildCard(rows[i]);
            Grid.SetColumn(card, i % columns);
            Grid.SetRow(card, i / columns);
            grid.Children.Add(card);
        }

        AutomationProperties.SetName(grid, _viewModel.Title);
        return grid;
    }

    private Button BuildCard(QueueWorkerDisplay row)
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(BuildCardHeader(row));

        content.Children.Add(new TsMetricBar
        {
            Value = row.QueueDepthValue,
            Max = row.QueueDepthMax,
            Label = row.QueueDepthLabel,
            AccentBrushKey = row.AccentBrushKey,
        });
        content.Children.Add(new Caption { Value = row.QueueDepthDetail });

        content.Children.Add(BuildCounters(row));

        content.Children.Add(CaptionText(row.HeartbeatLabel, DisplayTokens.Brush(row.AccentBrushKey)));

        if (row.OldestLabel is { } oldest)
        {
            content.Children.Add(CaptionText(
                oldest,
                DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Warning))));
        }

        var card = new Border
        {
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
            Padding = new Thickness(16),
            Child = content,
        };

        var button = new Button
        {
            Content = card,
            Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(0),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
            VerticalContentAlignment = VerticalAlignment.Stretch,
            DataContext = row.Worker,
        };
        AutomationProperties.SetName(button, row.OpenLabel);
        button.Click += OnCardClick;
        button.PointerEntered += (_, _) => SetCardEmphasis(card, true);
        button.PointerExited += (_, _) => SetCardEmphasis(card, false);
        button.GotFocus += (_, _) => SetCardEmphasis(card, true);
        button.LostFocus += (_, _) => SetCardEmphasis(card, false);
        return button;
    }

    private Grid BuildCardHeader(QueueWorkerDisplay row)
    {
        var nameColumn = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Top };
        nameColumn.Children.Add(new TextBlock
        {
            Text = row.DisplayName,
            FontSize = 13,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });
        nameColumn.Children.Add(new Caption { Value = row.HostLabel });

        var severity = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Top,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        severity.Children.Add(new TextBlock
        {
            Text = row.SeverityLabel,
            FontSize = 12,
            Foreground = DisplayTokens.Brush(row.AccentBrushKey),
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        });
        var chevron = new FontIcon
        {
            Glyph = ChevronGlyph,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(chevron, AccessibilityView.Raw);
        severity.Children.Add(chevron);

        var header = new Grid { ColumnSpacing = 12 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(nameColumn, 0);
        Grid.SetColumn(severity, 1);
        header.Children.Add(nameColumn);
        header.Children.Add(severity);
        return header;
    }

    private static Grid BuildCounters(QueueWorkerDisplay row)
    {
        var succeeded = new StackPanel { Spacing = 2 };
        succeeded.Children.Add(new Caption { Value = row.SucceededLabel });
        succeeded.Children.Add(new TextBlock
        {
            Text = row.SucceededValue,
            FontSize = 13,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Success)),
        });

        var failed = new StackPanel { Spacing = 2 };
        failed.Children.Add(new Caption { Value = row.FailedLabel });
        failed.Children.Add(new TextBlock
        {
            Text = row.FailedValue,
            FontSize = 13,
            FontWeight = FontWeights.Medium,
            Foreground = row.FailedIsDanger
                ? DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Danger))
                : DisplayTokens.TextPrimary,
        });

        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(succeeded, 0);
        Grid.SetColumn(failed, 1);
        grid.Children.Add(succeeded);
        grid.Children.Add(failed);
        return grid;
    }

    private static TextBlock CaptionText(string text, Brush foreground) => new()
    {
        Text = text,
        FontSize = 12,
        Foreground = foreground,
        TextWrapping = TextWrapping.Wrap,
    };

    private static void SetCardEmphasis(Border card, bool emphasized) =>
        card.BorderBrush = emphasized ? DisplayTokens.Accent : DisplayTokens.Border;

    private void OnCardClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button { DataContext: string worker } && !string.IsNullOrEmpty(worker))
        {
            WorkerActivated?.Invoke(this, new QueueWorkerActivatedEventArgs(worker));
        }
    }

    private StackPanel BuildLoading()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            Padding = new Thickness(0, 8, 0, 8),
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(new TsSpinner { Size = ControlSize.Small, VerticalAlignment = VerticalAlignment.Center });
        row.Children.Add(new Text
        {
            Value = _viewModel.LoadingLabel,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        });

        AutomationProperties.SetName(row, _viewModel.LoadingLabel);
        LiveRegion.Configure(row);
        LiveRegion.Announce(row);
        return row;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _viewModel.ErrorMessageDefault,
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = EmptyGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };
}
