# Prospector's Planner

Course planning tool for UTEP students. Not affiliated with, sponsored by or
endorsed by The University of Texas at El Paso. See [CLAUDE.md](CLAUDE.md)
for the full project brief, data sources, and architectural constraints.

## Run it locally

Requires Node 24+ (uses `node:sqlite`, unflagged only on 24+). No npm
dependencies, no build step.

```
cp .env.example .env   # then edit .env and set a real ADMIN_PASSWORD
ADMIN_PASSWORD=yourpassword node server/index.js
```

Serves the public site and the password-gated admin panel from one process
on `http://localhost:8420`. Admin panel: `http://localhost:8420/admin`.

## Scrape data

Two independent scrapers, each callable directly or from the admin
ingestion page:

```
npm run scrape:schedule      # daily job: every subject, every section, one term
npm run scrape:evaluations   # ~semester job: every instructor's HB 2504 history
```

Data lands in `scrapers/data/lode.db` (gitignored). Set `DB_DIR` to point it
at a persistent disk when hosting (see CLAUDE.md, "Data").

## Tests

```
npm test
```

Unit tests cover the scraper parsers against saved markup fixtures, not a
live network call.

## License

MIT. See [LICENSE](LICENSE). The code is MIT-licensed; the scraped data
(HB 2504 evaluations, Banner schedule listings) belongs to its original
sources and is used here as public data per Texas HB 2504 and UTEP's public
schedule listings, not redistributed as this project's own work.
