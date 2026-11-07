// 读写 chemzoo ELN 实验报告的某个分块（直接走后端接口，不依赖弹窗/编辑器）。
// 用法:
//   node push.mjs list                          列出分块（标题 | text_id | 当前字数）
//   node push.mjs get "<分块标题>" [out.html]    取回该分块 HTML（可保存到文件）
//   node push.mjs set "<分块标题>" <html文件>     写入并回读校验
//   node push.mjs check                         逐块回读字数，做总览
// 环境变量: CDP_PORT(默认9222) CDP_URL_MATCH(按 url 子串挑页面) RXN_ID(默认从页面 url 解析)
import fs from 'node:fs';

const PORT = process.env.CDP_PORT || 9222;
const MATCH = process.env.CDP_URL_MATCH || '';
const [cmd, ...rest] = process.argv.slice(2);

const API = '/api/secure/eln/module/experiments';

async function connect() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const list = (await r.json()).filter(t => t.type === 'page' && !t.url.startsWith('devtools://'));
  const t = MATCH ? (list.find(x => x.url.includes(MATCH) || (x.title || '').includes(MATCH)) || list[0]) : list[0];
  if (!t) throw new Error('没有可用的 page target（Edge 是否带 --remote-debugging-port 启动？）');
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
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
    return r.result.value;
  };
  return { ws, send, evaluate, target: t };
}

// 页面内执行：取回全部分块（保证与站点同一 auth）
const RETRIEVE = rx => `(async () => {
  const fd = new FormData(); fd.append('rxn_id', ${JSON.stringify(rx)});
  const r = await fetch('${API}/retrieve_rxn_by_id', { method: 'POST', body: fd });
  if (!r.ok) return JSON.stringify({ error: r.status });
  const j = await r.json();
  return JSON.stringify((j.contents || []).map(c => ({ id: c.id, title: c.text_title, content: c.content || '' })));
})()`;

const main = async () => {
  const { ws, evaluate, target } = await connect();
  try {
    const m = target.url.match(/reactions\/(\d+)/);
    const rxn = process.env.RXN_ID || (m && m[1]);
    if (!rxn) throw new Error('页面 url 里没有 reactions/<id>，请设置 RXN_ID');

    const sections = JSON.parse(await evaluate(RETRIEVE(rxn))).map(s => ({ ...s, chars: s.content.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').length }));

    if (cmd === 'list' || cmd === 'check' || !cmd) {
      console.log(`rxn_id=${rxn}  ${target.url}`);
      for (const s of sections) console.log(`${String(s.chars).padStart(6)}字  id=${s.id}  ${s.title}`);
      return;
    }

    const title = rest[0];
    const hit = sections.find(s => s.title.trim() === (title || '').trim());
    if (!title) throw new Error('缺少分块标题');
    if (!hit) throw new Error(`没有分块「${title}」，现有: ${sections.map(s => s.title).join(' / ')}`);

    if (cmd === 'get') {
      if (rest[1]) { fs.writeFileSync(rest[1], hit.content, 'utf8'); console.log('saved', rest[1], hit.content.length, 'B'); }
      else console.log(hit.content);
      return;
    }

    if (cmd === 'set') {
      const htmlFile = rest[1];
      if (!htmlFile) throw new Error('缺少 html 文件');
      const html = fs.readFileSync(htmlFile, 'utf8');
      const res = JSON.parse(await evaluate(`(async () => {
        const fd = new FormData();
        fd.append('rxn_id', ${JSON.stringify(rxn)});
        fd.append('content', ${JSON.stringify(html)});
        fd.append('text_title', ${JSON.stringify(hit.title)});
        fd.append('text_id', ${JSON.stringify(String(hit.id))});
        const r = await fetch('${API}/content/text/update_text', { method: 'POST', body: fd });
        const t = await r.text();
        return JSON.stringify({ status: r.status, body: t.slice(0, 200) });
      })()`));
      if (res.status !== 200) throw new Error(`写入失败 ${res.status}: ${res.body}`);
      const check = JSON.parse(await evaluate(RETRIEVE(rxn))).find(s => String(s.id) === String(hit.id));
      // 服务器会把换行规范成 \r\n，图片还会被重编码（jpeg 塞进去出来是 PNG），
      // 所以比较文字内容 + 图片张数，而不是逐字节相等。
      const text = s => s.replace(/<img\b[^>]*>/gi, '[img]').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, '');
      const imgs = s => (s.match(/<img\b/gi) || []).length;
      const same = text(check.content) === text(html) && imgs(check.content) === imgs(html);
      const sizeNote = check.content.length === html.length ? '' : `（服务器重编码，${html.length}→${check.content.length} 字符）`;
      console.log(`写入 ${hit.title} (id=${hit.id}) -> ${res.status} ${same ? 'OK 回读一致' + sizeNote : 'WARN 回读不一致'}  本地 ${html.length}B / 服务器 ${check.content.length}B`);
      if (!same) {
        console.log(`  文字: 本地 ${text(html).length} 字 / 服务器 ${text(check.content).length} 字；图片: ${imgs(html)} / ${imgs(check.content)}`);
        console.log('服务器前 120 字:', check.content.slice(0, 120));
        process.exitCode = 3;
      }
      console.log('提示：接口写的是数据库，页面不会自动更新；全部写完跑 `node verify.mjs` 做页面级核对。');
      return;
    }

    throw new Error(`未知命令 ${cmd}`);
  } finally {
    ws.close();
  }
};

main().catch(e => { console.error('ERR', e.message); process.exitCode = 1; });
