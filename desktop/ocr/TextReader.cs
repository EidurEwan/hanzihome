// TextReader — text that programs offer through UI Automation, read directly
// instead of off the screen: the exact characters, where they are, and far quicker
// than OCR. Browsers (Chrome, Edge, Firefox and Electron apps), Word, Notepad and
// most programs that show ordinary text offer it this way. Whatever doesn't (games,
// pictures, video, text drawn on a canvas) is left to the OCR in HanziOcr.cs.
//
// Requests (the protocol is at the top of HanziOcr.cs):
//   {"cmd":"text-at","x":…,"y":…,"skip":[pids]}   the line of text under a point
//   {"cmd":"read-text","skip":[pids]}             the visible text of the window in front
//   "screen" with "text":true                     the window in front read this way, and
//                                                 its lines left out of the OCR
// "skip" names HanziHome's own processes; "hwnd" picks a window (tests). Lines come
// back as OCR lines do, with "src":"uia".
//
// A program that stops answering can't hold the helper up: every job runs on a
// thread of its own with a deadline, and a window that missed one is left alone
// for a while (its text goes to the OCR instead).

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Automation.Text;

namespace HanziOcr
{
    static class TextReader
    {
        const int PointMs = 600;      // text-at: the longest wait for a program's answer
        const int WindowMs = 900;     // a window's visible lines
        const int ReadMs = 2000;      // read-text
        const int BlockMs = 30000;    // a window that missed a deadline is left alone this long
        const int MaxLines = 400;
        const int Recheck = 5000;     // look for a window's text containers again after this

        static Thread running;        // the job out now, or abandoned past its deadline
        static readonly Dictionary<IntPtr, int> Blocked = new Dictionary<IntPtr, int>();
        static string why = "";       // why the last job found nothing (for the reply)

        // a window's text containers, found at most every Recheck ms
        class Found { public IntPtr Hwnd; public List<AutomationElement> Containers; public int At; }
        static Found found;

        // what "screen" read last for a rectangle: the window, a signature of its
        // visible text, and the lines (null: too slow to read, leave it to the OCR)
        class Seen { public IntPtr Hwnd; public string Sig; public long Pixels; public List<Line> Lines; }
        static readonly Dictionary<string, Seen> SeenFor = new Dictionary<string, Seen>();

        // ------------------------------------------------------------ requests

        public static Dictionary<string, object> TextAt(Dictionary<string, object> req)
        {
            var sw = Stopwatch.StartNew();
            var skip = Skip(req);
            var pt = new System.Windows.Point(Program.Num(req, "x", 0), Program.Num(req, "y", 0));
            why = "";
            var line = Within<Line>(PointMs, IntPtr.Zero, delegate
            {
                var e = AutomationElement.FromPoint(pt);
                if (e == null) { why = "nothing there"; return null; }
                if (skip.Contains(e.Current.ProcessId)) { why = "HanziHome"; return null; }
                // the nearest element with text around the point: the page, the document
                var walker = TreeWalker.RawViewWalker;
                for (int n = 0; e != null && n < 40 && !HasText(e); n++) e = walker.GetParent(e);
                if (e == null || !HasText(e)) { why = "no text offered"; return null; }
                var tp = (TextPattern)e.GetCurrentPattern(TextPattern.Pattern);
                var at = tp.RangeFromPoint(pt);
                at.ExpandToEnclosingUnit(TextUnit.Line);
                var l = ToLine(at, Everywhere, true, Stopwatch.StartNew(), PointMs - 100);
                if (l == null) why = "no text there";
                return l;
            });
            var r = new Dictionary<string, object>();
            var lines = new List<Line>();
            if (line != null) lines.Add(line);
            r["lines"] = Program.LinesJson(lines);
            if (line == null) r["why"] = why.Length > 0 ? why : "too slow";
            r["ms"] = sw.ElapsedMilliseconds;
            return r;
        }

        public static Dictionary<string, object> ReadText(Dictionary<string, object> req)
        {
            var sw = Stopwatch.StartNew();
            var skip = Skip(req);
            IntPtr hwnd = Hwnd(req);
            if (hwnd == IntPtr.Zero) hwnd = Front(skip, true);
            var r = new Dictionary<string, object>();
            why = "";
            // as lines with their places, not the plain text: a browser breaks its text
            // wherever it wraps on screen, and the places tell a wrap from a new paragraph
            // (desktop/src/layout.js joins them back, as it does OCR lines)
            var lines = hwnd == IntPtr.Zero ? null : Within<List<Line>>(ReadMs, hwnd, delegate
            {
                found = null;                              // look afresh
                Native.RECT wr;
                Native.GetWindowRect(hwnd, out wr);
                var clip = Rectangle.FromLTRB(wr.Left, wr.Top, wr.Right, wr.Bottom);
                var all = new List<Line>();
                var watch = Stopwatch.StartNew();
                foreach (var c in Containers(hwnd))
                    all.AddRange(Lines(c, clip, watch, ReadMs - 200, true, all.Count == 0 ? 0 : all[all.Count - 1].Para + 1));
                if (all.Count == 0) why = "no text offered";
                return Distinct(all);
            });
            var text = new StringBuilder();
            foreach (var l in lines ?? new List<Line>()) text.Append(l.Text).Append('\n');
            r["lines"] = Program.LinesJson(lines ?? new List<Line>());
            r["text"] = text.ToString();
            r["process"] = ProcessName(hwnd);
            if (text.Length == 0) r["why"] = hwnd == IntPtr.Zero ? "no window" : why.Length > 0 ? why : "too slow";
            r["ms"] = sw.ElapsedMilliseconds;
            return r;
        }

        // For "screen": the window in front read directly, if it offers its text, as
        // lines within clip. An unchanged window costs a few calls: the lines are kept
        // with a signature of its visible text and where that starts, and a window
        // whose pixels are just as they were isn't asked at all. bmp: the capture of
        // clip. changed: the lines differ from last time for this key. Null: nothing
        // read this way, the OCR reads it all.
        public static List<Line> ScreenLines(Dictionary<string, object> req, string key, Rectangle clip, Bitmap bmp, out bool changed)
        {
            var skip = Skip(req);
            IntPtr hwnd = Hwnd(req);
            if (hwnd == IntPtr.Zero) hwnd = Front(skip, false);
            Seen seen;
            SeenFor.TryGetValue(key, out seen);
            bool had = seen != null && seen.Lines != null && seen.Lines.Count > 0;
            Native.RECT wr;
            Rectangle win = hwnd != IntPtr.Zero && Native.GetWindowRect(hwnd, out wr)
                ? Rectangle.Intersect(clip, Rectangle.FromLTRB(wr.Left, wr.Top, wr.Right, wr.Bottom)) : Rectangle.Empty;
            if (win.IsEmpty)
            {
                SeenFor.Remove(key);
                changed = had;
                return null;
            }
            long pixels = Hash(bmp, new Rectangle(win.X - clip.X, win.Y - clip.Y, win.Width, win.Height));
            if (seen != null && seen.Hwnd == hwnd && seen.Pixels == pixels)
            {
                changed = false;
                return seen.Lines;
            }
            var result = Within<Seen>(WindowMs, hwnd, delegate
            {
                var sw = Stopwatch.StartNew();
                var cs = Containers(hwnd);
                if (cs.Count == 0) return new Seen { Hwnd = hwnd, Sig = "", Lines = null };
                string sig = Signature(cs);
                if (seen != null && seen.Hwnd == hwnd && seen.Sig == sig) return seen;
                try
                {
                    var lines = new List<Line>();
                    foreach (var c in cs) lines.AddRange(Lines(c, win, sw, WindowMs - 150));
                    return new Seen { Hwnd = hwnd, Sig = sig, Lines = Distinct(lines) };
                }
                catch (TimeoutException)
                {
                    return new Seen { Hwnd = hwnd, Sig = sig, Lines = null };   // too much: OCR, until it changes
                }
            });
            if (result != null && !ReferenceEquals(result, seen)) result.Pixels = pixels;
            else if (result != null) seen.Pixels = pixels;
            if (result == null || result.Lines == null)
            {
                if (result != null) SeenFor[key] = result; else SeenFor.Remove(key);
                changed = had;
                return null;
            }
            changed = !ReferenceEquals(seen, result);
            SeenFor[key] = result;
            return result.Lines;
        }

        public static void Forget() { SeenFor.Clear(); found = null; }

        // a quick fingerprint of part of a capture
        static long Hash(Bitmap bmp, Rectangle part)
        {
            part.Intersect(new Rectangle(0, 0, bmp.Width, bmp.Height));
            if (part.IsEmpty) return 0;
            var data = bmp.LockBits(part, System.Drawing.Imaging.ImageLockMode.ReadOnly, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
            try
            {
                var row = new int[part.Width];
                long h = 1469598103934665603L;
                for (int y = 0; y < part.Height; y++)
                {
                    Marshal.Copy(new IntPtr(data.Scan0.ToInt64() + (long)y * data.Stride), row, 0, part.Width);
                    for (int x = 0; x < row.Length; x++) h = (h ^ row[x]) * 1099511628211L;
                }
                return h;
            }
            finally { bmp.UnlockBits(data); }
        }

        // ------------------------------------------------------------- reading

        static readonly Rectangle Everywhere = new Rectangle(-100000, -100000, 200000, 200000);

        static bool HasText(AutomationElement e)
        {
            return (bool)e.GetCurrentPropertyValue(AutomationElement.IsTextPatternAvailableProperty);
        }

        // A window's text containers: the nearest element with text above what is under
        // points spread over the window (much quicker than searching a web page's big
        // tree), keeping those that cover a fair part of it, so a browser's page counts
        // and its address bar doesn't.
        static List<AutomationElement> Containers(IntPtr hwnd)
        {
            if (found != null && found.Hwnd == hwnd && Environment.TickCount - found.At < Recheck)
            {
                try
                {
                    foreach (var c in found.Containers) { var probe = c.Current.BoundingRectangle; }
                    return found.Containers;
                }
                catch (Exception) { /* gone: look again */ }
            }
            Native.RECT r;
            Native.GetWindowRect(hwnd, out r);
            uint pid;
            Native.GetWindowThreadProcessId(hwnd, out pid);
            double area = Math.Max(1.0, (double)(r.Right - r.Left) * (r.Bottom - r.Top));
            var list = new List<AutomationElement>();
            var ids = new HashSet<string>();
            var walker = TreeWalker.RawViewWalker;
            double[][] spots = { new[] { .5, .55 }, new[] { .25, .35 }, new[] { .75, .35 }, new[] { .25, .8 }, new[] { .75, .8 } };
            foreach (var f in spots)
            {
                var pt = new System.Windows.Point(r.Left + (r.Right - r.Left) * f[0], r.Top + (r.Bottom - r.Top) * f[1]);
                AutomationElement e;
                try { e = AutomationElement.FromPoint(pt); } catch (Exception) { continue; }
                if (e == null || e.Current.ProcessId != (int)pid) continue;     // covered by another window
                for (int n = 0; e != null && n < 40; n++)
                {
                    if (HasText(e))
                    {
                        var b = e.Current.BoundingRectangle;
                        if (!b.IsEmpty && b.Width * b.Height >= area * 0.08)
                        {
                            string id = string.Join(".", e.GetRuntimeId());
                            if (ids.Add(id)) list.Add(e);
                            break;
                        }
                    }
                    if (e.Current.NativeWindowHandle == hwnd.ToInt32()) break;
                    e = walker.GetParent(e);
                }
            }
            found = new Found { Hwnd = hwnd, Containers = list, At = Environment.TickCount };
            return list;
        }

        // what the containers show, in brief: changes when the text or its place does
        static string Signature(List<AutomationElement> cs)
        {
            var sb = new StringBuilder();
            foreach (var c in cs)
            {
                var tp = (TextPattern)c.GetCurrentPattern(TextPattern.Pattern);
                foreach (var v in tp.GetVisibleRanges())
                {
                    sb.Append(v.GetText(50000)).Append((char)1);
                    // where the first character is (scrolling moves it): one character's
                    // box is far cheaper to ask for than every line's
                    var first = v.Clone();
                    first.MoveEndpointByRange(TextPatternRangeEndpoint.End, first, TextPatternRangeEndpoint.Start);
                    first.ExpandToEnclosingUnit(TextUnit.Character);
                    var rs = first.GetBoundingRectangles();
                    if (rs.Length > 0) sb.Append((int)rs[0].X).Append(',').Append((int)rs[0].Y);
                    sb.Append((char)2);
                }
            }
            return sb.ToString();
        }

        // one container's visible text, a line at a time; with paras, each line is
        // numbered with its paragraph (from paraBase on), which tells a line that wraps
        // on screen from the end of a paragraph
        static List<Line> Lines(AutomationElement c, Rectangle clip, Stopwatch sw, int budget, bool paras = false, int paraBase = 0)
        {
            var tp = (TextPattern)c.GetCurrentPattern(TextPattern.Pattern);
            var lines = new List<Line>();
            TextPatternRange para = null;
            int p = paraBase - 1;
            foreach (var vis in tp.GetVisibleRanges())
            {
                var line = vis.Clone();
                line.MoveEndpointByRange(TextPatternRangeEndpoint.End, line, TextPatternRangeEndpoint.Start);
                line.ExpandToEnclosingUnit(TextUnit.Line);
                for (int n = 0; n < MaxLines; n++)
                {
                    if (sw.ElapsedMilliseconds > budget) throw new TimeoutException();
                    var l = ToLine(line, clip, sw.ElapsedMilliseconds < budget * 0.6, sw, budget);
                    if (l != null && paras)
                    {
                        var pr = line.Clone();
                        pr.ExpandToEnclosingUnit(TextUnit.Paragraph);
                        if (para == null || pr.CompareEndpoints(TextPatternRangeEndpoint.Start, para, TextPatternRangeEndpoint.Start) != 0) p++;
                        para = pr;
                        l.Para = p;
                    }
                    if (l != null) lines.Add(l);
                    var prev = line.Clone();
                    if (line.Move(TextUnit.Line, 1) == 0) break;
                    line.ExpandToEnclosingUnit(TextUnit.Line);
                    if (line.CompareEndpoints(TextPatternRangeEndpoint.Start, prev, TextPatternRangeEndpoint.Start) <= 0) break;
                    if (line.CompareEndpoints(TextPatternRangeEndpoint.Start, vis, TextPatternRangeEndpoint.End) >= 0) break;
                }
            }
            return lines;
        }

        // A line of text with a box for each character. The line's rectangles (more
        // than one when its style changes) are laid end to end and shared out by
        // width: a CJK character counts 1 (they are all as wide), anything else about
        // half. A line of Chinese, the usual case, comes out exact; in a line that
        // mixes in other text, each run of Chinese is measured on its own (measure).
        static Line ToLine(TextPatternRange range, Rectangle clip, bool measure, Stopwatch sw, int budget)
        {
            string raw = range.GetText(4000);
            if (string.IsNullOrEmpty(raw)) return null;
            var all = Program.CodePoints(raw);
            int a = 0, b = all.Count;
            while (a < b && Blank(all[a])) a++;
            while (b > a && Blank(all[b - 1])) b--;
            if (a == b) return null;
            var rects = Shown(range.GetBoundingRectangles(), clip);
            if (rects.Count == 0) return null;

            double total = 0, strip = 0;
            for (int i = a; i < b; i++) total += Weight(all[i]);
            foreach (var rc in rects) strip += rc.Width;
            var line = new Line { Src = "uia" };
            var text = new StringBuilder();
            double pos = 0, used = 0;
            int ri = 0;
            for (int i = a; i < b; i++)
            {
                double w = Weight(all[i]) * strip / total;
                while (ri < rects.Count - 1 && pos >= used + rects[ri].Width - 0.5) { used += rects[ri].Width; ri++; }
                var R = rects[ri];
                double x0 = R.X + (pos - used), x1 = Math.Min(R.Right, x0 + w);
                line.Chars.Add(new Ch { T = all[i], X = (int)Math.Round(x0), Y = R.Y, W = Math.Max(1, (int)Math.Round(x1 - x0)), H = R.Height });
                text.Append(all[i]);
                pos += w;
            }

            // a mixed line: measure each run of Chinese
            bool cjk = false, other = false;
            for (int i = a; i < b; i++) { if (Program.IsCjk(all[i])) cjk = true; else if (!Blank(all[i])) other = true; }
            if (measure && cjk && other)
            {
                for (int s = a; s < b; )
                {
                    if (!Program.IsCjk(all[s])) { s++; continue; }
                    int e = s;
                    var run = new StringBuilder();
                    while (e < b && Program.IsCjk(all[e])) run.Append(all[e++]);
                    if (sw.ElapsedMilliseconds > budget * 0.8) break;
                    var sub = range.Clone();
                    sub.MoveEndpointByUnit(TextPatternRangeEndpoint.Start, TextUnit.Character, s);
                    sub.MoveEndpointByRange(TextPatternRangeEndpoint.End, sub, TextPatternRangeEndpoint.Start);
                    sub.MoveEndpointByUnit(TextPatternRangeEndpoint.End, TextUnit.Character, e - s);
                    // only when the range really is that run (a program may count otherwise)
                    if (sub.GetText(e - s + 4) == run.ToString())
                    {
                        var rr = Shown(sub.GetBoundingRectangles(), clip);
                        if (rr.Count > 0)
                        {
                            var u = rr[0];
                            foreach (var q in rr) u = Rectangle.Union(u, q);
                            for (int i = s; i < e; i++)
                            {
                                int cx = u.X + u.Width * (i - s) / (e - s), cx1 = u.X + u.Width * (i - s + 1) / (e - s);
                                line.Chars[i - a] = new Ch { T = all[i], X = cx, Y = u.Y, W = Math.Max(1, cx1 - cx), H = u.Height };
                            }
                        }
                    }
                    s = e;
                }
            }

            var box = rects[0];
            foreach (var rc in rects) box = Rectangle.Union(box, rc);
            line.Text = text.ToString();
            line.X = box.X; line.Y = box.Y; line.W = box.Width; line.H = box.Height;
            return line;
        }

        // a range's rectangles that are really on screen here: not the zero-sized
        // ones some pages give text meant only for screen readers
        static List<Rectangle> Shown(System.Windows.Rect[] rs, Rectangle clip)
        {
            var list = new List<Rectangle>();
            foreach (var r in rs)
            {
                if (r.IsEmpty || r.Width < 2 || r.Height < 4 || r.Height > 400) continue;
                var q = new Rectangle((int)Math.Round(r.X), (int)Math.Round(r.Y), (int)Math.Round(r.Width), (int)Math.Round(r.Height));
                int cx = q.X + q.Width / 2, cy = q.Y + q.Height / 2;
                if (cx < clip.Left || cx >= clip.Right || cy < clip.Top || cy >= clip.Bottom) continue;
                list.Add(q);
            }
            return list;
        }

        static bool Blank(string cp)
        {
            char c = cp[0];
            return cp.Length == 1 && (char.IsWhiteSpace(c) || char.IsControl(c) || c == (char)0xFFFC || c == (char)0x200B);
        }

        static double Weight(string cp)
        {
            if (Program.IsCjk(cp)) return 1;
            return cp == " " ? 0.3 : 0.55;
        }

        // the same line twice (a page and a frame in it both offer it): once
        static List<Line> Distinct(List<Line> lines)
        {
            var seen = new HashSet<string>();
            var list = new List<Line>();
            foreach (var l in lines)
                if (seen.Add(l.Text + "@" + l.X / 4 + "," + l.Y / 4)) list.Add(l);
            list.Sort(delegate(Line p, Line q) { return p.Y != q.Y ? p.Y.CompareTo(q.Y) : p.X.CompareTo(q.X); });
            return list;
        }

        // ------------------------------------------------------------- windows

        // The window to read: the one in front, unless that is HanziHome, the taskbar
        // or the desktop; then (walk) the first ordinary window below it.
        static IntPtr Front(HashSet<int> skip, bool walk)
        {
            IntPtr fg = Native.GetForegroundWindow();
            if (Ordinary(fg, skip)) return fg;
            if (!walk) return IntPtr.Zero;
            for (IntPtr h = W.GetTopWindow(IntPtr.Zero); h != IntPtr.Zero; h = W.GetWindow(h, 2))
                if (Ordinary(h, skip)) return h;
            return IntPtr.Zero;
        }

        static bool Ordinary(IntPtr h, HashSet<int> skip)
        {
            if (h == IntPtr.Zero || !W.IsWindowVisible(h) || W.IsIconic(h)) return false;
            uint pid;
            Native.GetWindowThreadProcessId(h, out pid);
            if (skip.Contains((int)pid)) return false;
            if ((W.GetWindowLong(h, -20) & 0x80) != 0) return false;         // a tool window
            int cloaked;
            if (W.DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return false;
            var cls = new StringBuilder(64);
            W.GetClassName(h, cls, 64);
            string c = cls.ToString();
            if (c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd" || c == "Progman" || c == "WorkerW") return false;
            Native.RECT r;
            return Native.GetWindowRect(h, out r) && r.Right - r.Left >= 80 && r.Bottom - r.Top >= 60;
        }

        static string ProcessName(IntPtr h)
        {
            uint pid;
            if (h == IntPtr.Zero || Native.GetWindowThreadProcessId(h, out pid) == 0) return "";
            try { return Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); }
            catch (Exception) { return ""; }
        }

        // ------------------------------------------------------------- helpers

        // Run a UI Automation job on a thread of its own and wait at most ms for it.
        // Past the deadline the job is abandoned (null), its window left alone for a
        // while, and nothing new starts until the job has finished.
        static T Within<T>(int ms, IntPtr hwnd, Func<T> job) where T : class
        {
            if (running != null && running.IsAlive) { why = "busy"; return null; }
            int until;
            if (hwnd != IntPtr.Zero && Blocked.TryGetValue(hwnd, out until) && Environment.TickCount - until < 0)
            {
                why = "not answering";
                return null;
            }
            T result = null;
            var t = new Thread(delegate()
            {
                try { result = job(); }
                catch (Exception e) { why = e.GetType().Name + ": " + e.Message; result = null; }
            });
            t.IsBackground = true;
            running = t;
            t.Start();
            if (t.Join(ms)) return result;
            if (hwnd != IntPtr.Zero) Blocked[hwnd] = Environment.TickCount + BlockMs;
            why = "too slow";
            return null;
        }

        static HashSet<int> Skip(Dictionary<string, object> req)
        {
            var set = new HashSet<int>();
            object v;
            if (req.TryGetValue("skip", out v) && v is IEnumerable && !(v is string))
                foreach (var p in (IEnumerable)v) set.Add(Convert.ToInt32(p));
            return set;
        }

        static IntPtr Hwnd(Dictionary<string, object> req)
        {
            object v;
            return req.TryGetValue("hwnd", out v) && v != null ? new IntPtr(Convert.ToInt64(v)) : IntPtr.Zero;
        }

        static class W
        {
            [DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr parent);
            [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr window, uint cmd);
            [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
            [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
            [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr window, int index);
            [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr window, StringBuilder name, int max);
            [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);
        }
    }
}
