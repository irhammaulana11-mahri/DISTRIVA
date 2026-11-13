-- DESTRUCTIVE: only for the disposable test database.
DO $$
BEGIN
  IF current_database() <> 'distriva_t424_test' THEN
    RAISE EXCEPTION 'Refusing cleanup outside distriva_t424_test';
  END IF;
END $$;

DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
