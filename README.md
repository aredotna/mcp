# @aredotna/mcp

MCP server for the [Are.na](https://www.are.na) API. Provides 50 auto-generated tools from the OpenAPI spec plus custom composite tools.

## Quick start

Connect your app to the hosted server and sign in with your Are.na account:

```text
https://mcp.are.na/mcp
```

Use **OAuth** when asked for authentication. Hosted setup does not require a personal access token, a local installation, or your own OAuth application.

| App                                        | Setup                                              |
| ------------------------------------------ | -------------------------------------------------- |
| [Claude](#claude-web-desktop-and-cowork)   | Add a custom connector and sign in                 |
| [ChatGPT](#chatgpt)                        | Add a custom MCP server as a plugin and install it |
| [Claude Code](#claude-code)                | Add the URL with the CLI, then authenticate        |
| [Codex desktop / IDE](#codex-desktop--ide) | Add a Streamable HTTP server in settings           |
| [Codex CLI](#codex-cli)                    | Add the URL with the CLI, then log in              |
| [Cursor](#cursor)                          | Open the install link, then sign in                |

Instructions checked against official documentation on **October 20, 2026**. App labels and availability can vary by version and workspace policy. These are custom-server setup instructions; they do not imply an approved Are.na directory listing.

### Claude (web, desktop, and Cowork)

1. Open **Customize > Connectors**, then **+ Add > Add custom connector**.
2. Enter **Are.na** and `https://mcp.are.na/mcp`, then continue.
3. Review the detected OAuth settings. Choose **Sign in now** and, if shown, **Use Claude's published identity** under **OAuth client**. **Register automatically** is also supported.
4. Finish adding the connector, review the app and permissions on the Are.na connection screen, then sign in to Are.na. Select **Connect** if sign-in has not started.
5. Enable Are.na in the conversation's connectors menu.

The server supports Claude's published identity (CIMD) and automatic registration (DCR). In older dialogs with optional OAuth Client ID and Secret fields, leave both blank.

On Team or Enterprise, an authorized administrator must add the connector under **Organization settings > Connectors** first; each member then connects their own Are.na account. Claude currently allows one custom connector on Free accounts.

[Claude's current setup guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

### ChatGPT

1. Open [ChatGPT Plugins](https://chatgpt.com/plugins), select **+**, then **Add custom MCP server**.
2. Name it **Are.na**. Suggested description: “Search Are.na, explore channels, and save and organize blocks.”
3. Enter `https://mcp.are.na/mcp` as the public server URL and choose **OAuth**. Published client identity (CIMD) and dynamic registration (DCR) are supported; no client ID or secret needs to be supplied manually.
4. Review the permissions and warning, then select **Create as a plugin**. Complete Are.na sign-in when prompted.
5. Review the discovered tools and install the resulting plugin. In a new chat, type **@** and select **Are.na**.

Creating custom plugins is subject to account and workspace permissions. If the option is missing, check with your workspace administrator. The current documented route is Plugins; older instructions referring to Connectors or Apps developer mode describe an earlier interface.

[OpenAI's current connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt)

### Claude Code

Add Are.na for your user account, available across projects:

```bash
claude mcp add --transport http --scope user arena https://mcp.are.na/mcp
```

Open Claude Code, run `/mcp`, select **arena**, and follow the authentication flow. To configure only the current project locally, omit `--scope user`.

[Claude Code MCP documentation](https://code.claude.com/docs/en/mcp)

### Codex desktop / IDE

1. In the desktop app, open **Settings > MCP servers > Add server** (some versions label this **Add custom MCP**). In the IDE extension, open the gear menu and select **MCP servers**.
2. Set the name to **arena**, transport to **Streamable HTTP**, and URL to `https://mcp.are.na/mcp`.
3. Save, then use **Restart** / **Restart extension** if offered.
4. Select **Authenticate** for the server and sign in to Are.na.

Leave bearer-token and custom-header fields empty for OAuth. Local desktop, CLI, and IDE clients share MCP configuration on the same Codex host; ChatGPT web setup is separate.

[OpenAI's desktop, IDE, and CLI MCP guide](https://learn.chatgpt.com/docs/extend/mcp)

### Codex CLI

```bash
codex mcp add arena --url https://mcp.are.na/mcp
codex mcp login arena
```

Alternatively, add this to `~/.codex/config.toml`, then run the login command:

```toml
[mcp_servers.arena]
url = "https://mcp.are.na/mcp"
```

Use `/mcp` in the Codex TUI to check the connection.

### Cursor

[Add Are.na to Cursor](https://cursor.com/en/install-mcp?name=arena&config=eyJ1cmwiOiJodHRwczovL21jcC5hcmUubmEvbWNwIn0%3D), approve the server installation, then complete OAuth sign-in when Cursor prompts you.

If the link does not open Cursor, merge this entry into `~/.cursor/mcp.json` for all projects, or `.cursor/mcp.json` for one project:

```json
{
  "mcpServers": {
    "arena": {
      "url": "https://mcp.are.na/mcp"
    }
  }
}
```

Open Cursor's MCP settings and connect **arena** if sign-in has not started. No `Authorization` header or personal access token is needed for OAuth.

[Cursor MCP documentation](https://cursor.com/docs/mcp) · [Install-link format](https://cursor.com/docs/mcp/install-links)

### Try it

Start with a read-only request:

> Search Are.na for channels about concrete poetry and show me five links.

Then try a channel you know:

> Summarize this Are.na channel: [paste a channel URL].

### Connection help

- Use the full `https://mcp.are.na/mcp` URL, including `/mcp`, and select Streamable HTTP if asked for a transport.
- If tools are missing, check that Are.na is connected and enabled in the chat. In ChatGPT, refresh the custom connection's metadata and start a new chat after server updates.
- If sign-in fails with an unknown or invalid client, remove and re-add the connection so the app registers again. Published client identities (CIMD) are supported for Claude and ChatGPT; other apps register automatically.
- If a workspace hides custom-server setup, its administrator needs to enable or provision the connection.

## Advanced: local server and access tokens

For development or clients that need a local stdio process, follow [Development](#development), then get a [personal access token](https://www.are.na/settings/personal-access-tokens).

### Claude Desktop local configuration

Merge this entry into `claude_desktop_config.json`:

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

Replace both paths with absolute paths to your checkout. Launch the script directly so package-manager output does not interfere with stdio. This local configuration is separate from Claude's account-level remote connectors; use the hosted connector for web and Cowork.

For a local server in Codex, choose **STDIO** and use the same command, argument, and `ARENA_ACCESS_TOKEN` environment variable. Set the working directory to the absolute checkout path.

Clients that support HTTP bearer headers can also use the hosted endpoint with `Authorization: Bearer YOUR_ARENA_TOKEN`. Use the client's credential settings; keep tokens out of shared configuration and install links.

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

This fetches the latest spec and regenerates TypeScript types, tool registrations, and output schemas. To regenerate from the checked-in spec without fetching it again:

```bash
yarn generate --offline
```

The server uses `openapi-fetch` with generated types directly. Custom tools use the same generated response types as the endpoint tools.

## Tool results

Every tool advertises an `outputSchema` and returns successful results in the same shape in `structuredContent` and JSON text:

```json
{ "result": { "id": 123, "type": "Text" } }
```

`result` contains the complete API response (including `data` and `meta` for list endpoints), or `null` for an empty response. The example above is abbreviated. Text consumers should read the payload under `result`; earlier versions returned it directly.

Generated output schemas preserve the OpenAPI success-response contracts and include the referenced components as local `$defs`. The two custom tools have explicit schemas. Responses are validated before being reported as successful; API errors retain `isError: true` and are not validated against a success schema. An output-validation failure can occur after a write has completed, so it should not trigger an automatic write retry.

The server uses the MCP SDK's low-level tool handlers to publish JSON Schemas directly, with Zod for input parsing and a Workers-compatible JSON Schema validator for outputs.

## OAuth behavior

The hosted server is an OAuth authorization server for MCP clients and delegates sign-in to Are.na.

- **Scopes:** `read`, `write`, or both. Omitting `scope` requests `write`; unknown or empty scopes are rejected. The token response reports the scope Are.na granted, and the Are.na API enforces it.
- **Consent:** Before Are.na sign-in, a consent screen shows the app, the requested access, and where the user will return. Consent and the callback must happen in the same browser. Redirects back to the app include the `iss` parameter.
- **Dynamic client registration (DCR):** Clients register as public clients (`none`, with PKCE) or with `client_secret_post`, the default when no method is given. Redirect URIs must use HTTPS, loopback HTTP, or a private-use scheme such as `cursor://`. Token exchange verifies the client, its secret when one was issued, and PKCE. `redirect_uri` is optional at token exchange but must match exactly when supplied.
- **Client ID metadata documents (CIMD):** Only Claude (`https://claude.ai/oauth/mcp-oauth-client-metadata`) and ChatGPT (`https://chatgpt.com/oauth/client.json` and `https://chatgpt.com/oauth/{callback_id}/client.json`) are trusted; adding another requires a code change. A document must match its URL, list the callback, and support public-client authentication (`none`). Fetches time out after five seconds, are limited to 32 KiB, never follow redirects, and are cached only when the response allows, for at most five minutes.

Known limitations: authorization state and codes are stored in Workers KV, which is eventually consistent and has no atomic consume, so single-use codes are not guaranteed under concurrent redemption. Access tokens are Are.na tokens passed through to the client rather than separate MCP-audience tokens.

## Making installation easier (maintainers)

The recommended product flow is: choose an app, install Are.na, and sign in. The hosted endpoint already implements OAuth discovery, client registration (DCR and CIMD), consent, and PKCE. A local package or desktop extension is not needed for that flow.

Recommended next steps, in order:

1. **Verify complete installs.** Test a fresh account connection, consent, a read, an explicitly approved write, and reconnect in each supported app. See [OAuth behavior](#oauth-behavior).
2. **Add tool annotations before directory submission.** The tool registry currently publishes descriptions and input/output schemas, but no `readOnlyHint`, `destructiveHint`, or `openWorldHint`. Classify each tool by its actual behavior, including composite tools, and verify the advertised values. See [OpenAI's MCP review requirements](https://developers.openai.com/plugins/deploy/app-review).
3. **Submit to the app directories.** These listings would let users find Are.na by name and install it without pasting a server URL. Prepare branding, support and privacy URLs, a reviewer account, and representative prompts. Submission and publication are separate from updating these docs:

   | Directory       | Maintainer action                                                                                                                                                                                                                                                                                                |
   | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Claude          | Submit the hosted URL through the [directory submission portal](https://claude.ai/directory/manage/new). A single remote MCP connector is an accepted submission type; a bundle can add skills later. See [Anthropic's submission announcement](https://claude.com/resources/articles/build-plugins-for-claude). |
   | ChatGPT / Codex | Package the remote MCP connection as a plugin, verify the publisher and domain, upload the ZIP, resolve scans, and submit for review. After approval, publish and use the resulting directory link. See [OpenAI's submission guide](https://developers.openai.com/plugins/deploy/submission).                    |
   | Cursor          | The install link above is available now. For discovery in Cursor, package the MCP configuration as a plugin and [submit to its marketplace](https://cursor.com/marketplace/publish); see [Cursor's plugin guide](https://cursor.com/docs/plugins).                                                               |

4. **Add a small public setup page.** Put the app choices, copyable endpoint, Cursor install link, and two starter prompts on an Are.na page. Replace manual setup with verified directory links as listings become available. Keep the advanced setup in this repository and link the page from Are.na settings.

The quick starts are documentation-verified, not a record of completed app-by-app acceptance tests. On October 20, 2026, the hosted discovery endpoints returned metadata successfully and an unauthenticated MCP initialization returned the expected `401` OAuth challenge. Complete the sign-in and tool-call checks above before announcing broader compatibility.
