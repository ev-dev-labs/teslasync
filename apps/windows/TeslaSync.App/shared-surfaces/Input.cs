using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.InputSurface;

/// <summary>
/// The native WinUI 3 <c>Input</c> shared surface — a parity port of <c>web/src/components/ui/Input.tsx</c>,
/// the shared single-line form field. It reproduces the web component's composition: an optional label row (the
/// tokenized <see cref="Label"/> atom, an optional required asterisk, and an optional inline
/// <see cref="TsHelpTooltip"/> help affordance — all gated behind the presence of a label exactly as the web
/// nests them inside <c>{label &amp;&amp; (...)}</c>), the field itself (the shared <see cref="TsInput"/>
/// primitive, which already carries the web input's tokenized border / surface chrome and the
/// <c>border-red-500</c> error border via <see cref="TsInput.HasError"/>) with an optional leading icon and
/// trailing suffix overlaid on the field (the web absolutely-positioned <c>icon</c> / <c>suffix</c> with the
/// matching <c>pl-10</c> / <c>pr-10</c> text reserve), and the mutually-exclusive validation error
/// (<see cref="ErrorText"/>) XOR helper hint (<see cref="HelperText"/>) row beneath. It binds the
/// <see cref="InputViewModel"/> over the i18n facade and renders every branch the web source has.
///
/// <para>
/// State coverage: the web component is purely presentational and prop-driven — its parent owns the value and
/// any data fetching — so it has no loading / error / stale / offline fetch chrome to reproduce; a malformed
/// store, network round-trip or query-freshness concept simply does not exist on this surface. The states it
/// actually has are reproduced in full: the bare field, the labelled field, the required marker, the help
/// affordance, the leading icon, the trailing suffix, the disabled field, the validation error (red border +
/// alert row) and the helper hint (each of the four <c>sm</c> / <c>md</c> / <c>lg</c> / <c>auto</c> sizes), and
/// the error / hint rows are always laid out and toggled rather than hiding the surface. Accessibility mirrors
/// the web ARIA wiring through UI Automation: the field's label association
/// (<see cref="AutomationProperties.LabeledByProperty"/>), <c>aria-required</c>
/// (<see cref="AutomationProperties.IsRequiredForFormProperty"/>), <c>aria-describedby</c>
/// (<see cref="AutomationProperties.GetDescribedBy(DependencyObject)"/> pointing at the error XOR hint row), and
/// the error row as an assertive live region so a validation message is voiced without moving focus. The text
/// honours the system font scale through the tokenized field font, and the surface animates nothing so
/// reduced-motion needs no handling. All id derivation and i18n happen in the WinUI-free
/// <see cref="InputViewModel"/> / <see cref="InputProjection"/>; the view never generates ids or reads strings
/// itself, and it never performs HTTP. The <c>view.opened</c> diagnostic is emitted exactly once on
/// <see cref="FrameworkElement.Loaded"/>.
/// </para>
/// </summary>
public sealed partial class Input : ContentControl, IDisposable
{
    // web wrapper `space-y-1` (0.25rem) between the label row, field and hint/error rows.
    private const double RowSpacing = 4;

    // web label row `gap-1` (0.25rem) between the label text, required marker and help affordance.
    private const double LabelGap = 4;

    private readonly InputViewModel _viewModel;
    private readonly InputDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = RowSpacing };
    private readonly StackPanel _labelRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = LabelGap,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Label _label = new();
    private readonly Text _requiredMarker = new() { Value = "*" };
    private readonly TsHelpTooltip _help = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly Grid _fieldGrid = new() { HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly TsInput _input = new() { HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly ContentPresenter _iconHost = new()
    {
        HorizontalAlignment = HorizontalAlignment.Left,
        VerticalAlignment = VerticalAlignment.Center,
        IsHitTestVisible = false, // web icon is a decorative span; clicks fall through to the field.
        Visibility = Visibility.Collapsed,
    };

    private readonly ContentPresenter _suffixHost = new()
    {
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
        Visibility = Visibility.Collapsed,
    };

    private readonly ErrorText _error = new() { Visibility = Visibility.Collapsed };
    private readonly HelperText _hint = new() { Visibility = Visibility.Collapsed };

    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe surface over the passthrough localizer and the empty model — the native analogue
    /// of mounting the web component in an isolated gallery host. Production callers use the seam constructor.
    /// </summary>
    public Input()
        : this(PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the surface over its i18n facade, an initial model and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade the required word and help accessible name resolve through (P1/S10).</param>
    /// <param name="model">The initial render model; defaults to <see cref="InputModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public Input(ILocalizer localizer, InputModel? model = null, InputDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new InputViewModel(localizer, model);
        _diagnostics = diagnostics ?? new InputDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        // web required asterisk: `text-rose-300` (the danger token); the body Text atom inherits it.
        _requiredMarker.Foreground = TypographyTokens.Brush("TsColorDangerBrush");

        // The "*" is decorative (web aria-hidden); the label's accessible name carries the spoken "required".
        AutomationProperties.SetAccessibilityView(_requiredMarker, AccessibilityView.Raw);

        _labelRow.Children.Add(_label);
        _labelRow.Children.Add(_requiredMarker);
        _labelRow.Children.Add(_help);

        // The icon / suffix overlay the field (added after it so they render on top), matching the web
        // absolutely-positioned adornments over the input.
        _fieldGrid.Children.Add(_input);
        _fieldGrid.Children.Add(_iconHost);
        _fieldGrid.Children.Add(_suffixHost);

        _root.Children.Add(_labelRow);
        _root.Children.Add(_fieldGrid);
        _root.Children.Add(_error);
        _root.Children.Add(_hint);
        Content = _root;

        // web error `<p>` carries the validation text; make it an assertive live region so a message is voiced
        // without the user moving focus.
        LiveRegion.Configure(_error, assertive: true);

        // The web wrapper `<div>` carries no ARIA role of its own; keep it out of the automation tree so the
        // label, field and hint/error rows are the only nodes Narrator sees.
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);

        _input.TextChanged += OnInputTextChanged;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>Raised when the field text changes (the web <c>onChange</c>), forwarding the field's event.</summary>
    public event TextChangedEventHandler? TextChanged;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>Input</c>).</summary>
    public static string Slug => InputRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public InputViewModel ViewModel => _viewModel;

    /// <summary>The render model (web props); reassigning re-projects and re-renders the surface.</summary>
    public InputModel Model
    {
        get => _viewModel.Model;
        set => _viewModel.Model = value;
    }

    /// <summary>The field text (the web input <c>value</c>); two-way with the hosted field.</summary>
    public string Text
    {
        get => _input.Text;
        set => _input.Text = value ?? string.Empty;
    }

    /// <summary>The leading icon overlaid at the field's start (the web <c>icon</c>); null shows none.</summary>
    public object? Icon
    {
        get => _iconHost.Content;
        set
        {
            _iconHost.Content = value;
            _iconHost.Visibility = value is null ? Visibility.Collapsed : Visibility.Visible;
            Render();
        }
    }

    /// <summary>The trailing suffix overlaid at the field's end (the web <c>suffix</c>); null shows none.</summary>
    public object? Suffix
    {
        get => _suffixHost.Content;
        set
        {
            _suffixHost.Content = value;
            _suffixHost.Visibility = value is null ? Visibility.Collapsed : Visibility.Visible;
            Render();
        }
    }

    /// <summary>Detach from the state holder and stop responding (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _input.TextChanged -= OnInputTextChanged;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
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

    private void OnInputTextChanged(object sender, TextChangedEventArgs e) => TextChanged?.Invoke(this, e);

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(InputViewModel.Display))
        {
            Marshal(Render);
        }
    }

    private void Render()
    {
        InputDisplay display = _viewModel.Display;

        // ── label row (web `{label && (<div>...<Label/>{help && <HelpIcon/>}</div>)}`) ──
        _labelRow.Visibility = display.HasLabel ? Visibility.Visible : Visibility.Collapsed;
        _label.Value = display.Label;

        // web <Label htmlFor>: the label is the field's accessible name (with the hidden "required" word).
        AutomationProperties.SetName(_label, display.LabelAccessibleName);

        _requiredMarker.Visibility = display.ShowRequiredMarker ? Visibility.Visible : Visibility.Collapsed;

        _help.Visibility = display.ShowHelp ? Visibility.Visible : Visibility.Collapsed;
        if (display.ShowHelp)
        {
            // Setting Hint installs the visual tooltip; override the Narrator name with the web aria-label
            // ("Help for {id}" / "More info") and keep the help text as the spoken description.
            _help.Hint = display.HelpText;
            AutomationProperties.SetName(_help, display.HelpAccessibleName);
            AutomationProperties.SetHelpText(_help, display.HelpText);
            SetOptionalAutomationId(_help, display.HelpDescribedById);
        }

        // ── field (web `<input>` with size classes, error border, icon/suffix padding reserve) ──
        ApplyFieldMetrics(display.Metrics);

        _input.HasError = display.Invalid;
        _input.IsEnabled = !display.Disabled;
        _input.PlaceholderText = Model.PromptText ?? string.Empty; // parity:allow web `placeholder` → WinUI hint API

        // web `id={inputId}` (React omits an undefined id); set it only when one resolved.
        SetOptionalAutomationId(_input, string.IsNullOrEmpty(display.InputId) ? null : display.InputId);

        // web aria-required.
        AutomationProperties.SetIsRequiredForForm(_input, display.Required);

        // web <Label htmlFor> association: announce the field with its label text.
        if (display.HasLabel)
        {
            AutomationProperties.SetLabeledBy(_input, _label);
        }
        else
        {
            _input.ClearValue(AutomationProperties.LabeledByProperty);
        }

        // ── error XOR hint rows (web `error ? <p .error> : hint ? <p .hint> : null`) ──
        _error.Value = display.ErrorText ?? string.Empty;
        _error.Visibility = display.ShowError ? Visibility.Visible : Visibility.Collapsed;
        SetOptionalAutomationId(_error, display.ErrorId);

        _hint.Value = display.HintText ?? string.Empty;
        _hint.Visibility = display.ShowHint ? Visibility.Visible : Visibility.Collapsed;
        SetOptionalAutomationId(_hint, display.HintId);

        // web aria-describedby: point the field at the error XOR hint row (whichever renders).
        ApplyDescribedBy(display);

        // Voice the validation error on the assertive live region (web announcement).
        if (display.ShowError)
        {
            LiveRegion.Announce(_error);
        }
    }

    private void ApplyFieldMetrics(InputMetrics metrics)
    {
        bool hasIcon = _iconHost.Content is not null;
        bool hasSuffix = _suffixHost.Content is not null;

        // web `icon && pl-10` / `suffix && pr-10`: reserve text room for the overlaid adornment; otherwise the
        // size's own horizontal padding (`px-*`).
        double left = hasIcon ? InputMetrics.IconReserve : metrics.PaddingLeft;
        double right = hasSuffix ? InputMetrics.SuffixReserve : metrics.PaddingRight;
        _input.Padding = new Thickness(left, metrics.PaddingTop, right, metrics.PaddingBottom);
        _input.MinHeight = metrics.MinHeight;

        // Resolve the font size from the design token (so the system font scale + light/dark flow through),
        // falling back to the web pixel size. `auto` follows the body/density base token.
        _input.FontSize = TypographyTokens.Size(metrics.FontSizeTokenKey, metrics.FontSizeFallback);

        _iconHost.Margin = new Thickness(InputMetrics.IconInset, 0, 0, 0);
        _suffixHost.Margin = new Thickness(0, 0, InputMetrics.SuffixInset, 0);
    }

    private void ApplyDescribedBy(InputDisplay display)
    {
        var describedBy = AutomationProperties.GetDescribedBy(_input);
        describedBy.Clear();

        if (display.ShowError)
        {
            describedBy.Add(_error);
        }
        else if (display.ShowHint)
        {
            describedBy.Add(_hint);
        }
    }

    private static void SetOptionalAutomationId(FrameworkElement element, string? automationId)
    {
        // web sets an element id only when that element renders; clear it otherwise.
        AutomationProperties.SetAutomationId(element, automationId ?? string.Empty);
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
}
