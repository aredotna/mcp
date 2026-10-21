import { html } from "hono/html";
import type { OAuthClient } from "./store";

export function consentPage(
  client: OAuthClient,
  state: string,
  redirectUri: string,
  scope: string,
) {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Connect to Are.na</title>
        <style>
          body {
            font:
              16px/1.5 system-ui,
              sans-serif;
            max-width: 36rem;
            margin: 10vh auto;
            padding: 1.5rem;
          }
          code {
            overflow-wrap: anywhere;
          }
          button {
            font: inherit;
            padding: 0.5rem 1rem;
            margin: 0.5rem 0.5rem 0 0;
            cursor: pointer;
          }
        </style>
      </head>
      <body>
        <h1>Connect to Are.na</h1>
        <p>
          <strong>${client.client_name ?? "An app"}</strong> is requesting
          ${scope.split(" ").includes("write")
            ? "permission to read and change your Are.na content"
            : "read access to your Are.na content"}.
        </p>
        <p>App identity: <code>${client.client_id}</code></p>
        <p>After signing in, you will return to <code>${redirectUri}</code>.</p>
        <form method="post" action="/authorize/consent">
          <input type="hidden" name="state" value="${state}" />
          <button name="decision" value="allow" type="submit">
            Continue to Are.na
          </button>
          <button name="decision" value="deny" type="submit">Cancel</button>
        </form>
      </body>
    </html>`;
}
