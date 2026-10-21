// Painel da Luísa: API + PWA num processo só. Zero dependências (Node 22.13+).
process.env.TZ ||= 'America/Sao_Paulo';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = +process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUB = path.join(__dirname, 'public');
const ATRASO_MIN = 30;   // dose sem registro vira "atrasada" 30 min depois do horário
const JANELA_MIN = 180;  // "dei o remédio X às HH:MM" casa com o horário previsto mais próximo até 3h
const VIDEO_MAX = 300 * 1024 * 1024;
fs.mkdirSync(path.join(DATA, 'videos'), { recursive: true });

const db = new DatabaseSync(path.join(DATA, 'luisa.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS usuarios (token TEXT PRIMARY KEY, nome TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS medicacoes (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  dose TEXT NOT NULL DEFAULT '',
  horarios TEXT NOT NULL DEFAULT '[]',
  inicio TEXT NOT NULL,
  fim TEXT,
  obs TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS doses (
  id TEXT PRIMARY KEY,
  medicacao_id INTEGER NOT NULL REFERENCES medicacoes(id),
  previsto TEXT,
  dada_em TEXT NOT NULL,
  quem TEXT NOT NULL,
  nota TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL,
  UNIQUE (medicacao_id, previsto)
);
CREATE TABLE IF NOT EXISTS espasmos (
  id TEXT PRIMARY KEY,
  inicio TEXT NOT NULL,
  duracao_seg INTEGER,
  fortes INTEGER NOT NULL DEFAULT 0,
  medios INTEGER NOT NULL DEFAULT 0,
  fracos INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 1,
  acordou TEXT NOT NULL DEFAULT '',
  nota TEXT NOT NULL DEFAULT '',
  video TEXT,
  quem TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);`);

// Primeiro boot: cria um token por pessoa (USUARIOS=Lucas,Mãe,Agente).
if (!db.prepare('SELECT 1 FROM usuarios').get()) {
  const ins = db.prepare('INSERT INTO usuarios (token, nome) VALUES (?, ?)');
  for (const nome of (process.env.USUARIOS || 'Lucas,Mãe,Agente').split(',')) ins.run(crypto.randomBytes(18).toString('base64url'), nome.trim());
}

// ---------- tempo: tudo gravado em hora local sem fuso ("2026-10-21T11:23:00") ----------
const pad = n => String(n).padStart(2, '0');
const local = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const hoje = () => local().slice(0, 10);
const addDias = (dia, n) => { const d = new Date(dia + 'T12:00:00'); d.setDate(d.getDate() + n); return local(d).slice(0, 10); };
const minutos = (a, b) => (new Date(a) - new Date(b)) / 60000;
const erro = (status, msg) => Object.assign(new Error(msg), { status });

function toLocal(s, campo = 'hora') {
  if (s == null || s === '') return null;
  s = String(s).trim();
  if (/^\d\d:\d\d$/.test(s)) return `${hoje()}T${s}:00`;
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(s)) {
    const d = new Date(s);
    if (isNaN(d)) throw erro(400, `${campo} inválida: ${s}`);
    return local(d);
  }
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?$/.test(s)) throw erro(400, `${campo} inválida (use 2026-10-21T13:00 ou 13:00): ${s}`);
  return s.length === 16 ? s + ':00' : s;
}
const dataValida = (s, campo) => {
  if (s == null || s === '') return null;
  if (!/^\d{4}-\d\d-\d\d$/.test(s)) throw erro(400, `${campo} inválida (use AAAA-MM-DD): ${s}`);
  return s;
};

// ---------- medicações e horários previstos ----------
const parseMed = m => m && { ...m, horarios: JSON.parse(m.horarios) };
const getMed = id => parseMed(db.prepare('SELECT * FROM medicacoes WHERE id = ?').get(id));
const medsAtivas = dia => db.prepare("SELECT * FROM medicacoes WHERE inicio <= ? AND (fim IS NULL OR fim = '' OR fim >= ?) ORDER BY nome").all(dia, dia).map(parseMed);
const semAcento = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function slots(dia) {
  return medsAtivas(dia)
    .flatMap(m => m.horarios.map(h => ({ medicacao_id: m.id, nome: m.nome, dose: m.dose, previsto: `${dia}T${h}` })))
    .sort((a, b) => a.previsto.localeCompare(b.previsto));
}

// Horários previstos de um período, cada um com a dose registrada (ou o status de quando falta).
function dosesDoPeriodo(de, ate, agora = local()) {
  const dadas = db.prepare('SELECT * FROM doses WHERE substr(coalesce(previsto, dada_em), 1, 10) BETWEEN ? AND ? ORDER BY dada_em').all(de, ate);
  const porSlot = new Map(dadas.filter(d => d.previsto).map(d => [`${d.medicacao_id}|${d.previsto}`, d]));
  const lista = [];
  for (let dia = de; dia <= ate; dia = addDias(dia, 1)) {
    for (const s of slots(dia)) {
      const d = porSlot.get(`${s.medicacao_id}|${s.previsto}`);
      porSlot.delete(`${s.medicacao_id}|${s.previsto}`);
      const status = d ? (minutos(d.dada_em, s.previsto) > ATRASO_MIN ? 'dada_atrasada' : 'dada')
        : minutos(agora, s.previsto) > ATRASO_MIN ? 'atrasada' : 'pendente';
      lista.push({ ...s, status, dose_registrada: d || null });
    }
  }
  // doses extras (sem horário previsto) e doses de horários que deixaram de existir
  const nomes = Object.fromEntries(db.prepare('SELECT id, nome, dose FROM medicacoes').all().map(m => [m.id, m]));
  for (const d of [...dadas.filter(d => !d.previsto), ...porSlot.values()]) {
    lista.push({ medicacao_id: d.medicacao_id, nome: nomes[d.medicacao_id]?.nome, dose: nomes[d.medicacao_id]?.dose, previsto: d.previsto, status: 'extra', dose_registrada: d });
  }
  return lista.sort((a, b) => (a.previsto || a.dose_registrada.dada_em).localeCompare(b.previsto || b.dose_registrada.dada_em));
}

// Casa com o horário mais próximo MESMO se já foi dado: aí o POST devolve 409 em vez de
// empurrar a dose repetida pro próximo horário livre (isso esconderia uma dose dobrada).
function casarSlot(med, dadaEm) {
  const dia = dadaEm.slice(0, 10);
  const cands = [addDias(dia, -1), dia, addDias(dia, 1)]
    .flatMap(slots)
    .filter(s => s.medicacao_id === med.id && Math.abs(minutos(dadaEm, s.previsto)) <= JANELA_MIN)
    .sort((a, b) => Math.abs(minutos(dadaEm, a.previsto)) - Math.abs(minutos(dadaEm, b.previsto)));
  return cands[0]?.previsto || null;
}

// ---------- webhook (opcional) pro agente ----------
function avisar(tipo, acao, dados) {
  if (!process.env.WEBHOOK_URL) return;
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.WEBHOOK_TOKEN) headers.Authorization = `Bearer ${process.env.WEBHOOK_TOKEN}`;
  fetch(process.env.WEBHOOK_URL, { method: 'POST', headers, body: JSON.stringify({ tipo, acao, dados }), signal: AbortSignal.timeout(5000) })
    .catch(e => console.error('webhook falhou:', e.message));
}

// ---------- rotas ----------
const getEspasmo = id => db.prepare('SELECT * FROM espasmos WHERE id = ?').get(id);
const getDose = id => db.prepare('SELECT * FROM doses WHERE id = ?').get(id);
// resposta com status diferente de 200 (lista vazia/array continua sendo corpo normal)
const R = (status, body) => ({ [R.s]: status, body });
R.s = Symbol('status');
const int = (v, campo) => { const n = Number(v); if (!Number.isInteger(n) || n < 0) throw erro(400, `${campo} deve ser inteiro >= 0`); return n; };

const rotas = {
  'GET /api/eu': (_, u) => ({ nome: u.nome }),

  'GET /api/hoje'(_, u) {
    const agora = local(), dia = agora.slice(0, 10);
    const doses = dosesDoPeriodo(dia, dia, agora);
    const pend = d => d.status === 'pendente' || d.status === 'atrasada';
    // a mais urgente: atrasada há menos de 3h, senão a próxima (olha amanhã se hoje acabou)
    const proxima = doses.find(d => d.status === 'atrasada' && minutos(agora, d.previsto) <= JANELA_MIN)
      || doses.find(d => d.status === 'pendente')
      || dosesDoPeriodo(addDias(dia, 1), addDias(dia, 1), agora).find(pend) || null;
    const salvas = db.prepare('SELECT * FROM espasmos WHERE substr(inicio, 1, 10) = ? ORDER BY inicio').all(dia);
    return {
      agora, dia, usuario: u.nome, doses, proxima, salvas,
      resumo: {
        espasmos: salvas.reduce((s, e) => s + e.total, 0),
        salvas: salvas.length,
        ultima_salva: db.prepare('SELECT max(inicio) AS m FROM espasmos').get().m,
        doses_dadas: doses.filter(d => d.dose_registrada && d.status !== 'extra').length,
        doses_previstas: doses.filter(d => d.status !== 'extra').length,
      },
    };
  },

  'GET /api/medicacoes': () => db.prepare('SELECT * FROM medicacoes ORDER BY inicio DESC, nome').all().map(parseMed),

  'POST /api/medicacoes'(b) {
    const cur = b.id ? getMed(b.id) : null;
    if (b.id && !cur) throw erro(404, 'medicação não encontrada');
    const m = { ...cur, ...b };
    if (!m.nome?.trim()) throw erro(400, 'nome é obrigatório');
    if (!Array.isArray(m.horarios) || !m.horarios.every(h => /^\d\d:\d\d$/.test(h))) throw erro(400, 'horarios deve ser uma lista como ["07:00","19:00"]');
    const v = { nome: m.nome.trim(), dose: m.dose || '', horarios: JSON.stringify([...new Set(m.horarios)].sort()), inicio: dataValida(m.inicio, 'inicio') || hoje(), fim: dataValida(m.fim, 'fim'), obs: m.obs || '' };
    if (v.fim && v.fim < v.inicio) throw erro(400, 'fim antes do início');
    const id = cur
      ? (db.prepare('UPDATE medicacoes SET nome=:nome, dose=:dose, horarios=:horarios, inicio=:inicio, fim=:fim, obs=:obs WHERE id=:id').run({ ...v, id: cur.id }), cur.id)
      : Number(db.prepare('INSERT INTO medicacoes (nome, dose, horarios, inicio, fim, obs) VALUES (:nome, :dose, :horarios, :inicio, :fim, :obs)').run(v).lastInsertRowid);
    return R(cur ? 200 : 201, getMed(id));
  },

  'DELETE /api/medicacoes/:id'(_, __, id) {
    try { db.prepare('DELETE FROM medicacoes WHERE id = ?').run(id); }
    catch { throw erro(409, 'essa medicação já tem doses registradas: em vez de apagar, preencha a data de fim'); }
    return R(204);
  },

  'POST /api/doses'(b, u) {
    if (b.id && getDose(b.id)) return getDose(b.id); // reenvio da fila offline
    const dada_em = toLocal(b.dada_em ?? b.hora, 'dada_em') || local();
    let med = b.medicacao_id && getMed(b.medicacao_id);
    if (!med && b.remedio) {
      const alvo = semAcento(String(b.remedio));
      const ativas = medsAtivas(dada_em.slice(0, 10));
      med = ativas.find(m => semAcento(m.nome) === alvo) || ativas.find(m => semAcento(m.nome).includes(alvo) || alvo.includes(semAcento(m.nome)));
    }
    if (!med) throw erro(400, 'informe medicacao_id ou remedio (nome de uma medicação ativa)');
    const previsto = b.previsto !== undefined ? (b.previsto && toLocal(b.previsto, 'previsto').slice(0, 16)) || null : casarSlot(med, dada_em);
    const ja = previsto && db.prepare('SELECT * FROM doses WHERE medicacao_id = ? AND previsto = ?').get(med.id, previsto);
    if (ja) throw Object.assign(erro(409, `essa dose (${med.nome} ${previsto.slice(11)}) já foi dada por ${ja.quem} às ${ja.dada_em.slice(11, 16)}`), { dados: { dose: ja } });
    const d = { id: b.id || crypto.randomUUID(), medicacao_id: med.id, previsto, dada_em, quem: b.quem || u.nome, nota: b.nota || '', criado_em: local() };
    db.prepare('INSERT INTO doses (id, medicacao_id, previsto, dada_em, quem, nota, criado_em) VALUES (:id, :medicacao_id, :previsto, :dada_em, :quem, :nota, :criado_em)').run(d);
    const out = { ...d, nome: med.nome, dose: med.dose };
    avisar('dose', 'criada', out);
    return R(201, out);
  },

  'DELETE /api/doses/:id'(_, __, id) {
    const d = getDose(id);
    if (d) { db.prepare('DELETE FROM doses WHERE id = ?').run(id); avisar('dose', 'removida', d); }
    return R(204);
  },

  'POST /api/espasmos'(b, u) {
    const cur = b.id && getEspasmo(b.id);
    const v = (k, def) => (b[k] !== undefined ? b[k] : cur ? cur[k] : def);
    const fortes = int(v('fortes', 0), 'fortes'), medios = int(v('medios', 0), 'medios'), fracos = int(v('fracos', 0), 'fracos');
    const e = {
      id: b.id || crypto.randomUUID(),
      inicio: toLocal(b.inicio ?? b.hora, 'inicio') || cur?.inicio || local(),
      duracao_seg: v('duracao_seg', null) == null ? null : int(v('duracao_seg'), 'duracao_seg'),
      fortes, medios, fracos,
      total: fortes + medios + fracos || int(v('total', 1), 'total'),
      acordou: v('acordou', ''), nota: v('nota', ''), video: cur?.video || null,
      quem: cur?.quem || b.quem || u.nome, criado_em: cur?.criado_em || local(), atualizado_em: local(),
    };
    db.prepare(`INSERT INTO espasmos (id, inicio, duracao_seg, fortes, medios, fracos, total, acordou, nota, video, quem, criado_em, atualizado_em)
      VALUES (:id, :inicio, :duracao_seg, :fortes, :medios, :fracos, :total, :acordou, :nota, :video, :quem, :criado_em, :atualizado_em)
      ON CONFLICT(id) DO UPDATE SET inicio=:inicio, duracao_seg=:duracao_seg, fortes=:fortes, medios=:medios, fracos=:fracos, total=:total, acordou=:acordou, nota=:nota, atualizado_em=:atualizado_em`).run(e);
    avisar('espasmo', cur ? 'atualizado' : 'criado', e);
    return R(cur ? 200 : 201, e);
  },

  'DELETE /api/espasmos/:id'(_, __, id) {
    const e = getEspasmo(id);
    if (e) {
      db.prepare('DELETE FROM espasmos WHERE id = ?').run(id);
      if (e.video) fs.rm(path.join(DATA, 'videos', e.video), { force: true }, () => {});
      avisar('espasmo', 'removido', e);
    }
    return R(204);
  },

  'GET /api/resumo'(q) {
    const ate = dataValida(q.get('ate'), 'ate') || hoje();
    const de = dataValida(q.get('de'), 'de') || addDias(ate, -6);
    if (de > ate) throw erro(400, 'de depois de ate');
    const salvas = db.prepare('SELECT * FROM espasmos WHERE substr(inicio, 1, 10) BETWEEN ? AND ? ORDER BY inicio').all(de, ate);
    const doses = dosesDoPeriodo(de, ate);
    const dias = [];
    for (let dia = de; dia <= ate; dia = addDias(dia, 1)) {
      const s = salvas.filter(e => e.inicio.startsWith(dia));
      const d = doses.filter(x => (x.previsto || x.dose_registrada.dada_em).startsWith(dia) && x.status !== 'extra');
      const soma = k => s.reduce((t, e) => t + e[k], 0);
      dias.push({
        dia, salvas: s.length, espasmos: soma('total'), fortes: soma('fortes'), medios: soma('medios'), fracos: soma('fracos'),
        doses_previstas: d.length, doses_dadas: d.filter(x => x.dose_registrada).length,
        doses_atrasadas: d.filter(x => x.status === 'dada_atrasada').length, doses_nao_registradas: d.filter(x => x.status === 'atrasada').length,
      });
    }
    const medicacoes = db.prepare("SELECT * FROM medicacoes WHERE inicio <= ? AND (fim IS NULL OR fim = '' OR fim >= ?) ORDER BY inicio").all(ate, de).map(parseMed);
    return { de, ate, dias, salvas, doses, medicacoes };
  },

  // polling do agente: o que mudou desde um instante
  'GET /api/eventos'(q) {
    const desde = toLocal(q.get('desde'), 'desde') || `${hoje()}T00:00:00`;
    return {
      agora: local(),
      doses: db.prepare('SELECT d.*, m.nome, m.dose FROM doses d JOIN medicacoes m ON m.id = d.medicacao_id WHERE d.criado_em > ? ORDER BY d.criado_em').all(desde),
      espasmos: db.prepare('SELECT * FROM espasmos WHERE atualizado_em > ? ORDER BY atualizado_em').all(desde),
    };
  },
};

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.3gp': 'video/3gpp' };
const EXT_VIDEO = { 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'video/3gpp': '.3gp' };

function enviarJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

// Range é obrigatório pro Safari tocar vídeo.
function enviarArquivo(req, res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return enviarJson(res, 404, { erro: 'não encontrado' });
    const headers = { 'Content-Type': TIPOS[path.extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': cache };
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (m) {
      const ini = m[1] ? +m[1] : st.size - +m[2], fim = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${ini}-${fim}/${st.size}`, 'Content-Length': fim - ini + 1 });
      return fs.createReadStream(file, { start: ini, end: fim }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

async function lerJson(req) {
  let s = '';
  for await (const c of req) { s += c; if (s.length > 1e6) throw erro(413, 'corpo grande demais'); }
  if (!s) return {};
  try { return JSON.parse(s); } catch { throw erro(400, 'JSON inválido'); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (!p.startsWith('/api/')) {
      const file = path.join(PUB, p === '/' ? 'index.html' : path.normalize(p));
      if (!file.startsWith(PUB)) return enviarJson(res, 404, { erro: 'não encontrado' });
      return enviarArquivo(req, res, file, /\.(png|svg)$/.test(file) ? 'max-age=86400' : 'no-cache');
    }

    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('t');
    const u = token && db.prepare('SELECT * FROM usuarios WHERE token = ?').get(token);
    if (!u) return enviarJson(res, 401, { erro: 'token inválido' });

    let m;
    if ((m = p.match(/^\/api\/videos\/([\w-]+\.\w+)$/)) && req.method === 'GET') return enviarArquivo(req, res, path.join(DATA, 'videos', m[1]), 'private, max-age=86400');
    if ((m = p.match(/^\/api\/espasmos\/([\w-]+)\/video$/)) && req.method === 'POST') {
      const e = getEspasmo(m[1]);
      if (!e) throw erro(404, 'salva não encontrada (envie a salva antes do vídeo)');
      const ext = EXT_VIDEO[(req.headers['content-type'] || '').split(';')[0]];
      if (!ext) throw erro(415, 'envie o vídeo com Content-Type video/mp4, video/quicktime, video/webm ou video/3gpp');
      if (+req.headers['content-length'] > VIDEO_MAX) throw erro(413, 'vídeo maior que 300 MB');
      const nome = e.id + ext, tmp = path.join(DATA, 'videos', nome + '.part');
      await new Promise((ok, falha) => req.pipe(fs.createWriteStream(tmp)).on('finish', ok).on('error', falha));
      fs.renameSync(tmp, path.join(DATA, 'videos', nome));
      if (e.video && e.video !== nome) fs.rm(path.join(DATA, 'videos', e.video), { force: true }, () => {});
      db.prepare('UPDATE espasmos SET video = ?, atualizado_em = ? WHERE id = ?').run(nome, local(), e.id);
      avisar('espasmo', 'video', { ...e, video: nome });
      return enviarJson(res, 201, { video: nome });
    }

    const [chave, id] = (m = p.match(/^(\/api\/\w+)\/([\w-]+)$/)) ? [`${req.method} ${m[1]}/:id`, m[2]] : [`${req.method} ${p}`];
    const rota = rotas[chave];
    if (!rota) return enviarJson(res, 404, { erro: 'rota não existe' });
    const entrada = req.method === 'GET' ? url.searchParams : await lerJson(req);
    const out = await rota(entrada, u, id);
    return out?.[R.s] ? enviarJson(res, out[R.s], out.body) : enviarJson(res, 200, out);
  } catch (e) {
    if (!e.status) console.error(e);
    enviarJson(res, e.status || 500, { erro: e.status ? e.message : 'erro interno', ...e.dados });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    const base = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
    console.log(`Painel da Luísa rodando em ${base}\nLinks de acesso (cada pessoa abre o seu uma vez no celular):`);
    for (const x of db.prepare('SELECT * FROM usuarios').all()) console.log(`  ${x.nome.padEnd(8)} ${base}/?t=${x.token}`);
  });
}
module.exports = { server, db };
