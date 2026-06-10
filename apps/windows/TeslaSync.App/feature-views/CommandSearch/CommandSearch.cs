using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>CommandSearch</c> feature surface — a parity port of
/// web/src/features/system/components/CommandSearch.tsx. The web component is a thin, fully-controlled search
/// field: the shared <c>Input</c> primitive (@/components/ui) with a leading search glyph and a localized
/// empty-field prompt, whose text the parent (the command palette) owns through <c>value</c> / <c>onChange</c>.
/// Its native counterpart wraps the atomic <see cref="TsInput"/> — the same primitive that mirrors the web
/// <c>Input</c> — with the Segoe Fluent search glyph overlaid at the leading edge (decorative, click-through,
/// hidden from Narrator). The parent owns the text through the two-way <see cref="Value"/> property and the
/// <see cref="ValueChanged"/> event (web <c>value</c> / <c>onChange</c>); the view holds no query state of its
/// own. Because the web source has no fetch lifecycle, there is — like the sibling <c>SettingField</c> — no
/// loading / error / stale / offline branch to reproduce; the only web render distinction is the empty field
/// (the prompt shows) versus the populated field, both rendered by the single control. Every string resolves
/// through the i18n facade, the field carries a Narrator name, and the search glyph is hidden from assistive
/// technology. The surface adds no custom motion, so reduced-motion is honoured by construction. All copy
/// resolution happens in the WinUI-free <see cref="CommandSearchProjection"/>; the view never performs HTTP.
/// </summary>
public sealed partial class CommandSearch : ContentControl
{
    private const double IconSize = 16;            // web: h-4 w-4
    private const double IconLeftMargin = 12;      // web: icon at left-3
    private const double FieldLeadingPadding = 34; // web: input pl-10 (room for the leading glyph)
    private const double FieldVerticalPadding = 6;
    private const double FieldTrailingPadding = 8;

    private readonly ILocalizer _localizer;
    private readonly CommandSearchDiagnostics _diagnostics;

    private readonly Grid _root = new();
    private readonly TsInput _input = new();
    private readonly FontIcon _icon = new()
    {
        Glyph = CommandSearchRegistration.SearchGlyph,
        FontSize = IconSize,
        HorizontalAlignment = HorizontalAlignment.Left,
        VerticalAlignment = VerticalAlignment.Center,
        Margin = new Thickness(IconLeftMargin, 0, 0, 0),
        IsHitTestVisible = false, // clicks fall through to the field, exactly like the web absolute-positioned icon
    };

    private bool _syncing;
    private bool _opened;

    /// <summary>The current query text the field shows (web <c>value</c>); the parent owns it via two-way binding.</summary>
    public static readonly DependencyProperty ValueProperty = DependencyProperty.Register(
        nameof(Value), typeof(string), typeof(CommandSearch),
        new PropertyMetadata(string.Empty, OnValuePropertyChanged));

    /// <summary>Creates the surface over its i18n facade and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade the prompt and accessible name resolve through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public CommandSearch(ILocalizer localizer, CommandSearchDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new CommandSearchDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Center;

        BuildChrome();
        ApplyDisplay();

        _input.TextChanged += OnInputTextChanged;
        Loaded += OnLoaded;
        Content = _root;
    }

    /// <summary>Raised whenever the query text changes through user input (web <c>onChange</c>).</summary>
    public event EventHandler<string>? ValueChanged;

    /// <summary>The diagnostics surface slug this view registers under (<c>CommandSearch</c>).</summary>
    public static string Slug => CommandSearchRegistration.Slug;

    /// <summary>The current query text (web <c>value</c>).</summary>
    public string Value
    {
        get => (string)GetValue(ValueProperty);
        set => SetValue(ValueProperty, value);
    }

    private void BuildChrome()
    {
        _input.HorizontalAlignment = HorizontalAlignment.Stretch;
        _input.Padding = new Thickness(
            FieldLeadingPadding, FieldVerticalPadding, FieldTrailingPadding, FieldVerticalPadding);

        // The glyph is purely decorative; the query field carries the accessible name (web aria from the prompt).
        AutomationProperties.SetAccessibilityView(_icon, AccessibilityView.Raw);

        _root.Children.Add(_input);
        _root.Children.Add(_icon);
    }

    private void ApplyDisplay()
    {
        CommandSearchDisplay display = CommandSearchProjection.Project(new CommandSearchModel(Value), _localizer);

        _input.Hint = display.PromptText;
        AutomationProperties.SetName(_input, display.AccessibleName);

        if (_input.Text != display.Value)
        {
            _syncing = true;
            _input.Text = display.Value;
            _syncing = false;
        }
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

    private void OnInputTextChanged(object sender, TextChangedEventArgs e)
    {
        if (_syncing)
        {
            return; // The change originated from a programmatic Value push; it is already in sync.
        }

        string text = _input.Text;
        _syncing = true;
        Value = text;
        _syncing = false;

        ValueChanged?.Invoke(this, text);
    }

    private static void OnValuePropertyChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var view = (CommandSearch)d;
        if (view._syncing)
        {
            return; // The change originated from the field itself; it is already in sync.
        }

        string value = (string)(e.NewValue ?? string.Empty);
        if (view._input.Text != value)
        {
            view._syncing = true;
            view._input.Text = value;
            view._syncing = false;
        }
    }
}
