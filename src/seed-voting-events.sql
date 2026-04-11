-- Seed voting events data
-- Run: wrangler d1 execute waldensrevisited-db --file=src/seed-voting-events.sql

-- =============================================================================
-- EVENT 1: 2019 Restated Declaration Vote
-- =============================================================================
INSERT OR IGNORE INTO voting_events (id, slug, type, title, short_title, description, event_date, status, total_parcels, threshold_percent, threshold_label, result_label, has_voting_register, has_signatures, filing_instrument, filing_details, filing_office, filing_date, metadata, url_prefix, sort_order) VALUES (
  1,
  '2019-restated-declaration',
  'declaration_amendment',
  'Restated Declaration of Protective Covenants & Restrictions',
  'Restated Declaration Vote',
  'A community-wide vote to adopt a comprehensive 52-page restated declaration, replacing the original 2015 document. The restatement introduced mandatory liability insurance, a 16-page Code of Regulations (Bylaws), elected board governance, and modern lifestyle protections for all lot owners.',
  '2019-03-09',
  'completed',
  25,
  75.0,
  'Required',
  'Passed — Threshold Exceeded',
  1,
  1,
  'Instrument #2019-00009690',
  'Book 1037, Page 2716',
  'Delaware County Recorder''s Office',
  '2019-04-25',
  '{"document_title":"Restated Declaration of Protective Covenants and Restrictions for Walden''s Revisited","document_pages":52,"document_pdf":"/restated-declaration-2019.pdf","signature_page_image":"/voting-register-full.png","signature_page_number":30,"what_signers_agreed_to":[{"title":"Creation of an HOA Corporation","text":"Signers approved the formation of the Walden''s Revisited Homeowners Association as a formal Ohio nonprofit corporation with full legal authority to govern the community. (Article II)"},{"title":"Mandatory Membership","text":"Signers agreed that every lot owner is automatically and irrevocably a member of the association. Membership is not optional and cannot be declined. (Section 2.02)"},{"title":"Payment of Annual Dues & Assessments","text":"Signers agreed to pay annual assessments as determined by the Board of Directors, with the understanding that unpaid dues accrue interest, become a lien on the property, and are enforceable through foreclosure under Ohio law. (Article IV)"},{"title":"Adherence to All Bylaws","text":"Signers approved the attached 16-page Code of Regulations (Bylaws), agreeing to be bound by all rules governing board elections, meetings, quorum requirements, and decision-making procedures. (Exhibit B)"},{"title":"Liability Insurance Mandate","text":"Signers agreed that the HOA must carry Commercial General Liability insurance and Directors & Officers coverage, funded through their assessments. (Section 6.01)"},{"title":"Enforcement & Legal Remedies","text":"Signers consented to the association''s authority to enforce all covenants, restrictions, and rules through legal action, including injunctive relief and recovery of attorney''s fees. (Article VII)"}],"validation_text":"The original Declaration (Section 1.10) provides that it may be amended by a two-thirds vote when six or more lots have homes constructed upon them which are occupied. Under Ohio law (ORC 5312.01(J)), a \"lot\" is defined as a tract with a separate parcel number assigned by the county auditor. Following two property consolidations, the Delaware County Auditor recognizes 25 legal lots in the community. Amending the declaration therefore requires 75% approval — a minimum of 19 signatures. With 20 of 25 lots signing, the Restated Declaration cleared this threshold and is the currently effective governing document.","parcel_notes":[{"title":"Lot 2/3","text":"Originally platted as Lot 2 and Lot 3. Combined into a single 5.001-acre property. The Delaware County Auditor now recognizes this as a single parcel (20040001060004)."},{"title":"Tract 10/11","text":"Originally platted as Tract 10 and Tract 11. Combined into a single property under parcel 20040001061010."}]}',
  '/votes/2019-restated-declaration',
  1
);

-- Stats for 2019 vote
INSERT OR IGNORE INTO voting_event_stats (event_id, label, value, sort_order) VALUES
  (1, 'Total Lots', '25', 1),
  (1, 'Voted Yes', '20', 2),
  (1, 'Approval', '80%', 3),
  (1, 'Required', '75%', 4);

-- Documents for 2019 vote
INSERT OR IGNORE INTO voting_event_documents (event_id, label, url, type, sort_order) VALUES
  (1, 'View Full Register & Signatures', '/votes/2019-restated-declaration/', 'link', 1),
  (1, 'View Declaration (PDF)', '/restated-declaration-2019.pdf', 'pdf_viewer', 2),
  (1, 'Download PDF', '/restated-declaration-2019.pdf', 'download', 3);

-- Voting records for 2019 (20 signed + 5 not signed = 25 parcels)
INSERT OR IGNORE INTO voting_records (event_id, address_id, owner_name_at_vote, vote, signer_key, parcel_number, signature_image_url, voted_at) VALUES
  (1, 1,  'David & Corey Snyder',           'yes', 'lot-1-snyder',       '20040001060002', '/signatures/1.png',  '2019-03-09'),
  (1, 4,  'Jim & Stacia Mull',              'yes', 'tract-1-mull',       '20040001061016', '/signatures/2.png',  '2019-03-09'),
  (1, 2,  'Ryan & Betsy Boles',             'yes', 'lot-2-3-boles',      '20040001060004', '/signatures/3.png',  '2019-03-09'),
  (1, 26, 'Chris & Christine Heider',       NULL,  'tract-2-heider',     NULL,             NULL,                 NULL),
  (1, 5,  'Steve & Tammy Tryon',            'yes', 'tract-3-tryon',      '20040001061003', '/signatures/4.png',  '2019-03-09'),
  (1, 3,  'Scott & Kimberly Gregory',       'yes', 'lot-4-gregory',      '20040001060003', '/signatures/6.png',  '2019-03-09'),
  (1, 6,  'Brad & Jean Smart',              NULL,  'tract-4-smart',      NULL,             NULL,                 NULL),
  (1, 7,  'Mark Potts',                     'yes', 'tract-5-potts',      '20040001061005', '/signatures/7.png',  '2019-03-09'),
  (1, 8,  'Steve & Diana Rosser',           NULL,  'tract-6-rosser',     NULL,             NULL,                 NULL),
  (1, 9,  'Greg & Kim Dye (Isaly)',         'yes', 'tract-7-dye',        '20040001061007', '/signatures/8.png',  '2019-03-09'),
  (1, 10, 'Craig & Kathy Heath (Anderson)', 'yes', 'tract-8-heath',      '20040001061008', '/signatures/9.png',  '2019-03-09'),
  (1, 11, 'Ken & Mary Lynn Towers',         'yes', 'tract-9-towers',     '20040001061009', '/signatures/10.png', '2019-03-09'),
  (1, 12, 'Brian & Mandy Sieger',           'yes', 'tract-10-11-sieger', '20040001061010', '/signatures/11.png', '2019-03-09'),
  (1, 13, 'Clayton & Leah Childers',        'yes', 'tract-12-childers',  '20040001061012', '/signatures/12.png', '2019-03-09'),
  (1, 14, 'Ben & Joy Colvin',               'yes', 'tract-13-colvin',    '20040001061013', '/signatures/13.png', '2019-03-09'),
  (1, 15, 'Jake & Tammy Upper',             'yes', 'tract-14-upper',     '20040001061014', '/signatures/14.png', '2019-03-09'),
  (1, 16, 'Ken Pauly',                      NULL,  'tract-15-pauly',     NULL,             NULL,                 NULL),
  (1, 17, 'Larry & Danielle Rickard',       'yes', 'tract-20-rickard',   '20040002003005', '/signatures/15.png', '2019-03-09'),
  (1, 18, 'Brian & Janet Wolford',          'yes', 'tract-21-wolford',   '20040002003006', '/signatures/16.png', '2019-03-09'),
  (1, 19, 'Bobbie Fussichen',               'yes', 'tract-22-fussichen', '20040002003007', '/signatures/17.png', '2019-03-09'),
  (1, 20, 'Dan & Rachel Gourley',           'yes', 'tract-23-gourley',   '20040002003008', '/signatures/18.png', '2019-03-09'),
  (1, 21, 'John & Paula Dranschak',         'yes', 'tract-24-dranschak', '20040002003002', '/signatures/19.png', '2019-03-09'),
  (1, 22, 'Gregg Mambourg',                 NULL,  'tract-25-mambourg',  NULL,             NULL,                 NULL),
  (1, 23, 'Spencer & Melissa Walton',       'yes', 'tract-26-walton',    '20040002003004', '/signatures/20.png', '2019-03-09'),
  (1, 24, 'Stacie & Sean Avner',            'yes', 'tract-27-avner',     '20040002003001', '/signatures/21.png', '2019-03-09');


-- =============================================================================
-- EVENT 2: 2020 Board of Directors Election
-- =============================================================================
INSERT OR IGNORE INTO voting_events (id, slug, type, title, short_title, description, event_date, status, total_parcels, threshold_percent, threshold_label, result_label, has_voting_register, has_signatures, filing_instrument, filing_details, filing_office, filing_date, metadata, url_prefix, sort_order) VALUES (
  2,
  '2020-board-election',
  'board_election',
  'Board of Directors Election',
  '2020 Board Election',
  'The Association''s first Board election, conducted by mail ballot. Six candidates stood for three Director seats. Twenty-one of twenty-five parcels voted (84% participation).',
  '2020-09-01',
  'completed',
  25,
  NULL,
  NULL,
  'Completed',
  0,
  0,
  NULL,
  NULL,
  NULL,
  NULL,
  '{"seats":3,"vote_method":"mail_ballot","election_method_text":"Ballots were distributed by mail to all 25 voting parcels. Each voter could select up to three candidates from the six nominees. The three candidates receiving the most votes were elected to serve staggered terms of one, two, and three years per Bylaws §4.01. Twenty-one of twenty-five parcels returned ballots, resulting in 84% voter participation.","privacy_note":"Official ballots and detailed vote counts are available to members of the Association upon request. Individual voting records are not shared publicly for privacy reasons.","contact_email":"elections@waldensrevisited.org"}',
  '/governance/2020-board-election',
  2
);

-- Stats for 2020 election
INSERT OR IGNORE INTO voting_event_stats (event_id, label, value, sort_order) VALUES
  (2, 'Voting Parcels', '25', 1),
  (2, 'Ballots Cast', '21', 2),
  (2, 'Participation', '84%', 3),
  (2, 'Candidates', '6', 4),
  (2, 'Director Seats', '3', 5);

-- Candidates for 2020 election (3 elected + 3 not elected)
INSERT OR IGNORE INTO voting_event_candidates (event_id, name, address_label, address_id, elected, position, sort_order) VALUES
  (2, 'Scott Gregory',     'Lot 4 — 431 Brindle Rd',       3,    1, 'President',  1),
  (2, 'Mark Potts',        'Tract 5 — 563 Brindle Rd',     7,    1, 'Treasurer',  2),
  (2, 'Michael Williams',  'Tract 15 — 6670 Houseman Rd',  16,   1, 'Secretary',  3),
  (2, 'Candidate 4',       NULL,                            NULL, 0, NULL,         4),
  (2, 'Candidate 5',       NULL,                            NULL, 0, NULL,         5),
  (2, 'Candidate 6',       NULL,                            NULL, 0, NULL,         6);

-- Voting records for 2020 (21 voted + 4 not voted = 25; individual votes private)
INSERT OR IGNORE INTO voting_records (event_id, address_id, owner_name_at_vote, vote, signer_key, parcel_number, signature_image_url, voted_at) VALUES
  (2, 1,  'David & Corey Snyder',           'yes', NULL, NULL, NULL, '2020-09-01'),
  (2, 4,  'Jim & Stacia Mull',              'yes', NULL, NULL, NULL, '2020-09-01'),
  (2, 2,  'Ryan & Betsy Boles',             'yes', NULL, NULL, NULL, '2020-09-01'),
  (2, 26, 'Chris & Christine Heider',       'yes', NULL, NULL, NULL, '2020-09-01'),
  (2, 5,  'Steve & Tammy Tryon',            'yes', NULL, NULL, NULL, '2020-09-01'),
  (2, 3,  'Scott & Kimberly Gregory',       'yes', NULL, NULL, NULL, '2020-09-01'),
  (2, 6,  'Brad & Jean Smart',              NULL,  NULL, NULL, NULL, NULL),
  (2, 7,  'Mark Potts',                     'yes', NULL, NULL, NULL, '2020-09-01'),
  (2, 8,  'Steve & Diana Rosser',           NULL,  NULL, NULL, NULL, NULL),
  (2, 9,  'Greg & Kim Dye (Isaly)',         'yes', NULL, NULL, NULL, '2020-09-01'),
  (2, 10, 'Craig & Kathy Heath (Anderson)', 'yes', NULL, NULL, NULL, '2020-09-01'),
  (2, 11, 'Ken & Mary Lynn Towers',         'yes', NULL, NULL, NULL, '2020-09-01'),
  (2, 12, 'Brian & Mandy Sieger',           'yes', NULL, NULL, NULL, '2020-09-01'),
  (2, 13, 'Clayton & Leah Childers',        'yes', NULL, NULL, NULL, '2020-09-01'),
  (2, 14, 'Ben & Joy Colvin',               'yes', NULL, NULL, NULL, '2020-09-01'),
  (2, 15, 'Jake & Tammy Upper',             'yes', NULL, NULL, NULL, '2020-09-01'),
  (2, 16, 'Ken Pauly',                      'yes', NULL, NULL, NULL, '2020-09-01'),
  (2, 17, 'Larry & Danielle Rickard',       'yes', NULL, NULL, NULL, '2020-09-01'),
  (2, 18, 'Brian & Janet Wolford',          'yes', NULL, NULL, NULL, '2020-09-01'),
  (2, 19, 'Bobbie Fussichen',               'yes', NULL, NULL, NULL, '2020-09-01'),
  (2, 20, 'Dan & Rachel Gourley',           'yes', NULL, NULL, NULL, '2020-09-01'),
  (2, 21, 'John & Paula Dranschak',         'yes', NULL, NULL, NULL, '2020-09-01'),
  (2, 22, 'Gregg Mambourg',                 NULL,  NULL, NULL, NULL, NULL),
  (2, 23, 'Spencer & Melissa Walton',       'yes', NULL, NULL, NULL, '2020-09-01'),
  (2, 24, 'Stacie & Sean Avner',            NULL,  NULL, NULL, NULL, NULL);


-- =============================================================================
-- EVENT 3: 2026 Board Election (Special Meeting)
-- =============================================================================
INSERT OR IGNORE INTO voting_events (id, slug, type, title, short_title, description, event_date, status, total_parcels, threshold_percent, threshold_label, result_label, has_voting_register, has_signatures, filing_instrument, filing_details, filing_office, filing_date, metadata, url_prefix, sort_order) VALUES (
  3,
  '2026-board-election',
  'board_election',
  'Special Meeting of Members — Board Election',
  '2026 Board Election',
  'A Special Meeting being called by members to elect three Directors to the Board and restore active governance of the Association. The newly elected Board will also elect officers (President, Secretary, Treasurer). Called pursuant to Bylaws §3.02 and Ohio Revised Code §1702.17(A)(3).',
  '2026-05-16',
  'upcoming',
  25,
  NULL,
  NULL,
  NULL,
  1,
  0,
  NULL,
  NULL,
  NULL,
  NULL,
  '{"seats":3,"vote_method":"paper_ballot","max_votes_per_parcel":3,"write_in_allowed":true,"meeting_date":"Saturday, May 16, 2026","meeting_time":"1:00 PM – 3:00 PM","meeting_location":"Delaware County District Library","meeting_location_detail":"Delaware Community Room, 84 E. Winter St, Delaware, OH 43015","meeting_location_note":"NOT the Ostrander Library — Parking is limited; off-site parking is advised.","notice_date":"April 6, 2026","calendar_file":"/governance/2026-board-election/special-meeting.ics","schedule":[{"time":"1:00 PM – 2:00 PM","activity":"Voting takes place. You or your proxy must arrive before 2:00 PM for your vote to be counted."},{"time":"2:00 PM – 2:15 PM","activity":"Vote tally completed and winners announced"},{"time":"2:15 PM – 2:30 PM","activity":"Election of officers by the new Board"},{"time":"2:30 PM – 3:00 PM","activity":"Corporate resolution and meeting adjourned"}],"purpose":[{"title":"Election of Directors","text":"To elect three Directors to the Board of Directors to serve staggered terms of one, two, and three years. The specific term length for each Director will be decided among the elected Board members at the officer election. Per Bylaws §4.01."},{"title":"Election of Officers","text":"The newly elected Board will elect officers (President, Secretary, Treasurer) from among the Directors, per Bylaws §5.01."}],"stagger_note":"Going forward, one Director seat will expire each year, and annual elections will be conducted by mail or email to fill that single seat. This staggered structure ensures continuity of governance in perpetuity, with experienced Board members always serving alongside newly elected Directors.","voting_method_text":"Voting will be conducted by paper ballot. All nominees whose names have been submitted prior to election day will appear on the ballot. Each ballot will also include three blank write-in spaces, allowing voters to nominate and vote for any other qualified and willing candidate directly on their ballot. This serves as an efficient way to make nominations from the floor.","voting_selection_text":"With three Board positions open, each voter selects up to three candidates on their ballot. A voter may choose from the pre-printed nominees, write in up to three names, or any combination thereof. The three candidates receiving the most votes when voting ends at 2:00 PM will be elected to the Board of Directors.","voting_attendance_text":"You do not need to be present for the entire meeting. Simply arrive during the voting window (1:00–2:00 PM), cast your ballot, and you are free to leave. Results will be published on the Association website after the meeting. Two volunteer vote tally takers from the membership will independently count the ballots, confirm results with each other, and announce the winners.","winners_text":"Per Bylaws §3.08, the candidates receiving the greatest percentage of votes cast shall be elected. The three candidates with the most votes will be elected to the Board of Directors. Every vote matters — the outcome of this election will be shaped by the Members who participate.","participation_appeal":"We are aiming for full participation from all 25 voting Members. Whether you attend in person or designate a proxy, please make sure your vote is counted. This is your opportunity to have a direct say in who will lead the Association going forward.","authority_text":"The corporate reactivation of Walden''s Revisited Inc. has been completed, and the corporation is once again Active per the Ohio Secretary of State. This Special Meeting is being held to elect a new Board of Directors and restore governance of the Association for the benefit of all Members.","authority_legal":"This Special Meeting is being called by Members of the Association pursuant to Bylaws §3.02 and Ohio Revised Code §1702.17(A)(3), which permits the lesser of 10% or 25 voting members to call a meeting. With 25 voting parcels in the Subdivision, three Members representing distinct parcels satisfy this threshold.","authority_context":"Under normal circumstances, elections would be conducted by the Board of Directors through mail or email balloting. However, because there is currently no functioning Board, a Special Meeting of the Members is the only available mechanism under Ohio law and our Bylaws to hold an election and restore governance.","called_by":[{"name":"Sean Avner","address":"Tract 27, 420 Brindle Rd"},{"name":"Kabron Kline","address":"Tract 25, 480 Brindle Rd"},{"name":"John F. Dranschak","address":"Tract 24, 494 Brindle Rd"}],"proxy_text":"If you are unable to attend in person, you may appoint a proxy to vote on your behalf. To be valid, your proxy must be in writing, signed by the Owner(s), and filed with the Secretary of the meeting before or at the time of the meeting. Per Ohio Revised Code §1702.24, a proxy is valid for 11 months from the date of signature unless an earlier end date is specified.","proxy_return":"Return completed proxy forms to: Kabron Kline — 480 Brindle Rd, Delaware, OH 43015 — elections@waldensrevisited.org. Email is preferable. Proxy forms must be received prior to the day of the meeting.","nomination_text":"Additional nominees are welcome. Submit nominations by email to elections@waldensrevisited.org, by mail to 480 Brindle Rd, Delaware, OH 43015, or in person at the same address. Nominations may also be made from the floor at the meeting. A Nomination Form is included in the meeting notice PDF.","info_note":"Every Owner of a Lot or Tract is a Member entitled to one vote per Lot or Tract owned. All current Owners are in good standing. Your participation — either in person or by proxy — is important. Please either attend in person or return your completed proxy form to ensure your vote is counted.","contact":"Kabron Kline at elections@waldensrevisited.org or 480 Brindle Rd, Delaware, OH 43015"}',
  '/governance/2026-board-election',
  3
);

-- Stats for 2026 election
INSERT OR IGNORE INTO voting_event_stats (event_id, label, value, sort_order) VALUES
  (3, 'Voting Parcels', '25', 1),
  (3, 'Director Seats', '3', 2);

-- Candidates for 2026 election
INSERT OR IGNORE INTO voting_event_candidates (event_id, name, address_label, address_id, elected, position, sort_order) VALUES
  (3, 'Kabron Kline',       'Tract 25 — 480 Brindle Rd', 22,   0, NULL, 1),
  (3, 'Bobbie Fussichen',   'Tract 22 — 554 Brindle Rd', 19,   0, NULL, 2),
  (3, 'John F. Dranschak',  'Tract 24 — 494 Brindle Rd', 21,   0, NULL, 3);

-- Documents for 2026 election
INSERT OR IGNORE INTO voting_event_documents (event_id, label, url, type, sort_order) VALUES
  (3, 'View Meeting Notice',        '/governance/2026-board-election/Special_Meeting_Notice_Complete.pdf', 'pdf_viewer', 1),
  (3, 'Certificate of Good Standing', '/governance/2026-board-election/CertificateOfGoodStanding2026.pdf', 'pdf_viewer', 2),
  (3, 'Download Proxy Form',        '/governance/2026-board-election/Proxy_Voting_Form_Fillable.pdf',     'download',   3),
  (3, 'Download Nomination Form',   '/governance/2026-board-election/Nomination_Form_Fillable.pdf',       'download',   4),
  (3, 'Add to Calendar',            '/governance/2026-board-election/special-meeting.ics',                 'download',   5);

-- Voting records for 2026 (all NULL/upcoming — 25 parcels)
INSERT OR IGNORE INTO voting_records (event_id, address_id, owner_name_at_vote, vote, signer_key, parcel_number, signature_image_url, voted_at) VALUES
  (3, 1,  'Current Owner', NULL, NULL, NULL, NULL, NULL),
  (3, 2,  'Current Owner', NULL, NULL, NULL, NULL, NULL),
  (3, 3,  'Current Owner', NULL, NULL, NULL, NULL, NULL),
  (3, 4,  'Current Owner', NULL, NULL, NULL, NULL, NULL),
  (3, 5,  'Current Owner', NULL, NULL, NULL, NULL, NULL),
  (3, 6,  'Current Owner', NULL, NULL, NULL, NULL, NULL),
  (3, 7,  'Current Owner', NULL, NULL, NULL, NULL, NULL),
  (3, 8,  'Current Owner', NULL, NULL, NULL, NULL, NULL),
  (3, 9,  'Current Owner', NULL, NULL, NULL, NULL, NULL),
  (3, 10, 'Current Owner', NULL, NULL, NULL, NULL, NULL),
  (3, 11, 'Current Owner', NULL, NULL, NULL, NULL, NULL),
  (3, 12, 'Current Owner', NULL, NULL, NULL, NULL, NULL),
  (3, 13, 'Current Owner', NULL, NULL, NULL, NULL, NULL),
  (3, 14, 'Current Owner', NULL, NULL, NULL, NULL, NULL),
  (3, 15, 'Current Owner', NULL, NULL, NULL, NULL, NULL),
  (3, 16, 'Current Owner', NULL, NULL, NULL, NULL, NULL),
  (3, 17, 'Current Owner', NULL, NULL, NULL, NULL, NULL),
  (3, 18, 'Current Owner', NULL, NULL, NULL, NULL, NULL),
  (3, 19, 'Current Owner', NULL, NULL, NULL, NULL, NULL),
  (3, 20, 'Current Owner', NULL, NULL, NULL, NULL, NULL),
  (3, 21, 'Current Owner', NULL, NULL, NULL, NULL, NULL),
  (3, 22, 'Current Owner', NULL, NULL, NULL, NULL, NULL),
  (3, 23, 'Current Owner', NULL, NULL, NULL, NULL, NULL),
  (3, 24, 'Current Owner', NULL, NULL, NULL, NULL, NULL),
  (3, 26, 'Current Owner', NULL, NULL, NULL, NULL, NULL);
