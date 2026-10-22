// node --test   (sobe o servidor num banco temporário e exercita a API)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'luisa-'));
process.env.USUARIOS = 'Lucas,Mãe';
const { server, db } = require('./server');

test('fluxo de doses e espasmos', async t => {
  await new Promise(ok => server.listen(0, ok));
  t.after(() => { server.closeAllConnections(); server.close(); db.close(); });
  const base = `http://localhost:${server.address().port}`;
  const tok = nome => db.prepare('SELECT token FROM usuarios WHERE nome = ?').get(nome).token;
  const lucas = tok('Lucas'), mae = tok('Mãe');
  const call = async (tok, method, url, body) => {
    const r = await fetch(base + url, { method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, body: r.status === 204 ? null : await r.json() };
  };
  const pad = n => String(n).padStart(2, '0');
  const d = new Date(); d.setDate(d.getDate() - 1);
  const ontem = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  assert.equal((await call('x', 'GET', '/api/hoje')).status, 401);

  const med = await call(lucas, 'POST', '/api/medicacoes', { nome: 'Levetiracetam', dose: '1 ml', horarios: ['13:00', '07:00'], inicio: ontem });
  assert.equal(med.status, 201);
  assert.deepEqual(med.body.horarios, ['07:00', '13:00']);
  assert.equal((await call(lucas, 'GET', '/api/medicacoes')).body.length, 1);

  // agente: "dei levetiracetam às 07:05" casa com o horário das 07:00
  const dose = await call(lucas, 'POST', '/api/doses', { id: 'a1', remedio: 'levetiracetam', hora: `${ontem}T07:05` });
  assert.equal(dose.status, 201);
  assert.equal(dose.body.previsto, `${ontem}T07:00`);
  assert.equal((await call(lucas, 'POST', '/api/doses', { id: 'a1', remedio: 'levetiracetam', hora: `${ontem}T07:05` })).status, 200, 'reenvio da fila é idempotente');

  // a outra pessoa tenta dar a mesma dose
  const dup = await call(mae, 'POST', '/api/doses', { medicacao_id: med.body.id, previsto: `${ontem}T07:00` });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.dose.quem, 'Lucas');
  // pelo agente, minutos depois: não pode escorregar pro horário das 13:00
  assert.equal((await call(mae, 'POST', '/api/doses', { remedio: 'Levetiracetam', hora: `${ontem}T07:40` })).status, 409);

  const salva = await call(mae, 'POST', '/api/espasmos', { inicio: `${ontem}T11:23`, fortes: 4, medios: 3, fracos: 3, duracao_seg: 147, acordou: '~10 min' });
  assert.equal(salva.body.total, 10);
  const edit = await call(lucas, 'POST', '/api/espasmos', { id: salva.body.id, nota: 'chorou depois' });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.total, 10, 'editar a nota mantém a contagem');
  assert.equal(edit.body.quem, 'Mãe', 'autor original é mantido');

  const r = (await call(lucas, 'GET', `/api/resumo?de=${ontem}&ate=${ontem}`)).body;
  assert.deepEqual([r.dias[0].espasmos, r.dias[0].salvas, r.dias[0].doses_dadas, r.dias[0].doses_nao_registradas], [10, 1, 1, 1]);
  assert.deepEqual(r.doses.map(x => x.status), ['dada', 'atrasada']);

  // análise: intervalo dentro da salva pelos toques do contador; sem toques, estima duração ÷ (espasmos - 1)
  assert.equal((await call(lucas, 'POST', '/api/espasmos', { toques: 'x' })).status, 400);
  await call(lucas, 'POST', '/api/espasmos', { inicio: `${ontem}T15:00`, fortes: 4, duracao_seg: 20, toques: [0, 4, 10, 18] });
  const a = (await call(lucas, 'GET', `/api/resumo?de=${ontem}&ate=${ontem}`)).body.analise;
  assert.deepEqual([a.dentro.intervalo_medio_seg, a.dentro.comeco_seg, a.dentro.fim_seg, a.dentro.intervalo_estimado_seg], [6, 4, 8, 16.3]);
  assert.equal(a.entre_salvas.maior_min, 215, '11:23 + 2:27 de salva até 15:00');
  assert.equal(a.semanas[0].espasmos_dia, 14);
  // levetiracetam 07:00 e 13:00: 11:23 cai no último terço do intervalo, 15:00 logo depois da dose das 13:00
  assert.deepEqual([a.dose[0].logo_depois, a.dose[0].meio, a.dose[0].perto_da_proxima], [1, 0, 1]);
  assert.deepEqual([a.falhas.dias_com_falha, a.falhas.espasmos_dia_com_falha], [1, 14]);

  assert.equal((await call(lucas, 'DELETE', `/api/medicacoes/${med.body.id}`)).status, 409, 'não apaga remédio com doses');
  assert.equal((await call(lucas, 'GET', '/api/eventos?desde=2000-01-01T00:00')).body.espasmos.length, 2);

  // ao vivo: o app aberto recebe o aviso quando alguém registra por fora
  const vivo = (await fetch(`${base}/api/ao-vivo?t=${lucas}`)).body.getReader();
  await vivo.read(); // "retry:"
  await call(mae, 'POST', '/api/espasmos', { total: 3 });
  assert.match(new TextDecoder().decode((await vivo.read()).value), /"tipo":"espasmo"/);
  await vivo.cancel();

  // atalhos do iPhone: token na URL, resposta em texto
  const atalho = async a => (await fetch(`${base}/api/atalho/${a}?t=${mae}`, { method: 'POST' })).text();
  assert.match(await atalho('espasmo'), /^Salva iniciada/);
  assert.match(await atalho('espasmo'), /^Salva encerrada: 0:0\d/);
  assert.match(await atalho('dei'), /dose|dada/i);
});
