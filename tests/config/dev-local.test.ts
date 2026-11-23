import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
it.each([
  'DATABASE_URL=private-test-value',
  'DATABASE_URL=postgres://fhdod_api:private-test-value@remote.example/fhdod_test\nDATABASE_URL_MIGRATIONS=postgres://admin@127.0.0.1:55440/fhdod_test',
  'DATABASE_URL=postgres://admin@127.0.0.1:55440/fhdod_test\nDATABASE_URL_MIGRATIONS=postgres://admin@127.0.0.1:55440/fhdod_test',
])('refuses unsafe development destinations before starting HTTP',configuration=>{
  const cwd=mkdtempSync(join(tmpdir(),'fhdod-dev-guard-'));
  try{writeFileSync(join(cwd,'.env.development.local'),configuration);
    const result=spawnSync(process.execPath,[resolve('scripts/dev-local.mjs')],{cwd,encoding:'utf8'});
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('development.local_database');
    expect(result.stderr).not.toContain('private-test-value');
  }finally{rmSync(cwd,{recursive:true,force:true});}
});
