// Signer data for dynamic OG tags on individual vote record URLs
const signerData = {
  'lot-1-snyder':        { type:'Lot',   num:'1',     owner:'David & Corey Snyder',           address:'423 Brindle Road' },
  'tract-1-mull':        { type:'Tract', num:'1',     owner:'Jim & Stacia Mull',              address:'475 Brindle Road' },
  'lot-2-3-boles':       { type:'Lot',   num:'2/3',   owner:'Ryan & Betsy Boles',             address:'427 Brindle Road' },
  'tract-3-tryon':       { type:'Tract', num:'3',     owner:'Steve & Tammy Tryon',            address:'505 Brindle Road' },
  'lot-4-gregory':       { type:'Lot',   num:'4',     owner:'Scott & Kimberly Gregory',       address:'431 Brindle Road' },
  'tract-5-potts':       { type:'Tract', num:'5',     owner:'Mark Potts',                     address:'Brindle Road' },
  'tract-7-dye':         { type:'Tract', num:'7',     owner:'Greg & Kim Dye (Isaly)',         address:'Brindle Road' },
  'tract-8-heath':       { type:'Tract', num:'8',     owner:'Craig & Kathy Heath (Anderson)', address:'623 Brindle Road' },
  'tract-9-towers':      { type:'Tract', num:'9',     owner:'Ken & Mary Lynn Towers',         address:'661 Brindle Road' },
  'tract-10-11-sieger':  { type:'Tract', num:'10/11', owner:'Brian & Mandy Sieger',           address:'675 Brindle Road' },
  'tract-12-childers':   { type:'Tract', num:'12',    owner:'Clayton & Leah Childers',        address:'6810 Houseman Rd' },
  'tract-13-colvin':     { type:'Tract', num:'13',    owner:'Ben & Joy Colvin',               address:'6724 Houseman Rd' },
  'tract-14-upper':      { type:'Tract', num:'14',    owner:'Jake & Tammy Upper',             address:'6720 Houseman Rd' },
  'tract-20-rickard':    { type:'Tract', num:'20',    owner:'Larry & Danielle Rickard',       address:'7070 Slocum Road' },
  'tract-21-wolford':    { type:'Tract', num:'21',    owner:'Brian & Janet Wolford',          address:'7058 Slocum Road' },
  'tract-22-fussichen':  { type:'Tract', num:'22',    owner:'Bobbie Fussichen',               address:'554 Brindle Road' },
  'tract-23-gourley':    { type:'Tract', num:'23',    owner:'Dan & Rachel Gourley',           address:'510 Brindle Road' },
  'tract-24-dranschak':  { type:'Tract', num:'24',    owner:'John & Paula Dranschak',         address:'494 Brindle Road' },
  'tract-26-walton':     { type:'Tract', num:'26',    owner:'Spencer & Melissa Walton',       address:'440 Brindle Road' },
  'tract-27-avner':      { type:'Tract', num:'27',    owner:'Stacie & Sean Avner',            address:'420 Brindle Road' },
};

const VOTE_BASE = '/votes/2019-restated-declaration';

// HTMLRewriter handler to replace OG meta tag content attributes
class OGMetaRewriter {
  constructor(replacements) {
    this.replacements = replacements;
  }
  element(el) {
    const property = el.getAttribute('property') || '';
    const name = el.getAttribute('name') || '';
    const key = property || name;
    if (this.replacements[key]) {
      el.setAttribute('content', this.replacements[key]);
    }
  }
}

// HTMLRewriter handler to replace <title> text
class TitleRewriter {
  constructor(newTitle) {
    this.newTitle = newTitle;
  }
  element(el) {
    el.setInnerContent(this.newTitle);
  }
}

// HTMLRewriter handler to inject a script before </body>
class BodyEndRewriter {
  constructor(signerKey) {
    this.signerKey = signerKey;
  }
  element(el) {
    el.prepend(`<script>window.__signerKey = '${this.signerKey}';</script>`, { html: true });
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const userAgent = request.headers.get('user-agent') || '';
    const referer = request.headers.get('referer') || '';
    const country = request.cf?.country || '';
    const city = request.cf?.city || '';
    const region = request.cf?.region || '';
    const asn = request.cf?.asn || '';
    const colo = request.cf?.colo || '';

    // Log visitor data — captured by Workers Logs (viewable in CF dashboard)
    console.log(JSON.stringify({
      type: 'pageview',
      timestamp: new Date().toISOString(),
      ip: ip,
      path: url.pathname,
      query: url.search || '',
      method: request.method,
      userAgent: userAgent,
      referer: referer,
      country: country,
      city: city,
      region: region,
      asn: asn,
      colo: colo,
    }));

    // Check for individual signer URLs: /votes/2019-restated-declaration/{signer-key}
    const pathname = url.pathname.replace(/\/$/, ''); // strip trailing slash
    if (pathname.startsWith(VOTE_BASE + '/') && pathname !== VOTE_BASE) {
      const signerKey = pathname.substring(VOTE_BASE.length + 1);
      const signer = signerData[signerKey];

      if (signer) {
        // Fetch the base vote page HTML
        const baseUrl = new URL(VOTE_BASE + '/', url.origin);
        const response = await env.ASSETS.fetch(new Request(baseUrl.toString(), request));

        const ownerName = signer.owner;
        const tractLabel = signer.type + ' ' + signer.num;
        const newTitle = `${ownerName} (${tractLabel}) — 2019 Restated Declaration Vote — Walden's Revisited`;
        const newOgTitle = `${ownerName} — Signed the 2019 Restated Declaration`;
        const newOgDesc = `${ownerName} (${tractLabel}, ${signer.address}) voted to adopt the Restated Declaration of Protective Covenants & Restrictions for Walden's Revisited on March 9, 2019.`;
        const newOgUrl = `https://waldensrevisited.org${VOTE_BASE}/${signerKey}`;

        const rewritten = new HTMLRewriter()
          .on('title', new TitleRewriter(newTitle))
          .on('meta[property="og:title"]', new OGMetaRewriter({ 'og:title': newOgTitle }))
          .on('meta[property="og:description"]', new OGMetaRewriter({ 'og:description': newOgDesc }))
          .on('meta[property="og:url"]', new OGMetaRewriter({ 'og:url': newOgUrl }))
          .on('meta[name="description"]', new OGMetaRewriter({ 'description': newOgDesc }))
          .on('body', new BodyEndRewriter(signerKey))
          .transform(response);

        return rewritten;
      }
    }

    // Serve the static asset
    return env.ASSETS.fetch(request);
  },
};
