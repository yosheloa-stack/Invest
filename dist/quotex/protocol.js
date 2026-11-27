// Socket.IO v3 (Engine.IO v3) protocol handler for Quotex WebSocket.
// Message format: <eio_type>[<sio_type>][json_array]
// EIO types: 0=open, 1=close, 2=ping, 3=pong, 4=message, 5=upgrade, 6=noop
// SIO types (within EIO 4): 0=connect, 1=disconnect, 2=event, 3=ack
// Trade events are `42["event_name", {payload}]`
export function encodeEvent(event, data) {
    if (data !== undefined)
        return `42["${event}",${JSON.stringify(data)}]`;
    return `42["${event}"]`;
}
export function encodePong() {
    return "3";
}
export function parseMessage(raw) {
    if (!raw || raw.length === 0)
        return { type: "unknown", raw };
    const eioType = raw.charCodeAt(0) - 48;
    if (eioType === 0) {
        try {
            return { type: "open", data: JSON.parse(raw.slice(1)), raw };
        }
        catch {
            return { type: "open", raw };
        }
    }
    if (eioType === 2)
        return { type: "ping", raw };
    if (eioType === 3)
        return { type: "pong", raw };
    if (eioType === 4) {
        const rest = raw.slice(1);
        if (rest.length === 0)
            return { type: "unknown", raw };
        const sioType = rest.charCodeAt(0) - 48;
        if (sioType === 0)
            return { type: "connect", raw };
        if (sioType === 2 || sioType === 3) {
            const jsonStart = rest.indexOf("[");
            if (jsonStart === -1)
                return { type: sioType === 2 ? "event" : "ack", raw };
            let ackId;
            const between = rest.slice(1, jsonStart);
            if (between.length > 0)
                ackId = parseInt(between, 10);
            try {
                const arr = JSON.parse(rest.slice(jsonStart));
                if (Array.isArray(arr) && arr.length >= 1) {
                    return {
                        type: sioType === 2 ? "event" : "ack",
                        event: String(arr[0]),
                        data: arr.length > 1 ? arr[1] : undefined,
                        id: ackId,
                        raw,
                    };
                }
            }
            catch {
                // malformed JSON
            }
            return { type: sioType === 2 ? "event" : "ack", raw };
        }
    }
    return { type: "unknown", raw };
}
