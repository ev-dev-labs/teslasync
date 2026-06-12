using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Automation.Provider;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.A11y;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using Windows.System;
using Microsoft.UI.Text;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>Combobox</c> shared surface — a parity port of the web <c>Combobox</c>
/// (web/src/components/forms/Combobox.tsx), the shared WAI-ARIA "type to filter then pick" autocomplete used
/// by signal pickers, geocoded address inputs and vehicle pickers. Like the web source it composes its own
/// editable input + listbox (rather than wrapping the platform <see cref="ComboBox"/>): a tokenized input box
/// hosting a borderless <see cref="TextBox"/> and a trailing cluster of an in-flight <see cref="ProgressRing"/>,
/// a clear (×) <see cref="TsButton"/> and a chevron toggle, with the option listbox in a <see cref="Popup"/>
/// anchored under the input. It binds the <see cref="ComboboxViewModel"/> (over the static-array / async-loader
/// option seam, the i18n facade and the announcer bus) and reproduces every state the web source renders: the
/// loading row + spinner while a fetch is in flight, the friendly "No results" row when nothing matched (the
/// async error path lands here too), the option rows with a keyboard-driven active descendant, and the
/// "{{count}} more — refine search" overflow row when the list is capped. The input carries the combobox
/// Narrator semantics (role, expanded, active descendant, name) and every interactive control has an
/// accessible name; result-count changes are announced through the shared announcer. The view performs no I/O
/// and emits the <c>view.opened</c> diagnostic once when shown.
///
/// <para>
/// Native idiom note: closing is driven by committing a selection, Esc, the chevron toggle and Tab (the robust
/// WinUI path) rather than the web's document-mousedown / blur bookkeeping, because a <see cref="Popup"/>'s
/// content lives outside the control's focus subtree. The web component is a controlled presentational
/// primitive with no query-freshness or connectivity concept, so it has no stale / offline chrome to
/// reproduce — the loading / empty / results states above are the complete set.
/// </para>
/// </summary>
public sealed partial class Combobox : ContentControl, IDisposable
{
    private const string ClearGlyph = "\uE894";        // Segoe Fluent "Clear" — clears the selection (web × icon).
    private const string ChevronDownGlyph = "\uE70D";  // Segoe Fluent "ChevronDown" — listbox closed.
    private const string ChevronUpGlyph = "\uE70E";    // Segoe Fluent "ChevronUp" — listbox open (web rotate-180).
    private const double InputCornerRadius = 6;        // web rounded-md.
    private const double DropdownCornerRadius = 6;     // web rounded-md.
    private const double DropdownMaxHeight = 256;      // web max-h-64.
    private const double RowPaddingX = 12;             // web px-3.
    private const double RowPaddingY = 6;              // web py-1.5.
    private const double SpinnerSize = 16;
    private const double LabelFontSize = 12;           // web text-xs.
    private const double OptionFontSize = 14;          // web text-sm.
    private const double StatusFontSize = 12;          // web text-xs.

    private readonly ComboboxViewModel _viewModel;
    private readonly ComboboxDiagnostics _diagnostics;

    // Fully qualified: Windows.System (imported for VirtualKey) also declares a DispatcherQueue.
    private readonly Microsoft.UI.Dispatching.DispatcherQueue? _dispatcher;
    private readonly bool _hideLabel;

    private readonly StackPanel _root = new() { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly TextBlock _label = new() { FontSize = LabelFontSize, FontWeight = FontWeights.Medium };
    private readonly TsVisuallyHidden _hiddenLabel = new();
    private readonly Border _inputBox = new()
    {
        CornerRadius = new CornerRadius(InputCornerRadius),
        BorderThickness = new Thickness(1),
        Padding = new Thickness(4, 2, 4, 2),
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly Grid _inputGrid = new();
    private readonly TextBox _input = new()
    {
        BorderThickness = new Thickness(0),
        Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly StackPanel _trailing = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 2,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly ProgressRing _spinner = new()
    {
        Width = SpinnerSize,
        Height = SpinnerSize,
        IsActive = false,
        Visibility = Visibility.Collapsed,
    };

    private readonly TsButton _clear = new() { Variant = ButtonVariant.Icon, Size = ControlSize.Small, IconGlyph = ClearGlyph };
    private readonly TsButton _chevron = new() { Variant = ButtonVariant.Icon, Size = ControlSize.Small, IconGlyph = ChevronDownGlyph };

    private readonly Popup _popup = new() { DesiredPlacement = PopupPlacementMode.BottomEdgeAlignedLeft };
    private readonly Border _dropdown = new()
    {
        CornerRadius = new CornerRadius(DropdownCornerRadius),
        BorderThickness = new Thickness(1),
        Padding = new Thickness(0, 4, 0, 4),
    };

    private readonly ScrollViewer _scroll = new()
    {
        MaxHeight = DropdownMaxHeight,
        VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
        HorizontalScrollMode = ScrollMode.Disabled,
    };

    private readonly StackPanel _list = new() { Orientation = Orientation.Vertical };

    private bool _suppressTextChanged;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe surface over an empty static source and the passthrough localizer with no
    /// visible label — the native analogue of mounting the web component in an isolated gallery host. It
    /// renders the closed, empty state. Production callers use the seam constructor.
    /// </summary>
    public Combobox()
        : this(StaticComboboxOptionsSource.Empty, PassthroughLocalizer.Instance, string.Empty)
    {
    }

    /// <summary>Creates the surface over its option seam, the i18n facade, the accessible label and optional seams.</summary>
    /// <param name="source">The option provider (static array or async loader); the surface's P1/S8 seam.</param>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10).</param>
    /// <param name="label">The consumer-supplied, already-localized field + listbox accessible name (web <c>label</c>).</param>
    /// <param name="announcer">The announcer bus (web <c>useAnnouncer()</c>); defaults to the shared bus.</param>
    /// <param name="allowFreeText">When true, Enter with no active option commits the typed text (web <c>allowFreeText</c>).</param>
    /// <param name="hideLabel">When true, the label is visually hidden but still announced (web <c>hideLabel</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public Combobox(
        IComboboxOptionsSource source,
        ILocalizer localizer,
        string label,
        IAnnouncerBus? announcer = null,
        bool allowFreeText = false,
        bool hideLabel = false,
        ComboboxDiagnostics? diagnostics = null)
        : this(
            new ComboboxViewModel(source, localizer, label, announcer, allowFreeText),
            hideLabel,
            diagnostics)
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="hideLabel">When true, the label is visually hidden but still announced (web <c>hideLabel</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public Combobox(ComboboxViewModel viewModel, bool hideLabel = false, ComboboxDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new ComboboxDiagnostics();
        _dispatcher = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();
        _hideLabel = hideLabel;

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        BuildLayout();

        _input.TextChanged += OnInputTextChanged;
        _input.KeyDown += OnInputKeyDown;
        _input.GotFocus += OnInputGotFocus;
        _clear.Click += OnClearClicked;
        _chevron.Click += OnChevronClicked;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>Combobox</c>).</summary>
    public static string Slug => ComboboxRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public ComboboxViewModel ViewModel => _viewModel;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _input.TextChanged -= OnInputTextChanged;
        _input.KeyDown -= OnInputKeyDown;
        _input.GotFocus -= OnInputGotFocus;
        _clear.Click -= OnClearClicked;
        _chevron.Click -= OnChevronClicked;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _popup.IsOpen = false;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new ComboboxAutomationPeer(this);

    private void BuildLayout()
    {
        _inputGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _inputGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Grid.SetColumn(_input, 0);
        Grid.SetColumn(_trailing, 1);
        _trailing.Children.Add(_spinner);
        _trailing.Children.Add(_clear);
        _trailing.Children.Add(_chevron);
        _inputGrid.Children.Add(_input);
        _inputGrid.Children.Add(_trailing);
        _inputBox.Child = _inputGrid;

        _scroll.Content = _list;
        _dropdown.Child = _scroll;
        _popup.Child = _dropdown;

        // The visible label is a separate node; the hidden label keeps the field named for Narrator (web
        // VisuallyHidden label). Only one is mounted.
        if (_hideLabel)
        {
            _root.Children.Add(_hiddenLabel);
        }
        else
        {
            _root.Children.Add(_label);
        }

        _root.Children.Add(_inputBox);
        _root.Children.Add(_popup);
        Content = _root;

        // The input is the combobox; expose its WAI-ARIA semantics and the field name.
        AutomationProperties.SetIsRequiredForForm(_input, false);
        _label.Foreground = DisplayTokens.TextSecondary;
        _input.Foreground = DisplayTokens.TextPrimary;
        _dropdown.Background = DisplayTokens.Surface;
        _dropdown.BorderBrush = DisplayTokens.Border;
        _inputBox.BorderBrush = DisplayTokens.Border;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        // The popup's content lives at the XamlRoot level; anchor it to the input and bind the root once live.
        _popup.XamlRoot = XamlRoot;
        _popup.PlacementTarget = _inputBox;

        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        Render();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void OnInputTextChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressTextChanged)
        {
            return;
        }

        _viewModel.SetInputText(_input.Text);
    }

    private void OnInputGotFocus(object sender, RoutedEventArgs e) => _viewModel.Open();

    private void OnInputKeyDown(object sender, KeyRoutedEventArgs e)
    {
        switch (e.Key)
        {
            case VirtualKey.Down:
                _viewModel.MoveActive(1);
                e.Handled = true;
                break;
            case VirtualKey.Up:
                _viewModel.MoveActive(-1);
                e.Handled = true;
                break;
            case VirtualKey.Home when _viewModel.IsOpen:
                _viewModel.ActivateFirst();
                e.Handled = true;
                break;
            case VirtualKey.End when _viewModel.IsOpen:
                _viewModel.ActivateLast();
                e.Handled = true;
                break;
            case VirtualKey.Enter:
                e.Handled = _viewModel.CommitActiveOrFreeText();
                break;
            case VirtualKey.Escape when _viewModel.IsOpen:
                _viewModel.Close();
                e.Handled = true;
                break;
            case VirtualKey.Tab:
                // web Tab: commit the highlighted option (if any) then continue the tab order — not handled.
                _viewModel.HandleTab();
                break;
            default:
                break;
        }
    }

    private void OnClearClicked(object sender, RoutedEventArgs e)
    {
        _viewModel.Clear();
        _input.Focus(FocusState.Programmatic);
    }

    private void OnChevronClicked(object sender, RoutedEventArgs e)
    {
        _viewModel.Toggle();
        if (_viewModel.IsOpen)
        {
            _input.Focus(FocusState.Programmatic);
        }
    }

    private void Render()
    {
        // Field + listbox accessible name (web label / aria-label).
        _label.Text = _viewModel.Label;
        _hiddenLabel.Text = _viewModel.Label;
        AutomationProperties.SetName(_input, _viewModel.Label);
        AutomationProperties.SetName(this, _viewModel.Label);

        // Keep the input text in sync without clobbering the caret while the user types (the view-model's text
        // already equals what the user typed, so this only fires on commit / clear / close / external set).
        if (_input.Text != _viewModel.InputText)
        {
            _suppressTextChanged = true;
            _input.Text = _viewModel.InputText;
            _input.SelectionStart = _input.Text.Length;
            _suppressTextChanged = false;
        }

        _input.IsEnabled = !_viewModel.IsDisabled;

        // Loading spinner (web in-flight indicator).
        bool showSpinner = _viewModel.IsLoading;
        _spinner.IsActive = showSpinner;
        _spinner.Visibility = showSpinner ? Visibility.Visible : Visibility.Collapsed;
        AutomationProperties.SetName(_spinner, _viewModel.LoadingLabel);

        // Clear (×) button (web showClear).
        _clear.Visibility = _viewModel.ShowClear ? Visibility.Visible : Visibility.Collapsed;
        AutomationProperties.SetName(_clear, _viewModel.ClearLabel);

        // Chevron toggle (web open/close).
        _chevron.IconGlyph = _viewModel.IsOpen ? ChevronUpGlyph : ChevronDownGlyph;
        _chevron.IsEnabled = !_viewModel.IsDisabled;
        AutomationProperties.SetName(_chevron, _viewModel.ToggleLabel);

        RenderList();

        _dropdown.MinWidth = _inputBox.ActualWidth;
        _popup.IsOpen = _viewModel.IsOpen && IsLoaded;
    }

    private void RenderList()
    {
        _list.Children.Clear();
        AutomationProperties.SetName(_list, _viewModel.Label);

        switch (_viewModel.Status)
        {
            case ComboboxResultStatus.Loading:
                _list.Children.Add(BuildStatusRow(_viewModel.LoadingLabel));
                break;
            case ComboboxResultStatus.Empty:
                _list.Children.Add(BuildStatusRow(_viewModel.NoResultsLabel));
                break;
            case ComboboxResultStatus.Results:
            default:
                var options = _viewModel.VisibleOptions;
                for (int i = 0; i < options.Count; i++)
                {
                    _list.Children.Add(BuildOptionRow(options[i], i));
                }

                // web capped-list overflow row ("{{count}} more — refine search").
                if (_viewModel.HasOverflow)
                {
                    _list.Children.Add(BuildOverflowRow(_viewModel.OverflowLabel));
                }

                break;
        }
    }

    private Border BuildOptionRow(ComboOption option, int index)
    {
        bool isActive = index == _viewModel.ActiveIndex;
        bool isSelected = _viewModel.SelectedValue is { } value && string.Equals(value, option.Value, StringComparison.Ordinal);

        var text = new TextBlock
        {
            Text = option.Label,
            FontSize = OptionFontSize,
            FontWeight = isSelected ? FontWeights.SemiBold : FontWeights.Normal,
            Foreground = option.Disabled ? DisplayTokens.TextMuted : DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var row = new Border
        {
            Child = text,
            Padding = new Thickness(RowPaddingX, RowPaddingY, RowPaddingX, RowPaddingY),
            Background = isActive ? DisplayTokens.Brush("TsColorSurfaceGlassBrush") : null,
            CornerRadius = new CornerRadius(4),
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };

        AutomationProperties.SetName(row, option.Label);
        AutomationProperties.SetAccessibilityView(text, AccessibilityView.Raw);

        if (!option.Disabled)
        {
            int captured = index;
            ComboOption capturedOption = option;
            row.PointerEntered += (_, _) => _viewModel.SetActiveIndex(captured);
            row.Tapped += (_, e) =>
            {
                e.Handled = true;
                _viewModel.CommitOption(capturedOption);
                _input.Focus(FocusState.Programmatic);
            };
        }

        return row;
    }

    private static Border BuildStatusRow(string message)
    {
        var text = new TextBlock
        {
            Text = message,
            FontSize = StatusFontSize,
            Foreground = DisplayTokens.TextMuted,
            TextWrapping = TextWrapping.Wrap,
        };

        var row = new Border
        {
            Child = text,
            Padding = new Thickness(RowPaddingX, RowPaddingY + 2, RowPaddingX, RowPaddingY + 2),
        };

        AutomationProperties.SetName(row, message);
        return row;
    }

    private static Border BuildOverflowRow(string message)
    {
        Border row = BuildStatusRow(message);
        row.BorderThickness = new Thickness(0, 1, 0, 0);
        row.BorderBrush = DisplayTokens.Border;
        return row;
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

    private sealed class ComboboxAutomationPeer : FrameworkElementAutomationPeer, IExpandCollapseProvider
    {
        public ComboboxAutomationPeer(Combobox owner)
            : base(owner)
        {
        }

        private Combobox Surface => (Combobox)Owner;

        // web aria-expanded: the combobox reports whether its listbox is open.
        public ExpandCollapseState ExpandCollapseState =>
            Surface.ViewModel.IsOpen ? ExpandCollapseState.Expanded : ExpandCollapseState.Collapsed;

        public void Expand() => Surface.ViewModel.Open();

        public void Collapse() => Surface.ViewModel.Close();

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.ComboBox;

        protected override object? GetPatternCore(PatternInterface patternInterface) =>
            patternInterface == PatternInterface.ExpandCollapse ? this : base.GetPatternCore(patternInterface);

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.ViewModel.Label : name;
        }
    }
}
