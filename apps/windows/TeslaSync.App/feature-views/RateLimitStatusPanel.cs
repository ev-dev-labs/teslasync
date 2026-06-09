using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 rate-limit status surface — a parity port of
/// web/src/features/admin/components/RateLimitStatusPanel.tsx. It composes the web's single
/// <c>GlassPanel</c>: a header (title, subtitle, "Updated {when}" caption and a Refresh button) above a body
/// that renders one <c>MetricBar</c> per <c>ScopeBudget</c> the backend reports under
/// <c>GET /system/rate-limits</c> — each row carrying the scope name, a severity-toned label, the bar
/// (window label + "current / limit" usage), the optional detail footnote and the optional
/// "Refills in {duration}" reset countdown. Every state renders — loading spinner, populated rows, friendly
/// empty text, an explicit retry surface on hard failure, plus stale and offline freshness chips. All data
/// flows through the shared <see cref="RateLimitStatusViewModel"/>; the view never performs HTTP. Every
/// string resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class RateLimitStatusPanel : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const string EmptyGlyph = "\uE9D9";    // Segoe Fluent — Speed (throttle/budget)

    private readonly RateLimitStatusViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly RateLimitStatusDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 16 };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer and diagnostics.</summary>
    public RateLimitStatusPanel(
        IRateLimitStatusSource source,
        ILocalizer localizer,
        RateLimitStatusDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new RateLimitStatusDiagnostics();
        _viewModel = new RateLimitStatusViewModel(source, localizer, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, RateLimitStatusRegistration.Title(localizer));

        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>rate-limit-status-panel</c>).</summary>
    public static string SurfaceId => RateLimitStatusRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public RateLimitStatusViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="RateLimitStatusSource"/> from the
    /// shared data layer (the host's P2-core dependencies).
    /// </summary>
    public static RateLimitStatusPanel Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        RateLimitStatusDiagnostics? diagnostics = null)
    {
        var source = new RateLimitStatusSource(api, engine, options);
        return new RateLimitStatusPanel(source, localizer, diagnostics);
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
        RateLimitPanelState.Loading => BuildLoading(),
        RateLimitPanelState.Error => BuildError(),
        RateLimitPanelState.Empty => BuildEmpty(),
        _ => _viewModel.Display.HasRows ? BuildRows() : BuildEmpty(),
    };

    private StackPanel BuildRows()
    {
        var column = new StackPanel { Spacing = 20 };
        AutomationProperties.SetName(column, _viewModel.Title);
        foreach (var row in _viewModel.Display.Rows)
        {
            column.Children.Add(BuildRow(row));
        }

        return column;
    }

    private static StackPanel BuildRow(RateLimitRowDisplay row)
    {
        var stack = new StackPanel { Spacing = 6 };

        var header = new Grid { ColumnSpacing = 12 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var name = new TextBlock
        {
            Text = row.Name,
            FontSize = 13,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(name, 0);

        var severity = new TextBlock
        {
            Text = row.SeverityLabel,
            FontSize = 12,
            Foreground = DisplayTokens.Brush(row.AccentBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
            TextWrapping = TextWrapping.NoWrap,
        };
        Grid.SetColumn(severity, 1);

        header.Children.Add(name);
        header.Children.Add(severity);
        stack.Children.Add(header);

        stack.Children.Add(new TsMetricBar
        {
            Value = row.Value,
            Max = row.Max,
            Label = row.WindowLabel,
            ValueText = row.UsageLabel,
            AccentBrushKey = row.AccentBrushKey,
        });

        if (row.Detail is not null || row.ResetLabel is not null)
        {
            var footer = new Grid { ColumnSpacing = 8, Padding = new Thickness(0, 2, 0, 0) };
            footer.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            if (row.Detail is { } detail)
            {
                var detailCaption = new Caption
                {
                    Value = detail,
                    MaxWidth = 560,
                    HorizontalAlignment = HorizontalAlignment.Left,
                };
                Grid.SetColumn(detailCaption, 0);
                footer.Children.Add(detailCaption);
            }

            if (row.ResetLabel is { } reset)
            {
                var resetCaption = new Caption
                {
                    Value = reset,
                    HorizontalAlignment = HorizontalAlignment.Right,
                };
                Grid.SetColumn(resetCaption, 1);
                footer.Children.Add(resetCaption);
            }

            stack.Children.Add(footer);
        }

        AutomationProperties.SetName(stack, row.AutomationName);
        return stack;
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
