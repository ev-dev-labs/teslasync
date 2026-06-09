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
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>StatHeroSlide</c> feature surface — a parity port of
/// web/src/features/analytics/components/review/StatHeroSlide.tsx. It renders the web layout: a centred hero
/// column of a large emoji, a count-up headline number, a unit sub-line and a fun comparison line, each
/// entering with a staggered fade (web framer-motion spring + delayed transitions). The web component is
/// presentational (it receives a resolved <c>YearReview</c> and a <c>field</c>); the native feature view binds
/// the same <c>GET /analytics/year-review</c> data through the shared <see cref="StatHeroSlideViewModel"/> so
/// every state — loading (skeleton), loaded, empty, error (retry), stale (stale chip), offline (offline chip) —
/// renders as a visible surface, never hidden. All value derivation, unit conversion and i18n happen in the
/// WinUI-free <see cref="StatHeroProjection"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade, the count-up honours the system reduce-motion setting, and the surface carries a Narrator name.
/// </summary>
public sealed partial class StatHeroSlide : ContentControl, IDisposable
{
    private const string EmptyGlyph = "\uE9D2";   // Segoe Fluent — trending (year-in-review)
    private const double EmojiFontSize = 64;
    private const double NumberHeight = 84;
    private const double UnitFontSize = 22;
    private const double ComparisonFontSize = 16;
    private const double HeroMaxWidth = 520;
    private const double ComparisonMaxWidth = 420;
    private const double CountUpSeconds = 1.5;

    // Staggered entrance delays mirroring the web transitions (number 0.3s, unit 0.6s, comparison 0.9s).
    private const int EmojiDelayMs = 0;
    private const int NumberDelayMs = 300;
    private const int UnitDelayMs = 600;
    private const int ComparisonDelayMs = 900;
    private const int EntranceDurationMs = 420;

    private readonly StatHeroSlideViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly StatHeroSlideDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly TsDataFreshness _freshness = new()
    {
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Top,
        Margin = new Thickness(0, 0, 4, 0),
    };

    private readonly Border _bodyHost = new()
    {
        HorizontalAlignment = HorizontalAlignment.Stretch,
        VerticalAlignment = VerticalAlignment.Stretch,
    };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, field, units and diagnostics.</summary>
    /// <param name="source">The cache-then-network data port the view-model binds to.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="field">The headline statistic this slide renders (web <c>field</c> prop).</param>
    /// <param name="units">The user's unit preference, or <see langword="null"/> for metric.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public StatHeroSlide(
        IStatHeroSlideSource source,
        ILocalizer localizer,
        StatHeroField field,
        UnitPref? units = null,
        StatHeroSlideDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new StatHeroSlideDiagnostics();
        _viewModel = new StatHeroSlideViewModel(source, localizer, field, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.SurfaceName);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>StatHeroSlide</c>).</summary>
    public static string Slug => StatHeroSlideRegistration.Slug;

    /// <summary>The headline statistic this slide renders.</summary>
    public StatHeroField Field => _viewModel.Field;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public StatHeroSlideViewModel ViewModel => _viewModel;

    /// <summary>The user's unit preference; reassigning re-projects the value in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="StatHeroSlideSource"/> from the shared
    /// data layer (the year-in-review host's P2-core dependencies), accepting the web string <c>field</c>.
    /// </summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope the read to.</param>
    /// <param name="api">The generated contract API client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The API client options carrying the JSON serializer settings.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="field">The web field id (<c>distance</c> / <c>energy</c>).</param>
    /// <param name="units">The user's unit preference, or <see langword="null"/> for metric.</param>
    /// <param name="vehicleId">An explicit vehicle id, or <see langword="null"/> for the primary vehicle.</param>
    /// <param name="year">The calendar year, or <see langword="null"/> for the current year.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <returns>A ready-to-host surface bound to the live data layer.</returns>
    public static StatHeroSlide Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        string field,
        UnitPref? units = null,
        long? vehicleId = null,
        int? year = null,
        StatHeroSlideDiagnostics? diagnostics = null)
    {
        var resolved = StatHeroFields.FromKey(field);
        var source = new StatHeroSlideSource(vehicles, api, engine, options, vehicleId, year);
        return new StatHeroSlide(source, localizer, resolved, units, diagnostics);
    }

    private void BuildChrome()
    {
        _root.Children.Add(_bodyHost);
        _root.Children.Add(_freshness);
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
            case StatHeroState.Loading:
                Content = BuildLoading();
                break;

            case StatHeroState.Error:
                Content = BuildError();
                break;

            default:
                UpdateFreshness();
                _bodyHost.Child = _viewModel.HasData ? BuildHero(_viewModel.Display) : (UIElement)BuildEmpty();
                Content = _root;
                break;
        }
    }

    private void UpdateFreshness()
    {
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
    }

    private static StackPanel BuildHero(StatHeroDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 0,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            MaxWidth = HeroMaxWidth,
            Padding = new Thickness(32, 24, 32, 24),
        };

        var emoji = new TextBlock
        {
            Text = display.Emoji,
            FontSize = EmojiFontSize,
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(emoji, AccessibilityView.Raw);
        column.Children.Add(Fade(emoji, EmojiDelayMs, new Thickness(0, 0, 0, 16)));

        var number = new TsAnimatedNumber
        {
            Value = display.Value,
            Precision = display.Decimals,
            DurationSeconds = CountUpSeconds,
            ReduceMotion = MotionPreference.ReduceMotion,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(number, AccessibilityView.Raw);
        var numberBox = new Viewbox
        {
            Child = number,
            Height = NumberHeight,
            Stretch = Stretch.Uniform,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        column.Children.Add(Fade(numberBox, NumberDelayMs, new Thickness(0)));

        if (!string.IsNullOrEmpty(display.Unit))
        {
            var unit = new TextBlock
            {
                Text = display.Unit,
                FontSize = UnitFontSize,
                Foreground = DisplayTokens.TextSecondary,
                TextAlignment = TextAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Center,
            };
            column.Children.Add(Fade(unit, UnitDelayMs, new Thickness(0, 12, 0, 0)));
        }

        if (!string.IsNullOrEmpty(display.Comparison))
        {
            var comparison = new TextBlock
            {
                Text = display.Comparison,
                FontSize = ComparisonFontSize,
                Foreground = DisplayTokens.TextMuted,
                TextWrapping = TextWrapping.Wrap,
                TextAlignment = TextAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Center,
                MaxWidth = ComparisonMaxWidth,
            };
            column.Children.Add(Fade(comparison, ComparisonDelayMs, new Thickness(0, 20, 0, 0)));
        }

        AutomationProperties.SetName(column, display.AutomationName);
        return column;
    }

    private static TsFadeIn Fade(UIElement child, int delayMs, Thickness margin) => new()
    {
        Content = child,
        DelayMs = delayMs,
        DurationMs = EntranceDurationMs,
        Margin = margin,
        HorizontalAlignment = HorizontalAlignment.Center,
        HorizontalContentAlignment = HorizontalAlignment.Center,
    };

    private StackPanel BuildLoading()
    {
        var column = new StackPanel
        {
            Spacing = 16,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Padding = new Thickness(32),
        };
        column.Children.Add(new TsSkeleton { BlockWidth = 72, BlockHeight = 72, Radius = 18, HorizontalAlignment = HorizontalAlignment.Center });
        column.Children.Add(new TsSkeleton { BlockWidth = 220, BlockHeight = 64, Radius = 10, HorizontalAlignment = HorizontalAlignment.Center });
        column.Children.Add(new TsSkeleton { BlockWidth = 120, BlockHeight = 20, HorizontalAlignment = HorizontalAlignment.Center });
        column.Children.Add(new TsSkeleton { BlockWidth = 280, BlockHeight = 16, HorizontalAlignment = HorizontalAlignment.Center });

        AutomationProperties.SetName(column, _viewModel.LoadingLabel);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("yearReview.statHero.error", "Couldn't load your year in review"),
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = EmptyGlyph,
        Title = _viewModel.SurfaceName,
        Message = _viewModel.EmptyMessage,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new StatHeroSlideAutomationPeer(this);

    private sealed class StatHeroSlideAutomationPeer(StatHeroSlide owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((StatHeroSlide)Owner).ViewModel.SurfaceName : name;
        }
    }
}
