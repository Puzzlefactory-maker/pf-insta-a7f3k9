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

/* 뒤에서 조용히 새 내용을 받아 캐시에 넣어 둔다 */
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

/* 화면(문서)은 “서버 먼저, 안 되면 캐시” 로 가져온다.
   · 인터넷이 되면 → 올린 새 파일이 그 자리에서 바로 반영된다
   · 인터넷이 없거나 느리면 → DOC_WAIT(ms) 만 기다렸다가 캐시로 연다 (예전처럼 바로 열림)
   예전에는 캐시를 먼저 내주느라, 새 파일을 올려도 “한 번 더 열어야” 반영됐다. */
var DOC_WAIT = 2000;
function cachedDoc(path) {
  return caches.match(path, { ignoreSearch: true }).then(function (hit) {
    if (hit) return hit;
    return caches.match('./index.html', { ignoreSearch: true }).then(function (h2) {
      return h2 || lastResort();
    });
  })['catch'](function () { return lastResort(); });
}
function docResponse(path) {
  return new Promise(function (resolve) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;                       /* 너무 오래 걸리면 일단 캐시로 연다 */
      resolve(cachedDoc(path));
    }, DOC_WAIT);
    var opts = { credentials: 'same-origin' };
    try { opts.cache = 'reload'; } catch (e) {}   /* 브라우저가 들고 있던 옛 복사본을 쓰지 않는다 */
    fetch(path + '?_sw=' + Date.now().toString(36), opts).then(function (fresh) {
      if (!fresh || !fresh.ok) throw new Error('bad');
      var copy = fresh.clone();
      caches.open(CACHE).then(function (cache) {
        return cache.put(new Request(path), copy);
      })['catch'](function () {});
      if (settled) return;                  /* 이미 캐시로 열었으면 캐시만 갱신해 둔다 */
      settled = true; clearTimeout(timer);
      resolve(fresh);
    })['catch'](function () {
      if (settled) return;
      settled = true; clearTimeout(timer);
      resolve(cachedDoc(path));
    });
  });
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

  /* 화면(문서)은 서버 먼저 — 올린 새 파일이 바로 반영된다 (안 되면 캐시로) */
  if (doc) { event.respondWith(docResponse(path)); return; }

  /* 그 밖의 파일(아이콘·매니페스트 등)은 캐시 먼저 — 빨리 열리고 오프라인에서도 뜬다 */
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (fresh) {
        if (fresh && fresh.ok) {
          var copy = fresh.clone();
          caches.open(CACHE).then(function (cache) {
            return cache.put(req, copy);
          })['catch'](function () {});
        }
        return fresh;
      })['catch'](function () {
        return new Response('', { status: 504, statusText: 'offline' });
      });
    })['catch'](function () {
      return new Response('', { status: 504, statusText: 'offline' });
    })
  );
});