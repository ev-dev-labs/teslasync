using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>Accordion</c> shared surface — a parity port of
/// <c>web/src/components/ui/Accordion.tsx</c>. It is a collapsible disclosure section: a header row (an optional
/// leading icon, the title, an optional badge slot, an optional trailing header-extra slot) over a body that
/// reveals when expanded. Assign a <see cref="Model"/> (the web <c>title</c> / <c>icon</c> / <c>defaultOpen</c> /
/// padding props) and the content slots (<see cref="Body"/> = the web <c>children</c>, <see cref="Badge"/> = the
/// web <c>badge</c>, <see cref="HeaderExtra"/> = the web <c>headerExtra</c>) and it renders the web layout. The
/// web custom header button + framer-motion height/opacity reveal + rotating <c>ChevronDown</c> map onto the
/// platform-idiomatic disclosure (<see cref="TsAccordion"/>, a tokenized <see cref="Expander"/>), which carries
/// the native expand/collapse animation, keyboard toggling, the trailing chevron and the Narrator
/// expand/collapse pattern for free; the surface additionally honours reduce-motion on the body fade through the
/// shared <see cref="IMotionPreferenceSource"/> seam. The open state follows the web controlled-or-uncontrolled
/// contract, resolved by the WinUI-free <see cref="AccordionViewModel"/>; the layout / colour derivations live in
/// the WinUI-free <see cref="AccordionProjection"/>. The view performs no HTTP.
///
/// <para>
/// State coverage: the web component is purely presentational and prop-driven (its parent owns any data fetch),
/// so — like the peer presentational surfaces (InlineCallout / SwipeRow) — it has no loading / error / stale /
/// offline chrome to reproduce. Every branch it does have is reproduced in full: collapsed vs. expanded (body
/// hidden / revealed, chevron at 0° / 180°), the optional leading icon, the optional badge and header-extra
/// slots, the controlled vs. uncontrolled open state, the header / body padding overrides and the reduced-motion
/// (instant) vs. animated body reveal. The surface emits the <c>view.opened</c> diagnostic exactly once on
/// <see cref="FrameworkElement.Loaded"/>.
/// </para>
/// </summary>
public sealed partial class Accordion : ContentControl, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly AccordionDiagnostics _diagnostics;
    private readonly IMotionPreferenceSource _motion;
    private readonly AccordionViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;
    private readonly IDisposable _motionSubscription;

    private readonly TsAccordion _disclosure = new();
    private readonly Grid _header = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly FontIcon _icon = new()
    {
        FontSize = AccordionProjection.IconSize,
        VerticalAlignment = VerticalAlignment.Center,
        Visibility = Visibility.Collapsed,
    };

    private readonly TextBlock _title = new()
    {
        FontSize = AccordionProjection.TitleFontSize,
        FontWeight = FontWeights.Medium,
        TextTrimming = TextTrimming.CharacterEllipsis,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly ContentPresenter _badge = new()
    {
        VerticalAlignment = VerticalAlignment.Center,
        Visibility = Visibility.Collapsed,
    };

    private readonly ContentPresenter _headerExtra = new()
    {
        VerticalAlignment = VerticalAlignment.Center,
        Visibility = Visibility.Collapsed,
    };

    private readonly Border _bodyHost = new() { BorderThickness = new Thickness(0, 1, 0, 0) };
    private readonly ContentPresenter _bodyPresenter = new();

    private AccordionModel _model;
    private bool _reduceMotion;
    private bool _opened;
    private bool _disposed;
    private bool _suppressDisclosureEvents;
    private Storyboard? _bodyFade;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics / motion / controlled wiring.</summary>
    /// <param name="localizer">The i18n facade (P1/S10); reserved for parity with the surface family — this anonymous surface carries no inherent strings (its title / badge / header-extra are caller-supplied, already-localized content).</param>
    /// <param name="model">The initial render model; defaults to <see cref="AccordionModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="motion">The reduce-motion source (P1/S8); defaults to the OS "show animations" setting.</param>
    /// <param name="controlledOpen">The parent-owned open value (web <c>open</c>); supply with <paramref name="onOpenChange"/> for controlled mode.</param>
    /// <param name="onOpenChange">The parent notification callback (web <c>onOpenChange</c>); supply with <paramref name="controlledOpen"/> for controlled mode.</param>
    public Accordion(
        ILocalizer localizer,
        AccordionModel? model = null,
        AccordionDiagnostics? diagnostics = null,
        IMotionPreferenceSource? motion = null,
        bool? controlledOpen = null,
        Action<bool>? onOpenChange = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? AccordionModel.Empty;
        _diagnostics = diagnostics ?? new AccordionDiagnostics();
        _motion = motion ?? new SystemMotionPreferenceSource();
        _reduceMotion = _motion.ReduceMotion;
        _viewModel = new AccordionViewModel(_model.DefaultOpen, controlledOpen, onOpenChange);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        // The disclosure (Expander) is the meaningful automation node; the wrapper contributes none of its own.
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);

        BuildVisualTree();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.OpenChanged += OnViewModelOpenChanged;
        _motionSubscription = _motion.Observe(OnReduceMotionChanged);

        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
        SyncDisclosureToViewModel();
        UpdateBody(animate: false);
    }

    /// <summary>Raised with the new effective open state whenever the disclosure opens or closes (both modes).</summary>
    public event EventHandler<bool>? OpenChanged;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>Accordion</c>).</summary>
    public static string Slug => AccordionRegistration.Slug;

    /// <summary>The backing open-state holder (exposed for hosting / diagnostics / tests).</summary>
    public AccordionViewModel ViewModel => _viewModel;

    /// <summary>The resolved open state (web <c>open</c>).</summary>
    public bool IsOpen => _viewModel.IsOpen;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public AccordionModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>The body content revealed when expanded (web <c>children</c>).</summary>
    public UIElement? Body
    {
        get => _bodyPresenter.Content as UIElement;
        set => _bodyPresenter.Content = value;
    }

    /// <summary>The optional badge rendered after the title (web <c>badge</c>); set <see cref="AccordionModel.HasBadge"/> to show it.</summary>
    public UIElement? Badge
    {
        get => _badge.Content as UIElement;
        set
        {
            _badge.Content = value;
            Render();
        }
    }

    /// <summary>The optional content rendered after the badge (web <c>headerExtra</c>, e.g. inline search); set <see cref="AccordionModel.HasHeaderExtra"/> to show it.</summary>
    public UIElement? HeaderExtra
    {
        get => _headerExtra.Content as UIElement;
        set
        {
            _headerExtra.Content = value;
            Render();
        }
    }

    /// <summary>
    /// Programmatically request the open state (web <c>setOpen</c>). In uncontrolled mode this opens / closes the
    /// disclosure; in controlled mode it notifies the parent through its <c>onOpenChange</c> callback.
    /// </summary>
    /// <param name="open">The requested open state.</param>
    public void SetOpen(bool open)
    {
        _viewModel.RequestOpen(open);
        SyncDisclosureToViewModel();
    }

    /// <summary>
    /// Reflect a new parent-owned open value (the controlled-mode follow-up to a toggle, i.e. the web parent
    /// re-rendering with a new <c>open</c> prop). A no-op in uncontrolled mode.
    /// </summary>
    /// <param name="open">The new parent-owned open value (web <c>open</c> prop).</param>
    public void SyncControlledOpen(bool open) => _viewModel.SyncControlledOpen(open);

    /// <summary>Detach from the open-state holder and the motion source (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _disclosure.Expanding -= OnDisclosureExpanding;
        _disclosure.Collapsed -= OnDisclosureCollapsed;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.OpenChanged -= OnViewModelOpenChanged;
        _motionSubscription.Dispose();
        StopBodyFade();
        GC.SuppressFinalize(this);
    }

    private void BuildVisualTree()
    {
        // Header: [icon auto][title *][badge auto][headerExtra auto]; the disclosure adds its own trailing chevron
        // (the native counterpart of the web ChevronDown), so no custom chevron is composed here.
        _header.ColumnSpacing = AccordionProjection.HeaderItemSpacing;
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        // The leading icon is decorative (web aria-hidden); the disclosure's accessible name carries the title.
        AutomationProperties.SetAccessibilityView(_icon, AccessibilityView.Raw);
        Grid.SetColumn(_icon, 0);
        Grid.SetColumn(_title, 1);
        Grid.SetColumn(_badge, 2);
        Grid.SetColumn(_headerExtra, 3);
        _header.Children.Add(_icon);
        _header.Children.Add(_title);
        _header.Children.Add(_badge);
        _header.Children.Add(_headerExtra);

        _bodyHost.Child = _bodyPresenter;

        _disclosure.Header = _header;
        _disclosure.Content = _bodyHost;
        _disclosure.HorizontalAlignment = HorizontalAlignment.Stretch;
        _disclosure.HorizontalContentAlignment = HorizontalAlignment.Stretch;

        // The body inset is owned by the body host border, so the disclosure's own content padding is cleared to
        // avoid double insets and to keep the top divider flush under the header (web border-t).
        _disclosure.Padding = new Thickness(0);

        _disclosure.Expanding += OnDisclosureExpanding;
        _disclosure.Collapsed += OnDisclosureCollapsed;

        Content = _disclosure;
    }

    private void Render()
    {
        AccordionDisplay display = AccordionProjection.Project(_model, _viewModel.IsOpen, _localizer);

        if (display.HasIcon)
        {
            _icon.Glyph = display.IconGlyph;
            _icon.Foreground = DisplayTokens.Brush(display.IconBrushKey);
            _icon.Visibility = Visibility.Visible;
        }
        else
        {
            _icon.Visibility = Visibility.Collapsed;
        }

        _title.Text = display.Title;
        _title.Foreground = DisplayTokens.Brush(display.TitleBrushKey);

        // A slot renders only when the model declares it AND a node was supplied (web `{badge}` / `{headerExtra}`).
        _badge.Visibility = display.HasBadge && _badge.Content is not null ? Visibility.Visible : Visibility.Collapsed;
        _headerExtra.Visibility =
            display.HasHeaderExtra && _headerExtra.Content is not null ? Visibility.Visible : Visibility.Collapsed;

        Brush border = DisplayTokens.Brush(display.BorderBrushKey);
        _bodyHost.BorderBrush = border;
        _bodyHost.Padding = ToThickness(display.BodyPadding);

        // Best-effort header padding (web headerClassName): override the Expander template's header inset; if the
        // platform key is absent the disclosure keeps its native header padding, which is the idiomatic default.
        _disclosure.Resources["ExpanderHeaderPadding"] = ToThickness(display.HeaderPadding);

        _disclosure.BorderBrush = border;
        _disclosure.CornerRadius = DisplayTokens.Radius(display.CornerRadiusKey, 12);

        AutomationProperties.SetName(_disclosure, display.AutomationName);
        AutomationProperties.SetAutomationId(this, display.AutomationId ?? string.Empty);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnDisclosureExpanding(Expander sender, ExpanderExpandingEventArgs args) => OnUserToggled(open: true);

    private void OnDisclosureCollapsed(Expander sender, ExpanderCollapsedEventArgs args) => OnUserToggled(open: false);

    private void OnUserToggled(bool open)
    {
        if (_suppressDisclosureEvents)
        {
            return;
        }

        // web header onClick={() => setOpen(!open)}: route the user gesture through the open-state holder, then
        // reconcile the disclosure to the resolved truth (a controlled parent may decline the toggle).
        _viewModel.RequestOpen(open);
        SyncDisclosureToViewModel();
        UpdateBody(animate: true);
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(AccordionViewModel.IsOpen))
        {
            Render();
        }
    }

    private void OnViewModelOpenChanged(object? sender, bool open)
    {
        Marshal(() =>
        {
            SyncDisclosureToViewModel();
            UpdateBody(animate: true);
            OpenChanged?.Invoke(this, open);
        });
    }

    private void OnReduceMotionChanged(bool reduceMotion)
    {
        Marshal(() => _reduceMotion = reduceMotion);
    }

    private void SyncDisclosureToViewModel()
    {
        bool target = _viewModel.IsOpen;
        if (_disclosure.IsExpanded == target)
        {
            return;
        }

        _suppressDisclosureEvents = true;
        try
        {
            _disclosure.IsExpanded = target;
        }
        finally
        {
            _suppressDisclosureEvents = false;
        }
    }

    private void UpdateBody(bool animate)
    {
        StopBodyFade();

        if (!_viewModel.IsOpen)
        {
            // Collapsed: the disclosure hides the content region; reset opacity for the next reveal.
            _bodyHost.Opacity = 1;
            return;
        }

        if (!animate || !AccordionMotion.ShouldAnimateBody(_reduceMotion))
        {
            _bodyHost.Opacity = 1;
            return;
        }

        int duration = AccordionMotion.BodyRevealDurationMs(_reduceMotion);
        if (duration <= 0)
        {
            _bodyHost.Opacity = 1;
            return;
        }

        // web body entrance: opacity 0 -> 1 over 0.2s (the height animation is the disclosure's own).
        _bodyHost.Opacity = 0;
        var fade = new DoubleAnimation
        {
            From = 0,
            To = 1,
            Duration = new Duration(TimeSpan.FromMilliseconds(duration)),
        };
        Storyboard.SetTarget(fade, _bodyHost);
        Storyboard.SetTargetProperty(fade, "Opacity");

        _bodyFade = new Storyboard();
        _bodyFade.Children.Add(fade);
        _bodyFade.Begin();
    }

    private void StopBodyFade()
    {
        _bodyFade?.Stop();
        _bodyFade = null;
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

    private static Thickness ToThickness(AccordionPadding padding) =>
        new(padding.Left, padding.Top, padding.Right, padding.Bottom);

    /// <summary>
    /// The system reduce-motion source backing the production view — reads the OS "show animations" flag through
    /// <see cref="MotionPreference"/> (the read-once policy every motion-aware control in this app uses; the
    /// runtime-change subscription is intentionally inert to avoid the platform-gated UISettings change event).
    /// </summary>
    private sealed class SystemMotionPreferenceSource : IMotionPreferenceSource
    {
        public bool ReduceMotion => MotionPreference.ReduceMotion;

        public IDisposable Observe(Action<bool> onChanged)
        {
            ArgumentNullException.ThrowIfNull(onChanged);
            return InertSubscription.Instance;
        }

        private sealed class InertSubscription : IDisposable
        {
            public static InertSubscription Instance { get; } = new();

            private InertSubscription()
            {
            }

            public void Dispose()
            {
                // Read-once: the preference is not observed for runtime changes.
            }
        }
    }
}
