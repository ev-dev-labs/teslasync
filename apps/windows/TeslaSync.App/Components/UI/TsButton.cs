using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Core;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Tokenized Fluent button. Mirrors the web <c>Button</c> primitive: semantic
/// <see cref="Variant"/>s (primary, secondary, subtle, outline, destructive,
/// icon), a <see cref="Size"/> scale, an optional leading <see cref="IconGlyph"/>
/// and a busy/<see cref="IsLoading"/> state that swaps in a progress ring and
/// disables interaction. Inherits all hover/pressed/disabled/focus visual
/// states and Narrator support from the WinUI <see cref="Button"/> base.
/// </summary>
public partial class TsButton : Button
{
    public static readonly DependencyProperty VariantProperty = DependencyProperty.Register(
        nameof(Variant), typeof(ButtonVariant), typeof(TsButton),
        new PropertyMetadata(ButtonVariant.Primary, OnVisualChanged));

    public static readonly DependencyProperty SizeProperty = DependencyProperty.Register(
        nameof(Size), typeof(ControlSize), typeof(TsButton),
        new PropertyMetadata(ControlSize.Medium, OnVisualChanged));

    public static readonly DependencyProperty IsLoadingProperty = DependencyProperty.Register(
        nameof(IsLoading), typeof(bool), typeof(TsButton),
        new PropertyMetadata(false, OnVisualChanged));

    public static readonly DependencyProperty IconGlyphProperty = DependencyProperty.Register(
        nameof(IconGlyph), typeof(string), typeof(TsButton),
        new PropertyMetadata(null, OnVisualChanged));

    public static readonly DependencyProperty TextProperty = DependencyProperty.Register(
        nameof(Text), typeof(string), typeof(TsButton),
        new PropertyMetadata(null, OnVisualChanged));

    private bool _loadingForcedDisable;

    public TsButton()
    {
        DefaultStyleKey = typeof(Button);
        ApplyVariantStyle();
    }

    /// <summary>Visual emphasis variant.</summary>
    public ButtonVariant Variant
    {
        get => (ButtonVariant)GetValue(VariantProperty);
        set => SetValue(VariantProperty, value);
    }

    /// <summary>Control sizing scale.</summary>
    public ControlSize Size
    {
        get => (ControlSize)GetValue(SizeProperty);
        set => SetValue(SizeProperty, value);
    }

    /// <summary>When true the button shows a progress ring and is non-interactive.</summary>
    public bool IsLoading
    {
        get => (bool)GetValue(IsLoadingProperty);
        set => SetValue(IsLoadingProperty, value);
    }

    /// <summary>Optional leading icon glyph (Segoe Fluent Icons code point).</summary>
    public string? IconGlyph
    {
        get => (string?)GetValue(IconGlyphProperty);
        set => SetValue(IconGlyphProperty, value);
    }

    /// <summary>Localized button label supplied by the consumer.</summary>
    public string? Text
    {
        get => (string?)GetValue(TextProperty);
        set => SetValue(TextProperty, value);
    }

    private static void OnVisualChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var button = (TsButton)d;
        button.ApplyVariantStyle();
        button.UpdateContent();
    }

    private void ApplyVariantStyle()
    {
        var key = ButtonStyles.StyleKey(Variant);
        if (Application.Current.Resources.TryGetValue(key, out var style) && style is Style s)
        {
            Style = s;
        }

        MinHeight = ButtonStyles.MinHeight(Size);
    }

    private void UpdateContent()
    {
        var hasText = !string.IsNullOrEmpty(Text);
        var hasIcon = !string.IsNullOrEmpty(IconGlyph);

        if (!hasText && !hasIcon && !IsLoading)
        {
            return;
        }

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        if (IsLoading)
        {
            row.Children.Add(new ProgressRing
            {
                IsActive = true,
                Width = 16,
                Height = 16,
            });
        }
        else if (hasIcon)
        {
            row.Children.Add(new FontIcon
            {
                Glyph = IconGlyph,
                FontSize = 16,
            });
        }

        if (hasText)
        {
            row.Children.Add(new TextBlock { Text = Text });
            if (string.IsNullOrEmpty(AutomationProperties.GetName(this)))
            {
                AutomationProperties.SetName(this, Text);
            }
        }

        Content = row;
        UpdateLoadingEnabledState();
    }

    private void UpdateLoadingEnabledState()
    {
        if (IsLoading && !_loadingForcedDisable)
        {
            _loadingForcedDisable = true;
            IsEnabled = false;
        }
        else if (!IsLoading && _loadingForcedDisable)
        {
            _loadingForcedDisable = false;
            IsEnabled = true;
        }
    }
}
