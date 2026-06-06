// bakuun-rank — バク運スカウター 全人類ランキング Worker (D1)
// Endpoints: GET /top?limit=50 / POST /submit {name, game, n, mult}
// 戦闘力はサーバ側で再計算（クライアント値は信用しない）。bit=純粋値。
const GAMES = { coin: 2, card: 3, dice: 6 };

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
        const { results } = await env.DB.prepare(
          'SELECT name, game, n, mult, power, bit, created_at FROM records ORDER BY power DESC, created_at ASC LIMIT ?'
        ).bind(limit).all();
        return json({ ok: true, top: results }, cors);
      }
      if (req.method === 'POST' && url.pathname === '/submit') {
        const b = await req.json();
        const name = String(b.name || '名無しの挑戦者').replace(/[\r\n\t]/g, ' ').trim().slice(0, 20) || '名無しの挑戦者';
        const game = String(b.game);
        const n = Math.floor(Number(b.n));
        const mult = Math.round(Number(b.mult) * 100) / 100;
        if (!GAMES[game]) return json({ ok: false, err: 'bad game' }, cors, 400);
        if (!Number.isFinite(n) || n < 1 || n > 250) return json({ ok: false, err: 'bad n' }, cors, 400);
        if (!Number.isFinite(mult) || mult < 1 || mult > 2) return json({ ok: false, err: 'bad mult' }, cors, 400);
        const base = GAMES[game];
        const power = Math.pow(base, n) * mult; // server recompute
        const bit = n * Math.log2(base);
        await env.DB.prepare(
          'INSERT INTO records (name, game, n, mult, power, bit, created_at) VALUES (?,?,?,?,?,?,?)'
        ).bind(name, game, n, mult, power, bit, Date.now()).run();
        const r = await env.DB.prepare('SELECT COUNT(*) AS c FROM records WHERE power > ?').bind(power).first();
        const t = await env.DB.prepare('SELECT COUNT(*) AS c FROM records').first();
        return json({ ok: true, rank: Number(r.c) + 1, total: Number(t.c) }, cors);
      }
      return json({ ok: false, err: 'not found' }, cors, 404);
    } catch (e) {
      return json({ ok: false, err: String(e && e.message || e) }, cors, 500);
    }
  }
};

function json(obj, cors, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors) });
}
