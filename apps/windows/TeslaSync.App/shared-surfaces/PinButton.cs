using System.Threading.Tasks;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Automation.Provider;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>PinButton</c> shared surface — a parity port of the web <c>PinButton</c>
/// (web/src/components/ui/PinButton.tsx). Like the web source it is a focusable, icon-only toggle that flips the
/// current user's pin state for a single item: it shows the Segoe Fluent <c>Pin</c> glyph (muted) when unpinned
/// and the <c>Unpin</c> glyph (amber) when pinned, carries the action wording ("Pin" / "Unpin") as both its
/// tooltip and its accessible name, exposes the pressed state through the UI-Automation Toggle pattern (the native
/// analogue of the web <c>aria-pressed</c>), disables itself while a toggle is in flight, and — when a visible
/// label is requested — renders "Pin" / "Pinned" beside the glyph. All state flows through the shared
/// <see cref="PinButtonViewModel"/> over the <see cref="IPinStore"/> seam (the web <c>usePinned</c> +
/// <c>useTogglePin</c> hooks); the view performs only platform composition: glyph / brush / label projection, the
/// click → toggle dispatch (handled so it never also triggers an enclosing row's navigation, the web
/// <c>e.stopPropagation()</c> / <c>e.preventDefault()</c>) and the coalesced re-render. Every label resolves
/// through the i18n facade.
///
/// <para>
/// State coverage: the web source issues no data-fetch chrome — <c>usePinned</c> defaults its data to <c>[]</c>,
/// so an unresolved or failed pin query simply reads as not-pinned and the trigger renders its idle state; there
/// is no loading / empty / error / stale / offline surface to reproduce. The states it actually has are reproduced
/// in full and exercised in <c>PinButtonTests</c>: unpinned-idle (muted Pin glyph, "Pin" tooltip), pinned (amber
/// Unpin glyph, "Unpin" tooltip, Toggle state On), in-flight (disabled, re-entrant clicks dropped), with / without
/// a visible label, and small / medium sizing. The decorative glyph carries no separate accessible name — the
/// button's name (the action label) is authoritative — the surface uses no entrance animation (matching the web,
/// which simply mounts, so the OS reduce-motion preference is honoured by construction), and it emits the
/// <c>view.opened</c> diagnostic once when first mounted.
/// </para>
/// </summary>
public sealed partial class PinButton : ContentControl, IDisposable
{
    private const string PinGlyph = "\uE718";    // Segoe Fluent Icons "Pin" — the web lucide Pin (idle) icon.
    private const string UnpinGlyph = "\uE77A";  // Segoe Fluent Icons "Unpin" — the web lucide PinOff (pinned) icon.
    private const double LabelGap = 6;           // web gap-1.5.
    private const double LabelPaddingH = 8;      // web px-2 (label mode).
    private const double LabelPaddingV = 4;

    private readonly PinButtonViewModel _viewModel;
    private readonly PinButtonDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly PinGlyphButton _button;
    private readonly StackPanel _content;
    private readonly FontIcon _icon;
    private readonly TextBlock _label;

    private bool _lastPinned;
    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>
    /// Creates a gallery-safe surface bound to a fresh in-memory pin store, a headless toast queue and the
    /// passthrough localizer — the native analogue of mounting the web component in an isolated host. Production
    /// callers use the seam constructor.
    /// </summary>
    public PinButton()
        : this(
            new InMemoryPinStore(),
            PinItemType.Vehicle,
            "0",
            context: null,
            PassthroughLocalizer.Instance,
            new ToastController())
    {
    }

    /// <summary>Creates the surface over its pin seam, item identity, the i18n facade, an optional toast queue and diagnostics.</summary>
    /// <param name="store">The pin seam (web <c>usePinned</c> + <c>useTogglePin</c>).</param>
    /// <param name="itemType">The domain bucket (web <c>itemType</c>).</param>
    /// <param name="itemId">The stable item id; the caller stringifies numbers (web <c>String(itemId)</c>).</param>
    /// <param name="context">The optional sub-surface scope (web <c>context</c>); null for the default bucket.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="toast">The shared toast queue (web <c>useMutationToast()</c>); may be null when no overlay is hosted.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public PinButton(
        IPinStore store,
        PinItemType itemType,
        string itemId,
        string? context,
        ILocalizer localizer,
        IToastController? toast = null,
        PinButtonDiagnostics? diagnostics = null)
        : this(new PinButtonViewModel(store, itemType, itemId, context, localizer, toast), diagnostics)
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public PinButton(PinButtonViewModel viewModel, PinButtonDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new PinButtonDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        _icon = new FontIcon
        {
            FontFamily = new FontFamily("Segoe Fluent Icons"),
            VerticalAlignment = VerticalAlignment.Center,
        };

        _label = new TextBlock
        {
            FontSize = 12,                       // web text-xs.
            FontWeight = FontWeights.Medium,     // web font-medium.
            VerticalAlignment = VerticalAlignment.Center,
            Visibility = Visibility.Collapsed,
        };

        _content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = LabelGap,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        _content.Children.Add(_icon);
        _content.Children.Add(_label);

        // The glyph is decorative; the button's accessible name (the action label) is authoritative.
        AutomationProperties.SetAccessibilityView(_icon, AccessibilityView.Raw);

        _button = new PinGlyphButton
        {
            Content = _content,
            Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(0),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            IsPinnedProvider = () => _viewModel.IsPinned,
            ToggleInvoker = _viewModel.Toggle,
        };
        _button.Click += OnButtonClick;

        IsTabStop = false;

        // Transparent structural wrapper: the web root is the button itself, so the surface hides itself from
        // Narrator and lets the inner button carry the accessible semantics + Toggle pattern.
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);

        Content = _button;

        _lastPinned = _viewModel.IsPinned;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>PinButton</c>).</summary>
    public static string Slug => PinButtonRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public PinButtonViewModel ViewModel => _viewModel;

    /// <summary>Whether the visible "Pin" / "Pinned" label is shown beside the glyph (web <c>showLabel</c>).</summary>
    public bool ShowLabel
    {
        get => _viewModel.ShowLabel;
        set => _viewModel.ShowLabel = value;
    }

    /// <summary>The trigger size (web <c>size</c>).</summary>
    public PinButtonSize Size
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _button.Click -= OnButtonClick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnButtonClick(object sender, RoutedEventArgs e)
    {
        // web handleClick: stopPropagation() + preventDefault() so toggling a pin inside a clickable row / card
        // does not also trigger the row's navigation. The WinUI Button consumes the pointer/tap that raised this
        // Click, so an enclosing row's Tapped/PointerPressed does not also fire — reproducing that isolation.
        // web: if (toggle.isPending) return — guarded inside the view-model; the disabled button is the primary gate.
        _viewModel.Toggle();
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
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
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
        var pinned = _viewModel.IsPinned;

        // web: Icon = isPinned ? PinOff : Pin.
        _icon.Glyph = _viewModel.ShowUnpinIcon ? UnpinGlyph : PinGlyph;
        _icon.FontSize = PinButtonMetrics.IconSize(_viewModel.Size);

        // web: text-amber-300 when pinned, text-[var(--text-muted)] otherwise. Set on the glyph + label directly so
        // the button template's hover/pressed foreground states never override the semantic colour.
        Brush foreground = DisplayTokens.Brush(_viewModel.ForegroundBrushKey);
        _icon.Foreground = foreground;
        _label.Foreground = foreground;

        // web: showLabel && (isPinned ? 'Pinned' : 'Pin').
        var visibleLabel = _viewModel.VisibleLabel;
        if (visibleLabel is null)
        {
            _label.Visibility = Visibility.Collapsed;

            // web SIZE_CLASS: a fixed square box for the icon-only trigger.
            var box = PinButtonMetrics.BoxSize(_viewModel.Size);
            _button.Padding = new Thickness(0);
            _button.Width = box;
            _button.Height = box;
            _button.MinWidth = box;
            _button.MinHeight = box;
        }
        else
        {
            _label.Text = visibleLabel;
            _label.Visibility = Visibility.Visible;

            // web: with a label the button switches to px-2 padding and lets the content size it.
            _button.Width = double.NaN;
            _button.Height = double.NaN;
            _button.MinWidth = 0;
            _button.MinHeight = 0;
            _button.Padding = new Thickness(LabelPaddingH, LabelPaddingV, LabelPaddingH, LabelPaddingV);
        }

        // web: title/aria-label = tooltipLabel (the action — "Pin" / "Unpin").
        ToolTipService.SetToolTip(_button, _viewModel.TooltipLabel);
        AutomationProperties.SetName(_button, _viewModel.AccessibleName);

        // web: disabled={toggle.isPending}.
        _button.IsEnabled = _viewModel.IsEnabled;

        // Surface the pressed-state change to Narrator (the web aria-pressed flip).
        if (pinned != _lastPinned)
        {
            _button.NotifyToggleStateChanged(_lastPinned, pinned);
            _lastPinned = pinned;
        }
    }

    /// <summary>
    /// The inner ghost button — a plain <see cref="Button"/> that additionally exposes the UI-Automation Toggle
    /// pattern so Narrator announces the pressed state (the native analogue of the web <c>aria-pressed</c>). The
    /// pressed state and the toggle action are supplied by the hosting <see cref="PinButton"/> through
    /// <see cref="IsPinnedProvider"/> / <see cref="ToggleInvoker"/>, keeping the controlled state in the
    /// view-model rather than in the button's own chrome.
    /// </summary>
    private sealed class PinGlyphButton : Button
    {
        private PinGlyphButtonAutomationPeer? _peer;

        /// <summary>Reads the current pressed (pinned) state for the Toggle pattern.</summary>
        public Func<bool>? IsPinnedProvider { get; set; }

        /// <summary>Invokes the toggle when Narrator activates the Toggle pattern.</summary>
        public Action? ToggleInvoker { get; set; }

        /// <summary>Raise a Toggle-state change so assistive tech is notified of the pressed-state flip.</summary>
        public void NotifyToggleStateChanged(bool oldPinned, bool newPinned) =>
            _peer?.RaiseToggleStateChanged(oldPinned, newPinned);

        protected override AutomationPeer OnCreateAutomationPeer()
        {
            _peer = new PinGlyphButtonAutomationPeer(this);
            return _peer;
        }

        internal bool ReadPinned() => IsPinnedProvider?.Invoke() ?? false;

        internal void InvokeToggle() => ToggleInvoker?.Invoke();
    }

    /// <summary>
    /// The automation peer for <see cref="PinGlyphButton"/> — a <see cref="ButtonAutomationPeer"/> that also serves
    /// the <see cref="IToggleProvider"/> pattern, reproducing the web button's <c>aria-pressed</c>: the
    /// <see cref="ToggleState"/> reflects the pinned state and <see cref="Toggle"/> performs the same flip as a
    /// click.
    /// </summary>
    private sealed class PinGlyphButtonAutomationPeer : ButtonAutomationPeer, IToggleProvider
    {
        private readonly PinGlyphButton _owner;

        public PinGlyphButtonAutomationPeer(PinGlyphButton owner)
            : base(owner) => _owner = owner;

        public ToggleState ToggleState => _owner.ReadPinned() ? ToggleState.On : ToggleState.Off;

        protected override object? GetPatternCore(PatternInterface patternInterface) =>
            patternInterface == PatternInterface.Toggle ? this : base.GetPatternCore(patternInterface);

        public void Toggle() => _owner.InvokeToggle();

        public void RaiseToggleStateChanged(bool oldPinned, bool newPinned) =>
            RaisePropertyChangedEvent(
                TogglePatternIdentifiers.ToggleStateProperty,
                oldPinned ? ToggleState.On : ToggleState.Off,
                newPinned ? ToggleState.On : ToggleState.Off);
    }
}
