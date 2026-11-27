import WebSocket from "ws";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { encodeEvent, encodePong, parseMessage } from "./protocol.js";
import { log } from "../log.js";
export class QuotexClient extends EventEmitter {
    opts;
    ws = null;
    pingTimer = null;
    authorized = false;
    pendingOrders = new Map();
    assets = new Map();
    candles = new Map();
    balance = 0;
    reconnectCount = 0;
    constructor(opts) {
        super();
        this.opts = opts;
    }
    get isConnected() {
        return this.ws?.readyState === WebSocket.OPEN && this.authorized;
    }
    get currentBalance() {
        return this.balance;
    }
    getAssets() {
        return [...this.assets.values()];
    }
    getCandles(asset) {
        return this.candles.get(asset) || [];
    }
    async connect() {
        return new Promise((resolve, reject) => {
            const url = `wss://ws2.${this.opts.host}/socket.io/?EIO=3&transport=websocket`;
            log.info({ url }, "quotex: connecting");
            this.ws = new WebSocket(url, {
                headers: {
                    "User-Agent": this.opts.userAgent,
                    Origin: `https://${this.opts.host}`,
                    Cookie: this.opts.cookies,
                },
            });
            const timeout = setTimeout(() => {
                reject(new Error("Connection timeout"));
                this.ws?.close();
            }, 15000);
            this.ws.on("open", () => {
                log.info("quotex: ws connected");
            });
            this.ws.on("message", (data) => {
                const raw = data.toString();
                const msg = parseMessage(raw);
                switch (msg.type) {
                    case "open": {
                        // Server sends ping interval in the open packet
                        const info = msg.data;
                        const interval = info?.pingInterval || 25000;
                        this.startPing(interval);
                        // Send authorization
                        this.send(encodeEvent("authorization", {
                            session: this.opts.ssid,
                            isDemo: this.opts.isDemo ? 1 : 0,
                            tournamentId: 0,
                        }));
                        break;
                    }
                    case "ping":
                        this.ws?.send(encodePong());
                        break;
                    case "event":
                        this.handleEvent(msg.event, msg.data);
                        break;
                }
                // Check for auth success
                if (raw.includes("s_authorization") && !this.authorized) {
                    this.authorized = true;
                    this.reconnectCount = 0;
                    clearTimeout(timeout);
                    log.info("quotex: authorized");
                    resolve();
                }
                if (raw.includes("authorization/reject")) {
                    clearTimeout(timeout);
                    reject(new Error("Authorization rejected — check SSID"));
                }
            });
            this.ws.on("close", (code, reason) => {
                this.authorized = false;
                this.stopPing();
                log.warn({ code, reason: reason.toString() }, "quotex: ws closed");
                this.emit("disconnected", code);
                this.maybeReconnect();
            });
            this.ws.on("error", (err) => {
                log.error({ err: err.message }, "quotex: ws error");
            });
        });
    }
    disconnect() {
        this.stopPing();
        this.authorized = false;
        for (const [id, p] of this.pendingOrders) {
            clearTimeout(p.timer);
            p.reject(new Error("Disconnected"));
        }
        this.pendingOrders.clear();
        this.ws?.close();
        this.ws = null;
    }
    send(msg) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(msg);
        }
    }
    startPing(interval) {
        this.stopPing();
        this.pingTimer = setInterval(() => {
            this.send("2");
        }, interval);
    }
    stopPing() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
    }
    async maybeReconnect() {
        if (this.reconnectCount >= 5) {
            log.error("quotex: max reconnect attempts");
            this.emit("fatal", new Error("Max reconnect attempts"));
            return;
        }
        this.reconnectCount++;
        const delay = Math.min(2000 * 2 ** this.reconnectCount, 30000);
        log.info({ delay, attempt: this.reconnectCount }, "quotex: reconnecting");
        await new Promise((r) => setTimeout(r, delay));
        try {
            await this.connect();
            this.emit("reconnected");
        }
        catch (err) {
            log.error({ err }, "quotex: reconnect failed");
        }
    }
    // --- Event handlers ---
    handleEvent(event, data) {
        switch (event) {
            case "assets":
                this.handleAssets(data);
                break;
            case "candles":
            case "candle-generated":
                this.handleCandle(data);
                break;
            case "profit-close-order":
            case "orders/close":
                this.handleOrderResult(data);
                break;
            case "balance-changed":
                if (typeof data === "number")
                    this.balance = data;
                else if (data?.currentBalance != null)
                    this.balance = data.currentBalance;
                this.emit("balance", this.balance);
                break;
            case "instruments/update":
                this.handleInstrumentUpdate(data);
                break;
            default:
                // Many events we don't need to handle
                break;
        }
    }
    handleAssets(data) {
        if (!data || typeof data !== "object")
            return;
        // Data can be an array or object keyed by ID
        const items = Array.isArray(data) ? data : Object.values(data);
        for (const a of items) {
            if (a?.id != null) {
                this.assets.set(a.id, {
                    id: a.id,
                    name: a.name || a.symbol || `asset_${a.id}`,
                    payout: (a.profit || a.payout || 0) / 100,
                    isOpen: a.is_open ?? a.isOpen ?? true,
                    isSuspended: a.is_suspended ?? a.isSuspended ?? false,
                });
            }
        }
        this.emit("assets", this.getAssets());
    }
    handleInstrumentUpdate(data) {
        if (!data)
            return;
        const id = data.id ?? data.asset_id;
        const existing = this.assets.get(id);
        if (existing) {
            if (data.profit != null)
                existing.payout = data.profit / 100;
            if (data.is_open != null)
                existing.isOpen = data.is_open;
            if (data.is_suspended != null)
                existing.isSuspended = data.is_suspended;
        }
    }
    handleCandle(data) {
        if (!data)
            return;
        const asset = data.asset || data.symbol || data.id;
        if (!asset)
            return;
        const candle = {
            t: (data.time || data.t || 0) * 1000,
            o: data.open ?? data.o ?? 0,
            h: data.high ?? data.h ?? 0,
            l: data.low ?? data.l ?? 0,
            c: data.close ?? data.c ?? 0,
        };
        const key = String(asset);
        let arr = this.candles.get(key);
        if (!arr) {
            arr = [];
            this.candles.set(key, arr);
        }
        // Append or update last candle
        if (arr.length > 0 && arr[arr.length - 1].t === candle.t) {
            arr[arr.length - 1] = candle;
        }
        else {
            arr.push(candle);
            if (arr.length > 500)
                arr.splice(0, arr.length - 500);
        }
        this.emit("candle", { asset: key, candle, history: arr });
    }
    handleOrderResult(data) {
        if (!data)
            return;
        const id = data.requestId || data.request_id || data.id || data.order_id;
        const pending = this.pendingOrders.get(id);
        if (pending) {
            clearTimeout(pending.timer);
            this.pendingOrders.delete(id);
            const profit = data.profit ?? data.amount ?? 0;
            const win = profit > 0;
            const result = {
                id,
                asset: pending.order.asset,
                direction: pending.order.direction,
                amount: pending.order.amount,
                openPrice: data.open_price ?? data.openPrice ?? 0,
                closePrice: data.close_price ?? data.closePrice ?? 0,
                profit,
                win,
                openedAt: pending.order.openedAt,
                closedAt: Date.now(),
            };
            pending.resolve(result);
            this.emit("trade-result", result);
        }
    }
    // --- Trading actions ---
    async buy(assetId, assetName, direction, amount, expiration) {
        if (!this.isConnected)
            throw new Error("Not connected");
        const requestId = randomUUID();
        const action = direction === "call" ? "call" : "put";
        // Apply settings first
        this.send(encodeEvent("settings/apply"));
        // Send tick
        this.send(encodeEvent("tick"));
        // Place order
        this.send(encodeEvent("orders/open", {
            asset: assetId,
            amount,
            time: expiration,
            action,
            isDemo: this.opts.isDemo ? 1 : 0,
            tournamentId: 0,
            requestId,
            optionType: 100, // TIMER mode
        }));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingOrders.delete(requestId);
                reject(new Error(`Order timeout: ${assetName}`));
            }, (expiration + 30) * 1000);
            this.pendingOrders.set(requestId, {
                resolve,
                reject,
                timer,
                order: {
                    asset: assetName,
                    direction,
                    amount,
                    openedAt: Date.now(),
                },
            });
        });
    }
    /** Request asset list and candle history. */
    subscribeAsset(assetId, period = 60) {
        this.send(encodeEvent("subscribeMessage/instruments", { asset_id: assetId }));
        this.send(encodeEvent("history/load", {
            asset_id: assetId,
            period,
            offset: 0,
            count: 200,
        }));
    }
    requestAssets() {
        this.send(encodeEvent("instruments/update"));
    }
    requestBalance() {
        this.send(encodeEvent("balance"));
    }
}
