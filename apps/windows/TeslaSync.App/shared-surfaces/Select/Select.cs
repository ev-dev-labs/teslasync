using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using System.ComponentModel;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.SelectSurface;

/// <summary>
/// The native WinUI 3 <c>Select</c> shared surface — a parity port of the web <c>Select</c> primitive
/// (<c>web/src/components/ui/Select.tsx</c>), the shared accessible dropdown used by settings forms, filter bars
/// and bulk-action toolbars. Like the web source it composes a form label (web <c>&lt;Label&gt;</c>, with a visible
/// <c>*</c> + screen-reader "required" marker) and an optional field-level help icon (web <c>&lt;HelpIcon&gt;</c>)
/// above the chooser, mapping the web <c>&lt;select&gt;</c> to the Windows-idiomatic <see cref="ComboBox"/> rather
/// than retemplating it, so the dropdown, focus ring and light / dark / high-contrast themes all flow from Fluent
/// and the generated design tokens (P1/S9). It binds the <see cref="SelectViewModel"/> and reproduces every branch
/// the web source renders: the optional label row, the required marker, the help affordance, the empty-selection prompt, the
/// option list (including non-selectable disabled options), the empty-options dropdown, the controlled selection,
/// the validation-error border + message, the helper hint (hidden while an error is present, web
/// <c>hint &amp;&amp; !error</c>) and the disabled state.
///
/// <para>
/// The web source is presentational and prop-driven (its consuming page owns any data fetching), so — like the
/// shipped <c>Checkbox</c> and <c>HelpTooltip</c> surfaces — it has no loading / fetch-error / stale / offline
/// chrome to reproduce; the data-resolved states it actually has (above) are reproduced in full, and the dropdown
/// is never hidden — an empty option list still renders a chooser showing the empty-selection prompt. Accessibility is
/// first-class: the <see cref="ComboBox"/> reports the native <see cref="AutomationControlType.ComboBox"/> with the
/// label (plus the localized "required") as its accessible name and the error / hint as its help text (the native
/// analogue of the web <c>aria-describedby</c>); the help trigger carries the per-field "Help for {{field}}"
/// accessible name and reveals its body on hover / focus. The view performs no I/O, resolves its strings through
/// the i18n facade (P1/S10), and emits the <c>view.opened</c> diagnostic once when shown.
/// </para>
/// </summary>
[System.Diagnostics.CodeAnalysis.SuppressMessage(
    "Naming",
    "CA1716:Identifiers should not match keywords",
    Justification = "Surface name mirrors the web Select primitive it ports (P2 shared-surfaces/0225 spec); the cross-platform parity contract mandates the Select name.")]
public sealed partial class Select : ContentControl, IDisposable
{
    private const double RequiredMarkerFontSize = 14;  // web Label `text-sm` — the `*` sits inline with the label.
    private const double HelpTriggerPadding = 2;        // tight ghost padding around the help glyph (web inline-flex trigger).

    private readonly SelectViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly SelectDiagnostics _diagnostics;
    private readonly Microsoft.UI.Dispatching.DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new()
    {
        Orientation = Orientation.Vertical,
        Spacing = SelectRegistration.StackSpacing,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly StackPanel _labelRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = SelectRegistration.LabelGap,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _label = new()
    {
        FontSize = RequiredMarkerFontSize,
        FontWeight = Microsoft.UI.Text.FontWeights.Medium,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _requiredMarker = new()
    {
        Text = "*",
        FontSize = RequiredMarkerFontSize,
        VerticalAlignment = VerticalAlignment.Center,
        Visibility = Visibility.Collapsed,
    };

    private readonly Button _helpTrigger = new()
    {
        Background = new SolidColorBrush(Colors.Transparent),
        BorderBrush = new SolidColorBrush(Colors.Transparent),
        BorderThickness = new Thickness(0),
        Padding = new Thickness(HelpTriggerPadding),
        MinWidth = 0,
        MinHeight = 0,
        VerticalAlignment = VerticalAlignment.Center,
        Visibility = Visibility.Collapsed,
    };

    private readonly FontIcon _helpGlyph = new()
    {
        Glyph = SelectRegistration.HelpGlyph,
        FontSize = SelectRegistration.HelpGlyphSize,
        VerticalAlignment = VerticalAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Center,
    };

    private readonly ToolTip _helpToolTip = new();

    private readonly ComboBox _combo = new()
    {
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly TextBlock _helper = new()
    {
        FontSize = SelectRegistration.HelperFontSize,
        TextWrapping = TextWrapping.Wrap,
        Visibility = Visibility.Collapsed,
    };

    private bool _syncing;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates a gallery-safe surface over a default (empty, unlabeled, medium) state and the passthrough
    /// localizer — the native analogue of mounting the web component in an isolated host. Production callers use
    /// the seam constructor.
    /// </summary>
    public Select()
        : this(new SelectViewModel(), PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the surface over its state holder, i18n facade and an optional PII-safe diagnostics collector.</summary>
    /// <param name="viewModel">The bound state holder (the web props); the surface's P1/S8 seam.</param>
    /// <param name="localizer">The i18n facade (P1/S10) the required marker, help and accessible names resolve through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event (P1/S11).</param>
    public Select(SelectViewModel viewModel, ILocalizer localizer, SelectDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = viewModel;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new SelectDiagnostics();
        _dispatcher = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();

        _helpTrigger.Content = _helpGlyph;
        ToolTipService.SetToolTip(_helpTrigger, _helpToolTip);

        _labelRow.Children.Add(_label);
        _labelRow.Children.Add(_requiredMarker);
        _labelRow.Children.Add(_helpTrigger);

        _root.Children.Add(_labelRow);
        _root.Children.Add(_combo);
        _root.Children.Add(_helper);
        Content = _root;

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        // The wrapper carries no accessible node of its own — the ComboBox (the chooser) and the help Button are
        // the real automation nodes, exactly as the web root <div> is structural and the <select> / help button
        // carry the semantics. The visible label and required `*` are decorative (web `aria-hidden`); their text
        // is folded into the ComboBox's accessible name.
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_label, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_requiredMarker, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_helpGlyph, AccessibilityView.Raw);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _combo.SelectionChanged += OnComboSelectionChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>Select</c>).</summary>
    public static string Slug => SelectRegistration.Slug;

    /// <summary>The bound state holder (exposed for hosting / diagnostics / tests).</summary>
    public SelectViewModel ViewModel => _viewModel;

    /// <summary>Detach from the state holder and stop responding (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _combo.SelectionChanged -= OnComboSelectionChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
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

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e) => Marshal(Render);

    private void OnComboSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        // Ignore the programmatic selection we set while projecting; only a genuine user pick routes back to the
        // state holder (the web <select> onChange path).
        if (_syncing)
        {
            return;
        }

        string? value = (_combo.SelectedItem as ComboBoxItem)?.Tag as string;
        _viewModel.SelectValue(value);
    }

    private void Render()
    {
        SelectDisplay display = SelectProjection.Project(_viewModel.State, _localizer);

        RenderLabelRow(display);
        RenderCombo(display);
        RenderHelper(display);
    }

    private void RenderLabelRow(SelectDisplay display)
    {
        _labelRow.Visibility = display.HasLabel ? Visibility.Visible : Visibility.Collapsed;
        if (!display.HasLabel)
        {
            return;
        }

        // web Label: `text-sm font-medium text-[var(--text-secondary)]`.
        _label.Text = display.LabelText;
        _label.Foreground = DisplayTokens.TextSecondary;

        // web Label required `*`: `text-rose-300`, aria-hidden — mapped to the danger token.
        _requiredMarker.Foreground = DisplayTokens.Brush("TsColorDangerBrush");
        _requiredMarker.Visibility = display.ShowRequiredMarker ? Visibility.Visible : Visibility.Collapsed;

        RenderHelp(display);
    }

    private void RenderHelp(SelectDisplay display)
    {
        _helpTrigger.Visibility = display.HelpVisible ? Visibility.Visible : Visibility.Collapsed;
        if (!display.HelpVisible)
        {
            return;
        }

        // web HelpIcon: `text-[var(--text-muted)]` glyph, a per-field accessible name, and a tooltip body.
        _helpGlyph.Foreground = DisplayTokens.TextMuted;
        AutomationProperties.SetName(_helpTrigger, display.HelpAccessibleLabel);
        _helpToolTip.Content = display.HelpText;
        _helpToolTip.Placement = ToPlacementMode(display.HelpPlacement);
    }

    private void RenderCombo(SelectDisplay display)
    {
        SelectMetrics metrics = display.Metrics;

        _combo.FontSize = metrics.FontSize;
        _combo.Padding = new Thickness(metrics.PaddingX, metrics.PaddingY, metrics.PaddingX, metrics.PaddingY);
        _combo.CornerRadius = new CornerRadius(metrics.CornerRadius);
        _combo.BorderThickness = new Thickness(metrics.BorderThickness);
        _combo.MinHeight = metrics.MinHeight > 0 ? metrics.MinHeight : double.NaN;
        _combo.Foreground = DisplayTokens.TextPrimary;
        _combo.IsEnabled = !display.IsDisabled;

        // web select: `bg-[var(--surface-1)]` chrome stays the Fluent themed background; only the error border
        // is overridden (web `error && 'border-red-500'`) — otherwise the default Fluent border applies.
        if (display.HasError)
        {
            _combo.BorderBrush = DisplayTokens.Brush("TsColorDangerBrush");
        }
        else
        {
            _combo.ClearValue(Control.BorderBrushProperty);
        }

        // web Select.tsx L73 `<option value=""></option>` maps to the ComboBox prompt (shown
        // while nothing is selected) — the Windows-idiomatic empty-selection affordance.
        _combo.PlaceholderText = display.HasPrompt ? display.PromptText : string.Empty; // parity:allow ComboBox.PlaceholderText is the WinUI empty-selection prompt API

        // Repopulating the items raises SelectionChanged; guard so it does not echo back as a user selection.
        _syncing = true;
        try
        {
            _combo.Items.Clear();
            foreach (SelectOption option in display.Options)
            {
                _combo.Items.Add(new ComboBoxItem
                {
                    Content = option.Label,
                    Tag = option.Value,
                    IsEnabled = !option.IsDisabled,
                });
            }

            _combo.SelectedIndex = display.SelectedIndex >= 0 && display.SelectedIndex < _combo.Items.Count
                ? display.SelectedIndex
                : -1;
        }
        finally
        {
            _syncing = false;
        }

        // web <select> accessible name comes from the associated <Label> (incl. the SR-only "required"); the
        // error / hint is wired via aria-describedby — the native analogue is Name + HelpText on the ComboBox.
        if (!string.IsNullOrEmpty(display.AccessibleName))
        {
            AutomationProperties.SetName(_combo, display.AccessibleName);
        }
        else
        {
            _combo.ClearValue(AutomationProperties.NameProperty);
        }

        if (!string.IsNullOrEmpty(display.DescribedText))
        {
            AutomationProperties.SetHelpText(_combo, display.DescribedText);
        }
        else
        {
            _combo.ClearValue(AutomationProperties.HelpTextProperty);
        }
    }

    private void RenderHelper(SelectDisplay display)
    {
        if (display.HasError)
        {
            // web error `<p>`: `text-xs text-red-500` — mapped to the danger token.
            _helper.Text = display.ErrorText;
            _helper.Foreground = DisplayTokens.Brush("TsColorDangerBrush");
            _helper.Visibility = Visibility.Visible;
        }
        else if (display.ShowHint)
        {
            // web hint `<p>`: `text-xs text-[var(--text-muted)]`.
            _helper.Text = display.HintText;
            _helper.Foreground = DisplayTokens.TextMuted;
            _helper.Visibility = Visibility.Visible;
        }
        else
        {
            _helper.Text = string.Empty;
            _helper.Visibility = Visibility.Collapsed;
        }
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

    private static PlacementMode ToPlacementMode(SelectHelpPlacement placement) => placement switch
    {
        SelectHelpPlacement.Bottom => PlacementMode.Bottom,
        SelectHelpPlacement.Left => PlacementMode.Left,
        SelectHelpPlacement.Right => PlacementMode.Right,
        _ => PlacementMode.Top,
    };

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SelectAutomationPeer(this);

    /// <summary>
    /// Reports the wrapper as a structural <see cref="AutomationControlType.Group"/> with no accessible name —
    /// the inner <see cref="ComboBox"/> (the chooser) and help <see cref="Button"/> are the meaningful nodes,
    /// faithful to the web root <c>&lt;div&gt;</c> being a layout container while the <c>&lt;select&gt;</c> and
    /// help button carry the semantics.
    /// </summary>
    private sealed partial class SelectAutomationPeer : FrameworkElementAutomationPeer
    {
        public SelectAutomationPeer(Select owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetClassNameCore() => nameof(Select);
    }
}
