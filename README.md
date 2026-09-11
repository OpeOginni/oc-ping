# oc-plugins

OpenCode V2 plugins by [Ope Oginni](https://github.com/OpeOginni), developed in
one monorepo and released as independent npm packages.

## Plugins

| Package | Description |
| --- | --- |
| [`oc-ping`](./packages/oc-ping) | iMessage notifications and remote replies powered by Photon |

## Development

Install dependencies and run every package's checks:

```sh
bun install
bun run check
bun test
bun run build
```

Run a command for one plugin:

```sh
bun run --filter oc-ping test
bun run --filter oc-ping build
```

Each plugin keeps its own local OpenCode example. To test `oc-ping`, enter its
workspace, copy the example, build it, and start an isolated OpenCode instance:

```sh
cd packages/oc-ping
cp opencode.example.jsonc opencode.jsonc
bun run build
opencode2 --standalone
```

## Releases

Packages are independently versioned with [Changesets](https://github.com/changesets/changesets):

```sh
bun run changeset
bun run version-packages
bun run release
```

Before publishing, test the package contents with:

```sh
bun run pack:dry-run
```
