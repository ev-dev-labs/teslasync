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
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Savings slide — a parity port of
/// web/src/features/analytics/components/review/SavingsSlide.tsx. It renders the Year-in-Review savings story:
/// the 💰 hero, the "You saved" eyebrow, the animated hero savings figure that counts up to the amount saved
/// versus a gas car, the "vs. driving a gas car" caption, the gas-versus-electric comparison bars (the gas bar
/// full, the electric bar proportional to its share of the gas-equivalent cost) and the "that's N cups of
/// coffee!" note. Every state renders — a loading skeleton, the populated slide, a friendly empty surface when
/// the year has no review, an explicit retry surface on hard failure, plus stale and offline freshness chips.
/// All data flows through the shared <see cref="SavingsSlideViewModel"/>; the view never performs HTTP. The
/// entrance staggers (web <c>motion</c>) and the count-up both honour the system reduce-motion setting, and
/// every figure carries a Narrator name.
/// </summary>
public sealed partial class SavingsSlide : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double CountUpSeconds = 1.5;     // web AnimatedNumber duration
    private const double HeroEmojiSize = 56;
    private const double HeroNumberSize = 56;
    private const double ComparisonMaxWidth = 320; // web max-w-xs

    // Emoji accents (rendered via the system emoji font, decorative / Narrator-skipped) mapping the web's
    // lucide icons: 💰 hero, ⛽ Fuel, ⚡ Zap, 💵 DollarSign.
    private const string MoneyEmoji = "\U0001F4B0";
    private const string FuelEmoji = "\u26FD";
    private const string BoltEmoji = "\u26A1";
    private const string DollarEmoji = "\U0001F4B5";

    private const string SuccessBrushKey = "TsColorSuccessBrush";
    private const string DangerBrushKey = "TsColorDangerBrush";
    private const string TrackBrushKey = "TsColorBorderBrush";

    private readonly SavingsSlideViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly SavingsSlideDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Border _headerHost = new() { Padding = new Thickness(0, 0, 0, 8) };
    private readonly Border _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private bool _animated;
    private double _animatedValue;

    /// <summary>Creates the surface over its data source, localizer, diagnostics, currency and (optional) clock.</summary>
    public SavingsSlide(
        ISavingsSlideSource source,
        ILocalizer localizer,
        SavingsSlideDiagnostics? diagnostics = null,
        string? currencySymbol = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new SavingsSlideDiagnostics();
        _viewModel = new SavingsSlideViewModel(source, localizer, currencySymbol, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        MinHeight = 320;
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>savings-slide</c>).</summary>
    public static string SurfaceId => SavingsSlideRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public SavingsSlideViewModel ViewModel => _viewModel;

    /// <summary>The currency symbol used for the monetary figures; reassigning re-projects the snapshot.</summary>
    public string CurrencySymbol
    {
        get => _viewModel.CurrencySymbol;
        set => _viewModel.CurrencySymbol = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="SavingsSlideSource"/> from the shared
    /// data layer (the host's P2-core dependencies). Defaults to the current calendar year, mirroring the web
    /// Year-in-Review route default.
    /// </summary>
    public static SavingsSlide Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        SavingsSlideDiagnostics? diagnostics = null,
        int? year = null,
        string? vehicleId = null,
        string? currencySymbol = null)
    {
        var source = new SavingsSlideSource(api, engine, options, year ?? DateTimeOffset.Now.Year, vehicleId);
        return new SavingsSlide(source, localizer, diagnostics, currencySymbol);
    }

    private void BuildChrome()
    {
        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_headerHost, 0);
        Grid.SetRow(_bodyHost, 1);
        _root.Children.Add(_headerHost);
        _root.Children.Add(_bodyHost);
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
        switch (_viewModel.State)
        {
            case SavingsSlideState.Loading:
                AutomationProperties.SetName(this, _viewModel.LoadingLabel);
                Content = BuildLoading();
                break;

            case SavingsSlideState.Error:
                AutomationProperties.SetName(this, _viewModel.ErrorTitle);
                Content = BuildError();
                break;

            case SavingsSlideState.Empty:
                AutomationProperties.SetName(this, _viewModel.Title);
                _headerHost.Child = BuildHeader();
                _bodyHost.Child = BuildEmpty();
                Content = _root;
                break;

            default:
                AutomationProperties.SetName(this, _viewModel.Display.SummaryAutomationName);
                _headerHost.Child = BuildHeader();
                _bodyHost.Child = BuildSlide(_viewModel.Display);
                Content = _root;
                break;
        }
    }

    // ── Header (freshness chip + stale/offline badge + refresh) ───────────────────────────────────────

    private StackPanel BuildHeader()
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (_viewModel.State is SavingsSlideState.Stale or SavingsSlideState.Offline)
        {
            actions.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        actions.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.State == SavingsSlideState.Offline,
            VerticalAlignment = VerticalAlignment.Center,
        });

        actions.Children.Add(BuildRefreshButton());
        return actions;
    }

    private TsBadge BuildFreshnessChip(SavingsSlideState state)
    {
        bool offline = state == SavingsSlideState.Offline;
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
        };
        AutomationProperties.SetName(button, _localizer.GetString("translation.common.refresh", "Refresh"));
        button.Click += OnRefreshClick;
        return button;
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    // ── Loaded slide ──────────────────────────────────────────────────────────────────────────────────

    private TsStaggerContainer BuildSlide(SavingsDisplay display)
    {
        var stagger = new TsStaggerContainer
        {
            Spacing = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(16),
        };

        stagger.Add(Emoji(MoneyEmoji, HeroEmojiSize));
        stagger.Add(BuildEyebrow(display.YouSavedLabel));
        stagger.Add(BuildHeroNumber(display));
        stagger.Add(BuildCaption(display.VsGasLabel));
        stagger.Add(BuildComparison(display));

        AutomationProperties.SetName(stagger, display.SummaryAutomationName);
        return stagger;
    }

    private static TextBlock Emoji(string glyph, double size)
    {
        var emoji = new TextBlock
        {
            Text = glyph,
            FontSize = size,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(emoji, AccessibilityView.Raw);
        return emoji;
    }

    private static TextBlock BuildEyebrow(string text) => new()
    {
        Text = text,
        FontSize = 15,
        FontWeight = FontWeights.SemiBold,
        CharacterSpacing = 80,
        Foreground = DisplayTokens.TextSecondary,
        HorizontalAlignment = HorizontalAlignment.Center,
        TextAlignment = TextAlignment.Center,
    };

    private static TextBlock BuildCaption(string text) => new()
    {
        Text = text,
        FontSize = 13,
        Foreground = DisplayTokens.TextMuted,
        HorizontalAlignment = HorizontalAlignment.Center,
        TextAlignment = TextAlignment.Center,
    };

    private TextBlock BuildHeroNumber(SavingsDisplay display)
    {
        var text = new TextBlock
        {
            Text = display.SavingsValueText,
            FontSize = HeroNumberSize,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.Brush(SuccessBrushKey),
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };
        AutomationProperties.SetName(text, display.SavingsAutomationName);

        double target = display.SavingsValue;
        string symbol = display.CurrencySymbol;

        // Animate the count-up only when motion is allowed and the value is new (avoid re-animating on an
        // incidental rebuild). Reduced motion / a repeat render snaps straight to the final figure, matching
        // the shared AnimatedNumberModel's reduce-motion contract and the web AnimatedNumber.
        bool reduce = MotionPreference.ReduceMotion;
        bool shouldAnimate = !reduce && (!_animated || !AreClose(_animatedValue, target));
        if (!shouldAnimate)
        {
            return text;
        }

        _animated = true;
        _animatedValue = target;

        var model = new AnimatedNumberModel(0, target, CountUpSeconds, reduceMotion: false);
        var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(16) };
        var started = DateTimeOffset.MinValue;

        void Stop() => timer.Stop();

        text.Loaded += (_, _) =>
        {
            started = DateTimeOffset.Now;
            text.Text = FormatMoney(0, symbol);
            timer.Start();
        };
        text.Unloaded += (_, _) => Stop();
        timer.Tick += (_, _) =>
        {
            double elapsed = (DateTimeOffset.Now - started).TotalSeconds;
            if (model.IsComplete(elapsed))
            {
                text.Text = display.SavingsValueText;
                Stop();
                return;
            }

            text.Text = FormatMoney(model.ValueAt(elapsed), symbol);
        };

        return text;
    }

    private static StackPanel BuildComparison(SavingsDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 16,
            MaxWidth = ComparisonMaxWidth,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        column.Children.Add(BuildComparisonBar(
            FuelEmoji, display.GasCostLabel, display.GasCostValueText, DangerBrushKey, 1.0, display.GasBarAutomationName));
        column.Children.Add(BuildComparisonBar(
            BoltEmoji, display.ElectricCostLabel, display.ElectricCostValueText, SuccessBrushKey, display.ElectricFraction, display.ElectricBarAutomationName));
        column.Children.Add(BuildNote(display.SavingsNote));

        return column;
    }

    private static StackPanel BuildComparisonBar(
        string glyph,
        string label,
        string valueText,
        string accentBrushKey,
        double fraction,
        string automationName)
    {
        var accent = DisplayTokens.Brush(accentBrushKey);

        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var icon = new TextBlock { Text = glyph, FontSize = 13, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 6, 0) };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        Grid.SetColumn(icon, 0);

        var labelText = new TextBlock
        {
            Text = label,
            FontSize = 13,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(labelText, 1);

        var value = new TextBlock
        {
            Text = valueText,
            FontSize = 13,
            FontWeight = FontWeights.Medium,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        Grid.SetColumn(value, 3);

        header.Children.Add(icon);
        header.Children.Add(labelText);
        header.Children.Add(value);

        var track = new Border
        {
            Height = 8,
            CornerRadius = DisplayTokens.Radius("TsRadiusPill", 999),
            Background = DisplayTokens.Brush(TrackBrushKey),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            Child = BuildFill(accent, fraction),
        };

        var column = new StackPanel { Spacing = 6 };
        column.Children.Add(header);
        column.Children.Add(track);

        AutomationProperties.SetName(column, automationName);
        return column;
    }

    private static Grid BuildFill(Brush accent, double fraction)
    {
        double filled = Math.Clamp(fraction, 0.0, 1.0);
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(filled, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1 - filled, GridUnitType.Star) });

        var fill = new Border
        {
            CornerRadius = DisplayTokens.Radius("TsRadiusPill", 999),
            Background = accent,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        Grid.SetColumn(fill, 0);
        grid.Children.Add(fill);
        return grid;
    }

    private static StackPanel BuildNote(string note)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var icon = new TextBlock { Text = DollarEmoji, FontSize = 13, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var text = new TextBlock
        {
            Text = note,
            FontSize = 13,
            Foreground = DisplayTokens.Brush(SuccessBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
        };

        row.Children.Add(icon);
        row.Children.Add(text);
        AutomationProperties.SetName(row, note);
        return row;
    }

    // ── Empty / Loading / Error surfaces ──────────────────────────────────────────────────────────────

    private TsEmptyState BuildEmpty() => new()
    {
        Title = _viewModel.Title,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private StackPanel BuildLoading()
    {
        var column = new StackPanel
        {
            Spacing = 14,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            MaxWidth = ComparisonMaxWidth,
            Margin = new Thickness(16),
        };

        column.Children.Add(new TsSkeleton { BlockHeight = 56, BlockWidth = 56, HorizontalAlignment = HorizontalAlignment.Center });
        column.Children.Add(new TsSkeleton { BlockHeight = 16, BlockWidth = 120, HorizontalAlignment = HorizontalAlignment.Center });
        column.Children.Add(new TsSkeleton { BlockHeight = 48, BlockWidth = 200, HorizontalAlignment = HorizontalAlignment.Center });
        column.Children.Add(new TsSkeleton { BlockHeight = 14, BlockWidth = 160, HorizontalAlignment = HorizontalAlignment.Center });
        column.Children.Add(new TsSkeleton { BlockHeight = 36 });
        column.Children.Add(new TsSkeleton { BlockHeight = 36 });

        AutomationProperties.SetName(column, _viewModel.LoadingLabel);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
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

    private static string FormatMoney(double value, string symbol) =>
        ScalarFormatters.FormatCurrency(value, symbol, 0);

    private static bool AreClose(double a, double b) => Math.Abs(a - b) < 0.005;

    protected override AutomationPeer OnCreateAutomationPeer() => new SavingsSlideAutomationPeer(this);

    private sealed class SavingsSlideAutomationPeer(SavingsSlide owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((SavingsSlide)Owner).ViewModel.Title
                : name;
        }
    }
}
