import sys, re
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import RecordingPen

font = TTFont(sys.argv[1]); gs = font.getGlyphSet(); cmap = font.getBestCmap()
upm = font['head'].unitsPerEm

def layout(lines, lh):
    """lines -> RecordingPen in font units (y up), each line centered on x=0"""
    rec = RecordingPen()
    for i, line in enumerate(lines):
        names = [cmap[ord(c)] for c in line]
        w = sum(gs[n].width for n in names); x = -w/2; y = -i*lh*upm
        for n in names:
            gs[n].draw(TransformPen(rec, (1,0,0,1,x,y))); x += gs[n].width
    return rec

def place(lines, cx, cy, size, lh=1.0):
    rec = layout(lines, lh)
    b = BoundsPen(None); rec.replay(b); x0,y0,x1,y1 = b.bounds
    s = size/upm
    # flip y, scale, center bbox on (cx,cy)
    tx = cx - s*(x0+x1)/2; ty = cy + s*(y0+y1)/2
    sp = SVGPathPen(None); rec.replay(TransformPen(sp, (s,0,0,-s,tx,ty)))
    return sp.getCommands()

def r(d): # round numbers to keep files small
    import re; return re.sub(r'-?\d+\.\d+', lambda m: f"{float(m.group()):.1f}".rstrip('0').rstrip('.'), d)

SOIL='#6B4A2F'; CREAM='#FBF6EA'; SKY='#86C5EA'

def app_icon(rounded, L):
    S=512; c=S/2; q=L/4; k=L/512
    rx = f' rx="{S*0.18:.0f}"' if rounded else ''
    p = [
      (place('土', c-q, c-q, 185*k), SOIL),
      (place(['つち','びより'], c+q, c-q, 69*k, 1.12), '#FFFFFF'),
      (place('日', c-q, c+q, 172*k), CREAM),
      (place('和', c+q, c+q, 185*k), CREAM),
    ]
    global LAST; LAST=p
    paths=''.join(f'<path fill="{col}" d="{r(d)}"/>' for d,col in p)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}"><title>土日和</title><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8CCBF0"/><stop offset=".46" stop-color="#BFE0F2"/><stop offset=".54" stop-color="#8A6440"/><stop offset="1" stop-color="#5A3D26"/></linearGradient></defs><rect width="{S}" height="{S}"{rx} fill="url(#g)"/>{paths}</svg>'''

def maxdist(p):
    m=0
    for d,_ in p:
        n=[float(x) for x in re.findall(r'-?\d+(?:\.\d+)?', d)]
        for x,y in zip(n[0::2],n[1::2]): m=max(m,((x-256)**2+(y-256)**2)**.5)
    return m

def favicon():
    S=64
    d = place('土', S/2, S/2, S*0.78)
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}"><rect width="{S}" height="{S}" rx="{S*0.19:.0f}" fill="{SKY}"/><path fill="{SOIL}" d="{r(d)}"/></svg>'

L=float(sys.argv[2])
open('icon.svg','w').write(app_icon(False,L)); print('max radius', round(maxdist(LAST),1), 'limit', 0.4*512)
open('icon-rounded.svg','w').write(app_icon(True,L))
open('favicon.svg','w').write(favicon())
