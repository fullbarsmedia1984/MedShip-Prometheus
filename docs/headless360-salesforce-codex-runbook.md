# Salesforce Headless 360 / Hosted MCP Codex Runbook

This runbook connects Codex to Salesforce Headless 360 / Hosted MCP for controlled Zeus/Prometheus work in the Medical Shipment Salesforce sandbox first, and production later. This is not a Salesforce DX setup. Do not create a Salesforce DX project, `sfdx-project.json`, `force-app/`, Salesforce CLI configuration, or metadata deployments for this lane.

## Operating Model

- Primary Salesforce interface: Salesforce Headless 360 / Hosted MCP.
- Sandbox reads: `https://api.salesforce.com/platform/mcp/v1/sandbox/platform/sobject-reads`.
- Sandbox mutations: `https://api.salesforce.com/platform/mcp/v1/sandbox/platform/sobject-mutations`.
- Production custom server placeholder: `https://api.salesforce.com/platform/mcp/v1/custom/zeus-prometheus-ops`.
- Production is disabled in `.codex/config.toml` until a separate production enablement review.
- Do not configure `sobject-all`, `sobject-deletes`, or production broad `sobject-mutations`.
- Prefer custom Zeus/Prometheus MCP tools over raw SObject mutations when they are available.
- Never delete Salesforce records.
- Do not retrieve PHI, credentials, secrets, or unnecessary customer/shipment-sensitive fields.
- Use SOQL `LIMIT` clauses on every query.

## Salesforce Admin Setup

Create separate External Client Apps for sandbox and production. Use External Client Apps, not Connected Apps, because Salesforce Hosted MCP authentication requires External Client Apps.

1. In Salesforce Setup, open External Client App Manager.
2. Create a new External Client App for the sandbox Codex MCP connection.
3. Enable OAuth settings.
4. Set the callback URL to:

   ```text
   http://localhost:5555/callback
   ```

5. Add OAuth scopes:

   ```text
   mcp_api
   refresh_token
   ```

6. Under security settings, require Proof Key for Code Exchange (PKCE) for supported authorization flows.
7. Use JWT-based access tokens for named users when available.
8. Do not require a client secret for this local Codex desktop/CLI OAuth flow unless Salesforce and Codex support that storage pattern for this environment.
9. Restrict access with a permission set:
   - Create a dedicated permission set for authorized Codex MCP users.
   - Include only the object and field permissions needed for Zeus/Prometheus sandbox work.
   - Configure the External Client App OAuth policy to require the permission set for pre-authorization.
   - Assign the permission set only to authorized Medical Shipment Salesforce admins/operators.
10. Save the External Client App and copy its Consumer Key.
11. Repeat the same setup for production only when production enablement is approved.

Salesforce can take time to make a new External Client App available. If login fails immediately after creation, wait and retry before changing the Codex config.

## Codex Config

The repo-scoped Codex config lives at `.codex/config.toml`. Replace only the placeholder Consumer Keys:

```toml
<SANDBOX_EXTERNAL_CLIENT_APP_CONSUMER_KEY>
<PRODUCTION_EXTERNAL_CLIENT_APP_CONSUMER_KEY>
```

Keep the fixed Codex OAuth callback:

```text
http://localhost:5555/callback
```

Keep sandbox reads in approval mode `approve`, sandbox mutations in approval mode `prompt`, and production disabled until the production checklist is complete.

## Sandbox Login

After the Salesforce External Client App is active and the sandbox Consumer Key placeholder is replaced, run these commands from the repo root:

```powershell
codex mcp login salesforce_sandbox_reads
codex mcp login salesforce_sandbox_mutations
```

Do not run production login until the production server has been intentionally enabled and the production checklist is complete.

This runbook does not claim OAuth works until those commands have been run successfully and verified.

## Verification

Start a new Codex session from the repo root after updating `.codex/config.toml`. In the Codex UI or CLI, run:

```text
/mcp
```

Verify:

- `salesforce_sandbox_reads` is present and enabled.
- `salesforce_sandbox_mutations` is present and enabled.
- `salesforce_production_zeus_prometheus_ops` is present but disabled, or otherwise unavailable because it is disabled.
- No server named or pointing to `sobject-all` is configured.
- No server named or pointing to `sobject-deletes` is configured.
- No production broad `sobject-mutations` server is configured.

You can also run the local config check:

```powershell
.\scripts\codex\check-headless360-config.ps1
```

## Safe Test Prompts

Use sandbox-only, read-focused prompts first. Keep field selections narrow and always require limits.

Examples:

```text
Using the Salesforce sandbox reads MCP server, identify the authenticated user and do not retrieve any customer records.
```

```text
Using the Salesforce sandbox reads MCP server, query up to 5 Opportunity records with only Id, Name, StageName, Amount, and CloseDate. Use a SOQL LIMIT clause.
```

```text
Using the Salesforce sandbox reads MCP server, describe the Account schema fields needed to identify an account by name. Do not retrieve PHI, secrets, credentials, or shipment-sensitive fields.
```

For sandbox mutation tests, use non-sensitive throwaway records only after an operator explicitly asks for a mutation. Before execution, Codex must show the intended object/action, fields, IDs, and business reason, then wait for approval through the sandbox mutation prompt.

## Production Enablement Checklist

Do not enable production until all items are complete:

- A Salesforce admin has created and approved the production External Client App.
- The production app uses callback URL `http://localhost:5555/callback`.
- The production app has only required OAuth scopes: `mcp_api` and `refresh_token`.
- PKCE is required.
- Access is restricted by a dedicated permission set assigned only to authorized users.
- The production custom MCP server exposes custom Zeus/Prometheus tools for approved operations.
- Custom Zeus/Prometheus tools are preferred over raw SObject mutation tools.
- No production `sobject-all` server is configured.
- No production `sobject-deletes` server is configured.
- No production broad `sobject-mutations` server is configured.
- The prompt explicitly names production before any production mutation is considered.
- `.codex/config.toml` has `salesforce_production_zeus_prometheus_ops.enabled = true` only after approval.
- A rollback/contact path exists for Salesforce admin review.
- The operator understands that every production mutation must be recorded in the final Codex response.

## Salesforce DX Lane

Salesforce DX is a secondary metadata/deployment lane only. Use it only when the user explicitly asks for Salesforce metadata or development changes, such as fields, permission sets, Apex, Flows, validation rules, or deployments. Do not use Salesforce DX MCP as Phase 1 for Codex agentic Salesforce data operations.
