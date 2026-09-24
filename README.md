# Axex Account Intelligence

Standalone Express REST API for Discord account risk analysis. It supports Neon/PostgreSQL in production and an in-memory store for local development when `DATABASE_URL` is absent.

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
| GET | `/alts/:userId` | List known linked accounts |
| POST | `/flag/:userId` | Manually flag an account and invalidate its cache |
| GET | `/ip/:ipAddress` | View cached IP reputation |
| GET | `/stats` | System-wide counts and risk distribution |

`/analyze/:userId` accepts `ip`, `username`, `avatar`, `createdTimestamp`, and `guildId` query parameters.

## Production

Set `DATABASE_URL`, `API_KEY`, and `PORT` in Railway. Run `npm start`. The schema is applied automatically at startup; IP reputation responses are cached for 24 hours in the database and scores are cached in memory for five minutes.

## Validation

```bash
npm run check
```
