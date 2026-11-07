import sys, json, os
import pymupdf

if len(sys.argv) < 3:
    print('用法: python pdf_text.py <讲义.pdf> <work目录>')
    print('输出 <work>/lines.jsonl（每行 页/x0/y0/x1/y1/字号/文本）并直接打印，用来排查看不清的排版。')
    sys.exit(2)

pdf = sys.argv[1]
outdir = sys.argv[2]
os.makedirs(outdir, exist_ok=True)
doc = pymupdf.open(pdf)
print('pages', doc.page_count, 'size', doc[0].rect)

lines = []
for pno in range(doc.page_count):
    page = doc[pno]
    print(f'--- page {pno+1} blocks/images ---')
    d = page.get_text('dict')
    for b in d['blocks']:
        if b['type'] == 1:
            print(f'  [IMAGE] bbox=({b["bbox"][0]:.0f},{b["bbox"][1]:.0f},{b["bbox"][2]:.0f},{b["bbox"][3]:.0f}) {b["width"]}x{b["height"]}')
            continue
        for ln in b['lines']:
            txt = ''.join(s['text'] for s in ln['spans']).strip()
            if not txt:
                continue
            x0, y0, x1, y1 = ln['bbox']
            sz = ln['spans'][0]['size']
            lines.append((pno + 1, round(x0), round(y0), round(x1), round(y1), round(sz, 1), txt))
            print(f'  p{pno+1} y={y0:6.0f} x={x0:5.0f} sz={sz:4.1f} | {txt}')

with open(os.path.join(outdir, 'lines.jsonl'), 'w', encoding='utf-8') as f:
    for l in lines:
        f.write(json.dumps(l, ensure_ascii=False) + '\n')
print('total lines', len(lines))
