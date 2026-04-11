-- Seed documents data (governance, corporate, legal, historical)
-- file_hash will be populated by the baseline zip creation script after files are uploaded to R2
-- Until then, external_url points to the existing static file paths

-- Governing Documents
INSERT OR IGNORE INTO documents (id, slug, title, description, category, file_hash, external_url, date, metadata, sort_order) VALUES
(1, 'restated-declaration-2019', 'Restated Declaration of Protective Covenants & Restrictions', 'Instrument #2019-00009690. Delaware County Recorder''s Office. Includes attached Bylaws (16-page Code of Regulations).', 'governing', NULL, '/restated-declaration-2019.pdf', '2019-03-09', '{"instrument":"2019-00009690","office":"Delaware County Recorder''s Office","pages":52}', 1),
(2, 'metes-and-bounds-2018', 'Metes and Bounds — Common Area', 'Legal description and survey of the common use easement areas within Walden''s Revisited.', 'governing', NULL, '/metes-and-bounds-2018.pdf', '2018-01-01', NULL, 2);

-- Corporate Filings
INSERT OR IGNORE INTO documents (id, slug, title, description, category, file_hash, external_url, date, metadata, sort_order) VALUES
(3, 'certificate-good-standing-2026', 'Certificate of Good Standing', 'Ohio Secretary of State certifies Walden''s Revisited Inc. (Charter #1049975, incorporated Dec 3, 1998) is in Good Standing. Validation #202609603286.', 'corporate', NULL, '/governance/certificate-good-standing-2026.pdf', '2026-04-06', '{"charter":"1049975","validation":"202609603286"}', 1),
(4, 'reinstatement-2026', 'Reinstatement Certificate', 'Walden''s Revisited Inc. reinstated with the Ohio Secretary of State. Document #202609203216. Filing fee $25.00.', 'corporate', NULL, '/governance/reinstatement-2026.pdf', '2026-04-02', '{"document_number":"202609203216"}', 2),
(5, 'agent-appointment-2019', 'Subsequent Agent Appointment', 'Appointment of John F. Dranschak as new statutory agent for Walden''s Revisited Inc. (Charter #1049975). Document #201922602544.', 'corporate', NULL, '/governance/agent-appointment-2019.pdf', '2019-08-14', '{"document_number":"201922602544","charter":"1049975","agent":"John F. Dranschak"}', 3),
(6, 'articles-of-incorporation-1998', 'Articles of Incorporation', 'Original Articles of Incorporation for Walden''s Revisited, Inc. filed with Ohio Secretary of State Bob Taft. Nonprofit corporation under ORC 1702.01. Charter #1049975. Document #199831401480.', 'corporate', NULL, '/governance/articles-of-incorporation-1998.pdf', '1998-11-30', '{"charter":"1049975","document_number":"199831401480"}', 4);

-- Legal References
INSERT OR IGNORE INTO documents (id, slug, title, description, category, file_hash, external_url, date, metadata, sort_order) VALUES
(7, 'legal-advisory-martin-2023', 'Attorney Correspondence — Stephen D. Martin, Esq.', 'Legal opinion on the validity of the 2019 Restated Declaration and dissolution requirements under Ohio law.', 'legal', NULL, '/governance/legal-advisory-martin-2023.pdf', '2023-01-01', '{"attorney":"Stephen D. Martin, Esq.","highlights":["Restated Declaration is valid (21/27 lots = 77.78% exceeds 75% threshold)","100% consent required to dissolve the HOA (not 80%)","HOA required by Ohio law due to common elements (roads, drainage, easements)","Three-step dissolution process: member vote, board resolution, county recorder filing"]}', 1),
(8, 'ohio-rc-5312-05', 'Ohio Revised Code § 5312.05', 'Statute governing amendment and termination of planned community declarations under Ohio law.', 'legal', NULL, '/governance/ohio-rc-5312-05.pdf', '2022-01-01', '{"highlights":["75% of lot owners required to amend the declaration","100% (unanimous) consent required to terminate/dissolve","Amendments must be recorded with the county recorder","Applies to all planned communities in Ohio"]}', 2),
(9, 'ohio-planned-community-act', 'Ohio Planned Community Act (RC Chapter 5312)', 'The state law governing planned communities, including Walden''s Revisited.', 'legal', NULL, NULL, NULL, '{"external_url":"https://codes.ohio.gov/ohio-revised-code/chapter-5312","highlights":["Defines rights and obligations of planned community associations","Establishes voting requirements for governance decisions","Provides framework for assessment collection and enforcement"]}', 3);

-- Historical Documents
INSERT OR IGNORE INTO documents (id, slug, title, description, category, file_hash, external_url, date, metadata, sort_order) VALUES
(10, 'original-declaration-2015', 'Original Declaration of Protective Covenants', 'The original declaration, superseded by the 2019 Restated Declaration.', 'historical', NULL, '/original-declaration-2015.pdf', '2015-08-24', NULL, 1),
(11, 'plat-map-2016', 'Plat Map', 'Recorded plat map showing lot and tract boundaries for Walden''s Revisited subdivision.', 'historical', NULL, '/plat-map-2016.pdf', '2016-01-01', NULL, 2),
(12, 'original-flyer', 'Original Marketing Flyer', 'The original marketing flyer for the Walden''s Revisited development.', 'historical', NULL, '/original-flyer.pdf', '2014-01-01', NULL, 3);
