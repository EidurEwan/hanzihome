// render.exe jobs.json — draw test pictures of Chinese text for desktop/test/ocr.js.
//
// jobs.json is a list of {out, text, font, size, bold, italic, fg, bg, width, style}:
//   "plain"     the way Windows draws text on screen (ClearType)
//   "subtitle"  white text with a dark outline over a noisy, uneven background,
//               like subtitles over video
//   "rich"      characters laid out one by one so each run of them can have its
//               own colour and background: "runs" is [{n, fg, bg}], n characters
//               each, repeated over the text; a run without bg sits on the page's
//   "gradient"  text filled with a gradient ("fg", "fg2") over another ("bg", "bg2")
//   "hollow"    outlines only, like display fonts with hollow strokes
//   "shadow"    text with a soft offset shadow, as in thumbnails and games
// "fontFile" draws with a font file instead of an installed font. Prints, as JSON,
// the font each job actually got, so a test can tell when a font is not installed.
// Built by: node desktop/ocr/build.js render

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

static class Render
{
    static readonly Dictionary<string, PrivateFontCollection> Files = new Dictionary<string, PrivateFontCollection>();

    static int Main(string[] args)
    {
        var json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        var jobs = json.Deserialize<List<Dictionary<string, object>>>(File.ReadAllText(args[0], Encoding.UTF8));
        var got = new List<object>();
        foreach (var job in jobs)
        {
            string text = (string)job["text"], style = Get(job, "style", "plain");
            float size = Convert.ToSingle(job["size"]);
            int width = Convert.ToInt32(Get(job, "width", 900));
            var fs = (Convert.ToBoolean(Get(job, "bold", false)) ? FontStyle.Bold : FontStyle.Regular)
                | (Convert.ToBoolean(Get(job, "italic", false)) ? FontStyle.Italic : FontStyle.Regular);
            var font = MakeFont(job, size, fs);
            got.Add(font.Name);
            var fg = ColorTranslator.FromHtml(Get(job, "fg", "#222222"));
            var bg = ColorTranslator.FromHtml(Get(job, "bg", "#ffffff"));

            var fmt = new StringFormat(StringFormat.GenericTypographic);
            fmt.FormatFlags &= ~StringFormatFlags.NoWrap;
            List<Glyph> glyphs = null;
            int height;
            if (style == "plain" || style == "subtitle")
            {
                SizeF need;
                using (var probe = new Bitmap(1, 1))
                using (var g = Graphics.FromImage(probe))
                    need = g.MeasureString(text, font, width - 40, fmt);
                height = (int)Math.Ceiling(need.Height * 1.25) + 40;
            }
            else
            {
                glyphs = Layout(text, font, size, width);
                float bottom = 0;
                foreach (var gl in glyphs) bottom = Math.Max(bottom, gl.Y + size * 1.5f);
                height = (int)Math.Ceiling(bottom) + 30;
            }

            using (var bmp = new Bitmap(width, height, PixelFormat.Format32bppArgb))
            using (var g = Graphics.FromImage(bmp))
            {
                var box = new RectangleF(20, 20, width - 40, height - 40);
                if (style == "subtitle")
                {
                    PaintNoise(bmp, new Random(text.Length));
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    using (var p = new GraphicsPath())
                    using (var pen = new Pen(Color.FromArgb(230, 10, 10, 10), size / 7f) { LineJoin = LineJoin.Round })
                    using (var fill = new SolidBrush(fg))
                    {
                        p.AddString(text, font.FontFamily, (int)font.Style, size, box, fmt);
                        g.DrawPath(pen, p);
                        g.FillPath(fill, p);
                    }
                }
                else if (style == "plain")
                {
                    g.Clear(bg);
                    g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
                    using (var brush = new SolidBrush(fg)) g.DrawString(text, font, brush, box, fmt);
                }
                else if (style == "rich") DrawRich(g, glyphs, font, size, bg, Runs(job, fg));
                else if (style == "gradient")
                {
                    var whole = new Rectangle(0, 0, width, height);
                    using (var back = new LinearGradientBrush(whole, bg, ColorTranslator.FromHtml(Get(job, "bg2", "#ffffff")), 20f))
                        g.FillRectangle(back, whole);
                    g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                    using (var brush = new LinearGradientBrush(whole, fg, ColorTranslator.FromHtml(Get(job, "fg2", "#000000")), 0f))
                        foreach (var gl in glyphs) g.DrawString(gl.T, font, brush, gl.X, gl.Y, StringFormat.GenericTypographic);
                }
                else
                {
                    g.Clear(bg);
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                    using (var p = new GraphicsPath())
                    {
                        foreach (var gl in glyphs)
                            p.AddString(gl.T, font.FontFamily, (int)font.Style, size, new PointF(gl.X, gl.Y), StringFormat.GenericTypographic);
                        if (style == "hollow")
                            using (var pen = new Pen(fg, Math.Max(1f, size / 20f))) g.DrawPath(pen, p);
                        else
                        {
                            float off = Math.Max(1.5f, size / 12f);
                            using (var shadow = (GraphicsPath)p.Clone())
                            using (var m = new Matrix())
                            using (var sb = new SolidBrush(Color.FromArgb(140, 0, 0, 0)))
                            {
                                m.Translate(off, off);
                                shadow.Transform(m);
                                g.FillPath(sb, shadow);
                            }
                            using (var fill = new SolidBrush(fg)) g.FillPath(fill, p);
                        }
                    }
                }
                bmp.Save((string)job["out"], ImageFormat.Png);
            }
        }
        Console.Out.Write(json.Serialize(got));
        return 0;
    }

    static Font MakeFont(Dictionary<string, object> job, float size, FontStyle fs)
    {
        string file = Get(job, "fontFile", "");
        if (file.Length == 0) return new Font((string)job["font"], size, fs, GraphicsUnit.Pixel);
        PrivateFontCollection pfc;
        if (!Files.TryGetValue(file, out pfc))
        {
            pfc = new PrivateFontCollection();
            pfc.AddFontFile(file);
            Files[file] = pfc;
        }
        var family = pfc.Families[0];
        if (!family.IsStyleAvailable(fs)) fs = FontStyle.Regular;
        return new Font(family, size, fs, GraphicsUnit.Pixel);
    }

    class Glyph { public string T; public float X, Y, W; }
    class Run { public Color Fg; public Color Bg; public bool HasBg; public int N; }

    // one character at a time, wrapping at the width: lets every run have its own
    // colours, and every style below share one layout
    static List<Glyph> Layout(string text, Font font, float size, int width)
    {
        var list = new List<Glyph>();
        float x = 20, y = 20, lineH = size * 1.5f;
        using (var probe = new Bitmap(1, 1))
        using (var g = Graphics.FromImage(probe))
            for (int i = 0; i < text.Length; i++)
            {
                string cp = char.IsHighSurrogate(text[i]) && i + 1 < text.Length ? text.Substring(i++, 2) : text.Substring(i, 1);
                if (cp == "\n") { x = 20; y += lineH; continue; }
                float w = Math.Max(size * 0.3f, g.MeasureString(cp, font, new PointF(0, 0), StringFormat.GenericTypographic).Width);
                if (x + w > width - 20) { x = 20; y += lineH; }
                list.Add(new Glyph { T = cp, X = x, Y = y, W = w });
                x += w;
            }
        return list;
    }

    static List<Run> Runs(Dictionary<string, object> job, Color fg)
    {
        var runs = new List<Run>();
        object raw;
        if (job.TryGetValue("runs", out raw) && raw is System.Collections.ArrayList)
            foreach (Dictionary<string, object> r in (System.Collections.ArrayList)raw)
            {
                var run = new Run { N = Convert.ToInt32(Get(r, "n", 4)), Fg = ColorTranslator.FromHtml(Get(r, "fg", "#222222")) };
                string b = Get(r, "bg", "");
                if (b.Length > 0) { run.Bg = ColorTranslator.FromHtml(b); run.HasBg = true; }
                runs.Add(run);
            }
        if (runs.Count == 0) runs.Add(new Run { N = 1, Fg = fg });
        return runs;
    }

    static void DrawRich(Graphics g, List<Glyph> glyphs, Font font, float size, Color bg, List<Run> runs)
    {
        g.Clear(bg);
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        int ri = 0, left = runs[0].N;
        foreach (var gl in glyphs)
        {
            if (left == 0) { ri = (ri + 1) % runs.Count; left = runs[ri].N; }
            left--;
            var run = runs[ri];
            if (run.HasBg)
                using (var b = new SolidBrush(run.Bg)) g.FillRectangle(b, gl.X, gl.Y - size * 0.15f, gl.W + 0.5f, size * 1.35f);
            using (var b = new SolidBrush(run.Fg)) g.DrawString(gl.T, font, b, gl.X, gl.Y, StringFormat.GenericTypographic);
        }
    }

    static string Get(Dictionary<string, object> d, string k, object fallback)
    {
        object v;
        return Convert.ToString(d.TryGetValue(k, out v) && v != null ? v : fallback);
    }

    // a dim, uneven picture: a gradient with blotches and grain, like a video frame
    static void PaintNoise(Bitmap bmp, Random rnd)
    {
        using (var g = Graphics.FromImage(bmp))
        {
            using (var grad = new LinearGradientBrush(new Rectangle(0, 0, bmp.Width, bmp.Height),
                Color.FromArgb(70, 90, 110), Color.FromArgb(150, 130, 90), 30f))
                g.FillRectangle(grad, 0, 0, bmp.Width, bmp.Height);
            for (int i = 0; i < 40; i++)
                using (var b = new SolidBrush(Color.FromArgb(90, rnd.Next(256), rnd.Next(256), rnd.Next(256))))
                    g.FillEllipse(b, rnd.Next(bmp.Width), rnd.Next(bmp.Height), rnd.Next(40, 260), rnd.Next(30, 160));
        }
        for (int i = 0; i < bmp.Width * bmp.Height / 12; i++)
        {
            int x = rnd.Next(bmp.Width), y = rnd.Next(bmp.Height);
            var c = bmp.GetPixel(x, y);
            int d = rnd.Next(-40, 41);
            bmp.SetPixel(x, y, Color.FromArgb(Clamp(c.R + d), Clamp(c.G + d), Clamp(c.B + d)));
        }
    }

    static int Clamp(int v) { return Math.Max(0, Math.Min(255, v)); }
}
