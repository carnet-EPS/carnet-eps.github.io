// state.js — état en mémoire, pub/sub, préférences UI (localStorage uniquement,
// jamais de données élèves ici — elles vivent dans IndexedDB via io.js).

// Version applicative : synchroniser avec VERSION du service-worker à chaque déploiement.
export const VERSION_APP = '0.13.1';

// Période à deux adresses (audit indépendant 2026-09-16, FON-01) : la v0.13 tourne sur l'origine dédiée
// avec des données FICTIVES pendant que les vraies restent sur l'ancienne adresse. Tant que ce drapeau
// est vrai, l'en-tête, le titre de l'onglet et le manifeste (nom court « EPS essai ») le disent, pour
// qu'aucune saisie réelle n'atterrisse ici. À passer à false (manifeste compris : un test de cohérence
// l'exige) et à publier AVANT le premier import de vraies données, jamais après.
export const MODE_ESSAI = true;

const CLE_PREFS = 'carnet-eps:prefs';

export const etat = {
  prefs: chargerPrefs(), // la route n'est pas un état : le hash fait foi (audit 2026-09-07, C54)
};

const abonnes = new Map(); // évènement -> Set<fonction>

export function abonner(evenement, fn) {
  if (!abonnes.has(evenement)) abonnes.set(evenement, new Set());
  abonnes.get(evenement).add(fn);
  return () => abonnes.get(evenement).delete(fn);
}

export function emettre(evenement, donnees) {
  for (const fn of abonnes.get(evenement) || []) fn(donnees);
}

function chargerPrefs() {
  try {
    return { theme: 'auto', ...JSON.parse(localStorage.getItem(CLE_PREFS) || '{}') };
  } catch {
    return { theme: 'auto' };
  }
}

export function sauverPrefs(maj) {
  Object.assign(etat.prefs, maj);
  try {
    localStorage.setItem(CLE_PREFS, JSON.stringify(etat.prefs));
  } catch {
    // localStorage plein ou désactivé : la préférence vit en mémoire pour la session,
    // ça ne doit pas casser le rendu de la vue appelante (audit 2026-09-05, B17).
  }
  emettre('prefs', etat.prefs);
}

// Purge / import : les raccourcis « Reprendre » (dernière classe, dernière évaluation) pointaient
// vers des données disparues ; seul le thème survit (audit 2026-09-07, A25).
export function effacerPrefs() {
  etat.prefs = { theme: etat.prefs.theme };
  try {
    localStorage.setItem(CLE_PREFS, JSON.stringify(etat.prefs));
  } catch {
    // idem sauverPrefs : sans conséquence
  }
  emettre('prefs', etat.prefs);
}

// Environnement : en dev local le service-worker est désactivé (décision D008). Un contexte NON
// sécurisé (http://192.168.x.x en test sur téléphone) compte aussi : le SW n'y est pas enregistrable
// et Réglages disait « installé / en ligne » (audit 2026-09-07, A35). app.localhost, [::1] et
// 127.0.0.2 restent des contextes sécurisés hors de la liste → le test réel du SW y passe toujours.
export function estLocalhost() {
  return !window.isSecureContext || ['localhost', '127.0.0.1'].includes(location.hostname);
}
