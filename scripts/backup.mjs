import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const source = process.env.SQLITE_PATH || './data/scanner.sqlite';
const target = process.argv[2] || `./backups/scanner-${Date.now()}.sqlite`;
if (!existsSync(source)) throw Error('Banco não existe: inicie o scanner primeiro');
if (resolve(source) === resolve(target) || existsSync(target)) throw Error('Escolha um novo caminho para backup');
mkdirSync(dirname(resolve(target)), {recursive:true});
const db = new DatabaseSync(source, {readOnly:true});
try { await backup(db,target); console.log(`Backup consistente salvo em ${target}`); } finally {db.close();}
