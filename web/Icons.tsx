import btc from "cryptocurrency-icons/svg/color/btc.svg";
import eth from "cryptocurrency-icons/svg/color/eth.svg";
import sol from "cryptocurrency-icons/svg/color/sol.svg";
import bnb from "cryptocurrency-icons/svg/color/bnb.svg";
import xrp from "cryptocurrency-icons/svg/color/xrp.svg";
import doge from "cryptocurrency-icons/svg/color/doge.svg";
import ada from "cryptocurrency-icons/svg/color/ada.svg";
import avax from "cryptocurrency-icons/svg/color/avax.svg";
import ltc from "cryptocurrency-icons/svg/color/ltc.svg";
import link from "cryptocurrency-icons/svg/color/link.svg";
import eur from "cryptocurrency-icons/svg/color/eur.svg";
import trx from "cryptocurrency-icons/svg/color/trx.svg";
import dot from "cryptocurrency-icons/svg/color/dot.svg";
import bch from "cryptocurrency-icons/svg/color/bch.svg";
import uni from "cryptocurrency-icons/svg/color/uni.svg";
import atom from "cryptocurrency-icons/svg/color/atom.svg";
import matic from "cryptocurrency-icons/svg/color/matic.svg";
import etc from "cryptocurrency-icons/svg/color/etc.svg";
import xlm from "cryptocurrency-icons/svg/color/xlm.svg";
import gbp from "cryptocurrency-icons/svg/color/gbp.svg";
import jpy from "cryptocurrency-icons/svg/color/jpy.svg";
import usd from "cryptocurrency-icons/svg/color/usd.svg";
// Forex pairs show the base currency's mark.
const FIAT: Record<string, string> = { EUR: eur, GBP: gbp, JPY: jpy, USD: usd };
// Official coin marks (cryptocurrency-icons, CC0).
const COINS: Record<string, string> = {
  BTCUSDT: btc,
  ETHUSDT: eth,
  SOLUSDT: sol,
  BNBUSDT: bnb,
  XRPUSDT: xrp,
  DOGEUSDT: doge,
  ADAUSDT: ada,
  AVAXUSDT: avax,
  LTCUSDT: ltc,
  LINKUSDT: link,
  EURUSDT: eur,
  TRXUSDT: trx,
  DOTUSDT: dot,
  BCHUSDT: bch,
  UNIUSDT: uni,
  ATOMUSDT: atom,
  POLUSDT: matic,
  ETCUSDT: etc,
  XLMUSDT: xlm,
};
export function CoinIcon({
  symbol,
  size = 20,
}: {
  symbol: string;
  size?: number;
}) {
  const src =
    COINS[symbol] ??
    (/^[A-Z]{6}$/.test(symbol) ? FIAT[symbol.slice(0, 3)] : undefined);
  if (!src)
    return (
      <span className="coin coin-blank" style={{ width: size, height: size }}>
        {symbol.slice(0, 1)}
      </span>
    );
  return (
    <img
      className="coin"
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
// Yosh Scanner mark: three candlesticks rising inside a rounded tile.
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="8" fill="#2962FF" />
      <g fill="#fff">
        <rect x="8.25" y="13" width="1.5" height="12" rx=".75" opacity=".7" />
        <rect x="6.5" y="16" width="5" height="6" rx="1.2" opacity=".7" />
        <rect x="15.25" y="9" width="1.5" height="15" rx=".75" opacity=".85" />
        <rect x="13.5" y="11" width="5" height="9" rx="1.2" opacity=".85" />
        <rect x="22.25" y="5" width="1.5" height="15" rx=".75" />
        <rect x="20.5" y="7" width="5" height="10" rx="1.2" />
      </g>
    </svg>
  );
}
