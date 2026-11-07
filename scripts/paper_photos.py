"""把纸质报告的照片转成一个网站分块 HTML（图片 base64 内嵌）。

用法: python paper_photos.py <out.html> <img1> [img2 ...] [--width 900] [--quality 82]

约定：原始数据记录等块直接用照片原图，不做手写识别（OCR 对手写体无效）。
照片按命令行顺序纵向排列，每张一个 <p><img></p>。
"""
import base64
import io
import os
import sys

from PIL import Image

MAXW = 900
QUALITY = 82


def main():
    args = [a for a in sys.argv[1:]]
    maxw, quality = MAXW, QUALITY
    if '--width' in args:
        i = args.index('--width')
        maxw = int(args[i + 1])
        del args[i:i + 2]
    if '--quality' in args:
        i = args.index('--quality')
        quality = int(args[i + 1])
        del args[i:i + 2]
    if len(args) < 2:
        print(__doc__)
        sys.exit(2)
    out, imgs = args[0], args[1:]

    parts, total = [], 0
    for path in imgs:
        if not os.path.isfile(path):
            raise SystemExit('not found: ' + path)
        im = Image.open(path).convert('RGB')
        if im.width > maxw:
            im = im.resize((maxw, round(im.height * maxw / im.width)), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, 'JPEG', quality=quality, optimize=True)
        b64 = base64.b64encode(buf.getvalue()).decode()
        total += len(b64)
        parts.append('<p><img src="data:image/jpeg;base64,%s" style="width:%dpx" /></p>'
                     % (b64, im.width))
        print(f'{os.path.basename(path)}: {im.width}x{im.height}  base64 {len(b64) // 1024}KB')

    html = '\n'.join(parts)
    with open(out, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'-> {out}  {len(html.encode("utf-8")) // 1024}KB  imgs={len(imgs)}')


if __name__ == '__main__':
    main()
