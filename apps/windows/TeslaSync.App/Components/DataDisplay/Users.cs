using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Text;
using TeslaSync.App.Core.DataDisplay;

namespace TeslaSync.App.Components.DataDisplay;

/// <summary>
/// Deterministic initials avatar (mirrors the web <c>Avatar</c>): a coloured disc
/// whose fill is hashed from a stable seed via <see cref="AvatarLogic"/> using the
/// colour-blind-safe Okabe-Ito palette, with the name's initials centred.
/// </summary>
public sealed partial class TsAvatar : ContentControl
{
    /// <summary>Display name used for the initials.</summary>
    public static readonly DependencyProperty DisplayNameProperty = DependencyProperty.Register(
        nameof(DisplayName), typeof(string), typeof(TsAvatar), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>Stable seed for the colour hash (defaults to <see cref="DisplayName"/> when empty).</summary>
    public static readonly DependencyProperty SeedProperty = DependencyProperty.Register(
        nameof(Seed), typeof(string), typeof(TsAvatar), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>Disc diameter in pixels (default 32).</summary>
    public static readonly DependencyProperty SizeProperty = DependencyProperty.Register(
        nameof(Size), typeof(double), typeof(TsAvatar), new PropertyMetadata(32.0, OnChanged));

    /// <summary>Initialise the avatar.</summary>
    public TsAvatar()
    {
        IsTabStop = false;
        Rebuild();
    }

    /// <summary>The display name.</summary>
    public string DisplayName
    {
        get => (string)GetValue(DisplayNameProperty) ?? string.Empty;
        set => SetValue(DisplayNameProperty, value);
    }

    /// <summary>The colour seed.</summary>
    public string Seed
    {
        get => (string)GetValue(SeedProperty);
        set => SetValue(SeedProperty, value);
    }

    /// <summary>Disc diameter.</summary>
    public double Size
    {
        get => (double)GetValue(SizeProperty);
        set => SetValue(SizeProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsAvatar)d).Rebuild();

    private void Rebuild()
    {
        string seed = string.IsNullOrEmpty(Seed) ? DisplayName : Seed;
        string initials = AvatarLogic.Initials(DisplayName);
        var fill = DisplayPrimitives.HexBrush(AvatarLogic.ColorFor(seed));

        var disc = new Border
        {
            Width = Size,
            Height = Size,
            CornerRadius = new CornerRadius(Size / 2),
            Background = fill,
            Child = new TextBlock
            {
                Text = initials,
                FontSize = Size * 0.4,
                FontWeight = FontWeights.SemiBold,
                Foreground = new SolidColorBrush(Microsoft.UI.Colors.White),
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
            },
        };

        Content = disc;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, string.IsNullOrEmpty(DisplayName) ? initials : DisplayName);
    }
}

/// <summary>
/// User identity cell (mirrors the web <c>UserCell</c>): a <see cref="TsAvatar"/>
/// alongside the user's name and a secondary line (email / role).
/// </summary>
public sealed partial class TsUserCell : ContentControl
{
    /// <summary>User display name.</summary>
    public static readonly DependencyProperty DisplayNameProperty = DependencyProperty.Register(
        nameof(DisplayName), typeof(string), typeof(TsUserCell), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>Secondary line (e.g. email or role).</summary>
    public static readonly DependencyProperty SecondaryProperty = DependencyProperty.Register(
        nameof(Secondary), typeof(string), typeof(TsUserCell), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>Colour seed (defaults to <see cref="Secondary"/> then <see cref="DisplayName"/>).</summary>
    public static readonly DependencyProperty SeedProperty = DependencyProperty.Register(
        nameof(Seed), typeof(string), typeof(TsUserCell), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>Initialise the cell.</summary>
    public TsUserCell()
    {
        IsTabStop = false;
        Rebuild();
    }

    /// <summary>The display name.</summary>
    public string DisplayName
    {
        get => (string)GetValue(DisplayNameProperty) ?? string.Empty;
        set => SetValue(DisplayNameProperty, value);
    }

    /// <summary>The secondary line.</summary>
    public string Secondary
    {
        get => (string)GetValue(SecondaryProperty);
        set => SetValue(SecondaryProperty, value);
    }

    /// <summary>The colour seed.</summary>
    public string Seed
    {
        get => (string)GetValue(SeedProperty);
        set => SetValue(SeedProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsUserCell)d).Rebuild();

    private void Rebuild()
    {
        string seed = !string.IsNullOrEmpty(Seed) ? Seed : !string.IsNullOrEmpty(Secondary) ? Secondary : DisplayName ?? string.Empty;

        var text = DisplayPrimitives.Column(0);
        text.VerticalAlignment = VerticalAlignment.Center;
        text.Children.Add(DisplayPrimitives.Value(DisplayName ?? string.Empty, 14));
        if (!string.IsNullOrEmpty(Secondary))
        {
            text.Children.Add(DisplayPrimitives.Caption(Secondary));
        }

        var row = DisplayPrimitives.Row(10);
        row.Children.Add(new TsAvatar { DisplayName = DisplayName ?? string.Empty, Seed = seed });
        row.Children.Add(text);

        Content = row;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, $"{DisplayName} {Secondary}".Trim());
    }
}



