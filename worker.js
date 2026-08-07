/**
 * TimeLive on Cloudflare Workers: static assets + Jira worklog proxy (same origin, no CORS).
 * Deploy: npx wrangler deploy
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS' && isJiraApiPath(url.pathname)) {
      return withCors(new Response(null, { status: 204 }), request);
    }

    if (request.method === 'POST' && isJiraWorklogPath(url.pathname)) {
      return handleJiraWorklogProxy(request);
    }

    if (request.method === 'POST' && isJiraIssuesForDatePath(url.pathname)) {
      return handleJiraIssuesForDate(request);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('TimeLive worker: assets binding missing.', { status: 500 });
  },
};

function isJiraApiPath(pathname) {
  return isJiraWorklogPath(pathname) || isJiraIssuesForDatePath(pathname);
}

function isJiraWorklogPath(pathname) {
  return pathname === '/api/jira/worklog' || pathname === '/api/jira/worklog/';
}

function isJiraIssuesForDatePath(pathname) {
  return pathname === '/api/jira/issues-for-date' || pathname === '/api/jira/issues-for-date/';
}

async function handleJiraWorklogProxy(request) {
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
}

async function handleJiraIssuesForDate(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return withCors(jsonResponse({ error: 'Invalid JSON body' }, 400), request);
  }

  const baseUrl = normalizeBaseUrl(body.baseUrl);
  const email = String(body.email || '').trim();
  const token = String(body.token || '').trim();
  const dateStr = String(body.date || body.dateStr || '').trim();

  if (!baseUrl || !isAtlassianNet(baseUrl)) {
    return withCors(jsonResponse({ error: 'Invalid Jira base URL' }, 400), request);
  }
  if (!email || !token) {
    return withCors(jsonResponse({ error: 'Missing email or API token' }, 400), request);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return withCors(jsonResponse({ error: 'Invalid date (expected YYYY-MM-DD)' }, 400), request);
  }

  const jql = `worklogAuthor = currentUser() AND worklogDate = "${dateStr}" ORDER BY updated DESC`;
  const jiraUrl = `${baseUrl}/rest/api/3/search/jql`;
  const auth = btoa(`${email}:${token}`);

  let jiraRes;
  try {
    jiraRes = await fetch(jiraUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jql,
        maxResults: 50,
        fields: ['summary', 'key'],
      }),
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
}

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
