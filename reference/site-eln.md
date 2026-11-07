# chemzoo ELN 站点细节

## 技术栈与结构

- Angular（有 `mat-*` 组件、`__zone_symbol__*` 补丁）+ **CKEditor 4 inline**（`CKEDITOR.instances`）。
- 页面里还带一个 `iframe https://chemzoo.ecust.edu.cn/assets/Marvin/marvinpack.html`（MarvinSketch 结构式编辑器），调试时忽略。
- 报告页 hash：`#/home/eln/notebooks/reactions/<rxn_id>`。

### 分块 DOM

```
app-text-item-card
  div.header-title  > h6.title            分块名（实验目的…）
                     button.mat-icon-button[svgicon=edit-outline]   编辑当前文本
  mat-card-content > div.text-box > app-rich-text-editor > ckeditor
                     > textarea + div.cke_textarea_inline.cke_editable
```

- 编辑入口：点 `button.mat-icon-button` → `mat-dialog-container > app-text-content-edit`（标题「文本编辑器」，正文 CKEditor，按钮「取消」/「更新文本」）。
- 页面级工具条（tooltip）：settings 查看/更新基本信息、submit **提交实验报告**、obsolete 废弃此实验、history、chatting、subnav-close、add。
- 已提交/只读的历史报告是另一种形态：CKEditor `readOnly:true`、卡片头部按钮变成 `wrong / half_right / right` 且 disabled，页面上还有个 `unlock` 按钮。**本 skill 只处理可编辑的空白报告**。

## 接口

Base：`/api/secure/eln/module/experiments`（同源，页面内 `fetch` 自动带登录 token，token 在 localStorage）

| 用途 | 请求 | 字段 |
| --- | --- | --- |
| 读报告 | `POST retrieve_rxn_by_id` | form: `rxn_id` |
| 写分块 | `POST content/text/update_text` | form: `rxn_id`、`content`、`text_title`、`text_id` |

读返回（节选）：

```json
{ "rxn": {"rxn_id": 12345678, "rxn_name": "磁化率的测定", "rxn_time": "YYYY.MM.DD", ...},
  "notebook": {"nb_id": 87654321},
  "teacher": {"display_name": "某老师"},
  "contents": [{"id": 12345679, "text_title": "实验目的", "content": "<p>…</p>", "right_status": "Init", "type": "text"}] }
```

写返回：`{"status":"Success","text":{...}}`；失败看 HTTP 码与 body。

- 抓包里写接口曾显示成 `/api/secure//eln/...`（双斜杠），单斜杠同样可用。
- `content` 是 HTML 片段；图片是 **base64 data URI 内联**在 `<img src="data:image/png;base64,...">` 里（全站没有一个 `input[type=file]`）。单字段塞过 1.8MB 没问题。

## 踩过的坑

| 坑 | 事实 |
| --- | --- |
| 弹窗编辑器写入丢失 | 点铅笔 → `CKEDITOR.instances[x].setData(html)` → 「更新文本」，**短 HTML 会被提交成空串**（保存读 Angular 表单模型而非编辑器缓存）；长内容（~475KB）才碰巧成功。→ 一律用 `push.mjs` 打接口。 |
| JS 点击失效 | 早期 `element.click()` 能弹对话框，后来失效。→ 用 CDP `Input.dispatchMouseEvent`（`cdp.mjs click`）。 |
| 坐标点击点空 | 没 `scrollIntoView({block:'center'})`，`getBoundingClientRect()` 给负 y。 |
| 写后立刻读 DOM 是 0 字 | 渲染滞后；要么 reload，要么直接读接口。 |
| reload 掉路由 | `Page.reload{ignoreCache:true}` 会回到 `#/home/eln/notebooks`，必须再 nav 回 reactions 页。同 hash 的 `Page.navigate` 是空操作，不会重新拉数据。 |
| 拿不到组件实例 | 生产构建没有 `__ngContext__`，`window.ng` 不存在。 |
| 换行被规范 | 服务器存成 `\r\n`，比较内容前要归一化（`push.mjs` 已处理）。 |
| 图片存进去变大 | 服务器把 base64 图片**重编码成 PNG**（900px JPEG 407KB → 入库 900KB，注意 mime 标签仍是 jpeg）。所以 `push.mjs` 按「文字 + 图片张数」比较，不逐字节比。 |
| PowerShell 改写文本变乱码 | PS 5.1 的 `Get-Content` 默认按系统 ANSI(GBK) 解码，无 BOM 的 UTF-8 文件会被读坏，再 `[IO.File]::WriteAllText` 就把乱码写死（实测把 README 写成 112 处「锛/鐨」，推上 GitHub 整页乱码）。改文本要么带 `-Encoding UTF8` 读写，要么直接用编辑器改；`.ps1` 自身含中文必须存 UTF-8 with BOM。 |

## 验证口径

1. `push.mjs set` 回读内容与本地文件归一化后相等（打印 `OK 回读一致`）。
2. `push.mjs check` 的字数与预期一致。
3. 人工看一眼页面：文字无乱码、公式图清晰、图片在正确段落之后。

## Edge / CDP 环境（本机实测）

- Edge 156，`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`；无 Chrome。
- Edge 136+ **不允许**在默认 profile 上开 `--remote-debugging-port`，必须 `--user-data-dir` 指向单独目录。
- 该目录**必须是 ASCII 路径**（用中文路径时端口起不来）；本机用 `C:\edge-dbg`。
- 登录态在 `Default\Local Storage\leveldb`：只复制 `Local State`、`Default\Preferences`、`Local Storage\leveldb`、`Session Storage` 即可继承登录，**不必关用户自己的 Edge**，也不必重输密码。
- **Cookies 数据库在 Edge 运行时被独占锁**（`copyFile` / `open` 都 EBUSY），别指望复制 cookie。
- 本机 `curl.exe` 访问 https 一律 `http=000`，探测用 `node -e fetch`。
- PowerShell 是 5.1（没有 `pwsh`）；`.ps1` 受执行策略限制，用 `powershell -NoProfile -ExecutionPolicy Bypass -File`；脚本含中文必须存 UTF-8 **with BOM**，否则 5.1 按 ANSI 读会炸引号。
