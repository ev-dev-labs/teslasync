using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>Toast</c> shared surface — a parity port of the web <c>ToastProvider</c> overlay
/// (web/src/components/feedback/Toast.tsx L130-237). It is the transient mutation-feedback layer: a bottom-right
/// stack of auto-dismissing typed cards (success / error / info / warning), each carrying the shared callout
/// glyph + accent (the native analogue of the web per-type Lucide icon + 300-level border), a bold title, an
/// optional secondary message, an optional navigation (hyperlink) or callback (button) action, and a dismiss
/// button. It binds the <see cref="ToastViewModel"/> over the P1/S8 <see cref="IToastController"/> queue seam
/// (the web <c>useToast()</c> context) and reconciles cards against the projection: new toasts slide in and arm a
/// one-shot auto-dismiss timer (the web <c>setTimeout(() =&gt; dismiss(id), duration)</c>), dismissed toasts slide
/// out, and the queue is capped at <see cref="ToastRegistration.MaxVisible"/>. Entrance / exit collapse to an
/// instant transition under the OS reduce-motion preference (the web <c>useMotionPreference</c>). Each card is a
/// live region — assertive for the <c>error</c> tone (web <c>role="alert"</c>), polite otherwise
/// (<c>role="status"</c>) — named with its title + message so Narrator announces it on arrival; the dismiss button
/// carries the localized "Dismiss notification" name. The overlay opens no data itself and emits the
/// <c>view.opened</c> diagnostic once when shown.
/// </summary>
/// <remarks>
/// This is a transient, client-only feedback primitive: it renders nothing until app code enqueues a toast, so its
/// authoritative web render branches are the <em>empty</em> overlay, the four tones, the with / without-message
/// and navigation / callback / no-action variants, and the reduce-motion branch — all reproduced here. It performs
/// no fetch, so the generic loading / stale / offline data-states do not apply (mirroring the OfflineBanner
/// surface, which is likewise not a fetch surface). An empty overlay is the correct resting state — a toast layer
/// that showed a persistent "no notifications" panel would be wrong — so the empty state is a collapsed,
/// hit-transparent region rather than a persistent filler panel.
/// </remarks>
public sealed partial class Toast : ContentControl, IDisposable
{
    private const double StackSpacing = 12;        // web flex-col gap-3
    private const double StackMargin = 24;         // web bottom-6 right-6
    private const double CardMaxWidth = 380;       // web max-w-[380px]
    private const double CardPadding = 16;         // web p-4
    private const double CardCornerRadius = 12;    // web rounded-xl
    private const double CardBorderThickness = 1;  // web border
    private const double ColumnSpacing = 12;       // web gap-3
    private const double TextSpacing = 2;          // web mt-0.5
    private const double ActionTopSpacing = 8;     // web mt-2
    private const double IconFontSize = 20;        // web h-5 w-5
    private const double TitleFontSize = 14;       // web text-sm
    private const double BodyFontSize = 12;        // web text-xs
    private const double ActionFontSize = 12;      // web text-xs
    private const double DismissGlyphSize = 14;    // web h-3.5 w-3.5
    private const double EntranceOffsetY = 20;     // web initial y: 20
    private const double ExitOffsetX = 60;         // web exit x: 80 (nudged)
    private const int TransitionMs = 280;          // web spring reveal

    private readonly ToastViewModel _viewModel;
    private readonly ToastDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly bool _reduceMotion;
    private readonly Dictionary<string, ToastCard> _cards = new(StringComparer.Ordinal);

    private readonly StackPanel _stack = new()
    {
        Orientation = Orientation.Vertical,
        Spacing = StackSpacing,
        Margin = new Thickness(StackMargin),
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Bottom,
    };

    private bool _ready;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the overlay with no composition root (the designer / parameterless host entry point): it binds the
    /// passthrough localizer over a fresh, empty <see cref="ToastController"/>, so the surface renders its resting
    /// empty state. Supply an explicit <see cref="ILocalizer"/> and a bound <see cref="IToastController"/> via the
    /// other constructors to drive i18n and the live queue from the composition root.
    /// </summary>
    public Toast()
        : this(PassthroughLocalizer.Instance, new ToastController(), diagnostics: null)
    {
    }

    /// <summary>Creates the overlay over the i18n facade and a bound toast queue (the production entry point).</summary>
    /// <param name="localizer">The i18n facade the dismiss label resolves through.</param>
    /// <param name="controller">The toast queue seam (web <c>useToast()</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public Toast(ILocalizer localizer, IToastController controller, ToastDiagnostics? diagnostics = null)
        : this(new ToastViewModel(localizer, controller), diagnostics)
    {
    }

    /// <summary>Creates the overlay over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public Toast(ToastViewModel viewModel, ToastDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new ToastDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _reduceMotion = MotionPreference.ReduceMotion;

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        VerticalAlignment = VerticalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Right;
        VerticalContentAlignment = VerticalAlignment.Bottom;
        Padding = new Thickness(0);
        Background = null;

        // The overlay region is anonymous (the web container has no aria-label); the per-card live regions carry
        // the announced names. Expose only a stable automation id for UI automation.
        AutomationProperties.SetAutomationId(this, ToastRegistration.RegionAutomationId);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _stack;
        Reconcile();
    }

    /// <summary>
    /// Raised when a navigation action (the web <c>{ label, to }</c> <c>&lt;Link&gt;</c> flavour) is invoked,
    /// carrying its in-app route. The composition root wires this to its navigation service; the surface stays
    /// decoupled from navigation just as the web component delegates to React Router.
    /// </summary>
    public event EventHandler<ToastActionEventArgs>? ActionNavigationRequested;

    /// <summary>The canonical surface slug (<c>Toast</c>).</summary>
    public static string Slug => ToastRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public ToastViewModel ViewModel => _viewModel;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        foreach (var card in _cards.Values)
        {
            card.DismissRequested -= OnCardDismissRequested;
            card.NavigationRequested -= OnCardNavigationRequested;
            card.Dispose();
        }

        _cards.Clear();
        _stack.Children.Clear();

        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new ToastAutomationPeer(this);

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
        Reconcile();
        _ready = true;
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Reconcile);

    private void Reconcile()
    {
        if (_disposed)
        {
            return;
        }

        var items = _viewModel.Projection.Items;
        var dismissLabel = _viewModel.Projection.DismissLabel;
        var present = new HashSet<string>(StringComparer.Ordinal);

        // Additions (new toasts are always appended at the end of the queue, so appending the card preserves the
        // oldest-first → newest-last stack order without any explicit reordering).
        foreach (var item in items)
        {
            present.Add(item.Id);
            if (_cards.ContainsKey(item.Id))
            {
                continue;
            }

            var card = new ToastCard(item, dismissLabel, _dispatcher);
            card.DismissRequested += OnCardDismissRequested;
            card.NavigationRequested += OnCardNavigationRequested;
            _cards[item.Id] = card;
            _stack.Children.Add(card.Root);

            if (_ready && !_reduceMotion)
            {
                card.AnimateIn(EntranceOffsetY, TransitionMs);
            }

            card.Arm();

            // web role="alert"/"status" + aria-live + aria-atomic: announce the new toast on arrival.
            LiveRegion.Announce(card.Root);
        }

        // Removals (dismissed by the user, by the auto-dismiss timer, or dropped by the five-toast cap).
        if (_cards.Count == present.Count)
        {
            return;
        }

        var stale = new List<string>();
        foreach (var id in _cards.Keys)
        {
            if (!present.Contains(id))
            {
                stale.Add(id);
            }
        }

        foreach (var id in stale)
        {
            RemoveCard(id);
        }
    }

    private void RemoveCard(string id)
    {
        if (!_cards.Remove(id, out var card))
        {
            return;
        }

        card.DismissRequested -= OnCardDismissRequested;
        card.NavigationRequested -= OnCardNavigationRequested;
        card.StopTimer();

        void Finish()
        {
            _stack.Children.Remove(card.Root);
            card.Dispose();
        }

        if (!_ready || _reduceMotion)
        {
            Finish();
        }
        else
        {
            card.AnimateOut(ExitOffsetX, TransitionMs, Finish);
        }
    }

    private void OnCardDismissRequested(object? sender, EventArgs e)
    {
        if (sender is ToastCard card)
        {
            // Single source of truth: request the controller drop it; the resulting Changed reconciles the card out.
            _viewModel.Dismiss(card.Id);
        }
    }

    private void OnCardNavigationRequested(object? sender, ToastActionEventArgs e) =>
        ActionNavigationRequested?.Invoke(this, e);

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

    /// <summary>The automation peer for the overlay region — a transparent group container of live-region cards.</summary>
    private sealed class ToastAutomationPeer : FrameworkElementAutomationPeer
    {
        public ToastAutomationPeer(Toast owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }

    /// <summary>
    /// One toast card — the native analogue of a single web <c>&lt;motion.div&gt;</c> toast
    /// (web/src/components/feedback/Toast.tsx L164-231). It builds the icon + title + message + optional action +
    /// dismiss button, tints from the variant accent, owns its one-shot auto-dismiss timer (web
    /// <c>setTimeout</c>), and animates its own entrance / exit. It raises <see cref="DismissRequested"/> (timer
    /// elapsed, dismiss clicked, or after an action fires) and <see cref="NavigationRequested"/> (a navigation
    /// action), never mutating the queue itself.
    /// </summary>
    private sealed class ToastCard : IDisposable
    {
        private readonly ToastItemProjection _item;
        private readonly DispatcherQueue? _dispatcher;
        private readonly Border _root;
        private readonly TranslateTransform _transform = new();
        private DispatcherQueueTimer? _timer;
        private Storyboard? _storyboard;
        private bool _disposed;

        public ToastCard(ToastItemProjection item, string dismissLabel, DispatcherQueue? dispatcher)
        {
            _item = item;
            _dispatcher = dispatcher;

            var accent = DisplayTokens.Brush(item.AccentBrushKey);

            var icon = new FontIcon
            {
                Glyph = item.Glyph,
                FontSize = IconFontSize,
                Foreground = accent,
                VerticalAlignment = VerticalAlignment.Top,
            };
            AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

            var text = new StackPanel { Spacing = TextSpacing, VerticalAlignment = VerticalAlignment.Center };

            var title = new TextBlock
            {
                Text = item.Title,
                FontSize = TitleFontSize,
                FontWeight = FontWeights.SemiBold,
                TextWrapping = TextWrapping.Wrap,
                Foreground = DisplayTokens.TextPrimary,
            };
            AutomationProperties.SetAccessibilityView(title, AccessibilityView.Raw);
            text.Children.Add(title);

            if (item.HasMessage)
            {
                var message = new TextBlock
                {
                    Text = item.Message,
                    FontSize = BodyFontSize,
                    TextWrapping = TextWrapping.Wrap,
                    MaxLines = 2,                              // web line-clamp-2
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    Foreground = DisplayTokens.TextSecondary,
                };
                AutomationProperties.SetAccessibilityView(message, AccessibilityView.Raw);
                text.Children.Add(message);
            }

            if (item.HasAction && item.Action is { } action)
            {
                text.Children.Add(BuildAction(action, accent));
            }

            var dismiss = new Button
            {
                Content = new FontIcon { Glyph = ToastRegistration.DismissGlyph, FontSize = DismissGlyphSize },
                Background = null,
                BorderThickness = new Thickness(0),
                Padding = new Thickness(6),
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Top,
                HorizontalAlignment = HorizontalAlignment.Right,
            };
            AutomationProperties.SetName(dismiss, dismissLabel);
            ToolTipService.SetToolTip(dismiss, dismissLabel);
            dismiss.Click += (_, _) => RaiseDismiss();

            var content = new Grid { ColumnSpacing = ColumnSpacing };
            content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            Grid.SetColumn(icon, 0);
            Grid.SetColumn(text, 1);
            Grid.SetColumn(dismiss, 2);
            content.Children.Add(icon);
            content.Children.Add(text);
            content.Children.Add(dismiss);

            _root = new Border
            {
                Child = content,
                Padding = new Thickness(CardPadding),
                CornerRadius = new CornerRadius(CardCornerRadius),
                BorderThickness = new Thickness(CardBorderThickness),
                BorderBrush = accent,
                Background = DisplayTokens.Surface,
                MaxWidth = CardMaxWidth,
                HorizontalAlignment = HorizontalAlignment.Right,
                RenderTransform = _transform,
            };

            // web role="alert"/"status" with aria-atomic: a single named live region (assertive for error).
            AutomationProperties.SetName(_root, item.AccessibleName);
            LiveRegion.Configure(_root, assertive: item.IsAssertive);
        }

        public event EventHandler? DismissRequested;

        public event EventHandler<ToastActionEventArgs>? NavigationRequested;

        public string Id => _item.Id;

        public Border Root => _root;

        public void Arm()
        {
            if (!_item.AutoDismisses || _dispatcher is null)
            {
                return;
            }

            // web: if (duration > 0) setTimeout(() => dismiss(id), duration) — a single one-shot dismiss.
            var timer = _dispatcher.CreateTimer();
            timer.Interval = _item.Duration;
            timer.IsRepeating = false;
            timer.Tick += (t, _) =>
            {
                t.Stop();
                if (!_disposed)
                {
                    RaiseDismiss();
                }
            };
            timer.Start();
            _timer = timer;
        }

        public void StopTimer()
        {
            _timer?.Stop();
            _timer = null;
        }

        public void AnimateIn(double offsetY, int durationMs)
        {
            _root.Opacity = 0;
            _transform.Y = offsetY;

            var duration = new Duration(TimeSpan.FromMilliseconds(durationMs));
            var storyboard = new Storyboard();
            storyboard.Children.Add(Track(_root, "Opacity", from: 0, to: 1, duration));
            storyboard.Children.Add(Track(_transform, "Y", from: offsetY, to: 0, duration));
            Run(storyboard, onComplete: null);
        }

        public void AnimateOut(double offsetX, int durationMs, Action onComplete)
        {
            var duration = new Duration(TimeSpan.FromMilliseconds(durationMs));
            var storyboard = new Storyboard();
            storyboard.Children.Add(Track(_root, "Opacity", from: _root.Opacity, to: 0, duration));
            storyboard.Children.Add(Track(_transform, "X", from: _transform.X, to: offsetX, duration));
            Run(storyboard, onComplete);
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            StopTimer();
            _storyboard?.Stop();
            _storyboard = null;
        }

        private static DoubleAnimation Track(DependencyObject target, string property, double from, double to, Duration duration)
        {
            var animation = new DoubleAnimation
            {
                From = from,
                To = to,
                Duration = duration,
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut },
            };
            Storyboard.SetTarget(animation, target);
            Storyboard.SetTargetProperty(animation, property);
            return animation;
        }

        private void Run(Storyboard storyboard, Action? onComplete)
        {
            _storyboard?.Stop();
            _storyboard = storyboard;
            if (onComplete is not null)
            {
                storyboard.Completed += (_, _) => onComplete();
            }

            storyboard.Begin();
        }

        private ButtonBase BuildAction(ToastActionModel action, Brush accent)
        {
            if (action.IsNavigation)
            {
                // web Link: "{label} →"; navigate via the surface's decoupled event rather than a hard URL.
                var link = new HyperlinkButton
                {
                    Content = action.DisplayLabel,
                    Foreground = accent,
                    Padding = new Thickness(0),
                    Margin = new Thickness(0, ActionTopSpacing, 0, 0),
                    FontSize = ActionFontSize,
                };
                AutomationProperties.SetName(link, action.Label);
                link.Click += (_, _) =>
                {
                    NavigationRequested?.Invoke(this, new ToastActionEventArgs(action.Route!));
                    RaiseDismiss();
                };
                return link;
            }

            // web button: fire the callback, then dismiss.
            var button = new Button
            {
                Content = action.Label,
                Background = null,
                BorderThickness = new Thickness(0),
                Foreground = accent,
                Padding = new Thickness(0),
                Margin = new Thickness(0, ActionTopSpacing, 0, 0),
                FontSize = ActionFontSize,
            };
            AutomationProperties.SetName(button, action.Label);
            button.Click += (_, _) =>
            {
                action.OnClick?.Invoke();
                RaiseDismiss();
            };
            return button;
        }

        private void RaiseDismiss() => DismissRequested?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// Event data for <see cref="Toast.ActionNavigationRequested"/> — carries the in-app <see cref="Route"/> of a
/// navigation action (the web <c>ToastAction.to</c>) so the composition root can route to it.
/// </summary>
public sealed class ToastActionEventArgs : EventArgs
{
    /// <summary>Creates the event data over the action's in-app route.</summary>
    /// <param name="route">The in-app route (path + query) the navigation action targets.</param>
    public ToastActionEventArgs(string route)
    {
        ArgumentNullException.ThrowIfNull(route);
        Route = route;
    }

    /// <summary>The in-app route the navigation action targets (web <c>ToastAction.to</c>).</summary>
    public string Route { get; }
}
