---
name: ecust-lab-report
description: 把实验讲义 PDF（含纸质数据）整理并填进华东理工 chemzoo 电子实验记录本（ELN）的实验报告。串起讲义解析、公式/装置图裁图、分块 HTML 生成、经 CDP 接管已登录 Edge 直接调后端接口写入并回读校验。用于「交实验报告」「讲义转报告」「往 ELN 里填实验内容」这类重复填写工作。
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# 实验报告填写（chemzoo ELN）

网站禁止复制粘贴、编辑器一刷新就丢内容，所以**不要**靠模拟键盘输入。本 skill 走的是：
接管一个已登录的 Edge（CDP）→ 在页面上下文里 `fetch` 后端接口 → 回读校验。

## 输入

| 输入 | 必需 | 说明 |
| --- | --- | --- |
| 报告页 URL | 是 | `https://chemzoo.ecust.edu.cn/#/home/eln/notebooks/reactions/<rxn_id>` |
| 讲义 PDF | 是 | 一个 PDF 里常放多个实验，用 `--pages` 截取本次实验那几页 |
| 纸质报告照片 | 填「原始数据记录」必需 | **照片直接原样上传**（`paper_photos.py`），不做 OCR——本地 OCR 对手写体完全无效。要拿里面的数字算数据处理时，让用户把照片发进对话（模型能直接看），或把数字口述/贴出来 |
| 是否照抄 | 默认照抄 | 要不要改写必须在动手前问一次 |

## 目录约定

脚本根：

```powershell
$S = "$env:USERPROFILE\.dsh\skills\ecust-lab-report"
```

工作目录 = **桌面下按实验名建的文件夹**，先跑一次拿到路径：

```powershell
$work = python "$S\scripts\workdir.py" "分子磁化率测定" --quiet
```

- 默认 `<桌面>\实验报告\<实验名>\`；桌面用 Windows 已知文件夹 API 解析，OneDrive 重定向过也能落到真桌面。
- 想换位置：脚本加 `--root D:\lab`，或设环境变量 `LAB_REPORT_HOME`。
- 同名实验**复用**目录、不清空；同一实验重做一次就在名字后加 `-2`。
- 结束时把 `$work` 告诉用户，他随时可以整个删掉。

```
<work>/
  paper/           纸质报告照片的副本
  lines.jsonl      每个文字行的坐标（debug 用）
  blocks.json      讲义切块结果
  figs/            裁出来的公式/插图 PNG
  preview.txt      人读的切块预览（先看这个）
  html/gen/*.html  自动生成的分块 HTML
  html/final/*.html 人工过一遍后真正要上传的 HTML
  shots/           页面截图（调试用，可删）
```

## 流程

### 0. 建工作目录，开调试浏览器，确认登录

```powershell
$work = python "$S\scripts\workdir.py" "<实验名>" --quiet    # 记下这个路径
powershell -NoProfile -ExecutionPolicy Bypass -File "$S\scripts\start-edge.ps1" -Url "<报告URL>"
node "$S\scripts\cdp.mjs" list     # 看到 chemzoo 页面即通
```

- 登录态在 localStorage，脚本只复制 `Local Storage\leveldb` + `Local State` + `Preferences`，所以**不用关用户自己的 Edge、不用重新输密码**。
- 若页面停在登录页：让用户在这个新窗口里登录一次（profile 在 `C:\edge-dbg`，之后一直有效）。
- 端口已占用时脚本直接复用，重复执行安全。

### 1. 看报告有哪些分块

```powershell
node "$S\scripts\push.mjs" list
```

输出每块的字数与 `text_id`。块的标题各实验不一定一样（有的含「实验装置图」，有的没有）；**`text_id` 每个报告都不同，不要硬编码**，一切以 `list` 为准。
现行 8 块：实验目的 / 实验原理 / 仪器和试剂 / 实验步骤 / 原始数据记录 / 数据处理及实验结果 / 分析与讨论 / 思考题。

### 2. 解析讲义

```powershell
python "$S\scripts\pdf_blocks.py" "<讲义.pdf>" "<work>" [起始页] [结束页]
```

看 `preview.txt`：

- 段落要成句（若被切成一句一行，是行合并条件没满足，别硬凑，直接把相邻段落拼起来即可）；
- 公式要**整条**一张图（出现半截公式、单字符碎图，说明分带/过滤阈值要调）；
- 装置图、电子排布图这类插图应各自成一张。

公式**不要**用文字，一律裁图：PyMuPDF 取文字会把下标、根号、分数全打散。

排得乱、切不准时先看逐行坐标：

```powershell
python "$S\scripts\pdf_text.py" "<讲义.pdf>" "<work>" [起始页] [结束页]
```

### 3. 生成分块 HTML

```powershell
python "$S\scripts\build_sections.py" "<work>"
```

按讲义标题自动映射到网站分块，图片用 PIL 压到宽 ≤900px 后 base64 内嵌（`<p><img src="data:image/png;base64,..." style="width:Npx" /></p>`）。网站**没有上传接口**，图片就是 base64 塞进 HTML，单字段 1.8MB 都收得下。

生成结果只是骨架，接下来自己过一遍，写到 `<work>/html/final/`：

- 实验目的 / 实验原理 / 实验步骤：照抄讲义，只做排版整理（`<p>`、`<br />`、`<sub>`）；
- 仪器和试剂：合并成紧凑两行；
- 分析与讨论：**先问用户**本次实验中有没有遇到问题（示数漂移、样品装填、称量不稳、操作失误等），
  再按「简述实验经过 + 用户提到的问题 + 结合讲义原理/目的分析」扩写到 **150 字左右** 写进该块。
  用户说什么就写什么，**不要替用户编造实验异常**。
- 思考题：讲义只有题目时，答案要自己写，并且明确标注这是模型写的；
- 原始数据记录：**不要转写成文字**，用纸面照片：

```powershell
python "$S\scripts\paper_photos.py" "<work>\html\final\原始数据记录.html" paper\p1.jpg paper\p2.jpg
```

  脚本把照片压到宽 ≤900px、JPEG 质量 82、base64 内嵌，每张一个 `<p><img>`。服务器会把图重编码成 PNG（体积约 2 倍），所以别传超大图。

- 数据处理及实验结果：按讲义公式算，公式、代入过程、结果表、误差分析都要写出来（磁化率这类古埃法见 `reference/handout-to-html.md` 的算法示例）。

### 4. 写入

```powershell
node "$S\scripts\push.mjs" set "实验原理" "<work>\html\final\实验原理.html"
```

- 回读一致会打印 `OK 回读一致`；打印 `WARN 回读不一致` 说明服务器改写了内容，看它给出的前 120 字。
- 服务器会把换行规范成 `\r\n`、把图片重编码成 PNG，脚本按「文字 + 图片张数」比较，这类差异不算失败。
- **接口写的是数据库，页面不会自己变**——所以「写完了」不等于「页面上有」。全部块写完后必须跑一次页面级核对：

### 5. 页面级核对（必做）

```powershell
node "$S\scripts\verify.mjs" <rxn_id>
```

它会 `Page.reload` → 回跳报告页 → 等 Angular 把 8 个卡片和图片渲染完，然后逐卡打印「字数 / 图片数 / 前 40 字」。输出示例：

```
    68字  0图  实验目的  | 1、掌握古埃(Gouy)法测定磁化率的原理和方法。…
  1709字 18图  实验原理  | 1. 在外磁场作用下，物质会被磁化并产生附加磁感应强度…
     0字  2图  原始数据记录
  1888字  0图  数据处理及实验结果  | 1、实验条件与样品质量实验开始温度 22.5 ℃…
```

- 标注 `<空>` 的块是真没内容；字数远小于本地文件就要查（可能被服务器截断）。
- 图片块 `0字 2图` 是正常的（只有图没有文字）。
- 打印 `<图片未加载>` 表示 base64 坏了，重新生成 HTML 再推。
- 核对通过后再让用户看页面——**不要自己说"已上传"而没跑这一步**（踩过：用户看到的还是空卡片）。

### 6. 交付

向用户交代清楚：哪些是照抄、哪些是模型写的（尤其思考题答案）、哪些块还缺数据，以及 **`$work` 的路径**（告诉他这个文件夹留着可复现、删掉也不影响已提交的网站内容）。**提交（submit）动作永远由用户自己做**——工具条上的 submit 会走正式提交流程，不要代点。

## 硬规则

1. **不要走弹窗编辑器**。点铅笔 → 对话框 → `setData` → 「更新文本」这条路，短内容会被提交成空串（保存读的是 Angular 表单模型，不是编辑器缓存），长内容才碰巧能成。统一用 `push.mjs` 打接口。
2. **文字默认照抄讲义**。要改写先问；用户明确要求改写才动。
3. **公式一律裁图**，正文里的数学符号用 `<sub>/<sup>` 表达。
4. **图片怎么给**：本地图片文件读不了（`read` 拒绝二进制），但**用户直接发进对话的图片能看**。纸面数据要么让用户发图进聊天，要么口述；「原始数据记录」块本身用照片原图，不做 OCR 转写。
5. **不要硬编码 text_id / rxn_id**：rxn_id 从 URL 解析，text_id 从 `list` 拿。
6. 只在用户报告的页面上动手；别人的报告、勿动的历史报告不要碰。
7. **数据处理里每个数字都要能追溯到纸面数据**，算不出来就留空问用户，绝不编数据。

## 故障速查

| 现象 | 原因 / 处理 |
| --- | --- |
| `没有可用的 page target` | Edge 没带 `--remote-debugging-port` 启动，跑 `start-edge.ps1` |
| CDP 端口起不来 | `--user-data-dir` 用了中文路径，换成 `C:\edge-dbg` 这类 ASCII 路径 |
| `push.mjs` 报 `页面 url 里没有 reactions/<id>` | 当前页是列表页，先 `cdp.mjs nav` 到报告页，或设 `RXN_ID` |
| 写入 200 但页面还是旧内容 | 正常，接口写的是库；跑 `verify.mjs` 做 reload + 回跳 |
| 用户看到卡片是空的 | 你没跑 `verify.mjs`（页面没刷新），不是没写进去 |
| 分块标题对不上 | 跑 `push.mjs list` 看真实标题，按它改名 |
| 讲义图太小/带黑边 | 调 `pdf_blocks.py` 的裁剪 padding 与 dpi（默认 300） |

## 细节文档

- 站点结构、接口字段、DOM 与验证方式：`reference/site-eln.md`
- 讲义解析算法、映射表、HTML 排版约定：`reference/handout-to-html.md`
