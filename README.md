# Are.na MCP Server

MCP server for the [Are.na](https://www.are.na) API. Provides 30+ auto-generated tools from the OpenAPI spec plus custom composite tools.

## Transports

- **Streamable HTTP** — deployed to Cloudflare Workers, multi-tenant via OAuth
- **stdio** — local development, single-user via personal access token

## Setup

```bash
yarn install
yarn generate   # fetch spec, generate types + tools
```

### Local development (stdio)

```bash
ARENA_ACCESS_TOKEN=your-token yarn dev
```

### Local development (HTTP)

Create `.dev.vars` from the example:

```bash
cp .dev.vars.example .dev.vars
# Edit with your OAuth app credentials
```

```bash
yarn dev:http
```

### Deploy to Cloudflare Workers

```bash
# Create the KV namespace
wrangler kv namespace create OAUTH_CLIENTS
# Update wrangler.toml with the returned ID

# Set secrets
wrangler secret put ARENA_OAUTH_CLIENT_ID
wrangler secret put ARENA_OAUTH_CLIENT_SECRET

# Deploy
yarn deploy
```

## Authentication

The deployed server supports two authentication methods:

1. **OAuth2** — MCP clients automatically discover the server's OAuth endpoints and walk the user through Are.na authorization. Requires an OAuth app registered at [are.na/oauth/applications](https://www.are.na/oauth/applications).

2. **Personal access token** — configure a Bearer token directly in your MCP client. Get one from [are.na/settings/personal-access-tokens](https://www.are.na/settings/personal-access-tokens).

## Adding custom tools

Create a file in `src/tools/custom/`, export a `register(server)` function, and add it to `src/tools/index.ts`. See `src/tools/custom/search-and-connect.ts` for an example.

## Regenerating tools

When the API spec changes:

```bash
yarn generate
```

This fetches the latest spec, regenerates TypeScript types and tool registrations.
