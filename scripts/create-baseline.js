#!/usr/bin/env node
// Creates data/baseline-backup.zip from existing static files and seed SQL data.
// Run once: node scripts/create-baseline.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JSZip = require('jszip');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const OUTPUT = path.join(ROOT, 'data', 'baseline-backup.zip');

// Files to include in the baseline (relative to public/)
const staticFiles = [
  // Signature images
  ...Array.from({ length: 21 }, (_, i) => `signatures/${i + 1}.png`).filter(f => fs.existsSync(path.join(PUBLIC, f))),
  // Governance PDFs
  'governance/certificate-good-standing-2026.pdf',
  'governance/reinstatement-2026.pdf',
  'governance/agent-appointment-2019.pdf',
  'governance/articles-of-incorporation-1998.pdf',
  'governance/legal-advisory-martin-2023.pdf',
  'governance/ohio-rc-5312-05.pdf',
  // 2026 election PDFs
  'governance/2026-board-election/CertificateOfGoodStanding2026.pdf',
  'governance/2026-board-election/Nomination_Form_Fillable.pdf',
  'governance/2026-board-election/Notice_Signature_Page.pdf',
  'governance/2026-board-election/Proxy_Voting_Form_Fillable.pdf',
  'governance/2026-board-election/Special_Meeting_Notice_Complete.pdf',
  'governance/2026-board-election/Special_Meeting_Notice_Fillable.pdf',
  'governance/2026-board-election/special-meeting.ics',
  // Root PDFs
  'restated-declaration-2019.pdf',
  'original-declaration-2015.pdf',
  'plat-map-2016.pdf',
  'metes-and-bounds-2018.pdf',
  'original-flyer.pdf',
  // Images
  'voting-register-full.png',
  'plat-map.png',
  'og-image.png',
  'waldens-pond-hero.png',
];

const contentTypes = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  ics: 'text/calendar',
};

function getContentType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return contentTypes[ext] || 'application/octet-stream';
}

function getCategoryForFile(relPath) {
  if (relPath.startsWith('signatures/')) return 'signature';
  if (relPath.startsWith('governance/2026-board-election/')) return 'voting';
  if (relPath.startsWith('governance/')) return 'corporate';
  if (relPath.includes('restated-declaration') || relPath.includes('metes-and-bounds')) return 'governing';
  if (relPath.includes('original-') || relPath.includes('plat-map')) return 'historical';
  return 'general';
}

async function main() {
  console.log('Creating baseline backup zip...');

  // Read seed SQL files to extract table data
  const schemaSQL = fs.readFileSync(path.join(ROOT, 'src', 'schema.sql'), 'utf-8');
  const votingEventsSQL = fs.readFileSync(path.join(ROOT, 'src', 'seed-voting-events.sql'), 'utf-8');
  const documentsSQL = fs.readFileSync(path.join(ROOT, 'src', 'seed-documents.sql'), 'utf-8');
  const faqsSQL = fs.readFileSync(path.join(ROOT, 'src', 'seed-faqs.sql'), 'utf-8');

  // Build files table rows and collect file data for the zip
  const filesRows = [];
  const fileBuffers = {};

  for (const relPath of staticFiles) {
    const fullPath = path.join(PUBLIC, relPath);
    if (!fs.existsSync(fullPath)) {
      console.warn(`  SKIP (missing): ${relPath}`);
      continue;
    }
    const buffer = fs.readFileSync(fullPath);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const ext = relPath.split('.').pop().toLowerCase();
    const r2Key = hash + '.' + ext;
    const filename = path.basename(relPath);
    const ct = getContentType(relPath);
    const category = getCategoryForFile(relPath);

    // Dedup — skip if we already have this hash
    if (filesRows.find(r => r.hash === hash)) {
      console.log(`  DEDUP: ${relPath} (same content as existing file)`);
      continue;
    }

    filesRows.push({
      hash,
      filename,
      content_type: ct,
      size: buffer.length,
      r2_key: r2Key,
      category,
      created_at: new Date().toISOString().replace('T', ' ').split('.')[0],
    });
    fileBuffers[r2Key] = buffer;
    console.log(`  ${relPath} -> ${r2Key} (${(buffer.length / 1024).toFixed(1)}KB, ${category})`);
  }

  // Build the tables.json with seed data
  // We include: addresses (from schema), files, voting_events/records/candidates/docs/stats, documents
  // Other tables (users, dogs, posts, etc.) start empty in a fresh deployment

  // Parse addresses from schema SQL seed data
  const addressRows = parseAddressesFromSchema(schemaSQL);

  const tablesData = {
    version: 1,
    exported_at: new Date().toISOString(),
    tables: {
      addresses: addressRows,
      properties: [],
      files: filesRows,
      users: [],
      dogs: [],
      posts: [],
      surveys: [],
      survey_responses: [],
      comments: [],
      playdate_dogs: [],
      playdate_swipes: [],
      playdate_matches: [],
      playdate_messages: [],
      friend_requests: [],
      friendships: [],
      chat_threads: [],
      chat_participants: [],
      chat_messages: [],
      content_reports: [],
      content_history: [],
      address_requests: [],
      audit_log: [],
      voting_events: [],
      voting_records: [],
      voting_event_candidates: [],
      voting_event_documents: [],
      voting_event_stats: [],
      documents: [],
    }
  };

  // Store the raw seed SQL files so the seed script can execute them directly
  // This is more reliable than trying to parse INSERT statements into JSON

  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({
    version: 2,
    exported_at: new Date().toISOString(),
    file_count: Object.keys(fileBuffers).length,
    table_count: Object.keys(tablesData.tables).length,
    has_seed_sql: true,
  }, null, 2));
  zip.file('data/tables.json', JSON.stringify(tablesData, null, 2));
  zip.file('data/schema.sql', schemaSQL);
  zip.file('data/seed-voting-events.sql', votingEventsSQL);
  zip.file('data/seed-documents.sql', documentsSQL);
  zip.file('data/seed-faqs.sql', faqsSQL);

  // Add file binaries
  for (const [r2Key, buffer] of Object.entries(fileBuffers)) {
    zip.file('files/' + r2Key, buffer);
  }

  // Generate zip
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  fs.writeFileSync(OUTPUT, zipBuffer);
  const sizeMB = (zipBuffer.length / (1024 * 1024)).toFixed(1);
  console.log(`\nBaseline zip created: ${OUTPUT} (${sizeMB} MB)`);
  console.log(`  Files: ${Object.keys(fileBuffers).length}`);
  console.log(`  Tables: ${Object.keys(tablesData.tables).length}`);
}

function parseAddressesFromSchema(sql) {
  const rows = [];
  const regex = /\((\d+),\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'\)/g;
  let match;
  while ((match = regex.exec(sql)) !== null) {
    rows.push({
      id: parseInt(match[1]),
      tract_lot: match[2],
      street_address: match[3],
      full_address: match[4],
      full_label: match[5],
    });
  }
  return rows;
}

main().catch(e => { console.error(e); process.exit(1); });
