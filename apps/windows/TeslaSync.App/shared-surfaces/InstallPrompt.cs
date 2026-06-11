using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Windows.Storage;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>InstallPrompt</c> shared surface — a parity port of the web <c>InstallPrompt</c> export
/// (web/src/components/feedback/InstallPrompt.tsx). It is the app-chrome "install this app" prompt anchored to the
/// bottom of the viewport: a translucent <see cref="TsGlassPanel"/> card carrying a brand cyan→green gradient chip
/// with a Segoe Fluent download glyph (standing in for the web Lucide <c>Download</c>), the localized title +
/// subtitle, an "Install" call-to-action (<see cref="ButtonVariant.Primary"/>), and a dismiss ("X") button. It
/// binds the <see cref="InstallPromptViewModel"/> (over the P1/S8 <see cref="IInstallAvailabilitySource"/> +
/// <see cref="IInstallDismissalStore"/>) and is shown only when a deferred install affordance is available, the app
/// is not already running standalone, and it was not dismissed within the suppression window (the web
/// <c>visible</c> gate). When that state moves it slides up + fades in / out, snapping to the final state under the
/// OS reduce-motion preference (the web framer-motion spring). It performs no window-event listening or storage of
/// its own — those are bound seams — is announced to Narrator as a polite live region named by the title and
/// described by the subtitle, and emits the <c>view.opened</c> diagnostic once when first shown.
///
/// <para>
/// State coverage: the web source has no loading / error / stale / offline data chrome of its own — it fetches no
/// data, deriving visibility purely from platform install events, the standalone-mode probe and the dismissal
/// timestamp. Those data-source lifecycle states therefore collapse to the hidden state, which is reproduced and
/// tested. The states the web actually has are reproduced in full: hidden (no offer, already installed, or
/// dismissed within the window) and visible (the install prompt). Presenting the one-shot affordance via
/// <see cref="InstallPromptViewModel.InstallAsync"/> consumes it (hiding the surface), and a dismissal — local or a
/// sibling instance's broadcast — persists for <see cref="InstallPromptRegistration.DismissWindowDays"/> days.
/// </para>
/// </summary>
public sealed partial class InstallPrompt : ContentControl, IDisposable
{
    private const double MaxCardWidth = 448;        // web max-w-md / lg:w-[28rem] (28rem).
    private const double CardPadding = 12;          // web px-3 py-3.
    private const double CardCornerRadius = 16;     // web rounded-2xl.
    private const double OuterPad = 12;             // web inset-x-3 / lg:right-4 / bottom gap.
    private const double ColumnSpacing = 12;        // web gap-3.
    private const double ChipSize = 40;             // web h-10 w-10.
    private const double ChipCornerRadius = 12;     // web rounded-xl.
    private const double ChipGlyphSize = 20;        // web Download h-5 w-5.
    private const double TitleFontSize = 14;        // web text-sm.
    private const double SubtitleFontSize = 12;     // web text-xs.
    private const double SubtitleSpacing = 2;       // web mt-0.5.
    private const double DismissGlyphSize = 16;     // web X h-4 w-4.
    private const double SlideOffset = 24;          // web initial/exit y offset (spring slide-up).
    private const int TransitionMs = 280;           // web spring reveal duration.

    private readonly InstallPromptViewModel _viewModel;
    private readonly InstallPromptDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly bool _reduceMotion;

    private readonly Grid _root = new()
    {
        HorizontalAlignment = HorizontalAlignment.Stretch,
        VerticalAlignment = VerticalAlignment.Bottom,
    };

    private readonly TranslateTransform _slide = new() { Y = 0 };

    private readonly TsGlassPanel _card = new()
    {
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Bottom,
        MaxWidth = MaxCardWidth,
        Padding = new Thickness(CardPadding),
        CornerRadius = new CornerRadius(CardCornerRadius),
    };

    private readonly Grid _content = new()
    {
        ColumnSpacing = ColumnSpacing,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly Border _chip = new()
    {
        Width = ChipSize,
        Height = ChipSize,
        CornerRadius = new CornerRadius(ChipCornerRadius),
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly FontIcon _chipGlyph = new()
    {
        Glyph = InstallPromptRegistration.DownloadGlyph,
        FontSize = ChipGlyphSize,
        Foreground = new SolidColorBrush(Microsoft.UI.Colors.White),
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly StackPanel _textColumn = new()
    {
        Spacing = SubtitleSpacing,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _title = new()
    {
        FontSize = TitleFontSize,
        FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
        TextWrapping = TextWrapping.Wrap,
    };

    private readonly TextBlock _subtitle = new()
    {
        FontSize = SubtitleFontSize,
        TextWrapping = TextWrapping.Wrap,
    };

    private readonly TsButton _install = new()
    {
        Variant = ButtonVariant.Primary,
        Size = ControlSize.Small,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsButton _dismiss = new()
    {
        Variant = ButtonVariant.Icon,
        Size = ControlSize.Small,
        IconGlyph = InstallPromptRegistration.DismissGlyph,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private Storyboard? _storyboard;
    private bool _ready;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe prompt with no composition root (the designer / parameterless host entry point): it
    /// binds a static availability source that offers an install and an in-memory dismissal store over the
    /// passthrough localizer, so the surface renders its visible prompt state. Supply explicit seams via the other
    /// constructors to drive i18n, the platform installability and the dismissal from the composition root.
    /// </summary>
    public InstallPrompt()
        : this(
            PassthroughLocalizer.Instance,
            new StaticInstallAvailabilitySource(canInstall: true),
            new InMemoryInstallDismissalStore(),
            diagnostics: null)
    {
    }

    /// <summary>Creates the prompt over the i18n facade and the two bound P1/S8 seams (the production entry point).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="availability">The platform installability seam (web <c>beforeinstallprompt</c> / standalone state).</param>
    /// <param name="dismissal">The dismissal-persistence seam (web localStorage timestamp + broadcast).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public InstallPrompt(
        ILocalizer localizer,
        IInstallAvailabilitySource availability,
        IInstallDismissalStore dismissal,
        InstallPromptDiagnostics? diagnostics = null)
        : this(new InstallPromptViewModel(localizer, availability, dismissal), diagnostics)
    {
    }

    /// <summary>Creates the prompt over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public InstallPrompt(InstallPromptViewModel viewModel, InstallPromptDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new InstallPromptDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _reduceMotion = MotionPreference.ReduceMotion;

        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalAlignment = VerticalAlignment.Bottom;
        VerticalContentAlignment = VerticalAlignment.Bottom;
        Padding = new Thickness(OuterPad);
        IsTabStop = false;

        BuildTree();

        AutomationProperties.SetAutomationId(this, InstallPromptRegistration.PromptAutomationId);
        AutomationProperties.SetAutomationId(_install, InstallPromptRegistration.InstallAutomationId);
        AutomationProperties.SetAutomationId(_dismiss, InstallPromptRegistration.DismissAutomationId);

        // web: the prompt appears proactively — announce it politely so Narrator surfaces it without moving focus.
        LiveRegion.Configure(this);

        _install.Click += OnInstallClick;
        _dismiss.Click += OnDismissClick;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _root;
        Render();
    }

    /// <summary>The canonical surface slug (<c>InstallPrompt</c>).</summary>
    public static string Slug => InstallPromptRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public InstallPromptViewModel ViewModel => _viewModel;

    /// <summary>The composed accessible name the automation peer reports (the prompt title).</summary>
    internal string AccessibleName => _viewModel.AccessibleName;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _storyboard?.Stop();
        _storyboard = null;
        _install.Click -= OnInstallClick;
        _dismiss.Click -= OnDismissClick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new InstallPromptAutomationPeer(this);

    private void BuildTree()
    {
        _chip.Background = BrandGradient();
        _chip.Child = _chipGlyph;

        _title.Foreground = DisplayTokens.TextPrimary;
        _subtitle.Foreground = DisplayTokens.TextSecondary;
        _textColumn.Children.Add(_title);
        _textColumn.Children.Add(_subtitle);

        _content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Grid.SetColumn(_chip, 0);
        Grid.SetColumn(_textColumn, 1);
        Grid.SetColumn(_install, 2);
        Grid.SetColumn(_dismiss, 3);

        _content.Children.Add(_chip);
        _content.Children.Add(_textColumn);
        _content.Children.Add(_install);
        _content.Children.Add(_dismiss);

        // The gradient chip is a decorative brand mark; the surface's Narrator name (the title) is authoritative.
        AutomationProperties.SetAccessibilityView(_chip, AccessibilityView.Raw);

        _card.Content = _content;
        _card.RenderTransform = _slide;
        _root.Children.Add(_card);
    }

    private void OnInstallClick(object sender, RoutedEventArgs e) => _ = _viewModel.InstallAsync();

    private void OnDismissClick(object sender, RoutedEventArgs e) => _viewModel.Dismiss();

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        // Snap to the correct state once layout is valid, then animate subsequent transitions.
        _ready = false;
        ApplyVisualState();
        _ready = true;

        if (_viewModel.Projection.IsVisible)
        {
            LiveRegion.Announce(this);
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void Render()
    {
        var projection = _viewModel.Projection;

        _title.Text = projection.Title;
        _subtitle.Text = projection.Subtitle;
        _install.Text = projection.InstallLabel;

        AutomationProperties.SetName(_install, projection.InstallLabel);
        AutomationProperties.SetName(_dismiss, projection.DismissLabel);
        ToolTipService.SetToolTip(_dismiss, projection.DismissLabel);

        // web role/labelling: the prompt is named by its title and described by its subtitle.
        AutomationProperties.SetName(this, projection.AccessibleName);
        AutomationProperties.SetFullDescription(this, projection.Description);

        ApplyVisualState();

        if (_ready && projection.IsVisible)
        {
            LiveRegion.Announce(this);
        }
    }

    private void ApplyVisualState()
    {
        var visible = _viewModel.Projection.IsVisible;

        if (!_ready || _reduceMotion)
        {
            StopStoryboard();
            Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
            _card.Opacity = 1;
            _slide.Y = 0;
            return;
        }

        if (visible)
        {
            AnimateIn();
        }
        else
        {
            AnimateOut();
        }
    }

    private void AnimateIn()
    {
        Visibility = Visibility.Visible;
        AnimateTo(opacityTo: 1, translateTo: 0, onComplete: null);
    }

    private void AnimateOut()
    {
        AnimateTo(opacityTo: 0, translateTo: SlideOffset, onComplete: () => Visibility = Visibility.Collapsed);
    }

    private void AnimateTo(double opacityTo, double translateTo, Action? onComplete)
    {
        StopStoryboard();

        var duration = new Duration(TimeSpan.FromMilliseconds(TransitionMs));
        var ease = new CubicEase { EasingMode = EasingMode.EaseOut };
        var storyboard = new Storyboard();

        var opacity = new DoubleAnimation
        {
            From = _card.Opacity,
            To = opacityTo,
            Duration = duration,
            EasingFunction = ease,
        };
        Storyboard.SetTarget(opacity, _card);
        Storyboard.SetTargetProperty(opacity, "Opacity");
        storyboard.Children.Add(opacity);

        var slide = new DoubleAnimation
        {
            From = _slide.Y,
            To = translateTo,
            Duration = duration,
            EnableDependentAnimation = true,
            EasingFunction = ease,
        };
        Storyboard.SetTarget(slide, _slide);
        Storyboard.SetTargetProperty(slide, "Y");
        storyboard.Children.Add(slide);

        if (onComplete is not null)
        {
            storyboard.Completed += (_, _) => onComplete();
        }

        _storyboard = storyboard;
        storyboard.Begin();
    }

    private void StopStoryboard()
    {
        _storyboard?.Stop();
        _storyboard = null;
    }

    private void Marshal(Action action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(() => action());
        }
        else
        {
            action();
        }
    }

    private static LinearGradientBrush BrandGradient()
    {
        // web from-[#00f0ff] to-[#10b981]: the brand accent (cyan) to the battery green, sourced from the W1
        // design tokens (theme-aware accent) so light / dark / high-contrast all flow from the token dictionary.
        var start = ResolveColor(InstallPromptRegistration.GradientStartColorKey, InstallPromptRegistration.GradientStartFallback);
        var end = ResolveBrushColor(InstallPromptRegistration.GradientEndBrushKey, InstallPromptRegistration.GradientEndFallback);

        return new LinearGradientBrush
        {
            StartPoint = new Windows.Foundation.Point(0, 0),
            EndPoint = new Windows.Foundation.Point(1, 1),
            GradientStops =
            {
                new GradientStop { Color = start, Offset = 0 },
                new GradientStop { Color = end, Offset = 1 },
            },
        };
    }

    private static Windows.UI.Color ResolveColor(string colorKey, string fallbackHex)
    {
        if (Application.Current?.Resources is { } resources
            && resources.TryGetValue(colorKey, out var value)
            && value is Windows.UI.Color color)
        {
            return color;
        }

        return ColorFromHex(fallbackHex);
    }

    private static Windows.UI.Color ResolveBrushColor(string brushKey, string fallbackHex)
    {
        if (Application.Current?.Resources is { } resources
            && resources.TryGetValue(brushKey, out var value)
            && value is SolidColorBrush brush)
        {
            return brush.Color;
        }

        return ColorFromHex(fallbackHex);
    }

    private static Windows.UI.Color ColorFromHex(string hex)
    {
        var span = hex.AsSpan().TrimStart('#');
        if (span.Length == 6
            && byte.TryParse(span[..2], System.Globalization.NumberStyles.HexNumber, System.Globalization.CultureInfo.InvariantCulture, out var r)
            && byte.TryParse(span[2..4], System.Globalization.NumberStyles.HexNumber, System.Globalization.CultureInfo.InvariantCulture, out var g)
            && byte.TryParse(span[4..6], System.Globalization.NumberStyles.HexNumber, System.Globalization.CultureInfo.InvariantCulture, out var b))
        {
            return Windows.UI.Color.FromArgb(255, r, g, b);
        }

        return Microsoft.UI.Colors.SteelBlue;
    }

    private sealed class InstallPromptAutomationPeer : FrameworkElementAutomationPeer
    {
        public InstallPromptAutomationPeer(InstallPrompt owner)
            : base(owner)
        {
        }

        private InstallPrompt Surface => (InstallPrompt)Owner;

        // The prompt is a named, non-modal promotional region; the title is the authoritative Narrator name.
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}

/// <summary>
/// The production <see cref="IInstallDismissalStore"/> — persists the dismissal timestamp in the packaged app's
/// <see cref="ApplicationData.LocalSettings"/> under the key the web stores in localStorage
/// (<see cref="InstallPromptRegistration.DismissStorageKey"/>), the native analogue of the web <c>handleDismiss</c>
/// write / <c>wasDismissedRecently</c> read (web/src/components/feedback/InstallPrompt.tsx L17-29, L74-83). Every
/// access is defensive: in unpackaged or first-run contexts the store may be unavailable, in which case a read
/// degrades to "not dismissed" (so the prompt reappears) and a write is silently skipped — never throws — exactly
/// as the web wraps localStorage in try/catch. WinUI-free callers never construct this; it lives in the view layer
/// because it depends on <c>Windows.Storage</c>.
/// </summary>
public sealed class ApplicationDataInstallDismissalStore : IInstallDismissalStore
{
    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public bool IsDismissedRecently
    {
        get
        {
            var raw = Read();
            return InstallPromptRegistration.IsDismissedRecently(raw, DateTimeOffset.UtcNow);
        }
    }

    /// <inheritdoc />
    public void Dismiss()
    {
        var values = Values;
        if (values is not null)
        {
            try
            {
                values[InstallPromptRegistration.DismissStorageKey] =
                    InstallPromptRegistration.FormatDismissedAt(DateTimeOffset.UtcNow);
            }
            catch (Exception)
            {
                // Quota / serialization failure — ignore (web swallows the localStorage write error).
            }
        }

        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>
    /// Re-raise <see cref="Changed"/> for a sibling instance's dismiss broadcast — the native analogue of the web
    /// cross-tab <c>subscribe('install.dismissed')</c> handler; the store re-reads the shared local-settings value
    /// so the prompt collapses without a relaunch.
    /// </summary>
    public void NotifyExternalDismissal() => Changed?.Invoke(this, EventArgs.Empty);

    private static string? Read()
    {
        var values = Values;
        if (values is not null
            && values.TryGetValue(InstallPromptRegistration.DismissStorageKey, out var stored)
            && stored is string text)
        {
            return text;
        }

        return null;
    }

    private static Windows.Foundation.Collections.IPropertySet? Values
    {
        get
        {
            try
            {
                return ApplicationData.Current.LocalSettings.Values;
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
