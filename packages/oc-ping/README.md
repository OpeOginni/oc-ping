# oc-ping

An OpenCode V2 plugin that sends iMessage notifications through
[Photon](https://photon.codes/) when an agent finishes, needs permission, or
asks a question. You can reply from Messages to resolve requests remotely.

## Setup

### 1. Add Photon credentials

Create a project in the [Photon dashboard](https://app.photon.codes/) and export
your recipient, project ID, and project secret:

```sh
export OC_PING_RECIPIENT="+15551234567"
export SPECTRUM_PROJECT_ID="your-project-id"
export SPECTRUM_PROJECT_SECRET="your-project-secret"
```

These variables must be available to the OpenCode server process. If its
background service is already running, restart it after updating the environment:

```sh
opencode2 service restart
```

Photon Free and Pro projects may require adding the recipient in the project's
**Users** tab and sending an initial message to its **Texts on** number. See
[Photon's iMessage setup guide](https://photon.codes/docs/spectrum-ts/providers/imessage/connection-and-routing).

### 2. Add the plugin

Add `oc-ping` to your OpenCode configuration:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "oc-ping",
      "options": {
        "events": ["result", "permission", "question"],
        "replies": true,
        "requestDelayMinutes": 3,
        "completionMinMinutes": 30
      }
    }
  ]
}
```

## Usage

Run `/ping` to edit notification timers or toggle Away mode.

| Control | Action |
| --- | --- |
| `/ping` | Open notification settings |
| `/ping-away` | Toggle Away mode |
| `<leader>p` | Toggle Away mode from the keyboard |

The TUI displays `PING ON` while Away mode is active and `PING OFF` while normal
timers are active. Away mode is saved and bypasses both timers until turned off.

## Configuration

| Option | Default | Description |
| --- | --- | --- |
| `events` | `result`, `permission`, `question` | Notifications to send |
| `requestDelayMinutes` | `3` | Wait before pinging for an unanswered request |
| `completionMinMinutes` | `30` | Minimum task runtime before sending a completion |
| `away` | `false` | Immediately ping for selected events |
| `awayKeybind` | `<leader>p` | Shortcut for Away mode; use `none` to disable |
| `replies` | `true` | Allow replies from Messages |
| `deviceName` | — | Prefix messages with a device label |
| `includeSubagents` | `false` | Include subagent sessions |

Timers accept fractional minutes. Set a timer to `0` for immediate notifications.
Settings changed through `/ping` are saved for the current workspace.

### Events

| Event | Notification |
| --- | --- |
| `result` | Successful completion and the assistant's final text |
| `permission` | Permission action, resources, and reply controls |
| `question` | Question fields, choices, and reply controls |

Exact OpenCode V2 event names are also supported, such as `session.idle`,
`permission.asked`, and `form.created`.

## Replying from Messages

Use iMessage's native **Reply** action on the notification. Unthreaded messages
are ignored.

### Permissions

Reply with:

- `allow` — approve once
- `always` — save approval using OpenCode's permission rules
- `deny` — reject

### Questions

- Reply with an option number, label, or value.
- Separate multiple selections with commas.
- Use `yes`/`no` for boolean fields.
- For multi-field forms, send one answer per line in the same order as the
  questions. Use `-` to skip an optional question.
- Reply with `/cancel` to cancel the question.

Browser-only fields must be completed in OpenCode. Reply mappings expire after
24 hours and only accept replies from the configured recipient.

## Advanced options

- Set `senderPhone` to choose a line when your Photon project has multiple
  dedicated numbers.
- For a standalone or custom OpenCode server, set `serverUrl`. If it uses bearer
  authentication, provide `OC_PING_OPENCODE_TOKEN` in the environment.
- Set `replies: false` for notification-only use.

## Local development

From the plugin workspace, build and run the plugin directly:

```sh
cd packages/oc-ping
bun install
bun run build
cp opencode.example.jsonc opencode.jsonc
opencode2 --standalone
```

The example configuration loads `./dist`. Rebuild after code changes and reopen
OpenCode if the TUI does not reload automatically.

Run the automated checks with:

```sh
bun run check
bun run test
bun run publish:dry-run
```

## Current limitations

- Events missed while OpenCode is disconnected are not replayed.
- Completion notifications are not durably retried after a failed send.
- Multiple OpenCode processes using the same Photon project are not coordinated.

## References

- [OpenCode V2 plugins](https://opencode.ai/v2/docs/build/plugins)
- [Photon Spectrum setup](https://photon.codes/docs/spectrum-ts/getting-started)
- [Photon iMessage routing](https://photon.codes/docs/spectrum-ts/providers/imessage/connection-and-routing)
