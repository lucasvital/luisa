// Câmera do berço: grava sem parar (só as últimas horas) e anexa sozinho o vídeo de cada salva registrada no app.
// Roda num PC de casa ligado, com ffmpeg instalado:  node --env-file=camera/.env camera/gravador.js
// camera/.env:
//   CAMERA_URL=rtsp://usuario:senha@192.168.18.x:554/stream1   (Tapo: "Conta da câmera" no app; stream2 = qualidade menor)
//   TOKEN=código do link do app (o que vem depois de ?t=)
//   APP_URL=https://c.devital.com.br
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { CAMERA_URL, TOKEN, APP_URL = 'https://c.devital.com.br' } = process.env;
if (!CAMERA_URL || !TOKEN) { console.error('Preencha CAMERA_URL e TOKEN em camera/.env'); process.exit(1); }
const GUARDAR_MIN = +(process.env.GUARDAR_MIN || 120); // quanto vídeo fica no PC (~1 GB por hora em 1080p)
const MARGEM = +(process.env.MARGEM_SEG || 30) * 1000; // antes do início e depois do fim da salva
const SEM_DURACAO = 5 * 60000; // salva registrada sem duração (agente, atalho sem o 2º toque)
const DIR = path.join(__dirname, 'gravacao');
fs.mkdirSync(DIR, { recursive: true });

const pad = n => String(n).padStart(2, '0');
const local = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const log = msg => console.log(`${local().replace('T', ' ')}  ${msg}`);
// arquivo 2026-10-23T05-30-10.ts começou a gravar às 05:30:10
const inicioDoArquivo = f => new Date(f.slice(0, 19).replace(/T(\d\d)-(\d\d)-(\d\d)/, 'T$1:$2:$3')).getTime();

function ffmpeg(args) {
  return new Promise((ok, falha) => spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' })
    .on('error', falha).on('exit', c => (c ? falha(new Error(`ffmpeg saiu com ${c}`)) : ok())));
}

// Vídeo copiado sem recodificar (CPU quase zero), em pedaços de 10 s. Áudio vira AAC: o da Tapo (G.711) não cabe em MP4.
async function gravar() {
  for (;;) {
    log('gravando a câmera');
    await ffmpeg(['-rtsp_transport', 'tcp', '-timeout', '10000000', '-i', CAMERA_URL, '-c:v', 'copy', '-c:a', 'aac',
      '-f', 'segment', '-segment_time', '10', '-reset_timestamps', '1', '-strftime', '1', path.join(DIR, '%Y-%m-%dT%H-%M-%S.ts')]).catch(e => log(e.message));
    log('câmera caiu, tentando de novo em 10 s');
    await new Promise(ok => setTimeout(ok, 10000));
  }
}

function limpar() {
  for (const f of fs.readdirSync(DIR)) {
    if (f.endsWith('.ts') && inicioDoArquivo(f) < Date.now() - GUARDAR_MIN * 60000) fs.rmSync(path.join(DIR, f), { force: true });
  }
}

const api = (p, opt = {}) => fetch(APP_URL + p, { ...opt, headers: { Authorization: `Bearer ${TOKEN}`, ...opt.headers }, signal: AbortSignal.timeout(120000) });

// ponytail: conta que os pedaços são contínuos; se a câmera caiu no meio da salva, o corte sai adiantado
async function anexar(e, ini, fim) {
  const arqs = fs.readdirSync(DIR).filter(f => f.endsWith('.ts')).sort().map(f => ({ f: path.join(DIR, f), t: inicioDoArquivo(f) }));
  const usados = arqs.filter((a, i) => a.t < fim && (arqs[i + 1]?.t ?? Infinity) > ini);
  if (!usados.length) return log(`salva das ${e.inicio.slice(11, 16)}: não há gravação desse horário`);
  const lista = path.join(DIR, 'lista.txt'), mp4 = path.join(DIR, `${e.id}.mp4`);
  fs.writeFileSync(lista, usados.map(a => `file '${a.f.replace(/\\/g, '/')}'`).join('\n'));
  const de = Math.max(ini, usados[0].t);
  await ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-ss', String((de - usados[0].t) / 1000), '-i', lista, '-t', String((fim - de) / 1000), '-c', 'copy', '-movflags', '+faststart', mp4]);
  try {
    const r = await api(`/api/espasmos/${e.id}/video`, { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: await fs.openAsBlob(mp4) });
    if (r.status === 404) return log(`salva das ${e.inicio.slice(11, 16)} foi apagada no app`);
    if (!r.ok) throw new Error(`app respondeu ${r.status} ao enviar o vídeo`);
    log(`vídeo da salva das ${e.inicio.slice(11, 16)} anexado (${(fs.statSync(mp4).size / 1e6).toFixed(0)} MB)`);
  } finally { fs.rmSync(mp4, { force: true }); }
}

const pendentes = new Map(); // id -> salva sem vídeo
let desde = local(new Date(Date.now() - GUARDAR_MIN * 60000));
async function verSalvas() {
  try {
    const r = await (await api(`/api/eventos?desde=${desde}`)).json();
    if (r.erro) throw new Error(r.erro);
    desde = local(new Date(new Date(r.agora).getTime() - 60000)); // 1 min de folga pra não perder registro do mesmo segundo
    for (const e of r.espasmos) e.video ? pendentes.delete(e.id) : pendentes.set(e.id, e);
  } catch (err) { return log(`não consegui falar com o app: ${err.message}`); }
  for (const e of pendentes.values()) {
    const t = new Date(e.inicio).getTime(), ini = t - MARGEM;
    const fim = t + (e.duracao_seg == null ? SEM_DURACAO : e.duracao_seg * 1000) + MARGEM;
    // sem duração, espera os 15 min em que o 2º toque do atalho ainda pode chegar
    if (Date.now() < (e.duracao_seg == null ? t + 15 * 60000 : fim)) continue;
    try { await anexar(e, ini, fim); pendentes.delete(e.id); } catch (err) {
      log(`salva das ${e.inicio.slice(11, 16)}: ${err.message}`);
      if (ini < Date.now() - GUARDAR_MIN * 60000) pendentes.delete(e.id); // a gravação já foi apagada, desiste
    }
  }
}

gravar();
setInterval(limpar, 60000);
(async () => { for (;;) { await verSalvas(); await new Promise(ok => setTimeout(ok, 15000)); } })();
