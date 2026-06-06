// bakuun-rank — バク運スカウター 全人類ランキング Worker (D1) v1.3
// Endpoints: GET /top?limit=50&scope=all|today / POST /submit {name, game, n, mult, denom?}
// 戦闘力はサーバ側で再計算（クライアント値は信用しない）。bit=純粋値。
// v1.2: スロット(denom 3-20) / IP rate-limit(6/min, 60/day) / 重複submit抑制(10min) / 名前NGフィルタ
// v1.3: 今日の運ランキング — JST日次スコープ。/top?scope=today + submitがtrank/ttotal(今日順位)を返す
const BASES = { coin: 2, card: 3, dice: 6 };
const SLOT_MIN = 3, SLOT_MAX = 20;
const FALLBACK_NAME = '名無しの挑戦者';
// 必要最小限のNG: スパムURL/宣伝 + 露骨な攻撃語。引っかかったらフォールバック名に置換（拒否はしない）
const NG_RE = /(https?:\/\/|www\.|\.(com|net|org|io|jp|xyz)\b|死ね|殺す|殺せ|レイプ|f[u*]ck|n[i1]gger|nazi|cunt)/i;
const RL_MIN_MAX = 6;    // 同一IP 1分あたり
const RL_DAY_MAX = 60;   // 同一IP 24hあたり
const JST_MS = 9 * 3600000; // 「今日」はJST基準（日本時間0時に仕切り直し）
const jstDayStart = now => Math.floor((now + JST_MS) / 86400000) * 86400000 - JST_MS;

export default {
  async fetch(req, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(req.url);
    try {
      if (req.method === 'GET' && url.pathname === '/top') {
        const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50', 10) || 50);
        const today = url.searchParams.get('scope') === 'today';
        const since = today ? jstDayStart(Date.now()) : 0;
        const { results } = await env.DB.prepare(
          'SELECT name, game, n, mult, power, bit, denom, created_at FROM records WHERE created_at >= ? ORDER BY power DESC, created_at ASC LIMIT ?'
        ).bind(since, limit).all();
        return json({ ok: true, scope: today ? 'today' : 'all', top: results }, cors);
      }
      if (req.method === 'POST' && url.pathname === '/submit') {
        const b = await req.json();
        // --- name sanitize + NGフィルタ ---
        let name = String(b.name || FALLBACK_NAME)
          .replace(/[\r\n\t]/g, ' ')
          .replace(/[​-‏‪-‮﻿]/g, '')
          .trim().slice(0, 20) || FALLBACK_NAME;
        if (NG_RE.test(name)) name = FALLBACK_NAME;
        // --- validation + server recompute ---
        const game = String(b.game);
        const n = Math.floor(Number(b.n));
        const mult = Math.round(Number(b.mult) * 100) / 100;
        let base, denom = null;
        if (game === 'slot') {
          denom = Math.floor(Number(b.denom));
          if (!Number.isInteger(denom) || denom < SLOT_MIN || denom > SLOT_MAX) return json({ ok: false, err: 'bad denom' }, cors, 400);
          base = denom;
        } else {
          base = BASES[game];
          if (!base) return json({ ok: false, err: 'bad game' }, cors, 400);
        }
        if (!Number.isFinite(n) || n < 1 || n > 250) return json({ ok: false, err: 'bad n' }, cors, 400);
        if (!Number.isFinite(mult) || mult < 1 || mult > 2) return json({ ok: false, err: 'bad mult' }, cors, 400);
        const power = Math.pow(base, n) * mult; // server recompute
        const bit = n * Math.log2(base);
        if (!Number.isFinite(power) || !Number.isFinite(bit)) return json({ ok: false, err: 'bad record' }, cors, 400);
        // --- IP rate-limit (hashed IP, 6/min & 60/day) ---
        const now = Date.now();
        const ip = req.headers.get('CF-Connecting-IP') || '0.0.0.0';
        const iph = await sha256hex(ip);
        await env.DB.prepare('DELETE FROM rl WHERE ts < ?').bind(now - 86400000).run();
        const rl = await env.DB.prepare(
          'SELECT COUNT(*) AS d, SUM(CASE WHEN ts > ? THEN 1 ELSE 0 END) AS m FROM rl WHERE key = ?'
        ).bind(now - 60000, iph).first();
        if (Number(rl.m || 0) >= RL_MIN_MAX || Number(rl.d || 0) >= RL_DAY_MAX) {
          return json({ ok: false, err: 'rate' }, cors, 429);
        }
        await env.DB.prepare('INSERT INTO rl (key, ts) VALUES (?, ?)').bind(iph, now).run();
        // --- 重複submit抑制: 同一内容が10分以内なら挿入せず現在順位を返す ---
        const dup = await env.DB.prepare(
          'SELECT id FROM records WHERE name = ? AND game = ? AND n = ? AND mult = ? AND IFNULL(denom, 0) = IFNULL(?, 0) AND created_at > ? LIMIT 1'
        ).bind(name, game, n, mult, denom, now - 600000).first();
        if (!dup) {
          await env.DB.prepare(
            'INSERT INTO records (name, game, n, mult, power, bit, denom, created_at) VALUES (?,?,?,?,?,?,?,?)'
          ).bind(name, game, n, mult, power, bit, denom, now).run();
        }
        const r = await env.DB.prepare('SELECT COUNT(*) AS c FROM records WHERE power > ?').bind(power).first();
        const t = await env.DB.prepare('SELECT COUNT(*) AS c FROM records').first();
        const since = jstDayStart(now);
        const tr = await env.DB.prepare('SELECT COUNT(*) AS c FROM records WHERE power > ? AND created_at >= ?').bind(power, since).first();
        const tt = await env.DB.prepare('SELECT COUNT(*) AS c FROM records WHERE created_at >= ?').bind(since).first();
        return json({ ok: true, rank: Number(r.c) + 1, total: Number(t.c), trank: Number(tr.c) + 1, ttotal: Number(tt.c), dup: !!dup }, cors);
      }
      return json({ ok: false, err: 'not found' }, cors, 404);
    } catch (e) {
      return json({ ok: false, err: String(e && e.message || e) }, cors, 500);
    }
  }
};

async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function json(obj, cors, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors) });
}
