# Alert Packs

Open **Notifications → Studio → Alert Packs** to install a group of ordinary alert
rules. The existing templates, rule editor, notification delivery and evaluation
engine are unchanged.

The catalog now includes expanded everyday, charging, security, road-trip, climate
and battery packs, plus driving, places, software, media, Powershare, cold-weather
and shared-vehicle handover packs. **All alerts** contains every unique rule from
these supported packs in one installation. It does not mean every possible Tesla
event: the existing 254 individual Studio templates remain a separate catalog.
Some of those older templates use display-unit thresholds or unsupported shapes
and are not blindly copied into the canonical pack catalog.

## Preview and install

Choose a curated pack or **Custom pack**. Select the rules you want, choose all
current and future vehicles or a specific subset, and review each trigger,
severity, message and cooldown. Numeric operands use canonical units; temperature
inputs are explicitly Celsius and the preview also displays your preferred unit.

Desktop previews use an editable table; phones and tablets expose the same fields
on cards. Edit operators, numeric thresholds, cooldowns, behavior, channels and
notification messages directly, without expanding a rule. Message fields grow on
focus. Changing pages, filters or layouts preserves edits.
Use **All rules**, **Selected** or **Customized** to narrow the list. The persistent
footer shows the selected count, whether new rules will start paused, and the
explicit installation action.

**Master settings** above the table or in the mobile disclosure set cooldown, once/repeat behavior and title
inclusion for the whole pack. Editing a row creates an override for that field;
other fields still follow their master defaults. **Reset to master** clears that
row's delivery overrides. Later master changes affect inherited fields only; **Apply master
settings to all rules** explicitly clears the individual delivery overrides.
Messages, thresholds and selection are preserved. Master settings are installation
defaults, not a live link that subsequently changes installed rules.

Each message has a small Helix action when message-template suggestions are
enabled. Helix uses that row's current trigger and threshold. Review its proposal
and choose **Apply to editor** to replace only that row's message; neither opening
Helix nor generating a suggestion installs or saves rules. Manual editing remains
available when AI is off or unavailable.

Channel selectors support all enabled channels (including future channels), no
external channels, or a fixed set. Channel routing is validated before any rules
are installed. Existing matching rules are still reused without modification.

Search and select/deselect matching rules while retaining selections outside the
filter. Large packs are paginated in the preview; installation includes all selected
rules across pages, not just the visible page.

New rules are **disabled by default**. Enable them during installation only if
you are ready to receive notifications. They use your existing channel
preferences and quiet hours; packs do not create a separate delivery system.
These telemetry alerts are not safety monitors and do not send vehicle commands.

Installation is atomic. A matching signal condition with the same vehicle scope
reuses the existing rule without changing its message, severity or enabled state.
The result identifies created and reused rules. Different thresholds or
overlapping scopes can still generate similar alerts.

The same pack cannot be installed twice for the same scope. Custom group identity
uses its name and selected template IDs. Catalog upgrades never automatically
change installed rules.

## Manage installed packs

Installed packs retain their version and membership. **Edit rule** opens the
ordinary Studio editor; rules can be edited, enabled, disabled or deleted there.
Deleted rules appear as deleted members instead of being recreated silently.

**Remove pack** keeps all rules unless you explicitly select owned rules for
deletion. Reused rules and rules shared with another pack cannot be deleted by
this operation. To change an installation's membership, remove its tracking
while keeping rules, then install the desired selection; matching rules will
be reused.

## Helix custom groups

Enable **Helix custom Alert Packs** in AI settings to describe a goal in Studio.
Helix proposes focused or comprehensive groups from the same supported catalog as
the manual composer. There is no six-rule cap. It cannot invent new conditions,
install rules or execute commands.
Review the proposed group, adjust its name and settings, and explicitly install.
Manual packs remain available when AI is disabled or the provider fails.

## Rule-list actions and delivery channels

Search and channel filters sit together above the rule list. Management controls
are hidden when there are no rules. Selecting any rule reveals one contextual
toolbar with Enable, Disable and Delete; **Select all** uses that same toolbar
for all matching loaded rules, rather than showing a second delete action.
Deletion requires confirmation showing the number of rules, and never includes
rules outside the search/channel filter. **Clear filters** restores the full list.
Failure leaves the remaining selection available for review and retry.

Use the channel filter to find rules by their configured delivery selection.
The channel button on each row opens a quick editor that changes only channel
routing, not the condition, message or enabled state. **All enabled channels**
includes future channels; explicit selections stay fixed; an empty selection
turns off external-channel delivery. Browser delivery and quiet hours are unchanged.
Disabled channels do not deliver, even if selected.

## Deployment

Migration `000245_alert_packs` adds installation and membership tables, without
altering the existing alert-rule schema. Leave it applied when rolling back the
application. Its down migration removes pack tracking only, not alert rules.

Migration `000246_alert_rule_channels` adds nullable `channel_ids`. `null` preserves
all-channel delivery, `[]` disables external channels, and explicit IDs restrict
delivery. Leave the migration applied on rollback. Older application binaries
ignore these selections and send to all channels: disable restricted rules before
rolling back. The down migration discards saved channel selections.

The pack installation request accepts `cooldown_s` (60 to 604800 seconds, in
whole-minute increments), `trigger_mode` (`once` or `repeat`) and `include_title`
at both the request and individual-rule level. Rule-level values override master
values; omitted values inherit. The preview displays minutes; the existing
ordinary rule persistence contract is unchanged.
Each selection also accepts an optional `op` compatible with its operand type
and `channel_ids` (`null` or omitted for all enabled channels, `[]` for none,
or up to 100 distinct positive channel IDs). Changed-value templates retain
their `changed` operator.

`TestPacksPostgres` requires `TESLASYNC_TEST_DB` pointing to a migrated test
database. It clones the alert-rule schema without rows into a temporary schema,
uses its own ID sequence, and removes that schema after the test.
