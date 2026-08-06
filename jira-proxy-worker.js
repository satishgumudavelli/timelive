/**
 * Cloudflare Worker — Jira worklog proxy for TimeLive (GitHub Pages).
 * Deploy: wrangler deploy (or paste into Cloudflare dashboard → Workers → Create).
 * Then set the worker URL in TimeLive → Jira settings → Proxy URL.
 */
export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), request);
    }
    if (request.method !== 'POST') {
      return withCors(jsonResponse({ error: 'Method not allowed' }, 405), request);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return withCors(jsonResponse({ error: 'Invalid JSON body' }, 400), request);
    }

    const baseUrl = normalizeBaseUrl(body.baseUrl);
    const email = String(body.email || '').trim();
    const token = String(body.token || '').trim();
    const issueKey = String(body.issueKey || '').trim().toUpperCase();
    const startAt = Math.max(0, parseInt(body.startAt, 10) || 0);
    const maxResults = Math.min(100, Math.max(1, parseInt(body.maxResults, 10) || 100));

    if (!baseUrl || !isAtlassianNet(baseUrl)) {
      return withCors(jsonResponse({ error: 'Invalid Jira base URL' }, 400), request);
    }
    if (!email || !token) {
      return withCors(jsonResponse({ error: 'Missing email or API token' }, 400), request);
    }
    if (!/^[A-Z][A-Z0-9]+-\d+$/.test(issueKey)) {
      return withCors(jsonResponse({ error: 'Invalid issue key' }, 400), request);
    }

    const jiraUrl = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog?startAt=${startAt}&maxResults=${maxResults}`;
    const auth = btoa(`${email}:${token}`);

    let jiraRes;
    try {
      jiraRes = await fetch(jiraUrl, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
        },
      });
    } catch {
      return withCors(jsonResponse({ error: 'Failed to reach Jira' }, 502), request);
    }

    const text = await jiraRes.text();
    return withCors(
      new Response(text, {
        status: jiraRes.status,
        headers: { 'Content-Type': jiraRes.headers.get('Content-Type') || 'application/json' },
      }),
      request
    );
  },
};

function normalizeBaseUrl(url) {
  let u = String(url || '').trim().replace(/\/$/, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

function isAtlassianNet(url) {
  try {
    return new URL(url).hostname.endsWith('.atlassian.net');
  } catch {
    return false;
  }
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function withCors(response, request) {
  const headers = new Headers(response.headers);
  const origin = request.headers.get('Origin');
  headers.set('Access-Control-Allow-Origin', origin || '*');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Accept');
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(response.body, { status: response.status, headers });
}
