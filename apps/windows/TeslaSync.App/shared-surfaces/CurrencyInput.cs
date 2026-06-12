using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>CurrencyInput</c> shared surface — a parity port of the web <c>&lt;CurrencyInput&gt;</c>
/// primitive (web/src/components/forms/CurrencyInput.tsx). The web component is a presentational, currency-aware
/// number field that stores its value in integer micro-units, renders it formatted for the active currency/locale,
/// parses user-typed text on blur / Enter (the localized symbol either side, the ISO code, locale group separators
/// and accounting parentheses for negatives) and re-syncs from the parent's value only while the field is not being
/// edited. This surface reproduces it with the shared <see cref="TsInput"/> field (the native <c>@/components/ui</c>
/// <c>Input</c>) carrying a leading muted currency-symbol adornment (the web <c>icon</c> span, <c>text-[var(--text-muted)]</c>,
/// <c>aria-hidden</c>) and an optional visible label header (the web passthrough <c>label</c>). All state flows
/// through <see cref="CurrencyInputViewModel"/> over the <see cref="ICurrencyInputSource"/> seam (P1/S8); the view
/// performs no I/O and no currency math itself — it renders the projected <see cref="CurrencyInputDisplay"/> and
/// forwards focus / text / Enter to the holder, raising <see cref="ValueCommitted"/> (the web <c>onChange</c>) when
/// the holder commits. Because the component reads no network data, there is no loading / error / stale / offline
/// chrome (exactly as the Spinner surface): the reproduced branches are the populated value, the empty field (a
/// blank editable area carrying the symbol affordance and the accessible name, never a nameless blank box), the
/// focused editing buffer and the disabled / error passthrough states. The field is named for Narrator by the
/// caller's <c>ariaLabel</c> (or the i18n default) and emits the <c>view.opened</c> diagnostic once on
/// <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class CurrencyInput : ContentControl, IDisposable
{
    private const double RootSpacing = 4;        // web space-y-1 between the label and the field
    private const double HeaderFontSize = 14;    // web text-sm label
    private const double SymbolFontSize = 12;    // web text-xs symbol adornment
    private const double SymbolInset = 12;        // web icon left-3 (the field's content-left)
    private const double SymbolGap = 6;           // gap between the symbol and the value text
    private const double FieldPaddingVertical = 8; // TsInputStyle Padding top/bottom
    private const double FieldPaddingRight = 12;   // TsInputStyle Padding right

    private readonly CurrencyInputViewModel _viewModel;
    private readonly CurrencyInputDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new()
    {
        Orientation = Orientation.Vertical,
        Spacing = RootSpacing,
    };

    private readonly TextBlock _header = new()
    {
        FontSize = HeaderFontSize,
        TextWrapping = TextWrapping.Wrap,
        Visibility = Visibility.Collapsed,
    };

    private readonly Grid _field = new();

    private readonly TsInput _input = new()
    {
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly TextBlock _symbol = new()
    {
        FontSize = SymbolFontSize,
        HorizontalAlignment = HorizontalAlignment.Left,
        VerticalAlignment = VerticalAlignment.Center,
        Margin = new Thickness(SymbolInset, 0, 0, 0),
        IsHitTestVisible = false,
    };

    private bool _suppressTextChanged;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates an empty USD field over a fresh in-memory source, the i18n passthrough and the system defaults (the
    /// parameterless designer / host entry point).
    /// </summary>
    public CurrencyInput()
        : this(new CurrencyInputSource(), localizer: null, diagnostics: null)
    {
    }

    /// <summary>Creates the field over its props seam (P1/S8), the i18n facade and the diagnostics sink.</summary>
    /// <param name="source">The props seam the field binds to.</param>
    /// <param name="localizer">The i18n facade the default accessible label resolves through; null uses the passthrough.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public CurrencyInput(
        ICurrencyInputSource source,
        ILocalizer? localizer = null,
        CurrencyInputDiagnostics? diagnostics = null)
        : this(new CurrencyInputViewModel(source, localizer ?? PassthroughLocalizer.Instance), diagnostics)
    {
    }

    /// <summary>Creates the field over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public CurrencyInput(CurrencyInputViewModel viewModel, CurrencyInputDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new CurrencyInputDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        _input.InputScope = NumericInputScope();
        _input.TextChanged += OnInputTextChanged;
        _input.GotFocus += OnInputGotFocus;
        _input.LostFocus += OnInputLostFocus;
        _input.KeyDown += OnInputKeyDown;

        // web data-testid="currency-input-symbol" + aria-hidden: a decorative, non-interactive adornment.
        AutomationProperties.SetAutomationId(_symbol, CurrencyInputRegistration.SymbolAutomationId);
        AutomationProperties.SetAccessibilityView(_symbol, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_header, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(this, CurrencyInputRegistration.RootAutomationId);

        _field.Children.Add(_input);
        _field.Children.Add(_symbol);
        _root.Children.Add(_header);
        _root.Children.Add(_field);
        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>
    /// Raised when the field commits an edit on blur / Enter — the native port of the web <c>onChange</c>. Carries
    /// the parsed canonical micro value (or null when cleared). Forwarded from the backing holder.
    /// </summary>
    public event EventHandler<CurrencyInputCommit>? ValueCommitted
    {
        add => _viewModel.ValueCommitted += value;
        remove => _viewModel.ValueCommitted -= value;
    }

    /// <summary>The canonical surface slug (<c>CurrencyInput</c>).</summary>
    public static string Slug => CurrencyInputRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public CurrencyInputViewModel ViewModel => _viewModel;

    /// <summary>The accessible name the field reports to Narrator (the caller's label or the i18n default).</summary>
    internal string AccessibleName => _viewModel.AccessibleName;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _input.TextChanged -= OnInputTextChanged;
        _input.GotFocus -= OnInputGotFocus;
        _input.LostFocus -= OnInputLostFocus;
        _input.KeyDown -= OnInputKeyDown;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private static InputScope NumericInputScope()
    {
        // web inputMode="decimal": hint the numeric soft keyboard while still allowing the symbol / separators.
        var scope = new InputScope();
        scope.Names.Add(new InputScopeName(InputScopeNameValue.CurrencyAmountAndSymbol));
        return scope;
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

    private void OnInputTextChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressTextChanged)
        {
            return;
        }

        _viewModel.SetText(_input.Text);
    }

    private void OnInputGotFocus(object sender, RoutedEventArgs e) => _viewModel.Focus();

    private void OnInputLostFocus(object sender, RoutedEventArgs e) => _viewModel.Blur();

    private void OnInputKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == Windows.System.VirtualKey.Enter)
        {
            _viewModel.CommitFromEnter();
        }
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(CurrencyInputViewModel.Display) ||
            e.PropertyName == nameof(CurrencyInputViewModel.Text))
        {
            Marshal(Render);
        }
    }

    private void Render()
    {
        CurrencyInputDisplay display = _viewModel.Display;

        // Re-sync the field text to the holder's buffer without re-entering the change handler (the programmatic set
        // would otherwise echo back through OnInputTextChanged and fight the user's caret).
        if (!string.Equals(_input.Text, _viewModel.Text, StringComparison.Ordinal))
        {
            _suppressTextChanged = true;
            _input.Text = _viewModel.Text;
            _suppressTextChanged = false;
        }

        _input.IsEnabled = display.IsEnabled;
        _input.HasError = display.HasError;
        _input.Padding = new Thickness(LeftPaddingFor(display.Symbol), FieldPaddingVertical, FieldPaddingRight, FieldPaddingVertical);

        _symbol.Text = display.Symbol;
        _symbol.Foreground = DisplayTokens.TextMuted;
        _symbol.Visibility = string.IsNullOrEmpty(display.Symbol) ? Visibility.Collapsed : Visibility.Visible;

        _header.Text = display.Label ?? string.Empty;
        _header.Foreground = DisplayTokens.TextSecondary;
        _header.Visibility = display.HasLabel ? Visibility.Visible : Visibility.Collapsed;

        // web aria-label={ariaLabel}: the field name overrides the visible header for assistive tech.
        AutomationProperties.SetName(_input, display.AccessibleName);
    }

    private static double LeftPaddingFor(string symbol)
    {
        if (string.IsNullOrEmpty(symbol))
        {
            return SymbolInset;
        }

        // Reserve room for the leading symbol (web pl-10): the inset, an estimate of the symbol's rendered width at
        // the adornment font size, then a gap before the value text. Multi-character symbols (CHF, kr) widen it.
        double symbolWidth = Math.Max(14, symbol.Length * (SymbolFontSize * 0.7));
        return SymbolInset + symbolWidth + SymbolGap;
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
