using System.Runtime.InteropServices;
using Microsoft.Windows.Widgets.Providers;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.Widgets;

/// <summary>
/// The TeslaSync Windows widget provider (P2/W8-0003). It implements the Windows App SDK
/// <see cref="IWidgetProvider"/> contract that the Widgets Board activates via COM, and renders the
/// vehicle-status widget from real cached state through <see cref="WidgetContentService"/>. Content is
/// pushed only in response to host callbacks (create / activate / context change / a refresh action),
/// never from a background timer or SSE stream, so the widget holds no live connection (ADR-009). Each
/// push goes out as an Adaptive Card template + bound data through <see cref="WidgetManager"/>.
/// </summary>
[ComVisible(true)]
[Guid("B7E6D2A1-4C3F-4A5E-9D8B-1F2A3C4D5E60")]
[ClassInterface(ClassInterfaceType.None)]
public sealed class TeslaSyncWidgetProvider : IWidgetProvider
{
    private readonly WidgetContentService _content;

    /// <summary>The parameterless constructor the COM class factory uses to activate the provider.</summary>
    public TeslaSyncWidgetProvider()
        : this(WidgetContentService.CreateDefault())
    {
    }

    internal TeslaSyncWidgetProvider(WidgetContentService content)
    {
        ArgumentNullException.ThrowIfNull(content);
        _content = content;
    }

    /// <summary>A widget was created (pinned): render its first content.</summary>
    public void CreateWidget(WidgetContext widgetContext)
    {
        ArgumentNullException.ThrowIfNull(widgetContext);
        PushUpdate(widgetContext);
    }

    /// <summary>
    /// A widget was deleted (unpinned). The provider keeps no per-widget streams or timers, so there is
    /// nothing to release here.
    /// </summary>
    public void DeleteWidget(string widgetId, string customState)
    {
    }

    /// <summary>A widget became visible: render the latest content.</summary>
    public void Activate(WidgetContext widgetContext)
    {
        ArgumentNullException.ThrowIfNull(widgetContext);
        PushUpdate(widgetContext);
    }

    /// <summary>
    /// A widget left the viewport. Because the provider holds no background connection there is no
    /// update loop to pause — the next <see cref="Activate"/> simply re-reads the cache.
    /// </summary>
    public void Deactivate(string widgetId)
    {
    }

    /// <summary>An in-card action fired: a refresh verb re-renders from the latest cached state.</summary>
    public void OnActionInvoked(WidgetActionInvokedArgs actionInvokedArgs)
    {
        ArgumentNullException.ThrowIfNull(actionInvokedArgs);
        if (string.Equals(actionInvokedArgs.Verb, WidgetDeepLinks.RefreshVerb, StringComparison.Ordinal))
        {
            PushUpdate(actionInvokedArgs.WidgetContext);
        }
    }

    /// <summary>The host changed the widget size or theme: re-render for the new context.</summary>
    public void OnWidgetContextChanged(WidgetContextChangedArgs contextChangedArgs)
    {
        ArgumentNullException.ThrowIfNull(contextChangedArgs);
        PushUpdate(contextChangedArgs.WidgetContext);
    }

    private void PushUpdate(WidgetContext widgetContext)
    {
        try
        {
            if (widgetContext is null || !WidgetDefinitions.IsKnown(widgetContext.DefinitionId))
            {
                return;
            }

            var content = _content.BuildVehicleStatus();
            var options = new WidgetUpdateRequestOptions(widgetContext.Id)
            {
                Template = content.Template,
                Data = content.Data,
                CustomState = content.CustomState,
            };

            WidgetManager.GetDefault().UpdateWidget(options);
        }
        catch (Exception)
        {
            // The Widgets Board call is best-effort; a transient host failure must not crash the server.
        }
    }
}
