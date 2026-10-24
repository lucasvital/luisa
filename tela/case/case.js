// Case da telinha: ESP32 DevKit 30 pinos + OLED 0,96" + bateria LiPo 103450 + carregador TP4056 USB-C + step-up MT3608 + chave.
// node tela/case/case.js  →  frente.stl, divisoria.stl, tampa.stl e montagem.png nesta pasta.
// Tudo em mm. "Direita" e "esquerda" = olhando a tela de frente (aqui isso é -x e +x).
// A sua peça mediu diferente? Mude o número aqui e rode de novo.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const FOLGA = 0.3;         // em volta de cada placa; aumente se a impressora "engorda" a peça, diminua em impressora de resina
const FOLGA_TAMPA = 0.15;  // a tampa entra sob pressão: aumente se não fechar, diminua se cair sozinha
const RES = 0.3;           // tamanho do "pixel" 3D do STL
const PAREDE = 2, FRENTE = 1.6, TAMPA = 1.6, DIV = 1.2, RAIO = 4.5, CHANFRO = 1;

const DK = { l: 51.5, w: 28.5, usb: 1.5, pecas: 3.5, pcb: 1.6, pinos: 8.5 }; // DevKit; usb = quanto o conector passa da placa
const TELA = { l: 27.3, a: 27.8, vidro: 1.6, pcb: 1.2, fios: 4.5, meio: 11, janela: [24, 13] };
// tela.fios: pinos cortados rente ao plástico preto + a solda. tela.meio: da borda de cima da plaquinha até o meio da parte que acende.
const TP = { l: 28, a: 17.5, pcb: 1.6, usb: 3.3 };
const BAT = { l: 34, a: 50, e: 10 };
const CHAVE = { l: 8.6, e: 3.6, fundo: 5 }; // SS12D00; fundo = quanto ela entra na caixa, com a solda

// ---------- onde cada coisa fica (z = 0 na frente, cresce pra trás) ----------
const IW = Math.max(BAT.l, DK.w, TELA.l) + 2 * FOLGA, IH = DK.l + DK.usb + 2 * FOLGA; // vão de dentro
const W = IW + 2 * PAREDE, H = IH + 2 * PAREDE, RI = RAIO - PAREDE;
const telaY1 = IH / 2 - FOLGA, telaY0 = telaY1 - TELA.a, janelaY = telaY1 - TELA.meio;
const zTelaPcb = FRENTE + TELA.vidro, zTelaFim = zTelaPcb + TELA.pcb;
const dkY0 = -IH / 2 + DK.usb;                           // USB do ESP32 encosta no chão
const zDK = zTelaFim + TELA.fios + DK.pecas;              // face da placa do ESP32 (peças viradas pra tela)
const zDiv = zDK + DK.pcb + DK.pinos + 0.5;               // divisória encosta nas pontas dos pinos e separa a bateria
const D = zDiv + DIV + BAT.e + 0.5;                       // fundo da caixa, onde a tampa encaixa
const tpY1 = telaY0 - FOLGA - 1.7, tpY0 = tpY1 - TP.a, tpYc = (tpY0 + tpY1) / 2;
const tpX0 = -IW / 2, tpZ = FRENTE + TP.pcb + TP.usb / 2; // carregador embaixo da tela, USB-C saindo pela direita
const usbZ = zDK - 1.4;                                   // micro-USB do ESP32, pra gravar
const chY = -IH / 2 + 1 + CHAVE.l / 2, chZ = FRENTE + 0.5 + CHAVE.e / 2; // chave na esquerda, embaixo

// ---------- formas (distância até a superfície: negativo = dentro) ----------
function caixa(x, y, z, x0, x1, y0, y1, z0, z1) {
  const qx = Math.max(x0 - x, x - x1), qy = Math.max(y0 - y, y - y1), qz = Math.max(z0 - z, z - z1);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
}
function arred(x, y, a, b, r) { // retângulo de canto redondo, meia largura a e meia altura b
  const qx = Math.abs(x) - a + r, qy = Math.abs(y) - b + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
// guias em L só nos 4 cantos de uma placa: seguram sem bater em fio ou peça da borda
function cantos(x, y, z, cx, cy, a, b, z0, z1) {
  const dx = Math.abs(x - cx), dy = Math.abs(y - cy);
  const anel = Math.max(caixa(dx, dy, z, -1, a + 1.2, -1, b + 1.2, z0, z1), -caixa(dx, dy, z, -1, a, -1, b, z0 - 1, z1 + 1));
  return Math.max(anel, a - 4 - dx, b - 4 - dy);
}

function frente(x, y, z) {
  const fora = arred(x, y, W / 2, H / 2, RAIO);
  const corpo = Math.max(fora, -z, z - D, (fora + CHANFRO - z) / Math.SQRT2); // chanfro de 45° na beirada da frente (imprime sem suporte)
  let f = Math.max(corpo, -Math.max(arred(x, y, IW / 2, IH / 2, RI), FRENTE - z));
  const dk = DK.w / 2 + FOLGA;
  f = Math.max(corpo, Math.min(f, // nada passa pra fora da caixa
    cantos(x, y, z, 0, (telaY0 + telaY1) / 2, TELA.l / 2 + FOLGA, TELA.a / 2 + FOLGA, FRENTE, zTelaFim),
    cantos(x, y, z, tpX0 + TP.l / 2, tpYc, TP.l / 2 + FOLGA + 1, TP.a / 2 + FOLGA, FRENTE, FRENTE + TP.pcb),
    // trilhos dos lados do ESP32 (na direita param antes do carregador); em cima de y=18 fica a passagem dos fios da tela
    caixa(x, y, z, dk, IW / 2 + 1, -12, 18, FRENTE - 0.1, zDiv),
    caixa(x, y, z, -IW / 2 - 1, -dk, 0, 18, FRENTE - 0.1, zDiv),
    // degrau de 0,5 mm na borda da placa: ela encosta aqui, sem tocar nas soldas dos pinos
    caixa(x, y, z, DK.w / 2 - 0.5, dk + 0.1, -12, 18, zDK - 2.5, zDK),
    caixa(x, y, z, -dk - 0.1, -(DK.w / 2 - 0.5), 0, 18, zDK - 2.5, zDK)));
  const jan = Math.max(Math.abs(x) - TELA.janela[0] / 2, Math.abs(y - janelaY) - TELA.janela[1] / 2);
  return Math.max(f,
    -Math.max(Math.min(jan, (jan + z - 1) / Math.SQRT2), z - FRENTE - 0.5),                              // janela da tela, chanfrada por fora
    -caixa(x, y, z, -W / 2 - 1, -IW / 2 + 1, tpYc - 4.75, tpYc + 4.75, tpZ - 1.95, tpZ + 1.95),           // USB-C de carregar
    -caixa(x, y, z, -W / 2 - 1, -W / 2 + 1.2, tpYc - 6.5, tpYc + 6.5, tpZ - 3.75, tpZ + 3.75),            // rebaixo: o plugue entra até o fim
    -caixa(x, y, z, -4.2, 4.2, -H / 2 - 1, -IH / 2 + 1, usbZ - 1.8, usbZ + 1.8),                         // micro-USB do ESP32
    -caixa(x, y, z, -5.75, 5.75, -H / 2 - 1, -H / 2 + 1.2, usbZ - 3.75, usbZ + 3.75),
    -caixa(x, y, z, IW / 2 - 1, W / 2 + 1, chY - 2.25, chY + 2.25, chZ - 1.1, chZ + 1.1),                // chave
    -caixa(x, y, z, -4, 4, H / 2 - 1, H / 2 + 1, D - 0.8, D + 1));                                     // fenda pra abrir a tampa com a unha
}

function divisoria(x, y, z) { // plaquinha entre os pinos do ESP32 e a bateria: ponta de pino não pode furar a LiPo
  const a = IW / 2 - FOLGA, b = IH / 2 - FOLGA;
  return Math.max(arred(x, y, a, b, RI - FOLGA), zDiv - z, z - zDiv - DIV,
    -caixa(Math.abs(x), y, z, a - 6, a + 1, -b - 1, -b + 5, zDiv - 1, zDiv + DIV + 1)); // passagem dos fios da bateria
}

function tampa(x, y, z) {
  const fora = arred(x, y, W / 2, H / 2, RAIO), zf = D + TAMPA;
  const placa = Math.max(fora, D - z, z - zf, (fora + 0.8 - (zf - z)) / Math.SQRT2);
  const a = IW / 2 - FOLGA_TAMPA, b = IH / 2 - FOLGA_TAMPA, r = RI - FOLGA_TAMPA;
  // aba que entra na caixa, só em cima e embaixo, onde não bate na bateria
  const aba = Math.max(arred(x, y, a, b, r), -arred(x, y, a - 1.2, b - 1.2, r - 1.2), D - 3 - z, z - D - 0.1, BAT.a / 2 + 0.5 - Math.abs(y));
  return Math.min(placa, aba);
}

// ---------- STL: amostra a forma numa grade e liga os pontos da superfície (surface nets) ----------
function malha(f, [ax, bx, ay, by, az, bz], h = RES) {
  ax -= 2 * h; ay -= 2 * h; az -= 2 * h;
  const nx = Math.ceil((bx - ax) / h) + 3, ny = Math.ceil((by - ay) / h) + 3, nz = Math.ceil((bz - az) / h) + 3;
  const sy = nx, sz = nx * ny, v = new Float32Array(nx * ny * nz);
  for (let k = 0, n = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v[n++] = f(ax + i * h, ay + j * h, az + k * h);
  // um ponto por cubinho que a superfície corta, na média de onde ela cruza as arestas
  const cel = new Int32Array(v.length), pts = [], q = new Float64Array(8);
  const off = [0, 1, sy, 1 + sy, sz, 1 + sz, sy + sz, 1 + sy + sz];
  const AR = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const n = i + j * sy + k * sz;
    let dentro = 0;
    for (let b = 0; b < 8; b++) if ((q[b] = v[n + off[b]]) < 0) dentro++;
    if (dentro === 0 || dentro === 8) continue;
    let px = 0, py = 0, pz = 0, m = 0;
    for (let e = 0; e < 24; e += 2) {
      const a = AR[e], b = AR[e + 1];
      if ((q[a] < 0) === (q[b] < 0)) continue;
      const t = q[a] / (q[a] - q[b]);
      px += (a & 1) + ((b & 1) - (a & 1)) * t;
      py += (a >> 1 & 1) + ((b >> 1 & 1) - (a >> 1 & 1)) * t;
      pz += (a >> 2) + ((b >> 2) - (a >> 2)) * t;
      m++;
    }
    cel[n] = pts.length / 3;
    pts.push(ax + (i + px / m) * h, ay + (j + py / m) * h, az + (k + pz / m) * h);
  }
  // cada aresta da grade que entra na peça vira um quadrado ligando os 4 cubinhos em volta, virado pra fora
  const tri = [], quad = (a, b, c, d, inv) => (inv ? tri.push(a, d, c, a, c, b) : tri.push(a, b, c, a, c, d));
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const n = i + j * sy + k * sz, s = v[n] < 0;
    if (s !== (v[n + 1] < 0)) quad(cel[n - sy - sz], cel[n - sz], cel[n], cel[n - sy], !s);
    if (s !== (v[n + sy] < 0)) quad(cel[n - 1 - sz], cel[n - 1], cel[n], cel[n - sz], !s);
    if (s !== (v[n + sz] < 0)) quad(cel[n - 1 - sy], cel[n - sy], cel[n], cel[n - 1], !s);
  }
  return { pts, tri };
}

// fechada = toda aresta usada uma vez em cada sentido; volume positivo = faces viradas pra fora
function conferir({ pts, tri }) {
  const P = i => [pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]], lado = new Map(), K = 2 ** 26;
  let vol = 0;
  for (let t = 0; t < tri.length; t += 3) {
    const [a, b, c] = [P(tri[t]), P(tri[t + 1]), P(tri[t + 2])];
    vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    for (let e = 0; e < 3; e++) { const k = tri[t + e] * K + tri[t + (e + 1) % 3]; lado.set(k, (lado.get(k) || 0) + 1); }
  }
  let ruins = 0;
  for (const [k, n] of lado) if (n !== 1 || lado.get((k % K) * K + Math.floor(k / K)) !== 1) ruins++;
  return { vol, ruins };
}

function salvarStl(arq, { pts, tri }) {
  const n = tri.length / 3, b = Buffer.alloc(84 + 50 * n);
  b.writeUInt32LE(n, 80);
  for (let t = 0; t < n; t++) {
    const o = 84 + 50 * t, [A, B, C] = [0, 1, 2].map(v => [0, 1, 2].map(c => pts[3 * tri[3 * t + v] + c]));
    const u = [0, 1, 2].map(c => B[c] - A[c]), w = [0, 1, 2].map(c => C[c] - A[c]);
    const nn = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...nn) || 1;
    nn.forEach((x, c) => b.writeFloatLE(x / l, o + 4 * c));
    [A, B, C].forEach((p, v) => p.forEach((x, c) => b.writeFloatLE(x, o + 12 + 12 * v + 4 * c)));
  }
  fs.writeFileSync(arq, b);
}

// ---------- foto da montagem (ray marching), pra conferir sem abrir o fatiador ----------
const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function foto(img, larg, x0, objs, olho, w, h, s) {
  const d = norm(olho.map(x => -x)), r = norm(cruz(d, [0, 1, 0])), u = cruz(r, d), L = norm([olho[0] - 0.4, olho[1] + 1.5, olho[2]]);
  const bb = [-W / 2 - 1, W / 2 + 1, -H / 2 - 1, H / 2 + 1, -1, D + TAMPA + 1], alvo = [0, 0, (D + TAMPA) / 2];
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const o = [0, 1, 2].map(c => alvo[c] + r[c] * (px - w / 2) * s + u[c] * (h / 2 - py) * s - d[c] * 300);
    let t0 = 0, t1 = 600;
    for (let c = 0; c < 3; c++) {
      let a = (bb[2 * c] - o[c]) / d[c], b = (bb[2 * c + 1] - o[c]) / d[c];
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    }
    for (let t = t0, i = 0; t < t1 && i < 400; i++) {
      const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t;
      let m = Infinity, qual = 0;
      for (let k = 0; k < objs.length; k++) { const v = objs[k][1](x, y, z); if (v < m) { m = v; qual = k; } }
      if (m < 0.02) {
        const [cor, f] = objs[qual], e = 0.05;
        const n = norm([f(x + e, y, z) - f(x - e, y, z), f(x, y + e, z) - f(x, y - e, z), f(x, y, z + e) - f(x, y, z - e)]);
        const luz = 0.35 + 0.65 * Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]), k = (py * larg + x0 + px) * 3;
        cor.forEach((c, j) => (img[k + j] = Math.min(255, c * luz * 255)));
        break;
      }
      t += Math.max(m * 0.7, 0.01);
    }
  }
}
function salvarPng(arq, w, h, rgb) {
  const linhas = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(linhas, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const bloco = (tipo, dados) => {
    const t = Buffer.from(tipo), n = Buffer.alloc(4), crc = Buffer.alloc(4);
    n.writeUInt32BE(dados.length); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, dados])));
    return Buffer.concat([n, t, dados, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(arq, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco('IHDR', ihdr), bloco('IDAT', zlib.deflateSync(linhas)), bloco('IEND', Buffer.alloc(0))]));
}

// ---------- gera tudo ----------
const pasta = __dirname, B = (z0, z1) => [-W / 2, W / 2, -H / 2, H / 2, z0, z1];
const pecas = [ // cada uma já deitada do jeito de imprimir, sem suporte
  ['frente', frente, B(0, D)],
  ['divisoria', (x, y, z) => divisoria(x, y, z + zDiv), B(0, DIV)],
  ['tampa', (x, y, z) => tampa(x, -y, D + TAMPA - z), B(0, TAMPA + 3)], // virada de cabeça pra baixo, lado de fora na mesa
];
for (const [nome, f, bb] of pecas) {
  const m = malha(f, bb), { vol, ruins } = conferir(m);
  salvarStl(path.join(pasta, `${nome}.stl`), m);
  console.log(`${nome}.stl: ${m.tri.length / 3} triângulos, ${(vol / 1000).toFixed(1)} cm³, ${ruins ? `${ruins} arestas abertas` : 'fechada'}`);
}
console.log(`caixa fechada: ${W.toFixed(1)} × ${H.toFixed(1)} × ${(D + TAMPA).toFixed(1)} mm`);

const C = (x0, x1, y0, y1, z0, z1) => (x, y, z) => caixa(x, y, z, x0, x1, y0, y1, z0, z1);
const dentro = [
  [[0.05, 0.05, 0.08], C(-13.35, 13.35, telaY1 - 23.5, telaY1 - 4.2, FRENTE, zTelaPcb)],      // vidro da tela
  [[0.15, 0.3, 0.75], C(-TELA.l / 2, TELA.l / 2, telaY0, telaY1, zTelaPcb, zTelaFim)],
  [[0.12, 0.12, 0.16], C(-DK.w / 2, DK.w / 2, dkY0, dkY0 + DK.l, zDK, zDK + DK.pcb)],         // ESP32
  [[0.75, 0.75, 0.78], C(-9, 9, dkY0 + DK.l - 25.5, dkY0 + DK.l, zDK - 3.1, zDK)],
  [[0.8, 0.8, 0.82], C(-3.9, 3.9, -IH / 2, -IH / 2 + 5.5, zDK - 2.8, zDK)],
  [[0.05, 0.05, 0.05], (x, y, z) => caixa(Math.abs(x), y, z, 11.45, 13.95, -19, 19, zDK + DK.pcb, zDK + DK.pcb + 2.5)],
  [[0.15, 0.3, 0.75], C(tpX0, tpX0 + TP.l, tpY0, tpY1, FRENTE, FRENTE + TP.pcb)],            // carregador
  [[0.8, 0.8, 0.82], C(tpX0, tpX0 + 7.3, tpYc - 4.47, tpYc + 4.47, FRENTE + TP.pcb, FRENTE + TP.pcb + TP.usb)],
  [[0.15, 0.3, 0.75], C(-8.5, 8.5, -18, 18, zDiv - 6.5, zDiv)],                             // step-up
  [[0.95, 0.6, 0.15], C(-BAT.l / 2, BAT.l / 2, -BAT.a / 2, BAT.a / 2, zDiv + DIV, zDiv + DIV + BAT.e)],
  [[0.1, 0.1, 0.1], C(IW / 2 - 3.5, IW / 2 + 1.5, chY - CHAVE.l / 2, chY + CHAVE.l / 2, chZ - CHAVE.e / 2, chZ + CHAVE.e / 2)],
];
const casca = [[[0.88, 0.88, 0.84], frente], [[0.72, 0.72, 0.68], tampa], [[0.55, 0.55, 0.55], divisoria]];
const corte = o => o.map(([cor, f]) => [cor, (x, y, z) => Math.max(f(x, y, z), -x)]); // metade esquerda, pra ver por dentro
const LW = 420, LH = 440, img = Buffer.alloc(LW * 2 * LH * 3, 255);
foto(img, LW * 2, 0, casca.slice(0, 2), [-0.7, 0.5, -1], LW, LH, 0.2);
foto(img, LW * 2, LW, corte([...casca, ...dentro]), [-1, 0.45, -0.4], LW, LH, 0.2);
salvarPng(path.join(pasta, 'montagem.png'), LW * 2, LH, img);
console.log('montagem.png: de frente e cortada ao meio');
