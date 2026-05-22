<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes - APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Salesforce Headless 360 / Hosted MCP Rules

- Use Salesforce Headless 360 / Hosted MCP as the primary Salesforce interface.
- Do not use Salesforce DX unless explicitly asked to make metadata/development changes.
- Never delete Salesforce records.
- Never use `sobject-all` in production.
- Never mutate production unless the prompt explicitly names production and the production MCP server is enabled.
- For every mutation, show intended object/action, fields, IDs, and business reason before execution.
- Prefer custom Zeus/Prometheus MCP tools over raw SObject mutations.
- Do not retrieve PHI, credentials, secrets, or unnecessary customer/shipment-sensitive fields.
- Use SOQL `LIMIT` clauses.
- Record every Salesforce mutation in the final response.
