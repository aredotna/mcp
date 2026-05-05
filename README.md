# @aredotna/mcp

MCP server for the [Are.na](https://www.are.na) API. Provides 30+ auto-generated tools from the OpenAPI spec plus custom composite tools.

## Quick start

The hosted server is available at `https://mcp.are.na/mcp`.

### Claude Desktop (connector)

The easiest way to connect. Go to **Settings > Connectors > Add custom connector** and enter:

- **Name**: `Are.na`
- **Remote MCP server URL**: `https://mcp.are.na/mcp`

Leave the OAuth Client ID and Secret fields blank — the server supports Dynamic Client Registration. Click **Add**, then authorize with your Are.na account when prompted.

### Claude Desktop (config file)

You can also add the server directly in `claude_desktop_config.json`. If your version supports the `url` format:

```json
{
  "mcpServers": {
    "arena": {
      "type": "http",
      "url": "https://mcp.are.na/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_ARENA_TOKEN"
      }
    }
  }
}
```

Get a personal access token from [are.na/settings/personal-access-tokens](https://www.are.na/settings/personal-access-tokens).

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

### Claude Code

```bash
claude mcp add --transport http arena https://mcp.are.na/mcp
```

Authenticate via `/mcp` when prompted.

### Codex Desktop

In the Codex desktop app, open **Settings > MCP servers > Add custom MCP**.

Use the hosted server with OAuth, the same as the Claude connector flow. Select **Streamable HTTP** and enter:

- **Name**: `Are.na`
- **URL**: `https://mcp.are.na/mcp`

Leave environment variables and passthrough blank. Save the server, then click **Authenticate** from the MCP server settings when it appears. The server supports Dynamic Client Registration, so you do not need to create or paste an OAuth client ID or secret.

If you need to run the server locally over stdio instead, clone the repo, run `yarn install && yarn generate`, then add a custom MCP with:

- **Name**: `Are.na`
- **Transport**: `STDIO`
- **Command to launch**: `/path/to/arena/mcp/node_modules/.bin/tsx`
- **Arguments**: `/path/to/arena/mcp/src/transports/stdio.ts`
- **Environment variables**: `ARENA_ACCESS_TOKEN` = `YOUR_ARENA_TOKEN`
- **Working directory**: `/path/to/arena/mcp`

Use absolute paths for the command, argument, and working directory. The local stdio server uses a personal access token instead of OAuth; get one from [are.na/settings/personal-access-tokens](https://www.are.na/settings/personal-access-tokens).

### Codex CLI

Codex CLI stores MCP servers in `~/.codex/config.toml`. Add the hosted server:

```toml
[mcp_servers.arena]
url = "https://mcp.are.na/mcp"
```

Then authenticate it:

```bash
codex mcp login arena
```

You can check the configured server from the Codex TUI with `/mcp`.

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
# Set your tokens in .dev.vars (see .dev.vars.example)
yarn dev:http
```

The HTTP server requires a KV namespace for OAuth state. For local development, Wrangler provides an in-memory KV automatically. For production, create a KV namespace and update the `id` in `wrangler.toml` (KV is included in Cloudflare's free tier):

```bash
npx wrangler kv namespace create OAUTH_KV
```

You also need to set the Are.na OAuth application credentials as secrets:

```bash
npx wrangler secret put ARENA_OAUTH_CLIENT_ID
npx wrangler secret put ARENA_OAUTH_CLIENT_SECRET
```

Register your OAuth application at [are.na/developers/oauth/applications](https://www.are.na/developers/oauth/applications) with redirect URI `https://mcp.are.na/callback` (or `http://127.0.0.1:8787/callback` for local dev).

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
