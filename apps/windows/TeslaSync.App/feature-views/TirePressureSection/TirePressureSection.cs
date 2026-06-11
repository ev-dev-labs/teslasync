using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 vehicle-detail Tire-Pressure feature surface — a parity port of
/// web/src/features/vehicles/components/vehicle-detail/TirePressureSection.tsx. It reproduces the web
/// <c>GlassPanel</c> chrome (a <c>CircleDot</c> icon + "Tire Pressure" title) wrapping a four-up grid of
/// per-corner tiles (front-left, front-right, rear-left, rear-right) — each tile a nested glass card showing the
/// corner label, the formatted pressure in the user's units and a status <c>Badge</c> (Normal / Low / Critical /
/// No Data). The web component is a pure child that renders the grid whenever its <c>tireData</c> prop is present
/// and otherwise draws the "No tire pressure data available" empty state; the native feature-view owns its
/// cache-then-network latest-snapshot read and therefore renders every state the P2 contract mandates — a
/// loading skeleton, the populated tiles, a friendly empty surface, an explicit retry surface on hard failure,
/// plus stale and offline freshness chips. All data flows through the shared
/// <see cref="TirePressureSectionViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class TirePressureSection : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double FadeInDelayMs = 200;
    private const double PanelPadding = 24;         // web p-6
    private const double RootSpacing = 16;          // web mb-4 under the title
    private const double TileSpacing = 16;          // web gap-4
    private const double TilePadding = 16;          // web p-4
    private const double TileLabelFontSize = 12;    // web text-xs
    private const double TileValueFontSize = 22;    // web text-2xl
    private const double BadgeFontSize = 12;
    private const double ChipFontSize = 12;
    private const double SkeletonHeight = 160;
    private const int GridColumns = 4;              // web grid-cols-2 sm:grid-cols-4

    private readonly TirePressureSectionViewModel _viewModel;
    private readonly TirePressureSectionDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsFadeIn _fade = new() { DelayMs = (int)FadeInDelayMs };
    private readonly TsGlassPanel _panel = new();
    private readonly StackPanel _root = new() { Spacing = RootSpacing };
    private readonly Grid _header = new();
    private readonly StackPanel _titleGroup = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly FontIcon _titleIcon = new()
    {
        Glyph = TirePressureSectionProjection.CircleDotGlyph,
        FontSize = 16,
    };

    private readonly SectionTitle _title = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly StackPanel _actions = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsBadge _freshnessChip = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _freshnessChipText = new() { FontSize = ChipFontSize };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _refresh = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = RefreshGlyph,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Border _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, units and diagnostics.</summary>
    /// <param name="source">The cache-then-network latest-snapshot source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    public TirePressureSection(
        ITirePressureSectionSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        TirePressureSectionDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new TirePressureSectionDiagnostics();
        _viewModel = new TirePressureSectionViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _refresh.Click += OnRefreshClick;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Content = _fade;
        Render();
    }

    /// <summary>The canonical surface id (<c>tire-pressure-section</c>).</summary>
    public static string SurfaceId => TirePressureSectionRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public TirePressureSectionViewModel ViewModel => _viewModel;

    /// <summary>The user's unit preference; reassigning re-projects the tiles in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="TirePressureSectionSource"/> from the
    /// shared data layer (the host's P2-core dependencies), scoped to <paramref name="vehicleId"/> or, when
    /// null, the primary vehicle.
    /// </summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network engine.</param>
    /// <param name="options">The shared API client options.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    /// <returns>A wired surface ready to host.</returns>
    public static TirePressureSection Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UnitPref? units = null,
        long? vehicleId = null,
        TirePressureSectionDiagnostics? diagnostics = null)
    {
        var source = new TirePressureSectionSource(vehicles, api, engine, options, vehicleId);
        return new TirePressureSection(source, localizer, units, diagnostics);
    }

    private void BuildChrome()
    {
        _titleIcon.Foreground = StatusBrush(StatusKind.Info);
        _titleGroup.Children.Add(_titleIcon);
        _titleGroup.Children.Add(_title);

        _freshnessChip.Content = _freshnessChipText;
        _actions.Children.Add(_freshnessChip);
        _actions.Children.Add(_freshness);
        _actions.Children.Add(_refresh);

        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_titleGroup, 0);
        Grid.SetColumn(_actions, 1);
        _header.Children.Add(_titleGroup);
        _header.Children.Add(_actions);

        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);

        _panel.Padding = new Thickness(PanelPadding);
        _panel.Content = _root;
        _fade.Content = _panel;
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

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _refresh.Click -= OnRefreshClick;
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
        var display = _viewModel.Display;
        var state = _viewModel.State;

        _title.Value = display.Title;
        AutomationProperties.SetName(this, display.PanelAutomationName);

        UpdateFreshness(state);
        _bodyHost.Child = BuildBody(display, state);
    }

    private void UpdateFreshness(TirePressureSectionState state)
    {
        bool showActions = state is not (TirePressureSectionState.Loading or TirePressureSectionState.Error);
        _actions.Visibility = showActions ? Visibility.Visible : Visibility.Collapsed;
        if (!showActions)
        {
            return;
        }

        bool stale = state == TirePressureSectionState.Stale;
        bool offline = state == TirePressureSectionState.Offline;
        if (stale || offline)
        {
            _freshnessChip.Visibility = Visibility.Visible;
            _freshnessChip.Status = offline ? StatusKind.Danger : StatusKind.Warning;
            _freshnessChipText.Text = offline ? _viewModel.OfflineChip : _viewModel.StaleChip;
            AutomationProperties.SetName(_freshnessChip, _freshnessChipText.Text);
        }
        else
        {
            _freshnessChip.Visibility = Visibility.Collapsed;
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = offline;
        AutomationProperties.SetName(_refresh, _viewModel.RefreshLabel);
    }

    private UIElement BuildBody(TirePressureSectionDisplay display, TirePressureSectionState state) => state switch
    {
        TirePressureSectionState.Loading => BuildLoading(),
        TirePressureSectionState.Error => BuildError(),
        TirePressureSectionState.Empty => BuildEmpty(),
        _ => _viewModel.HasData ? BuildContent(display) : BuildEmpty(),
    };

    private StackPanel BuildLoading()
    {
        var stack = new StackPanel { Spacing = TileSpacing };
        stack.Children.Add(new TsSkeleton
        {
            BlockHeight = SkeletonHeight,
            ReduceMotion = MotionPreference.ReduceMotion,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        });
        LiveRegion.Configure(stack);
        LiveRegion.Announce(stack);
        AutomationProperties.SetName(stack, _viewModel.LoadingLabel);
        return stack;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Title = _viewModel.ErrorTitle,
            Message = _viewModel.ErrorMessage ?? _viewModel.ErrorTitle,
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = TirePressureSectionProjection.CircleDotGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Grid BuildContent(TirePressureSectionDisplay display)
    {
        var tiles = display.Tiles;
        var grid = new Grid { ColumnSpacing = TileSpacing, RowSpacing = TileSpacing };
        for (int c = 0; c < GridColumns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(tiles.Count / (double)GridColumns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < tiles.Count; i++)
        {
            var tile = BuildTile(tiles[i]);
            Grid.SetColumn(tile, i % GridColumns);
            Grid.SetRow(tile, i / GridColumns);
            grid.Children.Add(tile);
        }

        AutomationProperties.SetName(grid, display.PanelAutomationName);
        return grid;
    }

    private static TsGlassPanel BuildTile(TirePressureSectionTile tile)
    {
        var label = new TextBlock
        {
            Text = tile.Label,
            FontSize = TileLabelFontSize,
            Foreground = DisplayTokens.TextMuted,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var value = new TextBlock
        {
            Text = tile.Value,
            FontSize = TileValueFontSize,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var badge = new TsBadge
        {
            Status = tile.BadgeStatus,
            HorizontalAlignment = HorizontalAlignment.Center,
            Content = new TextBlock
            {
                Text = tile.BadgeLabel,
                FontSize = BadgeFontSize,
                FontWeight = FontWeights.SemiBold,
            },
        };

        var column = new StackPanel
        {
            Orientation = Orientation.Vertical,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        column.Children.Add(label);
        column.Children.Add(value);
        column.Children.Add(badge);

        var card = new TsGlassPanel
        {
            Padding = new Thickness(TilePadding),
            Content = column,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetName(card, tile.AutomationName);
        return card;
    }

    private static Brush StatusBrush(StatusKind status)
    {
        string key = StatusResources.AccentBrushKey(status);
        if (Application.Current?.Resources is { } resources
            && resources.TryGetValue(key, out var value)
            && value is Brush brush)
        {
            return brush;
        }

        return DisplayTokens.TextSecondary;
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new TirePressureSectionAutomationPeer(this);

    private sealed class TirePressureSectionAutomationPeer(TirePressureSection owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((TirePressureSection)Owner).ViewModel.Title
                : name;
        }
    }
}
