import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const source = process.argv[2];
const target = process.env.SQLITE_PATH || './data/scanner.sqlite';
if (!source || process.argv[3] !== '--confirm') throw Error('Pare o scanner e execute: npm run restore -- caminho/backup.sqlite --confirm');
if (!existsSync(source) || resolve(source) === resolve(target)) throw Error('Arquivo de backup inválido');
mkdirSync(dirname(resolve(target)),{recursive:true});
const lock = new DatabaseSync(target+'.collector-lock');
const db = new DatabaseSync(source,{readOnly:true});
try {
 lock.exec('PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS owner(id INTEGER); BEGIN EXCLUSIVE;');
 if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok' || db.prepare('PRAGMA user_version').get().user_version < 1 || db.prepare('PRAGMA user_version').get().user_version > 4) throw Error('Backup inválido/incompatível');
 for (const table of ['signals','snapshots','observations','news','outbox']) db.prepare(`SELECT * FROM ${table} LIMIT 0`).all();
 if (existsSync(target)) {
   const current = new DatabaseSync(target,{readOnly:true});
   try {await backup(current,target+`.before-restore-${Date.now()}.sqlite`);} finally {current.close();}
 }
 await backup(db,target);
 console.log('Banco restaurado; inicie o scanner. Backup anterior preservado.');
} finally { db.close(); lock.close(); }
