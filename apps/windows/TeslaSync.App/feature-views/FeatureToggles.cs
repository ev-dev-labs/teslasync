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

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// The native WinUI 3 feature-toggles surface — a parity port of
/// web/src/features/settings/components/FeatureToggles.tsx. It composes the web's single <c>GlassPanel</c>: a
/// header (a Flag icon tile, the title, the subtitle, the "Synced {when}" caption and a Refresh button) above a
/// body that renders one row per Tesla feature flag the backend reports under
/// <c>GET /tesla/user/feature-config</c> — each row carrying the feature key, an Enabled/Disabled status badge
/// and the folded detail string. Every state renders — a loading skeleton, populated rows, the friendly empty
/// text, an explicit retry surface on hard failure, plus stale and offline freshness chips. The Refresh button
/// runs the mutation and surfaces a localized success/failure toast (forwarded to the host sink and announced
/// for accessibility). All data flows through the shared <see cref="FeatureTogglesViewModel"/>; the view never
/// performs HTTP. Every string resolves through the i18n facade and every interactive element carries a
/// Narrator name.
/// </summary>
public sealed partial class FeatureToggles : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const string FlagGlyph = "\uE7C1";    // Segoe Fluent — Flag (web lucide Flag)
    private const string EmptyGlyph = "\uE7C1";   // Segoe Fluent — Flag (the empty surface echoes the feature flag motif)

    private readonly FeatureTogglesViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly FeatureTogglesDiagnostics _diagnostics;
    private readonly Action<FeatureToggleToast>? _toastSink;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 8 };
    private readonly Grid _panelHost = new();

    private readonly TextBlock _toastBanner = new()
    {
        FontSize = 12,
        TextWrapping = TextWrapping.Wrap,
        Visibility = Visibility.Collapsed,
        Margin = new Thickness(0, 4, 0, 0),
    };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, diagnostics and (optional) toast sink.</summary>
    public FeatureToggles(
        IFeatureTogglesSource source,
        ILocalizer localizer,
        FeatureTogglesDiagnostics? diagnostics = null,
        Action<FeatureToggleToast>? toastSink = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new FeatureTogglesDiagnostics();
        _toastSink = toastSink;
        _viewModel = new FeatureTogglesViewModel(source, localizer, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, FeatureTogglesRegistration.Title(localizer));

        LiveRegion.Configure(_toastBanner, assertive: true);
        _root.Children.Add(_panelHost);
        _root.Children.Add(_toastBanner);
        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.ToastRequested += OnToastRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>feature-toggles</c>).</summary>
    public static string SurfaceId => FeatureTogglesRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public FeatureTogglesViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="FeatureTogglesSource"/> from the shared
    /// data layer (the host's P2-core dependencies).
    /// </summary>
    public static FeatureToggles Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        FeatureTogglesDiagnostics? diagnostics = null,
        Action<FeatureToggleToast>? toastSink = null)
    {
        var source = new FeatureTogglesSource(api, engine, options);
        return new FeatureToggles(source, localizer, diagnostics, toastSink);
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
        _viewModel.ToastRequested -= OnToastRequested;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void OnToastRequested(object? sender, FeatureToggleToast toast)
    {
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(() => ApplyToast(toast));
        }
        else
        {
            ApplyToast(toast);
        }
    }

    private void ApplyToast(FeatureToggleToast toast)
    {
        _toastSink?.Invoke(toast);

        string text = string.IsNullOrEmpty(toast.Description)
            ? toast.Title
            : string.Concat(toast.Title, " \u2014 ", toast.Description);
        _toastBanner.Text = text;
        _toastBanner.Foreground = DisplayTokens.Brush(
            toast.Kind == FeatureToggleToastKind.Error ? "TsColorDangerBrush" : "TsColorSuccessBrush");
        _toastBanner.Visibility = Visibility.Visible;
        AutomationProperties.SetName(_toastBanner, text);
        LiveRegion.Announce(_toastBanner);
    }

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
        _panelHost.Children.Clear();
        _panelHost.Children.Add(BuildPanel());
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
        var heading = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Top };
        heading.Children.Add(new PanelTitle { Value = _viewModel.Title });
        heading.Children.Add(new Text
        {
            Value = _viewModel.Subtitle,
            Foreground = DisplayTokens.TextMuted,
            MaxWidth = 520,
            HorizontalAlignment = HorizontalAlignment.Left,
        });

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Top,
        };
        titleRow.Children.Add(BuildIconTile());
        titleRow.Children.Add(heading);

        var controls = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        if (_viewModel.LastSyncedLabel is { } synced)
        {
            controls.Children.Add(new Caption
            {
                Value = synced,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        controls.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.IsError,
            VerticalAlignment = VerticalAlignment.Center,
        });
        controls.Children.Add(BuildRefreshButton());

        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(titleRow, 0);
        Grid.SetColumn(controls, 1);
        grid.Children.Add(titleRow);
        grid.Children.Add(controls);
        return grid;
    }

    private static Border BuildIconTile()
    {
        var icon = new FontIcon
        {
            Glyph = FlagGlyph,
            FontSize = 18,
            Foreground = DisplayTokens.Accent,
        };
        return new Border
        {
            Width = 40,
            Height = 40,
            CornerRadius = new CornerRadius(10),
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Child = icon,
            VerticalAlignment = VerticalAlignment.Top,
        };
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
        FeatureTogglesState.Loading => BuildLoading(),
        FeatureTogglesState.Error => BuildError(),
        FeatureTogglesState.Empty => BuildEmpty(),
        _ => _viewModel.Display.HasRows ? BuildTable() : BuildEmpty(),
    };

    private StackPanel BuildTable()
    {
        var table = new StackPanel { Spacing = 0 };
        AutomationProperties.SetName(table, _viewModel.Title);
        table.Children.Add(BuildHeaderRow());
        foreach (var row in _viewModel.Display.Rows)
        {
            table.Children.Add(BuildBodyRow(row));
        }

        return table;
    }

    private Border BuildHeaderRow()
    {
        var grid = NewRowGrid();
        var feature = HeaderCell(_viewModel.Display.FeatureHeader);
        var status = HeaderCell(_viewModel.Display.StatusHeader);
        var details = HeaderCell(_viewModel.Display.DetailsHeader);
        Grid.SetColumn(feature, 0);
        Grid.SetColumn(status, 1);
        Grid.SetColumn(details, 2);
        grid.Children.Add(feature);
        grid.Children.Add(status);
        grid.Children.Add(details);

        return new Border
        {
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
            Padding = new Thickness(0, 0, 0, 8),
            Child = grid,
        };
    }

    private static Border BuildBodyRow(FeatureToggleRowDisplay row)
    {
        var grid = NewRowGrid();

        var key = new TextBlock
        {
            Text = row.KeyText,
            FontSize = 13,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
            IsTextSelectionEnabled = true,
        };
        Grid.SetColumn(key, 0);

        var badge = new TsBadge
        {
            Status = row.StatusKind,
            Content = row.StatusLabel,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(badge, 1);

        var details = new TextBlock
        {
            Text = row.DetailsText,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
            IsTextSelectionEnabled = true,
        };
        ToolTipService.SetToolTip(details, row.DetailsText);
        Grid.SetColumn(details, 2);

        grid.Children.Add(key);
        grid.Children.Add(badge);
        grid.Children.Add(details);

        var rowBorder = new Border
        {
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
            Padding = new Thickness(0, 10, 0, 10),
            Child = grid,
        };
        AutomationProperties.SetName(rowBorder, row.AutomationName);
        return rowBorder;
    }

    private static Grid NewRowGrid()
    {
        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(3, GridUnitType.Star) });
        return grid;
    }

    private static TextBlock HeaderCell(string text) => new()
    {
        Text = text,
        FontSize = 12,
        FontWeight = FontWeights.Medium,
        Foreground = DisplayTokens.TextMuted,
        TextTrimming = TextTrimming.CharacterEllipsis,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private StackPanel BuildLoading()
    {
        var stack = new StackPanel { Spacing = 12, Padding = new Thickness(0, 4, 0, 0) };
        for (int i = 0; i < 4; i++)
        {
            stack.Children.Add(new TsSkeleton { BlockHeight = 16 });
        }

        AutomationProperties.SetName(stack, _viewModel.LoadingLabel);
        LiveRegion.Configure(stack);
        LiveRegion.Announce(stack);
        return stack;
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
