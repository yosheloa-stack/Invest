import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  createTextWatermark,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  Check,
  ChevronDown,
  LineChart,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { api, countdown, pct, price } from "./format";
import { liveBar, subscribe, lastServerTime } from "./live";
import {
  SPECS,
  STUDIES,
  params,
  levelsAt,
  priceContext,
  series as buildSeries,
  studiesFor,
  type Bar,
  type Study,
} from "./studies";
import { candlePatterns, type Bar as PBar } from "../src/patterns";
import type {
  CandleData,
  Evaluation,
  PatternHit,
  RobotTrade,
  Signal,
} from "./types";
import { PALETTE, useTheme, type Palette } from "./theme";
const FRAMES = [1, 5, 10, 15] as const;
export type Frame = (typeof FRAMES)[number];
const sec = (t: number) => Math.floor(t / 1000) as UTCTimestamp;
const hhmm = (t: number) =>
  new Date(t * 1000).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
// Groups 1-minute bars into 5, 10 or 15-minute candles.
function aggregate(bars: Bar[], tf: number): Bar[] {
  if (tf === 1) return bars;
  const size = tf * 60000,
    out: Bar[] = [];
  for (const b of bars) {
    const t = Math.floor(b.t / size) * size,
      last = out[out.length - 1];
    if (last && last.t === t) {
      last.h = Math.max(last.h, b.h);
      last.l = Math.min(last.l, b.l);
      last.c = b.c;
      last.v += b.v;
      last.buy += b.buy;
    } else out.push({ ...b, t });
  }
  return out;
}
type Lines = {
  ema9: ISeriesApi<"Line">;
  lta: ISeriesApi<"Line">;
  ltb: ISeriesApi<"Line">;
  ema21: ISeriesApi<"Line">;
  ema50: ISeriesApi<"Line">;
  bbUp: ISeriesApi<"Line">;
  bbMid: ISeriesApi<"Line">;
  bbDn: ISeriesApi<"Line">;
  vwap: ISeriesApi<"Line">;
  vol: ISeriesApi<"Histogram">;
};
type Legend = {
  bar: Bar;
  prev: number;
  rsi: number;
  ema9: number;
  ema21: number;
  ema50: number;
  bbUp: number;
  bbMid: number;
  bbDn: number;
  vwap: number;
};
type Reading = {
  trend: -1 | 0 | 1;
  range: boolean;
  sup?: number;
  res?: number;
};
// Moving averages are drawn at ~55% opacity so the candles stay in front.
const faint = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? `${c}8c` : c);
// Candle patterns of the chart's timeframe, one per candle, strongest (directional) first.
function candleMarks(bars: Bar[], tf: number, count: number) {
  const size = tf * 60000,
    grouped: PBar[] = [];
  let cur: (PBar & { n: number }) | null = null;
  // The last bar is still forming; only closed candles get a pattern.
  for (const b of bars.slice(0, -1)) {
    const t = Math.floor(b.t / size) * size;
    if (!cur || cur.t !== t) {
      if (cur && cur.n === tf) grouped.push(cur);
      cur = { t, o: b.o, h: b.h, l: b.l, c: b.c, n: 1 };
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.n++;
    }
  }
  if (cur && cur.n === tf) grouped.push(cur);
  const out: { t: number; hit: PatternHit }[] = [];
  for (let i = Math.max(12, grouped.length - count); i < grouped.length; i++) {
    const hits = candlePatterns(grouped.slice(Math.max(0, i - 20), i + 1)),
      hit = hits.find((h) => h.bias !== 0);
    if (hit) out.push({ t: grouped[i].t, hit });
  }
  return out;
}
const n2 = (x: number) =>
  Number.isFinite(x) ? x.toFixed(2).replace(".", ",") : "—";
// TradingView-style live chart: 1/5/15-minute candles, the indicators the strategies read,
// and the selected strategy's triggers.
export default function CandleChart({
  symbol,
  title,
  focus,
  signals,
  head,
  expanded = false,
  onExpand,
  robotTrades = [],
  robotStudies = [],
  robotLevels,
  patternLevels,
}: {
  // The chart pattern in play: breakout level, target and invalidation as price lines.
  patternLevels?: PatternHit | null;
  robotTrades?: RobotTrade[];
  // Indicators the robot is reading on this pair; forced on so the user sees them.
  robotStudies?: Study[];
  robotLevels?: { support: number | null; resistance: number | null };
  symbol: string;
  title: string;
  focus?: Evaluation;
  signals: Signal[];
  head?: ReactNode;
  expanded?: boolean;
  onExpand?: () => void;
}) {
  const theme = useTheme(),
    C = PALETTE[theme],
    pal = useRef<Palette>(C);
  pal.current = C;
  const volColor = (b: Bar) =>
    b.c >= b.o ? pal.current.volUp : pal.current.volDown;
  const host = useRef<HTMLDivElement>(null),
    chart = useRef<IChartApi | undefined>(undefined),
    candles = useRef<ISeriesApi<"Candlestick"> | undefined>(undefined),
    lines = useRef<Lines | undefined>(undefined),
    rsi = useRef<ISeriesApi<"Line"> | undefined>(undefined),
    rsiLevels = useRef<IPriceLine[]>([]),
    srLines = useRef<IPriceLine[]>([]),
    fibLines = useRef<IPriceLine[]>([]),
    markers = useRef<ISeriesMarkersPluginApi<Time> | undefined>(undefined),
    mark = useRef<{ applyOptions: (o: object) => void } | undefined>(undefined),
    hist = useRef<Bar[]>([]),
    view = useRef<Bar[]>([]),
    shown = useRef<number | null>(null),
    anim = useRef(0);
  const [tf, setTf] = useState<Frame>(() => {
      try {
        const v = Number(localStorage.getItem("yosh-tf"));
        return (FRAMES as readonly number[]).includes(v) ? (v as Frame) : 1;
      } catch {
        return 1;
      }
    }),
    [data, setData] = useState<CandleData | null>(null),
    [error, setError] = useState<string | null>(null),
    [legend, setLegend] = useState<Legend | null>(null),
    [hover, setHover] = useState(false),
    [left, setLeft] = useState("--:--"),
    [menu, setMenu] = useState(false),
    [showTriggers, setShowTriggers] = useState(false),
    [studies, setStudies] = useState<Set<Study>>(
      () => new Set(["sr", "candle", "ema", "vol"]),
    ),
    [reading, setReading] = useState<Reading | null>(null),
    [minute, setMinute] = useState(0);
  const p = useMemo(() => params(focus?.id), [focus?.id]);
  // The parent passes a new signals array on every render; redraw the marks only when a
  // signal actually changes (candle-pattern and trigger marks are costly to rebuild).
  const signalsKey = signals
    .map((x) => `${x.id}:${x.status}:${x.exitAt ?? ""}`)
    .join("|");
  useEffect(() => {
    const need = studiesFor(focus?.id);
    if (need.length)
      setStudies((s) => {
        const n = new Set(s);
        need.forEach((x) => n.add(x));
        return n;
      });
  }, [focus?.id]);
  const robotKey = robotStudies.join(",");
  useEffect(() => {
    if (robotKey)
      setStudies((s) => {
        const n = new Set(s);
        robotKey.split(",").forEach((x) => n.add(x as Study));
        return n.size === s.size ? s : n;
      });
  }, [robotKey]);
  useEffect(() => {
    try {
      localStorage.setItem("yosh-tf", String(tf));
    } catch {
      /* private mode */
    }
  }, [tf]);
  useEffect(() => {
    const el = host.current!;
    const c = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: pal.current.panel },
        textColor: pal.current.muted,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif",
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: pal.current.line, enableResize: true },
      },
      grid: {
        vertLines: { color: pal.current.grid },
        horzLines: { color: pal.current.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: pal.current.crosshair,
          style: LineStyle.Dashed,
          labelBackgroundColor: pal.current.label,
        },
        horzLine: {
          color: pal.current.crosshair,
          style: LineStyle.Dashed,
          labelBackgroundColor: pal.current.label,
        },
      },
      rightPriceScale: {
        borderColor: pal.current.line,
        scaleMargins: { top: 0.1, bottom: 0.14 },
      },
      timeScale: {
        borderColor: pal.current.line,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 7,
        // Zoom (pinch or wheel) keeps the latest candle on the right edge.
        rightBarStaysOnScroll: true,
        tickMarkFormatter: (t: Time) => hhmm(Number(t)),
      },
      localization: {
        timeFormatter: (t: Time) => hhmm(Number(t)),
        locale: "pt-BR",
      },
    });
    const fmt = {
      type: "custom" as const,
      formatter: (x: number) => price(x),
      minMove: 0.000000001,
    };
    const line = (color: string, width: 1 | 2 = 1, style = LineStyle.Solid) =>
      c.addSeries(LineSeries, {
        color,
        lineWidth: width,
        lineStyle: style,
        priceFormat: fmt,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
    const vol = c.addSeries(HistogramSeries, {
      priceScaleId: "vol",
      priceFormat: { type: "volume" },
      priceLineVisible: false,
      lastValueVisible: false,
    });
    c.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.84, bottom: 0 },
    });
    lines.current = {
      vol,
      bbUp: line(pal.current.bb),
      bbMid: line(pal.current.orange),
      bbDn: line(pal.current.bb),
      vwap: line(pal.current.vwap, 2),
      ema50: line(faint(pal.current.ema50)),
      ema21: line(faint(pal.current.ema21)),
      ema9: line(faint(pal.current.ema9)),
      lta: line(pal.current.up, 2),
      ltb: line(pal.current.down, 2),
    };
    const s = c.addSeries(CandlestickSeries, {
      upColor: pal.current.up,
      downColor: pal.current.down,
      borderUpColor: pal.current.up,
      borderDownColor: pal.current.down,
      wickUpColor: pal.current.up,
      wickDownColor: pal.current.down,
      priceFormat: fmt,
    });
    mark.current = createTextWatermark(c.panes()[0], {
      horzAlign: "center",
      vertAlign: "center",
      lines: [
        {
          text: "",
          color: pal.current.watermark,
          fontSize: 64,
          fontStyle: "bold",
        },
      ],
    });
    chart.current = c;
    candles.current = s;
    markers.current = createSeriesMarkers(s, []);
    const move = (e: MouseEventParams<Time>) => {
      if (e.logical == null || !view.current.length) {
        setHover(false);
        return;
      }
      setHover(true);
      setLegend(read(Math.min(view.current.length - 1, Math.round(e.logical))));
    };
    c.subscribeCrosshairMove(move);
    c.timeScale().subscribeSizeChange(limitZoom);
    return () => {
      c.unsubscribeCrosshairMove(move);
      c.timeScale().unsubscribeSizeChange(limitZoom);
      cancelAnimationFrame(anim.current);
      c.remove();
      chart.current = undefined;
      candles.current = undefined;
      lines.current = undefined;
      rsi.current = undefined;
    };
  }, []);
  useEffect(() => {
    mark.current?.applyOptions({
      lines: [
        {
          text: `${title}, ${tf}`,
          color: pal.current.watermark,
          fontSize: 64,
          fontStyle: "bold",
        },
      ],
    });
  }, [title, tf]);
  // Theme switch recolors the canvas-drawn chart in place.
  useEffect(() => {
    const c = chart.current,
      L = lines.current;
    if (!c || !L) return;
    c.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: C.panel },
        textColor: C.muted,
        panes: { separatorColor: C.line },
      },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      crosshair: {
        vertLine: { color: C.crosshair, labelBackgroundColor: C.label },
        horzLine: { color: C.crosshair, labelBackgroundColor: C.label },
      },
      rightPriceScale: { borderColor: C.line },
      timeScale: { borderColor: C.line },
    });
    L.ema9.applyOptions({ color: faint(C.ema9) });
    L.ema21.applyOptions({ color: faint(C.ema21) });
    L.ema50.applyOptions({ color: faint(C.ema50) });
    L.bbUp.applyOptions({ color: C.bb });
    L.bbDn.applyOptions({ color: C.bb });
    L.bbMid.applyOptions({ color: C.orange });
    L.vwap.applyOptions({ color: C.vwap });
    rsi.current?.applyOptions({ color: C.rsi });
    for (const l of rsiLevels.current) l.applyOptions({ color: C.crosshair });
    mark.current?.applyOptions({
      lines: [
        {
          text: `${title}, ${tf}`,
          color: C.watermark,
          fontSize: 64,
          fontStyle: "bold",
        },
      ],
    });
    paintAll();
    setMinute(Date.now());
  }, [theme]);
  const read = (i: number): Legend | null => {
    const bars = view.current,
      b = bars[i];
    if (!b) return null;
    const s = buildSeries(bars.slice(Math.max(0, i - 400), i + 1)),
      j = s.c.length - 1;
    return {
      bar: b,
      prev: bars[i - 1]?.c ?? b.o,
      rsi: (p.rsi === 7 ? s.rsi7 : s.rsi14)[j],
      ema9: s.ema9[j],
      ema21: s.ema21[j],
      ema50: s.ema50[j],
      bbUp: s.bbMid[j] + p.bb * s.bbStd[j],
      bbMid: s.bbMid[j],
      bbDn: s.bbMid[j] - p.bb * s.bbStd[j],
      vwap: vwapAt(bars, i),
    };
  };
  // VWAP resets at 00:00 UTC, so it is summed over the whole day.
  const vwapAt = (bars: Bar[], i: number) => {
    const d = Math.floor(bars[i].t / 86400000);
    let pv = 0,
      vs = 0;
    for (let k = i; k >= 0 && Math.floor(bars[k].t / 86400000) === d; k--) {
      pv += ((bars[k].h + bars[k].l + bars[k].c) / 3) * bars[k].v;
      vs += bars[k].v;
    }
    return vs ? pv / vs : bars[i].c;
  };
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    if (studies.has("rsi") && !rsi.current) {
      rsi.current = c.addSeries(
        LineSeries,
        {
          color: pal.current.rsi,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: true,
          priceFormat: {
            type: "custom",
            formatter: (x: number) => x.toFixed(2).replace(".", ","),
            minMove: 0.01,
          },
          autoscaleInfoProvider: () => ({
            priceRange: { minValue: 0, maxValue: 100 },
          }),
        },
        1,
      );
      c.panes()[1]?.setHeight(120);
    } else if (!studies.has("rsi") && rsi.current) {
      c.removeSeries(rsi.current);
      rsi.current = undefined;
      rsiLevels.current = [];
      if (c.panes().length > 1) c.removePane(1);
    }
    if (rsi.current) {
      for (const l of rsiLevels.current) rsi.current.removePriceLine(l);
      rsiLevels.current = [100 - p.level, 50, p.level].map((v) =>
        rsi.current!.createPriceLine({
          price: v,
          color: pal.current.crosshair,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
          title: "",
        }),
      );
    }
    const L = lines.current!;
    const vis = (x: ISeriesApi<SeriesType>, on: boolean) =>
      x.applyOptions({ visible: on });
    vis(L.ema9, studies.has("ema"));
    vis(L.ema21, studies.has("ema"));
    vis(L.ema50, studies.has("ema"));
    vis(L.bbUp, studies.has("bb"));
    vis(L.bbMid, studies.has("bb"));
    vis(L.bbDn, studies.has("bb"));
    vis(L.vwap, studies.has("vwap"));
    vis(L.vol, studies.has("vol"));
    vis(L.lta, studies.has("trend"));
    vis(L.ltb, studies.has("trend"));
    paintAll();
  }, [studies, p]);
  const paintAll = () => {
    const L = lines.current,
      bars = (view.current = aggregate(hist.current, tf));
    if (!L || bars.length < 2) return;
    candles.current?.setData(
      bars.map((b) => ({
        time: sec(b.t),
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
      })),
    );
    shown.current = bars[bars.length - 1].c;
    const s = buildSeries(bars),
      at = (get: (i: number) => number) =>
        bars.flatMap((b, i) => {
          const v = get(i);
          return Number.isFinite(v) ? [{ time: sec(b.t), value: v }] : [];
        });
    L.ema9.setData(at((i) => s.ema9[i]));
    L.ema21.setData(at((i) => s.ema21[i]));
    L.ema50.setData(at((i) => s.ema50[i]));
    L.bbMid.setData(at((i) => s.bbMid[i]));
    L.bbUp.setData(at((i) => s.bbMid[i] + p.bb * s.bbStd[i]));
    L.bbDn.setData(at((i) => s.bbMid[i] - p.bb * s.bbStd[i]));
    L.vwap.setData(at((i) => s.vwap[i]));
    L.vol.setData(
      bars.map((b) => ({ time: sec(b.t), value: b.v, color: volColor(b) })),
    );
    // LTA/LTB from recent confirmed swing lows/highs. The line is extended to
    // the current bar so the user sees the active structural slope, not dots.
    const swing = (low: boolean) => {
      const pts: { i: number; v: number }[] = [];
      for (let i = Math.max(2, bars.length - 180); i < bars.length - 2; i++) {
        const v = low ? bars[i].l : bars[i].h;
        const ok = low
          ? v <= bars[i-1].l && v <= bars[i-2].l && v <= bars[i+1].l && v <= bars[i+2].l
          : v >= bars[i-1].h && v >= bars[i-2].h && v >= bars[i+1].h && v >= bars[i+2].h;
        if (ok) pts.push({ i, v });
      }
      return pts.slice(-2);
    };
    const trendData = (pts: {i:number;v:number}[], ascending: boolean) => {
      if (pts.length < 2 || (ascending ? pts[1].v <= pts[0].v : pts[1].v >= pts[0].v)) return [];
      const slope = (pts[1].v - pts[0].v) / (pts[1].i - pts[0].i);
      const end = bars.length - 1;
      return [
        { time: sec(bars[pts[0].i].t), value: pts[0].v },
        { time: sec(bars[end].t), value: pts[0].v + slope * (end - pts[0].i) },
      ];
    };
    L.lta.setData(trendData(swing(true), true));
    L.ltb.setData(trendData(swing(false), false));
    rsi.current?.setData(at((i) => (p.rsi === 7 ? s.rsi7 : s.rsi14)[i]));
    if (!hover) setLegend(read(bars.length - 1));
    limitZoom();
  };
  // Zooming out stops once every candle fits the width, so they never shrink
  // into a thin strip with empty space beside them.
  const limitZoom = () => {
    const t = chart.current?.timeScale(),
      w = t?.width() ?? 0,
      n = view.current.length;
    if (t && w > 0 && n > 1)
      t.applyOptions({ minBarSpacing: Math.max(0.5, w / (n + 8)) });
  };
  const paintLast = () => {
    const L = lines.current,
      bars = view.current;
    if (!L || bars.length < 2) return;
    const s = buildSeries(bars.slice(-400)),
      j = s.c.length - 1,
      b = bars[bars.length - 1],
      time = sec(b.t),
      put = (x: ISeriesApi<"Line">, v: number) =>
        Number.isFinite(v) && x.update({ time, value: v });
    put(L.ema9, s.ema9[j]);
    put(L.ema21, s.ema21[j]);
    put(L.ema50, s.ema50[j]);
    put(L.bbMid, s.bbMid[j]);
    put(L.bbUp, s.bbMid[j] + p.bb * s.bbStd[j]);
    put(L.bbDn, s.bbMid[j] - p.bb * s.bbStd[j]);
    L.vol.update({ time, value: b.v, color: volColor(b) });
    if (rsi.current) put(rsi.current, (p.rsi === 7 ? s.rsi7 : s.rsi14)[j]);
    if (studies.has("vwap")) put(L.vwap, vwapAt(bars, bars.length - 1));
    if (!hover) setLegend(read(bars.length - 1));
  };
  // Market prices are displayed immediately, without interpolated prices.
  const glide = (b: Bar) => {
    candles.current?.update({
      time: sec(b.t),
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
    });
    shown.current = b.c;
  };
  const fit = () => {
    const w = host.current?.clientWidth ?? 800,
      n = view.current.length;
    chart.current?.timeScale().setVisibleLogicalRange({
      from: Math.max(0, n - (w < 600 ? 60 : 130)),
      to: n + 8,
    });
  };
  useEffect(() => {
    let stop = false,
      first = true;
    setData(null);
    setError(null);
    setLegend(null);
    hist.current = [];
    view.current = [];
    shown.current = null;
    const controller = new AbortController();
    let loading = false,
      lastLoaded = 0;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const d = await api<CandleData>(`/api/candles/${symbol}?limit=1000`, {
          signal: controller.signal,
        });
        if (stop) return;
        if (d.symbol !== symbol || d.candles.length < 2)
          throw Error("Histórico em preparação. Tentando novamente…");
        const bars: Bar[] = d.candles.map((k) => ({ ...k, buy: k.buy ?? 0 }));
        const live = liveBar(symbol);
        if (live && bars.length && live.t >= bars[bars.length - 1].t) {
          if (live.t === bars[bars.length - 1].t) bars[bars.length - 1] = live;
          else bars.push(live);
        }
        const range = !first
          ? chart.current?.timeScale().getVisibleLogicalRange()
          : null;
        hist.current = bars;
        paintAll();
        if (range) chart.current?.timeScale().setVisibleLogicalRange(range);
        lastLoaded = Date.now();
        setData(d);
        setError(null);
        if (first) {
          fit();
          first = false;
        }
      } catch (e) {
        if (!stop)
          setError(
            e instanceof Error ? e.message : "Falha ao carregar candles",
          );
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => {
      if (first || Date.now() - lastLoaded >= 30000) void load();
    }, 5000);
    return () => {
      stop = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [symbol, tf, p]);
  // Switching timeframe rebuilds the candles from the same 1-minute history.
  useEffect(() => {
    if (!hist.current.length) return;
    paintAll();
    fit();
    setMinute(Date.now());
  }, [tf]);
  useEffect(
    () =>
      subscribe(() => {
        const b = liveBar(symbol),
          bars = hist.current;
        if (!b || !bars.length) return;
        const last = bars[bars.length - 1];
        if (b.t < last.t) return;
        if (b.t === last.t) bars[bars.length - 1] = b;
        else {
          bars.push(b);
          setMinute(b.t);
        }
        const size = tf * 60000,
          start = Math.floor(b.t / size) * size,
          v = view.current,
          lastView = v[v.length - 1];
        const bucket = aggregate(
          bars.filter((x) => x.t >= start),
          tf,
        )[0];
        if (!bucket) return;
        if (lastView && lastView.t === start) v[v.length - 1] = bucket;
        else {
          v.push(bucket);
          shown.current = bucket.o;
        }
        glide(bucket);
        paintLast();
        setLeft(countdown(start + size - (lastServerTime() || Date.now())));
      }),
    [symbol, p, studies, hover, tf],
  );
  useEffect(() => {
    if (!markers.current) return;
    const out: SeriesMarker<Time>[] = [],
      bars = hist.current,
      size = tf * 60000,
      bucket = (t: number) => sec(Math.floor(t / size) * size),
      spec = focus ? SPECS.get(focus.id) : undefined;
    // Where the selected strategy fired: arrow up = Compra, arrow down = Venda, with the expiry.
    // Strategies that failed the test are drawn faded and marked "estudo": not a signal.
    if (showTriggers && spec && focus && bars.length > 300) {
      const s = buildSeries(bars.slice(0, -1)),
        from = Math.max(300, s.c.length - 400 * tf),
        fade = (c: string) => (focus.approved ? c : `${c}80`),
        hits: { i: number; d: 1 | -1 }[] = [];
      // Same spacing as the backtest: no new entry while one is still open.
      for (let i = from, next = from; i < s.c.length; i++) {
        if (i < next) continue;
        const d = spec.signal(s, i);
        if (!d) continue;
        hits.push({ i, d });
        next = i + Math.max(focus.horizon, 5);
      }
      // Labels only where they don't pile on each other (newest first, up to 6).
      const named = new Set<number>(),
        taken = [...signals, ...(data?.signals || [])].map(
          (x) => (x.entryAt ?? x.t) / 60000,
        ),
        near = (i: number) =>
          taken.some((m) => Math.abs(m - s.t[i] / 60000) < 12 * tf);
      for (
        let k = hits.length - 1, gap = Infinity;
        k >= 0 && named.size < 6;
        k--
      )
        if (gap - hits[k].i >= 12 * tf && !near(hits[k].i)) {
          named.add(k);
          gap = hits[k].i;
        }
      hits.forEach(({ i, d }, k) => {
        const buy = d === 1;
        out.push({
          time: bucket(s.t[i]),
          position: buy ? "belowBar" : "aboveBar",
          shape: buy ? "arrowUp" : "arrowDown",
          size: focus.approved ? 0.8 : 0.6,
          color: fade(buy ? pal.current.up : pal.current.down),
          text: named.has(k)
            ? `${buy ? "Compra" : "Venda"} ${focus.horizon}m${focus.approved ? "" : " · estudo"}`
            : undefined,
        });
      });
    }
    const first = bars[0]?.t ?? 0;
    for (const s of new Map(
      [...(data?.signals || []), ...signals].map((s) => [s.id, s]),
    ).values()) {
      if (s.symbol !== symbol || !["FILLED", "SETTLED"].includes(s.status))
        continue;
      if ((s.entryAt ?? s.t) < first) continue;
      const buy = s.direction === "COMPRA";
      out.push({
        time: bucket(s.entryAt ?? s.t),
        position: buy ? "belowBar" : "aboveBar",
        shape: buy ? "arrowUp" : "arrowDown",
        color: buy ? pal.current.up : pal.current.down,
        size: 1,
        text: `${buy ? "Compra" : "Venda"} ${s.horizon}m`,
      });
      if (s.status === "SETTLED" && s.exitAt)
        out.push({
          time: bucket(s.exitAt),
          position: "inBar",
          shape: "square",
          color: s.result === "WIN" ? pal.current.blue : pal.current.muted,
          text:
            s.result === "WIN"
              ? "Ganhou"
              : s.result === "LOSS"
                ? "Perdeu"
                : "Neutro",
        });
    }
    for (const r of robotTrades) {
      if (r.symbol !== symbol || r.openedAt < first) continue;
      const buy = r.direction === "COMPRA";
      out.push({
        time: bucket(r.openedAt),
        position: buy ? "belowBar" : "aboveBar",
        shape: buy ? "arrowUp" : "arrowDown",
        color: buy ? pal.current.up : pal.current.down,
        size: r.status === "ABERTA" ? 1.2 : 0.7,
        // Only the open trade is labelled; past entries stay as small arrows.
        text:
          r.status === "ABERTA"
            ? `Robô ${buy ? "compra" : "venda"} ${r.horizon}m`
            : undefined,
      });
      if (r.status === "FECHADA" && r.closedAt)
        out.push({
          time: bucket(r.closedAt),
          position: "inBar",
          shape: "square",
          color: r.result === "WIN" ? pal.current.blue : pal.current.muted,
          size: 0.5,
          text: r.result === "WIN" ? "✓" : r.result === "LOSS" ? "✗" : "=",
        });
    }
    // Candle patterns: only the recent ones (dots all over the history hid the candles), the
    // name on the newest three that have room.
    if (studies.has("candle")) {
      const marks = candleMarks(bars, tf, 30);
      let room = Infinity,
        names = 0;
      for (let k = marks.length - 1; k >= 0; k--) {
        const { t, hit } = marks[k],
          named = names < 3 && (room - t) / (tf * 60000) >= 10;
        if (named) {
          room = t;
          names++;
        }
        out.push({
          time: bucket(t),
          position: hit.bias > 0 ? "belowBar" : "aboveBar",
          shape: "circle",
          size: 0.4,
          color: hit.bias > 0 ? pal.current.patternUp : pal.current.patternDown,
          text: named ? hit.name : undefined,
        });
      }
    }
    const seen = new Set<string>();
    const unique = out.filter((m) => {
      const k = `${m.time}${m.shape}${m.text ?? ""}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    unique.sort((a, b) => Number(a.time) - Number(b.time));
    markers.current.setMarkers(unique);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    data,
    focus,
    signalsKey,
    minute,
    tf,
    theme,
    showTriggers,
    robotTrades,
    studies,
  ]);
  // Entry price of the robot's open trade on this asset.
  const robotLine = useRef<IPriceLine | undefined>(undefined),
    openTrade = robotTrades.find(
      (r) => r.symbol === symbol && r.status === "ABERTA",
    );
  useEffect(() => {
    const c = candles.current;
    if (!c) return;
    if (robotLine.current) c.removePriceLine(robotLine.current);
    robotLine.current = undefined;
    if (!openTrade) return;
    const buy = openTrade.direction === "COMPRA";
    robotLine.current = c.createPriceLine({
      price: openTrade.entry,
      color: buy ? pal.current.up : pal.current.down,
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: `Robô ${buy ? "compra" : "venda"} ${openTrade.horizon}m`,
    });
  }, [openTrade?.id, theme, data]);
  // The support and resistance the robot is reading (1-minute swings).
  const robotSr = useRef<IPriceLine[]>([]);
  useEffect(() => {
    const c = candles.current;
    if (!c) return;
    for (const l of robotSr.current) c.removePriceLine(l);
    robotSr.current = [];
    const add = (v: number | null | undefined, title: string, color: string) =>
      v != null &&
      robotSr.current.push(
        c.createPriceLine({
          price: v,
          color,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title,
        }),
      );
    add(robotLevels?.support, "Robô S", pal.current.up);
    add(robotLevels?.resistance, "Robô R", pal.current.down);
  }, [robotLevels?.support, robotLevels?.resistance, theme, data]);
  const patternSr = useRef<IPriceLine[]>([]);
  useEffect(() => {
    const c = candles.current;
    if (!c) return;
    for (const l of patternSr.current) c.removePriceLine(l);
    patternSr.current = [];
    const p = patternLevels;
    if (!p) return;
    const color =
      p.bias > 0
        ? pal.current.up
        : p.bias < 0
          ? pal.current.down
          : pal.current.muted;
    const add = (v: number | null, title: string, style: LineStyle) =>
      v != null &&
      patternSr.current.push(
        c.createPriceLine({
          price: v,
          color,
          lineWidth: 2,
          lineStyle: style,
          axisLabelVisible: true,
          title,
        }),
      );
    add(p.level, `${p.name}: rompe`, LineStyle.Solid);
    add(p.target, "Alvo", LineStyle.Dashed);
    add(p.invalid, "Invalida", LineStyle.SparseDotted);
  }, [
    patternLevels?.id,
    patternLevels?.level,
    patternLevels?.target,
    patternLevels?.invalid,
    theme,
    data,
  ]);
  // Fibonacci of the latest meaningful swing. Only draw it when the visible
  // structure has a clear directional leg; a sideways chart should not invent Fib levels.
  useEffect(() => {
    const cs = candles.current;
    if (!cs) return;
    for (const l of fibLines.current) cs.removePriceLine(l);
    fibLines.current = [];
    if (!studies.has("fib")) return;
    const bars = view.current.slice(0, -1).slice(-180);
    if (bars.length < 30) return;
    const s = buildSeries(bars), j = s.c.length - 1, ctx = priceContext(s, j);
    if (!ctx.trend) return;
    let hi = 0, lo = 0;
    for (let i = 1; i < bars.length; i++) {
      if (bars[i].h > bars[hi].h) hi = i;
      if (bars[i].l < bars[lo].l) lo = i;
    }
    const up = ctx.trend === 1, valid = up ? lo < hi : hi < lo;
    if (!valid) return;
    const high = bars[hi].h, low = bars[lo].l, range = high - low;
    if (!(range > 0)) return;
    const levels = [0, .236, .382, .5, .618, .786, 1];
    fibLines.current = levels.map((f) => {
      const v = up ? high - range * f : low + range * f;
      return cs.createPriceLine({
        price: v,
        color: f === .382 || f === .5 || f === .618 ? pal.current.orange : pal.current.crosshair,
        lineWidth: f === .382 || f === .5 || f === .618 ? 2 : 1,
        lineStyle: f === .5 ? LineStyle.Solid : LineStyle.Dashed,
        axisLabelVisible: true,
        title: `Fib ${(f * 100).toFixed(1).replace(".0","")}%`,
      });
    });
  }, [minute, tf, studies, theme, data]);

  // Support/resistance of the visible timeframe as price lines, plus the market reading.
  useEffect(() => {
    const c = candles.current;
    if (!c) return;
    for (const l of srLines.current) c.removePriceLine(l);
    srLines.current = [];
    const bars = view.current.slice(0, -1);
    if (bars.length < 80) {
      setReading(null);
      return;
    }
    const s = buildSeries(bars.slice(-600)),
      j = s.c.length - 1,
      last = s.c[j],
      all = levelsAt(s, j, 12),
      near = (k: "sup" | "res") =>
        all
          .filter((x) => x.kind === k)
          .sort((a, b) => Math.abs(a.price - last) - Math.abs(b.price - last))
          .slice(0, 2),
      sups = near("sup"),
      ress = near("res");
    const ctx = priceContext(s, j);
    setReading({
      trend: ctx.trend,
      range: ctx.range,
      sup: sups[0]?.price,
      res: ress[0]?.price,
    });
    if (!studies.has("sr")) return;
    srLines.current = [...sups, ...ress].map((x) =>
      c.createPriceLine({
        price: x.price,
        color:
          (x.kind === "sup" ? pal.current.up : pal.current.down) +
          (x.touches >= 3 ? "" : "b3"),
        lineWidth: x.touches >= 3 ? 3 : 2,
        lineStyle: x.touches >= 3 ? LineStyle.Solid : LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${x.kind === "sup" ? "Suporte" : "Resistência"} ${x.touches}x`,
      }),
    );
  }, [minute, tf, studies, theme, data]);
  const toggle = (s: Study) =>
    setStudies((x) => {
      const n = new Set(x);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      return n;
    });
  const lg = legend,
    up = lg ? lg.bar.c >= lg.bar.o : true,
    diff = lg ? lg.bar.c - lg.prev : 0,
    label = (s: Study) =>
      s === "rsi"
        ? `RSI ${p.rsi}`
        : s === "bb"
          ? `Bandas de Bollinger 20 ${String(p.bb).replace(".", ",")}`
          : s === "ema"
            ? "Médias móveis 9, 21, 50"
            : s === "vwap"
              ? "VWAP"
              : s === "sr"
                ? "Suporte e resistência"
                : s === "trend"
                  ? "LTA / LTB"
                  : s === "fib"
                    ? "Fibonacci"
                    : "Volume";
  return (
    <div className="tv-chart">
      <div className="tv-toolbar" role="toolbar" aria-label="Gráfico">
        {head}
        <span className="tv-sep" />
        {FRAMES.map((f) => (
          <button
            key={f}
            className={`tv-btn ${tf === f ? "on" : ""}`}
            aria-pressed={tf === f}
            onClick={() => setTf(f)}
          >
            M{f}
          </button>
        ))}
        <span className="tv-sep" />
        <div className="tv-menu-wrap">
          <button
            className={`tv-btn ${menu ? "on" : ""}`}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <LineChart size={16} /> <span>Indicadores</span>
            <ChevronDown size={14} />
          </button>
          {menu && (
            <div className="tv-menu" role="menu">
              {STUDIES.map((s) => (
                <button
                  key={s.id}
                  role="menuitemcheckbox"
                  aria-checked={studies.has(s.id)}
                  onClick={() => toggle(s.id)}
                >
                  <span className="tv-check">
                    {studies.has(s.id) && <Check size={14} />}
                  </span>
                  {label(s.id)}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          className={`tv-btn ${showTriggers ? "on" : ""}`}
          aria-pressed={showTriggers}
          title="Gatilhos históricos de pesquisa; não são entradas emitidas"
          onClick={() => setShowTriggers(!showTriggers)}
        >
          Gatilhos
        </button>
        {onExpand && (
          <button
            className="tv-btn fullscreen-toggle"
            data-fullscreen-toggle
            aria-label={expanded ? "Sair da tela cheia" : "Tela cheia"}
            aria-pressed={expanded}
            onClick={onExpand}
            title={expanded ? "Sair da tela cheia (Esc)" : "Tela cheia"}
          >
            {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        )}
        <span className="tv-clock" title="Tempo até o candle atual fechar">
          {left}
        </span>
      </div>
      <div className="tv-stage" onClick={() => menu && setMenu(false)}>
        <div className="chart-canvas" ref={host} />
        {lg && (
          <div className="tv-legend">
            <div className="tv-row tv-title">
              <b>
                {title} · {tf} · Yosh
              </b>
              <span>
                A<em className={up ? "up" : "down"}>{price(lg.bar.o)}</em>
              </span>
              <span>
                M<em className={up ? "up" : "down"}>{price(lg.bar.h)}</em>
              </span>
              <span>
                m<em className={up ? "up" : "down"}>{price(lg.bar.l)}</em>
              </span>
              <span>
                F<em className={up ? "up" : "down"}>{price(lg.bar.c)}</em>
              </span>
              <em className={diff >= 0 ? "up" : "down"}>
                {diff >= 0 ? "+" : ""}
                {price(diff)} ({diff >= 0 ? "+" : ""}
                {pct(lg.prev ? diff / lg.prev : 0, 2)})
              </em>
            </div>
            {studies.has("ema") && (
              <div className="tv-row">
                <span>EMA 9 21 50</span>
                <em style={{ color: C.ema9 }}>{price(lg.ema9)}</em>
                <em style={{ color: C.ema21 }}>{price(lg.ema21)}</em>
                <em style={{ color: C.ema50 }}>{price(lg.ema50)}</em>
              </div>
            )}
            {studies.has("bb") && (
              <div className="tv-row">
                <span>BB 20 {String(p.bb).replace(".", ",")}</span>
                <em style={{ color: C.orange }}>{price(lg.bbMid)}</em>
                <em style={{ color: C.bb }}>{price(lg.bbUp)}</em>
                <em style={{ color: C.bb }}>{price(lg.bbDn)}</em>
              </div>
            )}
            {studies.has("vwap") && (
              <div className="tv-row">
                <span>VWAP</span>
                <em style={{ color: C.vwap }}>{price(lg.vwap)}</em>
              </div>
            )}
            {studies.has("rsi") && (
              <div className="tv-row">
                <span>RSI {p.rsi}</span>
                <em style={{ color: C.rsi }}>{n2(lg.rsi)}</em>
              </div>
            )}
            {studies.has("vol") && (
              <div className="tv-row">
                <span>Vol</span>
                <em className={up ? "up" : "down"}>
                  {lg.bar.v.toLocaleString("pt-BR", {
                    maximumFractionDigits: 2,
                  })}
                </em>
              </div>
            )}
          </div>
        )}
        <div className="tv-notes">
          {reading && (
            <div
              className={`tv-read ${reading.trend === 1 ? "up" : reading.trend === -1 ? "down" : ""}`}
            >
              <b>
                {reading.trend === 1
                  ? "Tendência de alta"
                  : reading.trend === -1
                    ? "Tendência de baixa"
                    : reading.range
                      ? "Mercado lateral"
                      : "Sem tendência clara"}
              </b>
              <span>
                {reading.trend === 1
                  ? reading.sup
                    ? `Melhor compra perto do suporte ${price(reading.sup)}. Evite vender.`
                    : "Prefira compras. Evite vender."
                  : reading.trend === -1
                    ? reading.res
                      ? `Melhor venda perto da resistência ${price(reading.res)}. Evite comprar.`
                      : "Prefira vendas. Evite comprar."
                    : reading.range && reading.sup && reading.res
                      ? `Compra perto de ${price(reading.sup)}, venda perto de ${price(reading.res)}. No meio, não entre.`
                      : "Melhor esperar. O sistema não entra agora."}
              </span>
            </div>
          )}
          {focus && (
            <div className="tv-focus">
              <i className={focus.approved ? "ok" : ""} />
              {focus.label} · {focus.horizon} min ·{" "}
              {pct(focus.outOfSample.winRate)} no teste
              {!focus.approved && <em>reprovada: setas são só estudo</em>}
            </div>
          )}
        </div>
        {!data && !error && (
          <div className="chart-note" role="status" aria-live="polite">
            Carregando {title}…
          </div>
        )}
        {error && (
          <div className="chart-note" role="status">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
