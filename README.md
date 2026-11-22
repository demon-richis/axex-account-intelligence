# Axex Account Intelligence

Standalone Express REST API for Discord account risk analysis. It supports Neon/PostgreSQL in production and an in-memory store for local development when `DATABASE_URL` is absent. The API expects identity data to come from a trusted Discord integration; query parameters are not proof of identity.

## Run locally

```bash
cp .env.example .env
npm install
API_KEY=local-secret npm start
```

The health check is unauthenticated: `GET /health`. All other endpoints require `X-API-Key` matching `API_KEY`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/analyze/:userId` | Full profile, username, behavior, network, alt, and join analysis |
| POST | `/analyze/:userId` | JSON-body full analysis; intended for the bot and verification portal |
| GET | `/score/:userId` | Cached or persisted quick score lookup |
| POST | `/record` | Record a behavior event |
| POST | `/outcome` | Record a moderator or verification outcome |
| GET | `/alts/:userId` | List known linked accounts |
| POST | `/flag/:userId` | Manually flag an account and invalidate its cache |
| GET | `/ip/:ipAddress` | View cached IP reputation |
| GET | `/stats` | System-wide counts and risk distribution |
| GET | `/stats/accuracy` | Compare stored scores with recorded outcomes |
| GET | `/admin/refresh-blocklists` | Refresh authenticated self-hosted IP blocklists |
GET `/analyze/:userId` remains backward compatible and accepts optional `ip`, `username`, `avatar`, `createdTimestamp`, and `guildId` query parameters. POST `/analyze/:userId` accepts JSON fields `username`, `avatar`, `createdTimestamp`, `guildId`, `ip`, `premiumType`, `decoration`, `banner`, and `referenceId`. Unknown or invalid IP/timestamp fields are ignored. `referenceId` is echoed only when it is a string of at most 64 characters.

```bash
curl -X POST http://localhost:3000/analyze/123456789012345678 \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"username":"normalname","avatar":"avatarhash","createdTimestamp":1700000000000,"guildId":"123456789012345679","ip":"203.0.113.10","premiumType":2,"decoration":{"asset":"decoration"},"banner":"bannerhash","referenceId":"portal-123"}'
```

The response retains the existing fields (`userId`, `username`, `dataSource`, `discordEnriched`, `riskScore`, `riskLevel`, `recommendation`, `confidence`, `scoreVersion`, `breakdown`, `reasons`, `cached`, `analyzedAt`) and adds `autoCandidate`, `referenceId`, `breakdown.profile.richness`, and `breakdown.guildBaseline`. `scoreVersion` is `2.1`; `autoCandidate` is only a portal hint.

When `DISCORD_TOKEN` is configured, Discord is used as an optional source for username, avatar, account age, and optional guild-member data. Discord failures and rate limits never fail analysis. Behavior scores use decayed 5-minute, 1-hour, 24-hour, and 7-day windows. Configure `SHARED_NETWORK_ASNS` or `SHARED_NETWORK_ISPS` to reduce false positives from carrier, school, workplace, or other shared networks. Guild baselines are learned from observed account ages, joins, raids, and verification outcomes. Risk thresholds are centralized in `src/analyzers/thresholds.js`: clean/allow 0-25, low/monitor 26-50, high/challenge 51-75, critical/queue 76-90, and critical/block 91-100.

## Scoring

The 2.1 engine uses noisy-OR:

`p = 1 - product(1 - (signalScore / 100) * weight)`

| Signal | Amplified weight |
|---|---:|
| profile | 0.9 |
| username | 0.5 |
| behavior | 0.9 |
| network | 0.8 |
| alt | 0.8 |
| join | 0.5 |
| guildBaseline | 0.4 |

The final score is `round(100 * p)`, minus `breakdown.profile.richness` only when no network, alt, or join red flag is present and no forced-block flag applies. Profile richness is decoration 4, premium 3, banner 2, and bio 1, capped at 10.

## Production

Set `DATABASE_URL`, `API_KEY`, `PORT`, and optionally `DISCORD_TOKEN` in Railway. `IP_LOOKUP_URL` defaults to the HTTPS ipwho.is API and `IP_LOOKUP_FIELDS` controls its requested fields. Set `CORS_ORIGINS`, `HIGH_RISK_COUNTRIES`, `SHARED_NETWORK_ASNS`, and `SHARED_NETWORK_ISPS` only with known values. Run `npm start`. Discord profiles are cached in memory for one hour and Discord rate-limit backoff is respected. IP reputation responses are cached for 24 hours in the database and scores are cached in memory for five minutes. Empty blocklists are refreshed lazily after startup from free FireHOL, proxy, and Tor sources.

Database startup uses versioned modules in `src/db/migrations/`. The `schema_migrations` table records applied versions; only missing migrations run, in numeric order, and each migration's statements are executed with failure logged clearly. `schema.sql` remains reference documentation.

`TRUST_PROXY` enables Express proxy trust only when it is explicitly set to `1` or a positive number. Leave it unset unless the reverse proxy is configured correctly. Public unauthenticated routes use `RATE_LIMIT_PUBLIC` (default 60/minute). Authenticated routes use `RATE_LIMIT_AUTH` (default 600/minute, clamped to 30–10000) with buckets keyed by a SHA-256 API-key hash plus guild ID. `JOIN_WAVE_MIN` controls join-wave size (default 3, clamped to 2–20).

## Validation

```bash
npm run check
```
