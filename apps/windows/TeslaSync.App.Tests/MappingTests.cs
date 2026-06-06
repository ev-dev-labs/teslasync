using TeslaSync.App.Core;
using Xunit;

namespace TeslaSync.App.Tests;

public sealed class MappingTests
{
    [Theory]
    [InlineData(StatusKind.Success, "TsColorSuccessBrush")]
    [InlineData(StatusKind.Warning, "TsColorWarningBrush")]
    [InlineData(StatusKind.Danger, "TsColorDangerBrush")]
    [InlineData(StatusKind.Info, "TsColorInfoBrush")]
    [InlineData(StatusKind.Neutral, "TsColorTextSecondaryBrush")]
    public void Status_MapsToBrushKey(StatusKind kind, string expected)
    {
        Assert.Equal(expected, StatusResources.AccentBrushKey(kind));
    }

    [Theory]
    [InlineData(ButtonVariant.Primary, "TsButtonPrimaryStyle")]
    [InlineData(ButtonVariant.Destructive, "TsButtonDestructiveStyle")]
    [InlineData(ButtonVariant.Subtle, "TsButtonSubtleStyle")]
    [InlineData(ButtonVariant.Icon, "TsButtonIconStyle")]
    public void Button_MapsToStyleKey(ButtonVariant variant, string expected)
    {
        Assert.Equal(expected, ButtonStyles.StyleKey(variant));
    }

    [Theory]
    [InlineData(ControlSize.Small, 32)]
    [InlineData(ControlSize.Medium, 40)]
    [InlineData(ControlSize.Large, 48)]
    public void Button_MinHeightPerSize(ControlSize size, double expected)
    {
        Assert.Equal(expected, ButtonStyles.MinHeight(size));
    }
}
