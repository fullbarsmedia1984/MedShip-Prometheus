# Salesforce SOAP Login Retirement Plan

Date: May 19, 2026

## Summary

Prometheus currently uses `jsforce` username/password/security-token authentication, which calls Salesforce SOAP API `login()`. Salesforce will retire SOAP API `login()` in API versions 31.0 through 64.0 with the Summer '27 release.

Hard external deadline: Medical Shipment's Summer '27 Salesforce release window, exact date TBD.

Recommended internal deadline: March 31, 2027.

Near-term watch item: Summer '26 `Use API Auth` permission enforcement.

Sources:

- Salesforce Release Notes: SOAP API `login()` Call in SOAP API Versions 31.0 Through 64.0 Is Being Retired
- Salesforce Help: Platform SOAP API `login()` Retirement

## Current Prometheus Impact

Prometheus is affected if Salesforce org `00D2E0000013VqF` is Medical Shipment's production org.

Current authentication path:

- `src/lib/salesforce/client.ts`
- `jsforce.Connection.login(username, password + securityToken)`
- `scripts/sync-diagnostics.mjs` also uses `conn.login(...)`

Current required Railway variables:

- `SF_LOGIN_URL`
- `SF_USERNAME`
- `SF_PASSWORD`
- `SF_SECURITY_TOKEN`

Optional variables currently supported but not sufficient to avoid SOAP login:

- `SF_CLIENT_ID`
- `SF_CLIENT_SECRET`

Even when client ID and client secret are configured, the current code still calls `conn.login(...)`, so the integration remains on the retiring SOAP login path.

## Timeline

| Date / Release | Meaning | Prometheus Action |
| --- | --- | --- |
| Summer '26 | Existing orgs can optionally enforce the `Use API Auth` permission for SOAP API login users. | Confirm whether Medical Shipment enables enforcement and assign the permission to the Prometheus integration user if needed. |
| March 31, 2027 | Recommended internal deadline. | Complete OAuth migration and verify scheduled syncs. |
| Summer '27 | SOAP API `login()` in API versions 31.0 through 64.0 is retired. | Prometheus must no longer rely on username/password/security-token SOAP login. |

## Target Architecture

Move Prometheus to OAuth-based server-to-server authentication through a Salesforce External Client App.

Preferred flow: JWT Bearer OAuth.

Target Railway variables:

- `SF_AUTH_MODE=jwt_bearer`
- `SF_LOGIN_URL`
- `SF_CLIENT_ID`
- `SF_USERNAME`
- `SF_PRIVATE_KEY`
- `SF_JWT_AUDIENCE` if needed

Temporary fallback during rollout:

- `SF_AUTH_MODE=soap_login`
- `SF_PASSWORD`
- `SF_SECURITY_TOKEN`

The fallback should remain only until OAuth has been proven in production.

## Implementation Plan

1. Create a Salesforce External Client App for Prometheus.
2. Configure certificate/JWT Bearer support for the Prometheus integration user.
3. Add Railway OAuth variables.
4. Add `SF_AUTH_MODE` support in the Salesforce client.
5. Implement `jwt_bearer` auth without calling SOAP `login()`.
6. Keep current `soap_login` mode as a temporary fallback.
7. Update Salesforce diagnostics to report auth mode and identity lookup.
8. Update Settings UI to mark username/password/security-token auth as legacy SOAP login.
9. Run local and production Salesforce health checks.
10. Run full Salesforce sync.
11. Run incremental Salesforce sync.
12. Monitor `sync_events` and Inngest runs for auth errors.
13. Remove dependency on password/security-token after the stability period.

## Settings UI Changes

The Settings page should show:

- Current Salesforce auth mode.
- Warning badge when `SF_AUTH_MODE=soap_login`.
- OAuth configured state when JWT Bearer variables are present.
- Legacy password/security-token fields locked or marked deprecated after OAuth cutover.

Recommended warning copy:

> Legacy SOAP login is active. Salesforce will retire this authentication path with the Summer '27 release. Migrate Prometheus to OAuth before March 31, 2027.

## Diagnostics Changes

Salesforce diagnostics should report:

- Auth mode.
- Org ID from identity lookup.
- Integration username.
- Whether SOAP login fallback is active.
- Whether OAuth/JWT auth succeeded.
- Any `INVALID_LOGIN`, `INVALID_GRANT`, `UNSUPPORTED_API_VERSION`, or permission errors.

## Summer '26 Permission Watch

Before Summer '26 enforcement is enabled:

1. Identify the Prometheus Salesforce integration user.
2. Confirm whether Medical Shipment enables `Use API Auth` enforcement.
3. If enforcement is enabled before OAuth migration, assign `Use API Auth` to the integration user.
4. Verify Salesforce sync after the permission change.

## Test Plan

Local checks:

- Salesforce health check succeeds with `SF_AUTH_MODE=jwt_bearer`.
- Salesforce health check clearly warns with `SF_AUTH_MODE=soap_login`.
- Missing OAuth variables produce actionable errors.
- SOAP fallback still works during transition.

Sync checks:

- `SF_FULL_SYNC` authenticates and completes.
- `SF_INCREMENTAL_SYNC` authenticates and completes.
- Salesforce webhook-triggered flows still authenticate.
- Circuit breaker catches OAuth credential failures.

Production checks:

- Railway deploy succeeds.
- Inngest Salesforce sync runs successfully after cutover.
- Settings page shows OAuth mode.
- No new `INVALID_LOGIN`, `INVALID_GRANT`, or SOAP login errors appear in `sync_events`.

## Rollback Plan

If JWT Bearer auth fails during rollout:

1. Set `SF_AUTH_MODE=soap_login`.
2. Keep `SF_PASSWORD` and `SF_SECURITY_TOKEN` in Railway until OAuth is stable.
3. Restart/redeploy Railway.
4. Confirm Salesforce health check.
5. Resume sync jobs.
6. Investigate OAuth failure without rotating Salesforce password unless necessary.

## Assumptions

- Salesforce org `00D2E0000013VqF` is the org used by Prometheus.
- JWT Bearer OAuth is available for the Medical Shipment Salesforce setup.
- The exact Summer '27 release date is instance-specific and should be confirmed in Salesforce Trust or Release Updates closer to 2027.
- March 31, 2027 is the internal target to leave buffer before Salesforce enforcement.
