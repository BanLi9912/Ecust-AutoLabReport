"""讲义 PDF -> 结构化 blocks（行级分类：正文段落 / 公式块(渲染成图) / 插图）。
用法: python pdf_blocks.py <pdf> <outdir> [first_page] [last_page]
输出: <outdir>/blocks.json, <outdir>/figs/*.png, <outdir>/preview.txt
"""
import json
import os
import re
import sys

import pymupdf

CJK = re.compile(r'[\u4e00-\u9fff]')
HEADING = re.compile(r'^\s*[一二三四五六七八九十]+[、.]\s*\S')


def line_text(ln):
    return ''.join(s['text'] for s in ln['spans'])


def is_prose_line(ln):
    t = line_text(ln).strip()
    if not t:
        return False
    cjk = len(CJK.findall(t))
    return cjk >= 5 or (cjk >= 2 and (cjk / len(t) > 0.45 or t[-1] in '。；：？，'))


def main():
    pdf, outdir = sys.argv[1], sys.argv[2]
    p0 = int(sys.argv[3]) - 1 if len(sys.argv) > 3 else 0
    p1 = int(sys.argv[4]) if len(sys.argv) > 4 else None
    figdir = os.path.join(outdir, 'figs')
    os.makedirs(figdir, exist_ok=True)
    for f in os.listdir(figdir):
        os.remove(os.path.join(figdir, f))

    doc = pymupdf.open(pdf)
    pages = range(p0, min(p1 or doc.page_count, doc.page_count))

    items = []
    for pno in pages:
        page = doc[pno]
        for b in page.get_text('dict')['blocks']:
            if b['type'] == 1:
                items.append({'kind': 'fig', 'page': pno, 'bbox': list(b['bbox'])})
                continue
            for ln in b['lines']:
                if not line_text(ln).strip():
                    continue
                bb = list(ln['bbox'])
                items.append({
                    'kind': 'prose' if is_prose_line(ln) else 'math',
                    'page': pno, 'bbox': bb,
                    'text': line_text(ln),
                    'size': round(ln['spans'][0]['size'], 1),
                    'x0': bb[0],
                })

    items.sort(key=lambda it: (it['page'], it['bbox'][1], it['bbox'][0]))

    # 公式聚簇：按 y 分带（同一行上的上下标/分段高度差 ±14pt），整条公式裁成一张图
    math_items = [it for it in items if it['kind'] == 'math']
    bands = []
    for it in math_items:
        yc = (it['bbox'][1] + it['bbox'][3]) / 2
        for bd in bands:
            if bd['page'] == it['page'] and not (it['bbox'][3] < bd['y0'] - 2 or it['bbox'][1] > bd['y1'] + 2):
                bd['items'].append(it)
                bd['y0'] = min(bd['y0'], it['bbox'][1])
                bd['y1'] = max(bd['y1'], it['bbox'][3])
                bd['yc'] = (bd['y0'] + bd['y1']) / 2
                break
        else:
            bands.append({'kind': 'math', 'page': it['page'], 'items': [it],
                          'y0': it['bbox'][1], 'y1': it['bbox'][3], 'yc': yc,
                          'bbox': [85, it['bbox'][1], 500, it['bbox'][3]]})

    blocks = [b for b in items if b['kind'] in ('prose', 'fig')]
    for bd in bands:
        x0 = min(it['bbox'][0] for it in bd['items'])
        x1 = max(it['bbox'][2] for it in bd['items'])
        w = max(x1 - x0, 110)
        bd['bbox'] = [x0 - 3, bd['y0'] - 1, x0 + w + 3, bd['y1'] + 1]
        bd['src'] = [it['text'] for it in bd['items']]
        blocks.append(bd)
    for b in blocks:
        if b['kind'] == 'fig':
            b['src'] = []
    # 掐掉纯空白的碎带（宽高都小的孤立符号）
    blocks = [b for b in blocks if b['kind'] != 'math' or (b['bbox'][2] - b['bbox'][0]) > 45 and len(''.join(b['src']).strip()) > 2]
    # 去掉 y 完全重合的重复（数学符号同位重叠）
    blocks.sort(key=lambda b: (b['page'], b['bbox'][1], b['bbox'][0]))

    # 生成图件 + 段落合并
    out = []
    cur = None
    fig_n = 0
    for b in blocks:
        if b['kind'] in ('math', 'fig'):
            fig_n += 1
            name = f"f{b['page'] + 1:02d}_{int(b['bbox'][1]):03d}_{fig_n:02d}.png"
            clip = pymupdf.Rect(b['bbox'][0] - 2, b['bbox'][1] - 3, b['bbox'][2] + 2, b['bbox'][3] + 3) & doc[b['page']].rect
            pix = doc[b['page']].get_pixmap(clip=clip, dpi=300, alpha=False)
            pix.save(os.path.join(figdir, name))
            out.append({'kind': b['kind'], 'page': b['page'] + 1, 'file': name,
                        'px': [pix.width, pix.height], 'src': ''.join(b['src'])[:60]})
            cur = None
            continue
        t = b['text'].strip()
        if HEADING.match(t):
            out.append({'kind': 'heading', 'text': t, 'page': b['page'] + 1})
            cur = None
            continue
        if (cur is not None and b['page'] + 1 == cur['page'] and b['x0'] <= 100 and cur['x1'] > 400
                and abs(b['size'] - cur['size']) < 0.6 and b['bbox'][3] - cur['y1'] < 1.9 * b['size']):
            cur['text'] += t
            cur['y1'] = b['bbox'][3]
            cur['x1'] = b['bbox'][2]
        else:
            cur = {'kind': 'para', 'text': t, 'page': b['page'] + 1, 'size': b['size'],
                   'x0': round(b['x0']), 'y0': b['bbox'][1], 'y1': b['bbox'][3], 'x1': b['bbox'][2]}
            out.append(cur)

    json.dump(out, open(os.path.join(outdir, 'blocks.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    with open(os.path.join(outdir, 'preview.txt'), 'w', encoding='utf-8') as f:
        for b in out:
            if b['kind'] == 'para':
                f.write(f"[p{b['page']} 段] {b['text']}\n")
            elif b['kind'] == 'heading':
                f.write(f"[p{b['page']} 标题] {b['text']}\n")
            else:
                f.write(f"[p{b['page']} 图:{b['file']}] {b['px'][0]}x{b['px'][1]} src={b['src']}\n")
    print('blocks', len(out), 'figs', fig_n)


if __name__ == '__main__':
    main()




