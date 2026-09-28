// HanziOcr — reads text off the screen for HanziHome Desktop.
//
// A console program that stays running. Electron (desktop/src/ocr.js) writes one
// JSON request per line to its stdin and reads one JSON reply per line from its
// stdout. It uses the OCR engine built into Windows (Windows.Media.Ocr) with the
// zh-Hans-CN language, which Windows installs with Chinese language support.
//
// Built with the C# compiler that ships with Windows (.NET Framework 4.x), so
// neither building nor running it needs anything installed: see build.js. That
// compiler only speaks C# 5, and the async bridge in System.Runtime.WindowsRuntime
// wants a Windows.winmd that only the Windows SDK has, so WinRT calls are awaited
// by hand (Wait) and pixels reach the OCR engine through CryptographicBuffer.
//
// Requests ("id" is echoed back so replies can be matched):
//   {"id":1,"cmd":"hello"}
//   {"id":2,"cmd":"monitors"}                    monitors and the foreground window
//   {"id":3,"cmd":"file","path":"a.png","scale":1.5}
//   {"id":4,"cmd":"screen","monitor":0,"scale":1.5,"incremental":true}
//        optional "x","y","w","h" read a region instead of a whole monitor;
//        without "monitor", the monitor under the foreground window;
//        "picture":"a.png" reads that file as if it were the screen (for tests)
//   {"id":5,"cmd":"forget"}                      drop remembered frames
//   {"id":7,"cmd":"color","x":0,"y":0,"w":40,"h":40}   average colour there (tests)
//   {"id":8,"cmd":"foreground"}                  {"process":"notepad"}: the program in front
//   {"id":6,"cmd":"quit"}
//
// A reply is {"id":…,"ok":true,…} or {"id":…,"ok":false,"error":"…"}. Text comes
// back as lines, each with one box per character, in screen pixels (physical,
// not scaled by Windows' display scaling) or image pixels for "file":
//   {"lines":[{"text":"我家有猫","x":…,"y":…,"w":…,"h":…,
//              "chars":[{"t":"我","x":…,"y":…,"w":…,"h":…}, …]}]}
//
// "screen" with "incremental" compares the capture with the last one of the
// same rectangle in strips STRIP pixels high and reads again only the bands that
// changed, widened to whole remembered lines, keeping every other line as it
// was. Nothing changed: {"changed":false} and no lines.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Windows.Foundation;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Security.Cryptography;

namespace HanziOcr
{
    class Ch
    {
        public string T;
        public int X, Y, W, H;
    }

    class Line
    {
        public string Text;
        public int X, Y, W, H;
        public List<Ch> Chars = new List<Ch>();
        public int Bottom { get { return Y + H; } }
    }

    // the last capture of one rectangle, and what was read from it
    class Frame
    {
        public int W, H;
        public int[] Pixels;
        public List<Line> Lines;
    }

    static class Program
    {
        const int Version = 1;
        // Enlargement before OCR. desktop/test/ocr.js measured ×1.5 as the best single
        // setting (~97.6% of characters on its test pictures, against ~94% at ×1).
        const double DefaultScale = 1.5;
        const int Strip = 16;                 // rows compared as one unit
        const double FullReadShare = 0.6;     // this much changed: read the whole thing

        static OcrEngine engine;
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        static StreamWriter output;
        static readonly Dictionary<string, Frame> Frames = new Dictionary<string, Frame>();

        [MTAThread]
        static int Main(string[] args)
        {
            // physical pixels everywhere, whatever the display scaling
            Native.SetProcessDpiAwarenessContext(new IntPtr(-4));   // PER_MONITOR_AWARE_V2
            engine = OcrEngine.TryCreateFromLanguage(new Windows.Globalization.Language("zh-Hans-CN"));
            output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            output.AutoFlush = true;

            // hanzi-ocr.exe picture.png [scale]: print the text, for trying it by hand
            if (args.Length > 0)
            {
                if (engine == null) { output.WriteLine("Chinese OCR is not installed."); return 1; }
                var r = ReadFile(args[0], args.Length > 1 ? double.Parse(args[1]) : DefaultScale);
                foreach (var line in r) output.WriteLine(line.Text);
                return 0;
            }

            var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            string text;
            while ((text = input.ReadLine()) != null)
            {
                if (text.Trim().Length == 0) continue;
                object id = null;
                try
                {
                    var req = Json.Deserialize<Dictionary<string, object>>(text);
                    if (req.ContainsKey("id")) id = req["id"];
                    var reply = Handle(req);
                    if (reply == null) break;                      // quit
                    reply["id"] = id;
                    reply["ok"] = true;
                    Send(reply);
                }
                catch (Exception e)
                {
                    var err = new Dictionary<string, object>();
                    err["id"] = id;
                    err["ok"] = false;
                    err["error"] = e.Message;
                    Send(err);
                }
            }
            return 0;
        }

        static void Send(Dictionary<string, object> reply)
        {
            output.WriteLine(Json.Serialize(reply));
        }

        static Dictionary<string, object> Handle(Dictionary<string, object> req)
        {
            string cmd = Str(req, "cmd");
            if (cmd != "hello" && cmd != "quit" && engine == null)
                throw new Exception("Chinese (Simplified) OCR is not installed. Add it in Settings > Time & language > Language.");
            switch (cmd)
            {
                case "hello": return Hello();
                case "monitors": return Monitors();
                case "file":
                    {
                        var sw = Stopwatch.StartNew();
                        var lines = ReadFile(Str(req, "path"), Num(req, "scale", DefaultScale));
                        var r = new Dictionary<string, object>();
                        r["lines"] = LinesJson(lines);
                        r["ms"] = sw.ElapsedMilliseconds;
                        return r;
                    }
                case "screen": return ReadScreen(req);
                case "color": return AverageColor(req);
                case "foreground": return Foreground();
                case "forget": Frames.Clear(); return new Dictionary<string, object>();
                case "quit": return null;
                default: throw new Exception("unknown command: " + cmd);
            }
        }

        static Dictionary<string, object> Hello()
        {
            var langs = new List<string>();
            foreach (var l in OcrEngine.AvailableRecognizerLanguages) langs.Add(l.LanguageTag);
            var r = new Dictionary<string, object>();
            r["app"] = "HanziOcr";
            r["version"] = Version;
            r["chinese"] = engine != null;
            r["languages"] = langs;
            r["maxSide"] = (int)OcrEngine.MaxImageDimension;
            return r;
        }

        // ------------------------------------------------------------ monitors

        static List<Native.MonitorInfo> ListMonitors()
        {
            var list = new List<Native.MonitorInfo>();
            Native.EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr h, IntPtr dc, ref Native.RECT r, IntPtr data)
            {
                list.Add(Native.Describe(h));
                return true;
            }, IntPtr.Zero);
            return list;
        }

        static Dictionary<string, object> Monitors()
        {
            var mons = ListMonitors();
            var outList = new List<object>();
            for (int i = 0; i < mons.Count; i++)
            {
                var m = mons[i];
                var d = new Dictionary<string, object>();
                d["index"] = i;
                d["x"] = m.Bounds.X; d["y"] = m.Bounds.Y; d["w"] = m.Bounds.Width; d["h"] = m.Bounds.Height;
                d["dpi"] = m.Dpi;
                d["scale"] = m.Dpi / 96.0;
                d["primary"] = m.Primary;
                outList.Add(d);
            }
            var r = new Dictionary<string, object>();
            r["monitors"] = outList;
            var fg = Native.GetForegroundWindow();
            Native.RECT wr;
            if (fg != IntPtr.Zero && Native.GetWindowRect(fg, out wr))
            {
                var f = new Dictionary<string, object>();
                f["x"] = wr.Left; f["y"] = wr.Top; f["w"] = wr.Right - wr.Left; f["h"] = wr.Bottom - wr.Top;
                f["monitor"] = MonitorIndex(mons, Native.MonitorFromWindow(fg, 2));
                r["foreground"] = f;
            }
            return r;
        }

        // The program in front, by name ("notepad", "eldenring"), for the desktop app's
        // pause list. Only the name: nothing about the window's contents.
        static Dictionary<string, object> Foreground()
        {
            var r = new Dictionary<string, object>();
            string name = "";
            var fg = Native.GetForegroundWindow();
            uint pid;
            if (fg != IntPtr.Zero && Native.GetWindowThreadProcessId(fg, out pid) != 0)
            {
                try { name = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); }
                catch (Exception) { /* gone, or not ours to ask about */ }
            }
            r["process"] = name;
            return r;
        }

        static int MonitorIndex(List<Native.MonitorInfo> mons, IntPtr handle)
        {
            for (int i = 0; i < mons.Count; i++) if (mons[i].Handle == handle) return i;
            return 0;
        }

        // ------------------------------------------------------------- reading

        static List<Line> ReadFile(string path, double scale)
        {
            using (var bmp = new Bitmap(path))
            using (var argb = To32(bmp))
                return Recognize(argb, scale, 0, 0);
        }

        static Bitmap To32(Bitmap src)
        {
            var b = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(b)) g.DrawImage(src, 0, 0, src.Width, src.Height);
            return b;
        }

        static Dictionary<string, object> ReadScreen(Dictionary<string, object> req)
        {
            var times = new Dictionary<string, object>();
            var sw = Stopwatch.StartNew();
            Rectangle rect;
            // "picture": a file standing in for the screen, so tests can change it at will
            string picture = Str(req, "picture");
            Bitmap stand = picture.Length > 0 ? To32(new Bitmap(picture)) : null;
            if (stand != null)
                rect = new Rectangle(0, 0, stand.Width, stand.Height);
            else if (req.ContainsKey("w") && req.ContainsKey("h"))
                rect = new Rectangle((int)Num(req, "x", 0), (int)Num(req, "y", 0), (int)Num(req, "w", 0), (int)Num(req, "h", 0));
            else
            {
                var mons = ListMonitors();
                int index = req.ContainsKey("monitor")
                    ? (int)Num(req, "monitor", 0)
                    : MonitorIndex(mons, Native.MonitorFromWindow(Native.GetForegroundWindow(), 2));
                if (index < 0 || index >= mons.Count) throw new Exception("no monitor " + index);
                rect = mons[index].Bounds;
            }
            if (rect.Width <= 0 || rect.Height <= 0) throw new Exception("empty rectangle");
            double scale = Num(req, "scale", DefaultScale);
            bool incremental = !req.ContainsKey("incremental") || (bool)req["incremental"];

            using (var bmp = stand ?? new Bitmap(rect.Width, rect.Height, PixelFormat.Format32bppArgb))
            {
                if (stand == null)
                    using (var g = Graphics.FromImage(bmp))
                        g.CopyFromScreen(rect.X, rect.Y, 0, 0, rect.Size, CopyPixelOperation.SourceCopy);
                var pixels = PixelsOf(bmp);
                times["capture"] = sw.ElapsedMilliseconds;

                string key = rect.X + "," + rect.Y + "," + rect.Width + "," + rect.Height;
                Frame last;
                Frames.TryGetValue(key, out last);
                var bands = new List<int[]>();
                bool full = !incremental || last == null;
                if (!full)
                {
                    bands = ChangedBands(last.Pixels, pixels, rect.Width, rect.Height, last.Lines, rect.Y);
                    int changed = 0;
                    foreach (var b in bands) changed += b[1] - b[0];
                    full = changed > rect.Height * FullReadShare;
                }
                times["diff"] = sw.ElapsedMilliseconds;

                var r = new Dictionary<string, object>();
                r["rect"] = new Dictionary<string, object> { { "x", rect.X }, { "y", rect.Y }, { "w", rect.Width }, { "h", rect.Height } };
                if (!full && bands.Count == 0)
                {
                    last.Pixels = pixels;
                    r["changed"] = false;
                    times["total"] = sw.ElapsedMilliseconds;
                    r["ms"] = times;
                    return r;
                }

                List<Line> lines;
                if (full)
                {
                    lines = Recognize(bmp, scale, rect.X, rect.Y);
                    bands = new List<int[]> { new[] { 0, rect.Height } };
                }
                else
                {
                    // keep the lines outside every changed band, read the bands again
                    lines = new List<Line>();
                    foreach (var line in last.Lines)
                        if (!Touches(bands, line.Y - rect.Y, line.Bottom - rect.Y)) lines.Add(line);
                    foreach (var b in bands)
                        using (var part = bmp.Clone(new Rectangle(0, b[0], rect.Width, b[1] - b[0]), PixelFormat.Format32bppArgb))
                            lines.AddRange(Recognize(part, scale, rect.X, rect.Y + b[0]));
                    lines.Sort(delegate(Line a, Line c) { return a.Y != c.Y ? a.Y.CompareTo(c.Y) : a.X.CompareTo(c.X); });
                }
                times["ocr"] = sw.ElapsedMilliseconds;

                // only incremental reads come back to the same rectangle; a one-off read
                // (hover's strip around the pointer) would leave a frame behind for good
                if (incremental) Frames[key] = new Frame { W = rect.Width, H = rect.Height, Pixels = pixels, Lines = lines };
                var bandList = new List<object>();
                foreach (var b in bands) bandList.Add(new[] { b[0] + rect.Y, b[1] + rect.Y });
                r["changed"] = true;
                r["full"] = full;
                r["bands"] = bandList;
                r["lines"] = LinesJson(lines);
                times["total"] = sw.ElapsedMilliseconds;
                r["ms"] = times;
                return r;
            }
        }

        // The average colour of a small screen rectangle, captured the same way as
        // "screen": lets desktop/test/overlay.js check that the overlay stays out of
        // our own captures without reading anything that is on the screen.
        static Dictionary<string, object> AverageColor(Dictionary<string, object> req)
        {
            var rect = new Rectangle((int)Num(req, "x", 0), (int)Num(req, "y", 0),
                Math.Max(1, (int)Num(req, "w", 1)), Math.Max(1, (int)Num(req, "h", 1)));
            using (var bmp = new Bitmap(rect.Width, rect.Height, PixelFormat.Format32bppArgb))
            {
                using (var g = Graphics.FromImage(bmp))
                    g.CopyFromScreen(rect.X, rect.Y, 0, 0, rect.Size, CopyPixelOperation.SourceCopy);
                long r = 0, gr = 0, b = 0;
                var px = PixelsOf(bmp);
                foreach (var p in px) { r += (p >> 16) & 255; gr += (p >> 8) & 255; b += p & 255; }
                var reply = new Dictionary<string, object>();
                reply["rgb"] = new[] { (int)(r / px.Length), (int)(gr / px.Length), (int)(b / px.Length) };
                return reply;
            }
        }

        static int[] PixelsOf(Bitmap bmp)
        {
            var data = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            var px = new int[bmp.Width * bmp.Height];
            Marshal.Copy(data.Scan0, px, 0, px.Length);
            bmp.UnlockBits(data);
            return px;
        }

        // Which horizontal bands differ, in rows relative to the rectangle. A band
        // grows to cover any remembered line it cuts through, so a line is always
        // read whole.
        static List<int[]> ChangedBands(int[] a, int[] b, int w, int h, List<Line> lines, int top)
        {
            var bands = new List<int[]>();
            if (a.Length != b.Length) { bands.Add(new[] { 0, h }); return bands; }
            for (int y0 = 0; y0 < h; y0 += Strip)
            {
                int y1 = Math.Min(h, y0 + Strip);
                bool diff = false;
                for (int y = y0; y < y1 && !diff; y++)
                {
                    int row = y * w;
                    for (int x = 0; x < w; x++)
                        if (a[row + x] != b[row + x]) { diff = true; break; }
                }
                if (!diff) continue;
                // one strip of margin either side; neighbours merge
                int s = Math.Max(0, y0 - Strip), e = Math.Min(h, y1 + Strip);
                if (bands.Count > 0 && s <= bands[bands.Count - 1][1]) bands[bands.Count - 1][1] = e;
                else bands.Add(new[] { s, e });
            }
            bool grew = true;
            while (grew)
            {
                grew = false;
                foreach (var line in lines)
                {
                    int ly0 = line.Y - top, ly1 = line.Bottom - top;
                    foreach (var band in bands)
                        if (ly0 < band[1] && ly1 > band[0] && (ly0 < band[0] || ly1 > band[1]))
                        {
                            band[0] = Math.Max(0, Math.Min(band[0], ly0 - 2));
                            band[1] = Math.Min(h, Math.Max(band[1], ly1 + 2));
                            grew = true;
                        }
                }
                bands.Sort(delegate(int[] p, int[] q) { return p[0].CompareTo(q[0]); });
                for (int i = bands.Count - 1; i > 0; i--)
                    if (bands[i][0] <= bands[i - 1][1])
                    {
                        bands[i - 1][1] = Math.Max(bands[i - 1][1], bands[i][1]);
                        bands.RemoveAt(i);
                        grew = true;
                    }
            }
            return bands;
        }

        static bool Touches(List<int[]> bands, int y0, int y1)
        {
            foreach (var b in bands) if (y0 < b[1] && y1 > b[0]) return true;
            return false;
        }

        // OCR one bitmap, enlarged by scale first (small text reads far better
        // bigger), with boxes mapped back to the unenlarged image plus an offset.
        static List<Line> Recognize(Bitmap bmp, double scale, int offX, int offY)
        {
            double max = OcrEngine.MaxImageDimension;
            scale = Math.Max(1, Math.Min(scale, Math.Min(max / bmp.Width, max / bmp.Height)));
            Bitmap big = bmp;
            if (scale > 1.001)
            {
                big = new Bitmap((int)(bmp.Width * scale), (int)(bmp.Height * scale), PixelFormat.Format32bppArgb);
                using (var g = Graphics.FromImage(big))
                {
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    g.DrawImage(bmp, 0, 0, big.Width, big.Height);
                }
            }
            try
            {
                var data = big.LockBits(new Rectangle(0, 0, big.Width, big.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                var bytes = new byte[data.Stride * big.Height];
                Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);
                big.UnlockBits(data);
                var soft = SoftwareBitmap.CreateCopyFromBuffer(CryptographicBuffer.CreateFromByteArray(bytes),
                    BitmapPixelFormat.Bgra8, big.Width, big.Height);
                var result = Wait(engine.RecognizeAsync(soft));
                return ToLines(result, scale, offX, offY);
            }
            finally
            {
                if (big != bmp) big.Dispose();
            }
        }

        static List<Line> ToLines(OcrResult result, double scale, int offX, int offY)
        {
            var lines = new List<Line>();
            foreach (var ol in result.Lines)
            {
                var line = new Line();
                var text = new StringBuilder();
                string prev = null;
                int x0 = int.MaxValue, y0 = int.MaxValue, x1 = int.MinValue, y1 = int.MinValue;
                foreach (var w in ol.Words)
                {
                    var r = w.BoundingRect;
                    int wx = offX + (int)Math.Round(r.X / scale), wy = offY + (int)Math.Round(r.Y / scale);
                    int ww = Math.Max(1, (int)Math.Round(r.Width / scale)), wh = Math.Max(1, (int)Math.Round(r.Height / scale));
                    x0 = Math.Min(x0, wx); y0 = Math.Min(y0, wy); x1 = Math.Max(x1, wx + ww); y1 = Math.Max(y1, wy + wh);
                    // Latin words keep their spaces; Chinese runs together
                    if (prev != null && IsLatin(prev[prev.Length - 1]) && IsLatin(w.Text[0])) text.Append(' ');
                    text.Append(w.Text);
                    prev = w.Text;
                    // A run of CJK characters in one box is shared out evenly; anything
                    // else (an English word, a number) stays one box.
                    var cps = CodePoints(w.Text);
                    if (cps.Count > 1 && cps.TrueForAll(IsCjk))
                        for (int i = 0; i < cps.Count; i++)
                        {
                            int cx = wx + ww * i / cps.Count, cx1 = wx + ww * (i + 1) / cps.Count;
                            line.Chars.Add(new Ch { T = cps[i], X = cx, Y = wy, W = Math.Max(1, cx1 - cx), H = wh });
                        }
                    else line.Chars.Add(new Ch { T = w.Text, X = wx, Y = wy, W = ww, H = wh });
                }
                if (line.Chars.Count == 0) continue;
                line.Text = text.ToString();
                line.X = x0; line.Y = y0; line.W = x1 - x0; line.H = y1 - y0;
                lines.Add(line);
            }
            return lines;
        }

        static List<string> CodePoints(string s)
        {
            var list = new List<string>();
            for (int i = 0; i < s.Length; i++)
            {
                if (char.IsHighSurrogate(s[i]) && i + 1 < s.Length) { list.Add(s.Substring(i, 2)); i++; }
                else list.Add(s.Substring(i, 1));
            }
            return list;
        }

        static bool IsCjk(string cp)
        {
            int c = char.ConvertToUtf32(cp, 0);
            return (c >= 0x3000 && c <= 0x303F) || (c >= 0x3400 && c <= 0x9FFF) || (c >= 0xFF00 && c <= 0xFFEF)
                || (c >= 0x20000 && c <= 0x2FFFF) || (c >= 0x2E80 && c <= 0x2FDF) || c == 0x31C0;
        }

        static bool IsLatin(char c) { return c < 0x3000 && char.IsLetterOrDigit(c); }

        static List<object> LinesJson(List<Line> lines)
        {
            var list = new List<object>();
            foreach (var l in lines)
            {
                var chars = new List<object>();
                foreach (var c in l.Chars)
                    chars.Add(new Dictionary<string, object> { { "t", c.T }, { "x", c.X }, { "y", c.Y }, { "w", c.W }, { "h", c.H } });
                list.Add(new Dictionary<string, object> {
                    { "text", l.Text }, { "x", l.X }, { "y", l.Y }, { "w", l.W }, { "h", l.H }, { "chars", chars } });
            }
            return list;
        }

        // ------------------------------------------------------------- helpers

        // Wait for a WinRT operation. Setting Completed on an operation that has
        // already finished calls the handler at once, so this cannot miss it.
        static T Wait<T>(IAsyncOperation<T> op)
        {
            using (var done = new ManualResetEvent(false))
            {
                op.Completed = delegate { done.Set(); };
                done.WaitOne();
            }
            if (op.Status != AsyncStatus.Completed)
                throw new Exception("OCR " + op.Status + (op.ErrorCode != null ? ": " + op.ErrorCode.Message : ""));
            return op.GetResults();
        }

        static string Str(Dictionary<string, object> d, string k)
        {
            object v;
            return d.TryGetValue(k, out v) && v != null ? v.ToString() : "";
        }

        static double Num(Dictionary<string, object> d, string k, double fallback)
        {
            object v;
            return d.TryGetValue(k, out v) && v != null ? Convert.ToDouble(v) : fallback;
        }
    }

    static class Native
    {
        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int Left, Top, Right, Bottom; }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct MONITORINFOEX
        {
            public int Size;
            public RECT Monitor, Work;
            public uint Flags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Device;
        }

        public class MonitorInfo
        {
            public IntPtr Handle;
            public Rectangle Bounds;
            public int Dpi;
            public bool Primary;
        }

        public delegate bool MonitorEnumProc(IntPtr monitor, IntPtr dc, ref RECT rect, IntPtr data);

        [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
        [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonitorEnumProc proc, IntPtr data);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFOEX info);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rect);
        [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint dpiX, out uint dpiY);

        public static MonitorInfo Describe(IntPtr handle)
        {
            var info = new MONITORINFOEX();
            info.Size = Marshal.SizeOf(typeof(MONITORINFOEX));
            GetMonitorInfo(handle, ref info);
            uint dx, dy;
            int dpi = GetDpiForMonitor(handle, 0, out dx, out dy) == 0 ? (int)dx : 96;
            return new MonitorInfo
            {
                Handle = handle,
                Bounds = Rectangle.FromLTRB(info.Monitor.Left, info.Monitor.Top, info.Monitor.Right, info.Monitor.Bottom),
                Dpi = dpi,
                Primary = (info.Flags & 1) != 0,
            };
        }
    }
}
