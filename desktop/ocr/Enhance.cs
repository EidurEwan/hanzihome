// Enhance.cs — a second look for text the OCR engine misses: text in colours close
// in brightness to their background (red on green, yellow on white), lines whose
// words have different colours, highlighted phrases, gradients.
//
// Windows' OCR looks at brightness only, so it reads text well when the text is
// much darker or lighter than what is around it, and poorly otherwise. ContrastMap
// redraws a picture as dark-on-white by how far each pixel's colour is from the
// background around it, whatever the two colours are. Reading that as well and
// keeping, line by line, the reading that looks more like Chinese (Choose) gets
// back what the first reading lost without giving up what it had.
//
// Only System.Drawing here, so it builds and can be tried without Windows' OCR.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

namespace HanziOcr
{
    static class Enhance
    {
        const int Tile = 24;          // the background is estimated per tile...
        const int Reach = 2;          // ...from the tiles up to this far around it (a 120 px square)
        const int Quiet = 14;         // colour distances under this are background (grain, gradients)
        const int Full = 120;         // and from this on, as dark as text gets
        const int Steady = 24;        // a pixel is in a flat patch when nothing 2, 4 and 6 px away differs more
        const int Near = 20;          // how far a flat patch's colour reaches

        // ---------------------------------------------------------------- the map

        // The picture as grey, dark where a pixel's colour is far from the
        // background around it. That background is the colour of the nearest flat
        // patch, so text in a highlight box is measured against the box. Where no
        // flat patch is near (a photo, a noisy video frame) it is the colour most of
        // the tiles around share (colours rounded to 4 bits a channel), so a word of
        // text, even a big bold one, never outweighs the page it sits on.
        public static Bitmap ContrastMap(Bitmap bmp)
        {
            int w = bmp.Width, h = bmp.Height;
            int[] px = Pixels(bmp);
            int tw = (w + Tile - 1) / Tile, th = (h + Tile - 1) / Tile;

            // each tile's three commonest colours: bin, count and colour sums
            var tops = new int[tw * th][];
            var counts = new int[4096];
            var sums = new long[4096 * 3];
            var touched = new List<int>();
            for (int ty = 0; ty < th; ty++)
                for (int tx = 0; tx < tw; tx++)
                {
                    touched.Clear();
                    int y1 = Math.Min(h, (ty + 1) * Tile), x1 = Math.Min(w, (tx + 1) * Tile);
                    for (int y = ty * Tile; y < y1; y++)
                        for (int x = tx * Tile, i = y * w + x; x < x1; x++, i++)
                        {
                            int p = px[i], q = Bin(p);
                            if (counts[q]++ == 0) touched.Add(q);
                            sums[q * 3] += (p >> 16) & 255; sums[q * 3 + 1] += (p >> 8) & 255; sums[q * 3 + 2] += p & 255;
                        }
                    // [bin, count, r, g, b] for the top three
                    var top = new int[15];
                    for (int k = 0; k < 3; k++) top[k * 5] = -1;
                    foreach (int q in touched)
                    {
                        int c = counts[q];
                        for (int k = 0; k < 3; k++)
                            if (top[k * 5] < 0 || c > top[k * 5 + 1])
                            {
                                for (int m = 2; m > k; m--) Array.Copy(top, (m - 1) * 5, top, m * 5, 5);
                                top[k * 5] = q; top[k * 5 + 1] = c;
                                top[k * 5 + 2] = (int)(sums[q * 3] / c); top[k * 5 + 3] = (int)(sums[q * 3 + 1] / c); top[k * 5 + 4] = (int)(sums[q * 3 + 2] / c);
                                break;
                            }
                    }
                    foreach (int q in touched) { counts[q] = 0; sums[q * 3] = sums[q * 3 + 1] = sums[q * 3 + 2] = 0; }
                    tops[ty * tw + tx] = top;
                }

            // each tile's background: the commonest colour of the tiles around it, as
            // that tile itself has it (so a gradient keeps its local shade)
            var bg = new int[tw * th];
            var votes = new Dictionary<int, int>();
            for (int ty = 0; ty < th; ty++)
                for (int tx = 0; tx < tw; tx++)
                {
                    votes.Clear();
                    for (int y = Math.Max(0, ty - Reach); y <= Math.Min(th - 1, ty + Reach); y++)
                        for (int x = Math.Max(0, tx - Reach); x <= Math.Min(tw - 1, tx + Reach); x++)
                        {
                            var t = tops[y * tw + x];
                            for (int k = 0; k < 3; k++)
                            {
                                if (t[k * 5] < 0) continue;
                                int v;
                                votes.TryGetValue(t[k * 5], out v);
                                votes[t[k * 5]] = v + t[k * 5 + 1];
                            }
                        }
                    int best = -1, bestVotes = -1;
                    foreach (var kv in votes) if (kv.Value > bestVotes) { best = kv.Key; bestVotes = kv.Value; }
                    var own = tops[ty * tw + tx];
                    int colour = -1;
                    for (int k = 0; k < 3; k++)
                        if (own[k * 5] == best) colour = (own[k * 5 + 2] << 16) | (own[k * 5 + 3] << 8) | own[k * 5 + 4];
                    if (colour < 0) colour = Centre(best);
                    bg[ty * tw + tx] = colour;
                }

            // Nearer backgrounds: the colour of the nearest flat patch (page, panel,
            // highlight box: anywhere the colour holds steady 6 pixels around, which
            // inside a stroke of text it doesn't; for the page's own colour 2 pixels
            // will do, so a thin strip of page between a line and a box is page).
            // Spread out from those patches up to Near pixels; past that the tiles'
            // background stands.
            var near = new int[w * h];
            var steps = new byte[w * h];
            var queue = new int[w * h];
            int head = 0, tail = 0;
            for (int i = 0; i < near.Length; i++) near[i] = -1;
            for (int y = 6; y < h - 6; y++)
            {
                int ty = Math.Min(th - 1, y / Tile);
                for (int x = 6; x < w - 6; x++)
                {
                    int i = y * w + x;
                    bool page = Close(px[i], bg[ty * tw + Math.Min(tw - 1, x / Tile)]);
                    if (page ? Flat2(px, i, w) : Flat(px, i, w)) { near[i] = px[i] & 0xffffff; queue[tail++] = i; }
                }
            }
            while (head < tail)
            {
                int i = queue[head++];
                if (steps[i] >= Near) continue;
                int x = i % w;
                if (x > 0) Spread(near, steps, queue, ref tail, i, i - 1);
                if (x < w - 1) Spread(near, steps, queue, ref tail, i, i + 1);
                if (i >= w) Spread(near, steps, queue, ref tail, i, i - w);
                if (i + w < near.Length) Spread(near, steps, queue, ref tail, i, i + w);
            }

            // the map: a pixel's distance from its background
            var outPx = new int[w * h];
            for (int y = 0; y < h; y++)
            {
                double fy = (y + 0.5) / Tile - 0.5;
                int ty0 = Clamp((int)Math.Floor(fy), 0, th - 1), ty1 = Math.Min(th - 1, ty0 + 1);
                double ay = Math.Max(0, Math.Min(1, fy - ty0));
                for (int x = 0; x < w; x++)
                {
                    int i = y * w + x, p = px[i];
                    // against the tiles' background, between the four nearest tile centres
                    // so tile edges leave no seams...
                    double fx = (x + 0.5) / Tile - 0.5;
                    int tx0 = Clamp((int)Math.Floor(fx), 0, tw - 1), tx1 = Math.Min(tw - 1, tx0 + 1);
                    double ax = Math.Max(0, Math.Min(1, fx - tx0));
                    double d = Dist(p, bg[ty0 * tw + tx0]) * (1 - ax) * (1 - ay) + Dist(p, bg[ty0 * tw + tx1]) * ax * (1 - ay)
                             + Dist(p, bg[ty1 * tw + tx0]) * (1 - ax) * ay + Dist(p, bg[ty1 * tw + tx1]) * ax * ay;
                    // ...or, nearer, the nearest flat patch: white text in a dark box is
                    // measured against the box
                    if (near[i] >= 0) d = Dist(p, near[i]);
                    int v = 255 - Clamp((int)((d - Quiet) * 255 / (Full - Quiet)), 0, 255);
                    outPx[i] = unchecked((int)0xff000000) | (v << 16) | (v << 8) | v;
                }
            }
            var map = new Bitmap(w, h, PixelFormat.Format32bppArgb);
            var data = map.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
            Marshal.Copy(outPx, 0, data.Scan0, outPx.Length);
            map.UnlockBits(data);
            return map;
        }

        // Is a second look worth its time? Only when some of the picture differs from
        // its surroundings by colour more than by brightness, away from any dark or
        // light stroke: colourful text the engine may not see, not the coloured edges
        // ClearType gives black text. Share of such pixels, every other row and column.
        public static double ColourShare(Bitmap bmp)
        {
            int w = bmp.Width, h = bmp.Height;
            int[] px = Pixels(bmp);
            int n = 0, hit = 0;
            for (int y = 2; y < h - 2; y += 2)
                for (int x = 2; x < w - 2; x += 2)
                {
                    int p = px[y * w + x];
                    n++;
                    // against the pixels two to the left and two above: a change of
                    // colour with little change of brightness
                    int i = y * w + x;
                    if ((ColourEdge(p, px[i - 2]) || ColourEdge(p, px[i - 2 * w])) && !NearCore(px, i, w)) hit++;
                }
            return n == 0 ? 0 : (double)hit / n;
        }

        static bool Flat(int[] px, int i, int w)
        {
            int p = px[i];
            return Close(p, px[i - 4]) && Close(p, px[i + 4]) && Close(p, px[i - 4 * w]) && Close(p, px[i + 4 * w])
                && Close(p, px[i - 4 * w - 4]) && Close(p, px[i - 4 * w + 4]) && Close(p, px[i + 4 * w - 4]) && Close(p, px[i + 4 * w + 4])
                && Close(p, px[i - 2]) && Close(p, px[i + 2]) && Close(p, px[i - 2 * w]) && Close(p, px[i + 2 * w])
                && Close(p, px[i - 6]) && Close(p, px[i + 6]) && Close(p, px[i - 6 * w]) && Close(p, px[i + 6 * w]);
        }

        static bool Flat2(int[] px, int i, int w)
        {
            int p = px[i];
            return Close(p, px[i - 2]) && Close(p, px[i + 2]) && Close(p, px[i - 2 * w]) && Close(p, px[i + 2 * w])
                && Close(p, px[i - 2 * w - 2]) && Close(p, px[i - 2 * w + 2]) && Close(p, px[i + 2 * w - 2]) && Close(p, px[i + 2 * w + 2]);
        }

        static bool Close(int p, int q)
        {
            int dr = ((p >> 16) & 255) - ((q >> 16) & 255), dg = ((p >> 8) & 255) - ((q >> 8) & 255), db = (p & 255) - (q & 255);
            return dr * dr + dg * dg + db * db < Steady * Steady;
        }

        static void Spread(int[] near, byte[] steps, int[] queue, ref int tail, int from, int to)
        {
            if (near[to] >= 0) return;
            near[to] = near[from];
            steps[to] = (byte)(steps[from] + 1);
            queue[tail++] = to;
        }

        // Next to a stroke much brighter or darker than itself: the coloured fringe
        // ClearType gives black or white text, which the engine reads well anyway.
        static bool NearCore(int[] px, int i, int w)
        {
            double l = Luma(px[i]);
            foreach (int o in new[] { -1, 1, -2, 2, -w, w, -2 * w, 2 * w })
                if (Math.Abs(Luma(px[i + o]) - l) > 90) return true;
            return false;
        }

        static bool ColourEdge(int p, int o)
        {
            double dc = Dist(p, o);
            return dc > 60 && Math.Abs(Luma(p) - Luma(o)) < dc * 0.35;
        }

        // ------------------------------------------------------------- choosing

        // How much a line looks like Chinese: common characters count for a lot, rare
        // ones (what a misread stroke tends to become) and stray Latin or symbols
        // against it. Ranks come from common.txt (most frequent first), when present.
        static Dictionary<string, int> rank;

        public static void LoadRanks(string path)
        {
            rank = new Dictionary<string, int>();
            if (!File.Exists(path)) return;
            int i = 0;
            foreach (var cp in Program.CodePoints(File.ReadAllText(path).Trim())) if (!rank.ContainsKey(cp)) rank[cp] = i++;
        }

        public static double Score(Line line)
        {
            double s = 0;
            foreach (var c in line.Chars)
                foreach (var cp in Program.CodePoints(c.T))
                {
                    int u = char.ConvertToUtf32(cp, 0);
                    bool han = (u >= 0x3400 && u <= 0x9FFF) || u >= 0x20000;
                    if (han)
                    {
                        int r;
                        if (rank == null || rank.Count == 0) s += 0.6;
                        else if (!rank.TryGetValue(cp, out r)) s -= 0.6;
                        else s += r < 2500 ? 1 : r < 4500 ? 0.6 : 0.1;
                    }
                    else if (Program.IsCjk(cp)) s += 0.2;                 // Chinese punctuation
                    else if (char.IsLetterOrDigit(cp, 0)) s -= 0.15;
                    else if (!char.IsWhiteSpace(cp, 0)) s -= 0.4;
                }
            return s;
        }

        // Put two readings of one picture together. Lines of both that sit on the same
        // row and overlap make a group; each group keeps the reading that scores
        // higher, the first one unless the second is clearly better. A line only the
        // second reading found is kept when it looks like real text.
        public static List<Line> Choose(List<Line> first, List<Line> second)
        {
            var all = new List<Line>(first);
            all.AddRange(second);
            int n = all.Count;
            var parent = new int[n];
            for (int i = 0; i < n; i++) parent[i] = i;
            for (int i = 0; i < n; i++)
                for (int j = i + 1; j < n; j++)
                    if (Overlap(all[i], all[j])) parent[Find(parent, i)] = Find(parent, j);

            var groups = new Dictionary<int, List<int>>();
            for (int i = 0; i < n; i++)
            {
                int r = Find(parent, i);
                List<int> g;
                if (!groups.TryGetValue(r, out g)) groups[r] = g = new List<int>();
                g.Add(i);
            }
            var lines = new List<Line>();
            foreach (var g in groups.Values)
            {
                double a = 0, b = 0;
                int na = 0, nb = 0, hb = 0;
                foreach (int i in g)
                    if (i < first.Count) { a += Score(all[i]); na++; }
                    else { b += Score(all[i]); nb++; hb += Program.CodePoints(all[i].Text).Count; }
                bool second_ = nb > 0 && (na == 0 ? b >= 2.5 && b >= 0.5 * hb : b > a + 1);
                foreach (int i in g) if ((i >= first.Count) == second_) lines.Add(all[i]);
            }
            lines.Sort(delegate(Line p, Line q) { return p.Y != q.Y ? p.Y.CompareTo(q.Y) : p.X.CompareTo(q.X); });
            return lines;
        }

        static bool Overlap(Line p, Line q)
        {
            int oy = Math.Min(p.Bottom, q.Bottom) - Math.Max(p.Y, q.Y);
            int ox = Math.Min(p.X + p.W, q.X + q.W) - Math.Max(p.X, q.X);
            return ox > 0 && oy > 0.5 * Math.Min(p.H, q.H);
        }

        static int Find(int[] parent, int i)
        {
            while (parent[i] != i) { parent[i] = parent[parent[i]]; i = parent[i]; }
            return i;
        }

        // ------------------------------------------------------------- helpers

        static int[] Pixels(Bitmap bmp)
        {
            var data = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            var px = new int[bmp.Width * bmp.Height];
            Marshal.Copy(data.Scan0, px, 0, px.Length);
            bmp.UnlockBits(data);
            return px;
        }

        static int Bin(int p) { return ((p >> 12) & 0xf00) | ((p >> 8) & 0xf0) | ((p >> 4) & 0xf); }
        static int Centre(int q) { return ((((q >> 8) & 15) * 16 + 8) << 16) | ((((q >> 4) & 15) * 16 + 8) << 8) | ((q & 15) * 16 + 8); }

        static double Dist(int p, int q)
        {
            int dr = ((p >> 16) & 255) - ((q >> 16) & 255), dg = ((p >> 8) & 255) - ((q >> 8) & 255), db = (p & 255) - (q & 255);
            return Math.Sqrt(dr * dr + dg * dg + db * db);
        }

        static double Luma(int p) { return 0.299 * ((p >> 16) & 255) + 0.587 * ((p >> 8) & 255) + 0.114 * (p & 255); }
        static int Clamp(int v, int lo, int hi) { return v < lo ? lo : v > hi ? hi : v; }
    }
}
