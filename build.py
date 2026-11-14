#!/usr/bin/env python3
"""把 index.html + vendor/three.min.js + game.js 合并成一个可单独打开的 standalone.html。"""
import io, os
here = os.path.dirname(os.path.abspath(__file__))
rd = lambda p: io.open(os.path.join(here, p), encoding='utf-8').read()
html = rd('index.html')
html = html.replace('<script src="vendor/three.min.js"></script>', '<script>\n' + rd('vendor/three.min.js') + '\n</script>')
html = html.replace('<script src="game.js"></script>', '<script>\n' + rd('game.js') + '\n</script>')
io.open(os.path.join(here, 'standalone.html'), 'w', encoding='utf-8').write(html)
print('standalone.html', len(html) // 1024, 'KB')
