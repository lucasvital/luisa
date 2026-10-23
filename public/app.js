// Painel da Luísa: PWA sem framework. Cache e fila offline no localStorage.
const $ = s => document.querySelector(s);
const ls = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = n => `<svg class="i"><use href="#i-${n}"/></svg>`;
const uuid = () => crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);

// o token chega pelo link pessoal (?t=...) e fica guardado no aparelho
const qs = new URLSearchParams(location.search);
if (qs.get('t')) { ls.set('token', qs.get('t')); history.replaceState(null, '', location.pathname + location.hash); }
let token = ls.get('token', '');

const S = {
  hoje: ls.get('cache:hoje', null),
  meds: ls.get('cache:meds', []),
  fila: ls.get('fila', []),
  salva: ls.get('salva', null),
  resumo: ls.get('cache:resumo', null),
  eu: ls.get('cache:eu', null),
  hist: ls.get('pref:hist', 7),
  soFalhas: false,
  aba: 'esp',
  ativo: null,
  online: navigator.onLine,
};
const ACORDOU = ['agora', '~10 min', '~30 min', '~1 h', '+1 h', 'dormindo'];

// ---------- tempo ----------
const pad = n => String(n).padStart(2, '0');
const local = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const hojeD = () => local().slice(0, 10);
const addDias = (dia, n) => { const d = new Date(dia + 'T12:00'); d.setDate(d.getDate() + n); return local(d).slice(0, 10); };
const hm = s => (s ? s.slice(11, 16) : '');
const dm = dia => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const dmy = dia => `${dm(dia)}/${dia.slice(0, 4)}`;
const minDe = (a, b = new Date()) => Math.round((new Date(b) - new Date(a)) / 60000);
const DSEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const dsem = dia => DSEM[new Date(dia + 'T12:00').getDay()];
const dataLonga = dia => new Date(dia + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
const dur = seg => (seg == null ? '' : `${Math.floor(seg / 60)}:${pad(seg % 60)}`);
function quandoFalta(previsto) {
  const m = -minDe(previsto);
  if (m <= 0) return 'agora';
  return m < 60 ? `em ${m} min` : `em ${Math.floor(m / 60)}h${m % 60 ? pad(m % 60) : ''}`;
}
function desde(inicio) {
  if (!inicio) return { n: '–', u: '' };
  const m = Math.max(0, minDe(inicio));
  if (m < 60) return { n: m, u: 'min' };
  if (m < 48 * 60) return { n: `${Math.floor(m / 60)}h`, u: pad(m % 60) };
  return { n: Math.floor(m / 1440), u: 'dias' };
}

// ---------- rede + fila offline ----------
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body && { 'Content-Type': 'application/json' }) }, body: body && JSON.stringify(body) });
  if (r.status === 401) { sair(); throw Object.assign(new Error('acesso inválido'), { status: 401 }); }
  const data = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(data?.erro || `erro ${r.status}`), { status: r.status, data });
  return data;
}

async function carregar() {
  if (!token) return render();
  try {
    const [h, m, eu] = await Promise.all([api('GET', '/api/hoje'), api('GET', '/api/medicacoes'), api('GET', '/api/eu')]);
    if (S.fila.length) return; // chegou ação nova no meio: a próxima sincronização recarrega
    Object.assign(S, { hoje: h, meds: m, eu, online: true });
    ls.set('cache:hoje', h); ls.set('cache:meds', m); ls.set('cache:eu', eu);
    S.resumoKey = null;
  } catch (e) {
    if (!e.status) S.online = false;
    else if (e.status !== 401) toast(e.message, { erro: true, sub: 'Erro no servidor' });
  }
  render();
}

function enviar(method, url, body) {
  S.fila.push({ method, url, body });
  ls.set('fila', S.fila);
  render();
  return sincronizar();
}

let sincronizando = null;
function sincronizar() {
  return (sincronizando ||= (async () => {
    try {
      while (S.fila.length) {
        const it = S.fila[0];
        try { await api(it.method, it.url, it.body); }
        catch (e) {
          if (!e.status) { S.online = false; return; } // sem rede: fica na fila
          if (e.status === 401) return;
          toast(e.message, { erro: true, sub: e.status === 409 ? 'Ninguém deu duas vezes' : 'Não foi salvo' });
        }
        S.fila.shift();
        ls.set('fila', S.fila);
      }
      S.online = true;
      await carregar();
    } finally { sincronizando = null; render(); }
  })());
}

// ---------- toast ----------
let toastT, toastFn;
function toast(txt, { sub = '', erro = false, acao, icone } = {}) {
  toastFn = acao?.fn;
  $('#toast').innerHTML = `<div class="tt ${erro ? 'err' : ''}">${ic(icone || (erro ? 'alert' : 'mega'))}<span class="tx">${sub ? `<small>${esc(sub)}</small>` : ''}<b>${esc(txt)}</b></span>
    ${acao ? `<button data-act="toast">${esc(acao.label)}</button>` : ''}</div>`;
  clearTimeout(toastT);
  toastT = setTimeout(() => ($('#toast').innerHTML = ''), acao ? 7000 : 4000);
}

// ---------- doses ----------
const chave = d => `${d.medicacao_id}|${d.previsto}`;
const slotDe = k => [...(S.hoje?.doses || []), S.hoje?.proxima].find(d => d && chave(d) === k);
const doseDe = id => (S.hoje?.doses || []).find(d => d.dose_registrada?.id === id);

function recalcularHoje() {
  const h = S.hoje;
  const p = h.doses.filter(d => d.status !== 'extra');
  h.resumo.doses_dadas = p.filter(d => d.dose_registrada).length;
  const amanha = h.proxima && !h.proxima.previsto.startsWith(h.dia) && !h.proxima.dose_registrada ? h.proxima : null;
  h.proxima = p.find(d => d.status === 'atrasada' && minDe(d.previsto) <= 180) || p.find(d => d.status === 'pendente') || amanha;
  h.resumo.espasmos = h.salvas.reduce((t, s) => t + s.total, 0);
  h.resumo.salvas = h.salvas.length;
  h.resumo.ultima_salva = h.salvas.map(s => s.inicio).sort().pop() || h.resumo.ultima_salva;
  ls.set('cache:hoje', h);
}

function darDose(k, dadaEm = local()) {
  const s = slotDe(k);
  if (!s) return;
  const reg = { id: uuid(), dada_em: dadaEm, quem: S.hoje.usuario, previsto: s.previsto };
  s.dose_registrada = reg;
  s.status = minDe(s.previsto, dadaEm) > 30 ? 'dada_atrasada' : 'dada';
  recalcularHoje();
  S.ativo = null; // o carrossel anda pra próxima dose
  fecharSheet();
  enviar('POST', '/api/doses', { id: reg.id, medicacao_id: s.medicacao_id, previsto: s.previsto, dada_em: dadaEm });
  toast(`${s.nome} das ${hm(s.previsto)} marcada como dada`, { sub: `Medicação · ${reg.quem}`, acao: { label: 'Desfazer', fn: () => apagarDose(reg.id) } });
}

function apagarDose(id) {
  const s = doseDe(id);
  if (s) {
    s.dose_registrada = null;
    s.status = minDe(s.previsto) > 30 ? 'atrasada' : 'pendente';
    if (!s.previsto) S.hoje.doses = S.hoje.doses.filter(d => d !== s);
    recalcularHoje();
  }
  fecharSheet();
  enviar('DELETE', `/api/doses/${id}`);
  toast('Registro da dose apagado', { sub: 'Medicação', icone: 'undo' });
}

// ---------- salvas ----------
function salvarSalvaLocal(e) {
  e.total = e.fortes + e.medios + e.fracos || e.total || 1;
  const h = S.hoje;
  if (h) {
    h.salvas = h.salvas.filter(s => s.id !== e.id);
    if (e.inicio.startsWith(h.dia)) h.salvas.push(e);
    h.salvas.sort((a, b) => a.inicio.localeCompare(b.inicio));
    recalcularHoje();
  }
}

async function enviarVideo(id, file) {
  if (S.fila.length) await sincronizar();
  if (S.fila.length) return toast('O vídeo precisa de internet', { erro: true, sub: 'Abra a salva depois e anexe de novo' });
  toast('Enviando vídeo…', { icone: 'cam', sub: 'Pode continuar usando o app' });
  try {
    const r = await fetch(`/api/espasmos/${id}/video`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': file.type || 'video/mp4' }, body: file });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || `erro ${r.status}`);
    toast('Vídeo anexado à salva', { icone: 'cam' });
    carregar();
  } catch (e) { toast(`Vídeo não enviado: ${e.message}`, { erro: true }); }
}

let salvaVideo = null, wake = null;
async function manterTela(ligar) {
  try { if (ligar) wake = await navigator.wakeLock?.request('screen'); else { await wake?.release(); wake = null; } } catch {}
}
const contar = taps => ({ f: taps.filter(t => t === 'f').length, m: taps.filter(t => t === 'm').length, w: taps.filter(t => t === 'w').length });

function iniciarSalva() {
  if (!token) return;
  if (!S.salva) {
    S.salva = { id: uuid(), inicio: local(), t0: Date.now(), taps: [], tt: [], acordou: '' };
    ls.set('salva', S.salva);
    navigator.vibrate?.(30);
  }
  manterTela(true);
  renderSalva();
}

function renderSalva() {
  const s = S.salva;
  if (!s) { $('#salva').innerHTML = ''; return; }
  const c = contar(s.taps);
  $('#salva').innerHTML = `<div class="sv">
    <div class="bar"><button class="sq" data-act="sv-fechar" aria-label="Fechar">${ic('x')}</button>
      <span class="ttl"><span class="live">gravando</span><b>Salva em andamento</b><small>começou ${hm(s.inicio)} · ${esc(S.hoje?.usuario || '')}</small></span>
      <label class="sq ${salvaVideo ? 'y' : ''}" aria-label="Anexar vídeo">${ic('cam')}<input type="file" accept="video/*" capture="environment" data-file="sv-video" hidden></label></div>
    <div class="ring"><svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="90" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="14"/>
      <circle id="sv-arc" cx="100" cy="100" r="90" fill="none" stroke="#F9DF77" stroke-width="14" stroke-linecap="round" stroke-dasharray="565.5" stroke-dashoffset="565.5"/></svg>
      <div class="c"><div class="tm" id="sv-tm">0:00</div><div class="ct"><b>${s.taps.length}</b> ${s.taps.length === 1 ? 'espasmo' : 'espasmos'}</div></div></div>
    <div class="taps">
      <button class="tap f" data-act="tap" data-k="f"><span class="k">Forte<small>toque a cada espasmo</small></span><span class="n">${c.f}</span></button>
      <button class="tap m" data-act="tap" data-k="m"><span class="k">Médio</span><span class="n">${c.m}</span></button>
      <button class="tap w" data-act="tap" data-k="w"><span class="k">Fraco</span><span class="n">${c.w}</span></button>
    </div>
    <div class="lb">Acordou há</div>
    <div class="chips">${ACORDOU.map(a => `<button class="chip ${a === s.acordou ? 'on' : ''}" data-act="sv-acordou" data-v="${a}">${a}</button>`).join('')}</div>
    <div class="sv-f">
      <button class="sq" data-act="sv-undo" aria-label="Desfazer último toque" ${s.taps.length ? '' : 'disabled style="opacity:.4"'}>${ic('undo')}</button>
      <button class="fim" data-act="sv-fim">${ic('check')} Terminou</button>
    </div>
    <button class="sv-manual" data-act="sv-manual">Já passou? Registrar sem cronômetro</button>
  </div>`;
  tickSalva();
}

function tickSalva() {
  if (!S.salva || !$('#sv-tm')) return;
  const seg = Math.floor((Date.now() - S.salva.t0) / 1000);
  $('#sv-tm').textContent = dur(seg);
  $('#sv-arc').setAttribute('stroke-dashoffset', 565.5 * (1 - Math.min(seg / 180, 1)));
}

function fecharSalva() {
  S.salva = null; ls.set('salva', null); salvaVideo = null;
  manterTela(false);
  renderSalva();
}

function terminarSalva() {
  const s = S.salva, c = contar(s.taps);
  const e = { id: s.id, inicio: s.inicio, duracao_seg: Math.round((Date.now() - s.t0) / 1000), fortes: c.f, medios: c.m, fracos: c.w, toques: s.tt, acordou: s.acordou, nota: '', quem: S.hoje?.usuario, video: null };
  const video = salvaVideo;
  fecharSalva();
  salvarSalvaLocal(e);
  enviar('POST', '/api/espasmos', e).then(() => video && enviarVideo(e.id, video));
  toast(`${e.total} ${e.total === 1 ? 'espasmo' : 'espasmos'} · ${dur(e.duracao_seg)}`, { sub: 'Salva registrada', icone: 'wave', acao: { label: 'Detalhes', fn: () => abrirSalva(e.id) } });
}

// ---------- folhas (bottom sheets) ----------
let F = null; // formulário aberto
function abrirSheet(html) { $('#sheet').innerHTML = `<div class="sh-bg" data-act="fundo"><div class="sh">${html}</div></div>`; }
function fecharSheet() { $('#sheet').innerHTML = ''; F = null; }

function abrirSalva(id) {
  const s = (S.hoje?.salvas || []).find(x => x.id === id) || (S.resumo?.salvas || []).find(x => x.id === id);
  F = s ? { ...s, novo: false } : { id: uuid(), inicio: local(), duracao_seg: null, fortes: 0, medios: 0, fracos: 0, total: 1, acordou: '', nota: '', video: null, quem: S.hoje?.usuario, novo: true };
  F.arquivo = null;
  const st = (k, nome, cor) => `<div class="step" style="--c:${cor}"><span class="k">${nome}</span><span class="ctl"><button data-act="st" data-k="${k}" data-v="-1" aria-label="menos">−</button><b id="st-${k}">${F[k]}</b><button data-act="st" data-k="${k}" data-v="1" aria-label="mais">+</button></span></div>`;
  abrirSheet(`<h2>${F.novo ? 'Registrar salva' : 'Salva'}</h2>
    <p class="sub">${F.novo ? 'Para uma salva que já passou.' : `Registrada por ${esc(F.quem)}.`} Tudo aqui é opcional, menos a hora.</p>
    <div class="f"><label>Começou</label><input class="in" type="datetime-local" id="s-inicio" value="${F.inicio.slice(0, 16)}"></div>
    <div class="f"><span class="l">Duração</span><div class="row">
      <input class="in" type="number" inputmode="numeric" min="0" id="s-min" placeholder="min" value="${F.duracao_seg != null ? Math.floor(F.duracao_seg / 60) : ''}">
      <input class="in" type="number" inputmode="numeric" min="0" max="59" id="s-seg" placeholder="seg" value="${F.duracao_seg != null ? F.duracao_seg % 60 : ''}"></div></div>
    <div class="f"><span class="l">Espasmos por intensidade</span>${st('fortes', 'Fortes', 'var(--forte)')}${st('medios', 'Médios', 'var(--medio)')}${st('fracos', 'Fracos', 'var(--fraco)')}</div>
    <div class="f" id="s-total-f" ${F.fortes + F.medios + F.fracos ? 'hidden' : ''}><label>Ou só o total (aproximado)</label><input class="in" type="number" inputmode="numeric" min="1" id="s-total" value="${F.total || 1}"></div>
    <div class="f"><span class="l">Acordou há</span><div class="chips" id="s-acordou">${ACORDOU.map(a => `<button class="chip ${a === F.acordou ? 'on' : ''}" data-act="s-acordou" data-v="${a}">${a}</button>`).join('')}</div></div>
    <div class="f"><label>Anotação</label><textarea class="in" id="s-nota" placeholder="Ex.: chorou depois, olhar parado, um lado só…">${esc(F.nota)}</textarea></div>
    <div class="f"><span class="l">Vídeo</span>
      ${F.video ? `<video class="vd" controls playsinline preload="metadata" src="/api/videos/${esc(F.video)}?t=${encodeURIComponent(token)}"></video>` : ''}
      <label class="file">${ic('cam')}<span id="s-arq">${F.video ? 'Trocar vídeo' : 'Gravar ou escolher vídeo'}</span><input type="file" accept="video/*" data-file="s-video"></label></div>
    <button class="btn" data-act="s-salvar">${ic('check')} Salvar</button>
    ${F.novo ? '' : `<button class="btn txt" data-act="s-apagar">Apagar salva</button>`}`);
}

function salvarSalvaForm() {
  const min = $('#s-min').value, seg = $('#s-seg').value;
  const e = {
    id: F.id, inicio: ($('#s-inicio').value || local().slice(0, 16)) + ':00',
    duracao_seg: min === '' && seg === '' ? null : (+min || 0) * 60 + (+seg || 0),
    fortes: F.fortes, medios: F.medios, fracos: F.fracos, total: Math.max(1, +$('#s-total').value || 1),
    acordou: F.acordou, nota: $('#s-nota').value.trim(), quem: F.quem, video: F.video,
  };
  const arq = F.arquivo;
  fecharSheet();
  salvarSalvaLocal(e);
  enviar('POST', '/api/espasmos', e).then(() => arq && enviarVideo(e.id, arq));
  toast('Salva atualizada', { sub: `${e.total} ${e.total === 1 ? 'espasmo' : 'espasmos'} às ${hm(e.inicio)}`, icone: 'wave' });
}

function abrirDoseInfo(id) {
  const s = doseDe(id), r = s?.dose_registrada;
  if (!r) return;
  const atraso = s.previsto ? minDe(s.previsto, r.dada_em) : 0;
  abrirSheet(`<h2>${esc(s.nome)} ${s.dose ? `<span style="color:var(--muted)">· ${esc(s.dose)}</span>` : ''}</h2>
    <p class="sub">Dada às <b>${hm(r.dada_em)}</b> por <b>${esc(r.quem)}</b>${s.previsto ? ` · prevista ${hm(s.previsto)}${atraso > 30 ? ` (${atraso} min depois)` : ''}` : ' · dose extra'}.${r.nota ? `<br>${esc(r.nota)}` : ''}</p>
    <button class="btn ghost" data-act="fechar">Fechar</button>
    <button class="btn txt" data-act="dose-apagar" data-id="${esc(r.id)}">Apagar este registro</button>`);
}

function abrirDei(k) {
  const s = slotDe(k);
  if (!s) return;
  const late = s.status === 'atrasada';
  abrirSheet(`<h2>${esc(s.nome)} · ${hm(s.previsto)}</h2>
    <p class="sub">${late ? 'Essa dose ficou sem registro. Quando ela foi dada?' : `Essa dose é só ${quandoFalta(s.previsto)}. Deu antes?`}</p>
    <button class="btn" data-act="dei-hora" data-k="${k}" data-v="agora">${ic('check')} Dei agora · ${hm(local())}</button>
    ${late ? `<button class="btn ghost" data-act="dei-hora" data-k="${k}" data-v="previsto">Dei no horário · ${hm(s.previsto)}</button>` : ''}
    <div class="f" style="margin-top:16px"><label>Outro horário</label><div class="row">
      <input class="in" type="time" id="dei-t" value="${hm(local())}"><button class="btn navy" style="flex:0 0 116px" data-act="dei-hora" data-k="${k}" data-v="outro">Salvar</button></div></div>`);
}

// remédios
function abrirMed(id, novaFase) {
  const m = S.meds.find(x => x.id === id);
  F = m ? { ...m, horarios: [...m.horarios] } : { nome: '', dose: '', horarios: [], inicio: hojeD(), fim: '', obs: '' };
  if (novaFase) Object.assign(F, { base: m.id, id: undefined, inicio: addDias(hojeD(), 1), fim: '' });
  const tit = novaFase ? `Nova fase de ${esc(m.nome)}` : m ? esc(m.nome) : 'Novo remédio';
  abrirSheet(`<h2>${tit}</h2>
    <p class="sub">${novaFase ? `A fase atual termina no dia anterior ao início desta. Use para desmame ou mudança de dose pedida pelo médico.` : 'Quem muda dose é o médico. O app só registra o que foi prescrito.'}</p>
    <div class="f"><label>Nome</label><input class="in" id="m-nome" value="${esc(F.nome)}" placeholder="Ex.: Levetiracetam" ${novaFase ? 'readonly' : ''}></div>
    <div class="f"><label>Dose</label><input class="in" id="m-dose" value="${esc(F.dose)}" placeholder="Ex.: 1 ml"></div>
    <div class="f"><span class="l">Horários</span><div class="hs" id="m-hs"></div>
      <div class="row"><input class="in" type="time" id="m-h"><button class="btn navy" style="flex:0 0 116px" data-act="h-add">${ic('plus')} Horário</button></div></div>
    <div class="row"><div class="f"><label>Início</label><input class="in" type="date" id="m-ini" value="${F.inicio}"></div>
      <div class="f"><label>Fim (opcional)</label><input class="in" type="date" id="m-fim" value="${F.fim || ''}"></div></div>
    <div class="f"><label>Observação</label><textarea class="in" id="m-obs" placeholder="Ex.: dar antes de mamar">${esc(F.obs)}</textarea></div>
    <button class="btn" data-act="m-salvar">${ic('check')} Salvar</button>
    ${m && !novaFase ? `<button class="btn ghost" data-act="m-fase" data-id="${m.id}">Mudar dose a partir de…</button><button class="btn txt" data-act="m-apagar" data-id="${m.id}">Apagar remédio</button>` : ''}`);
  renderHorarios();
}
function renderHorarios() {
  $('#m-hs').innerHTML = F.horarios.length
    ? F.horarios.sort().map(h => `<button class="chip" data-act="h-rm" data-v="${h}">${h} ${ic('x')}</button>`).join('')
    : '<span style="color:var(--muted);font-size:13px">Nenhum horário ainda</span>';
}
async function salvarMed() {
  const body = { id: F.id, nome: $('#m-nome').value, dose: $('#m-dose').value.trim(), horarios: F.horarios, inicio: $('#m-ini').value, fim: $('#m-fim').value || null, obs: $('#m-obs').value.trim() };
  if ($('#m-h').value && !F.horarios.includes($('#m-h').value)) body.horarios = [...F.horarios, $('#m-h').value];
  try {
    if (F.base) await api('POST', '/api/medicacoes', { id: F.base, fim: addDias(body.inicio, -1) });
    await api('POST', '/api/medicacoes', body);
    fecharSheet();
    toast(`${body.nome} salvo`, { icone: 'pill' });
    carregar();
  } catch (e) { toast(e.status ? e.message : 'Sem internet: tente de novo quando conectar', { erro: true }); }
}

// ---------- telas (componentes do Elli App) ----------
const rota = () => (location.hash.replace(/^#\/?/, '').split('?')[0] || 'hoje');
const whoCls = n => (n === S.hoje?.usuario ? '' : /agente/i.test(n) ? 'c2' : 'c1');
const fi = id => `<svg class="ico"><use href="#${id}"/></svg>`;
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const LETRA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

// topo: [inicial]  TÍTULO  [status]
function barra(titulo, direita) {
  const eu = S.hoje?.usuario || '';
  const n = S.fila.length;
  const dir = direita ?? `<span class="sq lbl ${!S.online || n ? 'off' : ''}" title="sincronização"><span class="dot"></span>${!S.online ? 'offline' : n ? `${n}` : ''}</span>`;
  return `<div class="bar"><button class="sq" data-act="eu" aria-label="Você">${esc(eu[0] || '·')}</button><span class="ttl">${titulo}</span>${dir}</div>`;
}
const hero = (titulo, pilula) => `<div class="hero"><h1>${titulo}</h1>${pilula ? `<div class="pill-data"><span class="ci">${ic('cal')}</span>${pilula}</div>` : ''}</div>`;

function nav(r) {
  const a = (h, icone, nome) => {
    const on = r === (h || 'hoje');
    return `<a href="#/${h}" class="${on ? 'on' : ''}"><span class="b">${on ? `<span>${fi(icone)}</span>` : fi(icone)}</span>${nome}</a>`;
  };
  return `<nav class="nav noprint">${a('', 'f-home', 'Hoje')}${a('historico', 'f-chart', 'Histórico')}
    <button class="esp" data-act="espasmo"><span class="b">${ic('wave')}</span>Espasmo</button>${a('remedios', 'f-pill', 'Remédios')}${a('relatorio', 'f-doc', 'Relatório')}</nav>`;
}

// ----- Hoje (Today's Activities) -----
function cardDose(d) {
  const reg = d.dose_registrada, late = d.status === 'atrasada';
  const lab = d.amanha ? 'amanhã' : reg ? 'dada' : late ? 'atrasada' : quandoFalta(d.previsto);
  return `<button class="tc ${reg ? 'dada' : ''} ${late ? 'late' : ''}" data-act="card" data-k="${chave(d)}">
    <div class="hr"><b>${hm(d.previsto)}</b><small>${lab}</small></div>
    ${reg ? `<span class="badge">${ic('check')}</span>` : late ? `<span class="badge">${ic('alert')}</span>` : ''}
    <div class="circ"><svg><use href="#t-pills"/></svg></div>
    <div class="nm">${esc(d.nome)}</div><div class="ds">${reg ? `${esc(reg.quem)} deu às ${hm(reg.dada_em)}` : esc(d.dose)}</div></button>`;
}

function cta(s) {
  if (!s) return `<a id="cta" class="cta" href="#/remedios">${ic('plus')}<span class="tx">CADASTRAR REMÉDIOS<small>os horários aparecem aqui</small></span></a>`;
  const r = s.dose_registrada;
  if (r) return `<button id="cta" class="cta feito" data-act="dose-info" data-id="${esc(r.id)}">${ic('check')}<span class="tx">Dada por ${esc(r.quem)} às ${hm(r.dada_em)}<small>toque para ver ou desfazer</small></span></button>`;
  const late = s.status === 'atrasada';
  return `<button id="cta" class="cta ${late ? 'late' : ''}" data-act="dei" data-k="${chave(s)}">${ic(late ? 'alert' : 'check')}<span class="tx">DEI A DOSE<small>${esc(s.nome)} · ${hm(s.previsto)}${late ? ' · atrasada' : ''}</small></span></button>`;
}

function ativarCard(centralizar) {
  const car = $('#carrossel');
  if (!car) return;
  const cards = [...car.querySelectorAll('.tc')];
  if (!cards.length) return;
  const alvo = centralizar && cards.find(c => c.dataset.k === centralizar);
  if (alvo) car.scrollLeft = alvo.offsetLeft + alvo.offsetWidth / 2 - car.clientWidth / 2;
  const meio = car.scrollLeft + car.clientWidth / 2, dist = c => Math.abs(c.offsetLeft + c.offsetWidth / 2 - meio);
  const best = cards.reduce((a, c) => (dist(c) < dist(a) ? c : a));
  cards.forEach(c => c.classList.toggle('ativo', c === best));
  if (S.ativo === best.dataset.k) return;
  S.ativo = best.dataset.k;
  $('#dots').innerHTML = cards.map(c => `<i class="${c === best ? 'on' : ''}"></i>`).join('');
  $('#cta').outerHTML = cta(slotDe(S.ativo));
}

function detalheSalva(s) {
  const p = [[s.fortes, 'forte', 'fortes'], [s.medios, 'médio', 'médios'], [s.fracos, 'fraco', 'fracos']].filter(x => x[0]).map(([n, a, b]) => `${n} ${n === 1 ? a : b}`);
  return [p.join(', '), s.acordou && (s.acordou === 'dormindo' ? 'dormindo' : `acordou há ${s.acordou}`), s.nota].filter(Boolean).join(' · ');
}

function ntSalva(s, comDia) {
  return `<button class="nt" data-act="salva" data-id="${esc(s.id)}"><span class="ic y"><svg class="ico"><use href="#t-wave"/></svg></span>
    <span class="tx"><small>Salva ${comDia ? `${dsem(s.inicio.slice(0, 10))} ${dm(s.inicio.slice(0, 10))} ` : ''}às ${hm(s.inicio)}</small>
    <b>${plural(s.total, 'espasmo', 'espasmos')}${s.duracao_seg != null ? ` · ${dur(s.duracao_seg)}` : ''}${s.video ? `<svg class="i vid"><use href="#i-cam"/></svg>` : ''}</b>
    <em>${esc(detalheSalva(s)) || 'toque para completar'}</em></span><span class="who ${whoCls(s.quem)}">${esc(s.quem)}</span></button>`;
}

function ntDose(d) {
  const r = d.dose_registrada, atraso = d.previsto ? minDe(d.previsto, r.dada_em) : 0;
  return `<button class="nt" data-act="dose-info" data-id="${esc(r.id)}"><span class="ic"><svg class="ico"><use href="#t-pills"/></svg></span>
    <span class="tx"><small>Medicação às ${hm(r.dada_em)}</small><b>${esc(d.nome)}${d.dose ? ` · ${esc(d.dose)}` : ''}</b>
    <em>${d.previsto ? `prevista ${hm(d.previsto)}${atraso > 30 ? ` · ${atraso} min depois` : ''}` : 'dose extra'}</em></span><span class="who ${whoCls(r.quem)}">${esc(r.quem)}</span></button>`;
}

function telaHoje() {
  const h = S.hoje;
  if (!h) return barra('Luísa') + '<p class="vazio">Carregando…</p>';
  const r = h.resumo, u = desde(r.ultima_salva);
  const doses = h.doses.filter(d => d.status !== 'extra');
  const cards = [...doses];
  if (h.proxima && !h.proxima.previsto.startsWith(h.dia)) cards.push({ ...h.proxima, amanha: true });
  const evs = [...h.doses.filter(d => d.dose_registrada).map(d => [d.dose_registrada.dada_em, ntDose(d)]), ...h.salvas.map(s => [s.inicio, ntSalva(s)])]
    .sort((a, b) => b[0].localeCompare(a[0])).map(x => x[1]);
  const vazio = `<a class="tc ativo" href="#/remedios"><div class="hr"><b>--:--</b><small></small></div><div class="circ">${ic('plus')}</div><div class="nm">Cadastre os remédios</div><div class="ds">e os horários aparecem aqui</div></a>`;
  return barra('Luísa') + hero('Doses de hoje', dataLonga(h.dia)) + `
    <div class="carrossel" id="carrossel">${cards.map(cardDose).join('') || vazio}</div>
    <div class="dots" id="dots"></div>
    ${cta(null)}
    <div class="kpis">
      <div class="kpi"><b>${r.espasmos}</b><span>espasmos hoje<br>em ${plural(r.salvas, 'salva', 'salvas')}</span></div>
      <div class="kpi"><b>${u.n}<small>${u.u}</small></b><span>desde a<br>última salva</span></div>
      <div class="kpi"><b>${r.doses_dadas}<small>/${r.doses_previstas}</small></b><span>doses<br>dadas hoje</span></div></div>
    <div class="sec"><h2>Linha do dia</h2><button data-act="salva-nova">+ salva que já passou</button></div>
    ${evs.length ? `<div class="lista">${evs.join('')}</div>` : '<div class="vazio-card">Nada registrado hoje ainda.<br>Doses e salvas aparecem aqui, de quem quer que registre.</div>'}`;
}

// ----- Histórico (Wellness Tracker: Dashboard / Activity Log) -----
function periodo() {
  if (rota() === 'imprimir') {
    const p = new URLSearchParams(location.hash.split('?')[1]);
    return { de: p.get('de'), ate: p.get('ate') };
  }
  return { de: addDias(hojeD(), -(S.hist - 1)), ate: hojeD() };
}
let carregandoResumo = null;
function garantirResumo() {
  const { de, ate } = periodo(), k = `${de}|${ate}`;
  if (S.resumoKey === k || carregandoResumo === k) return;
  carregandoResumo = k;
  api('GET', `/api/resumo?de=${de}&ate=${ate}`)
    .then(r => { S.resumo = r; S.resumoKey = k; ls.set('cache:resumo', r); })
    .catch(e => toast(e.status ? e.message : 'Mostrando o último histórico salvo', { erro: !!e.status, sub: e.status ? 'Erro' : 'Sem internet', icone: 'clock' }))
    .finally(() => { carregandoResumo = null; render(); });
}

// rosca com vãos brancos entre as fatias (Medication Adherence)
function donut(partes, centro, unidade) {
  const R = 73, C = 2 * Math.PI * R, tot = partes.reduce((t, p) => t + p.v, 0);
  const vivas = partes.filter(p => p.v > 0), gap = vivas.length > 1 ? 5 : 0;
  let acc = 0;
  const arcos = !tot ? `<circle cx="105" cy="105" r="${R}" fill="none" stroke="#ECECF8" stroke-width="44"/>`
    : vivas.map(p => {
      const len = (p.v / tot) * C, s = `<circle cx="105" cy="105" r="${R}" fill="none" stroke="${p.c}" stroke-width="44" stroke-dasharray="${Math.max(len - gap, 0.5)} ${C}" stroke-dashoffset="${-acc}"/>`;
      acc += len;
      return s;
    }).join('');
  return `<svg class="donut" viewBox="0 0 210 210"><g transform="rotate(-90 105 105)">${arcos}</g>
    <text x="105" y="113" text-anchor="middle" class="n">${centro}</text><text x="105" y="133" text-anchor="middle" class="u">${unidade}</text></svg>`;
}

// linha pontilhada com bolinhas, igual ao "Mood Tracker" do Elli: grade vertical clara, tracejado no meio,
// pontos índigo com halo, letras dos dias embaixo. Início de remédio = dia com pílula amarela + guia tracejada.
function linhaDias(r) {
  const n = r.dias.length, W = 320, H = 250, pl = 16, pr = 16, pt = 16, pb = 34, base = H - pb;
  const max = Math.max(4, ...r.dias.map(d => d.espasmos)) * 1.08;
  const x = i => (n === 1 ? W / 2 : pl + (i * (W - pl - pr)) / (n - 1));
  const y = v => pt + (1 - v / max) * (base - pt);
  const pts = r.dias.map((d, i) => [x(i), y(d.espasmos), d, i]);
  const inicios = r.medicacoes.filter(m => m.inicio > r.de && m.inicio <= r.ate).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const marca = new Set(inicios.map(m => m.inicio));
  const denso = n > 14, mostra = i => n <= 14 || i % Math.ceil(n / 7) === 0 || i === n - 1;
  const grade = pts.map(([a, , d, i]) => (marca.has(d.dia)
    ? `<line x1="${a}" x2="${a}" y1="${pt - 6}" y2="${base}" stroke="#F9DF77" stroke-width="2.5" stroke-dasharray="4 5" stroke-linecap="round"/>`
    : !denso || mostra(i) ? `<line x1="${a}" x2="${a}" y1="${pt - 6}" y2="${base}" stroke="#F1F1F9" stroke-width="1.5"/>` : '')).join('');
  const area = `<path d="M${pts[0][0]},${base} ${pts.map(([a, b]) => `L${a},${b}`).join(' ')} L${pts[n - 1][0]},${base}Z" fill="url(#gl)"/>`;
  const linha = `<path d="M${pts.map(([a, b]) => `${a},${b}`).join(' L')}" fill="none" stroke="#4D50A2" stroke-width="3" stroke-dasharray="0.1 7" stroke-linecap="round" stroke-linejoin="round"/>`;
  const pontos = pts.map(([a, b, , i]) => `<g class="pt" data-act="pt" data-i="${i}"><circle cx="${a}" cy="${b}" r="16" fill="transparent"/>
    <circle class="halo" cx="${a}" cy="${b}" r="${denso ? 6.5 : 10.5}" fill="#D3D4EF"/><circle cx="${a}" cy="${b}" r="${denso ? 3.6 : 6}" fill="#4D50A2"/></g>`).join('');
  const rot = pts.map(([a, , d, i]) => {
    if (!mostra(i)) return '';
    const t = n <= 7 ? LETRA[new Date(d.dia + 'T12:00').getDay()] : d.dia.slice(8);
    return marca.has(d.dia)
      ? `<rect x="${a - 13}" y="${H - 25}" width="26" height="20" rx="10" fill="#F9DF77"/><text x="${a}" y="${H - 10}" text-anchor="middle" font-size="12" font-weight="900" fill="#2F3273">${t}</text>`
      : `<text x="${a}" y="${H - 10}" text-anchor="middle" font-size="12.5" font-weight="800" fill="#A2A4CF">${t}</text>`;
  }).join('');
  return `<svg class="linha" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="gl" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#4D50A2" stop-opacity=".10"/><stop offset="1" stop-color="#4D50A2" stop-opacity="0"/></linearGradient></defs>
    ${grade}<line x1="${pl}" x2="${W - pr}" y1="${y(max / 2)}" y2="${y(max / 2)}" stroke="#DCDDF3" stroke-width="1.5" stroke-dasharray="6 6"/>${area}${linha}${pontos}${rot}</svg>
    ${inicios.map(m => `<div class="mk-l"><b>${dsem(m.inicio)}</b>${esc(m.nome)}${m.dose ? ` ${esc(m.dose)}` : ''} começou em ${dm(m.inicio)}</div>`).join('')}`;
}

const subLinha = r => { const t = r.dias.reduce((s, d) => s + d.espasmos, 0); return `${t} no período · média ${(t / r.dias.length).toFixed(1).replace('.', ',')} por dia`; };
function cardLinha(r) {
  return `<div class="card"><h3>Espasmos por dia</h3><p class="sub" id="sub-linha">${subLinha(r)} · toque num ponto</p>${linhaDias(r)}</div>`;
}

function cardIntensidade(r) {
  const s = k => r.dias.reduce((t, d) => t + d[k], 0);
  const f = s('fortes'), m = s('medios'), w = s('fracos'), tot = s('espasmos');
  return `<div class="card"><h3>Intensidade</h3><p class="sub">${tot - f - m - w > 0 ? `${tot - f - m - w} sem intensidade anotada` : 'no período'}</p>
    ${donut([{ v: f, c: '#4D50A2' }, { v: m, c: '#A9ABE0' }, { v: w, c: '#DCDDF3' }], f + m + w, 'espasmos')}
    <div class="chips"><span class="chip c-a">Fortes<b>${f}</b></span><span class="chip c-b">Médios<b>${m}</b></span><span class="chip">Fracos<b>${w}</b></span></div></div>`;
}

function cardHoras(r) {
  const pos = s => ((+s.slice(11, 13) * 60 + +s.slice(14, 16)) / 1440) * 100;
  const linhas = r.dias.slice(-7).reverse().map(d => {
    const sv = r.salvas.filter(x => x.inicio.startsWith(d.dia));
    const ds = r.doses.filter(x => x.dose_registrada?.dada_em.startsWith(d.dia));
    return `<div class="strip-l"><b>${dsem(d.dia)} ${d.dia.slice(8)}</b><span>${d.espasmos} em ${plural(d.salvas, 'salva', 'salvas')}</span></div>
      <div class="strip"><span class="ax"></span>${ds.map(x => `<span class="dz" style="left:${pos(x.dose_registrada.dada_em)}%"></span>`).join('')}
      ${sv.map(x => { const z = Math.min(22, 7 + x.total * 0.7); return `<span class="p" style="left:${pos(x.inicio)}%;width:${z}px;height:${z}px"></span>`; }).join('')}</div>`;
  }).join('');
  return `<div class="card"><h3>Que horas acontecem</h3><p class="sub">● salva &nbsp; ▍ dose dada</p>${linhas}
    <div class="hours"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>24h</span></div></div>`;
}

function cardAdesao(r) {
  const ds = r.doses.filter(d => d.status !== 'extra' && d.status !== 'pendente');
  const c = { dada: 0, dada_atrasada: 0, atrasada: 0 };
  ds.forEach(d => c[d.status]++);
  const pct = ds.length ? Math.round(((c.dada + c.dada_atrasada) / ds.length) * 100) : 0;
  return `<div class="card"><h3>Doses registradas</h3><p class="sub">${plural(ds.length, 'dose prevista', 'doses previstas')} até agora</p>
    ${donut([{ v: c.dada, c: '#4D50A2' }, { v: c.dada_atrasada, c: '#A9ABE0' }, { v: c.atrasada, c: '#DCDDF3' }], pct, '%')}
    <div class="chips"><span class="chip c-a">No horário<b>${c.dada}</b></span><span class="chip c-b">Atrasada<b>${c.dada_atrasada}</b></span><span class="chip">Não registrada<b>${c.atrasada}</b></span></div></div>`;
}

function ntDoseHist(d) {
  const r = d.dose_registrada, dia = (d.previsto || r.dada_em).slice(0, 10);
  const st = { dada: ['c-a', 'no horário'], dada_atrasada: ['c-b', 'atrasada'], atrasada: ['c-r', 'não registrada'], extra: ['', 'extra'] }[d.status];
  return `<div class="nt"><span class="ic"><svg class="ico"><use href="#t-pills"/></svg></span>
    <span class="tx"><small>${dsem(dia)} ${dm(dia)}${d.previsto ? ` · prevista ${hm(d.previsto)}` : ''}</small><b>${esc(d.nome)}${d.dose ? ` · ${esc(d.dose)}` : ''}</b>
    <em>${r ? `dada ${hm(r.dada_em)} por ${esc(r.quem)}` : 'sem registro de quem deu'}</em></span><span class="chip ${st[0]}">${st[1]}</span></div>`;
}

// Padrões (GET /api/resumo → analise): mesmas linhas no app e no PDF. Linha = [o quê, valor, detalhe].
const num = n => (n == null ? '–' : String(n).replace('.', ','));
const tempo = m => (m == null ? '–' : m < 60 ? `${m} min` : m < 2880 ? `${Math.floor(m / 60)}h${pad(m % 60)}` : `${num(Math.round(m / 144) / 10)} dias`);
const segs = s => (s == null ? '–' : s < 60 ? `${num(s)} s` : dur(Math.round(s)));
function secoesAnalise(a) {
  const pc = (n, t) => `${Math.round((100 * n) / t)}%`, nome = m => `${m.nome}${m.dose ? ` ${m.dose}` : ''}`;
  const sv = a.salvas, en = a.entre_salvas, de = a.dentro, h = a.horarios, ac = a.acordou, f = a.falhas;
  const varia = m => (m.antes.espasmos_dia ? `${m.depois.espasmos_dia > m.antes.espasmos_dia ? '+' : ''}${Math.round((100 * (m.depois.espasmos_dia - m.antes.espasmos_dia)) / m.antes.espasmos_dia)}% · ` : '');
  return [
    { t: 'Antes × depois do remédio', sub: 'espasmos por dia', ls: a.remedios.filter(m => m.antes && m.depois).map(m => [nome(m), `${num(m.antes.espasmos_dia)} → ${num(m.depois.espasmos_dia)}`,
      `${varia(m)}começou ${dm(m.inicio)} · ${num(m.antes.dias)} dias antes × ${num(m.depois.dias)} dias ${m.depois.de === m.inicio ? 'desde o início' : `até ${dm(m.depois.ate)}`}`]) },
    { t: 'Semana a semana', sub: 'blocos de 7 dias', ls: a.semanas.map(s => [`${dm(s.de)} a ${dm(s.ate)}`, `${num(s.espasmos_dia)}/dia`,
      `${num(s.salvas_dia)} salvas/dia · ${num(s.espasmos_por_salva)} espasmos por salva${s.fortes_pct == null ? '' : ` · ${s.fortes_pct}% fortes`}`]) },
    { t: 'Como são as salvas', sub: plural(sv.salvas, 'salva no período', 'salvas no período'), ls: [
      sv.salvas && ['Espasmos por salva', num(sv.espasmos_por_salva), 'média'],
      sv.fortes_por_salva != null && ['Fortes por salva', num(sv.fortes_por_salva), `${sv.fortes_pct}% dos espasmos anotados foram fortes`],
      sv.cronometradas && ['Duração', dur(sv.duracao_media_seg), `média de ${plural(sv.cronometradas, 'salva cronometrada', 'salvas cronometradas')}`]] },
    { t: 'Tempo entre salvas', sub: 'do fim de uma ao começo da próxima', ls: en.intervalos ? [
      ['Intervalo típico', tempo(en.mediana_min), `mediana de ${plural(en.intervalos, 'intervalo', 'intervalos')} · média ${tempo(en.media_min)}`],
      ['Maior período sem crise', tempo(en.maior_min), `${dm(en.maior_desde)} ${hm(en.maior_desde)} a ${dm(en.maior_ate)} ${hm(en.maior_ate)}`]] : [] },
    { t: 'Dentro da salva', sub: 'tempo entre um espasmo e o próximo', ls: [
      de.medidas && ['Intervalo médio', segs(de.intervalo_medio_seg), `medido pelo contador em ${plural(de.medidas, 'salva', 'salvas')}`],
      de.comeco_seg != null && ['Começo → fim da salva', `${segs(de.comeco_seg)} → ${segs(de.fim_seg)}`, 'se aumenta, os espasmos vão espaçando até parar'],
      de.estimadas && ['Estimado', segs(de.intervalo_estimado_seg), `duração ÷ espasmos em ${plural(de.estimadas, 'salva', 'salvas')} sem contador`]] },
    { t: 'Quando acontecem', sub: plural(sv.salvas, 'salva', 'salvas'), ls: sv.salvas ? [
      ['Madrugada', `${h.madrugada} · ${pc(h.madrugada, sv.salvas)}`, '0h às 6h'], ['Manhã', `${h.manha} · ${pc(h.manha, sv.salvas)}`, '6h às 12h'],
      ['Tarde', `${h.tarde} · ${pc(h.tarde, sv.salvas)}`, '12h às 18h'], ['Noite', `${h.noite} · ${pc(h.noite, sv.salvas)}`, '18h à 0h'],
      ['Logo depois de acordar', `${ac.logo} · ${pc(ac.logo, sv.salvas)}`, 'acordou agora ou há ~10 min'],
      ac.dormindo && ['Dormindo', `${ac.dormindo} · ${pc(ac.dormindo, sv.salvas)}`],
      ac.sem_anotacao && ['Sem anotação de sono', `${ac.sem_anotacao}`]] : [] },
    { t: 'Relação com a dose', sub: 'salvas logo depois da dose · no meio do intervalo · perto da próxima (sem relação com a dose, ~33% cada)', ls: [
      ...a.dose.map(d => [nome(d), `${pc(d.logo_depois, d.salvas)} · ${pc(d.meio, d.salvas)} · ${pc(d.perto_da_proxima, d.salvas)}`, plural(d.salvas, 'salva', 'salvas')]),
      f.dias_com_falha && f.dias_sem_falha && ['Dias com dose atrasada ou sem registro', `${num(f.espasmos_dia_com_falha)} × ${num(f.espasmos_dia_sem_falha)}`,
        `espasmos/dia: ${plural(f.dias_com_falha, 'dia', 'dias')} com falha × ${plural(f.dias_sem_falha, 'dia', 'dias')} com todas no horário`]] },
  ].map(s => ({ ...s, ls: s.ls.filter(Boolean) })).filter(s => s.ls.length);
}
const cardAnalise = s => `<div class="card"><h3>${s.t}</h3><p class="sub">${s.sub}</p><div class="kv">${s.ls.map(([o, v, d]) =>
  `<div><span>${esc(o)}${d ? `<small>${esc(d)}</small>` : ''}</span><b>${esc(v)}</b></div>`).join('')}</div></div>`;

function telaHistorico() {
  const r = S.resumo; // mostra o último enquanto o novo período carrega
  const tabs = `<div class="seg">${[['esp', 'Espasmos'], ['padroes', 'Padrões'], ['doses', 'Doses']].map(([k, t]) => `<button class="${S.aba === k ? 'on' : ''}" data-act="aba" data-v="${k}">${t}</button>`).join('')}</div>`;
  const topo = barra('Histórico', `<button class="sq lbl" data-act="hist">${S.hist} dias</button>`) + tabs;
  if (!r) return topo + '<p class="vazio">Carregando…</p>';
  if (S.aba === 'padroes') {
    if (!r.analise) return topo + '<p class="vazio">Carregando…</p>';
    return topo + `<div class="lista" style="margin-top:18px">${secoesAnalise(r.analise).map(cardAnalise).join('') || '<p class="vazio">Ainda não tem registro suficiente.</p>'}</div>
      <div class="nota">Calculado com o que vocês registraram nos últimos ${S.hist} dias. O “antes × depois” também olha fora desse período. Quem interpreta é o neuro: leve o relatório em PDF.</div>`;
  }
  const paineis = cs => `<div class="paineis" id="paineis">${cs.join('')}</div><div class="dots" id="pdots">${cs.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>`;
  if (S.aba === 'doses') {
    const lista = r.doses.filter(d => d.status !== 'pendente' && (!S.soFalhas || d.status === 'atrasada' || d.status === 'dada_atrasada')).reverse().slice(0, 60);
    return topo + paineis([cardAdesao(r)]) + `
      <div class="tog"><span>Só atrasadas e não registradas</span><button class="chip ${S.soFalhas ? 'on' : ''}" data-act="so-falhas">${S.soFalhas ? 'Ligado' : 'Desligado'}</button></div>
      ${lista.length ? `<div class="lista">${lista.map(ntDoseHist).join('')}</div>` : '<p class="vazio">Nada nesse filtro.</p>'}`;
  }
  return topo + paineis([cardLinha(r), cardIntensidade(r), cardHoras(r)]) + `
    <div class="sec"><h2>Salvas do período</h2><span style="font-size:13px;color:var(--on-indigo-2)">${r.salvas.length}</span></div>
    ${r.salvas.length ? `<div class="lista">${[...r.salvas].reverse().map(s => ntSalva(s, true)).join('')}</div>` : '<p class="vazio">Nenhuma salva no período.</p>'}`;
}

// ----- Remédios -----
function medCard(m) {
  const d = hojeD(), st = m.inicio > d ? ['c-y', `começa ${dm(m.inicio)}`] : m.fim && m.fim < d ? ['', 'encerrado'] : ['c-a', 'em uso'];
  return `<button class="med ${st[1] === 'encerrado' ? 'fim' : ''}" data-act="m-edit" data-id="${m.id}">
    <div class="h"><span class="circ"><svg><use href="#t-pills"/></svg></span><span><b>${esc(m.nome)}</b><small>${esc(m.dose) || 'sem dose'} · ${m.fim ? `${dm(m.inicio)} → ${dm(m.fim)}` : `desde ${dm(m.inicio)}`}</small></span><span class="chip ${st[0]}">${st[1]}</span></div>
    <div class="chips">${m.horarios.map(h => `<span class="chip">${h}</span>`).join('')}</div></button>`;
}

function telaRemedios() {
  const d = hojeD();
  const ativos = S.meds.filter(m => m.inicio <= d && (!m.fim || m.fim >= d));
  const futuros = S.meds.filter(m => m.inicio > d), fim = S.meds.filter(m => m.fim && m.fim < d);
  const grupo = (tit, ms) => (ms.length ? `<div class="sec"><h2>${tit}</h2></div><div class="lista">${ms.map(medCard).join('')}</div>` : '');
  return barra('Remédios') + hero('Remédios e horários', plural(ativos.length, 'em uso', 'em uso')) + `
    <button class="btn-y" data-act="m-novo">${ic('plus')} Novo remédio</button>
    ${grupo('Em uso', ativos)}${grupo('Começam depois', futuros)}${grupo('Encerrados', fim)}
    ${S.meds.length ? '' : '<p class="vazio">Nenhum remédio cadastrado ainda.</p>'}
    <div class="nota">Quem muda dose é o médico: o app só registra. Para desmame, abra o remédio e use “Mudar dose a partir de…”. Cada fase fica no histórico.</div>`;
}

// ----- Relatório -----
function cardAtalhos() {
  const at = S.eu?.atalhos;
  const corpo = at?.espasmo && at?.dei
    ? `<button class="btn" data-act="instalar" data-v="espasmo">${ic('wave')} Instalar "Espasmo"</button>
       <button class="btn" data-act="instalar" data-v="dei">${ic('check')} Instalar "Dei a dose"</button>
       <p class="sub" style="margin:14px 0 0">O botão copia o seu código: cole quando o iPhone pedir. Depois, em <b style="color:var(--ink)">Ajustes → Acessibilidade → Toque → Toque Traseiro</b>, escolha toque duplo = Espasmo e triplo = Dei a dose.</p>`
    : '<p class="sub" style="margin:0">Os links dos atalhos ainda não foram configurados no servidor (veja docs/iphone-atalhos.md).</p>';
  return `<div class="card"><h3>Atalhos do iPhone</h3><p class="sub">2 toques nas costas = Espasmo · 3 toques = Dei a dose</p>${corpo}</div>`;
}

function telaRelatorio() {
  const inicioTrat = S.meds.map(m => m.inicio).sort()[0] || addDias(hojeD(), -13);
  const atalho = (n, rot) => `<button class="chip" data-act="rel-atalho" data-v="${n}">${rot}</button>`;
  return barra('Relatório') + hero('Relatório pra consulta', 'PDF pro neuro') + `<div class="lista" style="margin-top:22px">
    <div class="card"><h3>Período</h3><p class="sub">espasmos, salvas, doses e fases dos remédios</p>
      <div class="row"><div class="f"><label>De</label><input class="in" type="date" id="r-de" value="${ls.get('pref:rel-de', inicioTrat)}"></div>
      <div class="f"><label>Até</label><input class="in" type="date" id="r-ate" value="${hojeD()}"></div></div>
      <div class="chips" style="margin-bottom:18px">${atalho(7, '7 dias')}${atalho(14, '14 dias')}${atalho(30, '30 dias')}<button class="chip" data-act="rel-atalho" data-v="trat" data-d="${inicioTrat}">Desde o início</button></div>
      <button class="btn" data-act="rel-gerar">${ic('doc')} Gerar relatório</button></div>
    ${cardAtalhos()}
    <div class="card"><h3>Este aparelho</h3><p class="sub">Conectado como <b style="color:var(--ink)">${esc(S.hoje?.usuario || '')}</b></p>
      <button class="btn ghost" data-act="sair">Sair deste aparelho</button></div></div>
    <div class="nota">Na tela do relatório, toque em “Salvar PDF”. No iPhone: Compartilhar → Salvar em Arquivos.</div>`;
}

function telaImprimir() {
  const { de, ate } = periodo();
  const r = S.resumoKey === `${de}|${ate}` ? S.resumo : null;
  const acoes = `<div class="acoes noprint"><button class="btn ghost" data-act="voltar">Voltar</button><button class="btn" data-act="imprimir">${ic('doc')} Salvar PDF</button></div>`;
  if (!r) return `<div class="rel">${acoes}<p class="vazio" style="color:var(--muted)">Montando relatório…</p></div>`;
  const tot = r.dias.reduce((t, d) => t + d.espasmos, 0), prev = r.dias.reduce((t, d) => t + d.doses_previstas, 0), dadas = r.dias.reduce((t, d) => t + d.doses_dadas, 0);
  const falhas = r.doses.filter(d => d.status === 'atrasada' || d.status === 'dada_atrasada');
  return `<div class="rel">${acoes}
    <div class="cab"><div><h1>Luísa <span>· relatório</span></h1><p style="color:var(--muted);font-weight:800;margin-top:4px">${dmy(de)} a ${dmy(ate)} · ${r.dias.length} dias</p></div><img src="/icon.svg" width="54" height="54" alt="" style="border-radius:16px"></div>
    <div class="nums"><div><b>${tot}</b><span>espasmos</span></div><div><b>${(tot / r.dias.length).toFixed(1).replace('.', ',')}</b><span>média por dia</span></div><div><b>${r.salvas.length}</b><span>salvas</span></div><div><b>${dadas}/${prev}</b><span>doses registradas</span></div></div>
    <h2>Espasmos por dia</h2><div class="graf">${linhaDias(r)}</div>
    ${r.analise ? `<h2>Padrões</h2>${secoesAnalise(r.analise).map(s => `<table class="pd"><tr><th colspan="3">${s.t} · ${s.sub}</th></tr>
      ${s.ls.map(([o, v, d]) => `<tr><td>${esc(o)}</td><td><b>${esc(v)}</b></td><td>${esc(d || '')}</td></tr>`).join('')}</table>`).join('')}` : ''}
    <h2>Medicação no período</h2>
    <table><tr><th>Remédio</th><th>Dose</th><th>Horários</th><th>Início</th><th>Fim</th><th>Obs.</th></tr>
      ${r.medicacoes.map(m => `<tr><td><b>${esc(m.nome)}</b></td><td>${esc(m.dose)}</td><td>${m.horarios.join(', ')}</td><td>${dmy(m.inicio)}</td><td>${m.fim ? dmy(m.fim) : '–'}</td><td>${esc(m.obs)}</td></tr>`).join('') || '<tr><td colspan="6">Nenhuma</td></tr>'}</table>
    <h2>Salvas (${r.salvas.length})</h2>
    <table><tr><th>Data</th><th>Hora</th><th>Total</th><th>Forte / médio / fraco</th><th>Duração</th><th>Acordou</th><th>Por</th><th>Anotação</th></tr>
      ${r.salvas.map(s => `<tr><td>${dsem(s.inicio.slice(0, 10))} ${dm(s.inicio.slice(0, 10))}</td><td>${hm(s.inicio)}</td><td><b>${s.total}</b></td><td>${s.fortes + s.medios + s.fracos ? `${s.fortes} / ${s.medios} / ${s.fracos}` : '–'}</td><td>${dur(s.duracao_seg) || '–'}</td><td>${esc(s.acordou) || '–'}</td><td>${esc(s.quem)}</td><td>${esc(s.nota)}${s.video ? ' (tem vídeo)' : ''}</td></tr>`).join('') || '<tr><td colspan="8">Nenhuma</td></tr>'}</table>
    <h2>Doses atrasadas ou não registradas (${falhas.length})</h2>
    <table><tr><th>Data</th><th>Remédio</th><th>Prevista</th><th>Dada</th><th>Situação</th></tr>
      ${falhas.map(d => `<tr class="${d.status === 'atrasada' ? 'a' : ''}"><td>${dm(d.previsto.slice(0, 10))}</td><td>${esc(d.nome)} ${esc(d.dose)}</td><td>${hm(d.previsto)}</td><td>${d.dose_registrada ? `${hm(d.dose_registrada.dada_em)} (${esc(d.dose_registrada.quem)})` : '–'}</td><td>${d.status === 'atrasada' ? 'não registrada' : 'atrasada'}</td></tr>`).join('') || '<tr><td colspan="5">Nenhuma: todas registradas no horário.</td></tr>'}</table>
    <h2>Resumo diário</h2>
    <table><tr><th>Dia</th><th>Espasmos</th><th>Salvas</th><th>Fortes</th><th>Médios</th><th>Fracos</th><th>Doses</th></tr>
      ${r.dias.map(d => `<tr><td>${dsem(d.dia)} ${dm(d.dia)}</td><td><b>${d.espasmos}</b></td><td>${d.salvas}</td><td>${d.fortes}</td><td>${d.medios}</td><td>${d.fracos}</td><td>${d.doses_dadas}/${d.doses_previstas}</td></tr>`).join('')}</table>
    <p class="rod">Gerado em ${dmy(hojeD())} às ${hm(local())} por ${esc(S.hoje?.usuario || '')}. Registros feitos pelos pais. O app não calcula nem sugere doses.</p></div>`;
}

function telaLogin() {
  return `<div class="login"><img src="/icon.svg" alt=""><h1>Doses e espasmos<br>da Luísa</h1>
    <p>Digite o seu código de acesso ou cole o seu link pessoal:</p>
    <input class="in" id="tk" placeholder="código ou link de acesso" autocomplete="off">
    <button class="btn y" data-act="entrar">Entrar</button></div>`;
}

function render() {
  if (!token) { $('#app').innerHTML = telaLogin(); return; }
  const r = rota();
  const tela = { historico: telaHistorico, remedios: telaRemedios, relatorio: telaRelatorio, imprimir: telaImprimir }[r] || telaHoje;
  const sl = $('#paineis')?.scrollLeft;
  $('#app').innerHTML = tela() + (r === 'imprimir' ? '' : nav(r));
  if (r === 'historico' || r === 'imprimir') garantirResumo();
  const car = $('#carrossel');
  if (car) {
    const alvo = S.ativo && slotDe(S.ativo) ? S.ativo : S.hoje?.proxima && chave(S.hoje.proxima);
    S.ativo = null;
    ativarCard(alvo || car.querySelector('.tc')?.dataset.k);
    car.addEventListener('scroll', () => requestAnimationFrame(() => ativarCard()), { passive: true });
  }
  const pn = $('#paineis');
  if (pn) {
    if (sl) pn.scrollLeft = sl;
    pn.addEventListener('scroll', () => {
      const i = Math.round(pn.scrollLeft / pn.clientWidth);
      $('#pdots').querySelectorAll('i').forEach((d, k) => d.classList.toggle('on', k === i));
    }, { passive: true });
  }
}

function sair() {
  token = '';
  aoVivo?.close();
  ['token', 'cache:hoje', 'cache:meds', 'cache:resumo', 'fila', 'salva'].forEach(k => ls.set(k, null));
  Object.assign(S, { hoje: null, meds: [], fila: [], salva: null, resumo: null });
  fecharSheet(); renderSalva(); render();
}

// ---------- ações ----------
const A = {
  toast() { $('#toast').innerHTML = ''; toastFn?.(); },
  fundo(el, e) { if (e.target === el) fecharSheet(); },
  fechar: fecharSheet,
  espasmo: iniciarSalva,
  dei(el) {
    const s = slotDe(el.dataset.k);
    if (s.status === 'atrasada' || -minDe(s.previsto) > 60) abrirDei(el.dataset.k);
    else darDose(el.dataset.k);
  },
  'dei-hora'(el) {
    const s = slotDe(el.dataset.k), v = el.dataset.v;
    darDose(el.dataset.k, v === 'agora' ? local() : v === 'previsto' ? s.previsto + ':00' : `${hojeD()}T${$('#dei-t').value || hm(local())}:00`);
  },
  'dose-info': el => abrirDoseInfo(el.dataset.id),
  'dose-apagar': el => apagarDose(el.dataset.id),
  salva: el => abrirSalva(el.dataset.id),
  'salva-nova': () => abrirSalva(null),
  tap(el) {
    // tt: segundos desde o início de cada toque, pra medir o tempo entre espasmos (salva aberta antes dessa versão não tem)
    S.salva.taps.push(el.dataset.k); (S.salva.tt ||= []).push(Math.round((Date.now() - S.salva.t0) / 100) / 10); ls.set('salva', S.salva);
    navigator.vibrate?.(18);
    renderSalva();
  },
  'sv-undo'() { S.salva.taps.pop(); S.salva.tt?.pop(); ls.set('salva', S.salva); renderSalva(); },
  'sv-acordou'(el) { S.salva.acordou = S.salva.acordou === el.dataset.v ? '' : el.dataset.v; ls.set('salva', S.salva); renderSalva(); },
  'sv-fim': terminarSalva,
  'sv-fechar'() {
    if (S.salva.taps.length) {
      return abrirSheet(`<h2>Descartar esta salva?</h2><p class="sub">Você marcou ${S.salva.taps.length} ${S.salva.taps.length === 1 ? 'espasmo' : 'espasmos'}. Para guardar, use “Terminou”.</p>
        <button class="btn" data-act="fechar">Continuar contando</button><button class="btn txt" data-act="sv-descartar">Descartar</button>`);
    }
    A['sv-descartar']();
  },
  'sv-descartar'() {
    const s = S.salva;
    fecharSheet(); fecharSalva();
    toast('Salva descartada', { icone: 'x', acao: { label: 'Desfazer', fn: () => { S.salva = s; ls.set('salva', s); iniciarSalva(); } } });
  },
  'sv-manual'() { if (!S.salva.taps.length) fecharSalva(); abrirSalva(null); },
  st(el) {
    const k = el.dataset.k;
    F[k] = Math.max(0, F[k] + +el.dataset.v);
    $(`#st-${k}`).textContent = F[k];
    $('#s-total-f').hidden = F.fortes + F.medios + F.fracos > 0;
  },
  's-acordou'(el) {
    F.acordou = F.acordou === el.dataset.v ? '' : el.dataset.v;
    $('#s-acordou').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.v === F.acordou));
  },
  's-salvar': salvarSalvaForm,
  's-apagar'() {
    const id = F.id;
    fecharSheet();
    if (S.hoje) { S.hoje.salvas = S.hoje.salvas.filter(s => s.id !== id); recalcularHoje(); }
    if (S.resumo) S.resumo.salvas = S.resumo.salvas.filter(s => s.id !== id);
    enviar('DELETE', `/api/espasmos/${id}`);
    toast('Salva apagada', { icone: 'x' });
  },
  hist() { S.hist = { 7: 14, 14: 30, 30: 7 }[S.hist] || 7; ls.set('pref:hist', S.hist); render(); },
  aba(el) { S.aba = el.dataset.v; render(); },
  card(el) {
    if (!el.classList.contains('ativo')) return el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    const s = slotDe(el.dataset.k);
    if (s?.dose_registrada) abrirDoseInfo(s.dose_registrada.id); else if (s) A.dei(el);
  },
  pt(el) {
    const d = S.resumo?.dias[+el.dataset.i], sub = $('#sub-linha');
    if (!d || !sub) return;
    el.closest('svg').querySelectorAll('.pt').forEach(g => g.classList.toggle('on', g === el));
    sub.textContent = `${dsem(d.dia)} ${dm(d.dia)}: ${plural(d.espasmos, 'espasmo', 'espasmos')} em ${plural(d.salvas, 'salva', 'salvas')}`;
  },
  'so-falhas'() { S.soFalhas = !S.soFalhas; render(); },
  'm-novo': () => abrirMed(null),
  'm-edit': el => abrirMed(+el.dataset.id),
  'm-fase': el => abrirMed(+el.dataset.id, true),
  'h-add'() {
    const v = $('#m-h').value;
    if (v && !F.horarios.includes(v)) F.horarios.push(v);
    $('#m-h').value = '';
    renderHorarios();
  },
  'h-rm'(el) { F.horarios = F.horarios.filter(h => h !== el.dataset.v); renderHorarios(); },
  'm-salvar': salvarMed,
  async 'm-apagar'(el) {
    try { await api('DELETE', `/api/medicacoes/${el.dataset.id}`); fecharSheet(); toast('Remédio apagado', { icone: 'x' }); carregar(); }
    catch (e) { toast(e.status ? e.message : 'Sem internet', { erro: true }); }
  },
  'rel-atalho'(el) { $('#r-de').value = el.dataset.v === 'trat' ? el.dataset.d : addDias(hojeD(), -(+el.dataset.v - 1)); },
  'rel-gerar'() {
    const de = $('#r-de').value, ate = $('#r-ate').value;
    if (!de || !ate || de > ate) return toast('Escolha um período válido', { erro: true });
    ls.set('pref:rel-de', de);
    location.hash = `#/imprimir?de=${de}&ate=${ate}`;
  },
  imprimir: () => print(),
  instalar(el) {
    // copia o código e abre o atalho compartilhado no mesmo toque (o iOS exige o gesto do usuário pros dois)
    navigator.clipboard?.writeText(token).catch(() => {});
    window.open(S.eu.atalhos[el.dataset.v], '_blank');
    toast('Seu código foi copiado. Cole quando o iPhone pedir.', { sub: 'Atalhos do iPhone', icone: 'check' });
  },
  voltar: () => (location.hash = '#/relatorio'),
  eu() {
    abrirSheet(`<h2>Olá, ${esc(S.hoje?.usuario || '')}</h2><p class="sub">Tudo que você registra aparece com o seu nome para os outros.${S.fila.length ? `<br>${S.fila.length} registro(s) esperando internet para enviar.` : ''}</p>
      <button class="btn ghost" data-act="fechar">Fechar</button><button class="btn txt" data-act="sair">Sair deste aparelho</button>`);
  },
  sair,
  async entrar() {
    const v = $('#tk').value.trim();
    try {
      if (/^\d{4,8}$/.test(v)) { // código curto (PINS no servidor) vira o token da pessoa
        const r = await fetch('/api/entrar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo: v }) });
        const d = await r.json();
        if (!r.ok) return toast(d.erro, { erro: true });
        token = d.token;
      } else token = (v.match(/[?&]t=([^&#\s]+)/) || [, v])[1];
      await api('GET', '/api/eu'); ls.set('token', token); carregar(); ouvirAoVivo();
    }
    catch (e) { token = ''; toast(e.status ? 'Esse acesso não vale' : 'Sem conexão com o servidor', { erro: true }); }
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && A[el.dataset.act]) A[el.dataset.act](el, e);
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-file]'), file = el?.files?.[0];
  if (!file) return;
  if (el.dataset.file === 'sv-video') { salvaVideo = file; renderSalva(); toast('Vídeo vai junto quando terminar', { icone: 'cam' }); }
  if (el.dataset.file === 's-video') { F.arquivo = file; $('#s-arq').textContent = `Vídeo escolhido: ${file.name}`; }
});
addEventListener('hashchange', () => { scrollTo(0, 0); render(); });
addEventListener('online', sincronizar);
addEventListener('offline', () => { S.online = false; render(); });
// Ao vivo: o servidor avisa quando alguém registra (atalho do iPhone, agente, outro celular)
// e o app recarrega na hora, sem F5. Se a conexão cair, o próprio EventSource reconecta.
let aoVivo, recargaT;
function ouvirAoVivo() {
  if (!token || (aoVivo && aoVivo.readyState !== EventSource.CLOSED)) return;
  aoVivo = new EventSource(`/api/ao-vivo?t=${encodeURIComponent(token)}`);
  aoVivo.onmessage = () => {
    clearTimeout(recargaT);
    recargaT = setTimeout(() => (S.fila.length ? sincronizar() : carregar()), 300); // junta avisos em rajada
  };
}
const voltou = () => {
  if (document.hidden) return;
  if (S.salva) manterTela(true);
  ouvirAoVivo();
  sincronizar();
};
document.addEventListener('visibilitychange', voltou);
addEventListener('focus', voltou);
addEventListener('pageshow', voltou); // iOS volta do segundo plano às vezes só com pageshow
setInterval(tickSalva, 250);
setInterval(() => rota() === 'hoje' && render(), 30000);
setInterval(() => !document.hidden && sincronizar(), 60000); // reserva, caso o ao vivo esteja fora

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
render();
if (S.salva) iniciarSalva();
sincronizar();
ouvirAoVivo();
