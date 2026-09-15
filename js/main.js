// main.js — démarrage, routes, thème, enregistrement du service-worker.
// Toutes les vues sont fournies par les modules (js/modules/*.js).

import { enregistrerVue, afficherVue, carte, el, toast, ligneAlerte } from './ui.js';
import { etat, abonner, estLocalhost, MODE_ESSAI } from './state.js';
import { ouvrirDB } from './io.js';
import { collecterAlertes } from './metier.js';
import { initialiser as initAccueil } from './modules/accueil.js';
import { initialiser as initSauvegarde } from './modules/sauvegarde.js';
import { initialiser as initReglages } from './modules/reglages.js';
import { initialiser as initEleves } from './modules/eleves.js';
import { initialiser as initEdt } from './modules/edt.js';
import { initialiser as initSequences } from './modules/sequences.js';
import { initialiser as initAppel } from './modules/appel.js';
import { initialiser as initInaptitudes } from './modules/inaptitudes.js';
import { initialiser as initGrilles } from './modules/grilles.js';
import { initialiser as initNotes } from './modules/notes.js';
import { initialiser as initDocuments } from './modules/documents.js';

// Nom accessible de la zone de contenu par route → annoncé au lecteur d'écran à chaque navigation
// (la zone #vue reçoit le focus dans afficherVue). Routes principales (onglets) + routes enfants
// (accessibles depuis « Plus ») : UNE seule liste, dérivée des titres (audit 2026-09-07, C42).
const TITRES = { grilles: 'Grilles d’évaluation', accueil: 'Aujourd’hui', appel: 'Appel', eleves: 'Élèves', notes: 'Notes', edt: 'Emploi du temps', plus: 'Plus', suivi: 'Suivi', sauvegarde: 'Sauvegarde', reglages: 'Réglages', sequences: 'Séquences', inaptitudes: 'Inaptitudes', documents: 'Documents', aide: 'Aide' };
const ROUTES = Object.keys(TITRES);
// EDT déplacé sous « Plus » ; les inaptitudes sont désormais frontées par l'onglet « Suivi ».
const PARENT = { grilles: 'notes', sauvegarde: 'plus', reglages: 'plus', sequences: 'plus', inaptitudes: 'suivi', documents: 'plus', aide: 'plus', edt: 'plus' };

// ---- Vue « Plus » (menu des modules secondaires) ----

enregistrerVue('plus', (c) => {
  const lien = (route, carteElem) => el('a', { class: 'carte-lien', href: `#/${route}` }, carteElem);
  const liste = el('div', { class: 'liste-cartes' });
  liste.append(
    lien('grilles', carte('Grilles d’évaluation', 'Critères, niveaux de maîtrise, pondérations et notes sur 20.')),
    lien('edt', carte('Emploi du temps', 'Créneaux hebdomadaires, semaines A/B, installations.')),
    lien('sequences', carte('Séquences & séances', 'APSA, champs d’apprentissage, séances numérotées automatiquement.')),
    lien('documents', carte('Documents', 'Bibliothèque locale : fiches, protocoles, convocations — photo, PDF ou lien.')),
    lien('sauvegarde', carte('Sauvegarde', 'Export / import JSON complet — le transfert PC ↔ Android et le filet de sécurité.')),
    lien('reglages', carte('Réglages', 'Établissement, année scolaire, thème, stockage, mises à jour.')),
    lien('aide', carte('Aide & rentrée', 'Prise en main, procédure de rentrée en 6 étapes, bons réflexes de l’année.')),
  );
  c.append(liste, el('p', { class: 'note-discrete' }, '100 % local · hors ligne · aucune donnée ne quitte cet appareil'));
});

// ---- Vue « Suivi » (suivi EPS : alertes élèves + accès inaptitudes) ----

enregistrerVue('suivi', async (c) => {
  const alertes = await collecterAlertes();
  const carteA = carte('Alertes du suivi');
  if (!alertes.length) {
    carteA.append(el('p', {}, 'Rien à signaler ✓'));
  } else {
    for (const a of alertes) carteA.append(ligneAlerte(a));
  }
  c.append(carteA);

  const liste = el('div', { class: 'liste-cartes' });
  liste.append(
    el('a', { class: 'carte-lien', href: '#/inaptitudes' },
      carte('Inaptitudes & certificats', 'Totales/partielles, photo du certificat, alertes d’expiration et > 3 mois. + Nouvelle inaptitude.')),
  );
  c.append(liste);
});

// ---- Vue « Aide » (prise en main + rentrée, intégrée et disponible hors ligne) ----

enregistrerVue('aide', (c) => {
  c.append(el('a', { class: 'retour', href: '#/plus' }, '← Retour'));

  const intro = carte('Aide & prise en main');
  intro.append(el('p', {},
    'Carnet EPS est votre carnet de bord d’EPS, 100 % sur cet appareil et hors ligne. '
    + 'Aucune donnée d’élève ne part sur internet : la seule copie qui existe est celle que vous exportez (Sauvegarde).'));
  c.append(intro);

  const etapes = carte('Première rentrée — 6 étapes (~30 min)');
  const ol = el('ol', { class: 'liste-aide' });
  for (const [t, d] of [
    ['Archiver l’année passée', 'Sauvegarde → Télécharger (avec pièces), ranger le fichier, puis Effacer toutes les données. (À sauter la toute première fois.)'],
    ['Régler l’année', 'Réglages : année scolaire, établissement, fins des trimestres (défaut 15/12 et 15/03), thème.'],
    ['Importer les élèves', 'Élèves → Importer depuis Pronote : coller le tableau ou le CSV → Analyser → vérifier les colonnes → Importer. Les classes se créent seules, les doublons sont ignorés.'],
    ['Saisir l’EDT', 'Plus → Emploi du temps : si alternance, renseigner « un lundi de semaine A », puis ajouter chaque créneau (jour, heures, classe, semaine, installation).'],
    ['Créer les séquences', 'Séquences → Nouvelle, pour chaque classe (APSA, dates, nombre de séances). Pas besoin de créer les séances : l’accueil propose celle du jour.'],
    ['Vérifier', 'L’accueil affiche le bon cours, les effectifs sont complets, puis exporter une première sauvegarde de l’année neuve.'],
  ]) ol.append(el('li', {}, el('strong', {}, `${t} — `), d));
  etapes.append(ol);
  c.append(etapes);

  const jourJ = carte('Le jour J');
  jourJ.append(el('p', {}, 'Ouvrir l’app → la carte « En ce moment » affiche la classe → toucher « Créer la séance et faire l’appel » → appel au pouce.'));
  c.append(jourJ);

  const reflexes = carte('Au fil de l’année — les bons réflexes');
  const ul = el('ul', { class: 'liste-aide' });
  for (const r of [
    'Exporter une sauvegarde chaque semaine (10 s) — seule protection contre la perte de l’appareil.',
    'Certificat reçu → Suivi → Inaptitudes → Nouvelle (photo ou PDF) : l’élève sera signalé à l’appel tout seul.',
    'Élève parti en cours d’année → sa fiche → « Dans la classe : Parti » : il disparaît de l’appel et des notes, son historique reste.',
    'Fin de cycle → saisir les notes → « Copier pour Pronote » au bureau.',
    'L’accueil rappelle le reste : inaptitudes qui expirent, seuils de tenue, notes non remontées.',
  ]) ul.append(el('li', {}, r));
  reflexes.append(ul);
  c.append(reflexes);

  // Le guide long (docs/guide-installation.md) n'est pas publié avec l'app : l'essentiel vit ici (audit 2026-09-07, B38).
  const install = carte('Installer sur le téléphone · transférer PC ↔ Android');
  const ulI = el('ul', { class: 'liste-aide' });
  for (const r of [
    'Android : ouvrir l’adresse de l’app dans Chrome → menu ⋮ → « Installer l’application » (ou la bannière en bas de l’écran). PC : icône « Installer » à droite de la barre d’adresse (Chrome, Edge).',
    'Transfert : sur l’appareil source, Plus → Sauvegarde → « Télécharger la sauvegarde » ; sur l’autre appareil, Plus → Sauvegarde → Importer → choisir le fichier .json.',
    'Après l’installation : Plus → Réglages → vérifier « Protection contre l’effacement auto : active ✓ ».',
  ]) ulI.append(el('li', {}, r));
  install.append(ulI);
  c.append(install);
});

// ---- Repli hors contexte sécurisé ----
// crypto.randomUUID n'existe qu'en HTTPS / localhost : en test sur un téléphone via
// http://192.168.x.x:8160, toute création d'enregistrement échouait (audit 2026-09-05, B15).
// getRandomValues, lui, est disponible partout → UUID v4 équivalent.
if (typeof crypto.randomUUID !== 'function') {
  crypto.randomUUID = () => {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
}

// ---- Initialisation des modules ----

initAccueil();
initSauvegarde();
initReglages();
initEleves();
initEdt();
initSequences();
initAppel();
initInaptitudes();
initNotes();
initGrilles();
initDocuments();

// ---- Router (hash) — segments : #/eleves/fiche/<id> → route 'eleves', params ['fiche','<id>'] ----

function segmentsDepuisHash() {
  return (location.hash || '#/accueil').replace(/^#\/?/, '').split('/').filter(Boolean);
}

async function naviguer() {
  const seg = segmentsDepuisHash();
  const r = ROUTES.includes(seg[0]) ? seg[0] : 'accueil';
  document.getElementById('vue').setAttribute('aria-label', TITRES[r]);
  const onglet = PARENT[r] || r; // les routes enfants laissent leur onglet parent actif
  for (const a of document.querySelectorAll('.nav a')) {
    const actif = a.dataset.route === onglet;
    a.classList.toggle('actif', actif);
    if (actif) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  await afficherVue(r, seg.slice(1));
}

window.addEventListener('hashchange', naviguer);

// ---- Version d'essai (FON-01) ----
// Pendant la période à deux adresses, deux applications visuellement identiques circulent : une saisie
// réelle faite ici, ou fictive en production, crée deux carnets qui ne se réconcilient pas. Le marqueur
// vit dans l'en-tête collant (visible au défilement, absent à l'impression avec lui) et dans le titre.
// Le texte ne dit pas où sont les vraies données : il doit rester vrai jusqu'au passage du drapeau à false,
// qui précède le premier import réel (revue v0.13.1).
if (MODE_ESSAI) {
  document.title = 'ESSAI — Carnet EPS';
  document.querySelector('.entete')?.append(el('div', { class: 'essai', role: 'region', 'aria-label': 'Version d’essai' },
    el('strong', {}, 'Version d’essai'), ' — n’y saisissez que des données fictives.'));
}

// Marge de focus sous l'en-tête collant (B05) : sa hauteur réelle varie (bandeau, police agrandie, largeur).
// Sans cette mesure, un contrôle atteint au clavier pouvait finir caché sous un en-tête plus haut que prévu.
const entete = document.querySelector('.entete');
if (entete && 'ResizeObserver' in window) {
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--h-entete', `${Math.ceil(entete.getBoundingClientRect().height)}px`);
  }).observe(entete);
}

// Lien d'évitement (B36) : le focus va sur la navigation SANS passer par le hash — un hash
// « #nav-principale » serait pris pour une route et renverrait à l'accueil (revue du lot 3).
document.querySelector('.saut')?.addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('nav-principale')?.focus();
});

// ---- Thème (auto / clair / sombre) ----

const mediaSombre = matchMedia('(prefers-color-scheme: dark)');
function appliquerTheme(theme) {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  // Couleur de la barre système = thème EFFECTIF (réglage « Sombre » sur un appareil clair compris),
  // pas seulement celui de l'appareil (audit 2026-09-07, A38 ; revue du lot 4).
  const sombre = theme === 'sombre' || (theme === 'auto' && mediaSombre.matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = sombre ? '#0f1626' : '#15459c';
}
abonner('prefs', (prefs) => appliquerTheme(prefs.theme));
mediaSombre.addEventListener('change', () => appliquerTheme(etat.prefs.theme));
appliquerTheme(etat.prefs.theme);

// ---- Démarrage ----

// Ouverture anticipée (création des stores avant la première vue) ; en cas d'échec la première
// vue réessaiera (le rejet n'est plus mis en cache, A04) — sans promesse flottante (C06).
// Cadrage refusé : frame-ancestors est ignorée en <meta> et GitHub Pages n'envoie aucun en-tête
// (audit 2026-09-07, A21) — une page tierce ne peut pas superposer ses boutons aux nôtres.
if (window.top !== window.self) {
  document.body.textContent = 'Carnet EPS ne peut pas être affiché dans un cadre.';
  throw new Error('Carnet EPS cadré par une autre page');
}
ouvrirDB().catch((e) => console.warn('Ouverture anticipée de la base :', e));

// Filet global : un rejet de promesse non géré (écriture refusée hors des try/catch locaux)
// ne laissait qu'une ligne en console, l'utilisateur croyait sa saisie enregistrée (C06, D-05).
window.addEventListener('unhandledrejection', (e) => {
  toast(`Erreur inattendue : ${e.reason?.message || e.reason}`);
});

document.getElementById('entete-contexte').textContent =
  new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

// Persistance du stockage : évite l'éviction silencieuse d'IndexedDB (surtout Android).
if (navigator.storage?.persist) {
  navigator.storage.persisted()
    .then((deja) => (deja ? true : navigator.storage.persist()))
    .catch(() => { /* API refusée ou absente : sans conséquence */ });
}

// Service-worker : jamais sur localhost (décision D008 — pas de cache fantôme en dev).
// Le SW fait skipWaiting + clients.claim : quand une nouvelle version prend le contrôle
// en cours d'utilisation, on propose de recharger (BIBLE règle 5 — MAJ visible).
let toastMajAffiche = false;
function afficherToastMaj() {
  if (toastMajAffiche) return;
  toastMajAffiche = true;
  // duree: Infinity → reste affiché jusqu'au clic (et survit aux autres toasts, pile A12).
  toast('Nouvelle version installée.', { action: () => location.reload(), libelleAction: 'Recharger', duree: Infinity });
}

if ('serviceWorker' in navigator && !estLocalhost()) {
  let etaitControle = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!etaitControle) { etaitControle = true; return; } // première installation : pas une mise à jour
    afficherToastMaj();
  });
  navigator.serviceWorker.register('./service-worker.js').catch((e) => {
    console.warn('Service-worker non enregistré :', e);
  });
}

naviguer();
