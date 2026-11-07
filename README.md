# Ecust-AutoLabReport

把华东理工大学 **chemzoo 电子实验记录本（ELN）**里「填实验报告」这件事交给 agent：
一张讲义 PDF + 几张纸质报告照片 → 自动整理成 8 个分块 → 直接写进网站。

不开无头浏览器、不模拟键盘、不碰剪贴板。这个仓库是一个可直接安装的 **agent skill**（DSH skill 格式）。

---

## 为什么需要它

chemzoo 的编辑器有三个硬毛病：

1. **禁止粘贴**：正文是 CKEditor 4 inline，外面套 Angular，粘贴事件被拦。
2. **刷新就丢**：`setData` 改了内容不保存，弹窗里点「更新文本」时保存的又是 Angular 表单模型，
   短内容会以空串提交（实测踩过，见 `reference/site-eln.md` 的踩坑表）。
3. **公式和插图搬不动**：讲义里的公式是排版出来的，复制出来下标、根号、分数线全散。

所以这里的做法不是「更聪明的复制粘贴」，而是**绕到编辑器后面去**：

- 用一个带 `--remote-debugging-port` 的 Edge 接管已登录页面（Edge 136+ 必须用独立 `--user-data-dir`）；
- 在页面上下文里直接 `POST` 后端接口 `/api/secure/eln/module/experiments/content/text/update_text`；
- 图片不需要上传接口——全站没有一个 `input[type=file]`，图片就是 base64 data URI 内联在 HTML 里；
- 写完**回读接口** + **跑到页面上逐卡核对**，两道关都过才算写完。

## 流程

```
讲义 PDF ──pdf_blocks.py──► blocks.json + figs/*.png
                                   │
                          build_sections.py
                                   ▼
                          html/gen → html/final（人工过一遍）
                                   │
纸质照片 ──paper_photos.py──► base64 <img> ──push.mjs──► POST update_text
                                   │
                             verify.mjs（reload + 逐卡核对）
```

对应 `SKILL.md` 的六步：建工作目录并开调试浏览器 → `push.mjs list` 看分块 → 解析讲义 →
生成 HTML → 逐块写入 → 页面级核对 → 交接（提交由人点）。

## 前置条件

| 项目 | 要求 |
| --- | --- |
| 系统 | Windows 10/11 + Microsoft Edge（脚本按 Edge 136+ 的调试端口限制处理） |
| Python | 3.10+，`pip install pymupdf pillow` |
| Node | 22+（用到全局 `fetch` 与 `WebSocket`，**零 npm 依赖**） |
| Agent | DSH（DeepSeek Harness），能读 skill 并执行 PowerShell |

不需要 Playwright / Selenium / puppeteer。

## 安装

```powershell
git clone https://github.com/BanLi9912/Ecust-AutoLabReport "$env:USERPROFILE\.dsh\skills\ecust-lab-report"
```

目录名必须是 `ecust-lab-report`（与 `SKILL.md` 的 `name` 一致），DSH 才能在会话里自动加载它。

## 快速开始

```powershell
$S = "$env:USERPROFILE\.dsh\skills\ecust-lab-report"

# 0) 建本次实验的工作目录（桌面\实验报告\<实验名>\）
python "$S\scripts\workdir.py" "分子磁化率测定"

# 1) 开一个带调试端口的 Edge（复用你已登录的 localStorage，不用重输密码）
powershell -NoProfile -ExecutionPolicy Bypass -File "$S\scripts\start-edge.ps1" -Url "<报告页 URL>"
node "$S\scripts\cdp.mjs" list

# 2) 报告有哪几块、各自的 text_id
node "$S\scripts\push.mjs" list

# 3) 讲义 → 切块 + 裁图
python "$S\scripts\pdf_blocks.py" "<讲义.pdf>" "<work>" 1 4
python "$S\scripts\build_sections.py" "<work>"

# 4) 写入单块（可先加 --dry 看会发什么）
node "$S\scripts\push.mjs" set "实验原理" "<work>\html\final\实验原理.html"

# 5) 页面级核对（必做，写完的东西不会自己出现在页面上）
node "$S\scripts\verify.mjs" <rxn_id>
```

`verify.mjs` 的输出长这样（正文首字截断）：

```
    68字  0图  实验目的  | 1、掌握古埃(Gouy)法测定磁化率的原理和方法…
  1709字 18图  实验原理  | 1. 在外磁场作用下，物质会被磁化…
     0字  2图  原始数据记录
  1888字  0图  数据处理及实验结果  | 1、实验条件与样品质量…
```

## 目录结构

```
SKILL.md                     agent 读的说明书：输入、六步流程、硬规则、故障速查
reference/site-eln.md        站点结构、接口表、登录态、踩坑表（Edge/CDP/PowerShell 坑）
reference/handout-to-html.md 讲义解析算法、调参、各分块内容来源、古埃法算法示例
scripts/start-edge.ps1       复制最小登录态 + 起调试端口 + 等端口就绪
scripts/cdp.mjs              零依赖 CDP 客户端：list/eval/click/shot/nav/reload/net
scripts/push.mjs             列分块、读单块、写单块（直接打接口）、回读比对
scripts/verify.mjs           reload + 回跳报告页 + 逐卡核对字数与图片数
scripts/pdf_blocks.py        讲义行级分类 + y 分带裁公式/插图
scripts/pdf_text.py          导出每行坐标，排查排版问题用
scripts/build_sections.py    按讲义标题切分并生成各分块 HTML（图片 base64）
scripts/paper_photos.py      纸质照片 → 压到宽 ≤900px → base64 内联
scripts/workdir.py           按实验名在桌面建工作目录（支持 OneDrive 重定向）
```

## 已知限制

- **PDF 必须有文字层**。纯扫描讲义切不出来（`/Font` 数为 0 就别试了）。
- **公式一律裁图**，不抽文字：PyMuPDF 抽出来的下标、根号、分数全碎。
- **手写数据不做 OCR**。Windows OCR 对手写体输出是乱码碎片；靠模型看图或让用户口述。
- **数据不能编**：数据处理里每个数字都要能追溯到纸面原始数据，算不出来就留空问人。
- **站点改版就失效**：接口路径、分块字段名、DOM 结构任一变化都要重抓一遍网络请求。
- 只在化学 / 物理化学讲义上验证过；分块标题在不同课程里会变（有的多一块「实验装置图」）。

## 安全与边界

- 本工具**只针对你自己的账号、你自己打开的那份报告**，不要拿它去动别人的报告或已归档的历史报告。
- 登录态存在 `localStorage` 里，脚本复制的 `C:\edge-dbg` 包含你的 token：**不要把它提交进仓库，也不要发给别人**。
- **提交（submit）永远由你自己点**。工具只负责把内容写进分块，不代按「提交实验报告」。
- 仓库里**不含**任何讲义 PDF、实验数据、纸质报告照片和个人信息，示例数据均已脱敏。

## 免责声明

自动化填写实验报告是否符合课程要求，由任课教师与院系规定决定；使用本工具产生的任何后果（内容错误、
格式不符、被判定违规等）由使用者自行承担。请把它当作「省掉手工搬运」的工具，而不是替你完成实验的东西。

## License

MIT，见 `LICENSE`。
