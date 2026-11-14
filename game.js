(() => {
'use strict';

/* =====================================================================
 *  基础工具
 * ===================================================================== */
const W = 360;                         // 逻辑宽度（高度按屏幕比例自适应）
let H = 640, scale = 1, dpr = 1, safeTop = 0;
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const pick = a => a[Math.floor(Math.random() * a.length)];
const $ = id => document.getElementById(id);
const FONT = '-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","WenQuanYi Zen Hei",sans-serif';

const gameEl = $('game'), canvas = $('hud'), ctx = canvas.getContext('2d');   // 2D 叠加层（HUD、文字）；3D 画面在另一个 canvas 上
const joyEl = $('joy'), knobEl = $('knob'), btnA = $('btnA'), btnB = $('btnB'), wsel = $('wsel');

/* =====================================================================
 *  音效（WebAudio 合成，无需外部资源）
 * ===================================================================== */
const Sfx = (() => {
  let ac = null, master = null, noiseBuf = null, muted = false;
  const last = {};
  try { muted = localStorage.getItem('starraid.mute') === '1'; } catch (e) {}
  const gap = { shoot: 55, laser: 55, lock: 70, blast: 100, missile: 80, eshoot: 90, eshoot2: 100, graze: 70, heal: 200, spiral: 80, dash: 150, boom: 45, pop: 40, hit: 60, bigboom: 120,
    snipe: 100, mineDrop: 100, mineBeep: 120, minePop: 60, shieldHit: 60, shieldBreak: 120, emissile: 140 };

  let unlocked = false, silentEl = null;
  function silentWav() {   // 0.25 秒静音 WAV：在 iPhone 上循环播放它，可以让网页音效不受侧边静音开关影响
    const n = 2000, b = new Uint8Array(44 + n), dv = new DataView(b.buffer), w = (o, t) => { for (let i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true); w(36, 'data'); dv.setUint32(40, n, true);
    b.fill(128, 44);
    let t = ''; for (let i = 0; i < b.length; i++) t += String.fromCharCode(b[i]);
    return 'data:audio/wav;base64,' + btoa(t);
  }
  function unlock() {   // 每次触摸 / 点击 / 按键都调用：创建并恢复音频上下文（手机浏览器要求由用户手势启动声音）
    init(); if (!ac) return;
    try { if (ac.state !== 'running') { const pr = ac.resume(); if (pr && pr.catch) pr.catch(() => {}); } } catch (e) {}
    if (unlocked) { if (silentEl && silentEl.paused && !muted) { const pr = silentEl.play(); if (pr && pr.catch) pr.catch(() => {}); } return; }
    unlocked = true;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    try { const src = ac.createBufferSource(); src.buffer = ac.createBuffer(1, 1, 22050); src.connect(ac.destination); src.start(0); } catch (e) {}
    try {
      if (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
        silentEl = new Audio(silentWav()); silentEl.loop = true; silentEl.setAttribute('playsinline', ''); silentEl.volume = .01;
        const pr = silentEl.play(); if (pr && pr.catch) pr.catch(() => {});
      }
    } catch (e) {}
  }
  ['pointerdown', 'touchend', 'click', 'keydown'].forEach(n => document.addEventListener(n, unlock, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => { try { if (document.hidden) { if (silentEl) silentEl.pause(); } else if (ac && ac.state !== 'running') ac.resume(); } catch (e) {} });
  function init() {
    if (ac) { if (ac.state !== 'running') { try { const pr = ac.resume(); if (pr && pr.catch) pr.catch(() => {}); } catch (e) {} } return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain(); master.gain.value = 1.3;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400; lp.Q.value = .5;   // 总输出再过一道低通，整体更圆润
      const comp = ac.createDynamicsCompressor(); master.connect(lp); lp.connect(comp); comp.connect(ac.destination);   // 提高整体音量，用压缩器防止爆音
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ac = null; }
  }
  function tone(f0, f1, dur, type, vol, delay) {
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    // 柔和音色：方波 / 锯齿波一律换成三角波，并把高频压到约 1000Hz 以内（越高压得越多），起音也放缓
    o.type = type === 'sine' ? 'sine' : 'triangle';
    const soft = f => f <= 440 ? f : 440 + (f - 440) * .3;
    f0 = soft(f0); f1 = soft(f1);
    if (type === 'square' || type === 'sawtooth') vol *= 1.5;   // 三角波比原来的波形轻，补一点音量
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.025, dur * .4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, vol, f0, f1, delay) {
    const t = ac.currentTime + (delay || 0);
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = 'lowpass';
    f0 = Math.min(f0, 1800); f1 = Math.min(f1, 1800);   // 噪声也去掉刺耳的高频
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.03);
  }
  const defs = {
    shoot:   () => tone(900, 360, 0.07, 'square', 0.03),
    laser:   () => tone(1700, 800, 0.06, 'sawtooth', 0.022),
    lock:    () => tone(520, 980, 0.08, 'triangle', 0.05),
    blast:   () => { tone(220, 80, 0.16, 'square', 0.05); noise(0.12, 0.08, 1500, 200); },
    missile: () => { noise(0.14, 0.07, 3000, 500); tone(280, 720, 0.12, 'sawtooth', 0.025); },
    eshoot:  () => tone(320, 150, 0.1, 'sawtooth', 0.028),
    graze:   () => tone(2300, 2700, 0.03, 'sine', 0.03),                                              // 擦弹
    heal:    () => tone(700, 1150, 0.16, 'sine', 0.05),                                              // 修复机
    perk:    () => { [660, 880, 1175, 1568].forEach((f, i) => tone(f, f, 0.14, 'triangle', 0.08, i * 0.07)); },   // 获得强化
    zone:    () => { tone(392, 392, 0.2, 'triangle', 0.07); tone(523, 523, 0.2, 'triangle', 0.07, 0.16); tone(784, 784, 0.34, 'triangle', 0.07, 0.32); },   // 进入新星区
    cloak:   () => tone(900, 180, 0.3, 'sine', 0.06),                                                // 隐形机隐身
    decloak: () => { tone(200, 1000, 0.22, 'sine', 0.07); tone(400, 1500, 0.18, 'triangle', 0.03); },   // 现身
    spiral:  () => tone(760, 520, 0.05, 'triangle', 0.03),                                           // 旋涡弹幕
    dash:    () => { noise(0.45, 0.2, 500, 3800); tone(140, 620, 0.4, 'sawtooth', 0.07); },          // 冲锋
    split:   () => { tone(500, 900, 0.1, 'square', 0.05); tone(500, 300, 0.1, 'square', 0.05, 0.05); },   // 分裂
    alarm:   () => { tone(880, 880, 0.1, 'square', 0.05); tone(660, 660, 0.12, 'square', 0.05, 0.14); },   // 敌方增援
    eshoot2: () => tone(210, 90, 0.14, 'sawtooth', 0.035),                                          // 炮艇：低沉
    pop:     () => { noise(0.14, 0.14, 2600, 300); tone(320, 110, 0.12, 'sine', 0.1); },            // 小型敌机爆炸：清脆
    snipeCharge: () => { tone(260, 1900, 0.95, 'triangle', 0.045); tone(262, 1910, 0.95, 'sine', 0.03); },   // 狙击机蓄力：音调上扬
    snipe:   () => { noise(0.14, 0.22, 5200, 500); tone(1500, 220, 0.16, 'sawtooth', 0.09); },     // 狙击枪响
    mineDrop:() => tone(520, 300, 0.09, 'square', 0.04),
    mineBeep:() => tone(1300, 1300, 0.05, 'square', 0.035),                                         // 水雷即将引爆的滴声
    minePop: () => { noise(0.26, 0.2, 2200, 160); tone(190, 60, 0.22, 'sine', 0.14); },
    shieldHit:   () => tone(1900, 1300, 0.08, 'triangle', 0.05),                                    // 护盾被击中：金属叮声
    shieldBreak: () => { noise(0.32, 0.18, 6500, 800); tone(1500, 180, 0.28, 'sawtooth', 0.08); },   // 护盾破碎
    emissile:    () => { noise(0.3, 0.09, 2800, 300); tone(230, 540, 0.3, 'sawtooth', 0.03); },      // 敌方导弹发射
    beamCharge:  () => { tone(110, 950, 1.2, 'sawtooth', 0.05); tone(113, 960, 1.2, 'triangle', 0.04); },   // 激光舰蓄能
    beam:        () => { noise(0.75, 0.12, 3200, 400); tone(120, 90, 0.75, 'sawtooth', 0.08); tone(480, 380, 0.75, 'square', 0.02); },
    boom:    () => { noise(0.3, 0.22, 1800, 100); tone(130, 40, 0.28, 'sine', 0.18); },
    bigboom: () => { noise(0.8, 0.34, 2400, 60); tone(90, 28, 0.7, 'sine', 0.3); },
    hit:     () => tone(260, 120, 0.06, 'square', 0.03),
    hurt:    () => { tone(240, 50, 0.35, 'sawtooth', 0.13); noise(0.2, 0.18, 1400, 160); },
    pickup:  () => { tone(660, 660, 0.09, 'triangle', 0.08); tone(880, 880, 0.09, 'triangle', 0.08, 0.07); tone(1175, 1175, 0.14, 'triangle', 0.08, 0.14); },
    shield:  () => tone(300, 950, 0.25, 'sine', 0.1),
    nova:    () => { noise(0.7, 0.3, 4200, 200); tone(180, 1300, 0.55, 'sawtooth', 0.07); },
    deny:    () => tone(190, 130, 0.14, 'square', 0.05),
    lock:    () => { tone(600, 900, 0.08, 'triangle', 0.09); tone(900, 1300, 0.1, 'triangle', 0.09, 0.08); },
    unlock:  () => { tone(1100, 700, 0.08, 'triangle', 0.08); tone(700, 450, 0.1, 'triangle', 0.08, 0.08); },
    soul:    () => { tone(520, 90, 1.1, 'sine', 0.17); tone(530, 95, 1.1, 'sine', 0.1); noise(0.5, 0.1, 3000, 200); },
    possess: () => { tone(200, 950, 0.5, 'sine', 0.16); tone(420, 1900, 0.4, 'triangle', 0.07); noise(0.3, 0.1, 3200, 500); },
    revive:  () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.18, 'triangle', 0.09, i * 0.08)); },
    wave:    () => { tone(523, 523, 0.12, 'triangle', 0.07); tone(784, 784, 0.2, 'triangle', 0.07, 0.1); },
    boss:    () => { tone(110, 70, 0.9, 'sawtooth', 0.12); tone(112, 72, 0.9, 'sawtooth', 0.08); },
    over:    () => { tone(440, 90, 1.3, 'sawtooth', 0.11); noise(0.6, 0.15, 1200, 80); },
    click:   () => tone(720, 720, 0.04, 'square', 0.03)
  };
  return {
    init,
    play(n) {
      if (!ac || muted) return;
      const now = performance.now();
      if (now - (last[n] || 0) < (gap[n] || 0)) return;
      last[n] = now;
      try { defs[n] && defs[n](); } catch (e) {}
    },
    raw(n) { defs[n](); },   // 调试：不吞异常地播放一个音效
    get muted() { return muted; }, get state() { return ac ? ac.state : 'none'; },
    toggle() { muted = !muted; try { localStorage.setItem('starraid.mute', muted ? '1' : '0'); } catch (e) {} return muted; }
  };
})();
const vibrate = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

/* =====================================================================
 *  高分榜（localStorage，失败时退化为内存）
 * ===================================================================== */
const SC_KEY = 'starraid.scores.v1';
let scores = [];
try {
  const a = JSON.parse(localStorage.getItem(SC_KEY) || '[]');
  if (Array.isArray(a)) scores = a.filter(x => x && typeof x.s === 'number' && typeof x.w === 'number').slice(0, 10);
} catch (e) {}
const saveScores = () => { try { localStorage.setItem(SC_KEY, JSON.stringify(scores)); } catch (e) {} };
const bestScore = () => scores.length ? scores[0].s : 0;
// 难度档位：开始游戏前在主菜单选择
const DIFFS = {
  easy:   { name: '简单', hp: .7,  spd: .78, ivl: 1.45, groups: -1, boss: .5,  bossRate: .85, drop: 1.5, pity: 7,  lives: 5, inv: 2.0, scout2: 99, note: '5 条命 · 敌机更脆、子弹更慢 · 掉落更多' },
  normal: { name: '中等', hp: .85, spd: .9,  ivl: 1.2,  groups: 0,  boss: .72, bossRate: 1.05, drop: 1.2, pity: 9,  lives: 4, inv: 1.7, scout2: 9,  note: '4 条命 · 标准强度' },
  hard:   { name: '困难', hp: 1,   spd: 1,   ivl: 1,    groups: 1,  boss: 1,   bossRate: 1.25, drop: 1,   pity: 11, lives: 3, inv: 1.4, scout2: 6,  note: '3 条命 · 敌机更多更硬、子弹更快' }
};
let diffKey = 'normal';
try { const k = localStorage.getItem('starraid.diff'); if (DIFFS[k]) diffKey = k; } catch (e) {}
let D = DIFFS[diffKey];
function setDiff(k) {
  if (!DIFFS[k]) return;
  diffKey = k; D = DIFFS[k];
  try { localStorage.setItem('starraid.diff', k); } catch (e) {}
  document.querySelectorAll('.diff button').forEach(b => b.classList.toggle('on', b.dataset.d === k));
  document.querySelectorAll('.diffnote').forEach(el => { el.textContent = D.note; });
}
function submitScore(s, w, cleared) {
  if (s <= 0) return { entry: null, rank: -1 };
  const entry = { s, w, d: Date.now(), df: diffKey, st: stageOf(w) + 1, c: cleared ? 1 : 0 };
  scores.push(entry);
  scores.sort((a, b) => b.s - a.s || a.d - b.d);
  scores = scores.slice(0, 10);
  saveScores();
  return { entry, rank: scores.indexOf(entry) };
}
const pad2 = n => String(n).padStart(2, '0');
function fmtDate(t) { const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function renderScores(el, limit, hl) {
  el.innerHTML = '';
  if (!scores.length) { el.innerHTML = '<li class="empty">还没有记录，快去挑战吧！</li>'; return; }
  scores.slice(0, limit).forEach((e, i) => {
    const li = document.createElement('li');
    if (e === hl) li.className = 'me';
    li.innerHTML = '<b>' + (i + 1) + '</b><span class="sc">' + e.s + '</span><span class="wv">' + (DIFFS[e.df] ? DIFFS[e.df].name + ' ' : '') + (e.c ? '通关' : e.st ? '第' + e.st + '关' : '第' + e.w + '波') + '</span><span class="dt">' + fmtDate(e.d) + '</span>';
    el.appendChild(li);
  });
}


/* =====================================================================
 *  程序化精灵（预渲染，运行时只做 drawImage）
 * ===================================================================== */
const SS = 3;
function mk(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * SS); c.height = Math.ceil(h * SS);
  const g = c.getContext('2d');
  g.scale(SS, SS); g.translate(w / 2, h / 2);
  fn(g);
  return { c, w, h };
}
function mirror(r) { const o = r.slice(); for (let i = r.length - 1; i >= 0; i--) o.push([-r[i][0], r[i][1]]); return o; }
function poly(g, pts) { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); }
function vgrad(g, y0, y1, c0, c1, c2) {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, c0); if (c2) gr.addColorStop(.5, c2); gr.addColorStop(1, c1); return gr;
}
function fillStroke(g, pts, fill, stroke, lw) {
  if (stroke) { poly(g, pts); g.strokeStyle = 'rgba(2,4,18,.6)'; g.lineWidth = (lw || 1) + 2.2; g.lineJoin = 'round'; g.stroke(); }   // 深色外描边，提高辨识度
  poly(g, pts); g.fillStyle = fill; g.fill();
  if (typeof fill === 'object') {   // 渐变填充的机体：左亮右暗，做出立体感
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const q of pts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
    g.save(); poly(g, pts); g.clip();
    const lg = g.createLinearGradient(x0, 0, x1, 0);
    lg.addColorStop(0, 'rgba(255,255,255,.3)'); lg.addColorStop(.42, 'rgba(255,255,255,0)'); lg.addColorStop(.58, 'rgba(0,0,12,0)'); lg.addColorStop(1, 'rgba(0,0,12,.42)');
    g.fillStyle = lg; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.restore();
  }
  if (stroke) { poly(g, pts); g.strokeStyle = stroke; g.lineWidth = lw || 1; g.lineJoin = 'round'; g.stroke(); }
}
function rrp(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function heartPath(g, x, y, s) {
  g.beginPath(); g.moveTo(x, y + s * .95);
  g.bezierCurveTo(x - s * 1.6, y - s * .1, x - s * .95, y - s * 1.35, x, y - s * .45);
  g.bezierCurveTo(x + s * .95, y - s * 1.35, x + s * 1.6, y - s * .1, x, y + s * .95);
  g.closePath();
}

const glowCache = {};
function glow(rgb) {
  if (glowCache[rgb]) return glowCache[rgb];
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(' + rgb + ',1)'); gr.addColorStop(.25, 'rgba(' + rgb + ',.55)');
  gr.addColorStop(.6, 'rgba(' + rgb + ',.12)'); gr.addColorStop(1, 'rgba(' + rgb + ',0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return glowCache[rgb] = c;
}

function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

const BOSSES = [
  { name: '赤焰主宰', rgb: '255,80,150', hp: 1 },
  { name: '虚空织网者', rgb: '190,110,255', hp: 1.1 },
  { name: '蜂巢母舰', rgb: '200,240,90', hp: 1.2 },
  { name: '裂空者', rgb: '110,220,255', hp: 1.05 }
];

BOSSES.push(
  { name: '陆行堡垒', rgb: '255,190,90', hp: 1.3, ground: true },
  { name: '极寒守卫', rgb: '150,220,255', hp: 1.05 },
  { name: '熔岩炎龙', rgb: '255,120,50', hp: 1.5 },
  { name: '雷霆战舰', rgb: '255,225,110', hp: 1.25 },
  { name: '晶簇女王', rgb: '120,240,255', hp: 1.15 },
  { name: '沙海巨蝎', rgb: '255,170,90',  hp: 1.3, ground: true },
  { name: '深海巨章', rgb: '200,120,255', hp: 1.35 },
  { name: '极光巨鲸', rgb: '120,255,200', hp: 1.4 },
  { name: '齿轮巨像', rgb: '255,190,80',  hp: 1.4 },
  { name: '日月双子', rgb: '255,220,120', hp: 1.3 },
  { name: '果冻王',   rgb: '120,255,160', hp: 1.25 },
  { name: '镜面魔方', rgb: '90,230,255',  hp: 1.35 },
  { name: '轨道炮台', rgb: '255,120,90',  hp: 1.4 },
  { name: '黑洞核心', rgb: '190,120,255', hp: 1.45 },
  { name: '幽灵舰长', rgb: '150,255,220', hp: 1.3, fade: true },
  { name: '星际霸主', rgb: '255,90,90',   hp: 1.7, rageAt: .34, rageTxt: '最终形态！' }
);

const PU = {
  multi:  { rgb: '90,200,255',  col: '#5ac8ff', name: '标准弹' },
  laser:  { rgb: '255,110,255', col: '#ff78ff', name: '激光弹' },
  lock:   { rgb: '110,255,160', col: '#6effa0', name: '锁定弹' },
  blast:  { rgb: '255,160,70',  col: '#ffa046', name: '爆破弹' },
  pod:    { rgb: '170,225,255', col: '#aae1ff', name: '跟踪导弹' },
  shield: { rgb: '90,255,160',  col: '#5aff9e', name: '护盾' },
  speed:  { rgb: '255,215,80',  col: '#ffd750', name: '速度提升' },
  life:   { rgb: '255,100,140', col: '#ff6490', name: '生命 +1' }
};
// 弹种：每种弹各自记录等级（P.wl），切换/拾取其他弹种不会改动其余弹种的等级
const WT = {
  normal: { name: '标准弹', short: '标', rgb: '90,200,255',  col: '#5ac8ff' },
  laser:  { name: '激光弹', short: '激', rgb: '255,110,255', col: '#ff78ff' },
  lock:   { name: '锁定弹', short: '锁', rgb: '110,255,160', col: '#6effa0' },
  blast:  { name: '爆破弹', short: '爆', rgb: '255,160,70',  col: '#ffa046' }
};
const WORDER = ['normal', 'laser', 'lock', 'blast'];
const WPU = { multi: 'normal', laser: 'laser', lock: 'lock', blast: 'blast' };   // 道具 -> 弹种
function puIcon(g, kind, col) {
  g.fillStyle = col; g.strokeStyle = col; g.lineWidth = 1.8; g.lineJoin = 'round'; g.lineCap = 'round';
  if (kind === 'multi') {
    [-5.5, 0, 5.5].forEach((x, i) => { g.save(); g.rotate((i - 1) * .32); g.beginPath(); g.moveTo(x * .6, 6); g.lineTo(x * .6, -7); g.stroke(); g.restore(); });
    g.beginPath(); g.arc(0, 7.5, 1.6, 0, TAU); g.fill();
  } else if (kind === 'shield') {
    g.beginPath(); g.moveTo(0, -8); g.lineTo(7, -5); g.lineTo(6.2, 2); g.quadraticCurveTo(4, 7, 0, 9); g.quadraticCurveTo(-4, 7, -6.2, 2); g.lineTo(-7, -5); g.closePath(); g.stroke();
    g.globalAlpha = .45; g.fill(); g.globalAlpha = 1;
  } else if (kind === 'speed') {
    g.beginPath(); g.moveTo(2.5, -9); g.lineTo(-5, 1.5); g.lineTo(-.5, 1.5); g.lineTo(-2.5, 9); g.lineTo(5.5, -2); g.lineTo(.8, -2); g.closePath(); g.fill();
  } else if (kind === 'laser') {
    g.lineWidth = 3; g.beginPath(); g.moveTo(0, -9); g.lineTo(0, 9); g.stroke();
    g.lineWidth = 1.4; g.beginPath(); g.moveTo(-5, -3); g.lineTo(-5, 5); g.moveTo(5, -3); g.lineTo(5, 5); g.stroke();
    g.beginPath(); g.arc(0, -9.5, 1.8, 0, TAU); g.fill();
  } else if (kind === 'lock') {
    g.lineWidth = 1.6; g.beginPath(); g.arc(0, 0, 5.3, 0, TAU); g.stroke();
    g.beginPath(); g.moveTo(0, -9); g.lineTo(0, -3.5); g.moveTo(0, 9); g.lineTo(0, 3.5); g.moveTo(-9, 0); g.lineTo(-3.5, 0); g.moveTo(9, 0); g.lineTo(3.5, 0); g.stroke();
    g.beginPath(); g.arc(0, 0, 1.6, 0, TAU); g.fill();
  } else if (kind === 'blast') {
    g.beginPath(); for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8 - Math.PI / 2, r = i % 2 ? 4.3 : 9; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill();
  } else if (kind === 'pod') {
    [-1, 1].forEach(sd => { g.save(); g.translate(sd * 4.6, 0); g.rotate(sd * .22); g.lineWidth = 3; g.beginPath(); g.moveTo(0, 7); g.lineTo(0, -4); g.stroke();
      g.beginPath(); g.moveTo(0, -9); g.lineTo(2.4, -4); g.lineTo(-2.4, -4); g.closePath(); g.fill(); g.restore(); });
  } else { heartPath(g, 0, 0, 6.2); g.fill(); }
}
const sprPU = {};
Object.keys(PU).forEach(k => {
  sprPU[k] = mk(40, 40, g => {
    g.drawImage(glow(PU[k].rgb), -20, -20, 40, 40);
    g.beginPath(); g.arc(0, 0, 13, 0, TAU); g.fillStyle = 'rgba(8,14,40,.88)'; g.fill();
    g.lineWidth = 2; g.strokeStyle = PU[k].col; g.stroke();
    puIcon(g, k, PU[k].col);
  });
});


const STAGES = [   // 20 关：场景各不相同，每关一个 Boss
  { name: '雪原冰川', ground: 'snow',     boss: 5 },
  { name: '樱花山谷', ground: 'sakura',   boss: 0 },
  { name: '黄沙戈壁', ground: 'desert',   boss: 4 },
  { name: '碧海群岛', ground: 'ocean',    boss: 7 },
  { name: '糖果乐园', ground: 'candy',    boss: 14 },
  { name: '翡翠丛林', ground: 'jungle',   boss: 2 },
  { name: '赤霞峡谷', ground: 'canyon',   boss: 9 },
  { name: '水晶洞窟', ground: 'crystal',  boss: 8 },
  { name: '熔岩火山', ground: 'lava',     boss: 6 },
  { name: '极光冰海', ground: 'aurora',   boss: 11 },
  { name: '幽灵沼泽', ground: 'swamp',    boss: 18 },
  { name: '深海遗迹', ground: 'undersea', boss: 10 },
  { name: '云端天城', ground: 'cloud',    boss: 13 },
  { name: '霓虹都市', ground: 'city',     boss: 3 },
  { name: '钢铁工厂', ground: 'factory',  boss: 12 },
  { name: '赛博网格', ground: 'cyber',    boss: 15 },
  { name: '月面基地', ground: 'moon',     boss: 16 },
  { name: '深空轨道', ground: null, sp: 'space', boss: 1 },
  { name: '虚空裂隙', ground: null, sp: 'void',  boss: 17 },
  { name: '霸主旗舰', ground: 'flagship', boss: 19 }
];
const WPS = 3, NSTAGE = STAGES.length;   // 每关 3 波：2 波敌人 + 1 波 Boss
const stageOf = n => Math.min(NSTAGE - 1, Math.floor(Math.max(0, n - 1) / WPS));
const isBossWave = n => n > 0 && n % WPS === 0;
// 难度等级：由关卡进度换算（从 1 逐步升到 26），敌机登场、血量、弹速都按它计算
function levelOf(n) { const st = stageOf(n), j = (Math.max(1, n) - 1) % WPS; return isBossWave(n) ? Math.round(2 + st * 1.25) : 1 + Math.floor((st * 2 + j) * 25 / 39); }
let DL = 1;

const ET = [  // 敌机类型（sfx：被击毁时的爆炸音效）
  { name: '侦察机', r: 12, hp: 1,   score: 10,   rgb: '255,110,140', sfx: 'pop' },
  { name: '战斗机', r: 15, hp: 2,   score: 25,   rgb: '255,170,70',  sfx: 'boom' },
  { name: '炮艇',   r: 22, hp: 7,   score: 70,   rgb: '200,130,255', sfx: 'bigboom' },
  { name: '俯冲镖', r: 12, hp: 2,   score: 35,   rgb: '110,255,200', sfx: 'pop' },
  { name: 'BOSS',   r: 46, hp: 100, score: 1000, rgb: '255,70,140',  sfx: 'bigboom' },
  { name: '狙击机', r: 14, hp: 3,   score: 45,   rgb: '255,80,80',   sfx: 'pop' },      // 蓄力瞄准，红线预警后射出高速弹
  { name: '布雷机', r: 19, hp: 5,   score: 55,   rgb: '255,205,60',  sfx: 'boom' },     // 横穿屏幕投放水雷，延时爆裂
  { name: '护盾舰', r: 20, hp: 5,   score: 65,   rgb: '80,210,255',  sfx: 'boom' },     // 先要打破护盾
  { name: '导弹艇', r: 18, hp: 4,   score: 60,   rgb: '200,255,80',  sfx: 'boom' },     // 发射可被击落的追踪导弹
  { name: '激光舰', r: 24, hp: 9,   score: 90,   rgb: '255,100,190', sfx: 'bigboom' },  // 红线预警后喷出竖直光束
  { name: '分裂机', r: 17, hp: 4,   score: 50,   rgb: '255,140,220', sfx: 'boom' },     // 被击毁后分裂成两架侦察机
  { name: '隐形机', r: 15, hp: 4,   score: 70,   rgb: '150,160,255', sfx: 'pop' },      // 隐身时无法被锁定和命中，现身时扇形齐射
  { name: '旋涡机', r: 20, hp: 8,   score: 85,   rgb: '255,150,60',  sfx: 'bigboom' },  // 喷出旋转的螺旋弹幕
  { name: '冲锋舰', r: 20, hp: 7,   score: 75,   rgb: '255,90,60',   sfx: 'boom' },     // 红线预警后横向高速冲撞
  { name: '修复机', r: 15, hp: 4,   score: 60,   rgb: '120,255,170', sfx: 'pop' },      // 用光束修复附近受损的敌机，应优先击落
  { name: '蜂群机', r: 8,  hp: 1,   score: 8,    rgb: '255,230,90',  sfx: 'pop' },      // 成群追踪玩家的小型自杀机
  { name: '引力机', r: 21, hp: 8,   score: 90,   rgb: '170,110,255', sfx: 'bigboom' },  // 把玩家拉向自己，并发射缓慢的重力弹
  { name: '浮游炮台', r: 16, hp: 6, score: 55,   rgb: '255,200,120', sfx: 'boom' },     // 旋转着向四个方向开火
  { name: '陨石',   r: 20, hp: 6,   score: 15,   rgb: '255,180,90',  sfx: 'boom' },     // 可击碎的障碍，碎成两块小陨石
  // 地面单位：随地面靠近，可以被击毁，但不会和飞机相撞，也不能夺舍
  { name: '小炮台', r: 13, hp: 4,   score: 30,   rgb: '255,210,120', sfx: 'boom', ground: true },      // 固定炮台，瞄准射击
  { name: '坦克',   r: 16, hp: 8,   score: 60,   rgb: '170,220,120', sfx: 'bigboom', ground: true },   // 横向机动，发射重型炮弹（海上是炮艇）
  { name: '导弹车', r: 15, hp: 5,   score: 55,   rgb: '255,150,90',  sfx: 'boom', ground: true },      // 发射可被击落的追踪导弹
  { name: '高射炮', r: 15, hp: 6,   score: 60,   rgb: '255,230,140', sfx: 'boom', ground: true },      // 炮弹飞到你所在的位置后炸成一圈破片
  { name: '电磁塔', r: 14, hp: 7,   score: 65,   rgb: '140,200,255', sfx: 'boom', ground: true },      // 蓄能后向四周放出一圈电弧弹
  { name: '运输机', r: 24, hp: 10,  score: 120,  rgb: '255,220,120', sfx: 'bigboom' },                 // 不开火，横穿屏幕逃跑；击落必掉两个道具
  { name: '无人机母舰', r: 23, hp: 9, score: 95, rgb: '120,235,200', sfx: 'bigboom' },                 // 不断放出蜂群机
  { name: '闪电机', r: 15, hp: 4,   score: 75,   rgb: '255,240,120', sfx: 'pop' }                      // 瞬移到新位置后三连射
];
// 夺舍后继承的敌机技能（射速远高于玩家基础的 0.17s/发）
const SKILL = [
  { name: '疾速连射', interval: .085, shots: 1, spread: 0,   dmg: 1, speed: 700, move: 1.15, hp: 3, pierce: 0, rgb: '255,120,150', br: 4 },
  { name: '双联速射', interval: .115, shots: 2, spread: 0,   dmg: 1, speed: 680, move: 1.0,  hp: 4, pierce: 0, rgb: '255,185,90',  br: 4 },
  { name: '重型散射', interval: .16,  shots: 3, spread: .2,  dmg: 2, speed: 620, move: .82,  hp: 8, pierce: 0, rgb: '210,150,255', br: 6 },
  { name: '穿刺光矢', interval: .1,   shots: 1, spread: 0,   dmg: 1, speed: 880, move: 1.1,  hp: 4, pierce: 2, rgb: '120,255,210', br: 4 },
  null,   // 4 BOSS 无法夺舍
  { name: '穿甲速射', interval: .12, shots: 1, spread: 0,   dmg: 1.5, speed: 900, move: 1.05, hp: 4, pierce: 1, rgb: '255,100,100', br: 4 },
  { name: '四联散射', interval: .14, shots: 4, spread: .14, dmg: 1,   speed: 600, move: .9,   hp: 6, pierce: 0, rgb: '255,215,90',  br: 4 },
  { name: '护盾连射', interval: .13, shots: 1, spread: 0,   dmg: 2,   speed: 700, move: .95,  hp: 6, pierce: 0, rgb: '110,220,255', br: 5, shield: 6 },
  { name: '追踪导弹', interval: .2,  shots: 2, spread: 0,   dmg: 2,   speed: 0,   move: .95,  hp: 5, pierce: 0, rgb: '255,170,90',  br: 4, kind: 'missile' },
  { name: '激光连射', interval: .08, shots: 1, spread: 0,   dmg: .55, speed: 1500, move: .85, hp: 9, pierce: 0, rgb: '255,110,255', br: 3, kind: 'laser' },
  { name: '分裂三连', interval: .13, shots: 3, spread: .16, dmg: 1,   speed: 640, move: 1.0,  hp: 5, pierce: 0, rgb: '255,150,225', br: 4 },
  { name: '相位穿刺', interval: .11, shots: 1, spread: 0,   dmg: 1.2, speed: 900, move: 1.15, hp: 4, pierce: 3, rgb: '170,180,255', br: 4 },
  { name: '旋涡弹幕', interval: .12, shots: 5, spread: .22, dmg: 1,   speed: 560, move: .85,  hp: 8, pierce: 0, rgb: '255,170,80',  br: 4 },
  { name: '冲锋重炮', interval: .2,  shots: 2, spread: 0,   dmg: 3,   speed: 620, move: 1.2,  hp: 8, pierce: 0, rgb: '255,110,80',  br: 6 },
  { name: '修复速射', interval: .11, shots: 2, spread: 0,   dmg: 1,   speed: 680, move: 1.0,  hp: 5, pierce: 0, rgb: '140,255,190', br: 4, regen: 3 },      // 每 3 秒自动修复 1 点
  { name: '蜂刺连射', interval: .065, shots: 1, spread: 0,  dmg: .7,  speed: 760, move: 1.3,  hp: 2, pierce: 0, rgb: '255,235,110', br: 3.5 },
  { name: '引力重弹', interval: .2,  shots: 1, spread: 0,   dmg: 3.5, speed: 520, move: .85,  hp: 8, pierce: 3, rgb: '190,140,255', br: 7, magnet: true },  // 道具吸附范围加倍
  { name: '十字弹幕', interval: .13, shots: 4, spread: .3,  dmg: 1,   speed: 600, move: .95,  hp: 6, pierce: 0, rgb: '255,210,140', br: 4 },
  null, null, null, null, null, null,   // 18 陨石和 19-23 地面单位无法夺舍
  { name: '货舱机炮', interval: .1,  shots: 2, spread: .07, dmg: 1.3, speed: 700, move: .9,   hp: 12, pierce: 0, rgb: '255,225,130', br: 4.5, magnet: true },
  { name: '蜂群导弹', interval: .16, shots: 2, spread: 0,   dmg: 1.8, speed: 0,   move: .9,   hp: 9,  pierce: 0, rgb: '140,240,205', br: 4, kind: 'missile' },
  { name: '闪电连射', interval: .075, shots: 1, spread: 0,  dmg: 1,   speed: 950, move: 1.3,  hp: 4,  pierce: 1, rgb: '255,240,130', br: 4 }
];

const PLAYER_RGB = '120,225,255';
const SHOTS = {  // [枪口偏移 x, 偏转角度(度)]
  1: [[0, 0]],
  2: [[-7, 0], [7, 0]],
  3: [[0, 0], [-10, -9], [10, 9]],
  4: [[-5, -4], [5, 4], [-11, -14], [11, 14]],
  5: [[0, 0], [-7, -8], [7, 8], [-13, -18], [13, 18]]
};
// 各弹种 1~5 级参数
const LASER = { beams: [[0], [0], [-6, 6], [-9, 0, 9], [-12, -4, 4, 12]], dmg: [.45, .7, .6, .6, .62], r: [3, 4, 3.5, 3.5, 4], iv: .07 };   // 穿透全部敌机
const LOCKW = { n: [1, 2, 3, 3, 4], dmg: [.9, .9, .9, 1.1, 1.1], turn: [8, 8.5, 9, 9.5, 10], iv: .3 };                                                                // 自动锁定不同目标
const BLAST = { shells: [1, 1, 2, 2, 3], radius: [44, 52, 60, 68, 76], dmg: [3, 4, 3.5, 4.5, 5], iv: .36 };                                   // 命中后范围爆炸
const POD = { iv: [1.1, .85, .62], dmg: [2, 2, 3] };                                                                                      // 导弹吊舱 1~3 级
const BASE_SPEED = 290, LOCK_MS = 480, MAX_LIVES = 5;

/* ---- 状态 ---- */
let state = 'menu';                      // menu | playing | paused | over
let score = 0, wave = 0, kills = 0, gameTime = 0, pity = 0, deaths = 0;
let vicT = 0, vicShown = false, vicRes = null, vicFw = 0, vicBonus = 0;   // 通关动画
let waveState = 'pause', waveT = 0, waveTime = 0, queue = [];
let resumeT = 0, shake = 0, hurtFlash = 0, whiteFlash = 0, banner = null, scoresFrom = 'menu';
let combo = 0, comboT = 0, bestCombo = 0, grazes = 0, seenElite = false;
const comboMul = () => 1 + Math.min(combo, 50) * .04;   // 连击得分倍率，最高 ×3
let hazards = [];   // Boss 光束等带预警的危险区
// 强化：每击败一个 Boss 三选一，本局有效
const PERKS = [
  { id: 'dmg',    name: '穿甲弹芯', desc: '所有伤害 +15%',            max: 4, rgb: '255,120,90' },
  { id: 'rate',   name: '速射机构', desc: '射速 +12%',                max: 4, rgb: '255,215,80' },
  { id: 'energy', name: '聚气加速', desc: 'B 键技能聚气速度 +16%（满级约 18 秒一次）', max: 4, rgb: '110,220,255' },
  { id: 'nova',   name: '星爆护体', desc: '星爆后的无敌时间 +1 秒（基础 3 秒）', max: 3, rgb: '255,235,140' },
  { id: 'speed',  name: '矢量引擎', desc: '移动速度 +8%',             max: 3, rgb: '140,255,200' },
  { id: 'luck',   name: '幸运星',   desc: '道具掉落 +30%',            max: 3, rgb: '255,180,230' },
  { id: 'magnet', name: '磁力场',   desc: '道具吸附范围 +80%',        max: 2, rgb: '190,150,255' },
  { id: 'guard',  name: '应急护盾', desc: '每波开始获得 4 秒护盾',    max: 2, rgb: '90,255,160' },
  { id: 'keep',   name: '黑匣子',   desc: '死亡时保留一半弹种等级',   max: 1, rgb: '200,210,230' },
  { id: 'soul',   name: '灵魂共鸣', desc: '夺舍机体生命 +2，离体魂能消耗 -8', max: 2, rgb: '143,240,255' },
  { id: 'life',   name: '紧急维修', desc: '立即恢复 1 条生命（灵魂状态则恢复魂能）', max: 99, rgb: '255,100,140' }
];
let perks = {}, perkChoices = [];
const pk = id => perks[id] || 0;
let seenTypes = {};   // 本局已见过的特殊敌机（首次出现时提示名称）
let bullets = [], ebullets = [], enemies = [], powerups = [], particles = [], rings = [], popups = [], novas = [], later = [];
const P = {
  x: W / 2, y: 500, vx: 0, vy: 0, tilt: 0, mode: 'ship',   // ship | soul | possessed | dead
  lives: 3, wt: 'normal', wl: { normal: 1, laser: 0, lock: 0, blast: 0 }, pod: 0, podX: [0, 0], podY: [0, 0], podCd: [0, .5],
  extra: 0, shield: 0, speedT: 0, inv: 0, star: 0, fireCd: 0, energy: 0, od: 0,
  ghost: null, soulE: 100, muz: 0, muzList: SHOTS[1], muzSpr: null, trailT: 0, wispT: 0
};

/* =====================================================================
 *  输入：方向圆盘 / A 射击(长按锁定) / B 技能 / 键盘
 * ===================================================================== */
const input = { jx: 0, jy: 0, aDown: false, aLock: false, aIgnore: false, aPressT: 0, aTimer: 0, kx: 0, ky: 0, kFire: false };
let joyId = null, aId = null, bId = null;

function updateJoy(e) {
  const r = knobEl.parentElement.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const R = r.width * 0.5 * 0.55;
  let dx = e.clientX - cx, dy = e.clientY - cy;
  const m = Math.hypot(dx, dy);
  if (m > R) { dx = dx / m * R; dy = dy / m * R; }
  knobEl.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
  let nx = dx / R, ny = dy / R;
  const mag = Math.hypot(nx, ny), dead = .1;
  if (mag < dead) { nx = ny = 0; }
  else { const k = (mag - dead) / (1 - dead) / mag; nx *= k; ny *= k; }
  input.jx = nx; input.jy = ny;
}
function releaseJoy() {
  joyId = null; input.jx = input.jy = 0; knobEl.style.transform = ''; joyEl.classList.remove('on');
}
joyEl.addEventListener('pointerdown', e => {
  if (joyId !== null) return;
  e.preventDefault(); Sfx.init();
  joyId = e.pointerId; try { joyEl.setPointerCapture(e.pointerId); } catch (_) {}
  joyEl.classList.add('on'); updateJoy(e);
});
joyEl.addEventListener('pointermove', e => { if (e.pointerId === joyId) { e.preventDefault(); updateJoy(e); } });
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => joyEl.addEventListener(n, e => { if (e.pointerId === joyId) releaseJoy(); }));

function setLock(v) {
  if (input.aLock === v) return;
  input.aLock = v; Sfx.play(v ? 'lock' : 'unlock'); vibrate(v ? 35 : 15);
}
function aPress() {
  input.aDown = true;
  if (input.aLock) { setLock(false); input.aIgnore = true; }       // 锁定中再按：取消锁定
  else {
    input.aIgnore = false; input.aPressT = performance.now();
    clearTimeout(input.aTimer);
    input.aTimer = setTimeout(() => { if (input.aDown && !input.aIgnore && !input.aLock && state === 'playing') setLock(true); }, LOCK_MS);
  }
  btnA.classList.add('press');
}
function aRelease() { input.aDown = false; clearTimeout(input.aTimer); btnA.classList.remove('press'); aId = null; }
btnA.addEventListener('pointerdown', e => {
  if (aId !== null) return;
  e.preventDefault(); Sfx.init(); aId = e.pointerId; try { btnA.setPointerCapture(e.pointerId); } catch (_) {}
  aPress();
});
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => btnA.addEventListener(n, e => { if (e.pointerId === aId) aRelease(); }));

btnB.addEventListener('pointerdown', e => {
  if (bId !== null) return;
  e.preventDefault(); Sfx.init(); bId = e.pointerId; try { btnB.setPointerCapture(e.pointerId); } catch (_) {}
  btnB.classList.add('press'); useSkill();
});
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => btnB.addEventListener(n, e => { if (e.pointerId === bId) { bId = null; btnB.classList.remove('press'); } }));

function selectWeapon(t) {   // 手动切换到已拥有的弹种（点 HUD 弹种标签 / 键盘 1-4）
  if (state !== 'playing' || resumeT > 0 || P.mode !== 'ship' || !P.wl[t] || P.wt === t) return;
  P.wt = t; P.fireCd = Math.max(P.fireCd, .08); Sfx.play('click');
  popup(P.x, P.y - 34, WT[t].name + ' Lv' + P.wl[t], WT[t].col, 14);
  rings.push({ x: P.x, y: P.y, r: 10, grow: 140, life: 0, max: .35, rgb: WT[t].rgb, w: 2.5 });
}
wsel.addEventListener('pointerdown', e => {
  const b = e.target.closest('button'); if (!b) return;
  e.preventDefault(); Sfx.init(); selectWeapon(b.dataset.t);
});

function releaseInputs() {   // 暂停/结束时清理按住状态（保留锁定）
  releaseJoy(); aRelease(); bId = null; btnB.classList.remove('press');
}

const keyDown = {};
addEventListener('keydown', e => {
  if (e.repeat) { if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); return; }
  keyDown[e.code] = true; Sfx.init();
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (state === 'playing') {
    if (e.code === 'KeyP' || e.code === 'Escape') pauseGame();
    else if (e.code === 'KeyB' || e.code === 'KeyK' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') useSkill();
    else if (e.code === 'KeyL') setLock(!input.aLock);
    else if (/^(Digit|Numpad)[1-4]$/.test(e.code)) selectWeapon(WORDER[+e.code.slice(-1) - 1]);
  } else if (state === 'paused' && (e.code === 'KeyP' || e.code === 'Escape') && $('pause').classList.contains('show')) resumeGame();
  else if (state === 'menu' && (e.code === 'Enter' || e.code === 'Space') && $('menu').classList.contains('show')) startGame();
  readKeys();
});
addEventListener('keyup', e => { keyDown[e.code] = false; readKeys(); });
function readKeys() {
  const k = c => keyDown[c] ? 1 : 0;
  input.kx = k('ArrowRight') + k('KeyD') - k('ArrowLeft') - k('KeyA');
  input.ky = k('ArrowDown') + k('KeyS') - k('ArrowUp') - k('KeyW');
  input.kFire = !!(keyDown.Space || keyDown.KeyJ);
}
const fireHeld = () => input.aDown || input.aLock || input.kFire;

/* =====================================================================
 *  特效辅助
 * ===================================================================== */
function explode(x, y, rgb, count, power) {
  for (let i = 0; i < count && particles.length < 420; i++) {
    const a = rand(0, TAU), s = rand(power * .25, power);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: rand(.3, .85), size: rand(3, 7.5), rgb, drag: 2.4 });
  }
  rings.push({ x, y, r: 4, grow: power * 2.2, life: 0, max: .38, rgb, w: 3 });
  particles.push({ x, y, vx: 0, vy: 0, life: 0, max: .22, size: power * .22 + 8, rgb: '255,240,200', drag: 0 });
}
function spark(x, y, rgb, n) {
  for (let i = 0; i < n && particles.length < 420; i++) {
    const a = rand(0, TAU), s = rand(60, 200);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: rand(.12, .3), size: rand(2, 4), rgb, drag: 3 });
  }
}
function popup(x, y, text, col, size, max) {
  let n = 0; for (const q of popups) if (q.life < .6 && Math.abs(q.x - x) < 70 && Math.abs(q.y - y) < 18 + 18 * n) n++;   // 同处连续飘字时依次上移，避免重叠
  popups.push({ x, y: y - 17 * n, text, col: col || '#ffe28a', life: 0, max: max || .9, size: size || 13 });
}
function showBanner(title, sub, col, dur) { banner = { title, sub, col: col || '#fff', t: 0, dur: dur || 2 }; }
function addShake(v) { shake = Math.max(shake, v); }

/* =====================================================================
 *  生成：敌波
 * ===================================================================== */
function buildWave(n) {
  const q = [];
  const side = () => Math.random() < .5 ? -1 : 1;
  const bossWave = isBossWave(n), sIdx = stageOf(n);
  n = levelOf(n);   // 以下的 n 都是难度等级
  const pat = {
    stream(t, type) {
      const s = side(), cnt = clamp(5 + Math.floor(n / 3), 5, 9), om = rand(.55, .9), y0 = rand(50, 100), sp = rand(165, 185);
      for (let i = 0; i < cnt; i++) q.push({ t: t + i * .3, type, x: s < 0 ? -24 : W + 24, y: y0, ai: 'arc', th: s < 0 ? .3 : Math.PI - .3, om: s < 0 ? om : -om, sp });
      return cnt * .3 + 2.6;
    },
    line(t, type) {
      const cnt = clamp(4 + Math.floor(n / 4), 4, 7), vy = rand(78, 92);
      for (let i = 0; i < cnt; i++) { const x = 40 + (W - 80) * i / (cnt - 1); q.push({ t, type, x, y: -30, ai: 'sine', vy, amp: 34, f: 1.2, ph: 0 }); }
      return 4;
    },
    vee(t, type) {
      const rows = clamp(3 + Math.floor(n / 5), 3, 5);
      for (let r = 0; r < rows; r++) for (const s of (r ? [-1, 1] : [0])) q.push({ t: t + r * .35, type, x: W / 2 + s * r * 38, y: -30, ai: 'sine', vy: 82, amp: 56, f: .9, ph: 0 });
      return 4.5;
    },
    hover(t, type, cnt) {
      for (let i = 0; i < cnt; i++) q.push({ t: t + i * .5, type, x: W * (i + 1) / (cnt + 1), y: -40, ai: 'hover', ty: 90 + (i % 2) * 60 + rand(0, 30), amp: 58, hoverT: rand(6, 8) });
      return 6;
    },
    dive(t) {
      const cnt = clamp(3 + Math.floor(n / 3), 3, 7);
      for (let i = 0; i < cnt; i++) q.push({ t: t + i * .85, type: 3, x: rand(30, W - 30), y: -30, ai: 'dive', ty: rand(70, 150) });
      return cnt * .85 + 2.5;
    },
    snipe(t) {   // 狙击机：悬停蓄力，红线预警后射出高速弹
      const cnt = n >= 8 ? 3 : 2;
      for (let i = 0; i < cnt; i++) q.push({ t: t + i * 1.1, type: 5, x: clamp(W * (i + .5) / cnt + rand(-24, 24), 36, W - 36), y: -30, ai: 'snipe', ty: rand(56, 105), cd: rand(.9, 1.4) });
      return 7;
    },
    mines(t) {   // 布雷机：横穿屏幕投放水雷
      const s = side();
      q.push({ t, type: 6, x: s < 0 ? W + 30 : -30, y: 130, ty: rand(110, 190), ai: 'mine', dirv: s < 0 ? -1 : 1 });
      if (n >= 9) q.push({ t: t + 3.2, type: 6, x: s < 0 ? -30 : W + 30, y: 130, ty: rand(190, 250), ai: 'mine', dirv: s < 0 ? 1 : -1 });
      return 8;
    },
    shield(t) {  // 护盾舰：先打破护盾
      const cnt = n >= 10 ? 3 : 2;
      for (let i = 0; i < cnt; i++) q.push({ t: t + i * .6, type: 7, x: W * (i + 1) / (cnt + 1), y: -40, ai: 'hover', ty: 100 + (i % 2) * 55 + rand(0, 20), amp: 50, hoverT: rand(7, 9) });
      return 6.5;
    },
    missile(t) { // 导弹艇：发射可被击落的追踪导弹
      const cnt = n >= 11 ? 2 : 1;
      for (let i = 0; i < cnt; i++) q.push({ t: t + i * .8, type: 8, x: W * (i + 1) / (cnt + 1), y: -40, ai: 'hover', ty: 85 + i * 45, amp: 70, hoverT: rand(8, 10) });
      return 7;
    },
    split(t) {   // 分裂机
      const cnt = n >= 8 ? 4 : 3;
      for (let i = 0; i < cnt; i++) q.push({ t: t + i * .5, type: 10, x: W * (i + 1) / (cnt + 1), y: -30, ai: 'sine', vy: 62, amp: 30, f: 1.1, ph: i });
      return 5;
    },
    cloak(t) {   // 隐形机
      const cnt = n >= 12 ? 3 : 2;
      for (let i = 0; i < cnt; i++) q.push({ t: t + i * .7, type: 11, x: W * (i + 1) / (cnt + 1), y: -30, ai: 'hover', ty: 110 + (i % 2) * 70, amp: 64, hoverT: rand(8, 10) });
      return 6.5;
    },
    spiral(t) {  // 旋涡机
      q.push({ t, type: 12, x: rand(110, W - 110), y: -40, ai: 'hover', ty: rand(120, 170), amp: 40, hoverT: 10 });
      if (n >= 14) q.push({ t: t + 2, type: 12, x: rand(70, W - 70), y: -40, ai: 'hover', ty: rand(200, 240), amp: 30, hoverT: 9 });
      return 8;
    },
    charge(t) {  // 冲锋舰
      const cnt = n >= 10 ? 3 : 2, s0 = side();
      for (let i = 0; i < cnt; i++) { const d = i % 2 ? -s0 : s0; q.push({ t: t + i * 1.5, type: 13, x: d > 0 ? -30 : W + 30, y: rand(220, H - 240), ai: 'charge', dirv: d }); }
      return 6;
    },
    swarm(t) {   // 蜂群机
      const cnt = clamp(5 + Math.floor(n / 3), 5, 10), x0 = rand(70, W - 70);
      for (let i = 0; i < cnt; i++) q.push({ t: t + i * .18, type: 15, x: x0 + rand(-40, 40), y: -20, ai: 'swarm', th: Math.PI / 2 + rand(-.5, .5), sp: rand(140, 170) * D.spd });
      return 5;
    },
    turret(t) {  // 浮游炮台
      const cnt = n >= 10 ? 4 : 3;
      for (let i = 0; i < cnt; i++) q.push({ t: t + i * .9, type: 17, x: rand(40, W - 40), y: -30, ai: 'sine', vy: 40, amp: 0 });
      return 6;
    },
    heal(t) {    // 修复机 + 护航
      q.push({ t, type: 14, x: rand(80, W - 80), y: -30, ai: 'hover', ty: rand(70, 100), amp: 60, hoverT: 12 });
      pat.hover(t + .4, 1, 2); if (n >= 14) pat.hover(t + 1, 2, 1);
      return 7;
    },
    gravity(t) { // 引力机
      q.push({ t, type: 16, x: rand(100, W - 100), y: -40, ai: 'hover', ty: rand(130, 180), amp: 36, hoverT: 11 });
      return 7;
    },
    rocks(t) {   // 陨石雨
      const cnt = clamp(5 + Math.floor(n / 4), 5, 9);
      for (let i = 0; i < cnt; i++) q.push({ t: t + i * .55, type: 18, x: rand(20, W - 20), y: -30, ai: 'rock', vx: rand(-28, 28), vy: rand(70, 120), vr: rand(-1.5, 1.5) });
      return 4;
    },
    cargo(t) {   // 运输机：横穿屏幕逃跑，击落必掉两个道具
      const s = side();
      q.push({ t, type: 24, x: s < 0 ? W + 34 : -34, y: 120, ty: rand(90, 200), ai: 'cargo', dirv: s < 0 ? -1 : 1, elite: false });
      return 5;
    },
    carrier(t) { // 无人机母舰：不断放出蜂群机
      q.push({ t, type: 25, x: rand(90, W - 90), y: -40, ai: 'hover', ty: rand(85, 125), amp: 46, hoverT: 12 });
      if (n >= 18) q.push({ t: t + 2.5, type: 25, x: rand(70, W - 70), y: -40, ai: 'hover', ty: rand(150, 190), amp: 36, hoverT: 11 });
      return 7.5;
    },
    blink(t) {   // 闪电机：瞬移后三连射
      const cnt = n >= 13 ? 3 : 2;
      for (let i = 0; i < cnt; i++) q.push({ t: t + i * .8, type: 26, x: W * (i + 1) / (cnt + 1), y: -30, ai: 'hover', ty: rand(80, 200), amp: 14, hoverT: 99 });
      return 6.5;
    },
    frigate(t) { // 激光舰：红线预警后喷出竖直光束
      q.push({ t, type: 9, x: rand(90, W - 90), y: -60, ai: 'laser', ty: rand(95, 135) });
      if (n >= 14) q.push({ t: t + 2.5, type: 9, x: rand(60, W - 60), y: -60, ai: 'laser', ty: rand(150, 190) });
      return 8;
    }
  };
  let t = .4;
  if (bossWave) {
    q.push({ t: 1, type: 4, x: W / 2, y: -90, ai: 'boss' });
    pat.stream(7, 0); pat.stream(18, 1);
    if (n >= 10) pat.dive(12);
  } else {
    const groups = Math.max(2, (n < 2 ? 2 : n < 5 ? 3 : n < 9 ? 4 : 5) + D.groups);
    const pool = [() => pat.stream(t, n >= 6 && Math.random() < .4 ? 1 : 0), () => pat.line(t, 0)];
    if (n >= 2) pool.push(() => pat.vee(t, 1), () => pat.stream(t, 1));
    if (n >= 3) pool.push(() => pat.dive(t), () => pat.hover(t, 1, 2));
    if (n >= 4) pool.push(() => pat.hover(t, 2, n >= 9 ? 2 : 1));
    if (n >= 2) pool.push(() => pat.split(t));
    if (n >= 3) pool.push(() => pat.snipe(t), () => pat.rocks(t));
    if (n >= 4) pool.push(() => pat.swarm(t));
    if (n >= 6) pool.push(() => pat.mines(t), () => pat.charge(t));
    if (n >= 7) pool.push(() => pat.turret(t), () => pat.blink(t));
    if (n >= 8) pool.push(() => pat.shield(t));
    if (n >= 9) pool.push(() => pat.cloak(t), () => pat.carrier(t));
    if (n >= 11) pool.push(() => pat.missile(t));
    if (n >= 12) pool.push(() => pat.heal(t));
    if (n >= 13) pool.push(() => pat.gravity(t));
    if (n >= 14) pool.push(() => pat.spiral(t));
    if (n >= 16) pool.push(() => pat.frigate(t));
    const intro = { 2: ['split'], 3: ['snipe'], 4: ['swarm'], 6: ['mines'], 7: ['turret', 'blink'], 8: ['shield'], 9: ['cloak', 'carrier'], 11: ['missile'], 12: ['heal'], 13: ['gravity'], 14: ['spiral'], 16: ['frigate'] }[n] || [];   // 每种新敌机首次出现的那一波必定出场
    let lastIdx = -1;
    for (let i = 0; i < groups; i++) {
      let dur;
      if (i < intro.length) dur = pat[intro[i]](t);
      else { let idx; do { idx = randi(0, pool.length - 1); } while (idx === lastIdx && pool.length > 1); lastIdx = idx; dur = pool[idx](); }
      t += dur * (i === groups - 1 ? 0 : .65);
    }
  }
  if (!bossWave && n >= 3 && (n === 3 || Math.random() < .3)) pat.cargo(rand(2, 7));   // 运输机：第 3 波必定出现，之后随机路过
  if (STAGES[sIdx].ground && !bossWave) {   // 地面场景：每波额外出现一批地面部队
    const add = (gk, cnt) => { const t0 = rand(.5, 3); for (let i = 0; i < cnt; i++) q.push({ t: t0, type: gk, x: rand(40, W - 40), gd: i * 80 + rand(0, 40), amp: rand(30, 60), ph: rand(0, TAU) }); };
    add(19, clamp(2 + Math.floor(n / 5), 2, 4));
    if (n >= 3) add(20, n >= 12 ? 3 : 2);
    if (n >= 7 && Math.random() < .6) add(21, n >= 14 ? 2 : 1);
    if (n >= 9 && Math.random() < .6) add(22, n >= 16 ? 2 : 1);
    if (n >= 5 && (n === 6 || Math.random() < .55)) add(23, n >= 13 ? 2 : 1);
  }
  q.sort((a, b) => a.t - b.t);
  return q;
}

function spawnEnemy(ev) {
  const def = ET[ev.type], isBoss = ev.type === 4;
  // 精英：第 3 波起随机出现，更耐打、火力更密、必掉道具、得分 ×3
  const elite = !isBoss && ev.type !== 18 && ev.type !== 15 && ev.type !== 24 && !ev.noSplit && (ev.elite !== undefined ? ev.elite : DL >= 3 && Math.random() < Math.min(.04 + DL * .007, .16));
  let hp = def.hp;
  if (ev.type === 15) hp = DL >= 10 ? 2 : 1;
  else if (ev.type === 18) hp = Math.ceil((ev.small ? 2 : 6) * D.hp);
  else if (ev.type >= 1 && !isBoss) hp = Math.ceil((hp * 1.25 + Math.max(0, Math.floor((DL - 1) / 3))) * D.hp);
  else if (ev.type === 0 && DL >= D.scout2) hp = 2;
  const bk = isBoss ? (ev.bk !== undefined ? ev.bk : STAGES[stageOf(wave)].boss) : 0;
  if (def.ground && !onGround()) return;   // 太空里没有地面单位
  if (isBoss) hp = Math.round((240 + 82 * stageOf(wave)) * D.boss * BOSSES[bk].hp);   // Boss 血量逐关略增
  if (elite) hp = Math.ceil(hp * 2.2);
  const sc = elite ? 1.22 : ev.small ? .58 : 1;
  // 狙击机(5)、布雷机(6)、激光舰(9) 等由各自的 AI 负责攻击，不走通用射击
  const shoots = ev.type === 1 || ev.type === 2 || ev.type === 7 || ev.type === 8 || (ev.type === 0 && DL >= 2) || isBoss || ev.type === 10;
  const iv = ev.type === 1 ? 2.1 : ev.type === 2 ? 2.5 : ev.type === 0 ? 3.4 : ev.type === 7 ? 2.4 : ev.type === 8 ? 3.1 : ev.type === 6 ? 1.2 : ev.type === 10 ? 2.2 : 99;
  const sh = ev.type === 7 ? 6 + Math.floor(DL / 8) : 0;
  enemies.push({
    type: ev.type, x: ev.x, y: ev.y, x0: ev.x, vx: ev.vx || 0, vy: ev.vy || 0, r: def.r * sc, age: 0, hitT: 0, flashT: 0, phase: 0, pt: 0, dead: false,
    hp, maxHp: hp, ai: ev.ai, th: ev.th || 0, om: ev.om || 0, sp: ev.sp || 0, amp: ev.amp || 0, f: ev.f || 1, ph: ev.ph || 0,
    ty: ev.ty || 120, hoverT: ev.hoverT || 6, rot: Math.PI, shoots,
    ivl: Math.max(.7, iv * .85 - Math.min(DL * .06, 1.1)) * D.ivl * (elite ? .75 : 1), fireT: rand(.8, 2), bt: 1.2, rt: .5, pat: 0,
    alpha: 1, cloaked: false, ct: rand(1, 2), fired: false, bn: 0, bt2: 0, sa: rand(0, TAU), noSplit: !!ev.noSplit,
    shield: sh, maxShield: sh, shieldT: 0, dirv: ev.dirv || 1, cd: ev.cd || 1.2, shots: 0, cycles: 0, sw: 0, aim: Math.PI / 2,
    sc, elite, bk, small: !!ev.small, vr: ev.vr || 0, healT: 0, healTarget: null, dashS: 0, pt2: 0, dashY: 0, ox: 0, tp: 2.5, raged: false, sa0: 0
  });
  { const ne = enemies[enemies.length - 1];
    ne.ground = !!def.ground || (isBoss && !!BOSSES[bk].ground); ne.trail = []; ne.segs = null;
    if (def.ground) { ne.ai = 'ground'; const gp0 = R.planeToGround(ev.x, -50 - (ev.gd || 0) * .6); ne.wx = ne.wx0 = gp0[0]; ne.wz = gp0[1]; ne.ct = rand(1.2, 2.4); ne.y = -40; } }
  if (ev.type === 13) Sfx.play('snipeCharge');
  if (isBoss) { showBanner('警告！', 'BOSS · ' + BOSSES[bk].name, '#ff6a8a', 2.6); Sfx.play('boss'); const ne = enemies[enemies.length - 1]; if (BOSSX[bk] && BOSSX[bk].init) BOSSX[bk].init(ne); }
  else if (elite && !seenElite) { seenElite = true; popup(W / 2, safeTop + 150, '精英敌机 ★：更强，必掉道具', '#ffd75a', 15, 2.2); }
  else if (ev.type >= 5 && ev.type !== 18 && !seenTypes[ev.type]) { seenTypes[ev.type] = true; popup(W / 2, safeTop + 150, '新敌机：' + def.name, 'rgb(' + def.rgb + ')', 16, 1.9); }
}
/* ---- 敌方子弹 ---- */
function spawnEB(x, y, vx, vy, r, rgb, extra) {
  if (ebullets.length > 280) return;
  ebullets.push(Object.assign({ x, y, vx, vy, r: r || 5, rgb: rgb || '255,90,120', dead: false }, extra));
}
function aimEB(x, y, speed, off, r, rgb) {
  const a = Math.atan2(P.y - y, P.x - x) + (off || 0);
  spawnEB(x, y, Math.cos(a) * speed, Math.sin(a) * speed, r, rgb);
}
const diffK = () => (1.12 + Math.min(DL, 25) * .028) * D.spd;   // 敌弹速度随波次提升
function enemyShoot(e) {
  const k = diffK();
  e.flashT = .09;
  Sfx.play(e.type === 8 ? 'emissile' : e.type === 2 ? 'eshoot2' : 'eshoot');
  const rgb = ET[e.type].rgb;
  if (e.type === 0) aimEB(e.x, e.y + e.r, 150 * k, 0, 5, rgb);
  else if (e.type === 1) {
    if (DL >= 6) { spawnEB(e.x - 9, e.y + 12, 0, 200 * k, 5, rgb); spawnEB(e.x + 9, e.y + 12, 0, 200 * k, 5, rgb); }
    else spawnEB(e.x, e.y + 14, 0, 200 * k, 5, rgb);
  } else if (e.type === 2) { for (const o of [-.3, 0, .3]) aimEB(e.x, e.y + 16, 175 * k, o, 6, rgb); }
  else if (e.type === 10) { aimEB(e.x - 8, e.y + 12, 170 * k, -.08, 5, rgb); aimEB(e.x + 8, e.y + 12, 170 * k, .08, 5, rgb); }
  else if (e.type === 7) { aimEB(e.x - 10, e.y + 14, 190 * k, 0, 5, rgb); aimEB(e.x + 10, e.y + 14, 190 * k, 0, 5, rgb); }
  else if (e.type === 8) {   // 导弹艇：两枚追踪导弹（可被击落）
    for (const sd of [-1, 1]) spawnEB(e.x + sd * 15, e.y + 8, sd * 55, 75, 5.5, '255,150,70',
      { kind: 'emissile', homing: true, shot: true, turn: 1.9, accel: 90, maxSp: 170 * k, life: 4.2, age: 0, trailT: 0 });
  }
}
function dropMine(e) {   // 布雷机投放水雷
  spawnEB(e.x, e.y + e.r * .8, 0, 36, 7, '255,205,60', { kind: 'mine', shot: true, t: 1.9, beep: false });
  Sfx.play('mineDrop');
}
const BOSS_Y = 176;   // Boss 悬停高度：在顶部血条下方
function updateBoss(e, dt) {
  if (e.phase === 0) { e.y += 90 * dt; if (e.y >= BOSS_Y) { e.phase = 1; e.pt = 0; } return; }
  const rage = e.hp < e.maxHp * (BOSSES[e.bk].rageAt || .5), X = BOSSX[e.bk];
  if (rage && !e.raged) {   // 半血进入狂暴：出招更快，并解锁额外能力
    e.raged = true; showBanner(BOSSES[e.bk].name, BOSSES[e.bk].rageTxt || '进入狂暴状态！', '#ff6a6a', 1.8); whiteFlash = .35; addShake(8); Sfx.play('boss'); e.bt = Math.min(e.bt, .8);
  }
  if (e.alpha < 1 && !X) e.alpha = Math.min(1, e.alpha + dt * 2.5);
  if (e.dashS) {   // 裂空者：对准玩家后俯冲，落点炸开一圈子弹，再返回
    e.pt2 += dt;
    if (e.dashS === 1) { e.x += clamp(P.x - e.x, -220 * dt, 220 * dt); e.flashT = .05; if (e.pt2 >= .8) { e.dashS = 2; e.dashY = clamp(P.y, 320, H - 150); Sfx.play('dash'); } }
    else if (e.dashS === 2) {
      e.y += 680 * dt;
      if (e.y >= e.dashY) { e.dashS = 3; addShake(7); for (let i = 0; i < 12; i++) { const a = i * TAU / 12; spawnEB(e.x, e.y, Math.cos(a) * 120 * diffK(), Math.sin(a) * 120 * diffK(), 5, '110,220,255'); } }
    } else { e.y -= 260 * dt; if (e.y <= BOSS_Y) { e.y = BOSS_Y; e.dashS = 0; e.bt = .9; } }
    return;
  }
  e.pt += dt;
  let tx, ty = e.bk === 6 ? BOSS_Y + 24 + Math.sin(e.pt * 1.25) * (rage ? 95 : 65) : BOSS_Y + Math.sin(e.pt * 1.1) * 10;
  if (X) { const m = X.move(e, rage, dt); tx = m[0]; ty = m[1]; }
  else if (e.bk === 1) {   // 织网者：狂暴后会瞬移
    if (rage && (e.tp -= dt) <= 0) { e.tp = 3.6; explode(e.x, e.y, '190,110,255', 14, 200); e.ox = rand(-60, 60); e.x = W / 2 + e.ox; e.alpha = .12; Sfx.play('decloak'); }
    tx = W / 2 + e.ox + Math.sin(e.pt * .5) * 42;
  } else if (e.bk === 2) tx = W / 2 + Math.sin(e.pt * .35) * (W / 2 - 92);
  else if (e.bk === 3) tx = W / 2 + Math.sin(e.pt * .95) * (W / 2 - 72);
  else if (e.bk === 4) { tx = W / 2 + Math.sin(e.pt * .3) * 70; let d = Math.atan2(P.y - e.y, P.x - e.x) - e.aim; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; e.aim += clamp(d, -2 * dt, 2 * dt); }
  else if (e.bk === 5) tx = W / 2 + Math.sin(e.pt * .6) * (W / 2 - 84);
  else if (e.bk === 6) tx = W / 2 + Math.sin(e.pt * .8) * 128;
  else if (e.bk === 7) tx = W / 2 + Math.sin(e.pt * .42) * (W / 2 - 96);
  else tx = W / 2 + Math.sin(e.pt * .55) * (W / 2 - 78);
  const k = Math.min(1, dt * (X && X.snap || 4)); e.x += (tx - e.x) * k; e.y += (ty - e.y) * k; e.vx = 0;
  if (X) {
    if (X.tick) X.tick(e, dt, rage);
    if (e.orb) { const o = e.orb; o.a += o.sp * dt; e.segs = []; for (let i = 0; i < o.n; i++) { const a = o.a + i * TAU / o.n; e.segs.push([e.x + Math.cos(a) * o.r, e.y + Math.sin(a) * o.r * .8]); } }   // 环绕体
  }
  if (e.bk === 6) {   // 炎龙：身体各节沿着龙头走过的轨迹跟随
    const tr = e.trail; if (!tr.length || Math.hypot(tr[0][0] - e.x, tr[0][1] - e.y) > 6) { tr.unshift([e.x, e.y]); if (tr.length > 38) tr.pop(); }
    e.segs = []; for (let i = 4; i < tr.length; i += 4) e.segs.push(tr[i]);
  }
  e.bt -= dt * D.bossRate * (rage ? 1.2 : 1);
  if (e.bt <= 0 && P.mode !== 'dead') bossAttack(e, rage);
  if (e.bk === 7 && rage && P.mode !== 'dead') { e.rt -= dt; if (e.rt <= 0) { e.rt = 2.4; hazards.push({ x: clamp(P.x, 16, W - 16), w: 24, t: 0, warn: .85, dur: .3, rgb: '255,240,150', fired: false }); Sfx.play('beamCharge'); } }   // 狂暴：不断落雷
  if (e.bk === 0 && rage) { e.rt -= dt; if (e.rt <= 0) { e.rt = .6; spawnEB(e.x - 44, e.y + 34, 0, 190 * D.spd, 5, '255,130,90'); spawnEB(e.x + 44, e.y + 34, 0, 190 * D.spd, 5, '255,130,90'); } }
}
function bossAttack(e, rage) {
  const k = diffK(), rgb = BOSSES[e.bk].rgb, lv = Math.min(4, Math.floor(stageOf(wave) / 4));
  e.flashT = .15; Sfx.play('eshoot');
  e.pat = (e.pat + 1) % 3;
  if (BOSSX[e.bk]) { BOSSX[e.bk].atk[e.pat](e, rage, k, lv, rgb); return; }
  const ring = (n, sp, off, col, r) => { for (let i = 0; i < n; i++) { const a = off + i * TAU / n; spawnEB(e.x, e.y + 10, Math.cos(a) * sp, Math.sin(a) * sp, r || 5.5, col); } };
  if (e.bk === 0) {            // 赤焰主宰：扇形弹 / 环形弹 / 三连点射
    if (e.pat === 0) { const n = 7 + lv * 2 + (rage ? 2 : 0); for (let i = 0; i < n; i++) aimEB(e.x, e.y + 30, 150 * k, (i - (n - 1) / 2) * 1.1 / (n - 1), 5.5, rgb); e.bt = 1.5; }
    else if (e.pat === 1) { const n = 16 + lv * 2, off = rand(0, TAU); ring(n, 112 * k, off, '255,150,90'); if (rage) later.push({ t: .35, fn: () => { if (!e.dead) ring(n, 112 * k, off + Math.PI / n, '255,150,90'); } }); e.bt = 1.7; }
    else { for (let b = 0; b < 3; b++) later.push({ t: b * .2, fn: () => { if (!e.dead) for (const o of [-.14, 0, .14]) aimEB(e.x, e.y + 30, 185 * k, o, 5.5, rgb); } }); e.bt = 1.9; }
  } else if (e.bk === 1) {     // 虚空织网者：预警光束 / 抛射水雷 / 双层蛛网弹
    if (e.pat === 0) {
      const xs = [clamp(P.x, 20, W - 20)]; for (let i = 0; i < (rage ? 4 : 2); i++) xs.push(rand(24, W - 24));
      for (const x of xs) hazards.push({ x, w: 26, t: 0, warn: .95, dur: .6, rgb, fired: false });
      Sfx.play('beamCharge'); e.bt = 2.3;
    } else if (e.pat === 1) {
      for (let i = 0; i < (rage ? 7 : 5); i++) spawnEB(e.x, e.y + 20, rand(-150, 150), rand(60, 190), 7, '255,205,60', { kind: 'mine', shot: true, t: rand(1.5, 2.3), beep: false, drag: true });
      Sfx.play('mineDrop'); e.bt = 2;
    } else { const off = rand(0, TAU); ring(12, 92 * k, off, rgb); later.push({ t: .4, fn: () => { if (!e.dead) ring(12, 92 * k, off + Math.PI / 12, '255,120,220'); } }); e.bt = 1.9; }
  } else if (e.bk === 2) {     // 蜂巢母舰：放出蜂群 / 追踪导弹 / 螺旋弹幕
    if (e.pat === 0) {
      const have = enemies.filter(o => !o.dead && o.type === 15).length;
      for (let i = 0; i < (rage ? 5 : 3) && have + i < 9; i++) spawnEnemy({ type: 15, x: e.x + rand(-55, 55), y: e.y + 26, ai: 'swarm', th: Math.PI / 2 + rand(-.9, .9), sp: 150 * D.spd, noSplit: true });
      Sfx.play('split'); e.bt = 2.2;
    } else if (e.pat === 1) {
      for (const sd of (rage ? [-1.6, -1, 1, 1.6] : [-1, 1])) spawnEB(e.x + sd * 40, e.y + 20, sd * 60, 70, 5.5, '255,150,70', { kind: 'emissile', homing: true, shot: true, turn: 1.9, accel: 90, maxSp: 165 * k, life: 4.2, age: 0, trailT: 0 });
      Sfx.play('emissile'); e.bt = 2.1;
    } else {
      e.sa0 = rand(0, TAU); const arms = rage ? 3 : 2;
      for (let i = 0; i < 14; i++) later.push({ t: i * .085, fn: () => { if (e.dead) return; const a = e.sa0 + i * .4; for (let j = 0; j < arms; j++) spawnEB(e.x, e.y + 10, Math.cos(a + j * TAU / arms) * 118 * k, Math.sin(a + j * TAU / arms) * 118 * k, 4.5, '230,255,120'); Sfx.play('spiral'); } });
      e.bt = 2.4;
    }
  } else if (e.bk === 4) {     // 陆行堡垒：高射炮齐射 / 追踪导弹 / 扇形扫射
    if (e.pat === 0) {
      for (let i = 0; i < (rage ? 5 : 3); i++) later.push({ t: i * .22, fn: () => { if (e.dead) return; const ax = P.x + rand(-50, 50), ay = P.y + rand(-40, 40), d = Math.hypot(ax - e.x, ay - e.y) || 1;
        spawnEB(e.x, e.y, (ax - e.x) / d * 210, (ay - e.y) / d * 210, 6.5, '255,220,120', { kind: 'mine', shot: true, t: d / 210, beep: true }); Sfx.play('mineDrop'); } });
      e.bt = 2.3;
    } else if (e.pat === 1) {
      for (const sd of (rage ? [-1.5, -1, 1, 1.5] : [-1, 1])) spawnEB(e.x + sd * 40, e.y, sd * 60, 60, 5.5, '255,150,70', { kind: 'emissile', homing: true, shot: true, turn: 1.9, accel: 90, maxSp: 165 * k, life: 4.2, age: 0, trailT: 0 });
      Sfx.play('emissile'); e.bt = 2.2;
    } else {
      const a0 = Math.atan2(P.y - e.y, P.x - e.x);
      for (let i = 0; i < 16; i++) later.push({ t: i * .08, fn: () => { if (e.dead) return; for (const sg of (rage ? [1, -1] : [1])) { const a = a0 + sg * (-.6 + 1.2 * i / 15); spawnEB(e.x, e.y, Math.cos(a) * 165 * k, Math.sin(a) * 165 * k, 5, rgb); } } });
      e.bt = 2.3;
    }
  } else if (e.bk === 5) {     // 极寒守卫：交错冰锥 / 暴风雪 / 冰环 + 冰矛（狂暴时两侧降下冰墙）
    if (e.pat === 0) { for (let w = 0; w < 3; w++) later.push({ t: w * .3, fn: () => { if (!e.dead) for (let i = 0; i < 7; i++) aimEB(e.x, e.y + 30, 158 * k, (i - 3 + (w % 2) * .5) * .17, 5, rgb); } }); e.bt = 2; }
    else if (e.pat === 1) { for (let i = 0; i < (rage ? 24 : 16); i++) later.push({ t: i * .1, fn: () => { if (!e.dead) spawnEB(rand(14, W - 14), 60, rand(-35, 35), 132 * k, 5, '225,246,255'); } }); e.bt = 2.4; }
    else {
      ring(18, 94 * k, rand(0, TAU), rgb); for (const o of [-.1, 0, .1]) aimEB(e.x, e.y + 30, 225 * k, o, 5.5, '255,255,255');
      if (rage) { for (const x of [34, W - 34]) hazards.push({ x, w: 68, t: 0, warn: 1, dur: .9, rgb, fired: false }); Sfx.play('beamCharge'); }
      e.bt = 2.1;
    }
  } else if (e.bk === 6) {     // 熔岩炎龙：火焰吐息 / 全身鳞片齐射 / 喷发 + 落石
    if (e.pat === 0) { for (let i = 0; i < 12; i++) later.push({ t: i * .09, fn: () => { if (!e.dead) aimEB(e.x, e.y + 24, 192 * k, rand(-.12, .12), 6, '255,140,50'); } }); e.bt = 2; }
    else if (e.pat === 1) { (e.segs || []).forEach((q, i) => later.push({ t: i * .09, fn: () => { if (e.dead) return; const a = Math.atan2(P.y - q[1], P.x - q[0]); spawnEB(q[0], q[1], Math.cos(a) * 150 * k, Math.sin(a) * 150 * k, 5, '255,200,90'); } })); e.bt = 2; }
    else { ring(14, 108 * k, rand(0, TAU), rgb); for (let i = 0; i < (rage ? 9 : 6); i++) later.push({ t: .2 + i * .15, fn: () => { if (!e.dead) spawnEB(rand(20, W - 20), 56, 0, 168 * k, 6.5, '255,110,40'); } }); e.bt = 2.3; }
  } else if (e.bk === 7) {     // 雷霆战舰：依次落下的雷击阵列 / 四门舷炮齐射 / 放出浮游炮台 + 电弧环
    if (e.pat === 0) {
      const cols = 5, dir = Math.random() < .5 ? 1 : -1, sh = rand(-14, 14);
      for (let i = 0; i < cols; i++) { const x = W * ((dir > 0 ? i : cols - 1 - i) + .5) / cols + sh; hazards.push({ x, w: 38, t: 0, warn: .8 + i * .24, dur: .32, rgb, fired: false }); }
      if (rage) hazards.push({ x: clamp(P.x, 20, W - 20), w: 26, t: 0, warn: 1.2, dur: .32, rgb: '255,255,255', fired: false });
      Sfx.play('beamCharge'); e.bt = 2.6;
    } else if (e.pat === 1) {
      for (let b = 0; b < (rage ? 4 : 3); b++) later.push({ t: b * .34, fn: () => { if (e.dead) return; for (const ox of [-54, -24, 24, 54]) aimEB(e.x + ox, e.y + 26, 178 * k, 0, 5, rgb); Sfx.play('eshoot2'); } });
      e.bt = 2.2;
    } else {
      const have = enemies.filter(o => !o.dead && o.type === 17).length;
      for (let i = 0; i < 2 && have + i < (rage ? 3 : 2); i++) spawnEnemy({ type: 17, x: clamp(e.x + (i ? 70 : -70), 30, W - 30), y: e.y + 20, ai: 'sine', vy: 38, amp: 0, noSplit: true, elite: false });
      const off = rand(0, TAU); ring(14 + lv * 2, 100 * k, off, '255,245,170'); if (rage) later.push({ t: .4, fn: () => { if (!e.dead) ring(14 + lv * 2, 100 * k, off + Math.PI / 14, rgb); } });
      Sfx.play('spiral'); e.bt = 2.3;
    }
  } else {                     // 裂空者：留缺口的弹墙 / 俯冲 / 霰弹
    const wall = () => { const gx = rand(44, W - 44); for (let x = 12; x < W; x += 24) if (Math.abs(x - gx) > 36) spawnEB(x, 64, 0, 128 * k, 5, rgb); };
    if (e.pat === 0) { wall(); if (rage) later.push({ t: .9, fn: () => { if (!e.dead) wall(); } }); e.bt = rage ? 2.6 : 2.1; }
    else if (e.pat === 1) { e.dashS = 1; e.pt2 = 0; Sfx.play('snipeCharge'); e.bt = 3; }
    else { for (let i = 0; i < 9; i++) aimEB(e.x, e.y + 30, 195 * k, (i - 4) * .13, 5, rgb); later.push({ t: .35, fn: () => { if (!e.dead) for (let i = 0; i < 8; i++) aimEB(e.x, e.y + 30, 170 * k, (i - 3.5) * .13, 5, '200,240,255'); } }); e.bt = 1.9; }
  }
}
/* =====================================================================
 *  第 5、7、8、10–13、15–17、19、20 关的 Boss：表驱动，每个都有自己的移动方式和三种招式
 * ===================================================================== */
const fanAt = (x, y, n, sp, spread, r, col, extra) => { const a0 = Math.atan2(P.y - y, P.x - x); for (let i = 0; i < n; i++) { const a = a0 + (n > 1 ? (i - (n - 1) / 2) * spread / (n - 1) : 0); spawnEB(x, y, Math.cos(a) * sp, Math.sin(a) * sp, r, col, extra); } };
const ringAt = (x, y, n, sp, off, r, col, extra) => { for (let i = 0; i < n; i++) { const a = off + i * TAU / n; spawnEB(x, y, Math.cos(a) * sp, Math.sin(a) * sp, r, col, extra); } };
const seq = (e, n, gap, fn, t0) => { for (let i = 0; i < n; i++) later.push({ t: (t0 || 0) + i * gap, fn: () => { if (!e.dead) fn(i); } }); };
const beamV = (x, w, warn, dur, rgb) => hazards.push({ x, w, t: 0, warn, dur, rgb, fired: false });          // 竖直光束
const beamH = (y, w, warn, dur, rgb) => hazards.push({ hy: y, w, t: 0, warn, dur, rgb, fired: false });      // 横向光束
const strike = (cx, cy, r, warn, rgb) => hazards.push({ cx, cy, r, t: 0, warn, dur: .28, rgb, fired: false });   // 落点轰炸：先出现圆形预警
const homing = (x, y, vx, vy, k) => spawnEB(x, y, vx, vy, 5.5, '255,150,70', { kind: 'emissile', homing: true, shot: true, turn: 1.9, accel: 90, maxSp: 165 * k, life: 4.2, age: 0, trailT: 0 });
const sway = (e, f, amp) => W / 2 + Math.sin(e.pt * f) * amp;
const pullP = (e, dt, f, range) => { if (P.mode !== 'ship' && P.mode !== 'possessed') return; const dx = e.x - P.x, dy = e.y - P.y, d = Math.hypot(dx, dy) || 1; if (d < range) { const q = (1 - d / range) * f * dt; P.vx += dx / d * q; P.vy += dy / d * q; } };
const gapRing = (e, n, sp, ga, half, r, col) => { for (let j = 0; j < n; j++) { const a = j * TAU / n; let d = a - ga; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; if (Math.abs(d) > half) spawnEB(e.x, e.y + 10, Math.cos(a) * sp, Math.sin(a) * sp, r, col); } };
const converge = (e, n, k, col) => seq(e, n, .1, () => { const sd = randi(0, 2), x = sd === 0 ? -8 : sd === 1 ? W + 8 : rand(20, W - 20), y = sd === 2 ? H + 8 : rand(260, H - 20), d = Math.hypot(e.x - x, e.y - y) || 1, sp = 115 * k; spawnEB(x, y, (e.x - x) / d * sp, (e.y - y) / d * sp, 5, col, { ttl: d / sp - .25 }); });
const OVERLORD = [   // 星际霸主的三种形态
  [ (e, k, lv, rgb) => { fanAt(e.x, e.y + 30, 9 + lv, 155 * k, 1.1, 5.5, rgb); later.push({ t: .4, fn: () => { if (!e.dead) ringAt(e.x, e.y + 10, 18, 110 * k, rand(0, TAU), 5.5, '255,160,90'); } }); Sfx.play('eshoot2'); e.bt = 1.9; },
    (e, k, lv, rgb) => { seq(e, 4, .2, () => { fanAt(e.x - 40, e.y + 26, 2, 190 * k, .1, 5, rgb); fanAt(e.x + 40, e.y + 26, 2, 190 * k, .1, 5, rgb); Sfx.play('eshoot'); }); e.bt = 2; },
    (e, k, lv, rgb) => { for (const sd of [-1.5, -.6, .6, 1.5]) homing(e.x + sd * 30, e.y + 14, sd * 60, 60, k); seq(e, 8, .14, () => spawnEB(rand(16, W - 16), 58, 0, 160 * k, 5.5, '255,130,90')); Sfx.play('emissile'); e.bt = 2.3; } ],
  [ (e, k, lv, rgb) => { const dir = Math.random() < .5 ? 1 : -1; for (let i = 0; i < 5; i++) beamV(W * ((dir > 0 ? i : 4 - i) + .5) / 5, 38, .85 + i * .22, .32, rgb); beamH(clamp(P.y, 250, H - 120), 28, 1.5, .5, '255,200,120'); Sfx.play('beamCharge'); e.bt = 2.8; },
    (e, k, lv, rgb) => { const a0 = rand(0, TAU); seq(e, 16, .085, i => { for (let j = 0; j < 4; j++) { const a = a0 + i * .34 + j * Math.PI / 2; spawnEB(e.x, e.y + 10, Math.cos(a) * 118 * k, Math.sin(a) * 118 * k, 4.5, rgb, { spin: .4 }); } Sfx.play('spiral'); }); e.bt = 2.6; },
    (e, k, lv, rgb) => { const have = enemies.filter(o => !o.dead && o.type === 1).length; for (let i = 0; i < 2 && have + i < 3; i++) spawnEnemy({ type: 1, x: e.x + (i ? 80 : -80), y: e.y, ai: 'hover', ty: 250 + i * 40, amp: 50, hoverT: 9, elite: true });
      const off = rand(0, TAU); ringAt(e.x, e.y, 16, 120 * k, off, 5, '255,160,90', { spin: 1, spinD: .9 }); ringAt(e.x, e.y, 16, 120 * k, off, 5, rgb, { spin: -1, spinD: .9 }); Sfx.play('split'); e.bt = 2.5; } ],
  [ (e, k, lv, rgb) => { for (let i = 0; i < 8; i++) strike(i ? rand(34, W - 34) : clamp(P.x, 34, W - 34), i ? rand(250, H - 125) : clamp(P.y, 250, H - 125), 40, .9 + i * .15, rgb); const ga = Math.atan2(P.y - e.y, P.x - e.x); seq(e, 2, .5, i => gapRing(e, 24, 108 * k, ga + (i ? .5 : -.5), .4, 5, '255,160,90')); Sfx.play('beamCharge'); e.bt = 2.7; },
    (e, k, lv, rgb) => { converge(e, 18, k, '255,160,90'); later.push({ t: .9, fn: () => { if (!e.dead) fanAt(e.x, e.y + 30, 7, 175 * k, .9, 5.5, rgb); } }); Sfx.play('cloak'); e.bt = 2.7; },
    (e, k, lv, rgb) => { beamV(e.x, 80, 1.2, .9, rgb); e.lockX = 2.1; later.push({ t: .4, fn: () => { if (!e.dead) for (const a of [.45, .8, 1.2, 1.94, 2.34, 2.7]) spawnEB(e.x, e.y + 14, Math.cos(a) * 205 * k, Math.sin(a) * 205 * k, 5.5, '255,230,200', { bounce: 3 }); } }); Sfx.play('beamCharge'); e.bt = 3.1; } ]
];
const BOSSX = {
  8: {   // 晶簇女王：水晶护卫绕身旋转（能挡子弹，激光可以穿透）；悬停后射出的晶刺 / 回旋晶环 / 反弹棱光
    init(e) { e.orb = { n: 3, r: 64, sp: 1.5, a: 0 }; e.segBlock = true; },
    move: e => [sway(e, .5, W / 2 - 92), BOSS_Y + Math.sin(e.pt * 1.1) * 8],
    tick(e, dt, rage) { if (rage && e.orb.n < 5) { e.orb.n = 5; e.orb.sp = 2.1; } },
    atk: [
      (e, rage, k, lv, rgb) => { const n = (rage ? 11 : 7) + lv; for (let i = 0; i < n; i++) { const a = Math.PI * (.1 + .8 * i / (n - 1)); spawnEB(e.x + Math.cos(a) * 76, e.y + 12 + Math.sin(a) * 48, 0, 0, 5, rgb, { aimT: .75 + i * .11, aimSp: 230 * k }); } Sfx.play('decloak'); e.bt = 2.5; },
      (e, rage, k, lv, rgb) => { const n = 12 + lv * 2, off = rand(0, TAU); ringAt(e.x, e.y + 10, n, 112 * k, off, 5, rgb, { spin: 1, spinD: .9 }); later.push({ t: .4, fn: () => { if (!e.dead) ringAt(e.x, e.y + 10, n, 112 * k, off, 5, '255,120,230', { spin: -1, spinD: .9 }); } }); Sfx.play('spiral'); e.bt = 2.2; },
      (e, rage, k) => { for (const a of (rage ? [.5, .9, 1.25, 1.9, 2.25, 2.65] : [.6, 1.1, 2.05, 2.55])) spawnEB(e.x, e.y + 16, Math.cos(a) * 205 * k, Math.sin(a) * 205 * k, 5.5, '230,250,255', { bounce: 3 }); Sfx.play('snipe'); e.bt = 2; }
    ]
  },
  9: {   // 沙海巨蝎（地面 Boss）：抛出毒液（抛物线）/ 双钳交叉扫射 / 钻地突刺（落点预警）
    move: e => [sway(e, .33, 86), BOSS_Y + Math.sin(e.pt * .9) * 8],
    tick(e, dt) { let d = Math.atan2(P.y - e.y, P.x - e.x) - e.aim; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; e.aim += clamp(d, -2.4 * dt, 2.4 * dt); },
    atk: [
      (e, rage, k, lv) => { seq(e, (rage ? 9 : 6) + lv, .1, () => spawnEB(e.x, e.y, rand(-150, 150), rand(-150, -50), 6.5, '170,255,90', { ay: 210, vcap: 200 * k })); Sfx.play('mineDrop'); e.bt = 2.2; },
      (e, rage, k, lv, rgb) => { const n = 5 + Math.floor(lv / 2); fanAt(e.x - 58, e.y + 6, n, 168 * k, .55, 5, rgb); later.push({ t: .3, fn: () => { if (!e.dead) fanAt(e.x + 58, e.y + 6, n, 168 * k, .55, 5, rgb); } }); if (rage) later.push({ t: .6, fn: () => { if (!e.dead) fanAt(e.x, e.y + 20, 3, 215 * k, .16, 5.5, '255,240,170'); } }); Sfx.play('eshoot2'); e.bt = 2.1; },
      (e, rage, k, lv, rgb) => { const n = (rage ? 5 : 3) + Math.floor(lv / 2); for (let i = 0; i < n; i++) strike(clamp(P.x + (i ? rand(-90, 90) : 0), 30, W - 30), clamp(P.y + (i ? rand(-90, 70) : 0), 240, H - 125), 36, .9 + i * .2, rgb); Sfx.play('beamCharge'); e.bt = 2.5; }
    ]
  },
  10: {  // 深海巨章：触手横扫（横向光束）/ 缓慢的大墨团 / 漩涡弹幕；狂暴后把你往它身边吸
    move: e => [sway(e, .3, 64), BOSS_Y + Math.sin(e.pt * .7) * 14],
    tick(e, dt, rage) { if (rage) pullP(e, dt, 620, 460); },
    atk: [
      (e, rage, k, lv, rgb) => { const ys = [clamp(P.y, 250, H - 120)]; for (let i = 0; i < (rage ? 2 : 1); i++) ys.push(rand(250, H - 130)); ys.forEach((y, i) => beamH(y, 30, 1 + i * .3, .5, rgb)); Sfx.play('beamCharge'); e.bt = 2.7; },
      (e, rage, k, lv) => { fanAt(e.x, e.y + 24, (rage ? 9 : 6) + Math.floor(lv / 2), 84 * k, 1.5, 10, '120,80,190', { ttl: 6.5 }); Sfx.play('eshoot2'); e.bt = 2.1; },
      (e, rage, k, lv, rgb) => { const a0 = rand(0, TAU), arms = rage ? 4 : 3; seq(e, 15, .085, i => { for (let j = 0; j < arms; j++) { const a = a0 + i * .36 + j * TAU / arms; spawnEB(e.x, e.y + 10, Math.cos(a) * 112 * k, Math.sin(a) * 112 * k, 4.5, rgb, { spin: .45 }); } Sfx.play('spiral'); }); e.bt = 2.5; }
    ]
  },
  11: {  // 极光巨鲸：喷泉水柱（抛物线洒落）/ 带缺口的声波环 / 左右飘动的极光雨
    move: e => [sway(e, .25, W / 2 - 112), BOSS_Y - 4 + Math.sin(e.pt * .8) * 6],
    atk: [
      (e, rage, k, lv) => { seq(e, (rage ? 22 : 15) + lv * 2, .06, () => spawnEB(e.x, e.y - 10, rand(-175, 175), rand(-140, -40), 5, '170,230,255', { ay: 200, vcap: 190 * k })); Sfx.play('spiral'); e.bt = 2.4; },
      (e, rage, k, lv, rgb) => { const ga = Math.atan2(P.y - e.y, P.x - e.x) + rand(-.4, .4); seq(e, rage ? 4 : 3, .45, i => { gapRing(e, 22, 104 * k, ga + (i % 2 ? .45 : -.45) * (i > 1 ? 2 : 1), .42, 5, rgb); Sfx.play('eshoot2'); }); e.bt = 2.8; },
      (e, rage, k, lv) => { seq(e, (rage ? 20 : 14) + lv, .1, i => spawnEB(rand(14, W - 14), 60, 0, 118 * k, 5, i % 2 ? '120,255,200' : '190,160,255', { ax: (i % 2 ? 1 : -1) * 34 })); e.bt = 2.3; }
    ]
  },
  12: {  // 齿轮巨像：旋转的四臂弹幕（狂暴时中途反转）/ 在两侧墙壁间反弹的大齿轮 / 活塞重锤（落点预警）
    move: e => [sway(e, .45, W / 2 - 102), BOSS_Y + Math.sin(e.pt) * 8],
    atk: [
      (e, rage, k, lv, rgb) => { const a0 = rand(0, TAU), dir = Math.random() < .5 ? 1 : -1; seq(e, rage ? 18 : 13, .15, i => { const a = a0 + dir * (rage && i > 8 ? 16 - i : i) * .2; for (let j = 0; j < 4; j++) spawnEB(e.x, e.y, Math.cos(a + j * Math.PI / 2) * 128 * k, Math.sin(a + j * Math.PI / 2) * 128 * k, 5, rgb); Sfx.play('spiral'); }); e.bt = rage ? 3.4 : 2.8; },
      (e, rage, k) => { for (const sd of (rage ? [-1, 0, 1] : [-1, 1])) spawnEB(e.x + sd * 30, e.y + 20, sd * 95 + rand(-20, 20), 105 * k, 11, '255,170,70', { bounce: 4, ttl: 8 }); Sfx.play('eshoot2'); e.bt = 2.2; },
      (e, rage, k, lv, rgb) => { const n = (rage ? 6 : 4) + Math.floor(lv / 2); for (let i = 0; i < n; i++) strike(i ? rand(36, W - 36) : clamp(P.x, 36, W - 36), i ? rand(250, H - 125) : clamp(P.y, 250, H - 125), 40, 1 + i * .16, rgb); Sfx.play('beamCharge'); e.bt = 2.6; }
    ]
  },
  13: {  // 日月双子：月亮绕着太阳转，会自己开火，打月亮也算伤害；日冕环 / 日月交辉 / 日食（月亮轨道变大，扫过半个屏幕）
    init(e) { e.orb = { n: 1, r: 92, sp: .9, a: 0 }; e.mt = 1.6; e.ecl = 0; },
    move: e => [sway(e, .5, 72), BOSS_Y + Math.sin(e.pt * 1.1) * 8],
    tick(e, dt, rage) {
      const o = e.orb, big = e.ecl > 0; if (big) e.ecl -= dt;
      o.r += ((big ? 250 : 92) - o.r) * Math.min(1, dt * 2.5); o.sp = big ? 2.2 : rage ? 1.3 : .9;
      if ((e.mt -= dt) <= 0 && e.segs && e.segs[0] && P.mode !== 'dead') { e.mt = (rage ? 1.15 : 1.7) * D.ivl; fanAt(e.segs[0][0], e.segs[0][1], 3, 165 * diffK(), .3, 4.5, '170,205,255'); }
    },
    atk: [
      (e, rage, k, lv, rgb) => { const n = 14 + lv * 2, off = rand(0, TAU); ringAt(e.x, e.y, n, 118 * k, off, 5.5, '255,170,60'); later.push({ t: .35, fn: () => { if (!e.dead) ringAt(e.x, e.y, n, 92 * k, off + Math.PI / n, 5, rgb); } }); Sfx.play('eshoot2'); e.bt = 2; },
      (e, rage, k, lv, rgb) => { fanAt(e.x, e.y + 20, 7 + lv, 160 * k, 1, 5.5, rgb); if (e.segs && e.segs[0]) ringAt(e.segs[0][0], e.segs[0][1], rage ? 14 : 10, 100 * k, rand(0, TAU), 4.5, '170,205,255'); Sfx.play('eshoot'); e.bt = 2.1; },
      (e, rage, k) => { e.ecl = 2.8; const a0 = rand(0, TAU); seq(e, 12, .1, i => { for (const o2 of [0, Math.PI]) spawnEB(e.x, e.y, Math.cos(a0 + i * .4 + o2) * 120 * k, Math.sin(a0 + i * .4 + o2) * 120 * k, 4.5, '255,170,60'); }); Sfx.play('dash'); e.bt = 3.2; }
    ]
  },
  14: {  // 果冻王：在上半场弹来弹去；会分裂的果冻弹 / 碰到两侧会反弹的弹珠 / 召唤小果冻
    init(e) { e.jx = W / 2; e.jy = BOSS_Y; e.jvx = 70; e.jvy = 46; },
    snap: 12,
    move(e, rage, dt) { const m = rage ? 1.5 : 1; e.jx += e.jvx * m * dt; e.jy += e.jvy * m * dt; if (e.jx < 70 || e.jx > W - 70) { e.jvx = -e.jvx; e.jx = clamp(e.jx, 70, W - 70); } if (e.jy < 150 || e.jy > 270) { e.jvy = -e.jvy; e.jy = clamp(e.jy, 150, 270); } return [e.jx, e.jy]; },
    atk: [
      (e, rage, k, lv, rgb) => { fanAt(e.x, e.y + 20, (rage ? 6 : 4) + Math.floor(lv / 2), 120 * k, 1.1, 9, rgb, { ttl: 1.15, split: 4 }); Sfx.play('eshoot2'); e.bt = 2.3; },
      (e, rage, k, lv) => { const n = (rage ? 10 : 7) + lv; for (let i = 0; i < n; i++) { const a = Math.PI * (.15 + .7 * i / (n - 1)); spawnEB(e.x, e.y + 10, Math.cos(a) * 150 * k, Math.sin(a) * 150 * k, 5, '255,140,200', { bounce: 2 }); } Sfx.play('eshoot'); e.bt = 2; },
      (e, rage, k, lv, rgb) => { const have = enemies.filter(o => !o.dead && o.type === 15).length; for (let i = 0; i < (rage ? 4 : 3) && have + i < 8; i++) spawnEnemy({ type: 15, x: e.x + rand(-40, 40), y: e.y + 24, ai: 'swarm', th: Math.PI / 2 + rand(-.9, .9), sp: 140 * D.spd, noSplit: true }); ringAt(e.x, e.y, 10 + lv * 2, 104 * k, rand(0, TAU), 5, rgb); Sfx.play('split'); e.bt = 2.4; }
    ]
  },
  15: {  // 镜面魔方：在三个位置之间瞬移；折射光弹（碰壁反弹）/ 纵横交错的光束网格 / 整块推进的方阵弹
    init(e) { e.an = 1; e.at = 2.4; },
    snap: 9,
    move(e, rage, dt) { if ((e.at -= dt) <= 0) { e.at = rage ? 1.9 : 2.6; e.an = (e.an + 1 + randi(0, 1)) % 3; explode(e.x, e.y, '90,230,255', 10, 180); Sfx.play('decloak'); } return [[82, W / 2, W - 82][e.an], BOSS_Y + (e.an === 1 ? 0 : 26)]; },
    atk: [
      (e, rage, k) => { for (const a of (rage ? [.45, .8, 1.2, 1.94, 2.34, 2.7] : [.55, 1.05, 2.1, 2.6])) spawnEB(e.x, e.y + 14, Math.cos(a) * 215 * k, Math.sin(a) * 215 * k, 5.5, '200,250,255', { bounce: 3 }); Sfx.play('snipe'); e.bt = 2.1; },
      (e, rage, k, lv, rgb) => { const xs = [clamp(P.x, 24, W - 24), rand(30, W - 30)]; if (rage) xs.push(rand(30, W - 30)); xs.forEach((x, i) => beamV(x, 26, 1 + i * .15, .5, rgb)); beamH(clamp(P.y, 250, H - 120), 26, 1.3, .5, '255,90,220'); if (rage) beamH(rand(260, H - 140), 26, 1.6, .5, '255,90,220'); Sfx.play('beamCharge'); e.bt = 2.9; },
      (e, rage, k, lv, rgb) => { const a = Math.atan2(P.y - e.y, P.x - e.x), m = rage ? 5 : 4, vx = Math.cos(a) * 150 * k, vy = Math.sin(a) * 150 * k; for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) spawnEB(e.x + (i - (m - 1) / 2) * 17, e.y + 20 + (j - (m - 1) / 2) * 17, vx, vy, 4.5, rgb); Sfx.play('eshoot2'); e.bt = 2; }
    ]
  },
  16: {  // 轨道炮台：轨道轰炸（一连串落点）/ 追踪导弹齐射 / 主炮（粗光束，开炮时停住不动）加两翼扫射
    move(e, rage, dt) { if (e.lockX > 0) { e.lockX -= dt; return [e.x, e.y]; } return [sway(e, .35, 84), BOSS_Y + Math.sin(e.pt * .9) * 6]; },
    atk: [
      (e, rage, k, lv, rgb) => { const n = (rage ? 8 : 5) + lv, x0 = P.x, y0 = P.y, a = rand(0, TAU); for (let i = 0; i < n; i++) { const d = Math.ceil(i / 2) * (i % 2 ? 1 : -1); strike(clamp(x0 + Math.cos(a) * d * 62, 30, W - 30), clamp(y0 + Math.sin(a) * d * 56, 240, H - 120), 38, .85 + i * .17, rgb); } Sfx.play('beamCharge'); e.bt = 2.7; },
      (e, rage, k) => { for (const sd of (rage ? [-1.6, -1, -.4, .4, 1, 1.6] : [-1.3, -.5, .5, 1.3])) homing(e.x + sd * 26, e.y + 12, sd * 60, 60, k); Sfx.play('emissile'); e.bt = 2.4; },
      (e, rage, k, lv, rgb) => { beamV(e.x, 74, 1.15, .8, rgb); e.lockX = 2; later.push({ t: .5, fn: () => { if (!e.dead) for (const sd of [-1, 1]) for (let i = 0; i < (rage ? 5 : 3); i++) spawnEB(e.x + sd * 50, e.y + 10, sd * (40 + i * 34), 150 * k, 5, '255,200,120'); } }); Sfx.play('beamCharge'); e.bt = 3; }
    ]
  },
  17: {  // 黑洞核心：一直把你往它身边吸；旋臂星环（弧线弹）/ 引力弹团 / 从屏幕边缘向中心坍缩的弹幕（会从背后飞来）
    move: e => [sway(e, .3, 42), BOSS_Y + 12 + Math.sin(e.pt * .6) * 8],
    tick(e, dt, rage) { pullP(e, dt, rage ? 900 : 560, 520); },
    atk: [
      (e, rage, k, lv, rgb) => { const n = 14 + lv * 2, off = rand(0, TAU), sg = Math.random() < .5 ? 1 : -1; ringAt(e.x, e.y, n, 150 * k, off, 5, rgb, { spin: 1.5 * sg, spinD: 1.1 }); if (rage) later.push({ t: .45, fn: () => { if (!e.dead) ringAt(e.x, e.y, n, 150 * k, off, 5, '255,150,90', { spin: -1.5 * sg, spinD: 1.1 }); } }); Sfx.play('spiral'); e.bt = 2.2; },
      (e, rage, k, lv, rgb) => { const a0 = Math.atan2(P.y - e.y, P.x - e.x); for (const o2 of (rage ? [-.5, 0, .5] : [-.28, .28])) { const vx = Math.cos(a0 + o2) * 92 * k, vy = Math.sin(a0 + o2) * 92 * k; spawnEB(e.x, e.y + 16, vx, vy, 10, '120,70,200'); for (let j = 0; j < 6; j++) spawnEB(e.x + Math.cos(j * TAU / 6) * 20, e.y + 16 + Math.sin(j * TAU / 6) * 20, vx, vy, 4, rgb); } Sfx.play('eshoot2'); e.bt = 2.4; },
      (e, rage, k, lv) => { converge(e, (rage ? 20 : 14) + lv, k, '255,150,90'); Sfx.play('cloak'); e.bt = 2.8; }
    ]
  },
  18: {  // 幽灵舰长：时隐时现，隐身时打不到它；追踪鬼火（可击落）/ 从屏幕两侧横飞进来的舷炮 / 召唤隐形机
    init(e) { e.gt = 5; e.ox = 0; },
    move: e => [W / 2 + e.ox + Math.sin(e.pt * .5) * 46, BOSS_Y + Math.sin(e.pt * .9) * 8],
    tick(e, dt, rage) {
      e.gt -= dt;
      if (e.cloaked) { e.alpha = Math.max(.16, e.alpha - dt * 3); if (e.gt <= 0) { e.cloaked = false; e.gt = rage ? 4.2 : 6; Sfx.play('decloak'); } }
      else { e.alpha = Math.min(1, e.alpha + dt * 3); if (e.gt <= 0) { e.cloaked = true; e.gt = 1.7; e.ox = rand(-80, 80); Sfx.play('cloak'); } }
    },
    atk: [
      (e, rage, k, lv, rgb) => { for (let i = 0; i < (rage ? 6 : 4); i++) spawnEB(e.x + rand(-44, 44), e.y + 12, rand(-70, 70), 40, 6, rgb, { homing: true, shot: true, turn: 1.3, accel: 30, maxSp: 118 * k, life: 4.6, age: 0, trailT: 0 }); Sfx.play('cloak'); e.bt = 2.4; },
      (e, rage, k, lv, rgb) => { const m = (rage ? 6 : 4) + Math.floor(lv / 2), y0 = clamp(P.y, 280, H - 150); for (let i = 0; i < m; i++) { const sd = i % 2 ? 1 : -1; spawnEB(sd < 0 ? -8 : W + 8, y0 + (i - (m - 1) / 2) * 44, -sd * 36, 0, 5.5, rgb, { ax: -sd * 170, scap: 185 * k }); } Sfx.play('eshoot2'); e.bt = 2.5; },
      (e, rage, k, lv, rgb) => { const have = enemies.filter(o => !o.dead && o.type === 11).length; for (let i = 0; i < 2 && have + i < (rage ? 3 : 2); i++) spawnEnemy({ type: 11, x: e.x + (i ? 80 : -80), y: e.y + 10, ai: 'hover', ty: 240 + i * 50, amp: 50, hoverT: 9, elite: false }); fanAt(e.x, e.y + 26, 5 + lv, 165 * k, .8, 5, rgb); Sfx.play('split'); e.bt = 2.6; }
    ]
  },
  19: {  // 星际霸主（最终 Boss）：三种形态，血量每降三分之一换一种，招式越来越强
    init(e) { e.form = 0; },
    move(e, rage, dt) { if (e.lockX > 0) { e.lockX -= dt; return [e.x, e.y]; } const f = e.form; return f === 0 ? [sway(e, .45, W / 2 - 96), BOSS_Y + Math.sin(e.pt) * 8] : f === 1 ? [sway(e, .7, W / 2 - 84), BOSS_Y + Math.sin(e.pt * 1.4) * 16] : [W / 2 + Math.sin(e.pt * .9) * 118, BOSS_Y + 18 + Math.sin(e.pt * 1.8) * 30]; },
    tick(e, dt) {
      const f = e.hp > e.maxHp * .67 ? 0 : e.hp > e.maxHp * .34 ? 1 : 2;
      if (f > e.form) { e.form = f; e.bt = 1.6; e.pat = 2; whiteFlash = .4; addShake(10); Sfx.play('boss'); for (const b of ebullets) b.dead = true; hazards.length = 0; explode(e.x, e.y, '255,120,90', 30, 300); if (f === 1) showBanner('星际霸主', '第二形态！', '#ff9a5a', 1.8); }
    },
    atk: [0, 1, 2].map(i => (e, rage, k, lv, rgb) => OVERLORD[e.form][i](e, k, lv, rgb))
  }
};

function groundFire(e) {   // 地面单位开火
  const k = diffK(), rgb = ET[e.type].rgb, mx = e.x + Math.cos(e.aim) * e.r * 1.3, my = e.y + Math.sin(e.aim) * e.r * 1.3, fast = e.elite ? .75 : 1;
  e.flashT = .1;
  if (e.type === 19) { spawnEB(mx, my, Math.cos(e.aim) * 150 * k, Math.sin(e.aim) * 150 * k, 5, rgb); e.ct = 2.3 * D.ivl * fast; Sfx.play('eshoot'); }
  else if (e.type === 20) { spawnEB(mx, my, Math.cos(e.aim) * 125 * k, Math.sin(e.aim) * 125 * k, 7.5, rgb); e.ct = 2.7 * D.ivl * fast; Sfx.play('eshoot2'); }
  else if (e.type === 21) {
    spawnEB(mx, my, Math.cos(e.aim) * 70, Math.sin(e.aim) * 70, 5.5, '255,150,70', { kind: 'emissile', homing: true, shot: true, turn: 1.9, accel: 90, maxSp: 165 * k, life: 4.2, age: 0, trailT: 0 });
    e.ct = 4.3 * D.ivl * fast; Sfx.play('emissile');
  } else if (e.type === 23) {   // 电磁塔：向四周放出一圈电弧弹
    const cnt = DL >= 14 ? 10 : 8, off = rand(0, TAU);
    for (let i = 0; i < cnt; i++) { const a = off + i * TAU / cnt; spawnEB(e.x, e.y, Math.cos(a) * 104 * k, Math.sin(a) * 104 * k, 4.5, rgb); }
    e.ct = 3.4 * D.ivl * fast; Sfx.play('spiral');
  } else {   // 高射炮：炮弹飞到玩家当前位置后爆成破片
    const d = Math.hypot(P.x - mx, P.y - my) || 1;
    spawnEB(mx, my, (P.x - mx) / d * 190, (P.y - my) / d * 190, 6.5, '255,220,120', { kind: 'mine', shot: true, t: d / 190, beep: true });
    e.ct = 3.2 * D.ivl * fast; Sfx.play('mineDrop');
  }
}
function updateHazards(dt) {   // 带预警的光束：预警结束后才造成伤害
  const live = P.mode === 'ship' || P.mode === 'possessed', [ax, ay] = hitAxes();
  for (const h of hazards) {
    h.t += dt;
    if (h.t >= h.warn) {
      if (!h.fired) { h.fired = true; addShake(2); if (h.cx !== undefined) { explode(h.cx, h.cy, h.rgb, 12, 190); Sfx.play('minePop'); } else Sfx.play('beam'); }
      const hit = h.cx !== undefined ? Math.hypot(P.x - h.cx, P.y - h.cy) < h.r + 4 : h.hy !== undefined ? Math.abs(P.y - h.hy) < h.w / 2 + ay - 3 : Math.abs(P.x - h.x) < h.w / 2 + ax - 3;
      if (live && hit) hurtPlayer();
    }
  }
  compact(hazards, h => h.t >= h.warn + h.dur);
}

function spawnPowerup(x, y, kind) {
  if (!kind) {
    const w = { multi: 16, laser: 11, lock: 11, blast: 11, pod: P.pod < 3 ? 9 : 2, shield: 15, speed: 15, life: P.lives < MAX_LIVES || P.mode !== 'ship' ? (P.mode !== 'ship' ? 70 : 10) : 0 };
    let tot = 0; for (const k in w) tot += w[k];
    let r = Math.random() * tot; kind = 'multi';
    for (const k in w) { if ((r -= w[k]) <= 0) { kind = k; break; } }
  }
  powerups.push({ x, y, x0: x, vy: 62, kind, t: 0, dead: false });
}
function dropFor(e) {
  const chance = [.1, .18, .5, .14, 1, .25, .32, .38, .35, .55, .35, .35, .48, .35, .35, .03, .5, .3, .16, .3, .42, .4, .4, .4, 1, .5, .38][e.type] * D.drop * (1 + pk('luck') * .3);
  pity++;
  if (Math.random() < chance || pity >= D.pity) { pity = 0; spawnPowerup(e.x, e.y); }
}
// 拾取弹种：切换为该弹种并升一级；其他弹种的等级原样保留
function gainWeapon(t, note) {
  const wt = WT[t], lv = P.wl[t];
  P.wt = t;
  if (lv >= 5) { score += 200; popup(P.x, P.y - 34, wt.name + ' MAX +200', wt.col, 14); }
  else { P.wl[t] = lv + 1; popup(P.x, P.y - 34, wt.name + ' Lv' + P.wl[t] + note, wt.col, 14); }
}
function collect(pu) {
  const info = PU[pu.kind];
  Sfx.play(pu.kind === 'shield' ? 'shield' : 'pickup'); vibrate(12);
  spark(pu.x, pu.y, info.rgb, 10);
  rings.push({ x: P.x, y: P.y, r: 10, grow: 150, life: 0, max: .4, rgb: info.rgb, w: 2.5 });
  switch (pu.kind) {
    case 'multi': case 'laser': case 'lock': case 'blast':
      if (P.mode !== 'ship' && pu.kind === 'multi') { P.extra = Math.min(2, P.extra + 1); popup(P.x, P.y - 34, '弹幕 +1', info.col, 14); }
      else gainWeapon(WPU[pu.kind], P.mode === 'ship' ? '' : '（复活后生效）');
      break;
    case 'pod':
      if (P.pod >= 3) { score += 300; popup(P.x, P.y - 34, '+300', info.col, 14); }
      else {
        P.pod++;
        if (P.pod === 1) { P.podX = [P.x - 20, P.x + 20]; P.podY = [P.y + 8, P.y + 8]; P.podCd = [0, POD.iv[0] / 2]; popup(P.x, P.y - 34, '跟踪导弹 ×2', info.col, 14); }
        else popup(P.x, P.y - 34, '跟踪导弹 Lv' + P.pod, info.col, 14);
      }
      break;
    case 'shield': P.shield = Math.max(P.shield, 10); popup(P.x, P.y - 34, '护盾', info.col, 14); break;
    case 'speed': P.speedT = 10; popup(P.x, P.y - 34, '速度提升', info.col, 14); break;
    case 'life':
      if (P.mode !== 'ship') revive();
      else if (P.lives < MAX_LIVES) { P.lives++; popup(P.x, P.y - 34, '生命 +1', info.col, 14); }
      else { score += 300; popup(P.x, P.y - 34, '+300', info.col, 14); }
      break;
  }
}

/* =====================================================================
 *  玩家：受伤 / 灵魂 / 夺舍 / 复活 / 技能
 * ===================================================================== */
function hurtPlayer() {
  if (P.mode === 'soul' || P.mode === 'dead' || P.inv > 0) return;
  if (P.shield > 0) {
    P.shield -= 2.2; P.inv = .25; Sfx.play('shield');
    rings.push({ x: P.x, y: P.y, r: 24, grow: 90, life: 0, max: .3, rgb: '120,255,180', w: 3 });
    spark(P.x, P.y - 20, '120,255,180', 8);
    if (P.shield <= 0) { P.shield = 0; popup(P.x, P.y - 36, '护盾破碎', '#9fffc8', 13); }
    return;
  }
  if (P.mode === 'possessed') {
    combo = 0; const g = P.ghost; g.hp--; P.inv = .6; hurtFlash = .5; addShake(7); Sfx.play('hurt'); vibrate(40);
    spark(P.x, P.y, SKILL[g.type].rgb, 10);
    if (g.hp <= 0) ghostDie();
    return;
  }
  combo = 0; P.lives--; P.inv = D.inv; hurtFlash = .6; addShake(10);   // 受伤只扣命；弹种等级在死亡（生命耗尽）时才清零
  Sfx.play('hurt'); vibrate([60, 30, 60]);
  explode(P.x, P.y, '255,120,100', 14, 200);
  if (P.lives <= 0) enterSoul();
}
function enterSoul() {
  deaths++;
  P.mode = 'soul'; P.lives = 0; P.soulE = 100; P.ghost = null; P.inv = 0; P.star = 0; P.extra = 0; P.od = 0;
  if (pk('keep')) {   // 黑匣子：保留一半
    for (const k2 in P.wl) P.wl[k2] = Math.max(k2 === 'normal' ? 1 : 0, Math.floor(P.wl[k2] / 2));
    if (!P.wl[P.wt]) P.wt = 'normal'; P.pod = Math.floor(P.pod / 2);
  } else { P.wl = { normal: 1, laser: 0, lock: 0, blast: 0 }; P.wt = 'normal'; P.pod = 0; }   // 死亡惩罚：弹种等级和导弹吊舱清零
  popup(P.x, P.y - 40, pk('keep') ? '弹种等级减半' : '弹种等级清零', '#ff9a9a', 14, 1.6);
  P.vx = P.vy = 0;
  explode(P.x, P.y, '255,140,90', 44, 330); addShake(16); whiteFlash = .55;
  Sfx.play('bigboom'); Sfx.play('soul'); vibrate([100, 50, 200]);
  showBanner('灵魂模式', '撞向敌机，夺舍它的飞机！', '#8ff0ff', 3);
}
const soulCost = () => SOUL_COST - pk('soul') * 8;
const SOUL_COST = 34;   // 夺舍的飞机被击毁时消耗的魂能；魂能耗尽则游戏结束
function ghostDie() {
  const sk = SKILL[P.ghost.type];
  explode(P.x, P.y, sk.rgb, 30, 280); addShake(12); Sfx.play('boom'); Sfx.play('soul');
  P.soulE = Math.max(0, P.soulE - soulCost());
  if (P.soulE <= 0) { endGame(); return; }
  P.mode = 'soul'; P.ghost = null; P.extra = 0; P.od = 0; P.vx = P.vy = 0;
  showBanner('灵魂离体', '魂能 -' + soulCost() + '，寻找下一架敌机！', '#8ff0ff', 2);
}
function possess(e) {
  e.dead = true;
  const sk = SKILL[e.type];
  P.mode = 'possessed';
  const gh = sk.hp + Math.max(0, Math.floor((DL - 1) / 6)) + pk('soul') * 2 + (e.elite ? 2 : 0);
  P.ghost = { type: e.type, hp: gh, maxHp: gh };
  P.extra = 0; P.od = 0; P.inv = 1.2; P.fireCd = .1;
  P.x = e.x; P.y = clamp(e.y, minY(), maxY());
  if (sk.shield) P.shield = Math.max(P.shield, sk.shield);   // 护盾舰：连同护盾一起夺取
  for (let i = 0; i < 3; i++) rings.push({ x: P.x, y: P.y, r: 6, grow: 150 + i * 90, life: -i * .08, max: .5, rgb: '140,240,255', w: 3 });
  explode(P.x, P.y, '150,240,255', 26, 260);
  whiteFlash = .4; addShake(8); Sfx.play('possess'); vibrate([30, 20, 60]);
  showBanner('夺舍成功', '获得技能：' + sk.name, '#8ff0ff', 2.2);
}
function revive() {
  if (P.mode === 'possessed') explode(P.x, P.y, SKILL[P.ghost.type].rgb, 24, 240);
  P.mode = 'ship'; P.lives = 2; P.extra = 0; P.ghost = null; P.od = 0;
  P.shield = Math.max(P.shield, 4); P.inv = 2; P.soulE = 100;
  for (let i = 0; i < 3; i++) rings.push({ x: P.x, y: P.y, r: 6, grow: 170 + i * 80, life: -i * .08, max: .55, rgb: '255,230,140', w: 3 });
  whiteFlash = .5; Sfx.play('revive'); vibrate(80);
  showBanner('复活！', '重返战场', '#ffe28a', 2);
}
const NOVA_INV = 3;   // 释放星爆后的基础无敌时间（秒）
function useSkill() {
  if (state !== 'playing' || resumeT > 0 || P.mode === 'dead') return;
  if (P.mode === 'soul' || P.energy < 100) {
    Sfx.play('deny'); btnB.classList.remove('shake'); void btnB.offsetWidth; btnB.classList.add('shake'); return;
  }
  P.energy = 0;
  if (P.mode === 'ship') {
    // 星爆：冲击波扫过之处，Boss 以外的敌人全部秒杀、敌弹全部清除；自己获得几秒无敌（「星爆护体」强化可延长）
    const invT = NOVA_INV + pk('nova');
    novas.push({ x: P.x, y: P.y, r: 14, hit: new Set() });
    hazards.length = 0; P.star = invT; P.starMax = invT; P.inv = Math.max(P.inv, invT);
    whiteFlash = .45; addShake(12); Sfx.play('nova'); vibrate(60);
    popup(P.x, P.y - 40, '星爆！无敌 ' + invT + ' 秒', '#fff0a0', 16, 1.4);
  } else {
    P.od = 4; Sfx.play('pickup'); popup(P.x, P.y - 40, '超载！', '#ff9a5a', 16); vibrate(40);
    rings.push({ x: P.x, y: P.y, r: 10, grow: 200, life: 0, max: .45, rgb: '255,150,80', w: 3 });
  }
}

/* =====================================================================
 *  更新
 * ===================================================================== */
const minY = () => safeTop + 112;
const maxY = () => H - 124;

function updatePlayer(dt) {
  if (P.mode === 'dead') return;
  // 方向输入（圆盘模拟量 + 键盘）
  let ix = input.jx + input.kx, iy = input.jy + input.ky;
  const mag = Math.hypot(ix, iy);
  if (mag > 1) { ix /= mag; iy /= mag; }
  let sp = BASE_SPEED * (P.speedT > 0 ? 1.5 : 1) * (1 + pk('speed') * .08);
  if (P.mode === 'soul') sp = BASE_SPEED * 1.3;
  else if (P.mode === 'possessed') sp *= SKILL[P.ghost.type].move;
  // 指数平滑：起步/刹车都带惯性，手感顺滑
  const k = 1 - Math.exp(-dt * (mag > .02 ? 13 : 9));
  P.vx += (ix * sp - P.vx) * k; P.vy += (iy * sp - P.vy) * k;
  // 灵魂：轻微吸附最近的可夺舍敌机，方便触屏对准
  if (P.mode === 'soul') {
    let best = null, bd = 90;
    for (const e of enemies) { if (e.dead || !SKILL[e.type] || e.y < 0) continue; const d = Math.hypot(e.x - P.x, e.y - P.y); if (d < bd) { bd = d; best = e; } }
    if (best) { const pull = (1 - bd / 90) * 360 * dt, a = Math.atan2(best.y - P.y, best.x - P.x); P.vx += Math.cos(a) * pull; P.vy += Math.sin(a) * pull; }
  }
  P.x = clamp(P.x + P.vx * dt, 0, W);   // 中心可到屏幕边缘，即半个机身出屏，子弹能打到边缘的敌机
  P.y = clamp(P.y + P.vy * dt, minY(), maxY());
  P.tilt = lerp(P.tilt, clamp(P.vx / (BASE_SPEED * 1.2), -1, 1), 1 - Math.exp(-dt * 12));

  P.inv = Math.max(0, P.inv - dt); P.star = Math.max(0, P.star - dt); P.shield = Math.max(0, P.shield - dt);
  P.speedT = Math.max(0, P.speedT - dt); P.od = Math.max(0, P.od - dt); P.muz = Math.max(0, P.muz - dt);
  if (P.mode !== 'soul') P.energy = Math.min(100, P.energy + dt * 3.4 * (1 + pk('energy') * .16));

  // 魂能不会随时间减少：只在夺舍的飞机被击毁时消耗（见 ghostDie），击毁敌机可回复
  // 速度提升：尾迹
  if (P.speedT > 0 && P.mode !== 'soul' && (P.trailT -= dt) <= 0) {
    P.trailT = .03;
    particles.push({ x: P.x - 8, y: P.y + 22, vx: 0, vy: 140, life: 0, max: .32, size: 6, rgb: '255,220,90', drag: 0 });
    particles.push({ x: P.x + 8, y: P.y + 22, vx: 0, vy: 140, life: 0, max: .32, size: 6, rgb: '255,220,90', drag: 0 });
  }
  if (P.mode === 'soul' && (P.wispT -= dt) <= 0) {
    P.wispT = .035;
    particles.push({ x: P.x + rand(-6, 6), y: P.y + 12, vx: rand(-12, 12), vy: rand(30, 70), life: 0, max: .55, size: rand(5, 9), rgb: '150,230,255', drag: .5 });
  }

  if (P.mode === 'possessed' && SKILL[P.ghost.type].regen && P.ghost.hp < P.ghost.maxHp && (P.ghost.rg = (P.ghost.rg || 0) + dt) >= SKILL[P.ghost.type].regen) {
    P.ghost.rg = 0; P.ghost.hp++; popup(P.x, P.y - 30, '修复 +1', '#9dffd0', 12);   // 修复机技能：自动修复
  }
  // 夺舍判定
  if (P.mode === 'soul') {
    for (const e of enemies) {
      if (e.dead || e.y < 4) continue;
      const d = Math.hypot(e.x - P.x, e.y - P.y);
      if (d < e.r + 13) {
        if (!SKILL[e.type]) { if (e.type === 4 && (e.noticeT = (e.noticeT || 0) - dt) <= 0) { popup(P.x, P.y - 26, '无法夺舍 BOSS', '#ff9ab0', 12); e.noticeT = 1.2; } continue; }
        possess(e); break;
      }
    }
  }

  // 导弹吊舱：跟随机体（带一点滞后）；按住射击时左右交替向最近敌机发射跟踪导弹
  {
    const off = P.mode === 'possessed' ? ET[P.ghost.type].r + 20 : 34;
    for (let i = 0; i < 2; i++) {
      if (P.mode === 'soul') { P.podX[i] = P.x; P.podY[i] = P.y; continue; }
      const k2 = 1 - Math.exp(-dt * 14);
      P.podX[i] += (clamp(P.x + (i ? 1 : -1) * off, 8, W - 8) - P.podX[i]) * k2; P.podY[i] += (P.y + 8 - P.podY[i]) * k2;
    }
    if (P.pod > 0 && (P.mode === 'ship' || P.mode === 'possessed')) {
      const li = P.pod - 1;
      for (let i = 0; i < 2; i++) {
        P.podCd[i] -= dt;
        if (P.podCd[i] <= 0 && fireHeld()) {
          const tg = nearestEnemy(P.podX[i], P.podY[i]);
          if (tg) { fireMissile(i, li, tg); P.podCd[i] = POD.iv[li]; P.podCd[1 - i] = Math.max(P.podCd[1 - i], POD.iv[li] / 2); }
          else P.podCd[i] = .1;
        }
      }
    }
  }

  // 射击
  P.fireCd -= dt;
  if (fireHeld() && P.fireCd <= 0 && (P.mode === 'ship' || P.mode === 'possessed')) playerFire();
}

function setFireCd(iv) { P.fireCd = Math.max(P.fireCd, -.04) + iv / (1 + pk('rate') * .12); }   // 保留帧间余量：射速不随刷新率变化
function nearestEnemy(x, y) {
  let best = null, bd = 1e12;
  for (const e of enemies) { if (!validTarget(e)) continue; const d = (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y); if (d < bd) { bd = d; best = e; } }
  return best;
}
function validTarget(e) { return !!e && !e.dead && !e.cloaked && e.y > -8 && e.y < H + 8 && e.x > -8 && e.x < W + 8; }
function pickTargets(n) {   // 离机体最近的 n 个目标，锁定弹逐发分配
  const c = enemies.filter(validTarget).sort((a, b) => (a.x - P.x) ** 2 + (a.y - P.y) ** 2 - ((b.x - P.x) ** 2 + (b.y - P.y) ** 2));
  return c.slice(0, n);
}

function playerFire() {
  const boost = (P.speedT > 0 ? 1.25 : 1), list = [];
  if (P.mode === 'ship') {
    const t = P.wt, lv = P.wl[t], li = lv - 1;
    if (t === 'normal') {
      const pat = SHOTS[lv];
      setFireCd(.17 / boost);
      for (const s of pat) {
        const a = s[1] * Math.PI / 180;
        bullets.push({ x: P.x + s[0], y: P.y - 26, vx: Math.sin(a) * 640, vy: -Math.cos(a) * 640, r: 4, dmg: 1.25, pierce: 0, rgb: PLAYER_RGB, dead: false, last: null, a });
        list.push([s[0], 0]);
      }
      P.muzRgb = '255,225,140'; Sfx.play('shoot');
    } else if (t === 'laser') {
      setFireCd(LASER.iv / boost);
      for (const dx of LASER.beams[li]) {
        bullets.push({ kind: 'laser', x: P.x + dx, y: P.y - 28, vx: 0, vy: -1500, r: LASER.r[li], len: 70, dmg: LASER.dmg[li], pierce: 0, hits: [], rgb: '255,110,255', dead: false, last: null, a: 0 });
        list.push([dx, 0]);
      }
      P.muzRgb = '255,140,255'; Sfx.play('laser');
    } else if (t === 'lock') {
      setFireCd(LOCKW.iv / boost);
      const n = LOCKW.n[li], tg = pickTargets(n);
      for (let i = 0; i < n; i++) {
        const c = i - (n - 1) / 2, a = c * .3, dx = c * 7;
        bullets.push({ kind: 'lock', x: P.x + dx, y: P.y - 24, vx: Math.sin(a) * 470, vy: -Math.cos(a) * 470, r: 4, dmg: LOCKW.dmg[li], pierce: 0, rgb: '110,255,160', dead: false, last: null, a,
          homing: true, target: tg.length ? tg[i % tg.length] : null, turn: LOCKW.turn[li], life: 2.2, age: 0 });
        list.push([dx, 0]);
      }
      P.muzRgb = '140,255,180'; Sfx.play('lock');
    } else {   // blast
      setFireCd(BLAST.iv / boost);
      const n = BLAST.shells[li];
      for (let i = 0; i < n; i++) {
        const c = i - (n - 1) / 2, a = c * .1, dx = c * 14;
        bullets.push({ kind: 'blast', x: P.x + dx, y: P.y - 26, vx: Math.sin(a) * 520, vy: -Math.cos(a) * 520, r: 7, br: BLAST.radius[li], bd: BLAST.dmg[li], dmg: BLAST.dmg[li], pierce: 0, rgb: '255,160,70', dead: false, last: null, a });
        list.push([dx, 0]);
      }
      P.muzRgb = '255,180,90'; Sfx.play('blast');
    }
  } else {
    const sk = SKILL[P.ghost.type];
    setFireCd(sk.interval / boost / (P.od > 0 ? 2.2 : 1));
    const n = Math.min(5, sk.shots + P.extra);
    for (let i = 0; i < n; i++) {
      const c = i - (n - 1) / 2, dx = sk.spread ? c * 5 : c * 9;
      if (sk.kind === 'laser') {
        bullets.push({ kind: 'laser', x: P.x + dx, y: P.y - 22, vx: 0, vy: -1500, r: sk.br, len: 70, dmg: sk.dmg, pierce: 0, hits: [], rgb: sk.rgb, dead: false, last: null, a: 0 });
      } else if (sk.kind === 'missile') {
        const ang = -Math.PI / 2 + c * .55, vx = Math.cos(ang) * 220, vy = Math.sin(ang) * 220;
        bullets.push({ kind: 'missile', x: P.x + c * 10, y: P.y - 18, vx, vy, r: 4, dmg: sk.dmg, pierce: 0, rgb: '255,190,100', dead: false, last: null, a: Math.atan2(vx, -vy),
          homing: true, target: nearestEnemy(P.x, P.y - 40), turn: 8, accel: 900, maxSp: 540, life: 3, age: 0, trailT: 0 });
      } else {
        const a = (sk.spread || (P.extra > 0 && sk.shots === 1 ? .12 : 0)) * c;
        bullets.push({ x: P.x + dx, y: P.y - 22, vx: Math.sin(a) * sk.speed, vy: -Math.cos(a) * sk.speed, r: sk.br, dmg: sk.dmg, pierce: sk.pierce, rgb: sk.rgb, dead: false, last: null, a });
      }
      list.push([dx, 0]);
    }
    P.muzRgb = '255,225,140'; Sfx.play(sk.kind === 'laser' ? 'laser' : sk.kind === 'missile' ? 'missile' : 'shoot');
  }
  P.muzList = list; P.muz = .07;
}

function fireMissile(i, li, tg) {   // 吊舱发射一枚跟踪小导弹
  const side = i ? 1 : -1, x = P.podX[i], y = P.podY[i] - 10, ang = -Math.PI / 2 + side * .85, vx = Math.cos(ang) * 170, vy = Math.sin(ang) * 170;
  bullets.push({ kind: 'missile', x, y, vx, vy, r: 4, dmg: POD.dmg[li], pierce: 0, rgb: '255,190,100', dead: false, last: null, a: Math.atan2(vx, -vy),
    homing: true, target: tg, turn: 8, accel: 900, maxSp: 540, life: 3, age: 0, trailT: 0 });
  spark(x, y - 6, '255,200,120', 3); Sfx.play('missile');
}

function hitEnemy(e, dmg, x, y, rgb) {
  dmg *= 1 + pk('dmg') * .15;
  if (e.shield > 0) {   // 护盾舰：护盾先吸收伤害，破盾后才伤及机体
    e.shield -= dmg; e.shieldT = .15;
    if (e.shield <= 0) {
      e.shield = 0; explode(e.x, e.y, '120,230,255', 12, 190);
      rings.push({ x: e.x, y: e.y, r: e.r, grow: 170, life: 0, max: .3, rgb: '170,240,255', w: 3 }); Sfx.play('shieldBreak');
    } else { spark(x, y, '140,235,255', 3); Sfx.play('shieldHit'); }
    return;
  }
  e.hp -= dmg; e.hitT = .07;
  spark(x, y, rgb, 3); Sfx.play('hit');
  if (e.hp <= 0) killEnemy(e);
}
function killEnemy(e) {
  if (e.dead) return;
  e.dead = true;
  const def = ET[e.type];
  combo++; comboT = 2.6; if (combo > bestCombo) bestCombo = combo;
  const gain = Math.round(def.score * (e.elite ? 3 : 1) * comboMul());
  score += gain; popup(e.x, e.y - 8, '+' + gain, e.type === 4 || e.elite ? '#ffd24a' : '#ffe28a', e.type === 4 ? 20 : e.elite ? 16 : 13);
  kills++;
  if (P.mode !== 'soul') P.energy = Math.min(100, P.energy + (e.type === 4 ? 0 : 4 * (1 + pk('energy') * .16)));
  if (P.mode === 'possessed') P.soulE = Math.min(100, P.soulE + (e.type === 4 ? 25 : 6));
  if (e.type === 4) {
    for (let i = 0; i < 9; i++) later.push({ t: i * .11, fn: () => { explode(e.x + rand(-50, 50), e.y + rand(-34, 34), pick(['255,120,160', '255,200,100', '255,255,255']), 22, 300); addShake(10); Sfx.play('bigboom'); } });
    for (let i = 0; i < 3; i++) spawnPowerup(e.x + (i - 1) * 40, e.y, i === 0 ? pick(['multi', 'laser', 'lock', 'blast']) : i === 1 && P.pod < 3 ? 'pod' : undefined);
    whiteFlash = .5;
    for (const b of ebullets) { if (!b.dead) { b.dead = true; spark(b.x, b.y, b.rgb, 2); } }   // Boss 被击败：清空全屏敌弹
    hazards.length = 0;
    if (isBossWave(wave) && stageOf(wave) === NSTAGE - 1 && !enemies.some(o => o !== e && !o.dead && o.type === 4)) {   // 最后一关的 Boss：通关
      for (const o of enemies) if (!o.dead && o !== e) { o.dead = true; explode(o.x, o.y, ET[o.type].rgb, 10, 160); }
      P.inv = 99; later.push({ t: 2.6, fn: startVictory });
    } else later.push({ t: 1.8, fn: offerPerks });
  } else {
    explode(e.x, e.y, def.rgb, Math.round(10 + def.r * .7), 150 + def.r * 4);
    Sfx.play(def.sfx);
    if (e.type === 2 || e.type === 9 || e.type === 12) addShake(5);
    if (e.type === 10 && !e.noSplit) {   // 分裂机：裂成两架侦察机
      for (const sd of [-1, 1]) spawnEnemy({ type: 0, x: clamp(e.x + sd * 20, 14, W - 14), y: e.y, ai: 'sine', vy: 105, amp: 26, f: 2.4, ph: sd > 0 ? 0 : Math.PI, noSplit: true });
      Sfx.play('split');
    }
    if (e.type === 18 && !e.small) {   // 陨石碎成两块
      for (const sd of [-1, 1]) spawnEnemy({ type: 18, small: true, x: e.x + sd * 8, y: e.y, ai: 'rock', vx: sd * rand(40, 80), vy: e.vy + rand(0, 30), vr: rand(-2.5, 2.5) });
    }
    if (e.type === 24) { pity = 0; spawnPowerup(e.x - 18, e.y); spawnPowerup(e.x + 18, e.y); popup(e.x, e.y - 26, '补给到手！', '#ffe08a', 15, 1.4); addShake(5); }   // 运输机：必掉两个道具
    else if (e.elite) { pity = 0; spawnPowerup(e.x, e.y); addShake(4); }
    else if (P.mode === 'possessed' && Math.random() < .07) spawnPowerup(e.x, e.y, 'life'); else dropFor(e);
  }
}

function segDist2(px, py, ax, ay, bx, by) {   // 点到线段 AB 的距离平方
  const abx = bx - ax, aby = by - ay, l2 = abx * abx + aby * aby;
  let t = l2 ? ((px - ax) * abx + (py - ay) * aby) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + abx * t - px, cy = ay + aby * t - py; return cx * cx + cy * cy;
}
function steerBullet(b, dt) {   // 锁定弹 / 小导弹：朝目标转向
  b.age += dt;
  if (b.age > b.life) { b.dead = true; if (b.kind === 'missile') explode(b.x, b.y, '255,190,90', 5, 90); return; }
  if (!validTarget(b.target)) b.target = nearestEnemy(b.x, b.y);
  let sp = Math.hypot(b.vx, b.vy) || 1;
  if (b.accel) sp = Math.min(b.maxSp, sp + b.accel * dt);
  let cur = Math.atan2(b.vy, b.vx);
  const tg = b.target;
  if (tg) {
    if (b.kind === 'lock') tg.lockT = .12;
    const dx = tg.x - b.x, dy = tg.y - b.y;
    let d = Math.atan2(dy, dx) - cur;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    const step = b.turn * (dx * dx + dy * dy < 3600 ? 1.8 : 1) * dt;   // 靠近目标时加大转向，避免绕圈
    cur += clamp(d, -step, step);
  }
  b.vx = Math.cos(cur) * sp; b.vy = Math.sin(cur) * sp;
  b.a = Math.atan2(b.vx, -b.vy);
  if (b.kind === 'missile' && (b.trailT -= dt) <= 0 && particles.length < 400) {
    b.trailT = .028;
    particles.push({ x: b.x - Math.cos(cur) * 9, y: b.y - Math.sin(cur) * 9, vx: rand(-14, 14), vy: rand(-14, 14), life: 0, max: .38, size: 5.5, rgb: '255,170,80', drag: 3 });
  }
}
function blastAt(b, direct) {   // 爆破弹：范围爆炸，同时清除附近敌弹
  const R = b.br, dmg = b.bd;
  explode(b.x, b.y, '255,170,70', 12 + (R / 8 | 0), 170);
  rings.push({ x: b.x, y: b.y, r: R * .35, grow: R * 2.4, life: 0, max: .28, rgb: '255,215,120', w: 4 });
  for (const e of enemies) {
    if (e.dead || e === direct) continue;
    if (Math.hypot(e.x - b.x, e.y - b.y) < R + e.r * .6) hitEnemy(e, dmg * .75, e.x, e.y, '255,180,80');
  }
  if (direct) hitEnemy(direct, dmg, b.x, b.y, '255,180,80');
  for (const eb of ebullets) if (!eb.dead && Math.hypot(eb.x - b.x, eb.y - b.y) < R * .85) { eb.dead = true; spark(eb.x, eb.y, eb.rgb, 2); }
  addShake(2.5); Sfx.play('boom');
}
function updateBullets(dt) {
  for (const b of bullets) {
    const px = b.x, py = b.y;
    if (b.homing) { steerBullet(b, dt); if (b.dead) continue; }
    b.x += b.vx * dt; b.y += b.vy * dt;
    const len = b.len || 0;
    if (b.y + len < -10 || b.y > H + 30 || b.x < -30 || b.x > W + 30) { b.dead = true; continue; }
    // 扫掠碰撞：检测本帧经过的整条线段，高速弹（激光）和低帧率下也不会穿过敌机
    const sp = Math.hypot(b.vx, b.vy) || 1, tx = px - b.vx / sp * len, ty = py - b.vy / sp * len;
    for (const e of enemies) {
      if (e.dead || e.y < -16 || e.cloaked) continue;
      if (b.kind === 'laser' ? b.hits.includes(e) : b.last === e) continue;
      const rr = e.r + b.r;
      let segHit = false;
      if (e.segs) for (const q of e.segs) if (segDist2(q[0], q[1], b.x, b.y, tx, ty) < (15 + b.r) * (15 + b.r)) { segHit = true; break; }   // 炎龙的身体也能打
      if (segHit && e.segBlock && b.kind !== 'laser') { b.dead = true; spark(b.x, b.y, '200,245,255', 3); Sfx.play('shieldHit'); break; }   // 水晶护卫挡住子弹（激光可以穿透）
      if (segHit && e.segBlock) segHit = false;
      if (segHit || segDist2(e.x, e.y, b.x, b.y, tx, ty) < rr * rr) {
        if (b.kind === 'blast') { blastAt(b, e); b.dead = true; break; }
        hitEnemy(e, b.dmg, b.x, b.y, b.rgb);
        if (b.kind === 'missile') explode(b.x, b.y, '255,190,90', 6, 110);
        if (b.kind === 'laser') b.hits.push(e);          // 激光穿透所有敌机，每个敌机每束只受一次伤害
        else { b.last = e; if (b.pierce > 0) b.pierce--; else { b.dead = true; break; } }
      }
    }
    if (b.dead) continue;
    for (const eb of ebullets) {   // 击落水雷 / 敌方导弹
      if (eb.dead || !eb.shot) continue;
      const rr = eb.r + b.r + 2;
      if (segDist2(eb.x, eb.y, b.x, b.y, tx, ty) < rr * rr) {
        eb.dead = true; explode(eb.x, eb.y, '255,170,90', 6, 110); Sfx.play('hit'); score += 5;
        if (b.kind === 'blast') { blastAt(b, null); b.dead = true; break; }
        if (b.kind !== 'laser') { if (b.pierce > 0) b.pierce--; else { b.dead = true; break; } }
      }
    }
  }
}

function updateEnemies(dt) {
  for (const e of enemies) {
    if (e.dead) continue;
    e.age += dt; e.hitT = Math.max(0, e.hitT - dt); e.flashT = Math.max(0, e.flashT - dt); if (e.lockT) e.lockT = Math.max(0, e.lockT - dt); if (e.shieldT) e.shieldT = Math.max(0, e.shieldT - dt);
    if (e.type === 14 && e.y > 20) {   // 修复机：每隔一会修复附近受损最重的敌机
      e.ct -= dt; if (e.healT > 0) e.healT -= dt;
      if (e.ct <= 0) {
        e.ct = 1.3; let best = null, bf = 1;
        for (const o of enemies) { if (o === e || o.dead || o.type === 4 || o.type === 18 || o.hp >= o.maxHp || Math.hypot(o.x - e.x, o.y - e.y) > 190) continue; const f = o.hp / o.maxHp; if (f < bf) { bf = f; best = o; } }
        if (best) { best.hp = Math.min(best.maxHp, best.hp + 2); e.healTarget = best; e.healT = .4; Sfx.play('heal'); }
      }
    } else if (e.type === 16 && e.y > 20) {   // 引力机：把玩家拉向自己，并发射缓慢的重力弹
      if (P.mode === 'ship' || P.mode === 'possessed') { const dx = e.x - P.x, dy = e.y - P.y, d = Math.hypot(dx, dy) || 1; if (d < 280) { const f = (1 - d / 280) * 1500 * dt; P.vx += dx / d * f; P.vy += dy / d * f; } }
      e.ct -= dt;
      if (e.ct <= 0 && P.mode !== 'dead') { e.ct = 2.6 * D.ivl; e.flashT = .09; Sfx.play('eshoot2'); const a = Math.atan2(P.y - e.y, P.x - e.x); spawnEB(e.x, e.y + 10, Math.cos(a) * 92 * diffK(), Math.sin(a) * 92 * diffK(), 9, '170,110,255'); }
    } else if (e.type === 17) {   // 浮游炮台：旋转着向四个方向开火
      e.rot += dt * 1.1;
      if (e.y > 20 && e.y < H - 160 && (e.ct -= dt) <= 0 && P.mode !== 'dead') {
        e.ct = 1.7 * D.ivl; Sfx.play('eshoot');
        for (let i = 0; i < 4; i++) { const a = e.rot + i * Math.PI / 2 - Math.PI / 2; spawnEB(e.x + Math.cos(a) * 16, e.y + Math.sin(a) * 16, Math.cos(a) * 125 * diffK(), Math.sin(a) * 125 * diffK(), 5, '255,200,120'); }
      }
    }
    if (e.type === 11) {   // 隐形机：隐身 / 现身循环，现身后扇形齐射
      e.ct -= dt;
      if (e.cloaked) { e.alpha = Math.max(.07, e.alpha - dt * 3); if (e.ct <= 0) { e.cloaked = false; e.ct = 1.8; e.fired = false; Sfx.play('decloak'); } }
      else {
        e.alpha = Math.min(1, e.alpha + dt * 4);
        if (!e.fired && e.ct < 1.2 && e.y > 10 && P.mode !== 'dead') { e.fired = true; e.flashT = .09; Sfx.play('eshoot'); for (let i = -2; i <= 2; i++) aimEB(e.x, e.y + 12, 185 * diffK(), i * .2, 5, '150,160,255'); }
        if (e.ct <= 0) { e.cloaked = true; e.ct = 2.1; Sfx.play('cloak'); }
      }
    } else if (e.type === 25 && e.y > 30 && P.mode !== 'dead') {   // 无人机母舰：每隔一会放出两架蜂群机
      if ((e.ct -= dt) <= 0) {
        e.ct = 3.3 * D.ivl; const have = enemies.filter(o => !o.dead && o.type === 15).length;
        for (let i = 0; i < 2 && have + i < 8; i++) spawnEnemy({ type: 15, x: e.x + (i ? 15 : -15), y: e.y + 16, ai: 'swarm', th: Math.PI / 2 + (i ? -.8 : .8), sp: 150 * D.spd, noSplit: true });
        e.flashT = .09; Sfx.play('split');
      }
    } else if (e.type === 26) {   // 闪电机：现身 -> 三连射 -> 瞬移，五次后离场
      if (e.alpha < 1) e.alpha = Math.min(1, e.alpha + dt * 3.5);
      if (e.phase === 1 && P.mode !== 'dead' && (e.ct -= dt) <= 0) {
        if (!e.fired) { e.fired = true; e.ct = .6; e.flashT = .09; Sfx.play('eshoot'); for (const o of [-.16, 0, .16]) aimEB(e.x, e.y + 12, 200 * diffK(), o, 5, '255,240,120'); }
        else if (++e.cycles >= 5) { e.phase = 2; e.vy = 40; }
        else { e.fired = false; e.ct = .9 * D.ivl; explode(e.x, e.y, '255,240,120', 8, 140); e.x0 = rand(36, W - 36); e.ty = rand(70, Math.min(300, H * .42)); e.pt = 0; e.x = e.x0; e.y = e.ty; e.alpha = .08; Sfx.play('decloak'); }
      }
    } else if (e.type === 12 && e.y > 30 && P.mode !== 'dead') {   // 旋涡机：周期性喷出双臂螺旋弹幕
      e.ct -= dt;
      if (e.ct <= 0) { e.bn = 14; e.ct = 3.2 - Math.min(DL * .05, 1); }
      if (e.bn > 0 && (e.bt2 -= dt) <= 0) {
        e.bt2 = .09; e.bn--; e.sa += .42; Sfx.play('spiral');
        for (const o of [0, Math.PI]) spawnEB(e.x, e.y, Math.cos(e.sa + o) * 125 * diffK(), Math.sin(e.sa + o) * 125 * diffK(), 4.5, '255,150,60');
      }
    }
    switch (e.ai) {
      case 'sine':
        e.y += e.vy * dt; e.x = e.x0 + Math.sin(e.age * e.f + e.ph) * e.amp; e.vx = Math.cos(e.age * e.f + e.ph) * e.amp * e.f; break;
      case 'arc':
        e.th += e.om * dt; e.vx = Math.cos(e.th) * e.sp; e.vy = Math.sin(e.th) * e.sp;
        e.x += e.vx * dt; e.y += e.vy * dt; e.rot = e.th + Math.PI / 2; break;
      case 'hover':
        if (e.phase === 0) { e.y += 115 * dt; if (e.y >= e.ty) { e.phase = 1; e.pt = 0; } }
        else if (e.phase === 1) {
          e.pt += dt; e.x = e.x0 + Math.sin(e.pt * .8) * e.amp; e.vx = Math.cos(e.pt * .8) * e.amp * .8; e.y = e.ty + Math.sin(e.pt * 1.3) * 7;
          if (e.pt > e.hoverT) { e.phase = 2; e.vy = 40; }
        } else { e.vy += 320 * dt; e.y += e.vy * dt; }
        break;
      case 'dive':
        if (e.phase === 0) { e.y += 150 * dt; if (e.y >= e.ty) { e.phase = 1; e.pt = 0; } }
        else if (e.phase === 1) {
          e.pt += dt; e.x += Math.sin(e.pt * 60) * 28 * dt; e.flashT = .05;
          if (e.pt >= .55) {
            e.phase = 2;
            const dx = P.x - e.x, dy = Math.max(40, P.y - e.y), l = Math.hypot(dx, dy);
            e.vx = dx / l * 390; e.vy = dy / l * 390; e.rot = Math.atan2(e.vy, e.vx) + Math.PI / 2;
          }
        } else { e.x += e.vx * dt; e.y += e.vy * dt; }
        break;
      case 'boss': updateBoss(e, dt); break;
      case 'snipe':   // 狙击机：蓄力瞄准（红色瞄准线，最后 0.2 秒锁定方向）后射出高速重弹，三发后离场
        if (e.phase === 0) { e.y += 130 * dt; if (e.y >= e.ty) { e.phase = 1; e.pt = 0; } }
        else if (e.phase === 1) {
          e.pt += dt; e.sw += dt * .7; e.x += Math.cos(e.sw) * 18 * dt; e.rot = Math.PI;
          if (e.pt >= e.cd) { e.phase = 2; e.pt = 0; e.aim = Math.atan2(P.y - e.y, P.x - e.x); Sfx.play('snipeCharge'); }
        } else if (e.phase === 2) {
          e.pt += dt;
          if (e.pt < .75) e.aim = Math.atan2(P.y - e.y, P.x - e.x);
          e.rot = e.aim + Math.PI / 2;
          if (e.pt >= .95) {
            const k = diffK(), mx = e.x + Math.cos(e.aim) * (e.r + 10), my = e.y + Math.sin(e.aim) * (e.r + 10);
            spawnEB(mx, my, Math.cos(e.aim) * 500 * k, Math.sin(e.aim) * 500 * k, 6, '255,80,80', { kind: 'snipe' });
            spark(mx, my, '255,140,140', 7); Sfx.play('snipe'); addShake(1.5);
            e.shots++; e.pt = 0;
            if (e.shots >= 3) { e.phase = 3; e.vx = (e.x < W / 2 ? -1 : 1) * 170; e.rot = Math.PI; }
            else { e.phase = 1; e.cd = 1.7 - Math.min(DL * .04, .6); }
          }
        } else { e.x += e.vx * dt; e.y += 25 * dt; }
        break;
      case 'swarm': { // 蜂群机：缓慢转向追踪玩家，追一阵后直线飞离
        if (e.age < 7) { let d = Math.atan2(P.y - e.y, P.x - e.x) - e.th; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; e.th += clamp(d, -2.3 * dt, 2.3 * dt); }
        e.vx = Math.cos(e.th) * e.sp; e.vy = Math.sin(e.th) * e.sp; e.x += e.vx * dt; e.y += e.vy * dt; e.rot = e.th + Math.PI / 2;
        if (e.age > 12) e.dead = true;
        break;
      }
      case 'ground': { // 地面单位：位置由地面坐标按透视投影到屏幕，炮塔转向玩家
        if (e.type === 20) { e.pt += dt; e.wx = e.wx0 + Math.sin(e.pt * .6 + e.ph) * (e.amp || 45); e.wz += 14 * dt; }
        e.wz += R.groundSpeed() * dt;   // 随地面一起向后移动
        const pj = R.groundToPlane(e.wx, e.wz); e.x = pj[0]; e.y = pj[1]; e.sc = e.elite ? 1.45 : 1.2; e.r = ET[e.type].r * e.sc * pj[2];   // 逻辑位置 = 从镜头看过去它在飞行平面上的投影
        let d = Math.atan2(P.y - e.y, P.x - e.x) - e.aim; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; e.aim += clamp(d, -3 * dt, 3 * dt);
        if (e.y > 24 && e.y < H - 170 && P.mode !== 'dead' && (e.ct -= dt) <= 0) groundFire(e);
        if (!onGround()) e.dead = true;
        break;
      }
      case 'rock':    // 陨石：缓慢翻滚着飘落
        e.x += e.vx * dt; e.y += e.vy * dt; e.rot += e.vr * dt;
        break;
      case 'charge':  // 冲锋舰：在屏幕一侧对准玩家高度（红线预警），随后横向高速冲撞
        if (e.phase === 0) {
          e.pt += dt; e.x += ((e.dirv > 0 ? 16 : W - 16) - e.x) * Math.min(1, dt * 5);
          if (e.pt < .95) e.y += clamp(P.y - e.y, -260 * dt, 260 * dt);
          e.rot = e.dirv > 0 ? Math.PI / 2 : -Math.PI / 2;
          if (e.pt >= 1.3) { e.phase = 1; e.vx = e.dirv * 560; Sfx.play('dash'); }
        } else e.x += e.vx * dt;
        break;
      case 'cargo':   // 运输机：横穿屏幕逃跑，不开火
        e.x += e.dirv * 74 * dt; e.vx = 0; e.y = e.ty + Math.sin(e.age * 1.6) * 9; e.rot = e.dirv > 0 ? Math.PI / 2 : -Math.PI / 2;
        break;
      case 'mine':    // 布雷机：横穿屏幕，沿途投放水雷
        e.vx = e.dirv * 62; e.x += e.vx * dt; e.y = e.ty + Math.sin(e.age * 2.2) * 5;
        e.fireT -= dt;
        if (e.fireT <= 0 && e.x > 24 && e.x < W - 24) { e.fireT = e.ivl; dropMine(e); }
        break;
      case 'laser':   // 激光舰：聚能时缓慢追踪玩家横向位置并出现红色预警线，随后喷出竖直光束，三轮后离场
        if (e.phase === 0) { e.y += 70 * dt; if (e.y >= e.ty) { e.phase = 1; e.pt = 0; } }
        else if (e.phase === 1) {
          e.pt += dt; e.x += Math.sin(e.age * .8) * 18 * dt;
          if (e.pt >= 1.3) { e.phase = 2; e.pt = 0; Sfx.play('beamCharge'); }
        } else if (e.phase === 2) {
          e.pt += dt;
          if (e.pt < .95) e.x += clamp(P.x - e.x, -40, 40) / 40 * 60 * dt;
          if (e.pt >= 1.2) { e.phase = 3; e.pt = 0; Sfx.play('beam'); addShake(3); }
        } else if (e.phase === 3) {
          e.pt += dt;
          if ((P.mode === 'ship' || P.mode === 'possessed') && P.y > e.y && Math.abs(P.x - e.x) < 10 + hitAxes()[0]) hurtPlayer();
          if (e.pt >= .8) { e.cycles++; e.pt = 0; e.phase = e.cycles >= 3 ? 4 : 1; }
        } else { e.vy += 150 * dt; e.y += e.vy * dt; }
        break;
    }
    if (e.shoots && e.ai !== 'boss' && e.y > 10 && e.y < H - 140) {
      e.fireT -= dt;
      if (e.fireT <= 0) { e.fireT = e.ivl * rand(.85, 1.2); if (P.mode !== 'dead') enemyShoot(e); }
    }
    if (e.y > H + 70 || e.x < -100 || e.x > W + 100 || e.y < -150) e.dead = true;

    // 与玩家碰撞
    if (P.mode === 'ship' || P.mode === 'possessed') {
      const pr = P.mode === 'possessed' ? Math.max(9, ET[P.ghost.type].r * .6) : 8;
      const dx = e.x - P.x, dy = e.y - P.y, rr = e.r * .85 + pr;
      if (dx * dx + dy * dy < rr * rr && e.y > 0 && !e.ground) {   // 地面单位在下方，不会相撞
        if (P.inv <= 0) {
          hurtPlayer();
          if (e.type !== 4) { e.hp -= 3; e.hitT = .1; if (e.hp <= 0) killEnemy(e); }
        }
      }
      if (e.segs && P.inv <= 0) for (const q of e.segs) if (Math.hypot(q[0] - P.x, q[1] - P.y) < 14 + pr) { hurtPlayer(); break; }   // 炎龙的身体
    }
  }
}

function hitAxes() {   // 玩家命中判定椭圆的半轴：贴合机身和内侧机翼，而不是一个很小的圆点
  if (P.mode === 'possessed') { const r = ET[P.ghost.type].r; return [Math.max(10, r * .8), Math.max(14, r * .95)]; }
  return [10, 16];
}
function steerEB(b, dt) {   // 敌方导弹：转向追踪玩家
  b.age += dt;
  if (b.age > b.life) { b.dead = true; explode(b.x, b.y, '255,150,80', 5, 90); return; }
  const sp = Math.min(b.maxSp, (Math.hypot(b.vx, b.vy) || 1) + b.accel * dt);
  let cur = Math.atan2(b.vy, b.vx), d = Math.atan2(P.y - b.y, P.x - b.x) - cur;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  cur += clamp(d, -b.turn * dt, b.turn * dt);
  b.vx = Math.cos(cur) * sp; b.vy = Math.sin(cur) * sp;
  if ((b.trailT -= dt) <= 0 && particles.length < 400) {
    b.trailT = .04;
    particles.push({ x: b.x - Math.cos(cur) * 8, y: b.y - Math.sin(cur) * 8, vx: rand(-10, 10), vy: rand(-10, 10), life: 0, max: .3, size: 4.5, rgb: b.kind === 'emissile' ? '255,130,70' : b.rgb, drag: 3 });
  }
}
function mineBurst(b) {   // 水雷延时爆裂成一圈子弹
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + .2; spawnEB(b.x, b.y, Math.cos(a) * 125, Math.sin(a) * 125, 4.5, '255,205,60'); }
  explode(b.x, b.y, '255,205,60', 8, 130); Sfx.play('minePop');
}
function updateEBullets(dt) {
  const [ax, ay] = hitAxes(), live = P.mode === 'ship' || P.mode === 'possessed';
  for (const b of ebullets) {
    if (b.homing) steerEB(b, dt);
    if (b.dead) continue;
    if (b.kind === 'mine') {
      if (b.drag) { const dk = Math.max(0, 1 - 2.2 * dt); b.vx *= dk; b.vy = b.vy * dk + 36 * (1 - dk); }   // 被抛出的水雷逐渐减速
      b.t -= dt;
      if (!b.beep && b.t < .55) { b.beep = true; Sfx.play('mineBeep'); }
      if (b.t <= 0) { b.dead = true; mineBurst(b); continue; }
    }
    if (b.ttl !== undefined && (b.ttl -= dt) <= 0) {   // 限时弹：到时间消失；带 split 的会分裂成一圈小弹
      b.dead = true; spark(b.x, b.y, b.rgb, 3);
      if (b.split) { ringAt(b.x, b.y, b.split, 112 * diffK(), rand(0, TAU), 4.5, b.rgb); Sfx.play('minePop'); }
      continue;
    }
    if (b.ax) b.vx += b.ax * dt;
    if (b.ay) { b.vy += b.ay * dt; if (b.vcap && b.vy > b.vcap) b.vy = b.vcap; }   // 抛物线
    if (b.scap) { const v = Math.hypot(b.vx, b.vy); if (v > b.scap) { b.vx *= b.scap / v; b.vy *= b.scap / v; } }
    if (b.spin) { const c = Math.cos(b.spin * dt), sn = Math.sin(b.spin * dt), vx = b.vx; b.vx = vx * c - b.vy * sn; b.vy = vx * sn + b.vy * c; if (b.spinD) b.spin *= Math.max(0, 1 - b.spinD * dt); }   // 弧线弹
    if (b.aimT !== undefined && (b.aimT -= dt) <= 0) { const a = Math.atan2(P.y - b.y, P.x - b.x); b.vx = Math.cos(a) * b.aimSp; b.vy = Math.sin(a) * b.aimSp; b.aimT = undefined; Sfx.play('eshoot'); }   // 悬停后射向玩家
    if (b.bounce && ((b.x < 6 && b.vx < 0) || (b.x > W - 6 && b.vx > 0))) { b.vx = -b.vx; b.bounce--; spark(b.x, b.y, b.rgb, 2); }   // 碰到两侧反弹
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.y > H + 20 || b.y < -40 || b.x < -30 || b.x > W + 30) { b.dead = true; continue; }
    if (live) {
      const dx = (b.x - P.x) / (ax + b.r), dy = (b.y - P.y) / (ay + b.r);
      if (dx * dx + dy * dy < 1) { if (P.shield > 0 || P.inv <= 0) { b.dead = true; hurtPlayer(); } }
      else if (!b.gz && b.kind !== 'mine') {   // 擦弹：子弹贴身掠过，奖励少量得分和星爆能量
        const gx = (b.x - P.x) / (ax + b.r + 15), gy = (b.y - P.y) / (ay + b.r + 15);
        if (gx * gx + gy * gy < 1) { b.gz = true; grazes++; score += 3; P.energy = Math.min(100, P.energy + 1.5 * (1 + pk('energy') * .16)); spark(b.x, b.y, '255,255,255', 2); Sfx.play('graze'); }
      }
    }
  }
}
function updateNovas(dt) {
  for (const n of novas) {
    n.r += 1500 * dt;
    for (const e of enemies) {
      if (e.dead || n.hit.has(e)) continue;
      if (e.y < -e.r - 6 || e.y > H + e.r || e.x < -e.r - 6 || e.x > W + e.r + 6) continue;   // 只对屏幕上的敌人生效
      if (Math.hypot(e.x - n.x, e.y - n.y) < n.r + e.r * .5) {
        n.hit.add(e);
        if (e.type === 4) hitEnemy(e, 30, e.x, e.y, '150,235,255');   // Boss 只受到重创
        else { const en = P.energy; e.shield = 0; spark(e.x, e.y, '150,235,255', 6); killEnemy(e); P.energy = en; }   // 其余敌人（含护盾舰、隐形机、陨石、地面部队）直接秒杀；这些击杀不给星爆充能
      }
    }
    for (const b of ebullets) {
      if (!b.dead && Math.hypot(b.x - n.x, b.y - n.y) < n.r) { b.dead = true; spark(b.x, b.y, b.rgb, 2); }
    }
    if (n.r > 900) n.dead = true;
  }
}

function updatePowerups(dt) {
  for (const p of powerups) {
    p.t += dt; p.y += p.vy * dt; p.x = p.x0 + Math.sin(p.t * 3) * 9;
    if (P.mode !== 'dead') {
      const dx = P.x - p.x, dy = P.y - p.y, d = Math.hypot(dx, dy);
      if (d < 85 * (1 + pk('magnet') * .8) * (P.mode === 'possessed' && SKILL[P.ghost.type].magnet ? 2 : 1)) { p.x0 += dx / d * 180 * dt; p.y += dy / d * 180 * dt; }
      if (d < 26) { p.dead = true; collect(p); continue; }
    }
    if (p.y > H + 30) p.dead = true;
  }
}

function updateFx(dt) {
  for (const p of particles) {
    p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    const d = Math.max(0, 1 - p.drag * dt); p.vx *= d; p.vy *= d;
  }
  for (const r of rings) { r.life += dt; if (r.life > 0) r.r += r.grow * dt; }
  for (const p of popups) { p.life += dt; p.y -= 34 * dt; }
  for (const l of later) l.t -= dt;
  for (let i = later.length - 1; i >= 0; i--) if (later[i].t <= 0) { const l = later.splice(i, 1)[0]; try { l.fn(); } catch (e) {} }
  shake = Math.max(0, shake - dt * 28); hurtFlash = Math.max(0, hurtFlash - dt); whiteFlash = Math.max(0, whiteFlash - dt * 1.6);
  if (banner && (banner.t += dt) > banner.dur) banner = null;
}
function compact(arr, pred) {
  let j = 0;
  for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (!pred(v)) arr[j++] = v; }
  arr.length = j;
}

let soulIdle = 0;
function soulRescue(dt) {   // 灵魂形态下场上没有可夺舍的敌机（例如只剩 Boss）时，敌方会派来增援，保证总有夺舍机会
  if (P.mode !== 'soul') { soulIdle = 0; return; }
  if (enemies.some(e => !e.dead && SKILL[e.type] && e.y < H - 40)) { soulIdle = 0; return; }
  if ((soulIdle += dt) < 1.6) return;
  soulIdle = -2.5;
  const s0 = Math.random() < .5 ? -1 : 1, ty = DL >= 4 && Math.random() < .5 ? 1 : 0;
  for (let i = 0; i < 3; i++) spawnEnemy({ type: ty, x: W / 2 + s0 * (i - 1) * 70, y: -30 - i * 26, ai: 'sine', vy: 95, amp: 30, f: 1.3, ph: i });
  popup(W / 2, safeTop + 170, '敌方增援出现，夺舍它！', '#8ff0ff', 15, 1.8); Sfx.play('alarm');
}
let debugNoWaves = false, dbgSpeed = 1;   // 仅调试用：暂停刷怪
function updateWave(dt) {
  if (debugNoWaves) return;
  if (waveState === 'done') return;
  if (waveState === 'pause') {
    waveT -= dt;
    if (waveT <= 0) {
      wave++; DL = levelOf(wave); queue = buildWave(wave); waveTime = 0; waveState = 'active';
      if (pk('guard') && (P.mode === 'ship' || P.mode === 'possessed')) P.shield = Math.max(P.shield, 4 * pk('guard'));
    }
    return;
  }
  waveTime += dt;
  while (queue.length && queue[0].t <= waveTime) spawnEnemy(queue.shift());
  if (!queue.length && !enemies.some(e => !e.dead)) {
    if (wave >= NSTAGE * WPS) { waveState = 'done'; return; }   // 最后一关的 Boss 已被击败：不再出怪，等通关动画
    const boss = isBossWave(wave), bonus = (stageOf(wave) + 1) * (boss ? 200 : 60); score += bonus;
    popup(W / 2, H * .45, (boss ? '第 ' + (stageOf(wave) + 1) + ' 关完成  +' : '波次完成  +') + bonus, '#9deaff', 16); Sfx.play('wave');
    waveState = 'pause'; waveT = 2.1;
    const nw = wave + 1;
    later.push({ t: .5, fn: () => {
      if (state !== 'playing') return;
      if (nw % WPS === 1) { const z = stageOf(nw); showBanner('第 ' + (z + 1) + ' 关', STAGES[z].name, '#9deaff', 2.6); Sfx.play('zone'); }
      else if (!isBossWave(nw)) showBanner('第 ' + (stageOf(nw) + 1) + ' 关 · 第 2 波', '', '#ffd24a', 1.8);
    } });
  }
}

function update(dt) {
  R.update(dt);
  bgMulT = (state === 'playing' && P.speedT > 0) ? 2.4 : 1;
  if (state === 'victory') {
    updateVictory(dt); updateFx(dt);
    compact(particles, p => p.life >= p.max); compact(rings, r => r.life >= r.max); compact(popups, p => p.life >= p.max);
    return;
  }
  if (state !== 'playing' && state !== 'over') return;
  if (resumeT > 0) { resumeT -= dt; return; }
  gameTime += dt;
  if (combo && (comboT -= dt) <= 0) combo = 0;
  if (state === 'playing') { updateWave(dt); soulRescue(dt); }
  updatePlayer(dt);
  updateBullets(dt); updateEnemies(dt); updateEBullets(dt); updateHazards(dt); updateNovas(dt); updatePowerups(dt);
  updateFx(dt);
  compact(bullets, b => b.dead); compact(enemies, e => e.dead); compact(ebullets, b => b.dead);
  compact(powerups, p => p.dead); compact(novas, n => n.dead);
  compact(particles, p => p.life >= p.max); compact(rings, r => r.life >= r.max); compact(popups, p => p.life >= p.max);
}


function rr(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function pill(x, y, w, label, frac, rgb) {
  ctx.fillStyle = 'rgba(8,14,40,.62)'; rr(x, y, w, 17, 8.5); ctx.fill();
  if (frac > 0) { ctx.save(); rr(x, y, w, 17, 8.5); ctx.clip(); ctx.fillStyle = 'rgba(' + rgb + ',.4)'; ctx.fillRect(x, y, w * frac, 17); ctx.restore(); }
  ctx.strokeStyle = 'rgba(' + rgb + ',.85)'; ctx.lineWidth = 1; rr(x, y, w, 17, 8.5); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = '700 10.5px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, x + w / 2, y + 9);
}
function drawChips(x, y) {   // 弹种标签：每种弹各自的等级，当前弹种高亮；点击可切换
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '800 10.5px ' + FONT;
  WORDER.forEach((k, i) => {
    const wt = WT[k], lv = P.wl[k], act = P.wt === k, cx = x + i * 43;
    ctx.fillStyle = act ? 'rgba(' + wt.rgb + ',.42)' : 'rgba(8,14,40,.62)'; rr(cx, y, 40, 17, 8.5); ctx.fill();
    ctx.strokeStyle = 'rgba(' + wt.rgb + ',' + (act ? 1 : lv > 0 ? .55 : .22) + ')'; ctx.lineWidth = act ? 1.8 : 1; rr(cx, y, 40, 17, 8.5); ctx.stroke();
    ctx.fillStyle = lv > 0 ? '#fff' : 'rgba(255,255,255,.35)'; ctx.fillText(wt.short + ' ' + (lv > 0 ? lv : '·'), cx + 20, y + 9);
  });
  ctx.textAlign = 'left';
}
function drawHUD(t) {
  const x0 = 14, y0 = safeTop + 12;
  if (onGround()) { const hb = ctx.createLinearGradient(0, 0, 0, safeTop + 120); hb.addColorStop(0, 'rgba(0,4,20,.55)'); hb.addColorStop(1, 'rgba(0,4,20,0)'); ctx.fillStyle = hb; ctx.fillRect(0, 0, W, safeTop + 120); }   // 地面场景：顶部压暗，保证文字可读
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  ctx.font = '700 10px ' + FONT; ctx.fillStyle = 'rgba(170,200,255,.75)'; ctx.fillText('SCORE', x0, y0);
  ctx.font = '800 24px ' + FONT; ctx.fillStyle = '#fff'; ctx.fillText(String(score).padStart(6, '0'), x0, y0 + 10);
  ctx.textAlign = 'right';
  ctx.font = '700 10px ' + FONT; ctx.fillStyle = 'rgba(170,200,255,.75)'; ctx.fillText('BEST ' + Math.max(bestScore(), score), W - 62, y0 + 2);
  ctx.font = '800 15px ' + FONT; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,20,.55)'; ctx.strokeText(D.name + ' · 第 ' + (stageOf(wave) + 1) + '/' + NSTAGE + ' 关', W - 62, y0 + 16);
  ctx.fillStyle = '#ffd24a'; ctx.fillText(D.name + ' · 第 ' + (stageOf(wave) + 1) + '/' + NSTAGE + ' 关', W - 62, y0 + 16);

  const y1 = y0 + 42;
  ctx.textAlign = 'left';
  if (P.mode === 'ship' || P.mode === 'dead') {
    for (let i = 0; i < MAX_LIVES; i++) {
      heartPath(ctx, x0 + 8 + i * 22, y1 + 8, 7.5);
      if (i < P.lives) { ctx.fillStyle = '#ff5577'; ctx.fill(); ctx.strokeStyle = '#ffc0cf'; ctx.lineWidth = 1; ctx.stroke(); }
      else { ctx.strokeStyle = 'rgba(255,150,170,.35)'; ctx.lineWidth = 1.2; ctx.stroke(); }
    }
    if (P.mode === 'ship') drawChips(128, y1);
  } else {   // 灵魂 / 夺舍：魂能条
    ctx.fillStyle = '#8ff0ff'; ctx.font = '800 12px ' + FONT; ctx.fillText('魂能', x0, y1 + 2);
    const bx = x0 + 34, bw = 150, f = clamp(P.soulE / 100, 0, 1);
    ctx.fillStyle = 'rgba(8,14,40,.65)'; rr(bx, y1 + 2, bw, 11, 5.5); ctx.fill();
    ctx.save(); rr(bx, y1 + 2, bw, 11, 5.5); ctx.clip();
    const gr = ctx.createLinearGradient(bx, 0, bx + bw, 0); gr.addColorStop(0, f < .25 ? '#ff6a8a' : '#4fc3ff'); gr.addColorStop(1, f < .25 ? '#ff9a6a' : '#9ff4ff');
    ctx.fillStyle = gr; ctx.fillRect(bx, y1 + 2, bw * f, 11);
    if (f < .25) { ctx.fillStyle = 'rgba(255,255,255,' + (.2 + .2 * Math.sin(t * 14)) + ')'; ctx.fillRect(bx, y1 + 2, bw * f, 11); }
    ctx.restore();
    ctx.strokeStyle = 'rgba(160,230,255,.7)'; ctx.lineWidth = 1; rr(bx, y1 + 2, bw, 11, 5.5); ctx.stroke();
    if (P.mode === 'possessed') { ctx.fillStyle = '#d6f8ff'; ctx.font = '700 11px ' + FONT; ctx.fillText(SKILL[P.ghost.type].name, bx + bw + 8, y1 + 2); }
  }
  // 状态药丸
  let px = x0; const y2 = y1 + 26;
  if (P.mode === 'possessed' && P.extra > 0) { pill(px, y2, 62, '弹幕 +' + P.extra, P.extra / 2, '90,200,255'); px += 68; }
  if ((P.mode === 'ship' || P.mode === 'possessed') && P.pod > 0) { pill(px, y2, 62, '导弹 Lv' + P.pod, P.pod / 3, '170,225,255'); px += 68; }
  if (P.shield > 0) { pill(px, y2, 62, '护盾 ' + Math.ceil(P.shield) + 's', P.shield / 10, '90,255,160'); px += 68; }
  if (P.speedT > 0) { pill(px, y2, 62, '加速 ' + Math.ceil(P.speedT) + 's', P.speedT / 10, '255,215,80'); px += 68; }
  if (P.star > 0) { pill(px, y2, 62, '无敌 ' + Math.ceil(P.star) + 's', P.star / (P.starMax || NOVA_INV), '255,235,140'); px += 68; }
  if (P.od > 0) { pill(px, y2, 62, '超载 ' + Math.ceil(P.od) + 's', P.od / 4, '255,130,60'); px += 68; }
  if (combo >= 3) {   // 连击
    const k = clamp(comboT / 2.6, 0, 1), txt = combo + ' 连击';
    ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.font = '900 17px ' + FONT; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,20,.6)';
    ctx.strokeText(txt, W - 14, y2); ctx.fillStyle = combo >= 25 ? '#ff8a5a' : combo >= 10 ? '#ffd24a' : '#9deaff'; ctx.fillText(txt, W - 14, y2);
    ctx.font = '700 10px ' + FONT; ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillText('得分 ×' + comboMul().toFixed(1), W - 14, y2 + 20);
    ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(W - 74, y2 + 33, 60, 2.5); ctx.fillStyle = '#ffd24a'; ctx.fillRect(W - 14 - 60 * k, y2 + 33, 60 * k, 2.5);
    ctx.textAlign = 'left';
  }
  // Boss 血条
  const boss = enemies.find(e => e.type === 4 && !e.dead);
  if (boss) {
    const bw = W - 28, by = y2 + 40, f = clamp(boss.hp / boss.maxHp, 0, 1);
    ctx.fillStyle = 'rgba(8,14,40,.65)'; rr(x0, by, bw, 9, 4.5); ctx.fill();
    ctx.save(); rr(x0, by, bw, 9, 4.5); ctx.clip();
    const gr = ctx.createLinearGradient(x0, 0, x0 + bw, 0); gr.addColorStop(0, 'rgb(' + BOSSES[boss.bk].rgb + ')'); gr.addColorStop(1, boss.raged ? '#ff5a4a' : '#ffffff');
    ctx.fillStyle = gr; ctx.fillRect(x0, by, bw * f, 9); ctx.restore();
    ctx.strokeStyle = 'rgba(255,140,170,.8)'; ctx.lineWidth = 1; rr(x0, by, bw, 9, 4.5); ctx.stroke();
    ctx.fillStyle = '#ffd0da'; ctx.font = '800 9px ' + FONT; ctx.textAlign = 'left'; ctx.fillText(BOSSES[boss.bk].name + (boss.raged ? ' · 狂暴' : ''), x0 + 6, by - 12);
  }
}

let vigGrad = null, vigKey = '';
function drawOverlays(t) {
  if (wipeT > 0) { ctx.fillStyle = 'rgba(235,242,255,' + Math.sin((1 - wipeT / 1.4) * Math.PI) + ')'; ctx.fillRect(0, 0, W, H); }   // 换场景：穿云过渡
  // 灵魂 / 夺舍：冷色调与暗角
  if (P.mode === 'soul' || P.mode === 'possessed') {
    const soul = P.mode === 'soul';
    ctx.fillStyle = soul ? 'rgba(40,90,190,.14)' : 'rgba(40,120,200,.06)'; ctx.fillRect(0, 0, W, H);
    const key = W + 'x' + H;
    if (key !== vigKey) { vigGrad = ctx.createRadialGradient(W / 2, H / 2, H * .3, W / 2, H / 2, H * .7); vigGrad.addColorStop(0, 'rgba(80,200,255,0)'); vigGrad.addColorStop(1, 'rgba(80,200,255,.3)'); vigKey = key; }
    ctx.globalAlpha = soul ? .9 + Math.sin(t * 3) * .1 : .55; ctx.fillStyle = vigGrad; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
  }
  if (hurtFlash > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * .25, W / 2, H / 2, H * .7);
    g.addColorStop(0, 'rgba(255,40,70,0)'); g.addColorStop(1, 'rgba(255,40,70,' + (hurtFlash * .8) + ')');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  if (whiteFlash > 0) { ctx.fillStyle = 'rgba(255,255,255,' + clamp(whiteFlash * .55, 0, .5) + ')'; ctx.fillRect(0, 0, W, H); }
  if (banner) {
    const k = banner.t / banner.dur, a = k < .12 ? k / .12 : k > .8 ? 1 - (k - .8) / .2 : 1;
    const sc = 1 + (1 - Math.min(1, banner.t / .25)) * .35;
    ctx.save(); ctx.translate(W / 2, H * .34); ctx.scale(sc, sc); ctx.globalAlpha = clamp(a, 0, 1);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 36px ' + FONT; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,20,.6)'; ctx.strokeText(banner.title, 0, 0);
    ctx.fillStyle = banner.col; ctx.fillText(banner.title, 0, 0);
    if (banner.sub) { ctx.font = '700 15px ' + FONT; ctx.lineWidth = 3; ctx.strokeText(banner.sub, 0, 34); ctx.fillStyle = '#fff'; ctx.fillText(banner.sub, 0, 34); }
    ctx.restore(); ctx.globalAlpha = 1;
  }
  if (state === 'playing' && resumeT > 0) {
    ctx.fillStyle = 'rgba(0,0,10,.35)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.font = '900 84px ' + FONT;
    const n = Math.ceil(resumeT / .5), f = (resumeT / .5) % 1;
    ctx.globalAlpha = .4 + .6 * (1 - f); ctx.fillText(String(n), W / 2, H * .4); ctx.globalAlpha = 1;
  }
}


/* =====================================================================
 *  控件 UI 同步
 * ===================================================================== */
let uiB = -1, uiA = -1, uiAT = '', uiBT = '';
let btnGeo = null;
function updateControlsUI() {
  const soul = P.mode === 'soul';
  const q = Math.round((soul ? 0 : P.energy) / 100 * 100);
  if (q !== uiB) { btnB.style.setProperty('--p', q / 100); uiB = q; }
  btnB.classList.toggle('ready', !soul && P.energy >= 100 && P.mode !== 'dead');
  btnB.classList.toggle('dim', soul);
  wsel.classList.toggle('on', P.mode === 'ship');
  btnB.classList.toggle('od', P.mode === 'possessed');
  const bt = P.mode === 'possessed' ? '超载' : '星爆';
  if (bt !== uiBT) { btnB.querySelector('small').textContent = bt; uiBT = bt; }
  let ap = 0;
  if (input.aLock) ap = 1; else if (input.aDown && !input.aIgnore) ap = clamp((performance.now() - input.aPressT) / LOCK_MS, 0, 1);
  const aq = Math.round(ap * 50);
  if (aq !== uiA) { btnA.style.setProperty('--p', aq / 50); uiA = aq; }
  btnA.classList.toggle('locked', input.aLock);
  btnA.classList.toggle('dim', soul);
  // 飞机在按钮下方时，按钮进一步变透明
  if (!btnGeo && state === 'playing') {
    const g = gameEl.getBoundingClientRect();
    btnGeo = [btnA, btnB].map(el => { const r = el.getBoundingClientRect(); return { el, x: (r.left + r.width / 2 - g.left) / scale, y: (r.top + r.height / 2 - g.top) / scale, r: r.width / 2 / scale }; });
  }
  if (btnGeo) for (const b of btnGeo) b.el.classList.toggle('ghost', P.mode !== 'dead' && Math.hypot(P.x - b.x, P.y - b.y) < b.r + 34);
  const at = input.aLock ? '锁定' : '射击';
  if (at !== uiAT) { btnA.querySelector('small').textContent = at; uiAT = at; }
}

/* =====================================================================
 *  流程 / 菜单
 * ===================================================================== */
function setState(s) { state = s; gameEl.dataset.state = s; }
function showOverlay(id) { document.querySelectorAll('.overlay').forEach(o => o.classList.toggle('show', o.id === id)); }

function resetWorld() {
  bullets.length = ebullets.length = enemies.length = powerups.length = particles.length = rings.length = popups.length = novas.length = later.length = 0;
  hazards.length = 0; perks = {}; combo = comboT = bestCombo = grazes = 0; seenElite = false;
  seenTypes = {}; score = 0; wave = 0; DL = 1; kills = 0; gameTime = 0; pity = 0; deaths = 0; queue = []; waveState = 'pause'; waveT = 1.2; waveTime = 0;
  shake = hurtFlash = whiteFlash = 0; banner = null; resumeT = 0;
  Object.assign(P, { x: W / 2, y: H - 190, vx: 0, vy: 0, tilt: 0, mode: 'ship', lives: D.lives, wt: 'normal', wl: { normal: 1, laser: 0, lock: 0, blast: 0 }, pod: 0,
    podX: [W / 2, W / 2], podY: [H - 190, H - 190], podCd: [0, .5], extra: 0, shield: 0, speedT: 0, inv: 1.5,
    fireCd: 0, energy: 25, od: 0, star: 0, ghost: null, soulE: 100, muz: 0, muzList: SHOTS[1], muzSpr: null, trailT: 0, wispT: 0 });
  input.aLock = false; input.aIgnore = false;
  showBanner('第 1 关', STAGES[0].name, '#9deaff', 2.2);
}
function startGame() {
  Sfx.init(); Sfx.play('click');
  releaseInputs(); resetWorld(); setState('playing'); showOverlay(''); uiA = uiB = -1;
}
function offerPerks() {   // 击败 Boss 后：从未满级的强化里随机给出三个
  if (state !== 'playing' || P.mode === 'dead') return;
  const pool = PERKS.filter(q => pk(q.id) < q.max);
  perkChoices = [];
  const ei = pool.findIndex(q => q.id === 'energy');   // 「聚气加速」未满级时每次必定出现在选项里
  if (ei >= 0) perkChoices.push(pool.splice(ei, 1)[0]);
  while (perkChoices.length < 3 && pool.length) perkChoices.push(pool.splice(randi(0, pool.length - 1), 1)[0]);
  const box = $('perkList'); box.innerHTML = '';
  perkChoices.forEach((q, i) => {
    const b = document.createElement('button'); b.className = 'perkc'; b.style.setProperty('--pc', q.rgb);
    b.innerHTML = '<b>' + q.name + (q.max < 99 ? '<i>Lv ' + pk(q.id) + ' → ' + (pk(q.id) + 1) + '</i>' : '') + '</b><span>' + q.desc + '</span>';
    b.onclick = () => pickPerk(i); box.appendChild(b);
  });
  releaseInputs(); setState('perk'); showOverlay('perk'); Sfx.play('perk');
}
function pickPerk(i) {
  if (state !== 'perk' || !perkChoices[i]) return;
  const q = perkChoices[i]; perks[q.id] = pk(q.id) + 1; perkChoices = [];
  if (q.id === 'life') { if (P.mode === 'ship') P.lives = Math.min(MAX_LIVES, P.lives + 1); else P.soulE = Math.min(100, P.soulE + 34); }
  setState('playing'); showOverlay(''); resumeT = 1; lastT = performance.now(); Sfx.play('pickup');
  popup(P.x, P.y - 44, '强化：' + q.name, 'rgb(' + q.rgb + ')', 15, 1.6);
}
function pauseGame() {
  if (state !== 'playing') return;
  $('pausePerks').textContent = Object.keys(perks).length ? '已获强化：' + PERKS.filter(q => pk(q.id) && q.id !== 'life').map(q => q.name + (pk(q.id) > 1 ? '×' + pk(q.id) : '')).join('、') : '';
  setState('paused'); releaseInputs(); $('muteBtn').textContent = '音效：' + (Sfx.muted ? '关' : '开');
  showOverlay('pause'); Sfx.play('click');
}
function resumeGame() {
  if (state !== 'paused') return;
  setState('playing'); showOverlay(''); resumeT = 1.5; lastT = performance.now(); Sfx.play('click');
}
function clearWorld() { bullets.length = ebullets.length = enemies.length = powerups.length = particles.length = rings.length = popups.length = novas.length = later.length = hazards.length = 0; banner = null; shake = hurtFlash = whiteFlash = 0; }
function toMenu() {
  releaseInputs(); input.aLock = false; clearWorld(); setState('menu'); $('menuBest').textContent = bestScore(); showOverlay('menu'); Sfx.play('click');
}
function quitRun() {   // 暂停菜单里的「结束游戏」：记录成绩后回到登录界面
  if (state === 'paused' && score > 0) submitScore(score, Math.max(1, wave));
  toMenu();
}
/* ---------- 通关：烟花 + 战机翻滚冲出画面 + 飞回母星，然后显示通关画面 ---------- */
function startVictory() {
  if (state !== 'playing') return;
  releaseInputs(); input.aLock = false; setState('victory'); showOverlay('');
  vicT = 0; vicShown = false; vicFw = 0;
  if (P.mode !== 'ship') { P.mode = 'ship'; P.ghost = null; P.lives = Math.max(1, P.lives); }
  P.inv = 0; P.star = 0; P.shield = 0; P.speedT = 0; P.vx = P.vy = 0; P.muz = 0;
  bullets.length = ebullets.length = hazards.length = novas.length = enemies.length = powerups.length = later.length = 0;
  vicBonus = Math.max(0, P.lives) * 500 + ({ easy: 1000, normal: 3000, hard: 6000 }[diffKey] || 0);
  score += vicBonus; vicRes = submitScore(score, wave, true);
  showBanner('任务完成', '星际霸主已被击败！', '#ffe27a', 2.6); Sfx.play('perk'); vibrate([60, 40, 60, 40, 160]);
}
function firework(x, y) {
  const c = pick(['255,120,160', '255,215,90', '120,230,255', '150,255,170', '200,150,255', '255,255,255']);
  explode(x, y, c, 26, 250); rings.push({ x, y, r: 6, grow: 230, life: 0, max: .6, rgb: c, w: 3 }); Sfx.play(Math.random() < .5 ? 'pop' : 'boom');
}
function updateVictory(dt) {
  vicT += dt;
  if ((vicFw -= dt) <= 0) { vicFw = rand(.2, .48); firework(rand(30, W - 30), rand(90, H * .72)); }
  if (shake > 0) shake = Math.max(0, shake - 30 * dt);
  if (vicT < 1.2) {            // 飞到屏幕中下方
    const k = Math.min(1, dt * 3); P.x += (W / 2 - P.x) * k; P.y += (H * .62 - P.y) * k; P.tilt *= .9; P.vy = 0;
  } else if (vicT < 3.1) {     // 胜利翻滚，加速冲出画面
    const u = vicT - 1.2, q = Math.min(1, u / 1.2);
    P.tilt = (TAU / .62) * q * q * (3 - 2 * q); P.vy = -(50 + u * u * 520); P.y += P.vy * dt;
    spark(P.x + rand(-8, 8), P.y + 34, '255,220,120', 2);
  } else {                     // 换成母星场景，战机回到画面中巡航
    if (!vicShown) { vicShown = true; whiteFlash = .6; showWin(); }
    const u = vicT - 3.1, q = Math.min(1, u / 1.6), ez = 1 - (1 - q) * (1 - q);
    P.x = W / 2 + Math.sin(u * .6) * 46; P.y = lerp(H + 90, H * .43, ez) + Math.sin(u * .9) * 10; P.tilt = Math.cos(u * .6) * .6; P.vy = 0;
  }
  bgMulT = vicT < 3.1 ? 3 : 1.3;
}
function showWin() {
  const stars = deaths === 0 ? 3 : deaths <= 2 ? 2 : 1, res = vicRes || { rank: -1, entry: null };
  document.querySelectorAll('#winStars i').forEach((el, i) => { el.className = i < stars ? 'on' : ''; el.style.animationDelay = (.5 + i * .35) + 's'; });
  const mm = Math.floor(gameTime / 60), ss = Math.floor(gameTime % 60);
  $('winStats').innerHTML = '难度 ' + D.name + ' · 用时 ' + mm + ':' + pad2(ss) + '<br>击毁 ' + kills + ' 架 · 最高 ' + bestCombo + ' 连击 · 阵亡 ' + deaths + ' 次<br>通关奖励 +' + vicBonus;
  $('winBadge').innerHTML = res.rank === 0 ? '<span class="badge">🏆 新纪录！</span>' : (res.rank > 0 ? '<span class="badge">榜单第 ' + (res.rank + 1) + ' 名</span>' : '');
  const el = $('winScore'), t0 = performance.now(), fin = score;
  (function tick() { const q = Math.min(1, (performance.now() - t0) / 1500); el.textContent = Math.round(fin * (1 - Math.pow(1 - q, 3))); if (q < 1 && state === 'victory') requestAnimationFrame(tick); else el.textContent = fin; })();
  showOverlay('win'); Sfx.play('zone');
}
let pickFrom = 'pause';
function openDiffPick(from) { pickFrom = from; showOverlay('diffpick'); Sfx.play('click'); }   // 重新开始前先选难度
function endGame() {
  if (state !== 'playing') return;
  P.mode = 'dead'; setState('over'); releaseInputs(); input.aLock = false;
  explode(P.x, P.y, '150,230,255', 30, 280); addShake(14); Sfx.play('over'); vibrate([120, 60, 240]);
  const res = submitScore(score, Math.max(1, wave));
  setTimeout(() => {
    if (state !== 'over') return;
    $('overScore').textContent = score;
    $('overWave').textContent = '到达第 ' + (stageOf(wave) + 1) + ' 关 · 击毁 ' + kills + ' 架 · 最高 ' + bestCombo + ' 连击';
    $('overBadge').innerHTML = res.rank === 0 ? '<span class="badge">🏆 新纪录！</span>' : (res.rank > 0 ? '<span class="badge">榜单第 ' + (res.rank + 1) + ' 名</span>' : '');
    renderScores($('overList'), 5, res.entry);
    showOverlay('over');
  }, 1300);
}
function openScores(from) {
  scoresFrom = from; renderScores($('scoreList'), 10, null); showOverlay('scores'); Sfx.play('click');
  $('scoresClear').textContent = '清空记录'; $('scoresClear').dataset.arm = '';
}

$('startBtn').onclick = startGame;
document.querySelectorAll('.diff').forEach(el => el.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { setDiff(b.dataset.d); Sfx.init(); Sfx.play('click'); } }));
$('pickStart').onclick = startGame;
$('pickCancel').onclick = () => { showOverlay(pickFrom); Sfx.play('click'); };
$('helpBtn').onclick = () => { showOverlay('help'); Sfx.init(); Sfx.play('click'); };
$('helpBack').onclick = () => { showOverlay('menu'); Sfx.play('click'); };
setDiff(diffKey);
$('menuScoresBtn').onclick = () => openScores('menu');
const muteLabel = () => { const t = '音效：' + (Sfx.muted ? '关' : '开'); $('menuMuteBtn').textContent = t; $('muteBtn').textContent = t; };
$('menuMuteBtn').onclick = () => { Sfx.init(); Sfx.toggle(); muteLabel(); Sfx.play('pickup'); };   // 打开时播放一声提示音，方便确认有声音
muteLabel();
$('pauseBtn').onclick = pauseGame;
$('resumeBtn').onclick = resumeGame;
$('restartBtn').onclick = () => openDiffPick('pause');
$('pauseScoresBtn').onclick = () => openScores('pause');
$('quitBtn').onclick = quitRun;
$('muteBtn').onclick = () => { Sfx.init(); Sfx.toggle(); muteLabel(); Sfx.play('pickup'); };
$('scoresBack').onclick = () => { showOverlay(scoresFrom); Sfx.play('click'); };
$('scoresClear').onclick = function () {
  if (this.dataset.arm !== '1') { this.dataset.arm = '1'; this.textContent = '再点一次确认清空'; return; }
  scores = []; saveScores(); this.dataset.arm = ''; this.textContent = '清空记录'; renderScores($('scoreList'), 10, null); $('menuBest').textContent = 0;
};
$('againBtn').onclick = () => openDiffPick('over');
$('overScoresBtn').onclick = () => openScores('over');
$('overMenuBtn').onclick = toMenu;
$('winAgainBtn').onclick = () => openDiffPick('win');
$('winScoresBtn').onclick = () => openScores('win');
$('winMenuBtn').onclick = toMenu;

document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
addEventListener('blur', () => pauseGame());
addEventListener('contextmenu', e => e.preventDefault());
['gesturestart', 'gesturechange', 'gestureend'].forEach(n => document.addEventListener(n, e => e.preventDefault()));
document.addEventListener('dblclick', e => e.preventDefault());

/* =====================================================================
 *  3D 渲染（Three.js）
 *  玩法逻辑仍在一个 W×H 的平面坐标里运行；这里把它摆进真正的 3D 场景：
 *  后仰的透视相机、有起伏的地形、3D 模型、灯光和雾。
 * ===================================================================== */
let bgMul = 1, bgMulT = 1, wipeT = 0, scene = -1, sceneTarget = -2, menuT = 0;
function onGround() { return scene >= 0 && !!STAGES[scene].ground; }
const R = (() => {
  const T = THREE;
  const TILT = 37 * Math.PI / 180, TANF = Math.tan(20 * Math.PI / 180), COS = Math.cos(TILT), SIN = Math.sin(TILT);
  const ZS = 1 / (COS - SIN * TANF);          // 纵向拉伸：让平面的上下边正好落在屏幕上下边
  const GY = -150, GSPD = 95, TW = 1100, TL = 1100;   // 地面高度、地面后退速度、地形块宽 / 长
  let renderer, scn, cam, amb, hemi, sun, stg = null, uScale = 1, tNow = 0;
  const cpos = new T.Vector3(), V = new T.Vector3(), M4 = new T.Matrix4(), Q = new T.Quaternion(), S3 = new T.Vector3(), C = new T.Color(), YAX = new T.Vector3(0, 1, 0);
  const wx = x => x - W / 2, wz = y => (y - H / 2) * ZS;
  const colCache = {};
  const rgbC = s => colCache[s] || (colCache[s] = new T.Color('rgb(' + s.split(',').map(v => Math.round(+v)).join(',') + ')'));

  /* ---------- 相机：解析求解，使逻辑平面底边贴屏幕底、顶边贴屏幕顶 ---------- */
  function fit(cssW, cssH) {
    const sb = H / (2 * COS), d = sb * (COS + SIN * TANF) / TANF, tz = H * ZS / 2 - sb;
    cam.fov = 40; cam.aspect = cssW / cssH; cam.near = 30; cam.far = 9000;
    cpos.set(0, d * COS, tz + d * SIN); cam.position.copy(cpos); cam.userData.tz = tz; cam.lookAt(0, 0, tz); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  }
  function toScreen(x, y, alt) { V.set(wx(x), alt || 0, wz(y)).project(cam); return [(V.x * .5 + .5) * W, (.5 - V.y * .5) * H]; }
  function planeToGround(x, y) { const k = (cpos.y - GY - 12) / cpos.y; return [cpos.x + (wx(x) - cpos.x) * k, cpos.z + (wz(y) - cpos.z) * k]; }   // 平面上的点 -> 视线延长到地面的点
  function groundToPlane(gx, gz) { const k = cpos.y / (cpos.y - GY - 12); return [cpos.x + (gx - cpos.x) * k + W / 2, (cpos.z + (gz - cpos.z) * k) / ZS + H / 2, k]; }
  const groundSpeed = () => GSPD * bgMul;

  /* ---------- 模型：由拉伸多边形和基本体拼成，合并成一个带顶点色的网格 ---------- */
  function partGeo(p) {
    const k = p[0]; let g;
    if (k === 'p' || k === 'pm') {
      const pts = k === 'pm' ? mirror(p[1]) : p[1], sh = new T.Shape();
      pts.forEach((q, i) => i ? sh.lineTo(q[0], -q[1]) : sh.moveTo(q[0], -q[1]));
      const bv = p[5] || 0;
      g = new T.ExtrudeGeometry(sh, { depth: p[3], bevelEnabled: bv > 0, bevelThickness: bv, bevelSize: bv, bevelSegments: 1, curveSegments: 1, steps: 1 });
      g.rotateX(-Math.PI / 2); g.translate(0, p[2], 0); return [g, p[4], p[6]];
    }
    if (k === 's') { g = new T.IcosahedronGeometry(1, 1); g.scale(p[4], p[5], p[6]); g.translate(p[1], p[2], p[3]); return [g, p[7], p[8]]; }
    if (k === 'c') { g = new T.CylinderGeometry(p[4], p[5], p[6], p[9] || 8); const ax = p[8] || 'z'; if (ax === 'z') g.rotateX(-Math.PI / 2); else if (ax === 'x') g.rotateZ(Math.PI / 2); g.translate(p[1], p[2], p[3]); return [g, p[7], p[10]]; }
    if (k === 'b') { g = new T.BoxGeometry(p[4], p[5], p[6]); g.translate(p[1], p[2], p[3]); return [g, p[7], p[8]]; }
    if (k === 't') { g = new T.TorusGeometry(p[4], p[5], 6, 16); g.rotateX(Math.PI / 2); g.translate(p[1], p[2], p[3]); return [g, p[6], p[7]]; }
    g = new T.DodecahedronGeometry(p[4], 0); g.translate(p[1], p[2], p[3]); return [g, p[5], p[6]];
  }
  function build(parts) {
    const pos = [], col = [];
    for (const p of parts) {
      let [g, c, o] = partGeo(p);
      if (o) { if (o.rx) g.rotateX(o.rx); if (o.ry) g.rotateY(o.ry); if (o.rz) g.rotateZ(o.rz); }
      if (g.index) g = g.toNonIndexed();
      const a = g.attributes.position.array; C.setHex(c);
      for (let i = 0; i < a.length; i += 3) { pos.push(a[i], a[i + 1], a[i + 2]); col.push(C.r, C.g, C.b); }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  }
  const pm = (pts, y, h, c, b, o) => ['pm', pts, y, h, c, b, o], pg = (pts, y, h, c, b, o) => ['p', pts, y, h, c, b, o];
  const sp = (x, y, z, rx, ry, rz, c, o) => ['s', x, y, z, rx, ry, rz, c, o], cy = (x, y, z, r1, r2, l, c, ax, sg, o) => ['c', x, y, z, r1, r2, l, c, ax, sg, o];
  const bx = (x, y, z, sx, sy, sz, c, o) => ['b', x, y, z, sx, sy, sz, c, o], to = (x, y, z, r, tb, c, o) => ['t', x, y, z, r, tb, c, o], dd = (x, y, z, r, c, o) => ['d', x, y, z, r, c, o];
  const both = f => [f(-1), f(1)], PI = Math.PI;
  const ring4 = f => [0, 1, 2, 3].map(i => f(i * PI / 2 + PI / 4)), ring6 = f => [0, 1, 2, 3, 4, 5].map(i => f(i * PI / 3));
  const SPEC = {
    player: [pm([[5, -3], [10, 0], [32, 17], [33.5, 25], [25, 24.5], [12, 29], [6, 27]], -1.2, 2.4, 0xdfe8ff, .7), pm([[17, 9.5], [30.5, 19.5], [31, 22.8], [17, 13.6]], 1.9, .5, 0xff6a2a),
      pm([[6, 22], [20, 31], [20.5, 36], [8, 34]], -.8, 1.6, 0x7f9fe6, .4), pm([[4, -15], [14, -8.5], [13, -5], [5, -8]], -.4, 1.4, 0xcfdcff, .3),
      sp(0, 1.4, -4, 6.6, 5.4, 36, 0xf2f6ff), cy(0, 1.4, -39.5, 0, 2.6, 7, 0x59658a), sp(0, 5.6, -17, 3.4, 3.2, 9.4, 0xffb43a),
      ...both(s => cy(s * 7, 1, 30, 4, 4.8, 14, 0x3a4468)), ...both(s => bx(s * 8.5, 7.5, 23, 1.3, 10, 13, 0x3f62d8, { rz: -s * .2 })),
      ...both(s => cy(s * 33, 0, 18.5, 1.6, 1.6, 15, 0xffffff)), ...both(s => cy(s * 33, 0, 9, 0, 1.6, 4, 0xff3b3b)), bx(0, 2.2, 14, 4.4, 3, 22, 0x4f6fd0)],
    e0: [pm([[0, -14], [5, -6], [13, 4], [14, 11], [6, 7], [0, 13]], -1.5, 3, 0xe84a6a, .8), sp(0, 2, 0, 3.6, 2.8, 5, 0xffffff), cy(0, 0, 11, 2.2, 2.8, 5, 0x5a1020)],
    e1: [pm([[0, -16], [5, -10], [8, -2], [20, 8], [20, 17], [9, 11], [5, 16], [0, 13]], -1.5, 3, 0xf09a3a, .8), sp(0, 2.4, -3, 3.2, 2.8, 8, 0x5a2a08), ...both(s => bx(s * 15.5, 1, 11, 3, 2.4, 8, 0xffc860)), cy(0, .5, 14, 2.6, 3.2, 5, 0x3a1a04)],
    e2: [pm([[0, -22], [12, -18], [23, -6], [25, 9], [17, 21], [6, 19], [0, 23]], -3, 6, 0x9a6ae8, 1), pm([[0, -14], [10, -9], [14, 4], [9, 14], [0, 12]], 3.6, 2.4, 0x5a2fb0, .5), sp(0, 7, 0, 6, 4, 6, 0xff7ad8), ...both(s => cy(s * 16, 0, -16, 2.4, 2.4, 14, 0xd8bcff))],
    e3: [pm([[0, -20], [3, -9], [6, 6], [12, 15], [4, 13], [0, 18]], -1.2, 2.4, 0x3ecf9a, .6), sp(0, 1.6, -2, 2.4, 2, 7, 0xffffff)],
    e5: [pm([[0, -12], [5, -6], [8, 5], [16, 12], [15, 20], [6, 15], [0, 19]], -1.5, 3, 0xd83a48, .8), cy(0, 1, -19, 1.6, 1.6, 16, 0xffc0c0), sp(0, 3, 0, 4.2, 3, 4.2, 0x2a0610), sp(0, 4.8, 0, 2, 1.6, 2, 0xff3b3b)],
    e6: [pm([[0, -15], [11, -15], [19, -5], [20, 11], [11, 19], [0, 17]], -3, 6, 0xe0b838, 1), ...both(s => sp(s * 12, -3, 10, 4.4, 4.4, 4.4, 0x1c1405)), bx(0, 4, -9, 6, 3, 5, 0xfff0a0)],
    e7: [pm([[0, -16], [10, -13], [20, -1], [19, 9], [9, 16], [0, 14]], -2, 4, 0x48b8e0, .8), sp(0, 3, 0, 6, 4, 6, 0xffffff), ...both(s => bx(s * 16, 0, 7, 4, 3, 8, 0x9aeaff))],
    e8: [pm([[0, -17], [6, -10], [9, 5], [6, 16], [0, 14]], -2, 4, 0xa0d858, .8), ...both(s => bx(s * 15.5, 0, 2, 7, 5, 20, 0x3a5a14)), ...both(s => cy(s * 15.5, 0, -11, 0, 3, 6, 0xff6a3a)), sp(0, 2.6, -3, 2.6, 2.2, 6, 0x143006)],
    e9: [pm([[0, -24], [9, -19], [17, -5], [24, 9], [15, 22], [6, 19], [0, 26]], -3.5, 7, 0xe068b0, 1), sp(0, 5, -2, 9, 6, 9, 0xffd0ee), cy(0, 0, -24, 2, 2, 8, 0x3a0030), ...both(s => bx(s * 20, 0, 12, 4, 4, 12, 0xff9ad0))],
    e10: [...both(s => sp(s * 8.5, 0, 0, 5.5, 4, 15, 0xf090d0)), bx(0, 0, 0, 7, 3, 9, 0x7a1f60), ...both(s => sp(s * 8.5, 3, -3, 2.4, 2, 4, 0xffffff))],
    e11: [pm([[0, -16], [7, -4], [20, 10], [10, 9], [5, 15], [0, 11]], -1, 2, 0x5a64d0, .6), pm([[0, -8], [3, -1], [0, 5]], 1.5, 1.2, 0xb8f0ff)],
    e12: [cy(0, 0, 0, 18, 18, 6, 0xf0a050, 'y', 14), sp(0, 4, 0, 7, 5, 7, 0xfff0c8), ...ring4(a => bx(0, 0, -20, 6, 5, 8, 0x7a3a08, { ry: a }))],
    e13: [pm([[0, -26], [4, -12], [12, -6], [18, 8], [14, 22], [5, 18], [0, 22]], -3.5, 7, 0xe05840, 1), cy(0, 0, -27, 0, 4, 12, 0xffffff), ...both(s => bx(s * 13, 0, 16, 4, 4, 9, 0xffd24a))],
    e14: [pm([[0, -15], [6, -9], [15, -2], [16, 7], [8, 14], [0, 12]], -1.5, 3, 0x60d898, .8), bx(0, 2.8, 0, 4.4, 1.6, 14, 0xffffff), bx(0, 2.8, 0, 14, 1.6, 4.4, 0xffffff)],
    e15: [pm([[0, -9], [3, -3], [9, 3], [8, 7], [3, 4], [0, 8]], -1, 2, 0xf0d050, .5), sp(0, 1.4, -4, 1.6, 1.4, 2, 0xff5a3a)],
    e16: [to(0, 0, 0, 17, 4.5, 0x9a6ae8), sp(0, 0, 0, 9, 7, 9, 0x1a0636), ...ring6(a => bx(0, 0, -22, 5, 3, 5, 0xd8c0ff, { ry: a }))],
    e17: [cy(0, 0, 0, 14, 14, 6, 0xe8c890, 'y', 8), sp(0, 3.6, 0, 5, 3.6, 5, 0xff9a3a), ...[0, 1, 2, 3].map(i => bx(0, 0, -18, 4.4, 4, 9, 0x7a4a12, { ry: i * PI / 2 }))],
    e18: [dd(0, 0, 0, 18, 0x9a8674), sp(6, 6, -5, 5, 4, 5, 0xffb347)],
    pad: [cy(0, 2, 0, 18, 21, 5, 0x7f8aa0, 'y', 6), cy(0, 4.8, 0, 13, 13, 1, 0xffcf40, 'y', 12)],
    g19t: [sp(0, 9, 0, 8, 7, 8, 0xe8b860), cy(0, 10, -12, 2.2, 2.2, 16, 0xdfe6f4)],
    g20b: [bx(0, 6, 0, 24, 8, 34, 0x8aa858), ...both(s => bx(s * 14, 4, 0, 8, 8, 40, 0x242818))],
    g20t: [bx(0, 13, 2, 15, 6, 16, 0xa8c070), cy(0, 13.5, -15, 2.4, 2.4, 22, 0xdfe8c0)],
    boat: [pm([[0, -28], [8, -14], [10, 16], [7, 27], [0, 28]], 0, 8, 0xb0bccc, 1), bx(0, 10, 10, 10, 5, 12, 0x3a4658)],
    g21t: [bx(0, 9, 2, 20, 6, 20, 0x9aa4b6), ...both(s => cy(s * 5.5, 14, -3, 2.6, 2.6, 22, 0xf4f6fa)), ...both(s => cy(s * 5.5, 14, -16.5, 0, 2.6, 5, 0xff3b3b))],
    e24: [pm([[0, -30], [9, -24], [11, 16], [7, 30], [0, 28]], -4, 9, 0xd8c08a, 1.2), pm([[9, -8], [40, 2], [40, 11], [9, 9]], 1, 2.4, 0xb89a5a, .6), pm([[5, 20], [18, 26], [18, 31], [5, 29]], 1, 2, 0xb89a5a, .5),
      ...both(s => cy(s * 24, -1, 2, 3.4, 3.4, 13, 0x5a4a2a)), bx(0, 6.5, 2, 12, 4, 26, 0xffd24a), sp(0, 5.5, -22, 5, 3.5, 5, 0x2a3a5a), bx(0, 7, 27, 1.6, 9, 8, 0xd8c08a)],
    e25: [pm([[0, -26], [13, -22], [22, -6], [22, 14], [13, 25], [0, 23]], -3.5, 7, 0x4ab8a0, 1.2), bx(0, 4.6, 0, 16, 1.2, 34, 0x163a34), ...both(s => bx(s * 18, 2, 4, 6, 6, 26, 0x2a7a6a)),
      ...[-12, 0, 12].map(z => bx(0, 5.4, z, 3, .8, 5, 0xfff0a0)), sp(-15, 6, -10, 4, 3.4, 4, 0xe8fff8), cy(-15, 9, -10, .5, .5, 9, 0xe8fff8, 'y')],
    e26: [pm([[0, -20], [4, -8], [16, -12], [9, 2], [18, 12], [6, 9], [0, 18]], -1.2, 2.4, 0xf0d84a, .6), sp(0, 2, -2, 3, 2.6, 6, 0xffffff), ...both(s => cy(s * 14, 0, -16, 0, 1.4, 8, 0xfff8c0))],
    g23t: [cy(0, 15, 0, 4, 8, 22, 0x6a7a9a, 'y', 6), to(0, 17, 0, 9, 1.6, 0x9fd0ff), to(0, 23, 0, 6.5, 1.4, 0x9fd0ff), sp(0, 31, 0, 6, 6, 6, 0xdff2ff)],
    g22t: [bx(0, 9, 2, 18, 7, 14, 0xe0c050), ...both(s => cy(s * 4, 12, -13, 1.8, 1.8, 20, 0xeef0f4))],
    b0: [pm([[10, -34], [54, -22], [74, 6], [66, 32], [34, 25], [15, 38]], -4, 6, 0x8a2447, 1.2), pm([[0, -52], [15, -38], [26, -10], [24, 26], [12, 46], [0, 42]], -2, 11, 0xe85a7c, 1.5), sp(0, 11, -2, 12, 8, 12, 0xfff0f4),
      ...both(s => cy(s * 54, 1, -12, 3, 3, 22, 0xffc060)), ...both(s => cy(s * 36, 1, -18, 3, 3, 22, 0xffc060)), ...both(s => bx(s * 20, 6, 30, 5, 12, 16, 0x5a1030))],
    b1: [sp(0, 2, 6, 28, 14, 44, 0x9a70e0), sp(0, 13, -20, 10, 6, 10, 0xff5ad8), ...both(s => sp(s * 11, 11, -26, 4.4, 3.6, 4.4, 0x12022e)), ...both(s => sp(s * 19, 9, -12, 3.2, 2.8, 3.2, 0x12022e)),
      ...[0, 1, 2].map(i => { const y0 = -14 + i * 14; return pm([[18, y0], [46 + i * 6, y0 - 22 + i * 10], [70 + i * 4, y0 + 22 + i * 12], [64 + i * 4, y0 + 27 + i * 12], [44 + i * 6, y0 - 11 + i * 10], [18, y0 + 8]], -2, 5, 0x7a4ad0, .8); })],
    b2: [pm([[0, -46], [44, -40], [80, -8], [72, 26], [40, 44], [0, 48]], -6, 12, 0xa8c860, 1.5), ...[[-38, -6], [38, -6], [-19, 18], [19, 18], [0, -8]].flatMap(q => [cy(q[0], 8, q[1], 11, 11, 3, 0x0c1a04, 'y', 6), sp(q[0], 9.5, q[1], 5, 3, 5, 0xffd24a)]),
      ...both(s => cy(s * 66, 0, 18, 3, 3, 24, 0xe0c040)), cy(0, 12, -50, .8, 1.6, 16, 0xf1ffc8, 'y')],
    b3: [pm([[8, -6], [50, 20], [70, 52], [44, 40], [20, 44], [10, 30]], -3, 5, 0x58a0e0, 1), pm([[0, -66], [7, -40], [14, -4], [15, 30], [8, 56], [0, 50]], -3, 10, 0xeaf6ff, 1.5), sp(0, 8.5, -4, 5.5, 5, 12, 0x22d0ff), ...both(s => cy(s * 46, 0, 29, 2, 2, 18, 0xe8fbff))],
    b4: [pm([[0, -58], [40, -52], [58, -30], [58, 36], [40, 56], [0, 60]], 6, 16, 0xc89a58, 1.5), ...both(s => bx(s * 66, 8, 0, 30, 16, 114, 0x1a1c26)), ...[[-40, -34], [40, -34], [-40, 34], [40, 34]].map(q => sp(q[0], 24, q[1], 7, 4, 7, 0xff9a3a))],
    b4t: [bx(0, 30, 6, 44, 12, 44, 0xe0b070), ...both(s => cy(s * 9, 31, -30, 3.6, 3.6, 36, 0xe8ecf4)), sp(0, 38, 8, 8, 5, 8, 0xff8a2a)],
    b5: [...[-1.25, 1.25, -.62, .62, -2.2, 2.2].map(a => pg([[0, -70], [13, -24], [8, 0], [-8, 0], [-13, -24]], -2.5, 5, 0xbfe8ff, .8, { ry: -a })), pm([[0, -50], [16, -30], [26, 0], [18, 34], [0, 58]], -4, 10, 0xe8f6ff, 1.5), sp(0, 9, 0, 11, 7, 11, 0x35c8ff)],
    b6: [pm([[0, -36], [22, -30], [34, -8], [28, 20], [14, 42], [0, 50]], -5, 12, 0xe8703a, 1.5), ...both(s => cy(s * 30, 6, -40, 0, 5, 26, 0xffb347, 'z', 6)), ...both(s => sp(s * 15, 9, -6, 4.5, 3, 5.5, 0xfff2a0)), cy(0, 2, 48, 3, 0, 14, 0xffe27a, 'z', 6)],
    b7: [pm([[0, -70], [10, -54], [17, -14], [20, 34], [13, 60], [0, 64]], -5, 12, 0x3f4f86, 1.5), pm([[16, -22], [58, -6], [62, 30], [50, 40], [18, 30]], -2, 5, 0x2c3766, 1),
      ...both(s => bx(s * 60, 1, 12, 13, 11, 70, 0x4a5c9a)), ...both(s => cy(s * 60, 1, -31, 0, 6.5, 16, 0xffd24a)), ...both(s => cy(s * 60, 1, 50, 5, 6.5, 8, 0x1a2040)),
      bx(0, 11, 14, 16, 9, 26, 0x5a6cb0), bx(0, 17, 18, 10, 5, 12, 0xffd24a), sp(0, 9, -30, 7, 5, 12, 0x7fe6ff),
      ...[-54, -24, 24, 54].flatMap(x => [sp(x, Math.abs(x) > 40 ? 8 : 6, 24, 6, 4.5, 6, 0xdfe6f8), cy(x, Math.abs(x) > 40 ? 8 : 6, 36, 1.8, 1.8, 16, 0xffd24a)]),
      ...both(s => cy(s * 34, 7, -2, .6, 2.2, 22, 0xfff2a0, 'y', 5)), cy(0, 24, 18, .6, 1.6, 18, 0xfff2a0, 'y', 5)],
    b8: [pm([[0, -52], [20, -30], [28, 4], [18, 38], [0, 54]], -6, 14, 0x6ad8f0, 2), pm([[0, -34], [11, -18], [15, 4], [9, 24], [0, 34]], 8, 8, 0xc8f6ff, 1), sp(0, 20, 0, 9, 7, 11, 0xff7ae0),
      ...both(s => cy(s * 30, 2, -34, 0, 8, 40, 0xd0f8ff, 'z', 5, { ry: -s * .45 })), ...both(s => cy(s * 44, 0, 4, 0, 7, 34, 0x9af0ff, 'z', 5, { ry: -s * 1.2 })), ...both(s => cy(s * 22, 0, 52, 6, 0, 26, 0x9af0ff, 'z', 5, { ry: s * .4 })), cy(0, 24, -34, 0, 5, 20, 0xffffff, 'y', 5)],
    seg8: [cy(0, 8, 0, 0, 10, 16, 0x9af4ff, 'y', 6), cy(0, -8, 0, 10, 0, 16, 0x6ad8f0, 'y', 6)],
    b9: [pm([[0, -46], [24, -36], [34, -8], [30, 26], [16, 46], [0, 50]], 4, 13, 0xc47a38, 1.5), pm([[0, -30], [14, -22], [20, -2], [16, 20], [0, 28]], 17, 5, 0x8a4c20, 1),
      ...both(s => bx(s * 48, 12, -44, 12, 9, 40, 0xa85a2a, { ry: -s * .35 })), ...both(s => sp(s * 44, 12, -74, 13, 7, 17, 0xe89a4a)), ...both(s => cy(s * 38, 12, -92, 0, 4, 16, 0xfff0c0)),
      ...[-22, 0, 22].flatMap(z => both(s => bx(s * 46, 8, z, 34, 4, 6, 0x7a4a22, { ry: s * z * .012 }))), ...both(s => sp(s * 9, 20, -38, 3.6, 3, 3.6, 0xff3b2a))],
    b9t: [sp(0, 26, 30, 11, 9, 11, 0xc47a38), sp(0, 38, 18, 10, 8, 10, 0xb86c30), sp(0, 48, 4, 9, 7, 9, 0xa85a2a), sp(0, 54, -10, 7, 6, 8, 0xe89a4a), cy(0, 54, -26, 0, 5, 24, 0xfff0a0)],
    b10: [sp(0, 6, 14, 32, 20, 40, 0xa060e0), sp(0, 14, 34, 22, 14, 24, 0x8a48c8), ...both(s => sp(s * 15, 16, -8, 7, 7, 7, 0xfff0a0)), ...both(s => sp(s * 16, 19, -12, 3.2, 3.2, 3.2, 0x1a0630)),
      ...[-1.15, -.72, -.3, .3, .72, 1.15].map(a => cy(0, 0, -48, 2, 7.5, 56, 0x8a48c8, 'z', 6, { ry: a })), ...[-1.15, -.72, -.3, .3, .72, 1.15].map(a => sp(0, 0, -78, 4, 3, 4, 0xffa0e0, { ry: a }))],
    b11: [sp(0, 2, 0, 36, 22, 66, 0x2f7fc0), sp(0, -6, -4, 30, 14, 54, 0xbfe6f4), pm([[0, 52], [34, 78], [30, 88], [0, 70]], 0, 5, 0x2a6aa8, 1), ...both(s => bx(s * 44, -2, -10, 30, 4, 16, 0x2a6aa8, { ry: s * .45 })),
      ...both(s => sp(s * 24, 10, -38, 4, 4, 4, 0xffffff)), ...both(s => sp(s * 25, 11, -40, 2, 2, 2, 0x06203a)), ...[-30, -12, 6, 24, 40].map((z, i) => sp(0, 22, z, 5, 2.4, 5, i % 2 ? 0x7affd0 : 0xb48aff)), cy(0, 24, -20, 2.5, 2.5, 4, 0x1a4a7a, 'y')],
    b12: [cy(0, 0, 0, 44, 44, 12, 0xb88a3a, 'y', 12), ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => bx(0, 0, -50, 15, 12, 14, 0x8a6428, { ry: i * PI / 4 })), cy(0, 8, 0, 22, 24, 8, 0x5a5f6a, 'y', 10), sp(0, 14, 0, 11, 7, 11, 0xff9a3a),
      ...ring4(a => cy(0, 10, -32, 4, 4, 6, 0x2a2c34, 'y', 6, { ry: a })), ...[0, 1, 2, 3, 4, 5].map(i => bx(0, 13, -14, 3, 2, 14, 0xdfe6f4, { ry: i * PI / 3 }))],
    b13: [sp(0, 0, 0, 30, 22, 30, 0xffc040), sp(0, 8, 0, 20, 14, 20, 0xffe890), ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => cy(0, 0, -44, 0, 8, 26, 0xff8a2a, 'z', 5, { ry: i * PI / 4 })),
      ...both(s => sp(s * 10, 18, -12, 3.6, 3.6, 3.6, 0x5a2a08)), bx(0, 16, -22, 12, 2, 3, 0x5a2a08)],
    seg13: [sp(0, 0, 0, 20, 15, 20, 0xc8d8f4), sp(-8, 10, -6, 5, 3, 5, 0x8a9ac0), sp(7, 11, 4, 4, 2.4, 4, 0x8a9ac0), sp(2, 9, -12, 3, 2, 3, 0x8a9ac0), ...both(s => sp(s * 6, 13, -4, 2.2, 2.2, 2.2, 0x1a2a5a))],
    b14: [sp(0, 2, 0, 42, 26, 38, 0x5ae890), sp(0, 14, -4, 30, 18, 28, 0x9af6b8), ...[-22, -11, 0, 11, 22].map((x, i) => cy(x, 36 - Math.abs(x) * .3, 6, 0, 5.5, 16, i % 2 ? 0xffe27a : 0xffd24a, 'y', 5)), cy(0, 26, 6, 26, 26, 5, 0xffd24a, 'y', 10),
      ...both(s => sp(s * 14, 18, -26, 8, 8, 6, 0xffffff)), ...both(s => sp(s * 14, 19, -31, 3.6, 3.6, 3, 0x12301c)), bx(0, 10, -35, 14, 3, 3, 0x1c6a3a), ...both(s => sp(s * 28, 8, -22, 6, 4, 4, 0xff9ac8))],
    b15: [bx(0, 0, 0, 58, 42, 58, 0x26346a), bx(0, 22, 0, 46, 2, 46, 0x9af0ff), ...ring4(a => bx(0, 0, -30, 40, 28, 2, 0x7fe6ff, { ry: a - PI / 4 })), ...ring4(a => sp(0, 21, -41, 6, 6, 6, 0xffffff, { ry: a })), ...ring4(a => sp(0, -21, -41, 6, 6, 6, 0xff5ad8, { ry: a })), sp(0, 26, 0, 9, 5, 9, 0xff5ad8)],
    b16: [cy(0, 0, 0, 38, 42, 12, 0x8a8f9a, 'y', 8), ...both(s => bx(s * 70, 0, 0, 48, 2, 28, 0x2a50c0)), ...both(s => bx(s * 44, 0, 0, 8, 4, 6, 0xc8ccd4)), cy(0, 8, -32, 7, 11, 64, 0xdfe6f4), cy(0, 8, -66, 9, 9, 6, 0x5a5f6a), sp(0, 8, -70, 6, 6, 6, 0xff6a3a),
      ...both(s => bx(s * 24, 9, 16, 13, 9, 24, 0x5a5f6a)), ...both(s => cy(s * 24, 9, 3, 0, 3, 6, 0xff3b3b)), sp(0, 12, 12, 10, 7, 10, 0x7fe6ff)],
    b17: [sp(0, 0, 0, 26, 26, 26, 0x08030f), to(0, 0, 0, 40, 6, 0xb060ff), to(0, 0, 0, 56, 2.6, 0xff9a3a), ...ring4(a => bx(0, 0, -64, 12, 9, 18, 0x6a6f8a, { ry: a })), ...ring4(a => sp(0, 0, -74, 4, 4, 4, 0xff5ad8, { ry: a }))],
    b18: [pm([[0, -64], [15, -42], [21, 0], [18, 40], [0, 54]], -6, 12, 0x2f6052, 1.5), bx(0, 7, -2, 24, 2, 76, 0x24463c), bx(0, 12, 34, 22, 10, 22, 0x3a7260), ...[-30, -2, 26].map(z => cy(0, 30, z, 1.6, 1.6, 46, 0x8ad0b8, 'y', 5)),
      ...[-30, -2].map(z => bx(0, 34, z + 2, 42, 24, 1.6, 0xc8ffec)), ...both(s => sp(s * 13, 16, 44, 3.4, 3.4, 3.4, 0x8affc0)), sp(0, 14, -52, 4, 4, 4, 0x8affc0), cy(0, 4, -74, 0, 3, 22, 0x8ad0b8)],
    b19: [pm([[26, -34], [84, -12], [96, 26], [72, 46], [30, 34]], -3, 7, 0x4a0c18, 1.2), pm([[0, -72], [18, -52], [30, -10], [34, 30], [20, 62], [0, 68]], -6, 16, 0x8a1c2c, 2), pm([[0, -46], [12, -30], [16, 0], [10, 30], [0, 40]], 10, 6, 0x2a0810, 1),
      sp(0, 18, -10, 14, 10, 16, 0xff3b3b), sp(0, 26, -12, 6, 4, 8, 0xfff0a0), ...both(s => cy(s * 42, 6, -58, 0, 6.5, 44, 0xffd24a, 'z', 5, { ry: -s * .3 })), ...both(s => cy(s * 70, 2, -22, 4, 4, 40, 0xdfe6f4)), ...both(s => cy(s * 88, 2, 0, 3, 3, 30, 0xdfe6f4)),
      ...both(s => cy(s * 24, 0, 66, 8, 11, 14, 0x1c1420)), ...both(s => sp(s * 56, 6, 22, 6, 4, 6, 0xff9a3a)), cy(0, 26, 20, 0, 4, 22, 0xffd24a, 'y', 5)],
    seg: [sp(0, 0, 0, 15, 11, 15, 0xe86a30), sp(0, 8, 0, 7, 5, 7, 0xffd890), ...ring6(a => cy(0, 0, -18, 0, 3.5, 9, 0xffb347, 'z', 5, { ry: a }))],
    pod: [pm([[0, -12], [4.5, -7], [5.5, 7], [3, 13], [0, 11]], -1.5, 3, 0xd8e4f8, .5), sp(0, 2, 4, 2.6, 2, 2.6, 0x2fb6ff)],
    mine: [sp(0, 0, 0, 7, 7, 7, 0x6a5a26), sp(0, 5.4, 0, 2.6, 2.6, 2.6, 0xff3b2a), ...ring6(a => cy(0, 0, -9, 0, 1.7, 5, 0xc9a23a, 'z', 5, { ry: a }))],
    emis: [cy(0, 0, 0, 2.4, 2.4, 14, 0xf4f6fa), cy(0, 0, -9.5, 0, 2.4, 5, 0xff5a3a), bx(0, 0, 6, 9, 1, 4, 0x9fb4dc)]
  };
  const geoCache = {};
  const geo = k => geoCache[k] || (geoCache[k] = build(SPEC[k]));
  let matU, matUT;   // 单位材质（不透明 / 可调透明度的模板）
  const mesh = k => new T.Mesh(geo(k), matU);

  /* ---------- 复用池：每帧按需取用，用不到的自动隐藏 ---------- */
  function Pool(make) { this.a = []; this.n = 0; this.make = make; }
  Pool.prototype.get = function () { let o = this.a[this.n]; if (!o) { o = this.a[this.n] = this.make(); scn.add(o); } this.n++; o.visible = true; return o; };
  Pool.prototype.end = function () { for (let i = this.n; i < this.a.length; i++) this.a[i].visible = false; this.n = 0; };
  let pools, glowTex, cloudTex;
  function initPools() {
    const g = glow('255,255,255'); glowTex = new T.CanvasTexture(g);
    const cc = cv(256, 128), cg = cc.getContext('2d');
    for (const [x, y, r] of [[60, 70, 50], [110, 52, 62], [160, 64, 56], [205, 78, 40], [128, 86, 52]]) cg.drawImage(g, x - r, y - r * .7, r * 2, r * 1.4);
    cloudTex = new T.CanvasTexture(cc);
    const ringG = new T.RingGeometry(.9, 1, 44); ringG.rotateX(-PI / 2);
    const discG = new T.CircleGeometry(1, 20); discG.rotateX(-PI / 2);
    const boxG = new T.BoxGeometry(1, 1, 1), sphG = new T.IcosahedronGeometry(1, 2);
    const add = { blending: T.AdditiveBlending, depthWrite: false, transparent: true, fog: false };
    pools = {
      glow: new Pool(() => new T.Sprite(new T.SpriteMaterial(Object.assign({ map: glowTex }, add)))),
      ring: new Pool(() => new T.Mesh(ringG, new T.MeshBasicMaterial(Object.assign({ side: T.DoubleSide }, add)))),
      beam: new Pool(() => new T.Mesh(boxG, new T.MeshBasicMaterial(add))),
      bubble: new Pool(() => new T.Mesh(sphG, new T.MeshBasicMaterial(add))),
      shadow: new Pool(() => new T.Mesh(discG, new T.MeshBasicMaterial({ color: 0x000008, transparent: true, opacity: .26, depthWrite: false, fog: false }))),
      seg: new Pool(() => mesh('seg')), mine: new Pool(() => mesh('mine')), emis: new Pool(() => mesh('emis')), pod: new Pool(() => mesh('pod'))
    };
  }
  function pGlow(x, y, r, rgb, a, alt) { const s = pools.glow.get(); s.material.color.copy(rgbC(rgb)); s.material.opacity = a; s.position.set(wx(x), alt || 0, wz(y)); s.scale.set(r * 2, r * 2, 1); return s; }
  function pRing(x, y, r, rgb, a, alt) { const m = pools.ring.get(); m.material.color.copy(rgbC(rgb)); m.material.opacity = a; m.position.set(wx(x), alt || 0, wz(y)); m.scale.set(r, 1, r * ZS * .8); return m; }
  function pBeam(x1, y1, x2, y2, w, rgb, a, alt, h) {
    const m = pools.beam.get(), ax = wx(x1), az = wz(y1), dx = wx(x2) - ax, dz = wz(y2) - az, len = Math.hypot(dx, dz) || 1;
    m.material.color.copy(rgbC(rgb)); m.material.opacity = a; m.position.set(ax + dx / 2, alt || 0, az + dz / 2); m.rotation.set(0, Math.atan2(dx, dz), 0); m.scale.set(w, h || Math.max(1, w * .4), len); return m;
  }
  function pBubble(x, y, r, rgb, a, alt) { const m = pools.bubble.get(); m.material.color.copy(rgbC(rgb)); m.material.opacity = a; m.position.set(wx(x), alt || 0, wz(y)); m.scale.setScalar(r); return m; }
  function pShadow(x, y, r) { if (!stg || !stg.ground) return; const m = pools.shadow.get(); m.position.set(wx(x), GY + 26, wz(y)); m.scale.set(r * .8, 1, r * .8); }

  /* ---------- 点精灵：粒子 / 敌弹 / 天气 / 星星，各一次绘制 ---------- */
  const VS = 'attribute float size; attribute vec4 pc; varying vec4 vc; uniform float uScale; void main(){ vc = pc; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }';
  const FS_SOFT = 'varying vec4 vc; void main(){ float d = length(gl_PointCoord - .5) * 2.; float a = clamp(1. - d, 0., 1.); gl_FragColor = vec4(vc.rgb, vc.a * a * a); }';
  const FS_ORB = 'varying vec4 vc; void main(){ float d = length(gl_PointCoord - .5) * 2.; if (d > 1.) discard; vec3 c = mix(vec3(1.), vc.rgb, smoothstep(.28, .5, d)); c = mix(c, vc.rgb * .3, smoothstep(.6, .8, d)); float a = d < .8 ? 1. : (1. - d) / .2; gl_FragColor = vec4(c, a * vc.a); }';
  const pointSets = [];
  function Points(max, fs, additive) {
    const g = new T.BufferGeometry(); this.pos = new Float32Array(max * 3); this.pc = new Float32Array(max * 4); this.sz = new Float32Array(max); this.max = max; this.n = 0;
    g.setAttribute('position', new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage)); g.setAttribute('pc', new T.BufferAttribute(this.pc, 4).setUsage(T.DynamicDrawUsage)); g.setAttribute('size', new T.BufferAttribute(this.sz, 1).setUsage(T.DynamicDrawUsage));
    this.mat = new T.ShaderMaterial({ uniforms: { uScale: { value: 1 } }, vertexShader: VS, fragmentShader: fs, transparent: true, depthWrite: false, blending: additive ? T.AdditiveBlending : T.NormalBlending });
    this.m = new T.Points(g, this.mat); this.m.frustumCulled = false; this.g = g; pointSets.push(this);
  }
  Points.prototype.add = function (x, y, z, size, c, a) { const i = this.n; if (i >= this.max) return; this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z; this.pc[i * 4] = c.r; this.pc[i * 4 + 1] = c.g; this.pc[i * 4 + 2] = c.b; this.pc[i * 4 + 3] = a; this.sz[i] = size; this.n++; };
  Points.prototype.commit = function () { this.g.setDrawRange(0, this.n); this.g.attributes.position.needsUpdate = this.g.attributes.pc.needsUpdate = this.g.attributes.size.needsUpdate = true; this.n = 0; };
  let fxPts, ebPts, wxPts, pb;

  /* ---------- 场景：地形、地物、水 / 岩浆、云、天气；太空关是星空和行星 ---------- */
  const STG = {
    snow:   { fog: 0x6a82b0, amb: .16, sun: [0xfff4e0, 1.05, [-.75, .7, .45]], hemi: [0xcfe0ff, 0x3a4a70, .3], amp: 46, bias: 0,   liq: [-.5, 0x5fb0dc, .92, 0], pal: [[-1, 0x35527f], [-.45, 0x5876a8], [.1, 0x8098c4], [1, 0xb4c4e0]], wx: 'snow', cloud: 0xffffff },
    desert: { fog: 0xa07c4a, amb: .16, sun: [0xfff0d0, 1.05, [-.75, .7, .45]],   hemi: [0xffe6b8, 0x6a4420, .3],  amp: 40, bias: 0,   pal: [[-1, 0x5a3818], [-.2, 0x86602e], [.4, 0xa8824a], [1, 0xc8a868]], wx: 'dust', cloud: 0xffe9c0 },
    ocean:  { fog: 0x5a94cc, amb: .16, sun: [0xffffff, 1.05, [-.75, .7, .45]],   hemi: [0xcfe8ff, 0x143c70, .3], amp: 80, bias: -.5, jit: .025, boat: true, liq: [0, 0x185aa8, .88, 0], pal: [[-1, 0x0c3468], [-.06, 0x2a70a8], [.03, 0xd8c48a], [.2, 0x459848], [1, 0x286a32]], wx: 'none', cloud: 0xffffff },
    canyon: { fog: 0x7a4a5c, amb: .18, sun: [0xffc8a0, .95, [-.85, .55, .3]], hemi: [0xffd2c0, 0x3a1c34, .34], amp: 104, bias: .12, flat: .1, liq: [-.24, 0x1f7f8a, .9, 0], pal: [[-1, 0x2c1826], [-.25, 0x5e2c32], [.25, 0x8a4634], [.7, 0xa86a42], [1, 0xc8905e]], wx: 'dust', cloud: 0xffc4a8 },
    jungle: { fog: 0x6fa884, amb: .16, sun: [0xfffbe0, 1.05, [-.75, .7, .45]],  hemi: [0xdfffe0, 0x163c1c, .3],  amp: 46, bias: .1,  liq: [-.5, 0x2a7ab8, .86, 0], pal: [[-1, 0x6a5c32], [-.4, 0x245c2e], [.3, 0x377a3c], [1, 0x6fb45a]], wx: 'none', cloud: 0xf0fff4 },
    lava:   { fog: 0x3a140c, amb: .35, sun: [0xffb080, .65, [.3, 1, -.3]], hemi: [0xff9a6a, 0x1a0806, .4],  amp: 60, bias: 0,   liq: [-.42, 0xff6a1a, 1, 1], pal: [[-1, 0x140a08], [-.3, 0x2a1a17], [.4, 0x4a342e], [1, 0x6e4c42]], wx: 'ash', cloud: 0x3a2a2a },
    city:   { fog: 0x0c1030, amb: .45, sun: [0x8fa0ff, .4, [.2, 1, .4]],   hemi: [0x6a7ad8, 0x05060e, .4],  amp: 0,  bias: 0,   pal: [[-1, 0x10142a], [1, 0x10142a]], wx: 'rain', cloud: 0x2a3050 },
    sakura: { fog: 0xb48aa8, amb: .18, sun: [0xfff0e6, 1.0, [-.75, .7, .45]], hemi: [0xffe0ee, 0x3a5a3a, .32], amp: 46, bias: .05, liq: [-.5, 0x4aa0d8, .88, 0], pal: [[-1, 0x6a6a48], [-.4, 0x4a8a4a], [.3, 0x6eae58], [1, 0xa4d67c]], wx: 'petal', cloud: 0xffe0ec },
    candy:  { fog: 0xa86aa0, amb: .14, sun: [0xffffff, .8, [-.7, .75, .4]], hemi: [0xffe0f4, 0x7a3a6a, .26], amp: 44, bias: .05, liq: [-.5, 0x7a4426, .96, 0], pal: [[-1, 0x8a4a2a], [-.42, 0xd8609c], [0, 0xe884b4], [.45, 0xe8b070], [1, 0x70c8b0]], wx: 'candy', cloud: 0xffd4ec },
    crystal: { fog: 0x140a2a, amb: .42, sun: [0xb8a0ff, .5, [.2, 1, .3]], hemi: [0x8a6aff, 0x08040e, .42], amp: 60, bias: 0, liq: [-.45, 0x2ad8c8, 1, 1], pal: [[-1, 0x120a24], [-.2, 0x241446], [.4, 0x3a2466], [1, 0x5a3a8a]], wx: 'spark' },
    aurora: { fog: 0x0c1838, amb: .36, sun: [0xa8c8ff, .55, [-.4, 1, .3]], hemi: [0x70ffc0, 0x081020, .42], amp: 50, bias: -.32, jit: .03, boat: true, liq: [0, 0x0e2c58, .9, 0], pal: [[-1, 0x0a2040], [-.05, 0x3a6a9a], [.05, 0xbcd8ee], [1, 0xeaf6ff]], wx: 'snow', cloud: 0x58ffb0, cloudA: 1.6 },
    swamp:  { fog: 0x22382c, amb: .4, sun: [0xc0e0b0, .5, [-.3, 1, .2]], hemi: [0x80b090, 0x0a100a, .36], amp: 36, bias: -.22, boat: true, liq: [0, 0x263e2a, .93, 0], pal: [[-1, 0x1c2a1c], [-.02, 0x34482c], [.12, 0x486034], [1, 0x6a8448]], wx: 'wisp', cloud: 0x4a6050 },
    undersea: { fog: 0x0a3a5a, amb: .36, sun: [0x90e8ff, .7, [0, 1, .2]], hemi: [0x60d0ff, 0x042030, .46], amp: 56, bias: 0, pal: [[-1, 0x154656], [-.2, 0x2a6a70], [.4, 0x6a9a80], [1, 0xc8c090]], wx: 'bubble', cloud: 0x2a86a8 },
    cloud:  { fog: 0x6aa6e4, amb: .12, sun: [0xfff4d8, .8, [-.7, .75, .4]], hemi: [0xe8f2ff, 0x6a8cc8, .26], amp: 74, bias: -.1, jit: .02, liq: [-.5, 0x5e9ee4, 1, 1], pal: [[-1, 0x4a7cc8], [-.35, 0x7aa6e0], [.25, 0xb4cef0], [1, 0xe4eefc]], wx: 'none', cloud: 0xffffff },
    factory: { fog: 0x38322e, amb: .32, sun: [0xffd0a0, .7, [-.5, .8, .3]], hemi: [0xc0a890, 0x1a1410, .36], amp: 0, bias: 0, pal: [[-1, 0x34363e], [1, 0x34363e]], wx: 'ash', cloud: 0x4a4440 },
    cyber:  { fog: 0x06041a, amb: .5, sun: [0x9fa0ff, .4, [.2, 1, .4]], hemi: [0x8a6aff, 0x04030c, .4], amp: 0, bias: 0, pal: [[-1, 0x0a0824], [1, 0x0a0824]], wx: 'data' },
    moon:   { fog: 0x07070b, amb: .22, sun: [0xffffff, 1.15, [-.85, .5, .3]], hemi: [0x8090b0, 0x101014, .2], amp: 50, bias: 0, pal: [[-1, 0x44464e], [-.2, 0x62646c], [.4, 0x84868e], [1, 0xacaeb6]], wx: 'none' },
    flagship: { fog: 0x1a0a14, amb: .42, sun: [0xff9a80, .6, [-.4, 1, .3]], hemi: [0xff7868, 0x0a0408, .42], amp: 0, bias: 0, pal: [[-1, 0x221e2a], [1, 0x221e2a]], wx: 'ember' },
    void:   { isSpace: true, fog: 0x0a0308, amb: .45, sun: [0xffc0a0, .8, [.5, 1, .3]], hemi: [0xff8a9a, 0x180810, .45], wx: 'none', tint: [0xff5a6a, 0x8a3aff], hole: true },
    space:  { isSpace: true, tint: [0x6a8cff, 0xb070ff], fog: 0x04050f, amb: .45, sun: [0xffffff, .8, [.5, 1, .3]],   hemi: [0x9ab0ff, 0x101830, .45], wx: 'none' }
  };
  const K1 = PI * 2 / TL;
  const hBase = (x, z) => Math.sin(z * K1 + x * .006) * .5 + Math.sin(z * K1 * 2 - x * .011 + 1.3) * .3 + Math.sin(x * .017 + z * K1 * 3 + .7) * .2;   // 沿前进方向可循环
  function hAt(cfg, x, z) { const l = clamp((Math.abs(x) - 90) / 330, 0, 1); const fl = cfg.flat === undefined ? .42 : cfg.flat; return (hBase(x, z) + cfg.bias) * (fl + (1 - fl) * l * l * (3 - 2 * l)); }   // 中间航道较平，两侧起伏大
  function palC(pal, h, out) {
    let i = 0; while (i < pal.length - 2 && h > pal[i + 1][0]) i++;
    const a = pal[i], b = pal[i + 1], k = clamp((h - a[0]) / (b[0] - a[0]), 0, 1);
    out.setHex(a[1]).lerp(C.setHex(b[1]), k); return out;
  }
  function tileGeo(cfg) {
    let g = new T.PlaneGeometry(TW, TL, 30, 30); g.rotateX(-PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, GY + hAt(cfg, p.getX(i), p.getZ(i)) * cfg.amp);
    g = g.toNonIndexed();
    const q = g.attributes.position, col = new Float32Array(q.count * 3), c = new T.Color();
    for (let i = 0; i < q.count; i += 3) {
      const h = cfg.amp ? ((q.getY(i) + q.getY(i + 1) + q.getY(i + 2)) / 3 - GY) / cfg.amp : 0, jr = cfg.jit === undefined ? .07 : cfg.jit, j = rand(-jr, jr);
      palC(cfg.pal, h + j, c);
      for (let k = 0; k < 3; k++) { col[(i + k) * 3] = c.r; col[(i + k) * 3 + 1] = c.g; col[(i + k) * 3 + 2] = c.b; }
    }
    g.setAttribute('color', new T.BufferAttribute(col, 3)); g.computeVertexNormals();
    return g;
  }
  function addProps(tile, key, cfg) {
    const d = new T.Object3D(), lam = c => new T.MeshLambertMaterial({ color: c });
    const inst = (g, m, list) => { if (!list.length) return; const im = new T.InstancedMesh(g, m, list.length); list.forEach((q, i) => { d.position.set(q[0], q[1], q[2]); d.scale.set(q[3], q[4] || q[3], q[5] || q[3]); d.rotation.set(0, q[6] || 0, 0); d.updateMatrix(); im.setMatrixAt(i, d.matrix); }); im.frustumCulled = false; tile.add(im); };
    const spots = (n, minH, maxH) => { const a = []; let guard = 0; while (a.length < n && guard++ < n * 10) { const x = rand(-TW / 2, TW / 2), z = rand(-TL / 2, TL / 2), h = hAt(cfg, x, z); if (h >= minH && h <= maxH) a.push([x, GY + h * cfg.amp, z, rand(.7, 1.3)]); } return a; };
    if (key === 'snow') {
      const s = spots(70, -.35, 2);
      inst(new T.ConeGeometry(13, 42, 6), lam(0x1f5a3c), s.map(q => [q[0], q[1] + 21 * q[3], q[2], q[3]]));
      inst(new T.ConeGeometry(8, 18, 6), lam(0xd8e4f4), s.map(q => [q[0], q[1] + 37 * q[3], q[2], q[3]]));
      inst(new T.DodecahedronGeometry(11, 0), lam(0x7a94bc), spots(26, -.3, 2).map(q => [q[0], q[1] + 4, q[2], q[3], q[3] * .7, q[3], rand(0, 6)]));
    } else if (key === 'desert') {
      inst(new T.DodecahedronGeometry(13, 0), lam(0xa87848), spots(34, -2, 2).map(q => [q[0], q[1] + 4, q[2], q[3], q[3] * .7, q[3], rand(0, 6)]));
      const c = spots(30, -2, 2);
      inst(new T.CylinderGeometry(3.5, 3.5, 28, 6), lam(0x3f8a48), c.map(q => [q[0], q[1] + 14 * q[3], q[2], q[3]]));
      inst(new T.BoxGeometry(14, 3.5, 3.5), lam(0x3f8a48), c.map(q => [q[0], q[1] + 17 * q[3], q[2], q[3]]));
      inst(new T.CylinderGeometry(20, 30, 30, 6), lam(0xb8824a), spots(8, .1, 2).map(q => [q[0], q[1] + 13, q[2], q[3]]));
    } else if (key === 'sakura') {
      const s = spots(84, -.3, 2), bl = q => [q[0], q[1] + 27 * q[3], q[2], q[3], q[3] * .8, q[3], rand(0, 6)];
      inst(new T.CylinderGeometry(2.4, 3.6, 24, 5), lam(0x6a4a3a), s.map(q => [q[0], q[1] + 11 * q[3], q[2], q[3]]));
      inst(new T.IcosahedronGeometry(15, 0), lam(0xff9ec4), s.filter((q, i) => i % 2).map(bl));
      inst(new T.IcosahedronGeometry(15, 0), lam(0xffc8de), s.filter((q, i) => !(i % 2)).map(bl));
      inst(new T.DodecahedronGeometry(9, 0), lam(0x8a9aa0), spots(18, -.3, 2).map(q => [q[0], q[1] + 3, q[2], q[3], q[3] * .7, q[3], rand(0, 6)]));
    } else if (key === 'candy') {
      const s = spots(64, -.3, 2);
      inst(new T.CylinderGeometry(1.5, 1.5, 36, 5), lam(0xffffff), s.map(q => [q[0], q[1] + 18 * q[3], q[2], q[3]]));
      [0xff5a8a, 0x5ad0ff, 0xffd24a, 0x8aee7a].forEach((c, ci) => inst(new T.SphereGeometry(11, 10, 8), lam(c), s.filter((q, i) => i % 4 === ci).map(q => [q[0], q[1] + 40 * q[3], q[2], q[3], q[3], q[3] * .4])));
      inst(new T.DodecahedronGeometry(10, 0), lam(0xc890ff), spots(18, -.3, 2).map(q => [q[0], q[1] + 4, q[2], q[3], q[3] * .8, q[3], rand(0, 6)]));
      inst(new T.DodecahedronGeometry(10, 0), lam(0xff7a5a), spots(14, -.3, 2).map(q => [q[0], q[1] + 4, q[2], q[3], q[3] * .8, q[3], rand(0, 6)]));
      inst(new T.ConeGeometry(10, 24, 8), lam(0xfff4dc), spots(14, .1, 2).map(q => [q[0], q[1] + 11 * q[3], q[2], q[3]]));
    } else if (key === 'crystal') {
      const gm = (c, k) => new T.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: k });
      [[0x5af0ff, 24], [0xff6ae0, 20], [0xb48aff, 16]].forEach(([c, n]) => inst(new T.OctahedronGeometry(13, 0), gm(c, .6), spots(n + 8, -.3, 2).map(q => [q[0], q[1] + 16 * q[3], q[2], q[3] * .8, q[3] * 2.4, q[3] * .8, rand(0, 6)])));
      inst(new T.DodecahedronGeometry(13, 0), lam(0x3a2a5a), spots(30, -2, 2).map(q => [q[0], q[1] + 4, q[2], q[3], q[3] * .7, q[3], rand(0, 6)]));
    } else if (key === 'aurora') {
      inst(new T.ConeGeometry(9, 36, 5), lam(0xd0ecff), spots(40, .08, 2).map(q => [q[0], q[1] + 16 * q[3], q[2], q[3], q[3], q[3], rand(0, 6)]));
      inst(new T.DodecahedronGeometry(12, 0), lam(0xa8d0f0), spots(24, .05, 2).map(q => [q[0], q[1] + 4, q[2], q[3], q[3] * .7, q[3], rand(0, 6)]));
    } else if (key === 'swamp') {
      const s = spots(46, -.02, 2);
      inst(new T.CylinderGeometry(1.4, 2.8, 38, 5), lam(0x3a3028), s.map(q => [q[0], q[1] + 18 * q[3], q[2], q[3]]));
      inst(new T.BoxGeometry(18, 1.6, 1.6), lam(0x3a3028), s.map(q => [q[0], q[1] + 28 * q[3], q[2], q[3], q[3], q[3], rand(0, 6)]));
      inst(new T.ConeGeometry(2, 15, 4), lam(0x5a7a3a), spots(60, -.08, .12).map(q => [q[0], q[1] + 7, q[2], q[3]]));
      inst(new T.CylinderGeometry(8, 8, .8, 8), lam(0x4a8a4a), spots(30, -2, -.1).map(q => [q[0], GY + .8, q[2], q[3]]));
      inst(new T.SphereGeometry(3, 8, 6), new T.MeshBasicMaterial({ color: 0xa8ffb8 }), spots(26, -2, 2).map(q => [q[0], Math.max(q[1], GY) + rand(14, 30), q[2], q[3]]));
    } else if (key === 'undersea') {
      [[0xff7aa0, 18], [0xffa050, 16], [0xb070e0, 14]].forEach(([c, n]) => inst(new T.ConeGeometry(8, 22, 6), lam(c), spots(n, -2, 2).map(q => [q[0], q[1] + 10 * q[3], q[2], q[3], q[3], q[3], rand(0, 6)])));
      inst(new T.IcosahedronGeometry(10, 1), lam(0xff9ab0), spots(16, -2, 2).map(q => [q[0], q[1] + 5, q[2], q[3], q[3] * .7, q[3]]));
      inst(new T.BoxGeometry(3, 48, 3), lam(0x2a9a5a), spots(54, -2, 2).map(q => [q[0], q[1] + 23 * q[3], q[2], q[3], q[3], q[3], rand(0, 6)]));
      inst(new T.DodecahedronGeometry(12, 0), lam(0x4a6a70), spots(24, -2, 2).map(q => [q[0], q[1] + 4, q[2], q[3], q[3] * .7, q[3], rand(0, 6)]));
    } else if (key === 'cloud') {
      const s = spots(22, .15, 2);
      inst(new T.CylinderGeometry(5, 5, 62, 8), lam(0xf4e2a0), s.map(q => [q[0], q[1] + 28 * q[3], q[2], q[3]]));
      inst(new T.BoxGeometry(16, 5, 16), lam(0xfff4c8), s.map(q => [q[0], q[1] + 60 * q[3], q[2], q[3]]));
      inst(new T.BoxGeometry(30, 10, 30), lam(0xffffff), spots(10, .1, 2).map(q => [q[0], q[1] + 5, q[2], q[3], q[3], q[3], rand(0, 6)]));
      inst(new T.SphereGeometry(11, 10, 8), lam(0xf0c850), spots(8, .3, 2).map(q => [q[0], q[1] + 12, q[2], q[3]]));
    } else if (key === 'moon') {
      const tg = new T.TorusGeometry(22, 4.5, 5, 14); tg.rotateX(PI / 2);
      inst(tg, lam(0x74767e), spots(28, -2, 2).map(q => [q[0], q[1] + 1, q[2], q[3] * 1.2, q[3] * .5, q[3] * 1.2]));
      const s = spots(10, -.2, .6);
      inst(new T.SphereGeometry(17, 12, 8, 0, PI * 2, 0, PI / 2), lam(0xdfe8f4), s.map(q => [q[0], q[1], q[2], q[3]]));
      inst(new T.BoxGeometry(24, 1.4, 12), lam(0x2a50c0), s.map(q => [q[0] + 34, q[1] + 9, q[2], q[3]]));
      inst(new T.CylinderGeometry(.9, .9, 40, 5), lam(0xc8ccd4), spots(12, -2, 2).map(q => [q[0], q[1] + 20, q[2], q[3]]));
      inst(new T.DodecahedronGeometry(10, 0), lam(0x8a8c94), spots(34, -2, 2).map(q => [q[0], q[1] + 3, q[2], q[3], q[3] * .7, q[3], rand(0, 6)]));
    } else if (key === 'factory' || key === 'flagship') {
      const fs = key === 'flagship', plates = [], tanks = [], towers = [], tips = [], strips = [];
      for (let gx = -7; gx <= 7; gx++) for (let gz = -7; gz <= 7; gz++) {
        const r = Math.random(), x = gx * 74 + rand(-6, 6), z = gz * 74 + rand(-6, 6);
        if (r < .3) continue;
        if (r < .68) { const h = rand(6, Math.abs(gx) < 2 ? 14 : 30); plates.push([x, GY + h / 2, z, rand(38, 60), h, rand(38, 60)]); }
        else if (r < .88) { const h = rand(18, 34); tanks.push([x, GY + h / 2, z, rand(.8, 1.2), h / 26, rand(.8, 1.2)]); }
        else if (Math.abs(gx) >= 2) { const h = rand(70, 115); towers.push([x, GY + h / 2, z, 1, h / 90, 1]); tips.push([x, GY + h + 3, z, 1]); }
      }
      inst(new T.BoxGeometry(1, 1, 1), lam(fs ? 0x383240 : 0x50545e), plates);
      inst(new T.CylinderGeometry(20, 20, 26, 10), lam(fs ? 0x4a4250 : 0x8a6a48), tanks);
      inst(new T.CylinderGeometry(5, 8, 90, 8), lam(fs ? 0x2c2630 : 0x5a4640), towers);
      inst(new T.SphereGeometry(5, 8, 6), new T.MeshBasicMaterial({ color: fs ? 0xff3030 : 0xff9a2a }), tips);
      for (let gx = -7; gx <= 8; gx++) for (let z = -TL / 2; z < TL / 2; z += (fs ? 44 : 110)) strips.push([gx * 74 - 37, GY + 1, z, 1]);
      inst(new T.BoxGeometry(fs ? 2.4 : 5, 1, fs ? 16 : 70), fs ? new T.MeshBasicMaterial({ color: 0xff3a3a }) : lam(0x9a7a3a), strips);
    } else if (key === 'cyber') {
      const bas = c => new T.MeshBasicMaterial({ color: c }), lz = [], lx = [], blocks = [], tops = [], cubes = [];
      for (let gx = -7; gx <= 8; gx++) lz.push([gx * 74 - 37, GY + 1, 0, 1]);
      for (let z = -TL / 2; z < TL / 2; z += 110) lx.push([0, GY + 1, z, 1]);
      inst(new T.BoxGeometry(1.8, 1, TL), bas(0x20e0ff), lz); inst(new T.BoxGeometry(TW, 1, 1.8), bas(0xff30c0), lx);
      for (let gx = -7; gx <= 7; gx++) for (let gz = -5; gz <= 4; gz++) { if (Math.random() < .62) continue; const w = rand(30, 50), h = Math.abs(gx) < 2 ? rand(8, 24) : rand(20, 90), x = gx * 74, z = gz * 110 + 55; blocks.push([x, GY + h / 2, z, w, h, w]); tops.push([x, GY + h + 1, z, w, 1.6, w]); }
      inst(new T.BoxGeometry(1, 1, 1), lam(0x1a1446), blocks);
      inst(new T.BoxGeometry(1, 1, 1), bas(0x20e0ff), tops.filter((q, i) => i % 2)); inst(new T.BoxGeometry(1, 1, 1), bas(0xff30c0), tops.filter((q, i) => !(i % 2)));
      for (let i = 0; i < 16; i++) cubes.push([rand(-TW / 2, TW / 2), GY + rand(50, 110), rand(-TL / 2, TL / 2), rand(.6, 1.3)]);
      inst(new T.BoxGeometry(10, 10, 10), bas(0xffe040), cubes);
    } else if (key === 'canyon') {
      inst(new T.CylinderGeometry(20, 32, 64, 7), lam(0x9a4c38), spots(16, .16, 2).map(q => [q[0], q[1] + 22, q[2], q[3], q[3], q[3], rand(0, 6)]));
      inst(new T.ConeGeometry(10, 52, 5), lam(0x70363a), spots(26, -.1, 2).map(q => [q[0], q[1] + 22 * q[3], q[2], q[3], q[3], q[3], rand(0, 6)]));
      inst(new T.DodecahedronGeometry(11, 0), lam(0x86463a), spots(30, -2, 2).map(q => [q[0], q[1] + 3, q[2], q[3], q[3] * .7, q[3], rand(0, 6)]));
      inst(new T.IcosahedronGeometry(7, 0), lam(0x4f7a44), spots(34, -.12, .12).map(q => [q[0], q[1] + 4, q[2], q[3], q[3] * .8, q[3], rand(0, 6)]));
    } else if (key === 'ocean') {
      const s = spots(26, .1, 2);
      inst(new T.CylinderGeometry(1.6, 2.2, 22, 5), lam(0x8a6a3a), s.map(q => [q[0], q[1] + 11 * q[3], q[2], q[3]]));
      inst(new T.ConeGeometry(11, 9, 6), lam(0x3f9a4a), s.map(q => [q[0], q[1] + 24 * q[3], q[2], q[3]]));
      inst(new T.DodecahedronGeometry(10, 0), lam(0x7f8a98), spots(12, -.08, .05).map(q => [q[0], q[1] + 3, q[2], q[3]]));
    } else if (key === 'jungle') {
      const s = spots(170, -.35, 2);
      inst(new T.IcosahedronGeometry(15, 0), lam(0x1c6428), s.filter((q, i) => i % 2).map(q => [q[0], q[1] + 13 * q[3], q[2], q[3], q[3] * .85, q[3], rand(0, 6)]));
      inst(new T.IcosahedronGeometry(13, 0), lam(0x34883c), s.filter((q, i) => !(i % 2)).map(q => [q[0], q[1] + 12 * q[3], q[2], q[3], q[3] * .9, q[3], rand(0, 6)]));
    } else if (key === 'lava') {
      inst(new T.ConeGeometry(13, 58, 5), lam(0x3a2824), spots(46, -.25, 2).map(q => [q[0], q[1] + 27 * q[3], q[2], q[3], q[3], q[3], rand(0, 6)]));
      inst(new T.DodecahedronGeometry(8, 0), new T.MeshBasicMaterial({ color: 0xff8a2a }), spots(26, -.4, -.2).map(q => [q[0], q[1] + 3, q[2], q[3]]));
    } else if (key === 'city') {
      const wc = cv(64, 128), wg = wc.getContext('2d'); wg.fillStyle = '#05060c'; wg.fillRect(0, 0, 64, 128);
      for (let y = 6; y < 124; y += 10) for (let x = 5; x < 60; x += 9) if (Math.random() < .3) { wg.fillStyle = pick(['#ffd97a', '#ffd97a', '#7fe6ff', '#ff7ad6', '#ffffff']); wg.fillRect(x, y, 5, 5); }
      const wt = new T.CanvasTexture(wc);
      const list = [];
      for (let gx = -7; gx <= 7; gx++) for (let gz = -7; gz <= 7; gz++) { if (Math.random() < .3) continue; const w = rand(34, 54), h = Math.abs(gx) < 2 ? rand(20, 50) : rand(40, 112); list.push([gx * 74 + rand(-6, 6), GY + h / 2, gz * 74 + rand(-6, 6), w, h, rand(34, 54)]); }
      inst(new T.BoxGeometry(1, 1, 1), new T.MeshLambertMaterial({ color: 0x1c2140, emissive: 0xffffff, emissiveMap: wt, emissiveIntensity: .8 }), list);
      const lights = [];
      for (let gx = -7; gx <= 8; gx++) for (let z = -TL / 2; z < TL / 2; z += 36) lights.push([gx * 74 - 37, GY + 1, z, 1]);
      inst(new T.BoxGeometry(2, 1, 12), new T.MeshBasicMaterial({ color: 0xffd27a }), lights);
    }
  }
  let wxs = [];
  const WX = {   // 天气 / 氛围粒子：m 运动方式，n 数量，c 颜色，s 大小，a 透明度
    snow: { m: 'snow', n: 150, c: '255,255,255', s: 5, a: .55 }, rain: { m: 'rain', n: 130, c: '170,200,255', s: 4, a: .7 }, ash: { m: 'ash', n: 70, c: '255,140,50', s: 8, a: .7 }, dust: { m: 'dust', n: 70, c: '255,230,180', s: 5, a: .7 },
    petal: { m: 'snow', n: 100, c: '255,170,205', s: 7, a: .85 }, candy: { m: 'snow', n: 70, c: '255,225,130', s: 6, a: .8 }, spark: { m: 'ash', n: 80, c: '200,150,255', s: 6, a: .75 }, wisp: { m: 'ash', n: 60, c: '170,255,170', s: 7, a: .6 },
    bubble: { m: 'ash', n: 90, c: '190,235,255', s: 7, a: .5 }, data: { m: 'ash', n: 70, c: '90,230,255', s: 5, a: .7 }, ember: { m: 'ash', n: 70, c: '255,80,60', s: 7, a: .7 }, none: { m: 'none', n: 0, c: '255,255,255', s: 1, a: 0 }
  };
  function buildStage(i) {
    if (stg) { scn.remove(stg.group); stg.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose && o.material !== matU) o.material.dispose(); }); }
    scene = i;
    const key = STAGES[i].ground || STAGES[i].sp || 'space', cfg = STG[key], group = new T.Group();
    stg = { key, cfg, ground: !cfg.isSpace, group, tiles: [], off: 0, clouds: [], sp: null };
    scn.background = new T.Color(cfg.fog); scn.fog = stg.ground ? new T.Fog(cfg.fog, cpos.y * 1.7, cpos.y * 3.6) : null;
    amb.intensity = cfg.amb; sun.color.setHex(cfg.sun[0]); sun.intensity = cfg.sun[1]; sun.position.set(cfg.sun[2][0], cfg.sun[2][1], cfg.sun[2][2]);
    hemi.color.setHex(cfg.hemi[0]); hemi.groundColor.setHex(cfg.hemi[1]); hemi.intensity = cfg.hemi[2];
    if (stg.ground) {
      const g = tileGeo(cfg), m = new T.MeshLambertMaterial({ vertexColors: true });
      for (let k = 0; k < 3; k++) { const t = new T.Mesh(g, m); addProps(t, key, cfg); group.add(t); stg.tiles.push(t); }
      if (cfg.liq) {
        const lg = new T.PlaneGeometry(2800, 3600); lg.rotateX(-PI / 2);
        const lm = cfg.liq[3] ? new T.MeshBasicMaterial({ color: cfg.liq[1] }) : new T.MeshPhongMaterial({ color: cfg.liq[1], transparent: true, opacity: cfg.liq[2], shininess: 90, specular: 0x9ac4e8 });
        const l = new T.Mesh(lg, lm); l.position.set(0, GY + cfg.liq[0] * cfg.amp, -600); group.add(l);
      }
      for (let k = 0; k < (cfg.cloud === undefined ? 0 : 5); k++) {
        const hi = k === 4, s = new T.Sprite(new T.SpriteMaterial({ map: cloudTex, color: cfg.cloud, transparent: true, opacity: Math.min(.7, (hi ? .14 : .3) * (cfg.cloudA || 1)), depthWrite: false, fog: false }));
        s.scale.set(hi ? 900 : rand(330, 520), hi ? 450 : rand(170, 260), 1); s.position.set(rand(-400, 400), hi ? 110 : GY + rand(75, 115), rand(-1500, 600));
        group.add(s); stg.clouds.push({ s, spd: hi ? 330 : rand(150, 200) });
      }
    } else {   // 太空轨道：星空、行星、星云、陨石带；每轮换一种配色
      const tint = cfg.tint;
      const sg = new T.BufferGeometry(), sa = new Float32Array(500 * 3);
      for (let k = 0; k < 500; k++) { sa[k * 3] = rand(-1100, 1100); sa[k * 3 + 1] = rand(-1300, -160); sa[k * 3 + 2] = rand(-1750, 1750); }
      sg.setAttribute('position', new T.BufferAttribute(sa, 3));
      const sm = new T.PointsMaterial({ color: 0xffffff, size: 5, sizeAttenuation: true, fog: false, map: glowTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending });
      const stars = [new T.Points(sg, sm), new T.Points(sg, sm)]; stars.forEach(s => group.add(s));
      const nc = cv(256, 256), ng = nc.getContext('2d'); ng.fillStyle = '#04050f'; ng.fillRect(0, 0, 256, 256);
      for (let k = 0; k < 9; k++) { const x = rand(0, 256), y = rand(0, 256), r = rand(50, 120), gr = ng.createRadialGradient(x, y, 0, x, y, r), cc = new T.Color(tint[k % 2]); gr.addColorStop(0, 'rgba(' + (cc.r * 255 | 0) + ',' + (cc.g * 255 | 0) + ',' + (cc.b * 255 | 0) + ',.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); ng.fillStyle = gr; ng.fillRect(0, 0, 256, 256); }
      const ng2 = new T.PlaneGeometry(5200, 5200); ng2.rotateX(-PI / 2);
      const neb = new T.Mesh(ng2, new T.MeshBasicMaterial({ map: new T.CanvasTexture(nc), fog: false, depthWrite: false })); neb.position.set(0, -1700, -700); group.add(neb);
      const planet = new T.Mesh(new T.SphereGeometry(cfg.hole ? 250 : 330, 40, 24), cfg.hole ? new T.MeshBasicMaterial({ color: 0x000000, fog: false }) : new T.MeshLambertMaterial({ color: tint[0] })); planet.position.set(cfg.hole ? 0 : -300, -980, cfg.hole ? -500 : -700); group.add(planet);
      const ringG = new T.RingGeometry(cfg.hole ? 270 : 420, cfg.hole ? 640 : 560, 64); ringG.rotateX(-PI / 2 + (cfg.hole ? .12 : .35));
      const pr = new T.Mesh(ringG, new T.MeshBasicMaterial({ color: cfg.hole ? 0xc85a1c : tint[1], transparent: true, opacity: cfg.hole ? .5 : .35, side: T.DoubleSide, fog: false })); pr.position.copy(planet.position); group.add(pr);
      if (cfg.hole) { const rg2 = new T.RingGeometry(250, 290, 64); rg2.rotateX(-PI / 2 + .12); const pr2 = new T.Mesh(rg2, new T.MeshBasicMaterial({ color: 0xfff2c0, side: T.DoubleSide, fog: false })); pr2.position.copy(planet.position); pr2.position.y += 2; group.add(pr2); }
      const moon = new T.Mesh(new T.SphereGeometry(70, 20, 14), new T.MeshLambertMaterial({ color: 0xb8c0d8 })); moon.position.set(330, -520, -250); group.add(moon);
      const d = new T.Object3D(), rocks = [0, 1].map(() => { const im = new T.InstancedMesh(new T.DodecahedronGeometry(16, 0), new T.MeshLambertMaterial({ color: 0x6a6478 }), 26); for (let k = 0; k < 26; k++) { d.position.set(rand(-700, 700), rand(-520, -190), rand(-1750, 1750)); d.rotation.set(rand(0, 6), rand(0, 6), 0); d.scale.setScalar(rand(.5, 2)); d.updateMatrix(); im.setMatrixAt(k, d.matrix); } im.frustumCulled = false; group.add(im); return im; });
      stg.sp = { stars, rocks, planet, moon, so: 0, ro: 0 };
    }
    scn.add(group);
    wxs = []; const n = WX[cfg.wx].n;
    for (let k = 0; k < n; k++) wxs.push({ x: rand(-420, 420), y: rand(-140, 150), z: rand(-900, 760), s: rand(.6, 1.4), ph: rand(0, 6) });
    for (const e of enemies) if (e.m3) { actors.delete(e.m3); scn.remove(e.m3); e.m3 = null; }   // 炮艇 / 坦克等随场景更换模型
  }
  function update(dt) {
    tNow += dt; bgMul = lerp(bgMul, bgMulT, 1 - Math.exp(-dt * 3));
    if (state === 'menu') menuT += dt;
    const want = state === 'menu' ? Math.floor(menuT / 14) % STAGES.length : state === 'victory' && vicT > 2.4 ? 17 : stageOf(wave);
    if (want !== sceneTarget) { sceneTarget = want; if (scene < 0) buildStage(want); else if (wipeT <= .7) wipeT = 1.4; }
    if (wipeT > 0) { const was = wipeT; wipeT -= dt; if (was > .7 && wipeT <= .7 && scene !== sceneTarget) buildStage(sceneTarget); }
    if (!stg) return;
    if (stg.ground) {
      stg.off += GSPD * bgMul * dt; if (stg.off >= TL) { stg.off -= TL; stg.tiles.push(stg.tiles.shift()); }   // 滚到头：最近的一块挪到最远处，景物不会突然换一套
      stg.tiles.forEach((t, i) => { t.position.z = 300 - i * TL + stg.off; });
      for (const c of stg.clouds) { c.s.position.z += c.spd * bgMul * dt; if (c.s.position.z > 900) { c.s.position.z = -1700; c.s.position.x = rand(-420, 420); } }
    } else {
      const s = stg.sp; s.so = (s.so + 45 * bgMul * dt) % 3500; s.ro += 110 * bgMul * dt; if (s.ro >= 3500) { s.ro -= 3500; s.rocks.reverse(); }
      s.stars.forEach((p, i) => { p.position.z = -900 - i * 3500 + s.so + 1750; }); s.rocks.forEach((p, i) => { p.position.z = -900 - i * 3500 + s.ro + 1750; });
      s.planet.rotation.y += dt * .03; s.moon.position.z += 6 * dt; if (s.moon.position.z > 1200) s.moon.position.z = -1800;
    }
    const k = WX[stg.cfg.wx].m;
    for (const p of wxs) {
      if (k === 'snow') { p.y -= (60 + p.s * 40) * dt; p.z += 150 * bgMul * dt; p.x += Math.sin(p.ph += dt * 2) * 30 * dt; }
      else if (k === 'rain') { p.y -= 620 * dt; p.z += 120 * dt; p.x -= 90 * dt; }
      else if (k === 'ash') { p.y += (14 + p.s * 16) * dt; p.z += 120 * bgMul * dt; p.x += Math.sin(p.ph += dt * 1.5) * 20 * dt; }
      else { p.x -= (260 + p.s * 120) * dt; p.z += 160 * bgMul * dt; }
      if (p.y < -140) p.y += 290; if (p.y > 150) p.y -= 290; if (p.z > 760) p.z -= 1660; if (p.x < -420) p.x += 840;
    }
  }

  /* ---------- 初始化 ---------- */
  const BSPIN = { 12: .8, 15: .6, 17: 1.3 };   // 会自转的 Boss
  const actors = new Set(), seen = new Set(), PBN = 220, WHITE = new T.Color(0xffffff), US = 1.22;   // US：空中单位的显示放大倍数
  let pb2, pbE, pbC;
  const bcCache = {}, HSL = { h: 0, s: 0, l: 0 };
  function bulletCol(rgb) {   // 弹体用饱和色，描边用同色系的深色，在雪地等亮背景上也清楚
    let o = bcCache[rgb]; if (o) return o;
    const c = rgbC(rgb); c.getHSL(HSL);
    if (HSL.s < .08) o = { body: new T.Color(0xffffff), edge: new T.Color(0x7a2c08) };
    else o = { body: new T.Color().setHSL(HSL.h, 1, Math.min(HSL.l, .58)), edge: new T.Color().setHSL(HSL.h, .9, .13) };
    return bcCache[rgb] = o;
  }
  let plG, flames = [], ghostM, possM = null, possKey = -1, puTex = {};
  function init() {
    renderer = new T.WebGLRenderer({ canvas: $('c'), antialias: true, powerPreference: 'high-performance' });
    scn = new T.Scene(); cam = new T.PerspectiveCamera(40, 1, 30, 9000);
    amb = new T.AmbientLight(0xffffff, .5); hemi = new T.HemisphereLight(0xffffff, 0x444444, .6); sun = new T.DirectionalLight(0xffffff, 1);
    scn.add(amb); scn.add(hemi); scn.add(sun);
    matU = new T.MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: 0x666666, emissive: 0x161a22 });
    matUT = new T.MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: 0x666666, emissive: 0x161a22, transparent: true });
    initPools();
    fxPts = new Points(460, FS_SOFT, true); ebPts = new Points(320, FS_ORB, false); wxPts = new Points(160, FS_SOFT, true);
    scn.add(fxPts.m); scn.add(ebPts.m); scn.add(wxPts.m);
    // 我方子弹：扁平的弹头形，四层实例化网格叠在一起（光晕 / 深色描边 / 弹体 / 亮芯），始终画在最上层
    const bsh = new T.Shape(); bsh.moveTo(0, 1); bsh.quadraticCurveTo(.92, .82, 1, .2); bsh.lineTo(.6, -.72); bsh.lineTo(0, -1); bsh.lineTo(-.6, -.72); bsh.lineTo(-1, .2); bsh.quadraticCurveTo(-.92, .82, 0, 1);
    const boltG = new T.ShapeGeometry(bsh, 6); boltG.rotateX(-PI / 2);
    const mkPB = (opt, ro) => { const m = new T.InstancedMesh(boltG, new T.MeshBasicMaterial(Object.assign({ color: 0xffffff, fog: false, transparent: true, depthTest: false, depthWrite: false, side: T.DoubleSide }, opt)), PBN);
      m.frustumCulled = false; m.instanceMatrix.setUsage(T.DynamicDrawUsage); for (let i = 0; i < PBN; i++) m.setColorAt(i, WHITE); m.count = 0; m.renderOrder = ro; scn.add(m); return m; };
    pb2 = mkPB({ opacity: .3, blending: T.AdditiveBlending }, 18); pbE = mkPB({ opacity: .92 }, 19); pb = mkPB({}, 20); pbC = mkPB({}, 21);
    // 玩家：机体 + 两道尾焰
    plG = new T.Group(); plG.rotation.order = 'YXZ'; plG.add(mesh('player'));
    const fg = new T.ConeGeometry(3.4, 26, 8); fg.rotateX(PI / 2); fg.translate(0, 0, 13);
    for (const sd of [-1, 1]) { const f = new T.Mesh(fg, new T.MeshBasicMaterial({ color: 0x8fdcff, transparent: true, opacity: .85, blending: T.AdditiveBlending, depthWrite: false, fog: false })); f.position.set(sd * 7, 1, 37); plG.add(f); flames.push(f); }
    scn.add(plG);
    // 灵魂
    ghostM = new T.Group(); const gm = new T.MeshBasicMaterial({ color: 0xcdf2ff, transparent: true, opacity: .72, fog: false });
    const gh = new T.Mesh(new T.SphereGeometry(13, 16, 12), gm), gt = new T.Mesh(new T.ConeGeometry(11, 26, 12), gm); gt.rotation.x = PI / 2; gt.position.z = 15; ghostM.add(gh); ghostM.add(gt);
    for (const sd of [-1, 1]) { const ey = new T.Mesh(new T.SphereGeometry(2.6, 8, 6), new T.MeshBasicMaterial({ color: 0x0c1f4a, fog: false })); ey.position.set(sd * 5, 9, -6); ghostM.add(ey); }
    scn.add(ghostM);
  }
  function resize(cssW, cssH, pr) {
    renderer.setPixelRatio(pr); renderer.setSize(cssW, cssH, false); fit(cssW, cssH);
    uScale = cssH * pr / (2 * TANF); for (const s of pointSets) s.mat.uniforms.uScale.value = uScale;
    if (scn.fog) { scn.fog.near = cpos.y * 1.7; scn.fog.far = cpos.y * 3.6; }
  }

  /* ---------- 每帧：把游戏状态同步到 3D 对象 ---------- */
  function actor(o, make) { let m = o.m3; if (!m) { m = o.m3 = make(); scn.add(m); actors.add(m); } seen.add(m); return m; }
  function makeEnemy(e) {
    if (e.ground) {
      const g = new T.Group(), tur = mesh(e.type === 4 ? 'b' + e.bk + 't' : 'g' + e.type + 't');
      g.add(mesh(e.type === 4 ? 'b' + e.bk : e.type === 20 ? (stg && stg.cfg.boat ? 'boat' : 'g20b') : 'pad')); g.add(tur); g.userData.tur = tur; return g;
    }
    const fade = e.type === 11 || e.type === 26 || (e.type === 4 && (e.bk === 1 || BOSSES[e.bk].fade));
    const m = new T.Mesh(geo(e.type === 4 ? 'b' + e.bk : 'e' + e.type), fade ? matUT.clone() : matU); m.rotation.order = 'YXZ'; m.userData.fade = fade; return m;
  }
  function extras(e, t) {
    if (e.hitT > 0) pGlow(e.x, e.y, e.r * (e.ground ? 1.1 : 1.5), '255,255,255', .5, 8);
    if (e.elite) pGlow(e.x, e.y, e.r * 2.3, '255,215,90', .45 + Math.sin(t * 6) * .12, -4);
    if (e.raged) pGlow(e.x, e.y, 105, '255,60,60', (.4 + Math.sin(t * 9) * .15) * e.alpha, -8);
    if (e.flashT > 0 && e.ai !== 'dive') {
      const a = clamp(e.flashT / .09, 0, 1);
      if (e.ground) pGlow(e.x + Math.cos(e.aim) * e.r * 1.3, e.y + Math.sin(e.aim) * e.r * 1.3, 12, '255,225,140', a, 4);
      else if (e.type === 4) { pGlow(e.x - 30, e.y + 34, 20, '255,225,140', a, 4); pGlow(e.x + 30, e.y + 34, 20, '255,225,140', a, 4); }
      else pGlow(e.x, e.y + e.r + 6, 13, '255,225,140', a, 4);
    }
    if (e.ai === 'dive' && e.phase === 1) pGlow(e.x, e.y, e.r * 2, '255,80,80', .5 + Math.sin(t * 40) * .3, 4);
    if (e.lockT > 0) pRing(e.x, e.y, e.r + 8 + Math.sin(t * 10) * 1.5, '110,255,160', .9, 4);
    if (e.ai === 'snipe' && e.phase === 2) {
      const k = clamp(e.pt / .95, 0, 1), last = e.pt >= .75, sx = e.x + Math.cos(e.aim) * (e.r + 8), sy = e.y + Math.sin(e.aim) * (e.r + 8);
      pBeam(sx, sy, sx + Math.cos(e.aim) * 900, sy + Math.sin(e.aim) * 900, last ? 3 : 1.6, last ? '255,255,255' : '255,70,70', last ? .8 : .25 + .45 * k, 1, 1);
      pGlow(sx, sy, 8 + 14 * k, '255,80,80', .5 + .5 * k, 3);
    }
    if (e.ai === 'laser') {
      const by = e.y + e.r * .9;
      if (e.phase === 2) { const k = clamp(e.pt / 1.2, 0, 1); pBeam(e.x, by, e.x, H + 80, 2.4 + 4 * k, '255,90,190', .25 + .4 * k, 1, 1); pGlow(e.x, by, 10 + 20 * k, '255,110,200', .6 + .4 * k, 3); }
      else if (e.phase === 3) { pBeam(e.x, by, e.x, H + 80, 20 + Math.sin(t * 40) * 3, '255,130,215', .85, 0, 8); pBeam(e.x, by, e.x, H + 80, 7, '255,255,255', .9, 1, 9); pGlow(e.x, by, 28, '255,150,220', .9, 3); }
    }
    if (e.ai === 'charge' && e.phase === 0) { const k = clamp(e.pt / 1.3, 0, 1), last = e.pt >= .95; pBeam(-30, e.y, W + 30, e.y, 4 + 18 * k, last ? '255,255,255' : '255,70,50', last ? .45 + .25 * Math.sin(t * 60) : .15 + .3 * k, -3, 1); }
    if (e.type === 7 && e.shield > 0) pBubble(e.x, e.y, e.r + 8, '120,230,255', e.shieldT > 0 ? .6 : .26);
    if (e.type === 14 && e.healT > 0 && e.healTarget && !e.healTarget.dead) { const o = e.healTarget, a = clamp(e.healT / .4, 0, 1); pBeam(e.x, e.y, o.x, o.y, 3, '120,255,170', .8 * a, 2); pGlow(o.x, o.y, o.r * 1.8, '120,255,170', .7 * a, 3); }
    if (e.type === 24) { pGlow(e.x, e.y, e.r * 2, '255,220,120', .32 + Math.sin(t * 7) * .12, -4); }
    if (e.type === 23 && e.ct < .8 && e.y > 24) { const q = 1 - e.ct / .8; pRing(e.x, e.y, e.r * (.6 + q * 1.6), '150,210,255', .35 + q * .5, 6); pGlow(e.x, e.y - e.r * .6, 10 + q * 12, '170,220,255', .5 + q * .4, 8); }
    if (e.type === 4 && e.bk === 7) { for (const sx of [-34, 34]) pGlow(e.x + sx, e.y - 2, 9 + Math.sin(t * 12 + sx) * 3, '255,240,150', .75 * e.alpha, 10); }
    if (e.type === 16) for (let i = 0; i < 3; i++) { const q = 1 - ((t * .45 + i / 3) % 1); pRing(e.x, e.y, 24 + q * 110, '180,130,255', (1 - q) * .5, -2); }
    if (e.segs) for (let i = e.segs.length - 1; i >= 0; i--) {
      const sk = SPEC['seg' + e.bk] ? 'seg' + e.bk : 'seg', q = e.segs[i], m = (pools[sk] || (pools[sk] = new Pool(() => mesh(sk)))).get(), sc = e.orb ? 1 : .95 - i * .045; m.position.set(wx(q[0]), 0, wz(q[1])); m.rotation.set(0, t * 1.5 + i, 0); m.scale.setScalar(sc);
      pShadow(q[0], q[1], 16 * sc); if (e.hitT > 0) pGlow(q[0], q[1], 22, '255,255,255', .5, 8);
    }
  }
  function syncPlayer(t) {
    const menu = state === 'menu', vic = state === 'victory'; let x = P.x, y = P.y, tilt = P.tilt, mode = P.mode;
    if (menu) { x = W / 2 + Math.sin(t * .6) * 46; y = H * .46 + Math.sin(t * .9) * 12; tilt = Math.cos(t * .6) * .6; mode = 'ship'; }
    const blink = !menu && P.inv > 0 && P.shield <= 0 && !(P.star > 0) && Math.floor(t * 14) % 2 === 0, poss = mode === 'possessed';
    if (poss && possKey !== P.ghost.type) { if (possM) scn.remove(possM); possKey = P.ghost.type; possM = new T.Mesh(geo('e' + possKey), matU); possM.rotation.order = 'YXZ'; scn.add(possM); }
    plG.visible = mode === 'ship' && !blink; ghostM.visible = mode === 'soul'; if (possM) possM.visible = poss && !blink;
    if (mode === 'dead') return;
    const lift = poss ? ET[P.ghost.type].r : 30;
    if (mode === 'ship') {
      plG.position.set(wx(x), 0, wz(y)); plG.scale.setScalar(US * 1.05); plG.rotation.set(menu ? Math.sin(t * .9) * .06 : clamp(-P.vy / 900, -.18, .18), 0, -tilt * .62);
      const f = (.85 + Math.random() * .4) * (!menu && P.speedT > 0 ? 1.7 : 1) * (menu ? 1.2 : 1 + clamp(-P.vy / 400, -.3, .5));
      for (const fl of flames) { fl.scale.set(1, 1, f); fl.material.color.setHex(!menu && P.speedT > 0 ? 0xffd27a : 0x8fdcff); }
      if (!blink) { const wr = menu ? '90,200,255' : WT[P.wt].rgb, c = Math.cos(tilt * .62); pGlow(x - 33 * c, y + 14, 8, wr, .75, 2); pGlow(x + 33 * c, y + 14, 8, wr, .75, 2); pGlow(x, y + 40, 16, !menu && P.speedT > 0 ? '255,210,80' : '110,190,255', .6, 0); }
      pShadow(x, y, 30);
    } else if (mode === 'soul') {
      ghostM.position.set(wx(x), Math.sin(t * 4) * 4, wz(y)); ghostM.rotation.set(0, Math.sin(t * 2) * .3, 0); pGlow(x, y, 36, '120,220,255', .4 + Math.sin(t * 5) * .1, -2);
    } else {
      const sk = SKILL[P.ghost.type];
      possM.position.set(wx(x), 0, wz(y)); possM.scale.setScalar(US); possM.rotation.set(0, 0, -tilt * .5);
      pGlow(x, y, lift * 2.1, sk.rgb, .35 + Math.sin(t * 7) * .1, -4);
      for (let i = 0; i < 3; i++) { const a = t * 3 + i * PI * 2 / 3; pGlow(x + Math.cos(a) * (lift + 8), y + Math.sin(a) * (lift + 8) * .7, 6, '170,245,255', .9, 4); }
      pShadow(x, y, lift * 1.2);
    }
    if (menu) return;
    if (P.pod > 0 && mode !== 'soul') for (let i = 0; i < 2; i++) { const m = pools.pod.get(); m.position.set(wx(P.podX[i]), 0, wz(P.podY[i] + Math.sin(t * 5 + i * 2) * 1.5)); m.visible = !blink; pGlow(P.podX[i], P.podY[i] + 12, 6, '110,190,255', blink ? 0 : .7, 0); }
    if (P.muz > 0 && mode !== 'soul') { const a = P.muz / .07, fs = Math.min(1, 1.15 / Math.sqrt(P.muzList.length)); for (const m of P.muzList) pGlow(x + m[0], y - (poss ? lift * .8 : 34), 16 * (.65 + a * .5) * fs, P.muzRgb || '255,225,140', a, 3); }
    if (P.star > 0 && mode === 'ship') {   // 星爆后的无敌：金色光罩，快结束时闪烁提醒
      const fl = P.star < .8 ? (Math.floor(t * 12) % 2 ? .3 : 1) : 1, q = (t * 1.6) % 1;
      pBubble(x, y, 42, '255,235,140', .24 * fl, 0); pRing(x, y, 42 + Math.sin(t * 10) * 1.5, '255,245,170', .95 * fl, 0); pRing(x, y, 24 + q * 22, '255,255,255', (1 - q) * .5 * fl, 0); pGlow(x, y, 60, '255,225,120', .3 * fl, -3);
    }
    if (P.shield > 0) { const fl = P.shield < 2.2 ? (Math.floor(t * 10) % 2 ? .35 : 1) : 1, rr2 = poss ? lift + 14 : 36; pBubble(x, y, rr2, '90,255,170', .3 * fl, 0); pRing(x, y, rr2, '170,255,210', .8 * fl, 0); }
    if (mode === 'soul') {   // 高亮最近的可夺舍目标
      let best = null, bd = 150; for (const e of enemies) { if (e.dead || !SKILL[e.type] || e.y < 0) continue; const d = Math.hypot(e.x - P.x, e.y - P.y); if (d < bd) { bd = d; best = e; } }
      if (best) { pRing(best.x, best.y, best.r + 9 + Math.sin(t * 8) * 2, '130,240,255', .85, 3); pBeam(P.x, P.y, best.x, best.y, 1.6, '130,240,255', .3, 1, 1); }
    }
  }
  function puActor(p) {
    const g = new T.Group(), k = p.kind;
    if (!puTex[k]) puTex[k] = new T.CanvasTexture(sprPU[k].c);
    const s = new T.Sprite(new T.SpriteMaterial({ map: puTex[k], transparent: true, depthWrite: false, fog: false })); s.scale.set(44, 44, 1); g.add(s);
    const tg = new T.TorusGeometry(17, 1.6, 6, 24), r = new T.Mesh(tg, new T.MeshBasicMaterial({ color: rgbC(PU[k].rgb), fog: false })); g.add(r); g.userData.r = r;
    return g;
  }
  function render(t) {
    if (!stg) return;
    for (const k in pools) pools[k].end();
    seen.clear();
    cam.position.copy(cpos); if (shake > 0) { cam.position.x += rand(-shake, shake); cam.position.y += rand(-shake, shake) * .6; }
    syncPlayer(t);
    if (state !== 'menu') {
      for (const e of enemies) {
        if (e.dead) continue;
        const m = actor(e, () => makeEnemy(e));
        if (e.ground) {
          let gx = e.wx, gz = e.wz, k = e.sc;
          if (e.type === 4) { const gp = planeToGround(e.x, e.y); gx = gp[0]; gz = gp[1]; k = (cpos.y - GY - 12) / cpos.y; }
          m.position.set(gx, GY + 14, gz); m.scale.setScalar(k); m.userData.tur.rotation.y = -(e.aim + PI / 2);
        } else {
          m.position.set(wx(e.x), 0, wz(e.y)); m.scale.setScalar(e.sc * US);
          if (e.type === 18) m.rotation.set(e.rot * .7, e.rot, 0);
          else m.rotation.set(0, -e.rot + (e.type === 12 || e.type === 16 ? t * 2 : e.type === 4 ? (BSPIN[e.bk] || 0) * t : 0), (e.ai === 'arc' || e.ai === 'dive' || e.ai === 'cargo' || e.type === 4 || e.type === 17) ? 0 : clamp((e.vx || 0) / 240, -.55, .55));
          if (m.userData.fade) m.material.opacity = e.alpha;
          if (e.type === 4 && e.bk === 14) { const wq = Math.sin(t * 5) * .09, s0 = e.sc * US; m.scale.set(s0 * (1 + wq), s0 * (1 - wq), s0 * (1 + wq)); }   // 果冻王：一颤一颤
          if (e.alpha > .5) pShadow(e.x, e.y, e.r * (e.type === 4 ? 1.5 : 1.1));
        }
        extras(e, t);
      }
      for (const p of powerups) { const g = actor(p, () => puActor(p)); g.position.set(wx(p.x), 4, wz(p.y)); g.userData.r.rotation.set(t * 2.4, t * 3.1, 0); const s = 1 + Math.sin(p.t * 5) * .08; g.scale.setScalar(s); }
      // 我方子弹：一个实例化网格
      let n = 0;
      for (const b of bullets) {
        if (n >= PBN) break; let sx, sz, y = b.y;
        if (b.kind === 'laser') { sx = b.r * 1.55; sz = 36 * ZS; y = b.y + b.len / 2; } else if (b.kind === 'lock') { sx = 4.6; sz = 15; } else if (b.kind === 'blast') { sx = b.r * 1.35; sz = sx * ZS * 1.2; } else if (b.kind === 'missile') { sx = 3.8; sz = 14; } else { sx = 4.7 * b.r / 4; sz = 22 * b.r / 4; }
        const bc = bulletCol(b.kind === 'missile' ? '255,255,255' : b.rgb);
        Q.setFromAxisAngle(YAX, -(b.a || 0)); V.set(wx(b.x), 0, wz(y));
        S3.set(sx, 1, sz); M4.compose(V, Q, S3); pb.setMatrixAt(n, M4); pb.setColorAt(n, bc.body);
        S3.set(sx + 1.8, 1, sz + 3); M4.compose(V, Q, S3); pbE.setMatrixAt(n, M4); pbE.setColorAt(n, bc.edge);
        S3.set(sx * .46, 1, sz * .62); M4.compose(V, Q, S3); pbC.setMatrixAt(n, M4);
        S3.set(sx * 2.5, 1, sz * 1.4); M4.compose(V, Q, S3); pb2.setMatrixAt(n, M4); pb2.setColorAt(n, bc.body); n++;
        if (b.kind === 'blast') pGlow(b.x, b.y, 14, b.rgb, .7, 0);
      }
      pb.count = pb2.count = pbE.count = pbC.count = n;
      for (const m of [pb, pb2, pbE, pbC]) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
      // 敌弹：点精灵；水雷和导弹用模型
      for (const b of ebullets) {
        if (b.kind === 'mine') { const m = pools.mine.get(); m.position.set(wx(b.x), 0, wz(b.y)); m.rotation.set(0, t * 2, 0); m.scale.setScalar(b.r / 7); const on = Math.sin(t * (b.t < .6 ? 30 : 9)) > 0; pGlow(b.x, b.y, 10, on ? '255,60,50' : '120,30,20', on ? 1 : .5, 6); }
        else if (b.kind === 'emissile') { const m = pools.emis.get(); m.position.set(wx(b.x), 0, wz(b.y)); m.rotation.set(0, -Math.atan2(b.vx, -b.vy), 0); pGlow(b.x, b.y, 12, '255,120,60', .6, 2); }
        else { if (b.kind === 'snipe') { const sp2 = Math.hypot(b.vx, b.vy) || 1; pBeam(b.x, b.y, b.x - b.vx / sp2 * 26, b.y - b.vy / sp2 * 26, 3.2, '255,120,120', .65, 0, 2); } ebPts.add(wx(b.x), 0, wz(b.y), b.r * 3.7, rgbC(b.rgb), 1); }
      }
      // 粒子、冲击波、星爆、预警光束
      for (const p of particles) { const k = 1 - p.life / p.max; fxPts.add(wx(p.x), 3, wz(p.y), p.size * (.4 + k * .6) * 2.6, rgbC(p.rgb), Math.min(1, k * 1.4)); }
      for (const r of rings) { if (r.life < 0) continue; pRing(r.x, r.y, r.r, r.rgb, 1 - r.life / r.max, 2); }
      for (const nv of novas) { const a = clamp(1 - nv.r / 800, 0, 1); pRing(nv.x, nv.y, nv.r, '217,246,255', a, 2); pRing(nv.x, nv.y, nv.r * .93, '120,225,255', a * .6, 2); pRing(nv.x, nv.y, nv.r * .84, '120,225,255', a * .3, 2); }
      for (const h of hazards) {
        const k = Math.min(1, h.t / h.warn), wa = .15 + .3 * k + (k > .75 ? .2 * Math.sin(t * 50) : 0), a = clamp((h.warn + h.dur - h.t) / .15, 0, 1);
        if (h.cx !== undefined) {   // 圆形落点
          if (h.t < h.warn) { pRing(h.cx, h.cy, h.r, h.rgb, .5 + .4 * k, -1); pRing(h.cx, h.cy, h.r * (1.9 - .9 * k), '255,255,255', .25 + .5 * k, -1); pGlow(h.cx, h.cy, h.r * (.5 + k * .7), h.rgb, wa, -2); }
          else { pGlow(h.cx, h.cy, h.r * 2.3, h.rgb, .9 * a, 2); pGlow(h.cx, h.cy, h.r * 1.2, '255,255,255', a, 3); pRing(h.cx, h.cy, h.r * (1 + (1 - a) * .6), '255,255,255', a, 2); }
        } else if (h.hy !== undefined) {   // 横向光束
          if (h.t < h.warn) pBeam(-40, h.hy, W + 40, h.hy, (2 + h.w * k) * ZS, h.rgb, wa, -1, 1);
          else { pBeam(-40, h.hy, W + 40, h.hy, h.w * 1.25 * ZS, h.rgb, .8 * a, 0, 10); pBeam(-40, h.hy, W + 40, h.hy, h.w * .45 * ZS, '255,255,255', .9 * a, 1, 11); }
        } else if (h.t < h.warn) pBeam(h.x, -60, h.x, H + 80, 2 + h.w * k, h.rgb, wa, -1, 1);
        else { pBeam(h.x, -60, h.x, H + 80, h.w * 1.25, h.rgb, .8 * a, 0, 10); pBeam(h.x, -60, h.x, H + 80, h.w * .45, '255,255,255', .9 * a, 1, 11); }
      }
    } else pb.count = pb2.count = pbE.count = pbC.count = 0;
    ebPts.commit(); fxPts.commit();
    const wd = WX[stg.cfg.wx], wc = rgbC(wd.c);
    for (const p of wxs) wxPts.add(p.x, p.y, p.z, wd.m === 'rain' ? wd.s : wd.s * p.s, wc, wd.a);
    wxPts.commit();
    for (const m of actors) if (!seen.has(m)) { scn.remove(m); actors.delete(m); }
    renderer.render(scn, cam);
  }
  return { init, resize, update, render, toScreen, planeToGround, groundToPlane, groundSpeed, get stg() { return stg; } };
})();

/* =====================================================================
 *  2D 叠加层：飘字、血条、HUD、全屏提示
 * ===================================================================== */
function drawHud2D(t) {
  const k = dpr * scale; ctx.setTransform(k, 0, 0, k, 0, 0); ctx.clearRect(0, 0, W, H);
  if (state === 'menu') { if (wipeT > 0) { ctx.fillStyle = 'rgba(235,242,255,' + Math.sin((1 - wipeT / 1.4) * Math.PI) + ')'; ctx.fillRect(0, 0, W, H); } return; }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const e of enemies) {   // 精英标记和血条
    if (e.dead || e.cloaked) continue;
    const bar = e.type !== 4 && e.maxHp >= 5 && e.hp < e.maxHp;
    if (!bar && !e.elite) continue;
    const s = R.toScreen(e.x, e.y), top = s[1] - e.r - 12;
    if (e.elite) { ctx.font = '800 12px ' + FONT; ctx.fillStyle = '#ffd75a'; ctx.fillText('★', s[0], top - 5); }
    if (bar) { ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(s[0] - 15, top + 2, 30, 3); ctx.fillStyle = '#ff6a8a'; ctx.fillRect(s[0] - 15, top + 2, 30 * e.hp / e.maxHp, 3); }
  }
  if (P.mode === 'possessed') {   // 夺舍机体的生命点
    const g = P.ghost, s = R.toScreen(P.x, P.y), w = 8, gap = 3, tw = g.maxHp * (w + gap) - gap, lift = ET[g.type].r;
    for (let i = 0; i < g.maxHp; i++) { ctx.fillStyle = i < g.hp ? '#8ff0ff' : 'rgba(255,255,255,.25)'; ctx.fillRect(s[0] - tw / 2 + i * (w + gap), s[1] - lift - 16, w, 3.5); }
  }
  for (const p of popups) {
    const q = p.life / p.max, s = R.toScreen(p.x, p.y); ctx.globalAlpha = q < .7 ? 1 : 1 - (q - .7) / .3;
    ctx.font = '800 ' + p.size + 'px ' + FONT; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.strokeText(p.text, s[0], s[1]);
    ctx.fillStyle = p.col; ctx.fillText(p.text, s[0], s[1]);
  }
  ctx.globalAlpha = 1;
  drawOverlays(t); drawHUD(t);
}

/* =====================================================================
 *  尺寸 / 主循环 / 启动
 * ===================================================================== */
function resize() {
  const r = gameEl.getBoundingClientRect();
  if (!r.width || !r.height) return;
  scale = r.width / W; H = r.height / scale;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  document.documentElement.style.setProperty('--u', scale + 'px');
  safeTop = (parseFloat(getComputedStyle($('safeProbe')).paddingTop) || 0) / scale;
  R.resize(r.width, r.height, dpr);
  P.y = clamp(P.y, 0, maxY()); vigKey = '';
}
let lastT = performance.now(), glOK = true;
function frame(now) {
  const dt = Math.min(.05, Math.max(0, (now - lastT) / 1000)); lastT = now;
  for (let i = 0; i < dbgSpeed; i++) update(dt);
  R.render(now / 1000);
  drawHud2D(now / 1000);
  if (state === 'playing') updateControlsUI();
  requestAnimationFrame(frame);
}
try { R.init(); } catch (err) { glOK = false; $('glFail').style.display = 'flex'; }
if (glOK) {
  addEventListener('resize', () => { btnGeo = null; resize(); });
  addEventListener('orientationchange', () => setTimeout(resize, 200));
  resize();
  $('menuBest').textContent = bestScore();
  requestAnimationFrame(frame);
}

// 调试钩子：仅在 URL 带 ?debug 时暴露
if (/[?&]debug/.test(location.search)) {
  window.__g = {
    P, input, get state() { return state; }, get score() { return score; }, get wave() { return wave; }, get H() { return H; }, get scores() { return scores; },
    enemies, bullets, ebullets, powerups, particles, spawnEnemy, spawnPowerup, startGame, pauseGame, resumeGame, enterSoul, hurtPlayer, endGame,
    setScore: v => { score = v; }, setSpeed: v => { dbgSpeed = v; }, get gameTime() { return gameTime; }, get deaths() { return deaths; }, setWave: v => { wave = v; DL = levelOf(v); waveState = 'pause'; waveT = .1; }, WPS, NSTAGE, levelOf, stageOf, killEnemy, useSkill,
    Sfx, SKILL, ET, get hurtFlash() { return hurtFlash; }, get shake() { return shake; },
    setDiff, get diff() { return diffKey; },
    hazards, PERKS, offerPerks, pickPerk, get perks() { return perks; }, get combo() { return combo; }, get grazes() { return grazes; }, BOSSES, STAGES, get scene() { return scene; }, R,
    noWaves: v => { debugNoWaves = v; }, clearEnemies: () => { enemies.forEach(e => e.dead = true); queue.length = 0; }
  };
}
})();
