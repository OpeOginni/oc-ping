# oc-ping

An OpenCode **V2** plugin that sends Photon iMessages when an agent finishes,
needs permission, or asks a question. Reply in Messages to resolve permissions
and questions. Bring your own Photon credentials.

## Setup

1. Create a project in the [Photon dashboard](https://app.photon.codes/).
   Its Settings page contains your project ID and secret.
2. Make these environment variables available to the **OpenCode server process**.
   This is the recommended approach because credentials will not be stored in
   `opencode.jsonc` or accidentally committed to a public repository:

   ```sh
   export SPECTRUM_PROJECT_ID="your-project-id"
   export SPECTRUM_PROJECT_SECRET="your-project-secret"
   ```

   An already-running background service will not inherit newly exported shell
   variables. Configure its launch environment and restart it as needed.
3. Install the dependencies in this directory with `npm install`.
4. Add the published plugin to your OpenCode configuration (copy
   `opencode.example.jsonc` to `opencode.jsonc` for local testing; the local file
   is intentionally gitignored):

   ```jsonc
   {
     "$schema": "https://opencode.ai/config.json",
     "plugins": [
       {
          "package": "oc-ping",
         "options": {
            "recipient": "+15551234567",
            "deviceName": "Work MacBook",
           "events": ["result", "permission", "question"],
           "replies": true
         }
       }
     ]
   }
   ```

   For local testing from this repository, copy the example, set `OC_PING_RECIPIENT`
   and the Photon environment variables above, then start OpenCode here:

   ```sh
   opencode
   ```

   The example config loads `.` as the plugin package. It enables result,
   permission, and question notifications with replies. Empty option fields fall
   back to `OC_PING_RECIPIENT`, `SPECTRUM_PROJECT_ID`, and
   `SPECTRUM_PROJECT_SECRET` when set. You can edit the event selection or add
   `deviceName` there.

   You can put `recipient`, `projectId`, and `projectSecret` directly in the
   plugin options for a local-only setup, but **never publish or commit that
   configuration publicly**. Keep `opencode.jsonc` gitignored and use environment
   variables whenever possible. If credentials are ever committed or shared,
   rotate the Photon secret immediately.

Use **your own receiving iMessage phone number or Apple ID email** as
`recipient`. Do not use the shared or dedicated sending line Photon assigned to
the project; Photon rejects managed lines as recipients. The plugin registers
only Photon's cloud iMessage provider. Photon manages the sending number; it is
not your personal Messages account. Its Free/Pro plans use shared numbers, while
Business supports dedicated lines. Photon documents SMS/RCS fallback at the
platform level; the plugin rejects recipients explicitly reported as SMS/RCS but
does not override Photon transport fallback policy.

Photon receives replies over the SDK's outbound gRPC connection. No public
webhook or tunnel is needed. The machine running OpenCode must stay online.
On Free and Pro shared-line plans, add your recipient under the Photon project's
**Users** tab and send an initial iMessage from that recipient to the project's
**Texts on** number before testing notifications.

## Notifications and replies

| Selection | Behavior |
| --- | --- |
| `result` | Successful session completion with the last assistant's text result |
| `permission` | Action, resources, reason, and native iMessage reply support |
| `question` | V2 form title, fields, choices, and native iMessage reply support |
| Any exact V2 public event name | A generic notification containing the event name and session ID when present |

Examples of exact names: `session.idle`, `permission.asked`, `form.created`.
The last two use the same actionable formatting as their friendly aliases.
An empty events array disables all notifications. High-frequency events can
produce many messages; there is no wildcard subscription option.

Messages are labeled with the session title. Only sessions at the plugin
instance's directory/workspace are included. Subagent sessions are excluded by
default; set `includeSubagents: true` to include them.

Optionally set `deviceName` to a non-empty string to identify the machine sending
messages. It prefixes notifications and reply confirmations, for example:

```text
[Work MacBook] [Fix checkout] Done
Updated the checkout flow.
```

Leading and trailing whitespace is trimmed. Omit `deviceName` to send messages
without a device label. The label is for display; native reply threading routes
responses.

### Permissions

```text
[Fix checkout] Permission needed
shell
npm install

Reply to this message with allow, always, or deny.
```

`allow` approves once. `always` uses OpenCode's saved-permission behavior.
`deny` rejects. Use iMessage's native **Reply** action on the notification so the
plugin can associate your response with the correct OpenCode request. Unthreaded
messages are ignored and cannot approve anything.

### Questions

Questions with choices show numbered options. Use iMessage's native **Reply**
action and send the option number:

```text
1
```

You can also reply with the displayed option label or its underlying value. For
multi-select fields, separate option numbers or labels with commas. Boolean
fields accept `yes`/`no` or `true`/`false`. For multiple fields, send a JSON
object using the displayed field keys:

```text
{"database":"pg","replicas":2}
```

Use iMessage's native **Reply** action on the question notification. Cancel a
question by replying with `/cancel`. External/browser-only fields must be completed
in OpenCode. OpenCode validates field constraints and conditional requirements
before accepting the answer.

Replies are accepted only from the configured recipient in the matching direct
conversation and sender line. Reply mappings expire after 24 hours. Requests and
deduplication markers use OpenCode's durable plugin storage; pending state is
checked against OpenCode before applying a reply. Replies never become arbitrary
agent prompts.

### V2 form API connection

The targeted V2 plugin context exposes permission APIs but **does not expose the
form API**. For questions, oc-ping uses `@opencode/client` and discovers the
authenticated local background service without starting one.

If using a standalone/custom server, set `options.serverUrl` to that same server
and, if it uses bearer authentication, provide `OC_PING_OPENCODE_TOKEN` in the
plugin process environment. Other authentication schemes are not implemented.
Never point this setting at another OpenCode instance. Permission replies use
the plugin context directly. Set `replies: false` for notification-only use.

For multiple dedicated Photon lines, set `options.senderPhone` to pin routing.

## Development and status

```sh
npm install
npm run check
npm test
npm pack --dry-run
```

Targets `@opencode/plugin` and `@opencode/client` **0.0.0-beta-19378**, and
Photon `spectrum-ts` **12.8.0**. These are pinned because the V2 API is beta.

This is an MVP, with type checking and reply-protocol tests. Live Photon delivery
and OpenCode round-trip verification require your configured running service and
Photon credentials. To verify, run a session to completion, trigger an `ask`
permission and a question, then use iMessage's native **Reply** action on each
notification. Also try resolving a request in OpenCode before replying to its
message.

Current operational limits:

- OpenCode's event stream is live-only. The plugin reconnects, but events missed
  while disconnected are not replayed or reconciled.
- Failed sends are logged, not durably queued/retried. Successful sends are
  deduplicated; a crash between sending and storing the marker can duplicate a
  notification. Long messages are split into 3,000-character chunks.
- Photon manages its underlying connections. If its top-level receive stream
  terminates, the plugin logs this and needs a reload.
- Durable deduplication records currently have no automatic retention cleanup.
- Use one configured instance per directory/recipient. Multiple OpenCode server
  processes sharing the same Photon project are not coordinated by this MVP.

## References

- [OpenCode V2 plugins](https://opencode.ai/v2/docs/build/plugins)
- [OpenCode V2 client](https://opencode.ai/v2/docs/build/client)
- [Photon setup](https://photon.codes/docs/spectrum-ts/getting-started)
- [Photon iMessage routing](https://photon.codes/docs/spectrum-ts/providers/imessage/connection-and-routing)
- [Photon pricing](https://photon.codes/pricing)
