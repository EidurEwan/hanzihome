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
        const int Fine = 8;           // the finer background: 8 px tiles, 24 px around
        const double BoxShare = 0.5;  // a box: its colour covers this much of the 24 px around...
        const int BoxApart = 60;      // ...and is this far from the page's...
        const double PageShare = 0.35; // ...where there is a page: one colour over this much of 120 px around

        // ---------------------------------------------------------------- the map

        // Each tile's background: the commonest colour (rounded to 4 bits a channel)
        // of the tiles up to reach around it, as that tile itself has it, so a
        // gradient keeps its local shade; share is how much of the area has it.
        static int[] TileModes(int[] px, int w, int h, int tile, int reach, out double[] share)
        {
            int tw = (w + tile - 1) / tile, th = (h + tile - 1) / tile;
            // each tile's three commonest colours: bin, count and mean colour
            var tops = new int[tw * th][];
            var counts = new int[4096];
            var sums = new long[4096 * 3];
            var touched = new List<int>();
            for (int ty = 0; ty < th; ty++)
                for (int tx = 0; tx < tw; tx++)
                {
                    touched.Clear();
                    int y1 = Math.Min(h, (ty + 1) * tile), x1 = Math.Min(w, (tx + 1) * tile);
                    for (int y = ty * tile; y < y1; y++)
                        for (int x = tx * tile, i = y * w + x; x < x1; x++, i++)
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

            var bg = new int[tw * th];
            share = new double[tw * th];
            var votes = new Dictionary<int, int>();
            for (int ty = 0; ty < th; ty++)
                for (int tx = 0; tx < tw; tx++)
                {
                    votes.Clear();
                    int area = 0;
                    for (int y = Math.Max(0, ty - reach); y <= Math.Min(th - 1, ty + reach); y++)
                        for (int x = Math.Max(0, tx - reach); x <= Math.Min(tw - 1, tx + reach); x++)
                        {
                            area += (Math.Min(h, (y + 1) * tile) - y * tile) * (Math.Min(w, (x + 1) * tile) - x * tile);
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
                    share[ty * tw + tx] = area > 0 ? (double)bestVotes / area : 0;
                }
            return bg;
        }

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
            double[] share;
            var bg = TileModes(px, w, h, Tile, Reach, out share);
            // and a finer one, the commonest colour within 24 px: inside a highlight
            // box that is the box, where the coarse one sees the page around it
            int fw = (w + Fine - 1) / Fine;
            double[] fineShare;
            var fine = TileModes(px, w, h, Fine, 1, out fineShare);

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

            // The open page: page-coloured pixels joined to a steady patch of page through
            // page colour. Page showing at a box's edge is that; white text inside a dark
            // box, closed in by the box, is not, though it has the page's colour.
            var open = new bool[w * h];
            head = 0; tail = 0;
            for (int y = 2; y < h - 2; y++)
                for (int x = 2; x < w - 2; x++)
                {
                    int i = y * w + x;
                    if (Close(px[i], bg[Clamp(y / Tile, 0, th - 1) * tw + Clamp(x / Tile, 0, tw - 1)]) && Flat2(px, i, w)) { open[i] = true; queue[tail++] = i; }
                }
            while (head < tail)
            {
                int i = queue[head++], x = i % w, y = i / w;
                int page = bg[Clamp(y / Tile, 0, th - 1) * tw + Clamp(x / Tile, 0, tw - 1)];
                if (x > 0 && !open[i - 1] && Close(px[i - 1], page)) { open[i - 1] = true; queue[tail++] = i - 1; }
                if (x < w - 1 && !open[i + 1] && Close(px[i + 1], page)) { open[i + 1] = true; queue[tail++] = i + 1; }
                if (i >= w && !open[i - w] && Close(px[i - w], page)) { open[i - w] = true; queue[tail++] = i - w; }
                if (i + w < open.Length && !open[i + w] && Close(px[i + w], page)) { open[i + w] = true; queue[tail++] = i + w; }
            }

            // which fine tiles are boxes (a colour of their own, most of the 24 px around, on a page)
            int fh = (h + Fine - 1) / Fine;
            var isBox = new bool[fw * fh];
            for (int fy = 0; fy < fh; fy++)
                for (int fx = 0; fx < fw; fx++)
                {
                    int f = fy * fw + fx, pg = Clamp(fy * Fine / Tile, 0, th - 1) * tw + Clamp(fx * Fine / Tile, 0, tw - 1);
                    isBox[f] = fineShare[f] >= BoxShare && share[pg] >= PageShare && Dist(fine[f], bg[pg]) > BoxApart;
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
                    // ...or, nearer, the nearest flat patch...
                    if (near[i] >= 0) d = Dist(p, near[i]);
                    // ...or, inside a box (where the fine background is a colour of its own,
                    // covering most of the 24 px around, on a page), the box: white text in a
                    // dark box comes out dark. Not the open page at the box's edge.
                    int fx0 = x / Fine, fy0 = y / Fine, f = fy0 * fw + fx0;
                    int pg = Clamp(y / Tile, 0, th - 1) * tw + Clamp(x / Tile, 0, tw - 1);
                    if (isBox[f]) d = open[i] ? Dist(p, bg[pg]) : Dist(p, fine[f]);
                    else
                    {
                        // the rim of a box, in a tile the page mostly fills: the box's colour is background too
                        for (int dy = -1; dy <= 1; dy++)
                            for (int dx = -1; dx <= 1; dx++)
                            {
                                int nx = fx0 + dx, ny = fy0 + dy;
                                if (nx < 0 || ny < 0 || nx >= fw || ny >= fh) continue;
                                int g = ny * fw + nx;
                                if (isBox[g] && Close(p, fine[g])) d = Math.Min(d, Dist(p, fine[g]));
                            }
                    }
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

        // Is a second look worth its time? When some of the picture differs from
        // its surroundings by colour more than by brightness, away from any dark or
        // light stroke: colourful text the engine may not see, not the coloured edges
        // ClearType gives black text (ColourShare, the share of such pixels, every
        // other row and column); or when there are boxes of their own colour in the
        // page, light on dark or dark on light (BoxShareOf, the share of the area).
        public static double BoxShareOf(Bitmap bmp)
        {
            int w = bmp.Width, h = bmp.Height;
            int[] px = Pixels(bmp);
            double[] share, fineShare;
            var bg = TileModes(px, w, h, Tile, Reach, out share);
            var fine = TileModes(px, w, h, Fine, 1, out fineShare);
            int fw = (w + Fine - 1) / Fine, fh = (h + Fine - 1) / Fine, tw = (w + Tile - 1) / Tile, th = (h + Tile - 1) / Tile;
            int boxes = 0;
            for (int fy = 0; fy < fh; fy++)
                for (int fx = 0; fx < fw; fx++)
                {
                    int f = fy * fw + fx, t = Clamp(fy * Fine / Tile, 0, th - 1) * tw + Clamp(fx * Fine / Tile, 0, tw - 1);
                    if (fineShare[f] >= BoxShare && share[t] >= PageShare && Dist(fine[f], bg[t]) > BoxApart) boxes++;
                }
            return fw * fh == 0 ? 0 : (double)boxes / (fw * fh);
        }

        // Where a second look is worth its time, row by row: bands of the picture
        // (tile rows, a row either side) with colour edges (ColourShare's kind) or
        // boxes of their own colour (BoxShareOf's), and both shares over the whole.
        public class Survey { public double Colour, Boxes; public List<int[]> Bands = new List<int[]>(); public double[] RowColours, RowBoxes; }
        const double RowColour = 0.012;   // a row's share of colour edges (plain ClearType text: up to ~0.006)...
        const double RowBoxes = 0.02;     // ...or of box tiles, that takes it

        public static Survey Look(Bitmap bmp)
        {
            int w = bmp.Width, h = bmp.Height;
            int[] px = Pixels(bmp);
            int th = (h + Tile - 1) / Tile, tw = (w + Tile - 1) / Tile;
            var hits = new int[th]; var seen = new int[th];
            for (int y = 2; y < h - 2; y += 2)
                for (int x = 2; x < w - 2; x += 2)
                {
                    int i = y * w + x, p = px[i];
                    seen[y / Tile]++;
                    if ((ColourEdge(p, px[i - 2]) || ColourEdge(p, px[i - 2 * w])) && !NearCore(px, i, w)) hits[y / Tile]++;
                }
            double[] share, fineShare;
            var bg = TileModes(px, w, h, Tile, Reach, out share);
            var fine = TileModes(px, w, h, Fine, 1, out fineShare);
            int fw = (w + Fine - 1) / Fine, fh = (h + Fine - 1) / Fine;
            var boxes = new int[th]; var tiles = new int[th];
            for (int fy = 0; fy < fh; fy++)
                for (int fx = 0; fx < fw; fx++)
                {
                    int f = fy * fw + fx, r = Clamp(fy * Fine / Tile, 0, th - 1), t = r * tw + Clamp(fx * Fine / Tile, 0, tw - 1);
                    tiles[r]++;
                    if (fineShare[f] >= BoxShare && share[t] >= PageShare && Dist(fine[f], bg[t]) > BoxApart) boxes[r]++;
                }
            var s = new Survey { RowColours = new double[th], RowBoxes = new double[th] };
            int allHits = 0, allSeen = 0, allBoxes = 0, allTiles = 0;
            for (int r = 0; r < th; r++)
            {
                allHits += hits[r]; allSeen += seen[r]; allBoxes += boxes[r]; allTiles += tiles[r];
                s.RowColours[r] = seen[r] > 0 ? (double)hits[r] / seen[r] : 0;
                s.RowBoxes[r] = tiles[r] > 0 ? (double)boxes[r] / tiles[r] : 0;
                bool take = (seen[r] > 0 && (double)hits[r] / seen[r] >= RowColour) || (tiles[r] > 0 && (double)boxes[r] / tiles[r] >= RowBoxes);
                if (!take) continue;
                int y0 = Math.Max(0, (r - 1) * Tile), y1 = Math.Min(h, (r + 2) * Tile);
                if (s.Bands.Count > 0 && y0 <= s.Bands[s.Bands.Count - 1][1]) s.Bands[s.Bands.Count - 1][1] = y1;
                else s.Bands.Add(new[] { y0, y1 });
            }
            s.Colour = allSeen == 0 ? 0 : (double)allHits / allSeen;
            s.Boxes = allTiles == 0 ? 0 : (double)allBoxes / allTiles;
            return s;
        }

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

        // How much a reading looks like Chinese, all its lines together; and per
        // character, which tells a good reading (most characters common) from a poor one.
        public static double Total(List<Line> lines)
        {
            double t = 0;
            foreach (var l in lines) t += Score(l);
            return t;
        }

        public static double PerChar(List<Line> lines)
        {
            int n = 0;
            foreach (var l in lines) n += Program.CodePoints(l.Text).Count;
            return n == 0 ? 0 : Total(lines) / n;
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
