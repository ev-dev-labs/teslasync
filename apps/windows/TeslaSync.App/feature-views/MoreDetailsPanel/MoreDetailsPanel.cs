using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 More Details surface — a parity port of
/// web/src/features/driving/components/drive-detail/MoreDetailsPanel.tsx. It composes the web's single
/// <c>FadeIn</c> + <c>GlassPanel</c>: an "More Details" <c>SectionTitle</c> (with the web Activity glyph)
/// above a primary six-cell grid (odometer from→to, range start→end, elevation gain↑/loss↓, energy consumed,
/// energy recovered, consumption) and — below a hairline divider — a secondary grid (avg power, the two
/// conditional cabin/ambient temperatures, min speed, battery used, net consumption). Every value is
/// converted to the user's display units at the render boundary (web <c>useUnits</c>) and every label
/// resolves through the i18n facade (web <c>useTranslation</c>). Every state renders — a loading skeleton,
/// the populated grids, a friendly empty surface (web's <c>hasMeaningfulDriveStats</c> gate), an explicit
/// retry surface on hard failure, plus stale and offline freshness chips. All data flows through the shared
/// <see cref="MoreDetailsPanelViewModel"/>; the view never performs HTTP. Every interactive element carries a
/// Narrator name.
/// </summary>
public sealed partial class MoreDetailsPanel : ContentControl, IDisposable
{
    private const int PrimaryCellCount = 6;
    private const int SecondaryCellCount = 6;
    private const double NarrowBreakpoint = 640;
    private const double WideBreakpoint = 1024;

    // web lucide Activity (pulse) → Segoe Fluent "Health" heartbeat glyph.
    private const string ActivityGlyph = "\uE95E";

    private readonly MoreDetailsPanelViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly MoreDetailsPanelDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 16 };
    private readonly TsGlassPanel _glass = new() { Padding = new Thickness(20) };
    private readonly TsFadeIn _fade = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, units and diagnostics.</summary>
    /// <param name="source">The cache-then-network data port.</param>
    /// <param name="localizer">The i18n facade every label flows through.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    public MoreDetailsPanel(
        IMoreDetailsPanelSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        MoreDetailsPanelDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new MoreDetailsPanelDiagnostics();
        _viewModel = new MoreDetailsPanelViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, MoreDetailsPanelRegistration.Title(localizer));

        _glass.Content = _root;
        _fade.Content = _glass;
        Content = _fade;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The canonical surface id (<c>more-details-panel</c>).</summary>
    public static string SurfaceId => MoreDetailsPanelRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public MoreDetailsPanelViewModel ViewModel => _viewModel;

    /// <summary>The user's unit preference; reassigning re-projects the cells in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="MoreDetailsPanelSource"/> from the
    /// shared data layer (the host's P2-core dependencies) for a specific drive.
    /// </summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network engine.</param>
    /// <param name="options">The API client options.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="driveId">The drive whose detail this surface reads.</param>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    /// <returns>A wired surface ready to host.</returns>
    public static MoreDetailsPanel Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        string driveId,
        UnitPref? units = null,
        MoreDetailsPanelDiagnostics? diagnostics = null)
    {
        var source = new MoreDetailsPanelSource(api, engine, options, driveId);
        return new MoreDetailsPanel(source, localizer, units, diagnostics);
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

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (e.PreviousSize.Width != e.NewSize.Width && IsGridState(_viewModel.State))
        {
            ScheduleRender();
        }
    }

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        SizeChanged -= OnSizeChanged;
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
        _root.Children.Add(BuildHeader());
        _root.Children.Add(BuildBody());
    }

    // ── Header (always visible, mirroring the web h3 with the Activity icon) ───────────────────────────

    private Grid BuildHeader()
    {
        var glyph = new FontIcon
        {
            Glyph = ActivityGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Brush("TsColorInfoBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);

        var title = new SectionTitle
        {
            Value = _viewModel.Title,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var left = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        left.Children.Add(glyph);
        left.Children.Add(title);

        var freshness = new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.IsError,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };

        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(left, 0);
        Grid.SetColumn(freshness, 1);
        grid.Children.Add(left);
        grid.Children.Add(freshness);
        return grid;
    }

    // ── Body (state switch — every state renders) ───────────────────────────────────────────────────

    private FrameworkElement BuildBody() => _viewModel.State switch
    {
        MoreDetailsState.Loading => BuildLoading(),
        MoreDetailsState.Error => BuildError(),
        MoreDetailsState.Empty => BuildEmpty(),
        _ => _viewModel.HasData ? BuildContent() : BuildEmpty(),
    };

    private StackPanel BuildContent()
    {
        var display = _viewModel.Display;
        double width = AvailableWidth();

        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(BuildGrid(display.Primary, PrimaryColumns(width)));
        stack.Children.Add(Divider());
        stack.Children.Add(BuildGrid(display.Secondary, SecondaryColumns(width)));
        return stack;
    }

    private static Grid BuildGrid(IReadOnlyList<MoreDetailsTile> tiles, int columns)
    {
        var grid = NewUniformGrid(tiles.Count, columns);
        for (int i = 0; i < tiles.Count; i++)
        {
            var cell = BuildTile(tiles[i]);
            Grid.SetColumn(cell, i % columns);
            Grid.SetRow(cell, i / columns);
            grid.Children.Add(cell);
        }

        return grid;
    }

    private static StackPanel BuildTile(MoreDetailsTile tile)
    {
        var column = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Center };

        column.Children.Add(new TextBlock
        {
            Text = tile.Label,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        column.Children.Add(BuildValueLine(tile.Value, DisplayTokens.Brush(tile.AccentBrushKey), tile.Unit));

        // Elevation cell carries a second (loss) line with its own accent.
        if (tile.SecondaryValue is { } secondary)
        {
            column.Children.Add(BuildValueLine(
                secondary,
                DisplayTokens.Brush(tile.SecondaryAccentBrushKey ?? tile.AccentBrushKey),
                string.Empty));
        }

        AutomationProperties.SetName(column, tile.AutomationName);
        return column;
    }

    private static StackPanel BuildValueLine(string value, Brush accent, string unit)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        row.Children.Add(new TextBlock
        {
            Text = value,
            FontSize = 18,
            FontWeight = FontWeights.SemiBold,
            Foreground = accent,
            TextAlignment = TextAlignment.Center,
        });

        if (!string.IsNullOrEmpty(unit))
        {
            row.Children.Add(new TextBlock
            {
                Text = unit,
                FontSize = 12,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Bottom,
                Margin = new Thickness(0, 0, 0, 2),
            });
        }

        return row;
    }

    private static Border Divider() => new()
    {
        Height = 1,
        Background = DisplayTokens.Border,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    // ── State bodies ──────────────────────────────────────────────────────────────────────────────

    private StackPanel BuildLoading()
    {
        double width = AvailableWidth();
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(BuildSkeletonGrid(PrimaryCellCount, PrimaryColumns(width)));
        stack.Children.Add(Divider());
        stack.Children.Add(BuildSkeletonGrid(SecondaryCellCount, SecondaryColumns(width)));

        AutomationProperties.SetName(stack, _viewModel.LoadingLabel);
        LiveRegion.Configure(stack);
        LiveRegion.Announce(stack);
        return stack;
    }

    private static Grid BuildSkeletonGrid(int cellCount, int columns)
    {
        var grid = NewUniformGrid(cellCount, columns);
        for (int i = 0; i < cellCount; i++)
        {
            var skeleton = new TsSkeleton
            {
                BlockHeight = 48,
                ReduceMotion = MotionPreference.ReduceMotion,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            };
            Grid.SetColumn(skeleton, i % columns);
            Grid.SetRow(skeleton, i / columns);
            grid.Children.Add(skeleton);
        }

        return grid;
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

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = ActivityGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Responsive grid helpers ─────────────────────────────────────────────────────────────────────

    private double AvailableWidth()
    {
        double width = ActualWidth;
        return width > 0 ? width : 0;
    }

    // web primary grid: base grid-cols-2, sm grid-cols-3, lg grid-cols-7 (6 cells → up to 6 wide).
    private static int PrimaryColumns(double width) => width switch
    {
        <= 0 => 3,
        < NarrowBreakpoint => 2,
        < WideBreakpoint => 3,
        _ => 6,
    };

    // web secondary grid: base grid-cols-2, sm grid-cols-4.
    private static int SecondaryColumns(double width) => width switch
    {
        <= 0 => 3,
        < NarrowBreakpoint => 2,
        _ => 4,
    };

    private static Grid NewUniformGrid(int cellCount, int columns)
    {
        int cols = Math.Max(1, columns);
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 16 };
        for (int c = 0; c < cols; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = Math.Max(1, (int)Math.Ceiling(cellCount / (double)cols));
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        return grid;
    }

    private static bool IsGridState(MoreDetailsState state) =>
        state is MoreDetailsState.Loaded or MoreDetailsState.Stale or MoreDetailsState.Offline or MoreDetailsState.Loading;

    protected override AutomationPeer OnCreateAutomationPeer() => new MoreDetailsPanelAutomationPeer(this);

    private sealed class MoreDetailsPanelAutomationPeer(MoreDetailsPanel owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((MoreDetailsPanel)Owner).ViewModel.Title
                : name;
        }
    }
}
