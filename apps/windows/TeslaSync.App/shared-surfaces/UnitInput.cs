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
/// The native WinUI 3 <c>UnitInput</c> shared surface — a parity port of the web <c>&lt;UnitInput&gt;</c>
/// primitive (web/src/components/forms/UnitInput.tsx). The web component is a presentational, unit-aware
/// number field that stores its value in TeslaSync's canonical metric (miles, mph, °C, kWh, percent,
/// currency-as-typed), renders it formatted for the user's preferred unit (derived from <c>useSettings()</c>
/// on every render), parses user-typed text on blur / Enter (locale-aware decimal separators, a tolerated
/// unit symbol such as "60 mph" / "75 kWh") and re-syncs from the parent's value only while the field is not
/// being edited. This surface reproduces it with the shared <see cref="TsInput"/> field (the native
/// <c>@/components/ui</c> <c>Input</c>) carrying a trailing muted unit-symbol adornment (the web
/// <c>suffix</c> span, <c>text-xs text-[var(--text-muted)]</c>, <c>aria-hidden</c>) and an optional visible
/// label header (the web passthrough <c>label</c>). All state flows through <see cref="UnitInputViewModel"/>
/// over the <see cref="IUnitInputSource"/> seam (P1/S8); the view performs no I/O and no unit math itself —
/// it renders the projected <see cref="UnitInputDisplay"/> and forwards focus / text / Enter to the holder,
/// raising <see cref="ValueCommitted"/> (the web <c>onChange</c>) when the holder commits. Because the
/// component reads no network data, there is no loading / error / stale / offline chrome (exactly as the
/// sibling CurrencyInput surface): the reproduced branches are the populated value, the empty field (a blank
/// editable area carrying the symbol affordance and the accessible name, never a nameless blank box), the
/// focused editing buffer and the disabled / error passthrough states. The field is named for Narrator by
/// the caller's aria label (or the visible label, or the i18n default) and emits the <c>view.opened</c>
/// diagnostic once on <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class UnitInput : ContentControl, IDisposable
{
    private const double RootSpacing = 4;          // web space-y-1 between the label and the field
    private const double HeaderFontSize = 14;      // web text-sm label
    private const double SymbolFontSize = 12;      // web text-xs symbol adornment
    private const double SymbolInset = 12;          // web suffix right-3 (the field's content-right)
    private const double SymbolGap = 6;             // gap between the value text and the symbol
    private const double FieldPaddingVertical = 8;  // TsInputStyle Padding top/bottom
    private const double FieldPaddingLeft = 12;     // TsInputStyle Padding left

    private readonly UnitInputViewModel _viewModel;
    private readonly UnitInputDiagnostics _diagnostics;
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
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
        Margin = new Thickness(0, 0, SymbolInset, 0),
        IsHitTestVisible = false,
    };

    private bool _suppressTextChanged;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates an empty distance field over a fresh in-memory source, the i18n passthrough and the system
    /// defaults (the parameterless designer / host entry point).
    /// </summary>
    public UnitInput()
        : this(new UnitInputSource(), localizer: null, diagnostics: null)
    {
    }

    /// <summary>Creates the field over its props seam (P1/S8), the i18n facade and the diagnostics sink.</summary>
    /// <param name="source">The props seam the field binds to.</param>
    /// <param name="localizer">The i18n facade the default accessible label resolves through; null uses the passthrough.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public UnitInput(
        IUnitInputSource source,
        ILocalizer? localizer = null,
        UnitInputDiagnostics? diagnostics = null)
        : this(new UnitInputViewModel(source, localizer ?? PassthroughLocalizer.Instance), diagnostics)
    {
    }

    /// <summary>Creates the field over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public UnitInput(UnitInputViewModel viewModel, UnitInputDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new UnitInputDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        _input.InputScope = NumericInputScope();
        _input.TextChanged += OnInputTextChanged;
        _input.GotFocus += OnInputGotFocus;
        _input.LostFocus += OnInputLostFocus;
        _input.KeyDown += OnInputKeyDown;

        // web data-testid="unit-input-symbol" + aria-hidden: a decorative, non-interactive adornment.
        AutomationProperties.SetAutomationId(_symbol, UnitInputRegistration.SymbolAutomationId);
        AutomationProperties.SetAccessibilityView(_symbol, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_header, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(this, UnitInputRegistration.RootAutomationId);

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
    /// Raised when the field commits an edit on blur / Enter — the native port of the web <c>onChange</c>.
    /// Carries the parsed canonical value (or null when cleared). Forwarded from the backing holder.
    /// </summary>
    public event EventHandler<UnitInputCommit>? ValueCommitted
    {
        add => _viewModel.ValueCommitted += value;
        remove => _viewModel.ValueCommitted -= value;
    }

    /// <summary>The canonical surface slug (<c>UnitInput</c>).</summary>
    public static string Slug => UnitInputRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public UnitInputViewModel ViewModel => _viewModel;

    /// <summary>The accessible name the field reports to Narrator (the aria label, the visible label, or the i18n default).</summary>
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
        // web inputMode="decimal": hint the numeric soft keyboard while still allowing the unit symbol /
        // separators to be typed.
        var scope = new InputScope();
        scope.Names.Add(new InputScopeName(InputScopeNameValue.Number));
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
        if (e.PropertyName == nameof(UnitInputViewModel.Display) ||
            e.PropertyName == nameof(UnitInputViewModel.Text))
        {
            Marshal(Render);
        }
    }

    private void Render()
    {
        UnitInputDisplay display = _viewModel.Display;

        // Re-sync the field text to the holder's buffer without re-entering the change handler (the
        // programmatic set would otherwise echo back through OnInputTextChanged and fight the user's caret).
        if (!string.Equals(_input.Text, _viewModel.Text, StringComparison.Ordinal))
        {
            _suppressTextChanged = true;
            _input.Text = _viewModel.Text;
            _suppressTextChanged = false;
        }

        _input.IsEnabled = display.IsEnabled;
        _input.HasError = display.HasError;
        _input.Padding = new Thickness(FieldPaddingLeft, FieldPaddingVertical, RightPaddingFor(display.Symbol), FieldPaddingVertical);

        _symbol.Text = display.Symbol;
        _symbol.Foreground = DisplayTokens.TextMuted;
        _symbol.Visibility = string.IsNullOrEmpty(display.Symbol) ? Visibility.Collapsed : Visibility.Visible;

        _header.Text = display.Label ?? string.Empty;
        _header.Foreground = DisplayTokens.TextSecondary;
        _header.Visibility = display.HasLabel ? Visibility.Visible : Visibility.Collapsed;

        // web aria-label / label association: the field name overrides the visible header for assistive tech.
        AutomationProperties.SetName(_input, display.AccessibleName);
    }

    private static double RightPaddingFor(string symbol)
    {
        if (string.IsNullOrEmpty(symbol))
        {
            return FieldPaddingLeft;
        }

        // Reserve room for the trailing symbol (web pr-…): a gap after the value text, an estimate of the
        // symbol's rendered width at the adornment font size, then the inset. Multi-character symbols
        // (km/h, kWh) widen it.
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
