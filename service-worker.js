/* service-worker.js — Carnet EPS
   BIBLE règle 5 : versionné, cache-first + revalidation en arrière-plan sur la navigation
   (A39 : pas d'attente réseau bloquante), network-first sur le manifest, cache-first sur les
   assets, purge des vieux caches à l'activation (jamais de version morte).
   ⚠ Incrémenter VERSION à chaque déploiement (synchroniser avec VERSION_APP de state.js).
   Non enregistré sur localhost (voir main.js, décision D008). */

const VERSION = '0.13.3';
const CACHE = `carnet-eps-${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/base.css',
  './css/components.css',
  './css/responsive.css',
  './js/main.js',
  './js/state.js',
  './js/ui.js',
  './js/io.js',
  './js/metier.js',
  './js/grilles-calcul.js',
  './js/modules/grilles.js',
  './js/media.js',
  './js/modules/sauvegarde.js',
  './js/modules/reglages.js',
  './js/modules/eleves.js',
  './js/modules/edt.js',
  './js/modules/sequences.js',
  './js/modules/appel.js',
  './js/modules/inaptitudes.js',
  './js/modules/notes.js',
  './js/modules/accueil.js',
  './js/modules/documents.js',
  './js/modules/observations.js',
  './data/exemple_eleves_pronote.csv',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-512-maskable.png',
];

// Une réponse n'est mise en cache que si elle vient bien de NOTRE serveur, sans redirection :
// une page de blocage (proxy scolaire, portail captif) répondait 200 et devenait le filet hors
// ligne de toute la version (audit 2026-09-07, A19).
const cachable = (rep) => rep.ok && rep.type === 'basic' && !rep.redirected;

// Écriture en cache hors du chemin de réponse, tenue par waitUntil et tracée en cas d'échec
// (quota) : elle partait seule et muette (A41).
const mettreEnCache = (e, req, rep) => {
  const copie = rep.clone();
  e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copie)).catch((err) => console.warn('Mise en cache impossible :', req.url, err)));
};

self.addEventListener('install', (e) => {
  e.waitUntil(
    // cache: 'reload' : le précache d'une nouvelle version ne doit pas être rempli depuis le cache
    // HTTP avec les fichiers de l'ANCIENNE (A17) ; un échec est tracé avec l'asset fautif (A20).
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
      .catch((err) => { console.error('Précache de Carnet EPS impossible :', err); throw err; })
  );
});

self.addEventListener('activate', (e) => {
  // Cache Storage est PAR ORIGINE : alemoine4.github.io héberge d'autres PWA (Le Bar Clandestin).
  // On ne nettoie que NOS anciens caches « carnet-eps-* », jamais ceux des voisins (Codex H05).
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((k) => k.startsWith('carnet-eps-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const estDocument = req.mode === 'navigate' || url.pathname.endsWith('manifest.webmanifest');
  // Lectures scopées à NOTRE cache (l'isolation H05 ne valait qu'en écriture : un fichier d'une
  // autre app de l'origine pouvait être servi à sa place — A18).
  const depuisCache = (r) => caches.open(CACHE).then((c) => c.match(r));

  if (req.mode === 'navigate') {
    // cache-first + revalidation en arrière-plan (A39) : le réseau d'un gymnase peut être très
    // lent et l'ancienne version network-first attendait le réseau SANS délai maximal — l'app
    // pouvait paraître figée au démarrage. On sert la navigation depuis le cache versionné quand
    // elle y est, et on revalide en arrière-plan (e.waitUntil) pour le lancement suivant ; le
    // repli réseau puis 503 ne joue que si la navigation est absente du cache.
    const fetchEtCache = () => fetch(req).then((rep) => {
      if (cachable(rep)) mettreEnCache(e, req, rep);
      return rep;
    });
    e.respondWith(
      depuisCache(req).then(async (exacte) => {
        // Accueil avec paramètre inédit (« /?source=… ») : la page d'application est DÉJÀ en cache,
        // la servir tout de suite au lieu d'attendre le réseau. Le repli est limité à la racine et à
        // index.html de la portée, jamais aux autres documents du site (audit Codex V3, V3-04 ;
        // reprise de la copie de travail de Codex, v0.13.2).
        const accueil = url.pathname === new URL('./', self.registration.scope).pathname
          || url.pathname === new URL('./index.html', self.registration.scope).pathname;
        const r = exacte || (accueil ? await depuisCache('./index.html') : null);
        if (r) {
          // Échec muet : hors ligne pendant la revalidation est routine, pas une panne à signaler
          // (un échec d'ÉCRITURE — quota — reste tracé par mettreEnCache elle-même, A41).
          e.waitUntil(fetchEtCache().catch(() => {}));
          return r;
        }
        return fetchEtCache()
          .catch(() => depuisCache('./index.html')
            .then((r2) => r2 || new Response('Hors ligne — reconnectez-vous une fois pour installer l’application.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })));
      })
    );
  } else if (estDocument) {
    // network-first inchangé (hors périmètre A39) : seul le manifest passe encore ici
    // (url.pathname.endsWith('manifest.webmanifest')) ; le cache n'est qu'un filet hors ligne.
    // Seules les réponses OK de notre serveur sont mises en cache : une 404/5xx passagère
    // (déploiement en cours) ne doit pas devenir le filet hors ligne (audit 2026-09-05, B12).
    e.respondWith(
      fetch(req)
        .then((rep) => {
          if (cachable(rep)) mettreEnCache(e, req, rep);
          return rep;
        })
        // Hors ligne : le manifest demandé, sinon une réponse claire plutôt qu'undefined (A40 —
        // le manifest ne doit pas recevoir du HTML : pas de repli sur index.html ici).
        .catch(() => depuisCache(req)
          .then((r) => r || new Response('Hors ligne — reconnectez-vous une fois pour installer l’application.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })))
    );
  } else {
    // cache-first : les assets sont invalidés par changement de VERSION.
    e.respondWith(
      depuisCache(req)
        .then((r) => r || fetch(req).then((rep) => {
          if (cachable(rep)) mettreEnCache(e, req, rep);
          return rep;
        }))
        .catch(() => new Response('', { status: 504 })) // hors ligne et absent du cache : jamais undefined (A40)
    );
  }
});

