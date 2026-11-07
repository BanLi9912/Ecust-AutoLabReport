// 在浏览器里核对报告页真实渲染的内容（接口写入后页面不会自动刷新，必须 reload + 回跳）。
// 用法: node verify.mjs [rxn_id]        rxn_id 省略时从当前 url 解析
// 环境变量: CDP_PORT(默认9222) CDP_URL_MATCH
const PORT = process.env.CDP_PORT || 9222;
const MATCH = process.env.CDP_URL_MATCH || '';
const rxArg = process.argv[2];

async function connect() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const list = (await r.json()).filter(t => t.type === 'page' && !t.url.startsWith('devtools://'));
  const t = MATCH ? (list.find(x => x.url.includes(MATCH) || (x.title || '').includes(MATCH)) || list[0]) : list[0];
  if (!t) throw new Error('没有可用的 page target');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, m => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
    return r.result.value;
  };
  return { ws, send, evaluate, target: t };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const PROBE = `(() => {
  const cards = [...document.querySelectorAll('app-text-item-card')];
  return JSON.stringify(cards.map(c => {
    const t = c.querySelector('.header-title') || c.querySelector('h6');
    const ed = c.querySelector('.cke_editable') || c.querySelector('.text-box') || c;
    const imgs = [...ed.querySelectorAll('img')];
    const txt = (ed.textContent || '').replace(/\\s+/g, ' ').trim();
    return {
      title: (t ? t.textContent : '?').trim(),
      chars: txt.length,
      imgs: imgs.length,
      head: txt.slice(0, 40),
      imgOk: imgs.every(i => i.complete && i.naturalWidth > 0),
    };
  }));
})()`;

const main = async () => {
  const { ws, send, evaluate, target } = await connect();
  try {
    let rxn = rxArg || (target.url.match(/reactions\/(\d+)/) || [])[1];
    const base = new URL(target.url).origin;
    if (!rxn) throw new Error('不知道 rxn_id，请显式传入');
    const url = `${base}/#/home/eln/notebooks/reactions/${rxn}`;

    // 1) 强制重新拉数据：reload 会掉回列表页，所以 reload 后必须再 nav 回来
    await send('Page.enable');
    await send('Page.reload', { ignoreCache: true });
    await sleep(1500);
    await send('Page.navigate', { url });
    await sleep(1500);

    // 2) 等卡片渲染 + 内容从接口加载完（总字数与图片数连续两次不变视为稳定）
    let prev = '';
    for (let i = 0; i < 40; i++) {
      const s = await evaluate(`(() => {
        const cards = [...document.querySelectorAll('app-text-item-card')];
        let chars = 0, imgs = 0;
        for (const c of cards) {
          const ed = c.querySelector('.cke_editable') || c.querySelector('.text-box');
          if (!ed) continue;
          chars += (ed.textContent || '').replace(/\\s+/g, '').length;
          imgs += ed.querySelectorAll('img').length;
        }
        const done = [...document.querySelectorAll('.cke_editable img')].every(i => i.complete);
        return JSON.stringify({ cards: cards.length, chars, imgs, done });
      })()`).catch(() => '');
      if (s && s === prev && JSON.parse(s).chars > 0) break;
      prev = s;
      await sleep(700);
    }

    const rows = JSON.parse(await evaluate(PROBE));
    console.log(`页面: ${url}   卡片 ${rows.length} 个`);
    for (const r of rows) {
      const flag = r.chars === 0 && r.imgs === 0 ? '  <空>' : (r.imgs && !r.imgOk ? '  <图片未加载>' : '');
      console.log(`${String(r.chars).padStart(6)}字 ${String(r.imgs).padStart(2)}图  ${r.title}${flag}${r.head ? '  | ' + r.head : ''}`);
    }
    if (rows.some(r => r.imgs && !r.imgOk)) process.exitCode = 4;
  } finally {
    ws.close();
  }
};

main().catch(e => { console.error('ERR', e.message); process.exitCode = 1; });
