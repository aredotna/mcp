# @aredotna/mcp

MCP server for the [Are.na](https://www.are.na) API. It exposes one tool per API endpoint, generated from the OpenAPI spec, plus a few composite tools such as `searchAndConnect` and `channelDigest`.

## Quick start

Connect your app to the hosted server and sign in with your Are.na account:

```text
https://mcp.are.na/mcp
```

Choose **OAuth** when asked for authentication. You don't need a personal access token or a local install.

- [Claude](#claude-web-desktop-and-cowork)
- [ChatGPT](#chatgpt)
- [Claude Code](#claude-code)
- [Codex desktop / IDE](#codex-desktop--ide)
- [Codex CLI](#codex-cli)
- [Cursor](#cursor)

Menu labels can vary between app versions and workspace policies.

### Claude (web, desktop, and Cowork)

1. Open **Customize > Connectors**, then **+ Add > Add custom connector**.
2. Enter **Are.na** and `https://mcp.are.na/mcp`, then continue.
3. Choose **Sign in now**. If an **OAuth client** option is shown, pick **Use Claude's published identity** or **Register automatically**. Leave any Client ID and Secret fields blank.
4. Finish adding the connector, review the permissions, and sign in to Are.na.
5. Enable Are.na in the conversation's connectors menu.

On Team or Enterprise plans, an admin adds the connector under **Organization settings > Connectors** first, then each member connects their own Are.na account.

[Claude's setup guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

### ChatGPT

1. Open [ChatGPT Plugins](https://chatgpt.com/plugins), select **+**, then **Add custom MCP server**.
2. Name it **Are.na** and enter `https://mcp.are.na/mcp` as the server URL.
3. Choose **OAuth**. No client ID or secret is needed.
4. Select **Create as a plugin** and sign in to Are.na when prompted.
5. Install the plugin. In a new chat, type **@** and select **Are.na**.

If the option is missing, your workspace admin may need to allow custom plugins.

[OpenAI's connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt)

### Claude Code

```bash
claude mcp add --transport http --scope user arena https://mcp.are.na/mcp
```

Then run `/mcp` in Claude Code, select **arena**, and sign in. Omit `--scope user` to add it to the current project only.

[Claude Code MCP documentation](https://code.claude.com/docs/en/mcp)

### Codex desktop / IDE

1. In the desktop app, open **Settings > MCP servers > Add server**. In the IDE extension, open the gear menu and select **MCP servers**.
2. Set the name to **arena**, transport to **Streamable HTTP**, and URL to `https://mcp.are.na/mcp`. Leave the token and header fields empty.
3. Save, restart if prompted, then select **Authenticate** and sign in to Are.na.

[Codex MCP guide](https://learn.chatgpt.com/docs/extend/mcp)

### Codex CLI

```bash
codex mcp add arena --url https://mcp.are.na/mcp
codex mcp login arena
```

Or add this to `~/.codex/config.toml` and run the login command:

```toml
[mcp_servers.arena]
url = "https://mcp.are.na/mcp"
```

### Cursor

[Add Are.na to Cursor](https://cursor.com/en/install-mcp?name=arena&config=eyJ1cmwiOiJodHRwczovL21jcC5hcmUubmEvbWNwIn0%3D), approve the install, and sign in when prompted.

Or add this to `~/.cursor/mcp.json` (or `.cursor/mcp.json` for one project):

```json
{
  "mcpServers": {
    "arena": {
      "url": "https://mcp.are.na/mcp"
    }
  }
}
```

If sign-in doesn't start, open Cursor's MCP settings and connect **arena**.

[Cursor MCP documentation](https://cursor.com/docs/mcp)

### Try it

> Search Are.na for channels about concrete poetry and show me five links.

> Summarize this Are.na channel: [paste a channel URL].

### Troubleshooting

- Use the full URL, including `/mcp`, and choose Streamable HTTP if asked for a transport.
- If tools are missing, check that Are.na is connected and enabled for the chat.
- If sign-in fails with an unknown or invalid client, remove the connection and add it again.

## Local server and access tokens

To run the server locally over stdio, follow [Development](#development) and create a [personal access token](https://www.are.na/settings/personal-access-tokens).

For Claude Desktop, add this to `claude_desktop_config.json`, replacing both paths with absolute paths to your checkout:

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

Run `tsx` directly rather than through `yarn` so package-manager output doesn't interfere with stdio. Other stdio clients, such as Codex, take the same command, argument, and `ARENA_ACCESS_TOKEN` variable.

Clients that support custom headers can also use the hosted endpoint with `Authorization: Bearer YOUR_ARENA_TOKEN`.

## Development

```bash
git clone https://github.com/aredotna/mcp.git
cd mcp
yarn install
yarn generate   # fetch OpenAPI spec, generate types + tools
```

### Running locally

**stdio**:

```bash
ARENA_ACCESS_TOKEN=your-token yarn dev
```

**HTTP** (Cloudflare Workers dev server):

```bash
cp .dev.vars.example .dev.vars
# Set your tokens in .dev.vars
yarn dev:http
```

The HTTP server stores OAuth state in Workers KV. Wrangler provides an in-memory KV locally. For production, create a namespace and put its `id` in `wrangler.toml`:

```bash
npx wrangler kv namespace create OAUTH_KV
```

Then set the Are.na OAuth application credentials as secrets:

```bash
npx wrangler secret put ARENA_OAUTH_CLIENT_ID
npx wrangler secret put ARENA_OAUTH_CLIENT_SECRET
```

Register the OAuth application at [are.na/developers/oauth/applications](https://www.are.na/developers/oauth/applications) with redirect URI `https://mcp.are.na/callback` (or `http://127.0.0.1:8787/callback` for local dev).

### Testing and formatting

```bash
yarn typecheck
yarn test
yarn format
```

Prettier also runs on staged files via a pre-commit hook.

### Deployment

Pushes to `main` deploy to Cloudflare Workers via GitHub Actions. To deploy manually, run `yarn deploy`. Plain `wrangler deploy` leaves client ID metadata documents (CIMD) disabled.

Deploying requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, set as GitHub secrets for CI or via `wrangler login` locally.

### Adding custom tools

Create a file in `src/tools/custom/`, export a register function, and call it from `src/tools/index.ts`. See `src/tools/custom/search-and-connect.ts` for an example.

### Regenerating tools

When the Are.na API spec changes, run `yarn generate` to fetch it and regenerate the TypeScript types, tool registrations, and output schemas. Use `yarn generate --offline` to regenerate from the checked-in spec.

## Tool results

Every tool advertises an `outputSchema` and returns its result in both `structuredContent` and JSON text:

```json
{ "result": { "id": 123, "type": "Text" } }
```

`result` holds the full API response (including `data` and `meta` for list endpoints), or `null` for an empty response.

Successful responses are validated against the output schema. API errors are returned with `isError: true` and aren't validated. Because validation happens after the request, a validation failure on a write doesn't mean the write failed, so don't retry it automatically.

## OAuth

The hosted server is an OAuth authorization server for MCP clients and delegates sign-in to Are.na.

- **Scopes:** `read`, `write`, or both. Omitting `scope` requests `write`. Unknown or empty scopes are rejected.
- **Consent:** A consent screen shows the app, the requested access, and the redirect destination before Are.na sign-in. Consent and the callback must happen in the same browser.
- **Dynamic client registration (DCR):** Clients register as public clients (`none`, with PKCE) or with `client_secret_post`. Redirect URIs must use HTTPS, loopback HTTP, or a private-use scheme such as `cursor://`. Loopback callbacks may use any port; the rest of the URI must match exactly.
- **Client ID metadata documents (CIMD):** Clients can identify themselves with an HTTPS URL to a metadata document they publish. The document must match its URL, list the callback, and support public-client authentication. The consent screen shows the publishing domain. CIMD is enabled by `CLIENT_ID_METADATA_DOCUMENTS=enabled`, which `yarn deploy` sets; it's off for local development, which requires a client that supports DCR.

Access tokens are Are.na tokens passed through to the client, not separate MCP-audience tokens. Authorization codes are stored in Workers KV, which has no atomic consume, so single-use codes aren't strictly guaranteed under concurrent redemption.
