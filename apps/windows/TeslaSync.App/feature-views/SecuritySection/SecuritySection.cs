using System.Globalization;
using Microsoft.UI.Dispatching;
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
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 vehicle-detail Security section surface — a parity port of
/// web/src/features/vehicles/components/vehicle-detail/SecuritySection.tsx. It reproduces the web
/// <c>GlassPanel</c> wrapper (the shield + "Security" header) over the responsive two / three / four-column grid
/// (the web <c>grid-cols-2 sm:grid-cols-3 lg:grid-cols-4</c>) of four <c>MetricCard</c>s — Locked (Yes / No, a
/// lock or unlock glyph, green when locked), Sentry Mode (Active / Off, an eye glyph, green when active), Doors
/// (the door-state label or "Closed", cyan when a door reads open) and Windows (the "{0} open" count or
/// "Closed", cyan when a window reads open) — each a subtle tile with a muted label, a bold value and a
/// tone-tinted status glyph chip. The web component is a pure child of the Vehicle-Detail page; the native
/// surface binds its own cache-then-network <see cref="SecuritySectionViewModel"/>, so it renders every state
/// the P2 contract requires — the skeleton while loading, a retry surface on a hard failure, the web "No
/// security data available" empty state when there is no security event, and a stale / offline freshness chip
/// over the grid otherwise. The view never performs HTTP. Every string resolves through the i18n facade and
/// every interactive element carries a Narrator name.
/// </summary>
public sealed partial class SecuritySection : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const int FadeDelayMs = 140;           // web FadeIn delay={0.14}
    private const double OuterPadding = 24;         // web GlassPanel p-6
    private const double HeaderSpacing = 16;        // web header mb-4
    private const double HeaderGap = 8;             // web gap-2 (shield ↔ title)
    private const double GridGap = 12;              // web gap-3
    private const double CardPadding = 12;          // web MetricCard p-3
    private const double CardRadius = 12;           // web rounded-xl
    private const double CardColumnSpacing = 4;     // web label mb-1 rhythm
    private const double ChipPadding = 6;           // web icon chip p-1.5
    private const double ChipRadius = 8;            // web rounded-lg
    private const double IconSize = 16;             // web h-4 w-4
    private const double HeaderIconSize = 16;       // web h-4 w-4 shield
    private const double SkeletonCardHeight = 96;
    private const double SkeletonHeaderWidth = 140;
    private const double SkeletonHeaderHeight = 16;
    private const double ChipBackgroundTint = 0.10; // web bg-neon-*/10
    private const double ChipBorderTint = 0.20;     // web ring-neon-*/20
    private const double NarrowBreakpoint = 600;
    private const double MediumBreakpoint = 1000;
    private const int CardCount = 4;
    private const int MaxColumns = 4;

    private readonly SecuritySectionViewModel _viewModel;
    private readonly SecuritySectionDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly TsFadeIn _fade = new() { DelayMs = FadeDelayMs };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer and (optional) diagnostics.</summary>
    /// <param name="source">The cache-then-network security source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SecuritySection(
        ISecuritySectionSource source,
        ILocalizer localizer,
        SecuritySectionDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new SecuritySectionDiagnostics();
        _viewModel = new SecuritySectionViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = _fade;
        AutomationProperties.SetName(this, _viewModel.AutomationName);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The canonical surface id (<c>security-section</c>).</summary>
    public static string SurfaceId => SecuritySectionRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public SecuritySectionViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="SecuritySectionSource"/> from the shared
    /// data layer (the host's P2-core dependencies), resolving the primary cached vehicle unless an explicit
    /// <paramref name="vehicleId"/> is supplied.
    /// </summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    /// <returns>A wired Security section surface.</returns>
    public static SecuritySection Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long? vehicleId = null,
        SecuritySectionDiagnostics? diagnostics = null)
    {
        var source = new SecuritySectionSource(vehicles, api, engine, options, vehicleId);
        return new SecuritySection(source, localizer, diagnostics);
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
        AutomationProperties.SetName(this, _viewModel.AutomationName);

        _fade.Content = _viewModel.State switch
        {
            SecuritySectionState.Loading => BuildLoading(),
            SecuritySectionState.Error => BuildErrorSurface(),
            _ => BuildPanel(),
        };
    }

    // ── Loaded / Empty / Stale / Offline (the GlassPanel composition) ─────────────────────────────────

    private TsGlassPanel BuildPanel()
    {
        var display = _viewModel.Display;

        var column = new StackPanel { Spacing = HeaderSpacing };
        column.Children.Add(BuildHeader());

        if (display.HasData)
        {
            column.Children.Add(BuildCardsGrid(display));
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = SecuritySectionRegistration.ShieldGlyph,
                Message = display.EmptyMessage,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }

        var panel = new TsGlassPanel { Padding = new Thickness(OuterPadding), Content = column };
        AutomationProperties.SetName(panel, display.AutomationName);
        return panel;
    }

    private Grid BuildHeader()
    {
        var header = new Grid { VerticalAlignment = VerticalAlignment.Center };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = HeaderGap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var titleIcon = new FontIcon
        {
            Glyph = SecuritySectionRegistration.ShieldGlyph,
            FontSize = HeaderIconSize,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // The shield is decorative; the title carries the accessible name, so keep the glyph out of the tree.
        AutomationProperties.SetAccessibilityView(titleIcon, AccessibilityView.Raw);
        titleRow.Children.Add(titleIcon);
        titleRow.Children.Add(new SectionTitle
        {
            Value = _viewModel.Title,
            VerticalAlignment = VerticalAlignment.Center,
        });
        Grid.SetColumn(titleRow, 0);
        header.Children.Add(titleRow);

        var actions = BuildActions();
        Grid.SetColumn(actions, 1);
        header.Children.Add(actions);

        return header;
    }

    private StackPanel BuildActions()
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = HeaderGap,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (_viewModel.State is SecuritySectionState.Stale or SecuritySectionState.Offline)
        {
            actions.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        actions.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.State == SecuritySectionState.Offline,
            VerticalAlignment = VerticalAlignment.Center,
        });

        actions.Children.Add(BuildRefreshButton());
        return actions;
    }

    private TsBadge BuildFreshnessChip(SecuritySectionState state)
    {
        bool offline = state == SecuritySectionState.Offline;
        string text = offline ? _viewModel.OfflineChip : _viewModel.StaleChip;

        var badge = new TsBadge
        {
            Status = offline ? StatusKind.Danger : StatusKind.Warning,
            Content = new TextBlock { Text = text, FontSize = 12 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    private TsButton BuildRefreshButton()
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = RefreshGlyph,
            VerticalAlignment = VerticalAlignment.Center,
            IsEnabled = !_viewModel.IsFetching,
        };
        AutomationProperties.SetName(button, _viewModel.RefreshLabel);
        button.Click += OnRefreshClick;
        return button;
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    // ── Card grid ─────────────────────────────────────────────────────────────────────────────────────

    private Grid BuildCardsGrid(SecuritySectionDisplay display)
    {
        var cards = new List<UIElement>(display.Cards.Count);
        foreach (var card in display.Cards)
        {
            cards.Add(BuildCard(card));
        }

        return BuildGrid(cards);
    }

    private static Border BuildCard(SecurityMetricCard card)
    {
        Brush accent = DisplayTokens.Brush(SecurityCardToneResources.BrushKey(card.Tone));

        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var textColumn = new StackPanel
        {
            Spacing = CardColumnSpacing,
            VerticalAlignment = VerticalAlignment.Top,
        };
        textColumn.Children.Add(new Caption { Value = card.Label });
        textColumn.Children.Add(new MetricValue { Value = card.Value });
        Grid.SetColumn(textColumn, 0);
        grid.Children.Add(textColumn);

        var chip = new Border
        {
            Background = Tint(accent, ChipBackgroundTint),
            BorderBrush = Tint(accent, ChipBorderTint),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(ChipRadius),
            Padding = new Thickness(ChipPadding),
            VerticalAlignment = VerticalAlignment.Top,
            Child = new FontIcon { Glyph = card.Glyph, FontSize = IconSize, Foreground = accent },
        };
        AutomationProperties.SetAccessibilityView(chip, AccessibilityView.Raw);
        Grid.SetColumn(chip, 1);
        grid.Children.Add(chip);

        var border = new Border
        {
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(CardRadius),
            Padding = new Thickness(CardPadding),
            Child = grid,
        };
        AutomationProperties.SetName(border, card.AutomationName);
        AutomationProperties.SetAccessibilityView(border, AccessibilityView.Content);
        return border;
    }

    private Grid BuildGrid(List<UIElement> children)
    {
        int columns = ColumnsForWidth(AvailableWidth());
        var grid = new Grid { ColumnSpacing = GridGap, RowSpacing = GridGap };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(children.Count / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < children.Count; i++)
        {
            var child = children[i];
            Grid.SetColumn((FrameworkElement)child, i % columns);
            Grid.SetRow((FrameworkElement)child, i / columns);
            grid.Children.Add(child);
        }

        return grid;
    }

    // ── Loading (skeleton chrome) ───────────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = HeaderSpacing };
        column.Children.Add(new TsSkeleton
        {
            BlockWidth = SkeletonHeaderWidth,
            BlockHeight = SkeletonHeaderHeight,
            ReduceMotion = MotionPreference.ReduceMotion,
        });

        var skeletons = new List<UIElement>(CardCount);
        for (int i = 0; i < CardCount; i++)
        {
            skeletons.Add(new TsSkeleton
            {
                BlockHeight = SkeletonCardHeight,
                Radius = CardRadius,
                ReduceMotion = MotionPreference.ReduceMotion,
                HorizontalAlignment = HorizontalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Stretch,
            });
        }

        column.Children.Add(BuildGrid(skeletons));

        var panel = new TsGlassPanel { Padding = new Thickness(OuterPadding), Content = column };
        LiveRegion.Configure(panel);
        LiveRegion.Announce(panel);
        AutomationProperties.SetName(
            panel,
            string.Format(CultureInfo.CurrentCulture, "{0}. {1}", _viewModel.Title, _viewModel.LoadingLabel));
        return panel;
    }

    // ── Error surface (web QueryError) ──────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildErrorSurface()
    {
        var error = new TsQueryError
        {
            Title = _viewModel.ErrorTitle,
            Message = _viewModel.ErrorMessage ?? _viewModel.ErrorTitle,
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;

        var panel = new TsGlassPanel { Padding = new Thickness(OuterPadding), Content = error };
        AutomationProperties.SetName(panel, error.Message);
        return panel;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private double AvailableWidth()
    {
        double width = _fade.ActualWidth;
        if (width <= 0)
        {
            width = ActualWidth;
        }

        return width;
    }

    private static int ColumnsForWidth(double width) => width switch
    {
        <= 0 => 2,
        < NarrowBreakpoint => 2,
        < MediumBreakpoint => 3,
        _ => MaxColumns,
    };

    private static bool IsGridState(SecuritySectionState state) =>
        state is SecuritySectionState.Loaded
            or SecuritySectionState.Stale
            or SecuritySectionState.Offline;

    private static Brush Tint(Brush brush, double opacity) =>
        brush is SolidColorBrush solid ? new SolidColorBrush(solid.Color) { Opacity = opacity } : brush;

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SecuritySectionAutomationPeer(this);

    private sealed class SecuritySectionAutomationPeer(SecuritySection owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((SecuritySection)Owner).ViewModel.AutomationName
                : name;
        }
    }
}
