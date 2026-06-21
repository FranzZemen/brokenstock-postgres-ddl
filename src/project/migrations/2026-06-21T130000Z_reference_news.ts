/*
Created by Franz Zemen
License Type: UNLICENSED

Reference News (broken-stock/doc/prd/reference-news.prd.md, E1).

Demand-driven Massive `/v2/reference/news` cache, anchored to securities(key).
The News tab of the Reference screen drives fetches; financial-data caches the
vendor result here so identical repeat requests for a ticker do NOT re-meter the
vendor (metered_vendor_credits). Four tables:

  - news_article          (one row per Massive article; shared across tickers; PK = Massive id)
  - news_article_ticker   (association — ONLY the requested ticker, never co-mentioned tickers[])
  - news_article_insight  (per-ticker sentiment; ONLY the requested ticker's insight)
  - news_ticker_fetch     (the per-ticker CHECK-watermark — last *successful* Massive check)

Design notes:
  * Article identity = Massive's stable `id` (TEXT PK). Refetch upserts by id, so
    overlap between successive pages is idempotent.
  * Nullable-heavy: only identity (id), title, article_url, published_utc are NOT
    NULL — everything else (author, image, publisher_*, keywords, description) is
    vendor-optional. `amp_url` is intentionally NOT stored (mobile-AMP, unused).
  * An article is associated with ONLY the ticker that was requested (D: avoid
    polluting co-mentioned tickers' feeds + keep watermark semantics clean).
  * Insight is stored only when the article carries one for the requested ticker;
    absence → the FE renders a neutral/empty sentiment dot.
  * news_ticker_fetch records the CHECK (not the newest article), so a ticker that
    legitimately has zero news is not re-hit every request. Updated by
    financial-data ONLY on a successful vendor fetch (an outage is never cached as
    "checked").
  * Retention: a daily pg_cron job deletes news_article rows older than 30 days;
    ON DELETE CASCADE clears the association + insight rows. Orphan
    news_ticker_fetch rows are harmless (re-checked on next demand).
  * Actor CHECK = relaxed (user|brokenstock) — the demand-fetch writes under the
    session actor; the system actor is also permitted.

Pins MIN_SCHEMA_VERSION = 2026-06-21T130000Z (supersedes 2026-06-21T120000Z).
financial-data pins to this DDL minor for its NewsTrustedApi/NewsApi.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ACTOR_CHK = `~ '^${UUID_RE}\\.(user|brokenstock)$'`;

export const up = (pgm: MigrationBuilder): void => {
  // ── news_article — one row per Massive article (shared across tickers) ──
  pgm.sql(`
    CREATE TABLE news_article (
      id                      TEXT PRIMARY KEY,        -- Massive stable article id
      title                   TEXT NOT NULL,
      description             TEXT,                    -- 1-2 sentence summary
      article_url             TEXT NOT NULL,
      published_utc           TIMESTAMPTZ NOT NULL,    -- publication time (not ingestion)
      author                  TEXT,
      image_url               TEXT,                    -- rendered on expand only
      publisher_name          TEXT,
      publisher_homepage_url  TEXT,
      publisher_favicon_url   TEXT,                    -- row branding
      publisher_logo_url      TEXT,
      keywords                TEXT[],
      created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by              TEXT NOT NULL,
      updated_by              TEXT NOT NULL,
      CONSTRAINT news_article_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT news_article_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  // Retention purge scan + global newest-first ordering.
  pgm.sql(`CREATE INDEX news_article_published_utc_idx ON news_article (published_utc);`);
  pgm.sql(`
    CREATE TRIGGER news_article_set_updated_at BEFORE UPDATE ON news_article
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── news_article_ticker — association (only the requested ticker) ──
  pgm.sql(`
    CREATE TABLE news_article_ticker (
      security_key  TEXT NOT NULL REFERENCES securities(key) ON DELETE CASCADE,
      article_id    TEXT NOT NULL REFERENCES news_article(id) ON DELETE CASCADE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by    TEXT NOT NULL,
      updated_by    TEXT NOT NULL,
      PRIMARY KEY (security_key, article_id),
      CONSTRAINT news_article_ticker_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT news_article_ticker_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  // FK reverse lookup + cascade support.
  pgm.sql(`CREATE INDEX news_article_ticker_article_id_idx ON news_article_ticker (article_id);`);
  pgm.sql(`
    CREATE TRIGGER news_article_ticker_set_updated_at BEFORE UPDATE ON news_article_ticker
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── news_article_insight — per-ticker sentiment (only the requested ticker) ──
  pgm.sql(`
    CREATE TABLE news_article_insight (
      article_id           TEXT NOT NULL REFERENCES news_article(id) ON DELETE CASCADE,
      security_key         TEXT NOT NULL REFERENCES securities(key) ON DELETE CASCADE,
      sentiment            TEXT NOT NULL,
      sentiment_reasoning  TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by           TEXT NOT NULL,
      updated_by           TEXT NOT NULL,
      PRIMARY KEY (article_id, security_key),
      CONSTRAINT news_article_insight_sentiment_chk
        CHECK (sentiment IN ('positive', 'negative', 'neutral')),
      CONSTRAINT news_article_insight_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT news_article_insight_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  pgm.sql(`
    CREATE TRIGGER news_article_insight_set_updated_at BEFORE UPDATE ON news_article_insight
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── news_ticker_fetch — the per-ticker CHECK-watermark ──
  pgm.sql(`
    CREATE TABLE news_ticker_fetch (
      security_key      TEXT PRIMARY KEY REFERENCES securities(key) ON DELETE CASCADE,
      last_checked_utc  TIMESTAMPTZ NOT NULL,   -- time of last SUCCESSFUL Massive check
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by        TEXT NOT NULL,
      updated_by        TEXT NOT NULL,
      CONSTRAINT news_ticker_fetch_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT news_ticker_fetch_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  pgm.sql(`
    CREATE TRIGGER news_ticker_fetch_set_updated_at BEFORE UPDATE ON news_ticker_fetch
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── 30-day retention purge (pg_cron) — prod_blue-guarded, mirrors era_4_4b ──
  // Daily at 04:23 UTC. Deleting the article cascades to association + insight.
  pgm.sql(`
    DO $do$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE NOTICE 'Skipping pg_cron news-article-purge on %: pg_cron not installed.', current_database();
      ELSIF current_database() <> (SELECT setting FROM pg_settings WHERE name = 'cron.database_name') THEN
        RAISE NOTICE 'Skipping pg_cron news-article-purge on %: only registered in cron.database_name (prod_blue).', current_database();
      ELSE
        EXECUTE 'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = ''news-article-purge''';
        EXECUTE $sql$SELECT cron.schedule('news-article-purge', '23 4 * * *', $job$
          DELETE FROM news_article WHERE published_utc < now() - interval '30 days';
        $job$)$sql$;
      END IF;
    END
    $do$;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    DO $do$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
         AND current_database() = (SELECT setting FROM pg_settings WHERE name = 'cron.database_name') THEN
        EXECUTE 'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = ''news-article-purge''';
      END IF;
    END
    $do$;
  `);
  pgm.sql(`DROP TRIGGER IF EXISTS news_ticker_fetch_set_updated_at ON news_ticker_fetch;`);
  pgm.dropTable('news_ticker_fetch', {ifExists: true});
  pgm.sql(`DROP TRIGGER IF EXISTS news_article_insight_set_updated_at ON news_article_insight;`);
  pgm.dropTable('news_article_insight', {ifExists: true});
  pgm.sql(`DROP TRIGGER IF EXISTS news_article_ticker_set_updated_at ON news_article_ticker;`);
  pgm.dropTable('news_article_ticker', {ifExists: true});
  pgm.sql(`DROP TRIGGER IF EXISTS news_article_set_updated_at ON news_article;`);
  pgm.dropTable('news_article', {ifExists: true});
};
