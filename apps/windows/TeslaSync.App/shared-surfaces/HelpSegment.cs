using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>HelpSegment</c> shared surface — a parity port of
/// web/src/components/layout/status-bar/HelpSegment.tsx. It is the footer status-bar segment that consolidates the
/// three always-available help affordances that used to live at the bottom of the sidebar, each routed through the
/// decoupled <see cref="IHelpSegmentActions"/> seam so the command palette and the rest of the shell keep working
/// unchanged:
/// <list type="bullet">
///   <item>a keyboard-shortcuts cheat-sheet trigger (Keyboard glyph, the <c>?</c> key-cap + "for shortcuts" hint),</item>
///   <item>a guided-tour launcher (Help glyph + "Take a tour"),</item>
///   <item>an in-app feedback / bug-report trigger (Bug glyph + "Report bug").</item>
/// </list>
/// Each affordance is a borderless, keyboard-focusable Fluent button wrapped in the shared <see cref="TsTooltip"/>
/// (the native counterpart of the web <c>Tooltip</c>), carrying the localized Narrator name (web <c>aria-label</c>)
/// and the surface's automation id (the web <c>data-tour-launcher-trigger</c> / <c>data-testid</c> hooks). A
/// <see cref="HelpSegment(ILocalizer, IHelpSegmentActions, bool, HelpSegmentDiagnostics)"/> overload renders the
/// compact icon-only variant (web <c>iconOnly</c> prop): icons + tooltips with the labels dropped. Because the web
/// source issues no query there is no loading / empty / error / stale / offline chrome to reproduce — the only
/// state branch is the compact-versus-expanded layout, fixed at construction. All labels and commands flow through
/// <see cref="HelpSegmentViewModel"/>; the view performs no i18n or command of its own. Every accent tints from the
/// generated design tokens so light / dark / high-contrast all flow from the token set. The surface emits the
/// <c>view.opened</c> diagnostic once when it is shown.
/// </summary>
public sealed partial class HelpSegment : ContentControl, IDisposable
{
    private const string KeyboardGlyph = "\uE765";   // Segoe Fluent "KeyboardClassic" — the web Lucide Keyboard icon.
    private const string TourGlyph = "\uE897";       // Segoe Fluent "Help" — the web Lucide HelpCircle icon.
    private const string FeedbackGlyph = "\uEBE8";   // Segoe Fluent "Bug" — the web Lucide Bug icon.

    private const double IconFontSize = 12;          // web icon h-3 w-3.
    private const double LabelFontSize = 11;         // web text-[11px].
    private const double KeyCapFontSize = 10;        // web kbd text-[10px].
    private const double RowSpacing = 4;             // web gap-1.
    private const double AffordanceSpacing = 4;      // web inner gap-1.
    private const double ButtonPaddingX = 6;         // web px-1.5.
    private const double ButtonPaddingY = 2;         // web py-0.5.
    private const double KeyCapPaddingX = 4;         // web kbd px-1.
    private const double KeyCapCornerRadius = 3;     // web kbd rounded.

    private readonly HelpSegmentViewModel _viewModel;

    private readonly Button _shortcutsButton;
    private readonly Button _tourButton;
    private readonly Button _feedbackButton;

    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the segment with no host wired (the designer / parameterless host entry point): the affordances are
    /// inert and strings resolve through the passthrough localizer. Supply an explicit <see cref="ILocalizer"/> and
    /// a bound <see cref="IHelpSegmentActions"/> via the other constructor to drive i18n and the help commands from
    /// the composition root.
    /// </summary>
    public HelpSegment()
        : this(new HelpSegmentViewModel(PassthroughLocalizer.Instance, NullHelpSegmentActions.Instance))
    {
    }

    /// <summary>Creates the segment over the i18n facade, the help-command seam and the layout mode (the production entry point).</summary>
    /// <param name="localizer">The i18n facade every label resolves through (web <c>useTranslation</c>).</param>
    /// <param name="actions">The decoupled help-command seam the affordances route through (web event dispatchers).</param>
    /// <param name="iconOnly">Whether the compact icon-only mode is rendered (web <c>iconOnly</c> prop).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public HelpSegment(
        ILocalizer localizer,
        IHelpSegmentActions actions,
        bool iconOnly = false,
        HelpSegmentDiagnostics? diagnostics = null)
        : this(new HelpSegmentViewModel(localizer, actions, iconOnly, diagnostics))
    {
    }

    /// <summary>Creates the segment over an explicit state holder (tests / headless hosts).</summary>
    /// <param name="viewModel">The backing state holder.</param>
    public HelpSegment(HelpSegmentViewModel viewModel)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Left;
        VerticalAlignment = VerticalAlignment.Center;
        HorizontalContentAlignment = HorizontalAlignment.Left;
        VerticalContentAlignment = VerticalAlignment.Center;

        // web shortcuts affordance: Keyboard icon, then (expanded only) the `?` key-cap + "for shortcuts" hint.
        _shortcutsButton = BuildAffordance(
            KeyboardGlyph,
            _viewModel.ShortcutsAria,
            HelpSegmentRegistration.ShortcutsAutomationId,
            includeKeyCap: true);

        // web tour affordance: HelpCircle icon, then (expanded only) the "Take a tour" label.
        _tourButton = BuildAffordance(
            TourGlyph,
            _viewModel.TourAria,
            HelpSegmentRegistration.TourAutomationId,
            label: _viewModel.TourShort);

        // web feedback affordance: Bug icon, then (expanded only) the "Report bug" label.
        _feedbackButton = BuildAffordance(
            FeedbackGlyph,
            _viewModel.FeedbackAria,
            HelpSegmentRegistration.FeedbackAutomationId,
            label: _viewModel.FeedbackShort);

        _shortcutsButton.Click += OnShortcutsClick;
        _tourButton.Click += OnTourClick;
        _feedbackButton.Click += OnFeedbackClick;

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = RowSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(Wrap(_shortcutsButton, _viewModel.ShortcutsTooltip));
        row.Children.Add(Wrap(_tourButton, _viewModel.TourShort));
        row.Children.Add(Wrap(_feedbackButton, _viewModel.FeedbackShort));

        AutomationProperties.SetAutomationId(this, HelpSegmentRegistration.RootAutomationId);

        Content = row;

        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The canonical surface slug (<c>HelpSegment</c>).</summary>
    public static string Slug => HelpSegmentRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public HelpSegmentViewModel ViewModel => _viewModel;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _shortcutsButton.Click -= OnShortcutsClick;
        _tourButton.Click -= OnTourClick;
        _feedbackButton.Click -= OnFeedbackClick;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private Button BuildAffordance(
        string glyph,
        string accessibleName,
        string automationId,
        string? label = null,
        bool includeKeyCap = false)
    {
        var content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = AffordanceSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = IconFontSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        content.Children.Add(icon);

        // Expanded mode only (web `!iconOnly`): the `?` key-cap chip, then the "for shortcuts" hint.
        if (!_viewModel.IconOnly && includeKeyCap)
        {
            var keyCapText = new TextBlock
            {
                Text = HelpSegmentViewModel.ShortcutKeyCap,
                FontSize = KeyCapFontSize,
                Foreground = DisplayTokens.TextSecondary,
                VerticalAlignment = VerticalAlignment.Center,
            };
            var keyCap = new Border
            {
                Background = DisplayTokens.Surface,
                CornerRadius = new CornerRadius(KeyCapCornerRadius),
                Padding = new Thickness(KeyCapPaddingX, 0, KeyCapPaddingX, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Child = keyCapText,
            };
            AutomationProperties.SetAccessibilityView(keyCap, AccessibilityView.Raw);
            content.Children.Add(keyCap);

            var hint = new TextBlock
            {
                Text = _viewModel.ShortcutsHintSuffix,
                FontSize = LabelFontSize,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(hint, AccessibilityView.Raw);
            content.Children.Add(hint);
        }

        // Expanded mode only (web `!iconOnly`): the affordance's visible label.
        if (!_viewModel.IconOnly && !string.IsNullOrEmpty(label))
        {
            var labelText = new TextBlock
            {
                Text = label,
                FontSize = LabelFontSize,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(labelText, AccessibilityView.Raw);
            content.Children.Add(labelText);
        }

        var button = new Button
        {
            Content = content,
            Background = new SolidColorBrush(Colors.Transparent),
            BorderBrush = new SolidColorBrush(Colors.Transparent),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(ButtonPaddingX, ButtonPaddingY, ButtonPaddingX, ButtonPaddingY),
            MinWidth = 0,
            MinHeight = 0,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // web aria-label lives on the button; the icon / key-cap / label subtree is decorative so the accessible
        // name is authoritative (mirrors the web aria-label overriding the inner spans).
        AutomationProperties.SetName(button, accessibleName);
        AutomationProperties.SetAutomationId(button, automationId);

        return button;
    }

    private static TsTooltip Wrap(Button button, string tooltip) => new()
    {
        Hint = tooltip,
        Content = button,
        HorizontalAlignment = HorizontalAlignment.Left,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
        _viewModel.MarkOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnShortcutsClick(object sender, RoutedEventArgs e) => _viewModel.OpenKeyboardShortcuts();

    private void OnTourClick(object sender, RoutedEventArgs e) => _viewModel.OpenTour();

    private void OnFeedbackClick(object sender, RoutedEventArgs e) => _viewModel.OpenFeedback();
}
