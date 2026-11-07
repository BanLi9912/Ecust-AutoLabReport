"""blocks.json -> 网站分块 HTML（图片 base64 内嵌，宽度压到可读尺寸）。
用法: python build_sections.py <workdir>
输出: <workdir>/html/<section>.html + <workdir>/html/manifest.json
"""
import base64
import io
import json
import os
import sys

from PIL import Image

MAXW = 900

SEC_ORDER = ['实验目的', '实验原理', '仪器和试剂', '实验步骤', '原始数据记录',
             '数据处理及实验结果', '分析与讨论', '思考题']

HEAD_MAP = {'一、实验目的': '实验目的', '二、实验原理': '实验原理', '三、实验试剂及仪器': '仪器和试剂',
            '四、实验步骤': '实验步骤', '五、数据处理': '数据处理及实验结果',
            '六、思考题': '思考题', '七、进一步讨论': None}

# 不同课的讲义标题写法不一样，兜底按关键字认
KEYWORDS = [('目的', '实验目的'), ('原理', '实验原理'), ('试剂', '仪器和试剂'), ('仪器', '仪器和试剂'),
            ('步骤', '实验步骤'), ('操作', '实验步骤'), ('数据', '数据处理及实验结果'),
            ('结果', '数据处理及实验结果'), ('思考', '思考题'), ('讨论', '分析与讨论')]


def resolve_heading(text):
    t = text.strip().replace(' ', '').replace('\u3000', '')
    if t in HEAD_MAP:
        return HEAD_MAP[t]
    if '进一步' in t or '参考' in t or '附录' in t:
        return None
    for kw, sec in KEYWORDS:
        if kw in t:
            return sec
    return None


def para_html(t):
    return '<p>' + t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;') + '</p>'


def img_html(path, maxw=MAXW):
    im = Image.open(path).convert('RGB')
    if im.width > maxw:
        im = im.resize((maxw, round(im.height * maxw / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'PNG', optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode()
    style = '' if im.width < 240 else ' style="width:%dpx"' % im.width
    return '<p><img src="data:image/png;base64,%s"%s /></p>' % (b64, style), len(b64)


def main():
    work = sys.argv[1]
    blocks = json.load(open(os.path.join(work, 'blocks.json'), encoding='utf-8'))
    sec = None
    groups = {k: [] for k in SEC_ORDER}
    for b in blocks:
        if b['kind'] == 'heading':
            sec = resolve_heading(b['text'])
            continue
        if sec:
            groups[sec].append(b)

    outdir = os.path.join(work, 'html')
    os.makedirs(outdir, exist_ok=True)
    manifest = {}
    for name in SEC_ORDER:
        parts, nimg, total = [], 0, 0
        for b in groups[name]:
            if b['kind'] == 'para':
                parts.append(para_html(b['text'].strip()))
            else:
                html, ln = img_html(os.path.join(work, 'figs', b['file']))
                parts.append(html)
                nimg += 1
                total += ln
        html = '\n'.join(parts)
        fn = os.path.join(outdir, name + '.html')
        open(fn, 'w', encoding='utf-8').write(html)
        manifest[name] = {'file': fn, 'bytes': len(html.encode('utf-8')), 'imgs': nimg}
        print(f"{name}: {len(html.encode('utf-8')) // 1024}KB, imgs={nimg}")
    json.dump(manifest, open(os.path.join(outdir, 'manifest.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
