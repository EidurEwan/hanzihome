// render.exe jobs.json — draw test pictures of Chinese text for desktop/test/ocr.js.
//
// jobs.json is a list of {out, text, font, size, bold, fg, bg, width, style}:
// style "plain" draws text the way Windows draws it on screen (ClearType);
// "subtitle" draws white text with a dark outline over a noisy, uneven
// background, like subtitles over video. Prints, as JSON, the font each job
// actually got, so a test can tell when a font is not installed.
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
            var font = new Font((string)job["font"], size,
                Convert.ToBoolean(Get(job, "bold", false)) ? FontStyle.Bold : FontStyle.Regular, GraphicsUnit.Pixel);
            got.Add(font.Name);
            var fg = ColorTranslator.FromHtml(Get(job, "fg", "#222222"));
            var bg = ColorTranslator.FromHtml(Get(job, "bg", "#ffffff"));

            var fmt = new StringFormat(StringFormat.GenericTypographic);
            fmt.FormatFlags &= ~StringFormatFlags.NoWrap;
            SizeF need;
            using (var probe = new Bitmap(1, 1))
            using (var g = Graphics.FromImage(probe))
                need = g.MeasureString(text, font, width - 40, fmt);
            int height = (int)Math.Ceiling(need.Height * 1.25) + 40;

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
                else
                {
                    g.Clear(bg);
                    g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
                    using (var brush = new SolidBrush(fg)) g.DrawString(text, font, brush, box, fmt);
                }
                bmp.Save((string)job["out"], ImageFormat.Png);
            }
        }
        Console.Out.Write(json.Serialize(got));
        return 0;
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
