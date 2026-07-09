/*
Created by Franz Zemen
License Type: UNLICENSED

Benzinga real-time news (projects/doc/prd/benzinga-news.prd.md, E1).

The durability side-write for the Benzinga real-time news feed. Benzinga
(`GET /benzinga/v2/news`) is served to the FE from an IN-MEMORY feed loop in
scanners-worker (`BenzingaNewsCache`, mirroring the scanners RealtimeSnapshotCache);
these tables are ONLY the async persistence backing — they are never on the read
path. The cache reseeds from them on boot (and derives its global `published.gt`
watermark from MAX(published_utc)) so a restart doesn't lose recent articles.

Two tables (deliberately separate from the Massive `news_article*` family — the
shapes barely overlap: Benzinga carries body/teaser/channels/tags/images and NO
publisher/sentiment; Massive carries publisher/insight and no body):

  - bz_news_article         (one row per Benzinga article; PK = Benzinga's integer id)
  - bz_news_article_ticker  (association — only the tickers the feed polled for)

Design notes:
  * Article identity = Benzinga's stable integer `id` → BIGINT PK. Incremental
    `published.gt` fetches overlap only at the boundary; upsert-by-id is idempotent.
    BIGINT reads back from node-pg as a string (kysely convention); financial-data
    Number()s it at the DTO boundary (benzinga_id ≪ MAX_SAFE_INTEGER).
  * Nullable-heavy: only identity (benzinga_id), title, url, published_utc are NOT
    NULL — teaser/body/author/channels/tags/images/last_updated_utc are vendor-optional
    (some Benzinga rows are headline-only for faster delivery).
  * NO insight table (Benzinga has no sentiment) and NO watermark table (the
    watermark is the in-memory MAX(published_utc), recomputed on reseed).
  * Retention: a daily pg_cron job deletes rows older than 30 days (mirrors the
    Massive news retention); ON DELETE CASCADE clears the association rows.
  * Actor CHECK relaxed (user|brokenstock) — the feed loop writes under the system
    actor; a session actor is also permitted.

Pins MIN_SCHEMA_VERSION = 2026-07-09T120000Z (supersedes 2026-07-07T120000Z).
financial-data pins to this DDL minor for its BenzingaNewsCache/BenzingaNewsApi.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ACTOR_CHK = `~ '^${UUID_RE}\\.(user|brokenstock)$'`;

export const up = (pgm: MigrationBuilder): void => {
  // ── bz_news_article — one row per Benzinga article (shared across tickers) ──
  pgm.sql(`
    CREATE TABLE bz_news_article (
      benzinga_id       BIGINT PRIMARY KEY,       -- Benzinga stable integer id
      title             TEXT NOT NULL,
      teaser            TEXT,                      -- short lead-in
      body              TEXT,                      -- full HTML article text (headline-only rows omit)
      author            TEXT,
      channels          TEXT[],                    -- editorial categories (earnings, price target, …)
      tags              TEXT[],                    -- themes (why it's moving, …)
      images            TEXT[],                    -- sized image URLs
      url               TEXT NOT NULL,
      published_utc     TIMESTAMPTZ NOT NULL,      -- publication time (not ingestion)
      last_updated_utc  TIMESTAMPTZ,               -- Benzinga edit/correction time
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by        TEXT NOT NULL,
      updated_by        TEXT NOT NULL,
      CONSTRAINT bz_news_article_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT bz_news_article_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  // Retention purge scan + global newest-first ordering + watermark MAX().
  pgm.sql(`CREATE INDEX bz_news_article_published_utc_idx ON bz_news_article (published_utc);`);
  pgm.sql(`
    CREATE TRIGGER bz_news_article_set_updated_at BEFORE UPDATE ON bz_news_article
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── bz_news_article_ticker — association (the tickers the feed polled for) ──
  pgm.sql(`
    CREATE TABLE bz_news_article_ticker (
      security_key  TEXT NOT NULL REFERENCES securities(key) ON DELETE CASCADE,
      benzinga_id   BIGINT NOT NULL REFERENCES bz_news_article(benzinga_id) ON DELETE CASCADE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by    TEXT NOT NULL,
      updated_by    TEXT NOT NULL,
      PRIMARY KEY (security_key, benzinga_id),
      CONSTRAINT bz_news_article_ticker_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT bz_news_article_ticker_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  // FK reverse lookup + cascade support + per-ticker newest-first read.
  pgm.sql(`CREATE INDEX bz_news_article_ticker_benzinga_id_idx ON bz_news_article_ticker (benzinga_id);`);
  pgm.sql(`
    CREATE TRIGGER bz_news_article_ticker_set_updated_at BEFORE UPDATE ON bz_news_article_ticker
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── 30-day retention purge (pg_cron) — prod_blue-guarded, mirrors news-article-purge ──
  // Daily at 04:24 UTC. Deleting the article cascades to the association rows.
  pgm.sql(`
    DO $do$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE NOTICE 'Skipping pg_cron bz-news-article-purge on %: pg_cron not installed.', current_database();
      ELSIF current_database() <> (SELECT setting FROM pg_settings WHERE name = 'cron.database_name') THEN
        RAISE NOTICE 'Skipping pg_cron bz-news-article-purge on %: only registered in cron.database_name (prod_blue).', current_database();
      ELSE
        EXECUTE 'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = ''bz-news-article-purge''';
        EXECUTE $sql$SELECT cron.schedule('bz-news-article-purge', '24 4 * * *', $job$
          DELETE FROM bz_news_article WHERE published_utc < now() - interval '30 days';
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
        EXECUTE 'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = ''bz-news-article-purge''';
      END IF;
    END
    $do$;
  `);
  pgm.sql(`DROP TRIGGER IF EXISTS bz_news_article_ticker_set_updated_at ON bz_news_article_ticker;`);
  pgm.dropTable('bz_news_article_ticker', {ifExists: true});
  pgm.sql(`DROP TRIGGER IF EXISTS bz_news_article_set_updated_at ON bz_news_article;`);
  pgm.dropTable('bz_news_article', {ifExists: true});
};
