-- DISTRIVA PostgreSQL test harness
-- SAFETY: run only in a disposable database named distriva_t424_test.
DO $$
BEGIN
  IF current_database() <> 'distriva_t424_test' THEN
    RAISE EXCEPTION 'Unsafe target database: %. Expected distriva_t424_test.', current_database();
  END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
