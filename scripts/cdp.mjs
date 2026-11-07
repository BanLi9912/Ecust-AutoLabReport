// 极简 CDP 客户端（零依赖：用 Node 24 自带的 fetch + WebSocket）
// 用法:
//   node cdp.mjs list                    列出所有页面 target
//   node cdp.mjs eval "<js表达式>"        在目标页面里求值，打印 JSON 结果
//   node cdp.mjs shot <out.png>          整页截图
//   node cdp.mjs nav <url>               导航
// 环境变量: CDP_PORT(默认9222)  CDP_URL_MATCH(按 url 子串挑 target)
import fs from 'node:fs';

const PORT = process.env.CDP_PORT || 9222;
const MATCH = process.env.CDP_URL_MATCH || '';
const [cmd, ...rest] = process.argv.slice(2);

async function targets() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return r.json();
}

function pick(list) {
  const pages = list.filter(t => t.type === 'page' && !t.url.startsWith('devtools://'));
  if (MATCH) {
    const hit = pages.find(t => t.url.includes(MATCH) || (t.title || '').includes(MATCH));
    if (hit) return hit;
  }
  return pages[0];
}

async function connect() {
  const t = pick(await targets());
  if (!t) throw new Error('没有可用的 page target');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = e => rej(new Error('ws error')); });
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
  return { ws, send, target: t };
}

const main = async () => {
  if (cmd === 'list' || !cmd) {
    const list = await targets();
    for (const t of list) {
      console.log(`${t.type.padEnd(8)} ${t.url}\n         title: ${t.title}`);
    }
    return;
  }

  const { ws, send, target } = await connect();
  try {
    await send('Runtime.enable').catch(() => {});
    if (cmd === 'eval' || cmd === 'evalf') {
      const expr = cmd === 'evalf' ? fs.readFileSync(rest[0], 'utf8') : rest.join(' ');
      const r = await send('Runtime.evaluate', {
        expression: expr, returnByValue: true, awaitPromise: true, allowUnsafeEvalBlockedByCSP: true,
      });
      if (r.exceptionDetails) {
        console.error('EXCEPTION:', JSON.stringify(r.exceptionDetails, null, 2));
        process.exitCode = 2;
      } else {
        const v = r.result?.value;
        console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
      }
    } else if (cmd === 'shot') {
      const out = rest[0] || 'shot.png';
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
      console.log('saved', out, `(${(fs.statSync(out).size / 1024).toFixed(0)} KB)`, 'target:', target.url);
    } else if (cmd === 'click') {
      // 用受信任鼠标事件点击：click <css选择器> [nth]
      const sel = rest[0];
      const nth = Number(rest[1] || 0);
      const r = await send('Runtime.evaluate', {
        expression: `(()=>{const el=document.querySelectorAll(${JSON.stringify(sel)})[${nth}];if(!el)return null;el.scrollIntoView({block:'center'});const b=el.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,tag:el.tagName};})()`,
        returnByValue: true,
      });
      const pos = r.result?.value;
      if (!pos) { console.error('no element for', sel, nth); process.exitCode = 1; }
      else {
        for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
          await send('Input.dispatchMouseEvent', { type, x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
          await new Promise(res => setTimeout(res, 60));
        }
        console.log(`clicked ${pos.tag} at ${Math.round(pos.x)},${Math.round(pos.y)}`);
      }
    } else if (cmd === 'net') {
      // 监听 XHR/fetch 请求+响应，NET_SECONDS 秒后退出
      const secs = Number(process.env.NET_SECONDS || 15);
      const reload = process.env.NET_RELOAD === '1';
      const outFile = rest[0] || 'net.json';
      const recs = [];
      const bodies = new Map();
      ws.addEventListener('message', ev => {
        const m = JSON.parse(ev.data);
        if (m.method === 'Network.requestWillBeSent' && /XHR|Fetch/.test(m.params.type)) {
          recs.push({ id: m.params.requestId, method: m.params.request.method, url: m.params.request.url, post: (m.params.request.postData || '').slice(0, 2000) });
        } else if (m.method === 'Network.loadingFinished') {
          const r = recs.find(x => x.id === m.params.requestId);
          if (r) bodies.set(m.params.requestId, m.params.encodedDataLength);
        } else if (m.method === 'Network.responseReceived') {
          const r = recs.find(x => x.id === m.params.requestId);
          if (r) r.status = m.params.response.status;
        }
      });
      await send('Network.enable');
      await send('Page.enable');
      if (reload) await send('Page.reload', { ignoreCache: false });
      await new Promise(r => setTimeout(r, secs * 1000));
      // 拉取响应体
      for (const r of recs) {
        try {
          const b = await send('Network.getResponseBody', { requestId: r.id });
          const txt = b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body;
          r.resp = txt.slice(0, 4000);
        } catch { /* body 已丢弃 */ }
      }
      fs.writeFileSync(outFile, JSON.stringify(recs, null, 1), 'utf8');
      console.log(`saved ${recs.length} XHR records -> ${outFile}`);
      for (const r of recs) console.log(`${r.status || '-'} ${r.method} ${r.url.replace('https://chemzoo.ecust.edu.cn', '')} ${r.resp ? r.resp.length + 'B' : ''}`);
    } else if (cmd === 'reload') {
      await send('Page.enable');
      await send('Page.reload', { ignoreCache: true });
      console.log('reloaded (ignoreCache)');
    } else if (cmd === 'nav') {
      await send('Page.enable');
      const url = rest[0];
      await send('Page.navigate', { url });
      console.log('navigated', url);
    } else {
      console.error('unknown cmd', cmd);
      process.exitCode = 1;
    }
  } finally {
    ws.close();
  }
};

main().catch(e => { console.error('ERR', e.message); process.exitCode = 1; });

