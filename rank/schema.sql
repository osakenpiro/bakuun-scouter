CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  game TEXT NOT NULL,
  n INTEGER NOT NULL,
  mult REAL NOT NULL,
  power REAL NOT NULL,
  bit REAL NOT NULL,
  denom INTEGER,            -- v1.2: slotの分母(3-20)。固定オッズゲームはNULL
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_power ON records(power DESC);
-- v1.3: 今日の運ランキング(JST日次スコープ)用
CREATE INDEX IF NOT EXISTS idx_created ON records(created_at);
-- v1.2: IP rate-limit 用（ハッシュ済IP + ts、24hで自動掃除）
CREATE TABLE IF NOT EXISTS rl (
  key TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rl ON rl(key, ts);
-- 既存DBへの移行(v1.1→v1.2、一度だけ): ALTER TABLE records ADD COLUMN denom INTEGER;
