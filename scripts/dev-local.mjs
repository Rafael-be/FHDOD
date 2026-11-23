import { config } from 'dotenv';
import { spawn } from 'node:child_process';
config({ quiet: true });
const local = config({ path: '.env.development.local', override: true, quiet: true });
if (local.error) throw new Error('Crie .env.development.local com as conexões PostgreSQL locais. Consulte README.');
function connection(name) {
  try { return new URL(local.parsed?.[name] ?? ''); }
  catch { throw new Error(`Conexão local inválida em ${name}.`); }
}
for (const name of ['DATABASE_URL', 'DATABASE_URL_MIGRATIONS']) {
  const target = connection(name);
  if (!['localhost','127.0.0.1','[::1]'].includes(target.hostname) || target.pathname !== '/fhdod_test')
    throw new Error(`${name} precisa apontar explicitamente para fhdod_test local.`);
}
const runtime = connection('DATABASE_URL');
const migrations = connection('DATABASE_URL_MIGRATIONS');
if (runtime.host !== migrations.host || runtime.pathname !== migrations.pathname || runtime.username !== 'fhdod_api')
  throw new Error('As conexões locais devem usar o mesmo banco e runtime fhdod_api.');
console.log(JSON.stringify({event:'development.local_database',host:runtime.hostname,port:runtime.port||'5432',database:runtime.pathname.slice(1),role:runtime.username}));
const child = spawn(process.execPath, ['--import','tsx','src/server.ts'], {stdio:'inherit',env:process.env});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=> child.kill(signal));
child.on('exit',code=>{process.exitCode=code??1;});
