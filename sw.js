/* 단서 메신저 서비스워커 — 구형 폰에서도 읽히도록 ES5 문법만 쓴다.

   이번 판에서 바꾼 것 (앱이 "연결할 수 없음" 으로 안 열리던 문제)
   1) 화면(문서)은 캐시를 먼저 내준다.
      예전에는 서버를 먼저 찔러 보고 실패하면 캐시로 갔는데, 캐시까지 비어 있으면
      브라우저에 "연결할 수 없음" 이 떴다. 이제는 캐시에 있으면 무조건 바로 열리고,
      새 내용은 뒤에서 조용히 받아 다음 실행 때 반영된다.
   2) 어떤 경우에도 통신 오류를 그대로 돌려주지 않는다.
      정말 아무것도 없을 때만 안내 문구가 담긴 화면을 보여 준다.
   3) 캐시 이름이 'cs2-' 로 시작한다.
      예전 카카오톡 서비스워커가 'crimescene-' 로 시작하는 캐시를 전부 자기 것으로 보고
      지워 버려서, 한 폰에 여러 앱을 깔면 서로의 캐시가 사라졌다. 이름대를 분리했다. */

var PREFIX = 'cs2-insta-';
var VER = (function () {
  try {
    var m = String(self.location.search || '').match(/[?&]v=([^&]*)/);
    return m ? decodeURIComponent(m[1]) : 'dev';
  } catch (e) { return 'dev'; }
})();
var CACHE = PREFIX + VER;
var ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './logo.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

function isMine(k) { return k.indexOf(PREFIX) === 0; }

/* 서버에서 "진짜로 새로" 받아 캐시에 넣는다.
   cache.add 를 쓰면 브라우저가 들고 있던 옛 복사본이 그대로 들어가 버리므로,
   주소 끝에 매번 다른 꼬리표를 붙이고 cache: 'reload' 도 함께 준다. */
function addFresh(cache, url) {
  var bust = url + (url.indexOf('?') >= 0 ? '&' : '?') + '_sw=' + Date.now().toString(36);
  var opts = { credentials: 'same-origin' };
  try { opts.cache = 'reload'; } catch (e) {}
  return fetch(bust, opts).then(function (res) {
    if (!res || !res.ok) return;
    return cache.put(new Request(url), res);
  })['catch'](function () {});
}

self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      var jobs = [];
      for (var i = 0; i < ASSETS.length; i++) {
        jobs.push(addFresh(cache, ASSETS[i]));
      }
      return Promise.all(jobs);
    })['catch'](function () {})
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      var jobs = [];
      for (var i = 0; i < keys.length; i++) {
        if (isMine(keys[i]) && keys[i] !== CACHE) jobs.push(caches['delete'](keys[i]));
      }
      return Promise.all(jobs);
    })['catch'](function () {}).then(function () {
      return self.clients.claim();
    })
  );
});

function isDocReq(req, path) {
  if (req.mode === 'navigate') return true;
  if (path.charAt(path.length - 1) === '/') return true;
  return /\.(html|webmanifest)$/.test(path);
}

/* 정말 아무것도 없을 때 보여 줄 화면 — 브라우저 오류 대신 읽을 수 있는 안내를 준다 */
function lastResort() {
  var html = '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>잠시만요</title></head><body style="margin:0;font-family:sans-serif;' +
    'display:flex;align-items:center;justify-content:center;height:100vh;background:#f4f5f7;color:#2a3a4a">' +
    '<div style="text-align:center;padding:24px;line-height:1.7">' +
    '<div style="font-size:17px;font-weight:700;margin-bottom:8px">아직 받아 둔 내용이 없습니다</div>' +
    '<div style="font-size:14px;color:#6a7a8a">와이파이를 한 번 연결한 뒤 앱을 다시 열면<br>' +
    '내용이 폰에 저장되어, 그다음부터는 와이파이 없이도 열립니다.</div></div></body></html>';
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/* 뒤에서 조용히 새 내용을 받아 캐시에 넣어 둔다 (다음 실행 때 반영) */
function refresh(path) {
  try {
    fetch(path + '?_sw=' + Date.now().toString(36), { credentials: 'same-origin' })
      .then(function (fresh) {
        if (!fresh || !fresh.ok) return;
        var copy = fresh.clone();
        return caches.open(CACHE).then(function (cache) { return cache.put(new Request(path), copy); });
      })['catch'](function () {});
  } catch (e) {}
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var href = req.url;
  if (href.indexOf(self.location.origin) !== 0) return;   /* 다른 주소는 손대지 않는다 */

  /* 새 파일 확인(_uc)·파일 만들기(_ex) 요청은 서버 파일을 그대로 읽어야 하므로 지나간다 */
  if (href.indexOf('_uc=') >= 0 || href.indexOf('_ex=') >= 0) return;
  if (href.indexOf('_fresh=') >= 0) return;             /* 새 파일로 다시 열기 — 반드시 서버에서 받는다 */
  if (href.indexOf('_sw=') >= 0) return;                  /* 우리가 뒤에서 보낸 요청 */

  var path = href.split('#')[0].split('?')[0];
  var doc = isDocReq(req, path);

  event.respondWith(
    caches.match(doc ? path : req, { ignoreSearch: true }).then(function (hit) {
      if (hit) {
        if (doc) refresh(path);          /* 바로 열어 주고, 새 내용은 뒤에서 받는다 */
        return hit;
      }
      /* 캐시에 없으면 서버에서 받아 와 넣어 둔다 */
      return fetch(req).then(function (fresh) {
        if (fresh && fresh.ok) {
          var copy = fresh.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put(doc ? new Request(path) : req, copy);
          })['catch'](function () {});
        }
        return fresh;
      })['catch'](function () {
        /* 서버도 못 가고 캐시도 없을 때 — 그래도 오류 화면은 띄우지 않는다 */
        if (!doc) return new Response('', { status: 504, statusText: 'offline' });
        return caches.match('./index.html', { ignoreSearch: true }).then(function (h2) {
          return h2 || lastResort();
        });
      });
    })['catch'](function () {
      return doc ? lastResort() : new Response('', { status: 504, statusText: 'offline' });
    })
  );
});