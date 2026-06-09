using System.Collections.Generic;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 SnippetPanel — a parity port of the <c>SnippetPanel</c> export in
/// web/src/features/admin/components/ResponseViewer.tsx. It reproduces the web component's composition: a
/// collapsible "Code Snippet" disclosure (a native <see cref="Expander"/>, the idiom for the web
/// <c>ChevronDown</c> toggle, giving free ExpandCollapse keyboard + Narrator support) whose body pairs a row
/// of format tabs (cURL / JavaScript / Python / Go, native <see cref="ToggleButton"/>s so Narrator announces
/// the pressed tab exactly as the web <c>aria-pressed</c>) and a shared <see cref="TsCopyButton"/> above a
/// selectable monospace block showing the generated snippet (the web <c>&lt;pre&gt;</c>). All snippet
/// generation and string resolution flow through the pure <see cref="ResponseSnippet"/> projection; the view
/// holds only the open/selected-format UI state, mirroring the web <c>useState</c>. Every owned string
/// resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class ResponseViewerSnippetPanel : ContentControl
{
    private readonly ILocalizer _localizer;
    private readonly Expander _expander = new();
    private readonly StackPanel _tabRow = new() { Orientation = Orientation.Horizontal, Spacing = 4 };
    private readonly TsCopyButton _copy = new() { Size = ControlSize.Small };
    private readonly TextBlock _snippet = new()
    {
        TextWrapping = TextWrapping.NoWrap,
        IsTextSelectionEnabled = true,
    };

    private readonly Dictionary<SnippetFormat, ToggleButton> _tabs = new();
    private SnippetInput _input;
    private SnippetFormat _selected = SnippetFormat.Curl;

    /// <summary>Creates the snippet panel over the i18n facade and the optional initial request.</summary>
    /// <param name="localizer">The i18n facade resolving the toggle / copy labels (web <c>useTranslation</c>).</param>
    /// <param name="input">The initial request (web <c>{ method, url, body }</c>); defaults to empty.</param>
    public ResponseViewerSnippetPanel(ILocalizer localizer, SnippetInput? input = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _input = input ?? new SnippetInput(string.Empty, string.Empty, null);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        Build();
        Sync();
    }

    /// <summary>The active format tab (web <c>format</c> state).</summary>
    public SnippetFormat SelectedFormat
    {
        get => _selected;
        set
        {
            if (_selected != value)
            {
                _selected = value;
                Sync();
            }
        }
    }

    /// <summary>Re-render for a new request (the web re-render with new <c>{ method, url, body }</c>).</summary>
    /// <param name="input">The latest request.</param>
    public void Update(SnippetInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        _input = input;
        Sync();
    }

    private void Build()
    {
        foreach (SnippetFormat format in new[] { SnippetFormat.Curl, SnippetFormat.JavaScript, SnippetFormat.Python, SnippetFormat.Go })
        {
            var tab = new ToggleButton
            {
                Padding = new Thickness(8, 2, 8, 2),
                MinHeight = 28,
                Foreground = DisplayTokens.TextSecondary,
            };
            SnippetFormat captured = format;
            tab.Click += (_, _) =>
            {
                _selected = captured;
                Sync();
            };
            _tabs[format] = tab;
            _tabRow.Children.Add(tab);
        }

        var bar = new Grid { ColumnSpacing = 4, VerticalAlignment = VerticalAlignment.Center };
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_tabRow, 0);
        Grid.SetColumn(_copy, 1);
        bar.Children.Add(_tabRow);
        bar.Children.Add(_copy);

        _snippet.FontFamily = TypographyTokens.Mono;
        _snippet.FontSize = TypographyTokens.Size("TsTypeBodySmFontSize", 12);
        _snippet.Foreground = DisplayTokens.TextSecondary;

        var pre = new Border
        {
            Background = DisplayTokens.Brush(ResponseViewerProjection.OverlayBrushKey),
            CornerRadius = DisplayTokens.Radius("TsRadiusSm", 8),
            Padding = new Thickness(12),
            Child = new ScrollViewer
            {
                Content = _snippet,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollMode = ScrollMode.Auto,
                VerticalScrollMode = ScrollMode.Auto,
            },
        };

        var body = new StackPanel { Spacing = 8 };
        body.Children.Add(bar);
        body.Children.Add(pre);

        _expander.Content = body;
        _expander.HorizontalAlignment = HorizontalAlignment.Stretch;
        _expander.HorizontalContentAlignment = HorizontalAlignment.Stretch;
        Content = _expander;
    }

    private void Sync()
    {
        SnippetDisplay display = ResponseSnippet.Project(_input, _selected, _localizer);

        _expander.Header = display.ToggleLabel;
        AutomationProperties.SetName(_expander, display.ToggleLabel);

        _copy.ValueToCopy = display.Snippet;
        _copy.CopyLabel = display.CopyLabel;
        _copy.CopiedLabel = display.CopiedLabel;
        _copy.Text = display.CopyLabel;
        AutomationProperties.SetName(_copy, display.CopyLabel);

        foreach (SnippetFormatOption option in display.Formats)
        {
            if (_tabs.TryGetValue(option.Format, out ToggleButton? tab))
            {
                tab.Content = option.Label;
                tab.IsChecked = option.IsSelected;
                AutomationProperties.SetName(tab, option.Label);
            }
        }

        _snippet.Text = display.Snippet;
    }
}
