import re, sys
src = open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), '..', 'public', 'legacy', '40-c.js'), encoding='utf-8').read()
py = src.split("const PY_SETUP = `", 1)[1].split("\n`;", 1)[0]
def grab(name):
    m = re.search(r'^(?:def|class) %s\b.*?(?=^(?:def|class) |\Z)' % re.escape(name), py, re.S | re.M)
    return m.group(0)
code = '\n'.join(grab(n) for n in ['_cluster', '_inter', '_GridTable', '_rule_segments', '_rule_grids'])
ns = {}
exec(code, ns)

class P:  # điểm
    def __init__(s, x, y): s.x, s.y = x, y
class R:  # hình chữ nhật
    def __init__(s, x0, y0, x1, y1): s.x0, s.y0, s.x1, s.y1 = x0, y0, x1, y1; s.width = x1 - x0; s.height = y1 - y0
class Pg:
    def __init__(s, drs): s.drs = drs
    def get_drawings(s): return s.drs
def line(x0, y0, x1, y1): return ('l', P(x0, y0), P(x1, y1))

# lưới 3 cột x 4 hàng bằng các đường 'l' (stroke)
xs = [50, 150, 250, 350]; ys = [100, 130, 160, 190, 220]
items = [line(x, ys[0], x, ys[-1]) for x in xs] + [line(xs[0], y, xs[-1], y) for y in ys]
g = ns['_rule_grids'](Pg([{'type': 's', 'items': items}]))
assert len(g) == 1, g
t = g[0]; assert t.col_count == 3 and t.row_count == 4 and len(t.cells) == 12, (t.col_count, t.row_count)
assert t.bbox == (50, 100, 350, 220), t.bbox
print('ok  lưới 3x4 từ đường kẻ:', t.bbox, len(t.cells), 'ô')

# bảng vẽ bằng hình chữ nhật rất mỏng (đường kẻ dạng fill)
items = [('re', R(x - 0.4, ys[0], x + 0.4, ys[-1])) for x in xs] + [('re', R(xs[0], y - 0.4, xs[-1], y + 0.4)) for y in ys]
g = ns['_rule_grids'](Pg([{'type': 'f', 'items': items}]))
assert len(g) == 1 and g[0].col_count == 3 and g[0].row_count == 4
print('ok  đường kẻ dạng hình chữ nhật mỏng')

# chưa đủ đường -> không dựng bảng
assert ns['_rule_grids'](Pg([{'type': 's', 'items': [line(0, 10, 200, 10), line(0, 40, 200, 40)]}])) == []
assert ns['_rule_grids'](Pg([])) == []
print('ok  thiếu đường dọc / trang không có hình vẽ -> không có bảng')

# gạch chân đơn lẻ + đường ngang dài không tạo bảng giả
assert ns['_rule_grids'](Pg([{'type': 's', 'items': [line(50, 100, 350, 100), line(50, 300, 350, 300), line(50, 100, 50, 102)]}])) == []
print('ok  hai đường ngang + vạch ngắn không thành bảng')

# get_drawings lỗi -> trả rỗng, không ném
class Bad:
    def get_drawings(s): raise RuntimeError('x')
assert ns['_rule_grids'](Bad()) == []
print('ok  get_drawings lỗi -> bỏ qua an toàn')

# hai bảng tách rời trên cùng trang
ys2 = [400, 430, 460]
items = [line(x, ys[0], x, ys[-1]) for x in xs] + [line(xs[0], y, xs[-1], y) for y in ys] + [line(x, ys2[0], x, ys2[-1]) for x in xs] + [line(xs[0], y, xs[-1], y) for y in ys2]
g = ns['_rule_grids'](Pg([{'type': 's', 'items': items}]))
assert len(g) == 2 and sorted(t.row_count for t in g) == [2, 4], [(t.row_count, t.col_count) for t in g]
print('ok  hai bảng tách rời -> 2 lưới')
print('Python grid tests passed.')
