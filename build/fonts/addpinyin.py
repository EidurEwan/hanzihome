"""Add the pinyin letters Poppins lacks (ǎ ǐ ǒ ǔ and ǖ ǘ ǚ ǜ, with capitals), built
from its own letters and accents the way it builds ě and ü.

    python3 build/fonts/addpinyin.py Poppins-Regular.ttf out.ttf      (fontTools)

Then subset to woff2 for site/fonts/: README, "Typography and colour"."""
import sys
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphComponent

src, out = sys.argv[1], sys.argv[2]
f = TTFont(src)
glyf, hmtx, cmap = f['glyf'], f['hmtx'], f.getBestCmap()
name = lambda ch: cmap[ord(ch)]

def comps(g):
    return {c.glyphName: (c.x, c.y) for c in glyf[g].components} if glyf[g].isComposite() else {}

def bbox(g):
    gl = glyf[g]; gl.recalcBounds(glyf)
    return gl.xMin, gl.yMin, gl.xMax, gl.yMax

def centre_x(base_acute, accent):
    """x for accent so it is centred where the font puts the acute on this letter"""
    c = comps(name(base_acute))
    acc = [k for k in c if k != name(base_acute[0]) and k not in ('dotlessi', 'idotless')]
    a = [k for k in c if 'acute' in k] or acc
    ax, _ = c[a[0]]
    x0, _, x1, _ = bbox(a[0])
    mid = ax + (x0 + x1) / 2
    return round(mid - (bbox(accent)[0] + bbox(accent)[2]) / 2)

def add(code, base, parts):
    g = Glyph(); g.numberOfContours = -1; g.components = []
    for gname, x, y in [(base, 0, 0)] + parts:
        c = GlyphComponent(); c.glyphName = gname; c.x, c.y = x, y; c.flags = 0x4 if gname == base else 0
        g.components.append(c)
    new = 'uni%04X' % code
    glyf[new] = g
    hmtx[new] = hmtx[base]
    for t in f['cmap'].tables:
        if t.isUnicode(): t.cmap[code] = new

caron = name('ˇ')      # spacing caron, as in ě
for low, acute_of, code in [('a', 'á', 0x01CE), ('o', 'ó', 0x01D2), ('u', 'ú', 0x01D4), ('A', 'Á', 0x01CD), ('O', 'Ó', 0x01D1), ('U', 'Ú', 0x01D3)]:
    acc = caron if low.islower() else ([k for k in comps(name('Ě')) if k != 'E'][0])
    add(code, name(low), [(acc, centre_x(acute_of, acc), comps(name('Ě'))[acc][1] if low.isupper() else 0)])
# ǐ: dotless i with the caron, centred as í has its acute
def from_acute(code, acute_of, accent, y=0):
    # the acute letter's own parts and width, its acute swapped for this accent
    g = name(acute_of)
    new = 'uni%04X' % code
    parts = [(k, x, yy) for k, (x, yy) in comps(g).items()]
    base = [p for p in parts if 'acute' not in p[0]]
    gl = Glyph(); gl.numberOfContours = -1; gl.components = []
    for k, x, yy in base + [(accent, centre_x(acute_of, accent), y)]:
        c = GlyphComponent(); c.glyphName = k; c.x, c.y = x, yy; c.flags = 0
        gl.components.append(c)
    glyf[new] = gl
    hmtx[new] = hmtx[g]
    for t in f['cmap'].tables:
        if t.isUnicode(): t.cmap[code] = new
from_acute(0x01D0, 'í', caron)
cap_caron = [k for k in comps(name('Ě')) if k != 'E'][0]
add(0x01CF, name('I'), [(cap_caron, centre_x('Í', cap_caron), comps(name('Ě'))[cap_caron][1])])

# ü with a tone: the tone mark above the dieresis
for ubase, marks in [('ü', [(0x01D6, 'ˉ'), (0x01D8, '´'), (0x01DA, 'ˇ'), (0x01DC, '`')]),
                     ('Ü', [(0x01D5, 'ˉ'), (0x01D7, '´'), (0x01D9, 'ˇ'), (0x01DB, '`')])]:
    uc = comps(name(ubase)); die = [k for k in uc if 'dieresis' in k][0]
    dx, dy = uc[die]; dtop = bbox(die)[3] + dy
    for code, m in marks:
        acc = name(m)
        x = round(dx + (bbox(die)[0] + bbox(die)[2]) / 2 - (bbox(acc)[0] + bbox(acc)[2]) / 2)
        y = round(dtop + 40 - bbox(acc)[1])
        base = 'u' if ubase == 'ü' else 'U'
        add(code, base, [(die, dx, dy), (acc, x, y)])
f.save(out)
print('ok', src)
