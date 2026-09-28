import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.js';
import {SQLiteConnection} from '../src/database.js';
import {DatabaseSync} from 'node:sqlite';
test('Arquivo persiste após reinício, backup é consistente e coletor concorrente é bloqueado',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'scanner-persist-')); const path=join(dir,'scanner.sqlite');
 let store=new Store(path);
 try {
 await store.init();
 await store.snapshot({symbol:'BTCUSDT',t:1000,eventT:1000,quoteT:1000,price:100,bid:99,ask:101,volume:4,volatility:.01});
 const second=new Store(path);
 try {await assert.rejects(second.init(),/Outro coletor/);} finally {await second.close();}
 await store.pool.backupTo(join(dir,'backup.sqlite'));
 const copy=new DatabaseSync(join(dir,'backup.sqlite'),{readOnly:true});
 assert.equal(copy.prepare('SELECT count(*) AS n FROM snapshots').get()!.n,1); copy.close();
 assert.throws(()=>store.pool.transaction(()=>{store.pool.query("INSERT INTO snapshots VALUES('ETHUSDT',1,1,1,1,1,1,1,1)");throw Error('abort');}),/abort/);
 assert.equal(store.pool.query('SELECT count(*) AS n FROM snapshots').rows[0]!.n,1);
 await store.close(); store=new Store(path); await store.init();
 assert.equal((await store.nearest('BTCUSDT',1000))?.price,100);
 } finally {await store.close();await rm(dir,{recursive:true,force:true});}
});
test('Schema desconhecido não é modificado',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'scanner-unknown-'));const path=join(dir,'old.sqlite');
 const db=new SQLiteConnection(path);db.exec('CREATE TABLE old_data(x TEXT)');await db.end();
 const store=new Store(path);
 try {await assert.rejects(store.init(),/schema desconhecido/);assert.equal(store.pool.query("SELECT name FROM sqlite_master WHERE name='old_data'").rowCount,1);} finally {await store.close();await rm(dir,{recursive:true,force:true});}
});
