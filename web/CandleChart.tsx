import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
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
import { api, countdown, pct, price } from "./format";
import { liveBar, subscribe, lastServerTime } from "./live";
import {
  SPECS,
  STUDIES,
  params,
  series as buildSeries,
  studiesFor,
  type Bar,
  type Study,
} from "./studies";
import type { CandleData, Evaluation, Signal } from "./types";
const UP = "#1FD1A0",
  DOWN = "#F2546B",
  BRASS = "#D9A441",
  GRID = "rgba(120,140,180,.08)",
  AXIS = "#7D8AA6";
const sec = (t: number) => Math.floor(t / 1000) as UTCTimestamp;
const hhmm = (t: number) =>
  new Date(t * 1000).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
type Lines = {
  ema9: ISeriesApi<"Line">;
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
  rsi: number;
  ema9: number;
  ema21: number;
  ema50: number;
  vwap: number;
};
// Live 1-minute candles with the indicators the strategies read and the selected strategy's triggers.
export default function CandleChart({
  symbol,
  focus,
  signals,
}: {
  symbol: string;
  focus?: Evaluation;
  signals: Signal[];
}) {
  const host = useRef<HTMLDivElement>(null),
    chart = useRef<IChartApi | undefined>(undefined),
    candles = useRef<ISeriesApi<"Candlestick"> | undefined>(undefined),
    lines = useRef<Lines | undefined>(undefined),
    rsi = useRef<ISeriesApi<"Line"> | undefined>(undefined),
    rsiLevels = useRef<IPriceLine[]>([]),
    markers = useRef<ISeriesMarkersPluginApi<Time> | undefined>(undefined),
    hist = useRef<Bar[]>([]),
    shown = useRef<number | null>(null),
    anim = useRef(0);
  const [data, setData] = useState<CandleData | null>(null),
    [error, setError] = useState<string | null>(null),
    [legend, setLegend] = useState<Legend | null>(null),
    [hover, setHover] = useState(false),
    [left, setLeft] = useState("--:--"),
    [studies, setStudies] = useState<Set<Study>>(() => new Set(["ema", "vol"])),
    [minute, setMinute] = useState(0);
  const p = useMemo(() => params(focus?.id), [focus?.id]);
  // Selecting a strategy switches on the indicators it reads.
  useEffect(() => {
    const need = studiesFor(focus?.id);
    if (need.length)
      setStudies((s) => {
        const n = new Set(s);
        need.forEach((x) => n.add(x));
        return n;
      });
  }, [focus?.id]);
  useEffect(() => {
    const el = host.current!;
    const c = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: AXIS,
        fontFamily: "IBM Plex Sans, system-ui, sans-serif",
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: "#1E2A40", enableResize: false },
      },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#3A4A6B", labelBackgroundColor: "#1E2A40" },
        horzLine: { color: "#3A4A6B", labelBackgroundColor: "#1E2A40" },
      },
      rightPriceScale: {
        borderColor: "#1E2A40",
        scaleMargins: { top: 0.08, bottom: 0.12 },
      },
      timeScale: {
        borderColor: "#1E2A40",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: 8,
        tickMarkFormatter: (t: Time) => hhmm(Number(t)),
      },
      localization: {
        timeFormatter: (t: Time) => hhmm(Number(t)),
        locale: "pt-BR",
      },
    });
    const line = (color: string, width: 1 | 2 = 1, style = LineStyle.Solid) =>
      c.addSeries(LineSeries, {
        color,
        lineWidth: width,
        lineStyle: style,
        priceFormat: {
          type: "custom",
          formatter: (x: number) => price(x),
          minMove: 0.00001,
        },
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
      scaleMargins: { top: 0.82, bottom: 0 },
    });
    lines.current = {
      vol,
      bbUp: line("rgba(125,138,166,.55)"),
      bbMid: line("rgba(125,138,166,.35)", 1, LineStyle.Dotted),
      bbDn: line("rgba(125,138,166,.55)"),
      vwap: line(BRASS, 1, LineStyle.Dashed),
      ema50: line("rgba(230,236,245,.55)"),
      ema21: line("#A78BFA"),
      ema9: line("#5AB0FF"),
    };
    const s = c.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceLineColor: "#E6ECF5",
      priceLineStyle: LineStyle.Dashed,
      priceFormat: {
        type: "custom",
        formatter: (x: number) => price(x),
        minMove: 0.00001,
      },
    });
    chart.current = c;
    candles.current = s;
    markers.current = createSeriesMarkers(s, []);
    const move = (e: MouseEventParams<Time>) => {
      if (e.logical == null || !hist.current.length) {
        setHover(false);
        return;
      }
      setHover(true);
      setLegend(read(Math.min(hist.current.length - 1, Math.round(e.logical))));
    };
    c.subscribeCrosshairMove(move);
    return () => {
      c.unsubscribeCrosshairMove(move);
      cancelAnimationFrame(anim.current);
      c.remove();
      chart.current = undefined;
      candles.current = undefined;
      lines.current = undefined;
      rsi.current = undefined;
    };
  }, []);
  const read = (i: number): Legend | null => {
    const b = hist.current[i];
    if (!b) return null;
    const s = buildSeries(hist.current.slice(0, i + 1)),
      j = s.c.length - 1;
    return {
      bar: b,
      rsi: (p.rsi === 7 ? s.rsi7 : s.rsi14)[j],
      ema9: s.ema9[j],
      ema21: s.ema21[j],
      ema50: s.ema50[j],
      vwap: s.vwap[j],
    };
  };
  // RSI lives in its own pane, created only while it is switched on.
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    if (studies.has("rsi") && !rsi.current) {
      rsi.current = c.addSeries(
        LineSeries,
        {
          color: "#5AB0FF",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: true,
          priceFormat: {
            type: "custom",
            formatter: (x: number) => x.toFixed(0),
            minMove: 0.1,
          },
          autoscaleInfoProvider: () => ({
            priceRange: { minValue: 0, maxValue: 100 },
          }),
        },
        1,
      );
      c.panes()[1]?.setHeight(110);
    } else if (!studies.has("rsi") && rsi.current) {
      c.removeSeries(rsi.current);
      rsi.current = undefined;
      rsiLevels.current = [];
      if (c.panes().length > 1) c.removePane(1);
    }
    if (rsi.current) {
      for (const l of rsiLevels.current) rsi.current.removePriceLine(l);
      rsiLevels.current = [p.level, 100 - p.level].map((v) =>
        rsi.current!.createPriceLine({
          price: v,
          color: "rgba(217,164,65,.6)",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
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
    paintAll();
  }, [studies, p]);
  // Full redraw of indicators from history (on load, new minute, or settings change).
  const paintAll = () => {
    const L = lines.current,
      bars = hist.current;
    if (!L || bars.length < 2) return;
    const s = buildSeries(bars),
      at = (arr: Float64Array, extra?: (i: number) => number) =>
        bars.flatMap((b, i) => {
          const v = extra ? extra(i) : arr[i];
          return Number.isFinite(v) ? [{ time: sec(b.t), value: v }] : [];
        });
    L.ema9.setData(at(s.ema9));
    L.ema21.setData(at(s.ema21));
    L.ema50.setData(at(s.ema50));
    L.bbMid.setData(at(s.bbMid));
    L.bbUp.setData(at(s.bbMid, (i) => s.bbMid[i] + p.bb * s.bbStd[i]));
    L.bbDn.setData(at(s.bbMid, (i) => s.bbMid[i] - p.bb * s.bbStd[i]));
    L.vwap.setData(at(s.vwap));
    L.vol.setData(
      bars.map((b) => ({
        time: sec(b.t),
        value: b.v,
        color: b.c >= b.o ? "rgba(31,209,160,.28)" : "rgba(242,84,107,.28)",
      })),
    );
    rsi.current?.setData(at(p.rsi === 7 ? s.rsi7 : s.rsi14));
    if (!hover) setLegend(read(bars.length - 1));
  };
  // Only the last point moves on each tick.
  const paintLast = () => {
    const L = lines.current,
      bars = hist.current;
    if (!L || bars.length < 60) return;
    const tail = bars.slice(-400),
      s = buildSeries(tail),
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
    L.vol.update({
      time,
      value: b.v,
      color: b.c >= b.o ? "rgba(31,209,160,.28)" : "rgba(242,84,107,.28)",
    });
    if (rsi.current) put(rsi.current, (p.rsi === 7 ? s.rsi7 : s.rsi14)[j]);
    // VWAP resets daily, so it needs the whole day, not just the tail.
    if (studies.has("vwap")) {
      const d = Math.floor(b.t / 86400000);
      let pv = 0,
        vs = 0;
      for (let i = bars.length - 1; i >= 0; i--) {
        const x = bars[i];
        if (Math.floor(x.t / 86400000) !== d) break;
        pv += ((x.h + x.l + x.c) / 3) * x.v;
        vs += x.v;
      }
      put(L.vwap, vs ? pv / vs : b.c);
    }
    if (!hover) setLegend(read(bars.length - 1));
  };
  // Candle body glides to the new price instead of jumping.
  const glide = (b: Bar) => {
    cancelAnimationFrame(anim.current);
    const from = shown.current ?? b.c,
      start = performance.now(),
      dur = 220;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / dur),
        e = 1 - Math.pow(1 - k, 3),
        c = from + (b.c - from) * e;
      shown.current = c;
      candles.current?.update({
        time: sec(b.t),
        open: b.o,
        high: Math.max(b.h, c),
        low: Math.min(b.l, c),
        close: c,
      });
      if (k < 1) anim.current = requestAnimationFrame(step);
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches)
      step(start + dur);
    else anim.current = requestAnimationFrame(step);
  };
  // History load + resync once a minute (signals and results also come from here).
  useEffect(() => {
    let stop = false,
      first = true;
    setData(null);
    hist.current = [];
    shown.current = null;
    const load = async () => {
      try {
        const d = await api<CandleData>(`/api/candles/${symbol}?limit=1000`);
        if (stop) return;
        const bars: Bar[] = d.candles.map((k) => ({ ...k, buy: k.buy ?? 0 }));
        const live = liveBar(symbol);
        if (live && bars.length && live.t >= bars[bars.length - 1].t) {
          if (live.t === bars[bars.length - 1].t) bars[bars.length - 1] = live;
          else bars.push(live);
        }
        hist.current = bars;
        candles.current?.setData(
          bars.map((b) => ({
            time: sec(b.t),
            open: b.o,
            high: b.h,
            low: b.l,
            close: b.c,
          })),
        );
        shown.current = bars[bars.length - 1]?.c ?? null;
        paintAll();
        setData(d);
        setError(null);
        if (first) {
          const w = host.current?.clientWidth ?? 800;
          chart.current?.timeScale().setVisibleLogicalRange({
            from: Math.max(0, bars.length - (w < 600 ? 55 : 110)),
            to: bars.length + 5,
          });
          first = false;
        }
      } catch (e) {
        if (!stop)
          setError(
            e instanceof Error ? e.message : "Falha ao carregar candles",
          );
      }
    };
    void load();
    const timer = setInterval(load, 60000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [symbol]);
  // Real-time: every socket tick moves the forming candle; a new minute opens a new one.
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
          shown.current = b.o;
          setMinute(b.t);
        }
        glide(b);
        paintLast();
        const end = b.t + 60000,
          now = lastServerTime() || Date.now();
        setLeft(countdown(end - now));
      }),
    [symbol, p, studies, hover],
  );
  // Markers: the selected strategy's triggers on closed candles, plus paper entries and results.
  useEffect(() => {
    if (!markers.current) return;
    const out: SeriesMarker<Time>[] = [],
      bars = hist.current,
      spec = focus ? SPECS.get(focus.id) : undefined;
    if (spec && bars.length > 300) {
      const s = buildSeries(bars.slice(0, -1)),
        from = Math.max(300, s.c.length - 400);
      for (let i = from; i < s.c.length; i++) {
        const d = spec.signal(s, i);
        if (!d) continue;
        out.push({
          time: sec(s.t[i]),
          position: d === 1 ? "belowBar" : "aboveBar",
          shape: "circle",
          size: 0.7,
          color: focus!.approved ? (d === 1 ? UP : DOWN) : BRASS,
        });
      }
    }
    const minuteOf = (t: number) => sec(Math.floor(t / 60000) * 60000),
      first = bars[0]?.t ?? 0;
    for (const s of [...signals, ...(data?.signals || [])]) {
      if ((s.entryAt ?? s.t) < first) continue;
      const buy = s.direction === "COMPRA";
      out.push({
        time: minuteOf(s.entryAt ?? s.t),
        position: buy ? "belowBar" : "aboveBar",
        shape: buy ? "arrowUp" : "arrowDown",
        color: buy ? UP : DOWN,
        size: 1.5,
        text: `${buy ? "Compra" : "Venda"} ${s.horizon}m`,
      });
      if (s.status === "SETTLED" && s.exitAt)
        out.push({
          time: minuteOf(s.exitAt),
          position: "inBar",
          shape: "square",
          color: s.result === "WIN" ? BRASS : "#7D8AA6",
          text:
            s.result === "WIN"
              ? "Ganhou"
              : s.result === "LOSS"
                ? "Perdeu"
                : "Empate",
        });
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
  }, [data, focus, signals, minute]);
  const toggle = (s: Study) =>
    setStudies((x) => {
      const n = new Set(x);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      return n;
    });
  const lg = legend;
  const up = lg ? lg.bar.c >= lg.bar.o : true;
  return (
    <div className="chart">
      <div className="chart-tools" role="toolbar" aria-label="Indicadores">
        {STUDIES.map((s) => (
          <button
            key={s.id}
            className={`chip ${studies.has(s.id) ? "on" : ""} study-${s.id}`}
            aria-pressed={studies.has(s.id)}
            onClick={() => toggle(s.id)}
          >
            <i />
            {s.id === "rsi"
              ? `RSI ${p.rsi}`
              : s.id === "bb"
                ? `Bollinger ${String(p.bb).replace(".", ",")}`
                : s.label}
          </button>
        ))}
        <span
          className="candle-clock"
          title="Tempo até o candle de 1 minuto fechar"
        >
          Candle fecha em <b>{left}</b>
        </span>
      </div>
      {focus && (
        <div className="chart-focus">
          <i className={focus.approved ? "ok" : ""} />
          {focus.label} · {focus.horizon} min · {pct(focus.outOfSample.winRate)}{" "}
          no teste
        </div>
      )}
      <div className="chart-stage">
        <div className="chart-canvas" ref={host} />
        {lg && (
          <div className="chart-legend" aria-live="off">
            <span>
              A <b>{price(lg.bar.o)}</b>
            </span>
            <span>
              M <b>{price(lg.bar.h)}</b>
            </span>
            <span>
              m <b>{price(lg.bar.l)}</b>
            </span>
            <span>
              F <b className={up ? "up" : "down"}>{price(lg.bar.c)}</b>
            </span>
            {studies.has("ema") && (
              <>
                <span className="k-ema9">EMA9 {price(lg.ema9)}</span>
                <span className="k-ema21">EMA21 {price(lg.ema21)}</span>
                <span className="k-ema50">EMA50 {price(lg.ema50)}</span>
              </>
            )}
            {studies.has("vwap") && (
              <span className="k-vwap">VWAP {price(lg.vwap)}</span>
            )}
            {studies.has("rsi") && Number.isFinite(lg.rsi) && (
              <span className="k-rsi">
                RSI{p.rsi} {lg.rsi.toFixed(1).replace(".", ",")}
              </span>
            )}
          </div>
        )}
        {!data && !error && (
          <div className="chart-note">Carregando candles…</div>
        )}
        {error && <div className="chart-note">{error}</div>}
      </div>
    </div>
  );
}
