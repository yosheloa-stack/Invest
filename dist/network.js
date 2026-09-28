import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { HttpsProxyAgent } from "https-proxy-agent";
// Respect deployment egress proxies; URLs and credentials are never logged.
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY)
    setGlobalDispatcher(new EnvHttpProxyAgent());
export const websocketAgent = process.env.HTTPS_PROXY
    ? new HttpsProxyAgent(process.env.HTTPS_PROXY)
    : undefined;
