# @aredotna/mcp

MCP server for the [Are.na](https://www.are.na) API. Provides 30+ auto-generated tools from the OpenAPI spec plus custom composite tools.

## Transports

- **Streamable HTTP** -- deployed to Cloudflare Workers, authenticated via personal access token
- **stdio** -- local development, single-user via personal access token

## Setup

```bash
yarn install
yarn generate   # fetch spec, generate types + tools
```

## Authentication

All requests require an Are.na personal access token. Get one from [are.na/developers/personal-access-tokens](https://www.are.na/developers/personal-access-tokens).

- **stdio**: set the `ARENA_ACCESS_TOKEN` environment variable.
- **HTTP**: send an `Authorization: Bearer <token>` header with each request. Alternatively, set `ARENA_ACCESS_TOKEN` as an environment variable / Cloudflare secret for a single-user deployment.

### Local development (stdio)

```bash
ARENA_ACCESS_TOKEN=your-token yarn dev
```

### Local development (HTTP)

Create `.dev.vars` from the example:

```bash
cp .dev.vars.example .dev.vars
# Set your personal access token
```

```bash
yarn dev:http
```

### Deploy to Cloudflare Workers

```bash
# Set access token secret
wrangler secret put ARENA_ACCESS_TOKEN

# Deploy
yarn deploy
```

For multi-user deployments, omit the `ARENA_ACCESS_TOKEN` secret and have each client send its own Bearer token.

## Adding custom tools

Create a file in `src/tools/custom/`, export a `register(server)` function, and add it to `src/tools/index.ts`. See `src/tools/custom/search-and-connect.ts` for an example.

## Regenerating tools

When the API spec changes:

```bash
yarn generate
```

This fetches the latest spec, regenerates TypeScript types and tool registrations.
