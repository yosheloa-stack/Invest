import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { once } from 'node:events';
import { dashboardAuth } from '../src/auth.js';
test('HTTP exige senha e sessão autentica WebSocket; origem inválida é recusada', async () => {
 const auth = dashboardAuth('yosh', 'long-test-password', 'https://scanner.example');
 const app=express(); app.use(auth.middleware); app.get('/', (_,res)=>res.send('ok'));
 const server=createServer(app); const wss=new WebSocketServer({server, verifyClient: ({req}: {req: import("node:http").IncomingMessage})=>auth.authorized(req)&&auth.originAllowed(req)});
 wss.on('connection', ws=>ws.send('connected'));
 server.listen(0,'127.0.0.1'); await once(server,'listening');
 const addr=server.address() as {port:number}; const url=`http://127.0.0.1:${addr.port}`;
 try {
 assert.equal((await fetch(url)).status,401);
 const response=await fetch(url,{headers:{authorization:'Basic '+Buffer.from('yosh:long-test-password').toString('base64')}});
 assert.equal(response.status,200);
 const cookie=response.headers.get('set-cookie')!.split(';')[0]!;
 const ws=new WebSocket(url.replace('http:','ws:'),{headers:{cookie,origin:'https://scanner.example'}});
 const [msg]=await once(ws,'message'); assert.equal(String(msg),'connected'); ws.close(); await once(ws,'close');
 const bad=new WebSocket(url.replace('http:','ws:'),{headers:{cookie,origin:'https://attacker.example'}});
 const [err]=await once(bad,'error'); assert.match(String(err),/401/);
 assert.equal(auth.originAllowed({headers:{origin:'invalid'}} as any),false);
 assert.equal(auth.authorized({headers:{cookie:cookie+'forged'}} as any),false);
 } finally { wss.close(); server.closeAllConnections(); server.close(); }
});
