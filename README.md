# @aredotna/mcp

MCP server for the [Are.na](https://www.are.na) API. Provides 30+ auto-generated tools from the OpenAPI spec plus custom composite tools.

## Quick start

The hosted server is available at `https://mcp.are.na/mcp`.

You'll need an Are.na personal access token — get one from [are.na/settings/personal-access-tokens](https://www.are.na/settings/personal-access-tokens).

### Claude Desktop (remote)

If your version of Claude Desktop supports the `url` format:

```json
{
  "mcpServers": {
    "arena": {
      "url": "https://mcp.are.na/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_ARENA_TOKEN"
      }
    }
  }
}
```

If your version only supports `command` (stdio), you can use [mcp-proxy](https://github.com/sparfenyuk/mcp-proxy) to bridge to the remote server. Install [uv](https://docs.astral.sh/uv/) first (`brew install uv`), then:

```json
{
  "mcpServers": {
    "arena": {
      "command": "/opt/homebrew/bin/uvx",
      "args": [
        "mcp-proxy",
        "--transport",
        "streamablehttp",
        "-H",
        "Authorization",
        "Bearer YOUR_ARENA_TOKEN",
        "https://mcp.are.na/mcp"
      ]
    }
  }
}
```

> **Note:** Use the full path to `uvx` (e.g. `/opt/homebrew/bin/uvx`). Claude Desktop may not have `uvx` on its `PATH`.

### Claude Desktop (local)

To run the server locally via stdio, clone the repo, run `yarn install && yarn generate`, then use absolute paths in your config:

```json
{
  "mcpServers": {
    "arena": {
      "command": "/path/to/arena/mcp/node_modules/.bin/tsx",
      "args": ["/path/to/arena/mcp/src/transports/stdio.ts"],
      "env": {
        "ARENA_ACCESS_TOKEN": "YOUR_ARENA_TOKEN"
      }
    }
  }
}
```

> **Note:** You must use absolute paths for both `command` and `args`. Claude Desktop does not reliably resolve relative paths or respect `cwd`. Using `yarn dev` or bare `npx tsx` will not work — `yarn` writes to stdout, and `npx` without a cwd cannot find the script.

### Cursor

Add the server under **Settings > MCP Servers** with URL `https://mcp.are.na/mcp` and an `Authorization: Bearer YOUR_ARENA_TOKEN` header.

## Development

```bash
git clone https://github.com/aredotna/mcp.git
cd mcp
yarn install
yarn generate   # fetch OpenAPI spec, generate types + tools
```

### Running locally

**stdio** — single-user, for use with Claude Desktop or other MCP clients:

```bash
ARENA_ACCESS_TOKEN=your-token yarn dev
```

**HTTP** — runs a local Cloudflare Workers dev server:

```bash
cp .dev.vars.example .dev.vars
# Set your personal access token in .dev.vars
yarn dev:http
```

### Testing

```bash
yarn typecheck
yarn test
```

### Formatting

```bash
yarn format
```

Prettier runs automatically on staged files via a pre-commit hook.

## Deployment

Pushes to `main` are automatically deployed to Cloudflare Workers via GitHub Actions.

To deploy manually:

```bash
yarn deploy
```

Requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (set as GitHub repo secrets for CI, or via `wrangler login` locally).

## Adding custom tools

Create a file in `src/tools/custom/`, export a register function, and add it to `src/tools/index.ts`. See `src/tools/custom/search-and-connect.ts` for an example.

## Regenerating tools

When the Are.na API spec changes:

```bash
yarn generate
```

This fetches the latest spec and regenerates TypeScript types and tool registrations.
