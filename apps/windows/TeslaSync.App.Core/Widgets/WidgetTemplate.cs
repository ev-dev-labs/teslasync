namespace TeslaSync.App.Core.Widgets;

/// <summary>
/// The canonical Adaptive Card template for the vehicle-status widget (P2/W8-0003). This is the single
/// source of truth: the packaged <c>VehicleStatusTemplate.json</c> file (used for the widget catalog
/// preview) and the runtime <c>WidgetManager.UpdateWidget</c> call both use this exact markup, and a
/// drift test asserts the packaged copy matches. The template carries only <c>${…}</c> bindings and
/// <c>$when</c> visibility gates; all values — including localized field titles and the privacy
/// <c>showVin</c>/<c>showLocation</c> flags — come from <see cref="WidgetCardData"/>, so nothing is
/// hard-coded into the card itself.
/// </summary>
public static class WidgetTemplate
{
    /// <summary>The Adaptive Card (v1.5) template markup for the vehicle-status widget.</summary>
    public const string VehicleStatus = """
        {
          "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
          "type": "AdaptiveCard",
          "version": "1.5",
          "body": [
            {
              "type": "ColumnSet",
              "columns": [
                {
                  "type": "Column",
                  "width": "stretch",
                  "items": [
                    { "type": "TextBlock", "text": "${displayName}", "weight": "Bolder", "size": "Medium", "wrap": true },
                    { "type": "TextBlock", "text": "${statusLabel}", "isSubtle": true, "spacing": "None", "wrap": true }
                  ]
                },
                {
                  "type": "Column",
                  "width": "auto",
                  "items": [
                    { "type": "TextBlock", "text": "${freshnessLabel}", "weight": "Bolder", "horizontalAlignment": "Right" },
                    { "type": "TextBlock", "text": "${lastUpdatedText}", "isSubtle": true, "spacing": "None", "horizontalAlignment": "Right" }
                  ]
                }
              ]
            },
            {
              "type": "FactSet",
              "facts": [
                { "title": "${batteryTitle}", "value": "${batteryText}" },
                { "title": "${rangeTitle}", "value": "${rangeText}" },
                { "title": "${chargeTitle}", "value": "${chargeStateText}" },
                { "title": "${lockTitle}", "value": "${lockStateText}" }
              ]
            },
            { "type": "TextBlock", "text": "${vinText}", "isSubtle": true, "wrap": true, "$when": "${showVin}" },
            { "type": "TextBlock", "text": "${locationText}", "isSubtle": true, "wrap": true, "$when": "${showLocation}" }
          ],
          "actions": [
            { "type": "Action.OpenUrl", "title": "${openVehicleTitle}", "url": "${openVehicleUrl}", "$when": "${hasOpenVehicle}" },
            { "type": "Action.OpenUrl", "title": "${openChargingTitle}", "url": "${openChargingUrl}", "$when": "${hasOpenCharging}" },
            { "type": "Action.OpenUrl", "title": "${openLiveMapTitle}", "url": "${openLiveMapUrl}", "$when": "${hasOpenLiveMap}" },
            { "type": "Action.OpenUrl", "title": "${openCommandsTitle}", "url": "${openCommandsUrl}", "$when": "${hasOpenCommands}" }
          ]
        }
        """;
}
