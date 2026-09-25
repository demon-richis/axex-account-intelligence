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
| GET | `/score/:userId` | Cached or persisted quick score lookup |
| POST | `/record` | Record a behavior event |
| POST | `/outcome` | Record a moderator or verification outcome |
| GET | `/alts/:userId` | List known linked accounts |
| POST | `/flag/:userId` | Manually flag an account and invalidate its cache |
| GET | `/ip/:ipAddress` | View cached IP reputation |
| GET | `/stats` | System-wide counts and risk distribution |
| GET | `/stats/accuracy` | Compare stored scores with recorded outcomes |
| GET | `/admin/refresh-blocklists` | Refresh authenticated self-hosted IP blocklists |
| POST | `/verify-link/create` | Create an authenticated one-time web capture token |
| GET/POST | `/v/:token` | Show and complete an unauthenticated web IP capture link |

`/analyze/:userId` accepts optional `ip`, `username`, `avatar`, `createdTimestamp`, and `guildId` query parameters. Unknown optional fields are not treated as suspicious. `createdTimestamp` must be a valid non-future Unix timestamp and IP values must be valid IPv4 or IPv6 addresses.

When `DISCORD_BOT_TOKEN` is configured, Discord is the authoritative source for username, avatar, account age, and optional guild-member data. Behavior scores use decayed 5-minute, 1-hour, 24-hour, and 7-day windows. Configure `SHARED_NETWORK_ASNS` or `SHARED_NETWORK_ISPS` to reduce false positives from carrier, school, workplace, or other shared networks. Guild baselines are learned from observed account ages, joins, raids, and verification outcomes. Risk thresholds are centralized in `src/analyzers/thresholds.js`: clean/allow 0-25, low/monitor 26-50, high/challenge 51-75, critical/queue 76-90, and critical/block 91-100.

## Production

Set `DATABASE_URL`, `API_KEY`, `PORT`, and optionally `DISCORD_BOT_TOKEN` in Railway. `IP_LOOKUP_URL` defaults to the HTTPS ipwho.is API and `IP_LOOKUP_FIELDS` controls its requested fields. Set `TRUST_PROXY=true` only when the deployment has a correctly configured trusted reverse proxy; this controls whether captured `req.ip` may come from forwarded headers. Set `CORS_ORIGINS`, `HIGH_RISK_COUNTRIES`, `SHARED_NETWORK_ASNS`, and `SHARED_NETWORK_ISPS` only with known values. Run `npm start`. The schema and compatible migrations are applied automatically at startup; IP reputation responses are cached for 24 hours in the database and scores are cached in memory for five minutes. Empty blocklists are refreshed lazily after startup from free FireHOL, proxy, and Tor sources.

## Validation

```bash
npm run check
```
