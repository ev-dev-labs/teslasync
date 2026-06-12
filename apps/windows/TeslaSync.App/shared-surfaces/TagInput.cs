using System.ComponentModel;
using System.Threading.Tasks;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.A11y;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Windows.ApplicationModel.DataTransfer;
using Windows.Foundation;
using Windows.System;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>TagInput</c> shared surface — a parity port of the web <c>TagInput</c>
/// (web/src/components/forms/TagInput.tsx), the shared free-text tag chip field used for alert tags, vehicle
/// nicknames, custom labels and vehicle-ID lists. Like the web source it composes its own field rather than
/// wrapping a platform control: a bordered, wrapping <see cref="ChipWrapPanel"/> hosting one removable pill
/// per committed tag followed by a borderless editing <see cref="TextBox"/>, with the screen-reader tag
/// enumeration, the validator <see cref="ErrorText"/> and the at-capacity / hint <see cref="HelperText"/>
/// stacked beneath. It binds the <see cref="TagInputViewModel"/> (over the controlled value seam, the i18n
/// facade and the announcer bus) and reproduces every branch the web source renders: the empty field carrying
/// only the editing prompt and the "No tags yet" enumeration, the populated chip row with its "Tags: …"
/// enumeration, the blocking validation error, and the at-capacity state where the field is disabled and shows
/// the "Maximum N tags" helper. Enter or a separator keystroke commits, a paste splits into several chips,
/// Backspace at an empty field removes the trailing chip, and each add / duplicate / removal is announced
/// through the shared announcer. The editing field and every remove button carry an accessible name; the view
/// performs no list math itself and emits the <c>view.opened</c> diagnostic once when shown.
///
/// <para>
/// Native idiom note: the trailing <see cref="TextBox"/> is a persistent child of the chip strip (only the
/// chips are rebuilt) so the caret and focus survive a re-render, and a paste is intercepted and read from the
/// system clipboard so the whole pasted string is committed at once (web <c>handlePaste</c>). The web
/// component is a controlled presentational primitive with no query-freshness or connectivity concept, so —
/// like the shipped Combobox / CurrencyInput surfaces — it has no loading / async-error / stale / offline
/// chrome to reproduce; the empty / populated / error / at-capacity branches above are the complete set.
/// </para>
/// </summary>
public sealed partial class TagInput : ContentControl, IDisposable
{
    private const string RemoveGlyph = "\uE711";    // Segoe Fluent "ChromeClose" — the web chip X (lucide X icon).
    private const double RootSpacing = 4;            // web mb-1 / mt-1 gaps between label, field and helper.
    private const double LabelFontSize = 12;         // web text-xs label.
    private const double FieldCornerRadius = 6;      // web rounded-md.
    private const double FieldPaddingX = 8;          // web px-2.
    private const double FieldPaddingY = 6;          // web py-1.5.
    private const double ChipGap = 6;                // web gap-1.5.
    private const double ChipCornerRadius = 999;     // web rounded-full pill.
    private const double ChipFontSize = 12;          // web text-xs chips.
    private const double InputFontSize = 14;         // web text-sm input.
    private const double InputMinWidth = 96;         // web min-w-[8ch].

    private readonly TagInputViewModel _viewModel;
    private readonly TagInputDiagnostics _diagnostics;
    private readonly Microsoft.UI.Dispatching.DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new()
    {
        Spacing = RootSpacing,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly TextBlock _label = new()
    {
        FontSize = LabelFontSize,
        FontWeight = FontWeights.Medium,
        TextWrapping = TextWrapping.Wrap,
    };

    private readonly TsVisuallyHidden _hiddenLabel = new();

    private readonly Border _field = new()
    {
        CornerRadius = new CornerRadius(FieldCornerRadius),
        BorderThickness = new Thickness(1),
        Padding = new Thickness(FieldPaddingX, FieldPaddingY, FieldPaddingX, FieldPaddingY),
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly ChipWrapPanel _strip = new()
    {
        HorizontalSpacing = ChipGap,
        VerticalSpacing = ChipGap,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBox _input = new()
    {
        BorderThickness = new Thickness(0),
        Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
        MinWidth = InputMinWidth,
        FontSize = InputFontSize,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsVisuallyHidden _hiddenTags = new();
    private readonly ErrorText _error = new() { Visibility = Visibility.Collapsed };
    private readonly HelperText _helper = new() { Visibility = Visibility.Collapsed };

    private bool _suppressTextChanged;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe surface over an empty in-memory list and the passthrough localizer with no
    /// visible label — the native analogue of mounting the web component in an isolated gallery host. It
    /// renders the empty state. Production callers use the seam constructor.
    /// </summary>
    public TagInput()
        : this(
            new TagInputViewModel(new TagInputSource(), PassthroughLocalizer.Instance, string.Empty),
            diagnostics: null)
    {
    }

    /// <summary>Creates the surface over its value seam, the i18n facade, the accessible label and optional props.</summary>
    /// <param name="source">The controlled tag-list seam (web <c>value</c> / <c>onChange</c>); the P1/S8 seam.</param>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10).</param>
    /// <param name="label">The consumer-supplied, already-localized field accessible name (web <c>label</c>).</param>
    /// <param name="announcer">The announcer bus (web <c>useAnnouncer()</c>); defaults to the shared bus.</param>
    /// <param name="hideLabel">When true, the label is visually hidden but still announced (web <c>hideLabel</c>).</param>
    /// <param name="placeholder">Optional editing-prompt override (web <c>placeholder</c>); null uses the i18n default.</param>
    /// <param name="maxTags">Optional cap; once reached the field is disabled (web <c>maxTags</c>).</param>
    /// <param name="validator">Optional per-tag validator (web <c>validateTag</c>).</param>
    /// <param name="separators">Additional commit separators (web <c>separators</c>); defaults to comma.</param>
    /// <param name="lowercase">Lower-case all tags before commit (web <c>lowercase</c>).</param>
    /// <param name="disabled">Disable the field and chip removal (web <c>disabled</c>).</param>
    /// <param name="hint">Optional helper hint shown below the field when there is no error (web <c>hint</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TagInput(
        ITagInputSource source,
        ILocalizer localizer,
        string label,
        IAnnouncerBus? announcer = null,
        bool hideLabel = false,
        string? placeholder = null,
        int? maxTags = null,
        TagValidator? validator = null,
        IReadOnlyList<char>? separators = null,
        bool lowercase = false,
        bool disabled = false,
        string? hint = null,
        TagInputDiagnostics? diagnostics = null)
        : this(
            new TagInputViewModel(source, localizer, label, announcer, hideLabel, placeholder, maxTags, validator, separators, lowercase, disabled, hint),
            diagnostics)
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TagInput(TagInputViewModel viewModel, TagInputDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new TagInputDiagnostics();
        _dispatcher = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        BuildLayout();

        _input.TextChanged += OnInputTextChanged;
        _input.KeyDown += OnInputKeyDown;
        _input.LostFocus += OnInputLostFocus;
        _input.Paste += OnInputPaste;
        _field.Tapped += OnFieldTapped;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>TagInput</c>).</summary>
    public static string Slug => TagInputRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public TagInputViewModel ViewModel => _viewModel;

    /// <summary>Move keyboard focus to the editing field — the native port of the web handle's <c>focus()</c>.</summary>
    public void FocusInput() => _input.Focus(FocusState.Programmatic);

    /// <summary>Force-commit the pending text — the native port of the web handle's <c>commitPending()</c>.</summary>
    public void CommitPending() => _viewModel.CommitPendingIfAny();

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
        _input.LostFocus -= OnInputLostFocus;
        _input.Paste -= OnInputPaste;
        _field.Tapped -= OnFieldTapped;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new TagInputAutomationPeer(this);

    private void BuildLayout()
    {
        _strip.Children.Add(_input);
        _field.Child = _strip;

        // Only one of the visible / hidden label nodes is mounted (web hideLabel renders VisuallyHidden).
        _root.Children.Add(_viewModel.HideLabel ? _hiddenLabel : _label);
        _root.Children.Add(_field);
        _root.Children.Add(_hiddenTags);
        _root.Children.Add(_error);
        _root.Children.Add(_helper);
        Content = _root;

        _label.Foreground = DisplayTokens.TextSecondary;
        _input.Foreground = DisplayTokens.TextPrimary;
        _field.Background = DisplayTokens.Surface;

        // The hidden tag enumeration describes the field for assistive tech (web aria-describedby → tags list).
        AutomationProperties.GetDescribedBy(_input).Add(_hiddenTags);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        Render();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e) => Marshal(Render);

    private void OnInputTextChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressTextChanged)
        {
            return;
        }

        _viewModel.SetPendingText(_input.Text);
    }

    private void OnInputKeyDown(object sender, KeyRoutedEventArgs e)
    {
        switch (e.Key)
        {
            case VirtualKey.Enter:
                // web: Enter commits the pending buffer (preventDefault so no ding / newline).
                e.Handled = true;
                _viewModel.Commit();
                break;
            case VirtualKey.Back when _input.Text.Length == 0:
                // web: Backspace at an empty field removes the trailing chip.
                e.Handled = _viewModel.HandleBackspace();
                break;
            default:
                break;
        }
    }

    private void OnInputLostFocus(object sender, RoutedEventArgs e) => _viewModel.CommitOnBlur();

    private void OnInputPaste(object sender, TextControlPasteEventArgs e)
    {
        // web handlePaste: take over the paste so the split text is not left half-committed in the field.
        e.Handled = true;
        _ = HandlePasteAsync();
    }

    private async Task HandlePasteAsync()
    {
        DataPackageView content = Clipboard.GetContent();
        if (!content.Contains(StandardDataFormats.Text))
        {
            return;
        }

        string text = await content.GetTextAsync();
        Marshal(() => _viewModel.Paste(text));
    }

    private void OnFieldTapped(object sender, TappedRoutedEventArgs e)
    {
        if (!_viewModel.InputDisabled)
        {
            _input.Focus(FocusState.Programmatic);
        }
    }

    private void Render()
    {
        string accessibleName = _viewModel.AccessibleName;

        // Field accessible name (web label / aria-labelledby) + the visible / hidden label node.
        _label.Text = accessibleName;
        _hiddenLabel.Text = accessibleName;
        AutomationProperties.SetName(_input, accessibleName);
        AutomationProperties.SetName(this, accessibleName);

        RenderChips();

        // web placeholder: "Tag limit reached" at capacity, else the override or the i18n default.
        _input.PlaceholderText = _viewModel.PromptText; // parity:allow PlaceholderText is the WinUI hint API
        _input.IsEnabled = !_viewModel.InputDisabled;

        // Keep the field text in sync with the pending buffer without clobbering the caret while the user types.
        if (!string.Equals(_input.Text, _viewModel.Pending, StringComparison.Ordinal))
        {
            _suppressTextChanged = true;
            _input.Text = _viewModel.Pending;
            _input.SelectionStart = _input.Text.Length;
            _suppressTextChanged = false;
        }

        // Hidden screen-reader enumeration of the current tags (web VisuallyHidden tags list).
        _hiddenTags.Text = _viewModel.HiddenTagsText;
        AutomationProperties.SetFullDescription(_input, _viewModel.HiddenTagsText);

        // System-colour-safe field outline; the danger brush replaces it while a validator error is showing.
        _field.BorderBrush = _viewModel.HasError
            ? DisplayTokens.Brush("TsColorDangerBrush")
            : DisplayTokens.Border;

        if (_viewModel.HasError)
        {
            _error.Value = _viewModel.ErrorMessage ?? string.Empty;
            _error.Visibility = Visibility.Visible;
        }
        else
        {
            _error.Visibility = Visibility.Collapsed;
        }

        if (_viewModel.ShowHelper)
        {
            _helper.Value = _viewModel.HelperText;
            _helper.Visibility = Visibility.Visible;
        }
        else
        {
            _helper.Visibility = Visibility.Collapsed;
        }
    }

    private void RenderChips()
    {
        // Rebuild only the chips; the trailing TextBox is a persistent child so focus / caret survive.
        for (int i = _strip.Children.Count - 1; i >= 0; i--)
        {
            if (!ReferenceEquals(_strip.Children[i], _input))
            {
                _strip.Children.RemoveAt(i);
            }
        }

        IReadOnlyList<string> tags = _viewModel.Tags;
        for (int i = 0; i < tags.Count; i++)
        {
            _strip.Children.Insert(i, BuildChip(tags[i], i));
        }
    }

    private Border BuildChip(string tag, int index)
    {
        var text = new TextBlock
        {
            Text = tag,
            FontSize = ChipFontSize,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var remove = new TsButton
        {
            Variant = ButtonVariant.Icon,
            Size = ControlSize.Small,
            IconGlyph = RemoveGlyph,
            IsTabStop = false,
            IsEnabled = !_viewModel.IsDisabled,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(remove, _viewModel.RemoveLabelFor(tag));

        int captured = index;
        remove.Click += (_, _) => _viewModel.RemoveAt(captured);

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(text);
        row.Children.Add(remove);

        return new Border
        {
            Child = row,
            CornerRadius = new CornerRadius(ChipCornerRadius),
            Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush"),
            Padding = new Thickness(10, 2, 4, 2),
            VerticalAlignment = VerticalAlignment.Center,
        };
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

    /// <summary>
    /// Exposes the surface as a named <see cref="AutomationControlType.Group"/> so Narrator reports the tag
    /// field by its localized label (web the field's accessible name).
    /// </summary>
    private sealed class TagInputAutomationPeer : FrameworkElementAutomationPeer
    {
        public TagInputAutomationPeer(TagInput owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((TagInput)Owner).ViewModel.AccessibleName : name;
        }
    }

    /// <summary>
    /// A minimal flow panel that lays its children left to right and wraps to a new row when the next child
    /// would overflow the available width — the native equivalent of the web field's <c>flex flex-wrap
    /// items-center gap-1.5</c>. Base WinUI ships no wrap panel, so the surface carries its own (the same
    /// pattern the dashboard chip clusters and ActiveFilterChips use).
    /// </summary>
    private sealed partial class ChipWrapPanel : Panel
    {
        /// <summary>Horizontal gap between items on a row.</summary>
        public double HorizontalSpacing { get; set; }

        /// <summary>Vertical gap between wrapped rows.</summary>
        public double VerticalSpacing { get; set; }

        protected override Size MeasureOverride(Size availableSize)
        {
            double maxWidth = double.IsNaN(availableSize.Width) || double.IsInfinity(availableSize.Width)
                ? double.PositiveInfinity
                : availableSize.Width;

            double rowWidth = 0;
            double rowHeight = 0;
            double totalHeight = 0;
            double widest = 0;

            foreach (var child in Children)
            {
                child.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
                var desired = child.DesiredSize;

                if (rowWidth > 0 && rowWidth + HorizontalSpacing + desired.Width > maxWidth)
                {
                    widest = Math.Max(widest, rowWidth);
                    totalHeight += rowHeight + VerticalSpacing;
                    rowWidth = desired.Width;
                    rowHeight = desired.Height;
                }
                else
                {
                    rowWidth += (rowWidth > 0 ? HorizontalSpacing : 0) + desired.Width;
                    rowHeight = Math.Max(rowHeight, desired.Height);
                }
            }

            widest = Math.Max(widest, rowWidth);
            totalHeight += rowHeight;

            double measuredWidth = double.IsInfinity(maxWidth) ? widest : maxWidth;
            return new Size(measuredWidth, totalHeight);
        }

        protected override Size ArrangeOverride(Size finalSize)
        {
            double x = 0;
            double y = 0;
            double rowHeight = 0;

            foreach (var child in Children)
            {
                var desired = child.DesiredSize;
                if (x > 0 && x + HorizontalSpacing + desired.Width > finalSize.Width)
                {
                    x = 0;
                    y += rowHeight + VerticalSpacing;
                    rowHeight = 0;
                }

                if (x > 0)
                {
                    x += HorizontalSpacing;
                }

                child.Arrange(new Rect(x, y, desired.Width, desired.Height));
                x += desired.Width;
                rowHeight = Math.Max(rowHeight, desired.Height);
            }

            return finalSize;
        }
    }
}
