import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { api, pct, price } from "./format";
import type { CandleData } from "./types";
const sec = (t: number) => Math.floor(t / 1000) as UTCTimestamp;
const hhmm = (t: number) =>
  new Date(t * 1000).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
// Real 1-minute candles with paper-signal entries/results and strategy triggers drawn on top.
export default function CandleChart({
  symbol,
  live,
  showAll,
}: {
  symbol: string;
  live: number | null;
  showAll: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    chart = useRef<IChartApi | undefined>(undefined),
    series = useRef<ISeriesApi<"Candlestick"> | undefined>(undefined),
    markers = useRef<ISeriesMarkersPluginApi<Time> | undefined>(undefined),
    lastBar = useRef<
      | {
          time: UTCTimestamp;
          open: number;
          high: number;
          low: number;
          close: number;
        }
      | undefined
    >(undefined);
  const [data, setData] = useState<CandleData | null>(null),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const el = host.current!;
    const c = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8C93BF",
        fontFamily: "Sora Variable, system-ui, sans-serif",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(40,48,100,.45)" },
        horzLines: { color: "rgba(40,48,100,.45)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#283064" },
      timeScale: {
        borderColor: "#283064",
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (t: Time) => hhmm(Number(t)),
      },
      localization: {
        timeFormatter: (t: Time) => hhmm(Number(t)),
        locale: "pt-BR",
      },
    });
    const s = c.addSeries(CandlestickSeries, {
      upColor: "#2BD9A8",
      downColor: "#FF5C7A",
      borderVisible: false,
      wickUpColor: "#2BD9A8",
      wickDownColor: "#FF5C7A",
      priceFormat: {
        type: "custom",
        formatter: (p: number) => price(p),
        minMove: 0.00001,
      },
    });
    chart.current = c;
    series.current = s;
    markers.current = createSeriesMarkers(s, []);
    return () => {
      c.remove();
      chart.current = undefined;
    };
  }, []);
  useEffect(() => {
    let stop = false,
      first = true;
    setData(null);
    const load = async () => {
      try {
        const d = await api<CandleData>(`/api/candles/${symbol}`);
        if (stop) return;
        setData(d);
        setError(null);
        const bars = d.candles.map((k) => ({
          time: sec(k.t),
          open: k.o,
          high: k.h,
          low: k.l,
          close: k.c,
        }));
        series.current?.setData(bars);
        lastBar.current = bars[bars.length - 1];
        if (first) {
          chart.current?.timeScale().setVisibleLogicalRange({
            from: Math.max(0, bars.length - 90),
            to: bars.length + 4,
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
    const timer = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [symbol]);
  // Live trade price moves the forming candle between refreshes.
  useEffect(() => {
    const b = lastBar.current;
    if (!b || live == null || !series.current) return;
    const next = {
      ...b,
      close: live,
      high: Math.max(b.high, live),
      low: Math.min(b.low, live),
    };
    lastBar.current = next;
    series.current.update(next);
  }, [live]);
  useEffect(() => {
    if (!data || !markers.current) return;
    const out: SeriesMarker<Time>[] = [];
    const minute = (t: number) => sec(Math.floor(t / 60000) * 60000);
    for (const tr of data.triggers)
      if (showAll || tr.approved)
        out.push({
          time: sec(tr.t),
          position: tr.direction === "COMPRA" ? "belowBar" : "aboveBar",
          shape: "circle",
          size: 0.6,
          color: tr.approved
            ? tr.direction === "COMPRA"
              ? "#2BD9A8"
              : "#FF5C7A"
            : "rgba(140,147,191,.55)",
          text: showAll ? pct(tr.winRate, 0) : "",
        });
    for (const s of data.signals) {
      const buy = s.direction === "COMPRA";
      out.push({
        time: minute(s.entryAt ?? s.t),
        position: buy ? "belowBar" : "aboveBar",
        shape: buy ? "arrowUp" : "arrowDown",
        color: buy ? "#2BD9A8" : "#FF5C7A",
        size: 1.6,
        text: `${buy ? "Compra" : "Venda"} ${s.horizon}m`,
      });
      if (s.status === "SETTLED" && s.exitAt)
        out.push({
          time: minute(s.exitAt),
          position: "inBar",
          shape: "square",
          color:
            s.result === "WIN"
              ? "#F5B83D"
              : s.result === "LOSS"
                ? "#8C93BF"
                : "#5B6394",
          text:
            s.result === "WIN"
              ? "Ganhou"
              : s.result === "LOSS"
                ? "Perdeu"
                : "Empate",
        });
    }
    out.sort((a, b) => Number(a.time) - Number(b.time));
    markers.current.setMarkers(out);
  }, [data, showAll]);
  return (
    <div className="chart-wrap">
      <div className="chart-canvas" ref={host} />
      {!data && !error && <div className="chart-note">Carregando candles…</div>}
      {error && <div className="chart-note">{error}</div>}
    </div>
  );
}
