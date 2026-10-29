-- Garden City: Reign — multiplayer foundation schema
-- One shared world: accounts, characters, districts, businesses, economy.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- accounts
CREATE TABLE accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            citext NOT NULL UNIQUE,
  password_hash    text NOT NULL,
  role             text NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'moderator', 'admin')),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned')),
  email_verified_at timestamptz,
  failed_logins    int NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  last_login_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX sessions_account_idx ON sessions (account_id) WHERE revoked_at IS NULL;

CREATE TABLE auth_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('verify_email', 'reset_password')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_account_idx ON auth_tokens (account_id, kind);

-- Dev-only outbox so email links can be exercised without an SMTP account.
-- Never populated when a mail transport is configured (see src/mail.js).
CREATE TABLE mail_outbox (
  id         bigserial PRIMARY KEY,
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  to_email   text NOT NULL,
  subject    text NOT NULL,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- world
CREATE TABLE world_state (
  id                smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  epoch_started_at  timestamptz NOT NULL DEFAULT now(),
  game_hour_seconds int NOT NULL DEFAULT 5 CHECK (game_hour_seconds > 0),
  season            int NOT NULL DEFAULT 1
);

CREATE TABLE cities (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug      text NOT NULL UNIQUE,
  name      text NOT NULL,
  region    text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  ordinal   int NOT NULL DEFAULT 0
);

CREATE TABLE districts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id     uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  slug        text NOT NULL,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  map_x       int NOT NULL DEFAULT 0,
  map_y       int NOT NULL DEFAULT 0,
  safe_zone   boolean NOT NULL DEFAULT false,
  ordinal     int NOT NULL DEFAULT 0,
  UNIQUE (city_id, slug)
);

CREATE TABLE locations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id        uuid NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  slug               text NOT NULL,
  name               text NOT NULL,
  kind               text NOT NULL,
  owner_character_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (district_id, slug)
);

-- ---------------------------------------------------------------- characters
CREATE TABLE characters (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  display_name    text NOT NULL CHECK (char_length(display_name) BETWEEN 3 AND 20),
  avatar          text NOT NULL DEFAULT '🌟',
  start_age       int NOT NULL DEFAULT 18 CHECK (start_age BETWEEN 1 AND 120),
  age             int NOT NULL DEFAULT 18 CHECK (age BETWEEN 1 AND 120),
  game_week       int NOT NULL DEFAULT 0,
  city_id         uuid NOT NULL REFERENCES cities(id),
  district_id     uuid NOT NULL REFERENCES districts(id),
  money           bigint NOT NULL DEFAULT 5000 CHECK (money >= 0),
  energy          int NOT NULL DEFAULT 100 CHECK (energy BETWEEN 0 AND 100),
  health          int NOT NULL DEFAULT 100 CHECK (health BETWEEN 0 AND 100),
  happiness       int NOT NULL DEFAULT 80 CHECK (happiness BETWEEN 0 AND 100),
  fame            int NOT NULL DEFAULT 0 CHECK (fame >= 0),
  reputation      int NOT NULL DEFAULT 0,
  acting_skill    int NOT NULL DEFAULT 0 CHECK (acting_skill BETWEEN 0 AND 100),
  iq              int NOT NULL DEFAULT 5 CHECK (iq BETWEEN 0 AND 200),
  charm           int NOT NULL DEFAULT 30 CHECK (charm BETWEEN 0 AND 100),
  education       text NOT NULL DEFAULT 'none',
  career          text NOT NULL DEFAULT 'none',
  discoverable    boolean NOT NULL DEFAULT true,
  show_finances    boolean NOT NULL DEFAULT false,
  show_location    boolean NOT NULL DEFAULT true,
  duel_wins       int NOT NULL DEFAULT 0,
  duel_losses     int NOT NULL DEFAULT 0,
  imported_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_settled_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX characters_district_idx ON characters (district_id);
CREATE INDEX characters_name_idx ON characters (lower(display_name));
CREATE INDEX characters_fame_idx ON characters (fame DESC);

CREATE TABLE character_achievements (
  id           bigserial PRIMARY KEY,
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  code         text NOT NULL,
  label        text NOT NULL,
  unlocked_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (character_id, code)
);

-- ---------------------------------------------------------------- economy
CREATE TABLE ledger (
  id              bigserial PRIMARY KEY,
  character_id    uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  delta           bigint NOT NULL,
  balance_after   bigint NOT NULL,
  kind            text NOT NULL,
  ref             text,
  idempotency_key text NOT NULL DEFAULT gen_random_uuid()::text,
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (character_id, idempotency_key)
);
CREATE INDEX ledger_character_idx ON ledger (character_id, created_at DESC);
CREATE INDEX ledger_kind_idx ON ledger (kind, created_at DESC);

CREATE TABLE transfers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  to_character_id   uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  amount            bigint NOT NULL CHECK (amount > 0),
  fee               bigint NOT NULL CHECK (fee >= 0),
  idempotency_key   text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (from_character_id <> to_character_id),
  UNIQUE (from_character_id, idempotency_key)
);
CREATE INDEX transfers_to_idx ON transfers (to_character_id, created_at DESC);

-- ---------------------------------------------------------------- activities (server clock)
CREATE TABLE activities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id    uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  kind            text NOT NULL,
  title           text NOT NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  ends_at         timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  energy_cost     int NOT NULL DEFAULT 0,
  reward_money    bigint NOT NULL DEFAULT 0,
  reward_xp       int NOT NULL DEFAULT 0,
  reward_fame     int NOT NULL DEFAULT 0,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at    timestamptz,
  idempotency_key text,
  UNIQUE (character_id, idempotency_key)
);
CREATE INDEX activities_due_idx ON activities (status, ends_at);
CREATE INDEX activities_character_idx ON activities (character_id, status);

-- ---------------------------------------------------------------- businesses
CREATE TABLE business_types (
  code           text PRIMARY KEY,
  name           text NOT NULL,
  description    text NOT NULL DEFAULT '',
  icon           text NOT NULL DEFAULT '🏪',
  cost           bigint NOT NULL CHECK (cost > 0),
  base_revenue   bigint NOT NULL CHECK (base_revenue >= 0),
  upgrade_cost   bigint NOT NULL CHECK (upgrade_cost >= 0),
  upkeep_per_day bigint NOT NULL DEFAULT 0 CHECK (upkeep_per_day >= 0),
  max_level      int NOT NULL DEFAULT 5 CHECK (max_level >= 1)
);

CREATE TABLE businesses (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  type_code          text NOT NULL REFERENCES business_types(code),
  name               text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 30),
  district_id        uuid NOT NULL REFERENCES districts(id),
  location_id        uuid REFERENCES locations(id),
  level              int NOT NULL DEFAULT 1 CHECK (level >= 1),
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  total_revenue      bigint NOT NULL DEFAULT 0,
  opened_at          timestamptz NOT NULL DEFAULT now(),
  last_collected_at  timestamptz NOT NULL DEFAULT now(),
  idempotency_key    text,
  UNIQUE (owner_character_id, idempotency_key)
);
CREATE INDEX businesses_owner_idx ON businesses (owner_character_id);
CREATE INDEX businesses_district_idx ON businesses (district_id);

-- ---------------------------------------------------------------- social
CREATE TABLE friendships (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  addressee_character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  status                 text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'blocked')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (requester_character_id <> addressee_character_id),
  UNIQUE (requester_character_id, addressee_character_id)
);
CREATE INDEX friendships_addressee_idx ON friendships (addressee_character_id, status);

CREATE TABLE duels (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenger_id     uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  opponent_id       uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  district_id       uuid NOT NULL REFERENCES districts(id),
  status            text NOT NULL DEFAULT 'resolved' CHECK (status IN ('resolved', 'void')),
  winner_id         uuid REFERENCES characters(id),
  rounds            jsonb NOT NULL DEFAULT '[]'::jsonb,
  challenger_power  int NOT NULL DEFAULT 0,
  opponent_power    int NOT NULL DEFAULT 0,
  idempotency_key   text NOT NULL DEFAULT gen_random_uuid()::text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (challenger_id <> opponent_id),
  UNIQUE (challenger_id, idempotency_key)
);
CREATE INDEX duels_challenger_idx ON duels (challenger_id, created_at DESC);
CREATE INDEX duels_opponent_idx ON duels (opponent_id, created_at DESC);

CREATE TABLE city_feed (
  id           bigserial PRIMARY KEY,
  kind         text NOT NULL,
  character_id uuid REFERENCES characters(id) ON DELETE SET NULL,
  district_id  uuid REFERENCES districts(id) ON DELETE SET NULL,
  message      text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX city_feed_created_idx ON city_feed (created_at DESC);

-- ---------------------------------------------------------------- admin / config
CREATE TABLE admin_overrides (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id  uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  resource      text NOT NULL CHECK (resource IN ('money', 'energy', 'health')),
  unlimited     boolean NOT NULL DEFAULT true,
  granted_by    uuid REFERENCES accounts(id) ON DELETE CASCADE,
  reason        text NOT NULL,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admin_overrides_active_idx
  ON admin_overrides (character_id, resource) WHERE revoked_at IS NULL;

CREATE TABLE admin_audit_log (
  id                bigserial PRIMARY KEY,
  actor_account_id  uuid REFERENCES accounts(id) ON DELETE SET NULL,
  target_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  action            text NOT NULL,
  reason            text NOT NULL DEFAULT '',
  before            jsonb NOT NULL DEFAULT '{}'::jsonb,
  after             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_created_idx ON admin_audit_log (created_at DESC);
CREATE INDEX admin_audit_target_idx ON admin_audit_log (target_account_id, created_at DESC);

CREATE TABLE game_config (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE save_imports (
  id           bigserial PRIMARY KEY,
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  fields       jsonb NOT NULL,
  warnings     jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
