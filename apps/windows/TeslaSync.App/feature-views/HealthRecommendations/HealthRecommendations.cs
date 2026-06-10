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
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Health Recommendations surface — a parity port of
/// web/src/features/driving/components/drivetrain-health/HealthRecommendations.tsx. It renders the drivetrain
/// health tips derived from the vehicle's overall health level inside a glass panel: a shield-led header
/// ("Health Recommendations") plus one accent-tinted row per tip (danger for high, warning for medium, info
/// for low — web parity), each with a leading glyph and wrapping body text. Every state renders — a loading
/// skeleton, the populated list, a friendly empty surface when no drivetrain-health data exists, an explicit
/// retry surface on hard failure, plus stale and offline freshness chips. All data flows through the shared
/// <see cref="HealthRecommendationsViewModel"/>; the view never performs HTTP. Every row carries a Narrator
/// name that prefixes the tip with its priority.
/// </summary>
public sealed partial class HealthRecommendations : ContentControl, IDisposable
{
    private const int LoadingSkeletonRows = 6;
    private const string ShieldGlyph = "\uEA18";   // Shield (lucide Shield)
    private const string AlertGlyph = "\uE7BA";    // Warning triangle (lucide AlertTriangle)
    private const string TrendGlyph = "\uE9D2";    // Trending up (lucide TrendingUp)

    private readonly HealthRecommendationsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly HealthRecommendationsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsGlassPanel _panel = new();
    private readonly Grid _root = new();
    private readonly Grid _header = new();
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Border _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer and diagnostics.</summary>
    /// <param name="source">The cache-then-network drivetrain-health source.</param>
    /// <param name="localizer">The i18n facade used for every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    public HealthRecommendations(
        IHealthRecommendationsSource source,
        ILocalizer localizer,
        HealthRecommendationsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new HealthRecommendationsDiagnostics();
        _viewModel = new HealthRecommendationsViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>health-recommendations</c>).</summary>
    public static string SurfaceId => HealthRecommendationsRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public HealthRecommendationsViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="HealthRecommendationsSource"/> from the
    /// shared data layer (the host's P2-core dependencies), scoped to the primary (or an explicit) vehicle.
    /// </summary>
    /// <param name="vehicles">Resolves the vehicle to scope the read to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network engine.</param>
    /// <param name="options">The shared API client options.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="vehicleId">An explicit vehicle id; null uses the primary cached vehicle.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    /// <returns>A wired surface ready to add to the visual tree.</returns>
    public static HealthRecommendations Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long? vehicleId = null,
        HealthRecommendationsDiagnostics? diagnostics = null)
    {
        var source = new HealthRecommendationsSource(vehicles, api, engine, options, vehicleId);
        return new HealthRecommendations(source, localizer, diagnostics);
    }

    private void BuildChrome()
    {
        var shield = new FontIcon
        {
            Glyph = ShieldGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Brush("TsColorInfoBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(shield, AccessibilityView.Raw);

        var title = new TextBlock
        {
            Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            CharacterSpacing = 80,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        AutomationProperties.SetAccessibilityView(title, AccessibilityView.Raw);

        var heading = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        heading.Children.Add(shield);
        heading.Children.Add(title);

        _header.Padding = new Thickness(0, 0, 0, 12);
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(heading, 0);
        Grid.SetColumn(_freshness, 1);
        _header.Children.Add(heading);
        _header.Children.Add(_freshness);

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        _root.Padding = new Thickness(24);
        Grid.SetRow(_header, 0);
        Grid.SetRow(_bodyHost, 1);
        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);

        // The web component IS the GlassPanel (`<GlassPanel className="p-6">`); wrap the header + body in the
        // tokenized translucent surface so the native surface carries the same card chrome in every state.
        _panel.Content = _root;
        Content = _panel;
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
        // The glass panel + header are always present (web parity); only the body swaps per state, so the
        // shield header, title and freshness chip never disappear between loading, content, empty and error.
        UpdateHeader();
        _bodyHost.Child = _viewModel.State switch
        {
            HealthRecommendationsState.Loading => BuildLoading(),
            HealthRecommendationsState.Error => BuildError(),
            _ => BuildBody(),
        };
    }

    private void UpdateHeader()
    {
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
    }

    private UIElement BuildBody()
    {
        var display = _viewModel.Display;
        return display.HasData ? BuildList(display) : BuildEmpty();
    }

    private StackPanel BuildList(HealthRecommendationsDisplay display)
    {
        var stack = new StackPanel { Spacing = 12 };
        foreach (var recommendation in display.Recommendations)
        {
            stack.Children.Add(BuildRow(recommendation));
        }

        AutomationProperties.SetName(stack, _viewModel.Title);
        return stack;
    }

    private static Border BuildRow(HealthRecommendation recommendation)
    {
        Brush accent = AccentFor(recommendation.Priority);

        var glyph = new FontIcon
        {
            Glyph = GlyphFor(recommendation.Priority),
            FontSize = 14,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 2, 0, 0),
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);

        var text = new TextBlock
        {
            Text = recommendation.Text,
            FontSize = 13,
            TextWrapping = TextWrapping.Wrap,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(text, AccessibilityView.Raw);

        var content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
        };
        content.Children.Add(glyph);
        content.Children.Add(text);

        var row = new Border
        {
            Child = content,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = BorderFor(recommendation.Priority),
            BorderThickness = new Thickness(1),
            Background = BackgroundFor(recommendation.Priority),
            Padding = new Thickness(16, 12, 16, 12),
        };
        AutomationProperties.SetName(row, recommendation.AutomationName);
        return row;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage
                ?? _localizer.GetString("drivetrain.recommendations.error", "Couldn't load health recommendations"),
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
        Title = _viewModel.Title,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private StackPanel BuildLoading()
    {
        var stack = new StackPanel { Spacing = 12, Padding = new Thickness(0, 4, 0, 4) };
        for (int i = 0; i < LoadingSkeletonRows; i++)
        {
            stack.Children.Add(new TsSkeleton { BlockHeight = 52 });
        }

        AutomationProperties.SetName(stack, _viewModel.LoadingLabel);
        LiveRegion.Configure(stack);
        LiveRegion.Announce(stack);
        return stack;
    }

    private static string GlyphFor(RecommendationPriority priority) =>
        priority == RecommendationPriority.Low ? TrendGlyph : AlertGlyph;

    private static Brush AccentFor(RecommendationPriority priority) => priority switch
    {
        RecommendationPriority.High => DisplayTokens.Brush("TsColorDangerBrush"),
        RecommendationPriority.Medium => DisplayTokens.Brush("TsColorWarningBrush"),
        _ => DisplayTokens.Brush("TsColorInfoBrush"),
    };

    private static Brush BorderFor(RecommendationPriority priority) => priority switch
    {
        RecommendationPriority.High => Tint(DisplayTokens.Brush("TsColorDangerBrush"), 0x55, DisplayTokens.Border),
        RecommendationPriority.Medium => Tint(DisplayTokens.Brush("TsColorWarningBrush"), 0x55, DisplayTokens.Border),
        _ => DisplayTokens.Border,
    };

    private static Brush BackgroundFor(RecommendationPriority priority) => priority switch
    {
        RecommendationPriority.High => Tint(DisplayTokens.Brush("TsColorDangerBrush"), 0x14, DisplayTokens.Surface),
        RecommendationPriority.Medium => Tint(DisplayTokens.Brush("TsColorWarningBrush"), 0x14, DisplayTokens.Surface),
        _ => DisplayTokens.Surface,
    };

    // Web parity: the high/medium rows carry a translucent accent border + fill (border-neon-{c}/20,
    // bg-neon-{c}/5). Derive that from the resolved accent colour so light/dark/high-contrast all flow from the
    // token; if the token didn't resolve to a solid colour, fall back to the neutral border/surface token.
    private static Brush Tint(Brush source, byte alpha, Brush fallback) =>
        source is SolidColorBrush solid
            ? new SolidColorBrush(Windows.UI.Color.FromArgb(alpha, solid.Color.R, solid.Color.G, solid.Color.B))
            : fallback;

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new HealthRecommendationsAutomationPeer(this);

    private sealed class HealthRecommendationsAutomationPeer(HealthRecommendations owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((HealthRecommendations)Owner).ViewModel.Title
                : name;
        }
    }
}
