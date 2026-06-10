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

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Security-status cards surface — a parity port of
/// web/src/features/admin/components/security-access/SecurityStatusCards.tsx. It renders the web's six
/// always-visible status cards in a responsive 1 / 2 / 3-column grid (the web
/// <c>grid-cols-1 md:grid-cols-2 lg:grid-cols-3</c>): Lock Status, Sentry Mode, Doors, Windows, HomeLink and
/// Guest Mode. Each card is a glass panel with a tone-tinted status glyph, a title, a bold status value and a
/// small muted description — the native analogue of the web <see cref="TsGlassPanel"/> + lucide-icon + label
/// composition. Every state renders: the six-card skeleton chrome while loading, the populated grid (the cards
/// fall back to their safe defaults when the vehicle reports no security signals, the web <c>latest?.x</c>), an
/// explicit retry surface on hard failure, plus stale and offline freshness chips over the grid. All data flows
/// through the shared <see cref="SecurityStatusCardsViewModel"/>; the view never performs HTTP. Every string
/// resolves through the i18n facade and the surface carries a Narrator name.
/// </summary>
public sealed partial class SecurityStatusCards : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const int FadeDelayMs = 50;            // web FadeIn delay={0.1}
    private const double CardPadding = 16;         // web GlassPanel p-4
    private const double CardSpacing = 6;          // web mb-2 / mt-1 stack rhythm
    private const double HeaderGap = 12;           // web gap-3 (icon ↔ title)
    private const double GridGap = 16;             // web gap-4
    private const double IconSize = 22;            // web h-6 w-6
    private const double SkeletonCardHeight = 120; // web <Skeleton height={120} />
    private const double NarrowBreakpoint = 560;
    private const double MediumBreakpoint = 900;
    private const int SkeletonCardCount = 6;
    private const int MaxColumns = 3;

    private readonly SecurityStatusCardsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly SecurityStatusCardsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly StackPanel _header = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        Padding = new Thickness(0, 0, 0, 8),
    };

    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsFadeIn _body = new() { DelayMs = FadeDelayMs };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer and (optional) diagnostics.</summary>
    /// <param name="source">The cache-then-network security source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SecurityStatusCards(
        ISecurityStatusCardsSource source,
        ILocalizer localizer,
        SecurityStatusCardsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new SecurityStatusCardsDiagnostics();
        _viewModel = new SecurityStatusCardsViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Display.AutomationName);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The canonical surface id (<c>security-status-cards</c>).</summary>
    public static string SurfaceId => SecurityStatusCardsRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public SecurityStatusCardsViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="SecurityStatusCardsSource"/> from the
    /// shared data layer (the host's P2-core dependencies).
    /// </summary>
    public static SecurityStatusCards Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        SecurityStatusCardsDiagnostics? diagnostics = null)
    {
        var source = new SecurityStatusCardsSource(api, engine, options);
        return new SecurityStatusCards(source, localizer, diagnostics);
    }

    private void BuildChrome()
    {
        // The web cards are headerless; the native superset adds a right-aligned freshness row so the mandated
        // stale / offline / refreshing states have a visible affordance above the always-fading card grid.
        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_header, 0);
        Grid.SetRow(_body, 1);
        _root.Children.Add(_header);
        _root.Children.Add(_body);
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
        var display = _viewModel.Display;
        AutomationProperties.SetName(this, display.AutomationName);

        switch (_viewModel.State)
        {
            case SecurityStatusCardsState.Loading:
                Content = BuildLoading(display);
                break;

            case SecurityStatusCardsState.Error:
                Content = BuildError();
                break;

            default:
                UpdateHeader();
                _body.Content = BuildCardsGrid(display);
                Content = _root;
                break;
        }
    }

    // ── Header (freshness chip + stale/offline badge + refresh) ───────────────────────────────────────

    private void UpdateHeader()
    {
        _header.Children.Clear();

        if (_viewModel.State is SecurityStatusCardsState.Stale or SecurityStatusCardsState.Offline)
        {
            _header.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.State == SecurityStatusCardsState.Offline;
        _header.Children.Add(_freshness);

        _header.Children.Add(BuildRefreshButton());
    }

    private TsBadge BuildFreshnessChip(SecurityStatusCardsState state)
    {
        bool offline = state == SecurityStatusCardsState.Offline;
        string text = offline
            ? _localizer.GetString("translation.common.offline", "Offline")
            : _localizer.GetString("translation.common.stale", "Stale");

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
        AutomationProperties.SetName(button, _localizer.GetString("translation.common.refresh", "Refresh"));
        button.Click += OnRefreshClick;
        return button;
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    // ── Card grid ─────────────────────────────────────────────────────────────────────────────────────

    private Grid BuildCardsGrid(SecurityStatusCardsDisplay display)
    {
        var cards = new List<UIElement>(display.Cards.Count);
        foreach (var card in display.Cards)
        {
            cards.Add(BuildCard(card));
        }

        return BuildGrid(cards);
    }

    private static TsGlassPanel BuildCard(SecurityStatusCard card)
    {
        Brush? tone = ToneBrush(card.Tone);

        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = HeaderGap,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = card.Glyph,
            FontSize = IconSize,
            VerticalAlignment = VerticalAlignment.Center,
        };
        if (tone is not null)
        {
            icon.Foreground = tone;
        }

        // The glyph is decorative; the card's value is already in the Narrator name, so keep the icon out of
        // the accessibility tree to avoid a duplicate, label-less announcement.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        header.Children.Add(icon);
        header.Children.Add(new PanelTitle { Value = card.Title, VerticalAlignment = VerticalAlignment.Center });

        var value = new MetricValue { Value = card.Value };
        if (tone is not null)
        {
            value.Foreground = tone;
        }

        var column = new StackPanel { Spacing = CardSpacing };
        column.Children.Add(header);
        column.Children.Add(value);
        column.Children.Add(new Caption { Value = card.Description });

        var glass = new TsGlassPanel { Padding = new Thickness(CardPadding), Content = column };
        AutomationProperties.SetName(glass, card.AutomationName);
        AutomationProperties.SetAccessibilityView(glass, AccessibilityView.Content);
        return glass;
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

    // ── State bodies ─────────────────────────────────────────────────────────────────────────────────

    private Grid BuildLoading(SecurityStatusCardsDisplay display)
    {
        var skeletons = new List<UIElement>(SkeletonCardCount);
        for (int i = 0; i < SkeletonCardCount; i++)
        {
            skeletons.Add(new TsSkeleton
            {
                BlockHeight = SkeletonCardHeight,
                HorizontalAlignment = HorizontalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Stretch,
                ReduceMotion = MotionPreference.ReduceMotion,
            });
        }

        var grid = BuildGrid(skeletons);
        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);
        AutomationProperties.SetName(
            grid,
            string.Format(
                CultureInfo.CurrentCulture,
                "{0}. {1}",
                display.AutomationName,
                _localizer.GetString("translation.common.loading", "Loading...")));
        return grid;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage
                ?? _localizer.GetString("translation.admin.security.error", "Couldn't load security status"),
            ActionText = _localizer.GetString("translation.common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private static Brush? ToneBrush(SecurityTone tone)
    {
        string key = SecurityToneResources.BrushKey(tone);
        return Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush ? brush : null;
    }

    private double AvailableWidth()
    {
        double width = _body.ActualWidth;
        if (width <= 0)
        {
            width = ActualWidth;
        }

        return width;
    }

    private static int ColumnsForWidth(double width) => width switch
    {
        <= 0 => 1,
        < NarrowBreakpoint => 1,
        < MediumBreakpoint => 2,
        _ => MaxColumns,
    };

    private static bool IsGridState(SecurityStatusCardsState state) =>
        state is SecurityStatusCardsState.Loaded
            or SecurityStatusCardsState.Empty
            or SecurityStatusCardsState.Stale
            or SecurityStatusCardsState.Offline;

    protected override AutomationPeer OnCreateAutomationPeer() => new SecurityStatusCardsAutomationPeer(this);

    private sealed class SecurityStatusCardsAutomationPeer(SecurityStatusCards owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((SecurityStatusCards)Owner).ViewModel.Display.AutomationName
                : name;
        }
    }
}
