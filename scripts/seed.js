#!/usr/bin/env node
// Seeds a fresh D1 database and R2 bucket from a baseline backup zip.
// Usage: npm run seed [-- --env beta] [-- --file path/to/backup.zip]

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const JSZip = require('jszip');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, 'scripts', 'tmp');
const DB_NAME = 'waldensrevisited-db';
const R2_BUCKET = 'waldensrevisited-uploads';

function parseArgs() {
  const args = process.argv.slice(2);
  let env = '';
  let file = path.join(ROOT, 'data', 'baseline-backup.zip');
  let local = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--env' && args[i + 1]) { env = args[++i]; }
    else if (args[i] === '--file' && args[i + 1]) { file = path.resolve(args[++i]); }
    else if (args[i] === '--local') { local = true; }
  }
  return { env, file, local };
}

function run(cmd) {
  console.log(`  $ ${cmd}`);
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'pipe', timeout: 60000 });
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString() : '';
    // Ignore "already exists" type errors during seeding
    if (stderr.includes('UNIQUE constraint') || stderr.includes('already exists')) {
      console.log('    (skipped — already exists)');
      return;
    }
    console.error('    ERROR:', stderr || e.message);
  }
}

async function main() {
  const { env, file, local } = parseArgs();
  const envFlag = env ? ` --env ${env}` : '';
  const localFlag = local ? ' --local' : '';

  console.log(`Seeding from: ${file}`);
  console.log(`Environment: ${env || 'production'}${local ? ' (local)' : ''}`);

  if (!fs.existsSync(file)) {
    console.error(`Backup file not found: ${file}`);
    process.exit(1);
  }

  // Clean/create tmp dir
  if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  // Read zip
  const zipBuffer = fs.readFileSync(file);
  const zip = await JSZip.loadAsync(zipBuffer);

  const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
  console.log(`Backup version: ${manifest.version}, exported: ${manifest.exported_at}`);
  console.log(`Files: ${manifest.file_count}, Tables: ${manifest.table_count}`);

  // 1. Apply schema
  const schemaFile = zip.file('data/schema.sql');
  if (schemaFile) {
    console.log('\n--- Applying schema ---');
    const schemaPath = path.join(TMP, 'schema.sql');
    fs.writeFileSync(schemaPath, await schemaFile.async('string'));
    run(`npx wrangler d1 execute ${DB_NAME}${localFlag}${envFlag} --file=${schemaPath}`);
  }

  // 2. Seed tables from JSON (addresses and files table — these are needed before SQL seeds)
  const tablesFile = zip.file('data/tables.json');
  if (tablesFile) {
    console.log('\n--- Seeding tables from JSON ---');
    const data = JSON.parse(await tablesFile.async('string'));

    // Seed addresses first (needed by voting records)
    for (const table of ['addresses', 'files']) {
      const rows = data.tables[table];
      if (!rows || !rows.length) continue;
      console.log(`  ${table}: ${rows.length} rows`);
      const columns = Object.keys(rows[0]);
      const stmts = rows.map(row => {
        const vals = columns.map(c => {
          const v = row[c];
          if (v === null || v === undefined) return 'NULL';
          return "'" + String(v).replace(/'/g, "''") + "'";
        });
        return `INSERT OR IGNORE INTO ${table} (${columns.join(', ')}) VALUES (${vals.join(', ')});`;
      });
      // Write in chunks of 50 statements
      for (let i = 0; i < stmts.length; i += 50) {
        const chunk = stmts.slice(i, i + 50);
        const sqlPath = path.join(TMP, `${table}_${i}.sql`);
        fs.writeFileSync(sqlPath, chunk.join('\n'));
        run(`npx wrangler d1 execute ${DB_NAME}${localFlag}${envFlag} --file=${sqlPath}`);
      }
    }
  }

  // 3. Apply seed SQL files (voting events, documents)
  for (const sqlFile of ['data/seed-voting-events.sql', 'data/seed-documents.sql', 'data/seed-faqs.sql']) {
    const entry = zip.file(sqlFile);
    if (entry) {
      console.log(`\n--- Applying ${sqlFile} ---`);
      const sqlPath = path.join(TMP, path.basename(sqlFile));
      fs.writeFileSync(sqlPath, await entry.async('string'));
      run(`npx wrangler d1 execute ${DB_NAME}${localFlag}${envFlag} --file=${sqlPath}`);
    }
  }

  // 4. Upload R2 files
  const fileEntries = [];
  const filesFolder = zip.folder('files');
  if (filesFolder) {
    filesFolder.forEach((relPath, entry) => {
      if (!entry.dir) fileEntries.push({ relPath, entry });
    });
  }

  if (fileEntries.length) {
    console.log(`\n--- Uploading ${fileEntries.length} files to R2 ---`);
    let uploaded = 0;
    for (const { relPath, entry } of fileEntries) {
      const r2Key = relPath; // relPath is already the filename inside files/
      const buffer = await entry.async('nodebuffer');
      const tmpFile = path.join(TMP, r2Key.replace(/\//g, '_'));
      fs.writeFileSync(tmpFile, buffer);

      const ext = r2Key.split('.').pop().toLowerCase();
      const contentTypes = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', ics: 'text/calendar' };
      const ct = contentTypes[ext] || 'application/octet-stream';

      run(`npx wrangler r2 object put ${R2_BUCKET}/${r2Key}${localFlag}${envFlag} --file=${tmpFile} --content-type=${ct}`);
      uploaded++;
      if (uploaded % 10 === 0) console.log(`  Progress: ${uploaded} / ${fileEntries.length}`);
    }
    console.log(`  Uploaded ${uploaded} files`);
  }

  // Cleanup
  fs.rmSync(TMP, { recursive: true });
  console.log('\nSeed complete!');
}

main().catch(e => { console.error(e); process.exit(1); });
