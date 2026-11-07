/* Study Browser – "Unblock" proxy for Cloudflare Workers (free).
   Paste this whole file into a new Worker and press Deploy. */
const SECRET = "";   // optional password. If you set one here, type the same one in the app.

const STRIP = ['x-frame-options','content-security-policy','content-security-policy-report-only',
  'cross-origin-opener-policy','cross-origin-embedder-policy','cross-origin-resource-policy',
  'set-cookie','report-to','nel','permissions-policy'];

/* runs INSIDE the proxied page: routes fetch/XHR/links back through the proxy */
function client(P, B) {
  var px = function (u) {

    try { var a = new URL(u, B);
      if (!/^https?:$/.test(a.protocol) || String(u).indexOf(P) === 0) return u;
      return P + encodeURIComponent(a.href); } catch (e) { return u; }
  };
  var F = window.fetch;
  window.fetch = function (i, o) {
    try {
      if (typeof i === 'string' || i instanceof URL) return F.call(this, px(String(i)), o);
      if (i && i.url) return F.call(this, new Request(px(i.url), i), o);
    } catch (e) {}
    return F.apply(this, arguments);
  };
  var O = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) { var a = [].slice.call(arguments); a[1] = px(String(u)); return O.apply(this, a); };
  window.open = function (u) { if (u) location.href = px(String(u)); return null; };
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
    var r = a.getAttribute('href');
    if (!r || /^(javascript|mailto|tel|data|blob):/i.test(r)) return;
    if (r.charAt(0) === '#') { e.preventDefault(); var el = document.getElementById(r.slice(1)); if (el) el.scrollIntoView(); return; }
    if (r.indexOf(P) === 0) return;
    e.preventDefault(); location.href = px(a.href);
  }, true);
}

export default {
  async fetch(req) {
    const me = new URL(req.url);
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS,HEAD',
                   'access-control-allow-headers': '*', 'access-control-expose-headers': '*' };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const raw = me.searchParams.get('url');
    if (!raw) return new Response('Study Browser proxy is running OK.\nUse /?url=https://example.com',
      { headers: { 'content-type': 'text/plain;charset=utf-8', ...cors } });
    if (SECRET && me.searchParams.get('k') !== SECRET) return new Response('Wrong password', { status: 403, headers: cors });
    let target; try { target = new URL(raw); } catch (e) { return new Response('Bad url', { status: 400, headers: cors }); }
    if (!/^https?:$/.test(target.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(target.hostname))
      return new Response('Blocked address', { status: 400, headers: cors });
    for (const [k, v] of me.searchParams) if (k !== 'url' && k !== 'k') target.searchParams.append(k, v);   // GET forms / searches

    const P = me.origin + '/?' + (SECRET ? 'k=' + encodeURIComponent(SECRET) + '&' : '') + 'url=';
    const px = (u, base) => { try { const a = new URL(u, base || target); return /^https?:$/.test(a.protocol) ? P + encodeURIComponent(a.href) : u; } catch (e) { return u; } };

    const h = new Headers();
    for (const n of ['accept', 'accept-language', 'range', 'content-type', 'if-none-match', 'if-modified-since'])
      if (req.headers.get(n)) h.set(n, req.headers.get(n));
    h.set('user-agent', req.headers.get('user-agent') || 'Mozilla/5.0');
    h.set('referer', target.origin + '/');

    let r;
    try { r = await fetch(target.href, { method: req.method, headers: h, redirect: 'manual',
            body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : req.body }); }
    catch (e) { return new Response('Could not reach the website: ' + e.message, { status: 502, headers: cors }); }

    const oh = new Headers(r.headers);
    STRIP.forEach(n => oh.delete(n)); oh.delete('content-length');
    for (const k in cors) oh.set(k, cors[k]);

    if (r.status >= 300 && r.status < 400 && oh.get('location')) {
      oh.set('location', px(oh.get('location'))); return new Response(null, { status: r.status, headers: oh });
    }
    if (!(oh.get('content-type') || '').toLowerCase().includes('text/html'))
      return new Response(r.body, { status: r.status, headers: oh });

    const inject = '<base href="' + target.href.replace(/"/g, '%22') + '"><script>(' + client.toString() + ')(' +
                   JSON.stringify(P) + ',' + JSON.stringify(target.href) + ')<\/script>';
    class Attr { constructor(a) { this.a = a; }
      element(e) { const v = e.getAttribute(this.a);
        if (v && v.charAt(0) !== '#' && !/^(javascript|data|blob|mailto|tel):/i.test(v)) e.setAttribute(this.a, px(v)); } }
    return new HTMLRewriter()
      .on('head', { element(e) { e.prepend(inject, { html: true }); } })
      .on('a[href],area[href]', new Attr('href'))
      .on('form[action]', new Attr('action'))
      .on('iframe[src],frame[src]', new Attr('src'))
      .on('meta[http-equiv]', { element(e) {
          const t = (e.getAttribute('http-equiv') || '').toLowerCase();
          if (t === 'content-security-policy') e.remove();
          if (t === 'refresh') e.setAttribute('content', (e.getAttribute('content') || '').replace(/url=(.+)$/i, (m, u) => 'url=' + px(u.trim())));
      } })
      .transform(new Response(r.body, { status: r.status, headers: oh }));
  }
};

