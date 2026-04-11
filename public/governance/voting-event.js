// Shared voting event detail page renderer
// Fetches event data from the API and renders the appropriate layout based on event type

var eventSlug = '';
var eventData = null;
var recordsData = [];
var currentSignerKey = '';

(async function() {
  // Extract slug from URL path (last non-empty segment)
  var pathParts = window.location.pathname.replace(/\/$/, '').split('/');
  eventSlug = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
  if (!eventSlug) { document.getElementById('eventContent').innerHTML = '<p style="padding:var(--space-xl);text-align:center;color:var(--stone);">Event not found.</p>'; return; }

  try {
    var [evRes, recRes] = await Promise.all([
      fetch('/api/voting-events/' + eventSlug),
      fetch('/api/voting-events/' + eventSlug + '/records')
    ]);
    if (!evRes.ok) throw new Error('Event not found');
    eventData = await evRes.json();
    var recJson = await recRes.json();
    recordsData = recJson.records || [];
  } catch (e) {
    document.getElementById('eventContent').innerHTML = '<p style="padding:var(--space-xl);text-align:center;color:var(--stone);">Unable to load event data.</p>';
    return;
  }

  var meta = eventData.metadata || {};
  var container = document.getElementById('eventContent');

  if (eventData.type === 'declaration_amendment') {
    container.innerHTML = renderDeclarationAmendment(eventData, meta, recordsData);
  } else if (eventData.type === 'board_election') {
    container.innerHTML = renderBoardElection(eventData, meta, recordsData);
  } else {
    container.innerHTML = renderGenericEvent(eventData, meta, recordsData);
  }

  // Deep-link: auto-open modal if signer key injected by worker or in hash
  if (window.__signerKey) {
    openSignerByKey(window.__signerKey);
  } else if (window.location.hash) {
    openSignerByKey(window.location.hash.substring(1));
  }
  window.addEventListener('hashchange', function() { openSignerByKey(window.location.hash.substring(1)); });
})();

function esc(s) { if (!s) return ''; var el = document.createElement('span'); el.textContent = s; return el.innerHTML; }

function formatDate(iso) {
  if (!iso) return '';
  var d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function renderStats(stats) {
  if (!stats || !stats.length) return '';
  return '<div class="vote-summary">' + stats.map(function(s) {
    return '<div class="vote-stat"><div class="stat-num">' + esc(s.value) + '</div><div class="stat-label">' + esc(s.label) + '</div></div>';
  }).join('') + '</div>';
}

function renderElectionStats(stats) {
  if (!stats || !stats.length) return '';
  return '<div class="election-stats">' + stats.map(function(s) {
    return '<div class="election-stat"><div class="num">' + esc(s.value) + '</div><div class="label">' + esc(s.label) + '</div></div>';
  }).join('') + '</div>';
}

// ---- Declaration Amendment Layout ----
function renderDeclarationAmendment(ev, meta, records) {
  var html = '';

  // Hero
  html += '<section class="vr-hero"><div class="container">';
  html += '<a href="/governance.html" class="back-link"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Back to Governance</a>';
  html += '<span class="section-tag">Official Record &mdash; ' + esc(formatDate(ev.event_date)) + '</span>';
  html += '<h1>' + esc(ev.short_title || ev.title) + '</h1>';
  html += '<p>' + esc(ev.description) + '</p>';
  if (ev.filing_instrument) {
    html += '<div class="filed-info"><p><strong>' + esc(ev.filing_instrument) + '</strong> &mdash; Filed with the ' + esc(ev.filing_office) + ', ' + esc(formatDate(ev.filing_date)) + '</p></div>';
  }
  if (meta.document_pdf) {
    html += '<div class="hero-pdf-actions">';
    html += '<button onclick="openPdfViewer(\'' + esc(meta.document_pdf) + '\', \'' + esc(meta.document_title || ev.title) + '\')" class="pdf-action-btn pdf-btn-primary"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> View Full Document' + (meta.document_pages ? ' (' + meta.document_pages + ' pages)' : '') + '</button>';
    html += '<a href="' + esc(meta.document_pdf) + '" download class="pdf-action-btn pdf-btn-secondary"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download PDF</a>';
    html += '</div>';
  }
  html += '</div></section>';

  // Stats
  html += '<section class="section"><div class="container">' + renderStats(ev.stats) + '</div></section>';

  // Voting Table
  if (ev.has_voting_register && records.length) {
    html += '<section class="vr-table-section section-alt"><div class="container">';
    html += '<h2>Digitized Voting Record</h2>';
    html += '<p>Click &ldquo;View Record&rdquo; on any signed row to see the original signature from the filed document along with full parcel details.</p>';
    html += '<div class="vr-table-wrap"><table class="vr-table"><thead><tr><th>Tract/Lot</th><th>Address</th><th>Owner (' + new Date(ev.event_date + 'T12:00:00').getFullYear() + ')</th><th>Status</th><th>Record</th></tr></thead><tbody>';
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      var isSigned = r.vote === 'yes';
      html += '<tr' + (isSigned ? ' class="signed"' : '') + (r.signer_key ? ' id="' + esc(r.signer_key) + '"' : '') + '>';
      html += '<td class="tract-col">' + esc(r.tract_lot) + '</td>';
      html += '<td>' + esc(r.street_address) + '</td>';
      html += '<td>' + esc(r.owner_name_at_vote) + '</td>';
      if (isSigned) {
        html += '<td><span class="signed-badge">Signed</span></td>';
        html += '<td><button class="view-sig-btn" data-key="' + esc(r.signer_key) + '" onclick="openSignerByKey(this.dataset.key)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> View Record</button></td>';
      } else {
        html += '<td><span class="not-signed-badge">Not Signed</span></td>';
        html += '<td><span class="sig-none">&mdash;</span></td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';

    // Parcel notes
    if (meta.parcel_notes && meta.parcel_notes.length) {
      html += '<div class="parcel-notes"><h4>Notes on Parcel Consolidations</h4>';
      html += '<p>The original subdivision contained 27 platted lots/tracts. Two properties have since been legally consolidated by their respective owners, reducing the total to 25 current tax parcels:</p>';
      meta.parcel_notes.forEach(function(n) {
        html += '<p><strong>' + esc(n.title) + ':</strong> ' + esc(n.text) + '</p>';
      });
      html += '<p style="margin-top: var(--space-sm);"><strong>Important:</strong> Parcel consolidation does not affect the covenants. The consolidated parcels remain subject to all easements, restrictions, and obligations under the Restated Declaration. Each consolidated parcel carries one vote in association matters.</p>';
      html += '</div>';
    }
    html += '</div></section>';
  }

  // Signature Page Image
  if (meta.signature_page_image) {
    html += '<section class="original-doc section section-alt"><div class="container">';
    html += '<h2>Signature Page (Page ' + (meta.signature_page_number || '') + ' of ' + (meta.document_pages || '') + ')</h2>';
    html += '<p style="color:var(--stone);margin-bottom:var(--space-md);font-size:0.9rem;">The image below shows <strong>only the signature/voting roll call page</strong> from the ' + (meta.document_pages || '') + '-page document. To read the complete text, use the PDF viewer above or <a href="' + esc(meta.document_pdf) + '" target="_blank" style="color:var(--forest-mid);text-decoration:underline;">download the full PDF</a>.</p>';
    html += '<div class="doc-image-wrapper"><img src="' + esc(meta.signature_page_image) + '" alt="Signature page from the filed document"/></div>';
    if (ev.filing_instrument) {
      html += '<p class="doc-caption">Voting Roll Call &mdash; Page ' + (meta.signature_page_number || '') + ' of ' + (meta.document_pages || '') + ' &mdash; ' + esc(ev.filing_details) + ' &mdash; ' + esc(ev.filing_instrument) + '</p>';
    }
    html += '</div></section>';
  }

  // What Signers Agreed To
  if (meta.what_signers_agreed_to && meta.what_signers_agreed_to.length) {
    html += '<section class="section section-alt"><div class="container"><div class="signed-banner">';
    html += '<div class="signed-banner-header"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg><h3>What Every Signer Explicitly Agreed To</h3></div>';
    html += '<div class="signed-banner-body">';
    html += '<p>The ' + new Date(ev.event_date + 'T12:00:00').getFullYear() + ' ' + esc(ev.short_title || ev.title) + ' is not a vague petition or a statement of interest. It is a <strong>' + (meta.document_pages || '') + '-page legally binding instrument</strong> recorded with the ' + esc(ev.filing_office) + '. Every owner who signed the document affixed their signature to the full text of this instrument&mdash;including all of the following provisions:</p>';
    html += '<ul class="obligation-list">';
    meta.what_signers_agreed_to.forEach(function(item) {
      html += '<li><strong>' + esc(item.title) + '</strong>' + esc(item.text) + '</li>';
    });
    html += '</ul>';
    html += '<div class="signed-banner-quote">A signature on this document is not a suggestion&mdash;it is a binding legal commitment. Every signer acknowledged the full scope of these obligations. The recorded instrument with each owner\'s original signature is a matter of permanent public record at the ' + esc(ev.filing_office) + '.</div>';
    html += '</div></div>';

    // Validation
    if (meta.validation_text) {
      html += '<div class="ccr-section"><h3>How This Vote Was Validated</h3><p>' + esc(meta.validation_text) + '</p><p>Under the Declaration, there is <strong>one vote per lot</strong>, regardless of how many individuals are listed as owners on a given parcel. In the absence of a dispute by co-owners, a lot\'s vote can be made by any one co-owner.</p></div>';
    }
    html += '</div></section>';
  }

  return html;
}

// ---- Board Election Layout ----
function renderBoardElection(ev, meta, records) {
  var html = '';

  // Hero
  html += '<section class="vr-hero"><div class="container">';
  html += '<a href="/governance.html" class="back-link"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Back to Governance</a>';
  html += '<span class="section-tag">' + esc(ev.short_title || ev.title) + '</span>';
  html += '<h1>' + esc(ev.title) + '</h1>';
  html += '<p>' + esc(ev.description) + '</p>';
  html += '</div></section>';

  html += '<section class="section"><div class="container">';

  // Meeting details (for upcoming elections)
  if (meta.meeting_date) {
    html += '<div class="subsection"><h2>Meeting Details</h2><div class="meeting-details">';
    html += '<div class="meeting-detail"><div class="detail-label">Date</div><div class="detail-value">' + esc(meta.meeting_date) + '</div></div>';
    if (meta.meeting_time) html += '<div class="meeting-detail"><div class="detail-label">Time</div><div class="detail-value">' + esc(meta.meeting_time) + '</div></div>';
    if (meta.meeting_location) {
      html += '<div class="meeting-detail"><div class="detail-label">Location</div><div class="detail-value">' + esc(meta.meeting_location);
      if (meta.meeting_location_detail) html += '<br><span style="font-family:var(--font-body);font-size:0.8rem;font-weight:400;">' + esc(meta.meeting_location_detail);
      if (meta.meeting_location_note) html += '<br><em>' + esc(meta.meeting_location_note) + '</em>';
      html += '</span></div></div>';
    }
    if (meta.notice_date) html += '<div class="meeting-detail"><div class="detail-label">Date of Notice</div><div class="detail-value">' + esc(meta.notice_date) + '</div></div>';
    html += '</div>';
    if (meta.calendar_file) {
      html += '<a href="' + esc(meta.calendar_file) + '" download class="action-btn action-btn-secondary" style="margin-top:var(--space-sm);display:inline-flex;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Add to Calendar</a>';
    }
    html += '</div>';
  }

  // Stats
  html += renderElectionStats(ev.stats);

  // Schedule
  if (meta.schedule && meta.schedule.length) {
    html += '<div class="subsection"><h2>Expected Schedule</h2><ul class="callers-list">';
    meta.schedule.forEach(function(s) {
      html += '<li><strong>' + esc(s.time) + '</strong> &mdash; ' + esc(s.activity) + '</li>';
    });
    html += '</ul></div>';
  }

  // Purpose
  if (meta.purpose && meta.purpose.length) {
    html += '<div class="subsection"><h2>Purpose of the Meeting</h2>';
    meta.purpose.forEach(function(p, i) {
      html += '<p><strong>' + (i + 1) + '. ' + esc(p.title) + '</strong> &mdash; ' + esc(p.text) + '</p>';
    });
    if (meta.stagger_note) html += '<p><em>' + esc(meta.stagger_note) + '</em></p>';
    html += '</div>';
  }

  // Voting method
  if (meta.election_method_text || meta.voting_method_text) {
    html += '<div class="subsection"><h2>How Voting Works</h2>';
    if (meta.voting_method_text) html += '<p>' + esc(meta.voting_method_text) + '</p>';
    if (meta.voting_selection_text) html += '<p>' + esc(meta.voting_selection_text) + '</p>';
    if (meta.voting_attendance_text) html += '<p>' + esc(meta.voting_attendance_text) + '</p>';
    if (meta.election_method_text) html += '<p>' + esc(meta.election_method_text) + '</p>';
    html += '</div>';
  }

  // Winners determination
  if (meta.winners_text) {
    html += '<div class="subsection"><h2>How Winners Are Determined</h2>';
    html += '<p>' + esc(meta.winners_text) + '</p>';
    if (meta.participation_appeal) html += '<p><strong>' + esc(meta.participation_appeal) + '</strong></p>';
    html += '</div>';
  }

  // Candidates / Elected Board
  if (ev.candidates && ev.candidates.length) {
    var elected = ev.candidates.filter(function(c) { return c.elected; });

    if (ev.status === 'completed' && elected.length) {
      html += '<div class="subsection"><h2>Elected Board</h2>';
      html += '<p>The following candidates were elected to the Board of Directors and subsequently elected officers:</p>';
      html += '<div class="nominees-grid">';
      elected.forEach(function(c) {
        html += '<div class="nominee-card elected"><div class="nominee-name">' + esc(c.name) + '</div>';
        if (c.address_label) html += '<div class="nominee-detail">' + esc(c.address_label) + '</div>';
        if (c.position) html += '<span class="elected-badge">' + esc(c.position) + '</span>';
        html += '</div>';
      });
      html += '</div></div>';
    } else {
      html += '<div class="subsection"><h2>Nominees for Director</h2>';
      html += '<p>The following individuals have been nominated and have confirmed their willingness to serve:</p>';
      html += '<div class="nominees-grid">';
      ev.candidates.forEach(function(c) {
        html += '<div class="nominee-card' + (c.elected ? ' elected' : '') + '"><div class="nominee-name">' + esc(c.name) + '</div>';
        if (c.address_label) html += '<div class="nominee-detail">' + esc(c.address_label) + '</div>';
        if (c.elected && c.position) html += '<span class="elected-badge">' + esc(c.position) + '</span>';
        html += '</div>';
      });
      html += '</div>';
      if (meta.nomination_text) html += '<p>' + esc(meta.nomination_text) + '</p>';
      html += '</div>';
    }
  }

  // Authority
  if (meta.authority_text) {
    html += '<div class="subsection"><h2>Authority for This Meeting</h2>';
    html += '<p>' + esc(meta.authority_text) + '</p>';
    if (meta.authority_legal) html += '<p>' + esc(meta.authority_legal) + '</p>';
    if (meta.authority_context) html += '<p>' + esc(meta.authority_context) + '</p>';
    html += '</div>';
  }

  // Called By
  if (meta.called_by && meta.called_by.length) {
    html += '<div class="subsection"><h2>Meeting Called By</h2><ul class="callers-list">';
    meta.called_by.forEach(function(c) {
      html += '<li><strong>' + esc(c.name) + '</strong> &mdash; ' + esc(c.address) + '</li>';
    });
    html += '</ul></div>';
  }

  // Proxy Voting
  if (meta.proxy_text) {
    html += '<div class="subsection"><h2>Proxy Voting</h2>';
    html += '<p>' + esc(meta.proxy_text) + '</p>';
    if (meta.proxy_return) html += '<p>' + esc(meta.proxy_return) + '</p>';
    html += '</div>';
  }

  // Document actions
  if (ev.documents && ev.documents.length) {
    html += '<div class="action-buttons">';
    ev.documents.forEach(function(doc) {
      if (doc.type === 'pdf_viewer') {
        html += '<button onclick="openPdfViewer(\'' + esc(doc.url) + '\', \'' + esc(doc.label) + '\')" class="action-btn action-btn-' + (doc.sort_order === 1 ? 'primary' : 'secondary') + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> ' + esc(doc.label) + '</button>';
      } else if (doc.type === 'download') {
        html += '<a href="' + esc(doc.url) + '" download class="action-btn action-btn-secondary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> ' + esc(doc.label) + '</a>';
      }
    });
    if (meta.contact_email) {
      html += '<a href="mailto:' + esc(meta.contact_email) + '" class="action-btn action-btn-secondary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Email ' + esc(meta.contact_email) + '</a>';
    }
    html += '</div>';
  }

  // Info note
  if (meta.info_note || meta.privacy_note) {
    html += '<div class="info-note">';
    if (meta.info_note) html += '<p>' + esc(meta.info_note) + '</p>';
    if (meta.privacy_note) html += '<p>' + esc(meta.privacy_note) + '</p>';
    if (meta.contact) html += '<p>Questions? Contact ' + esc(meta.contact) + '.</p>';
    if (meta.contact_email && !meta.contact) html += '<p>Questions? Contact <a href="mailto:' + esc(meta.contact_email) + '">' + esc(meta.contact_email) + '</a>.</p>';
    html += '</div>';
  }

  // Voting register table (if enabled for this election)
  if (ev.has_voting_register && records.length) {
    html += renderVotingRegisterTable(ev, records);
  }

  html += '</div></section>';
  return html;
}

// ---- Generic Event Layout ----
function renderGenericEvent(ev, meta, records) {
  var html = '';
  html += '<section class="vr-hero"><div class="container">';
  html += '<a href="/governance.html" class="back-link"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg> Back to Governance</a>';
  html += '<span class="section-tag">' + esc(formatDate(ev.event_date)) + '</span>';
  html += '<h1>' + esc(ev.title) + '</h1>';
  html += '<p>' + esc(ev.description) + '</p>';
  html += '</div></section>';
  html += '<section class="section"><div class="container">';
  html += renderElectionStats(ev.stats);
  if (ev.has_voting_register && records.length) html += renderVotingRegisterTable(ev, records);
  html += '</div></section>';
  return html;
}

function renderVotingRegisterTable(ev, records) {
  var html = '<div class="subsection"><h2>Voting Record</h2>';
  html += '<div class="vr-table-wrap"><table class="vr-table"><thead><tr><th>Tract/Lot</th><th>Address</th><th>Owner</th><th>Status</th></tr></thead><tbody>';
  records.forEach(function(r) {
    var voted = r.vote !== null;
    html += '<tr' + (voted ? ' class="signed"' : '') + '>';
    html += '<td class="tract-col">' + esc(r.tract_lot) + '</td>';
    html += '<td>' + esc(r.street_address) + '</td>';
    html += '<td>' + esc(r.owner_name_at_vote) + '</td>';
    html += '<td>' + (voted ? '<span class="signed-badge">Voted</span>' : '<span class="not-signed-badge">Not Voted</span>') + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table></div></div>';
  return html;
}

// ---- Modal functions ----
function openSignerByKey(key) {
  if (!key || !recordsData.length) return;
  var record = recordsData.find(function(r) { return r.signer_key === key; });
  if (!record || !record.signature_image_url) return;
  var row = document.getElementById(key);
  if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(function() { openModalFromRecord(record); }, 300);
}

function openModalFromRecord(r) {
  document.getElementById('modalTitle').textContent = r.owner_name_at_vote;
  document.getElementById('modalTract').textContent = r.tract_lot;
  document.getElementById('modalParcel').textContent = r.parcel_number || '';
  document.getElementById('modalAddress').textContent = r.street_address;
  document.getElementById('modalOwner').textContent = r.owner_name_at_vote;
  document.getElementById('modalBadge').textContent = 'Signed \u2014 ' + formatDate(r.voted_at || eventData.event_date);
  document.getElementById('modalDocName').textContent = eventData.title;
  var img = document.getElementById('modalSigImg');
  img.src = r.signature_image_url;
  img.alt = 'Signed record - ' + r.owner_name_at_vote + ', ' + r.tract_lot;
  document.getElementById('modalImageLabel').textContent = 'Original signed record as filed' + (eventData.filing_office ? ' with the ' + eventData.filing_office : '') + (eventData.filing_instrument ? ' \u2014 ' + eventData.filing_instrument : '');

  currentSignerKey = r.signer_key;
  var shareUrl = window.location.origin + eventData.url_prefix + '/' + currentSignerKey;
  document.getElementById('modalShareUrl').value = shareUrl;
  if (currentSignerKey) history.replaceState(null, '', eventData.url_prefix + '/' + currentSignerKey);

  // PDF actions in modal
  var meta = eventData.metadata || {};
  var pdfHtml = '';
  if (meta.document_pdf) {
    pdfHtml += '<button onclick="closeModal(); setTimeout(function(){ openPdfViewer(\'' + esc(meta.document_pdf) + '\', \'' + esc(meta.document_title || eventData.title) + '\'); }, 300);" class="modal-pdf-link"><div class="pdf-link-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div><div class="pdf-link-text"><strong>View Full Document in Reader</strong><span>' + esc(eventData.title) + (meta.document_pages ? ' \u2014 ' + meta.document_pages + ' pages' : '') + '</span></div></button>';
    pdfHtml += '<a href="' + esc(meta.document_pdf) + '" download class="modal-pdf-link"><div class="pdf-link-icon" style="background:var(--earth);"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></div><div class="pdf-link-text"><strong>Download PDF</strong><span>Save the full document to your device</span></div></a>';
  }
  document.getElementById('modalPdfActions').innerHTML = pdfHtml;

  document.getElementById('modalAgreed').innerHTML = '<strong>By signing, this owner explicitly agreed to:</strong> the creation of the Walden\'s Revisited Homeowners Association as a legal corporation; mandatory HOA membership; payment of annual dues and assessments; adherence to all bylaws and the Code of Regulations; and the HOA\'s authority to enforce covenants through legal action. This signature is permanently recorded as public record.';

  resetCopyBtn();
  document.getElementById('sigModal').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('sigModal').classList.remove('active');
  document.body.style.overflow = '';
  currentSignerKey = '';
  if (eventData) history.replaceState(null, '', eventData.url_prefix + '/');
}

function copyShareUrl() {
  var input = document.getElementById('modalShareUrl');
  navigator.clipboard.writeText(input.value).then(function() {
    var btn = document.getElementById('copyUrlBtn');
    document.getElementById('copyIcon').style.display = 'none';
    document.getElementById('checkIcon').style.display = 'block';
    document.getElementById('copyLabel').textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(resetCopyBtn, 2000);
  });
}

function resetCopyBtn() {
  var btn = document.getElementById('copyUrlBtn');
  if (!btn) return;
  btn.classList.remove('copied');
  document.getElementById('copyIcon').style.display = 'block';
  document.getElementById('checkIcon').style.display = 'none';
  document.getElementById('copyLabel').textContent = 'Copy';
}

document.getElementById('sigModal').addEventListener('click', function(e) { if (e.target === this) closeModal(); });
document.addEventListener('keydown', function(e) {
  var pm = document.getElementById('pdfModal');
  if (e.key === 'Escape' && (!pm || !pm.classList.contains('active'))) closeModal();
});
