# Varsonalia — Field Game Map

**A team-based event map with station scoring, photo bingo and an administrator panel.**

Node.js 24 · Express · Multer · browser maps · JSON persistence

The application coordinates six teams across game stations and photo bingo tasks. The server manages game data and uploads; the browser presents team dashboards, scores and the map.

## Run locally

```bash
git clone https://github.com/Korniszon99/varso_mapka.git
cd varso_mapka
npm ci
npm start
```

Open <http://localhost:3000/>. Set `ADMIN_PASSWORD`, `TEAM_1_PASSWORD` through `TEAM_6_PASSWORD`, and `STATION_1_PASSWORD` through `STATION_6_PASSWORD` in the process environment before enabling those logins. `.env.example` is a template, not an automatically loaded file. Generate new unique credentials, including for any previously deployed event.

Start with the administrator login and initialize the game through its reset control. Resetting a live game deletes scores and bingo uploads, so use a separate test instance to verify it.

## Access and storage

- Passwords are checked on the server; the frontend contains no administrator, team or station password table.
- Short-lived bearer sessions stay in browser memory. Server restarts require a new login.
- Teams can change their own bingo marks; they cannot overwrite other teams or station points.
- Station scoring requires its separate server-configured credential. Reset requires administrator authorization.
- Uploads require team/admin authorization, bounded IDs and supported image signatures. SVG and arbitrary file extensions are rejected.

Data lives in `data/gameData.json`; images live in `public/uploads/`. Both are ignored by Git. `DATA_DIR` can override the JSON data directory. Scores and uploaded photos are public event content in this prototype.

## Verification and deployment

```bash
npm test
npm audit
```

The integration test exercises unauthenticated requests, team isolation, score protection and administrator-only reset. CI repeats the checks and scans current source for secrets.

For a small event, use one Node process behind HTTPS and a persistent disk, with request limits and backups. JSON file storage and in-memory sessions are unsuitable for a distributed deployment. For a larger service migrate data and sessions to a transactional database, add observability and test simultaneous clients. Existing frontend event flows still need a staging/browser regression pass.

**Portfolio fit:** useful full-stack experience, secondary to the 3D vision and photogrammetry projects. [Security notes](SECURITY.md).
