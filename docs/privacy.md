# TeslaSync privacy policy

**Effective date:** September 28, 2026

This policy describes the TeslaSync application distributed by the TeslaSync
project, including its Windows desktop app, mobile apps, and web interface.
TeslaSync is self-hosted: the standalone apps bundle the interface, but do not
include a TeslaSync server or a central account service. You choose which
server to connect to. The person or organization operating that server is
responsible for the data it receives, its configuration, access controls,
backups, and retention. Ask your server operator about their own privacy
practices before connecting.

## Information the app uses

- **Server connection:** The app saves the server address on your device so it
  can reconnect. If your server requires App sign-in, the access key you enter
  is held in the app's session storage and sent to that server as a bearer
  credential. The key is not saved to persistent local storage; you may need
  to enter it again after restarting the app. You can change or forget the
  address under **Settings → Server**.
- **Vehicle and account data:** When you connect to a server, the app requests
  and displays information that server makes available, potentially including
  vehicle identifiers, location and trip history, charging, energy use,
  account settings, alerts, and commands. Your server may obtain data from
  Tesla's services after you authorize it. The server, not the standalone
  app distributor, stores the underlying vehicle history. Your server's
  operator controls its storage, retention, and backups.
- **Local app data:** Preferences, the server address, recently viewed pages,
  the cookie-consent choice, and some cached interface data may be stored on
  your device. The app's **Account → Privacy** screen lets you clear recently
  viewed pages and change the consent choice. Clearing that local history does
  not erase records held by your server.
- **Diagnostics:** When the web interface is served by a TeslaSync server,
  it may send performance measurements and error reports to that server.
  These can include route templates, timing or device-class information,
  and error details; the application attempts to remove credentials and
  identifying details from reports. The generic native shells currently
  do not forward these diagnostic requests to the selected server.
  Whether optional reporting requires your consent depends on the
  server's configuration; where required, you can change your choice under
  **Account → Privacy**. Do not assume error reports can never contain
  personal information.

## Other services

TeslaSync servers communicate with Tesla for vehicle authorization, data, and
commands. When you open a map, its tiles may be requested from external map
providers, including OpenStreetMap, Esri, or OpenTopoMap; the server
operator may configure Google Maps or Azure Maps instead. A tile provider may
receive your IP address and the map area requested. Your server operator may
also enable external geocoding, notification delivery, or AI providers. If you
use those features, data needed to complete your request may be sent to the
configured provider. Review your server's configuration and each provider's
policy for details. The app does not require an AI provider to connect to a
server.

The Microsoft Store and the operating system process app downloads and
updates under their own privacy policies. The [TeslaSync documentation
site](https://teslasync.dev/) loads fonts from Google and may be hosted by a
provider that records ordinary web-server access logs.

## Your choices and requests

You can disconnect from a server in **Settings → Server**, clear recent pages
and change the consent choice in **Account → Privacy**, or remove local app
data using your device's application settings. Removing the app or its local
data does **not** delete information already stored on a self-hosted server.
To access, export, correct, or delete server-held data, contact that server's
operator. Retention and deletion depend on the operator's deployment settings
and backups.

For general questions about this application's privacy behavior, use the
[TeslaSync issue tracker](https://github.com/ev-dev-labs/teslasync/issues).
It is public: **do not post access keys, vehicle identifiers, locations, or
other personal information there**. Direct requests about data stored on a
particular server to its operator, not to the project issue tracker.

We may update this policy when the app's behavior changes. The effective date
at the top identifies this version.
