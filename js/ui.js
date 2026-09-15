// ui.js — registre de vues + helpers DOM communs.
// Une vue = fonction (conteneur, params) => void|Promise, enregistrée par enregistrerVue().
// `params` = segments du hash après la route (ex. #/eleves/fiche/<id> → ['fiche', '<id>']).
// Les modules métier (js/modules/*.js) s'enregistrent ici sans toucher au router.

const vues = new Map();

export function enregistrerVue(id, rendu) {
  vues.set(id, rendu);
}

let generation = 0; // deux navigations très rapprochées : seule la plus récente garde la main

export async function afficherVue(id, params = []) {
  const gen = ++generation;
  // Conteneur NEUF à chaque navigation : un rendu async devenu obsolète continue d'écrire
  // dans l'ancien nœud détaché au lieu de se mélanger à la vue courante.
  const ancien = document.getElementById('vue');
  const conteneur = ancien.cloneNode(false); // mêmes attributs (id, tabindex, aria-label), vide
  ancien.replaceWith(conteneur);
  conteneur.className = 'vue'; // réinitialise (une vue peut ajouter 'vue-large' pour s'élargir sur PC)
  const rendu = vues.get(id);
  if (!rendu) {
    conteneur.append(carte('Page introuvable', `Aucune vue « ${id} ».`));
    return;
  }
  try {
    await rendu(conteneur, params);
  } catch (e) {
    // Une exception dans une vue laissait un écran blanc muet (audit 2026-09-05, B14).
    console.error(`Vue « ${id} » :`, e);
    if (gen === generation) {
      conteneur.append(carte('Affichage impossible',
        `Une erreur est survenue (${e?.message || e}). Rechargez la page ; si cela persiste, `
        + 'exportez une sauvegarde (Plus → Sauvegarde) avant toute autre manipulation.'));
    }
  }
  // Retour en haut à chaque changement de vue : on arrivait au milieu de l'écran suivant (B26).
  // Le focus n'est pas repris à un toast (le « Annuler » d'une suppression le reçoit juste avant
  // la navigation qui suit — B28).
  // Pas de focus au tout premier rendu (chargement) : le lien d'évitement, placé avant <main>,
  // n'était jamais atteint en tabulation avant (revue du lot 3, B36).
  if (gen === generation) {
    window.scrollTo(0, 0);
    if (gen > 1 && !document.activeElement?.closest('.toasts')) conteneur.focus({ preventScroll: true });
  }
}

// Re-rendu d'une vue en place en conservant le focus (par l'id de l'élément actif) : changer un
// select ou une date relançait le rendu et renvoyait le focus au <body> (audit 2026-09-07, B20).
export async function rerendre(c, rendu) {
  const idFocus = document.activeElement?.id;
  c.replaceChildren();
  const r = await rendu();
  if (idFocus) document.getElementById(idFocus)?.focus({ preventScroll: true });
  return r;
}

// el('button', { class: 'btn', onclick: fn }, 'Texte') — création DOM concise et sûre
// (textes passés en nœuds texte, jamais en innerHTML).
export function el(tag, attrs = {}, ...enfants) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v !== false && v !== null && v !== undefined) n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...enfants);
  return n;
}

export function carte(titre, texte = '', badge = '') {
  const c = el('section', { class: 'carte' });
  const h = el('h2', {}, titre);
  if (badge) h.append(el('span', { class: 'badge' }, badge));
  c.append(h);
  if (texte) c.append(el('p', {}, texte));
  return c;
}

// Ligne d'alerte (accueil et Suivi) : un seul rendu — audit 2026-09-07, C41.
export function ligneAlerte(a) {
  return el('a', { class: 'ligne-eleve', href: a.href },
    el('span', { class: 'badge' + (a.grave ? ' badge-alerte' : '') }, el('span', { 'aria-hidden': 'true' }, a.grave ? '⚠' : 'ℹ'), el('span', { class: 'sr-only' }, a.grave ? 'Alerte' : 'Information')), // B43
    el('span', { class: 'ligne-eleve-nom' }, a.texte),
    el('span', { class: 'chevron pousse-droite', 'aria-hidden': 'true' }, '›'),
  );
}

// ---- Champs de formulaire (sauvegarde sur `change` + retour visuel « ✓ ») ----

function brancherRetour(controle, onChange, transformer = (v) => v.trim()) {
  const retour = el('span', { class: 'statut statut-ok', role: 'status' });
  if (onChange) {
    let minuteur = null;
    let valeurAcceptee = controle.value; // posée par la vue avant le branchement (champTexte, champSelect, champZone)
    // Les valeurs courtes et structurées (date, nombre, liste) reprennent la dernière valeur
    // acceptée quand la saisie est refusée : l'écran ne doit pas afficher une date que la base
    // n'a pas (revue du lot 1, A16). Un texte tapé est conservé pour ne pas le perdre (✗ visible).
    const restaurable = controle.tagName === 'SELECT' || ['date', 'number', 'time'].includes(controle.type);
    controle.addEventListener('change', async () => {
      clearTimeout(minuteur); // sinon le « ✓ » précédent effaçait le « ✗ » 1,5 s plus tard (revue du lot 1)
      const saisie = controle.value;
      // Un échec d'écriture (quota, base fermée) ou une valeur refusée par la vue laissait le
      // champ muet, voire « ✓ » : le champ marque « ✗ » et le motif part en toast (V2-04).
      try {
        await onChange(transformer(saisie));
      } catch (e) {
        if (restaurable) controle.value = valeurAcceptee;
        retour.className = 'statut statut-erreur';
        retour.textContent = '✗';
        toast(`Non enregistré : ${e?.message || e}`);
        return;
      }
      valeurAcceptee = saisie;
      retour.className = 'statut statut-ok';
      retour.textContent = '✓';
      minuteur = setTimeout(() => { retour.textContent = ''; }, 1500);
    });
  }
  return retour;
}

export function champTexte({ id, libelle, valeur = '', placeholder = '', type = 'text', onChange }) {
  const input = el('input', { type, id, placeholder, autocomplete: 'off' });
  input.value = valeur;
  const retour = brancherRetour(input, onChange, type === 'date' ? (v) => v : (v) => v.trim());
  return el('div', { class: 'champ' }, el('label', { for: id }, libelle, ' ', retour), input);
}

export function champSelect({ id, libelle, options, valeur = '', onChange }) {
  const select = el('select', { id }, ...options.map((o) => el('option', { value: o.value }, o.label)));
  select.value = valeur;
  const retour = brancherRetour(select, onChange, (v) => v);
  return el('div', { class: 'champ' }, el('label', { for: id }, libelle, ' ', retour), select);
}

export function champZone({ id, libelle, valeur = '', placeholder = '', rows = 3, onChange }) {
  const zone = el('textarea', { id, placeholder, rows });
  zone.value = valeur;
  const retour = brancherRetour(zone, onChange);
  return el('div', { class: 'champ' }, el('label', { for: id }, libelle, ' ', retour), zone);
}

// Libellé + contrôle déjà construit (select, fichier, grille de cases…) dans un bloc .champ,
// sans sauvegarde automatique (ex-`champF` copié dans 5 modules — audit 2026-09-05, B27).
export function champ(id, libelle, controle) {
  return el('div', { class: 'champ' }, el('label', { for: id }, libelle), controle);
}

// Groupe de cases à cocher nommé : <fieldset>/<legend> — un <label> sans contrôle associé ne
// nommait rien pour les lecteurs d'écran (audit 2026-09-07, B47).
export function groupe(libelle, controle) {
  return el('fieldset', { class: 'champ groupe' }, el('legend', {}, libelle), controle);
}

// ---- Feuille modale (menu bas d'écran) ----
// <dialog> natif : piège de focus, fermeture par Échap et par clic sur le fond,
// arrière-plan rendu inerte par le navigateur, focus restitué au déclencheur.
// `contenu` = un nœud ou un tableau de nœuds. Retourne le <dialog> (close() pour fermer).
export function ouvrirFeuille({ titre = '', label = '', contenu }) {
  document.querySelector('dialog.feuille[open]')?.close();
  const declencheur = document.activeElement;
  const dlg = el('dialog', { class: 'feuille', 'aria-label': label || titre || 'Menu' });
  if (titre) dlg.append(el('h3', {}, titre));
  dlg.append(...(Array.isArray(contenu) ? contenu : [contenu]));
  // Clic sur le fond (backdrop) = fermeture. Le backdrop cible le <dialog> lui-même ;
  // un clic/activation clavier sur un enfant cible l'enfant → la feuille ne se ferme pas.
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => {
    dlg.remove();
    if (declencheur?.isConnected) declencheur.focus();
  });
  document.body.append(dlg);
  dlg.showModal();
  dlg.querySelector('button, [href], input, select, textarea')?.focus();
  return dlg;
}

// Confirmation modale cohérente (remplace confirm() natif). Échap / clic sur le fond = Annuler,
// focus initial sur « Annuler » (anti-mauvais-tap), action en rouge par défaut.
// Retourne Promise<boolean>. Usage : if (!(await confirmer({ titre, message, detail }))) return;
export function confirmer({ titre, message = '', detail = '', action = 'Supprimer', danger = true }) {
  return new Promise((resoudre) => {
    const declencheur = document.activeElement;
    const dlg = el('dialog', { class: 'feuille feuille-confirm', 'aria-label': titre });
    let ok = false;
    const btnAnnuler = el('button', { class: 'btn', type: 'button' }, 'Annuler');
    const btnAction = el('button', { class: danger ? 'btn btn-danger' : 'btn btn-principal', type: 'button' }, action);
    btnAnnuler.addEventListener('click', () => dlg.close());
    btnAction.addEventListener('click', () => { ok = true; dlg.close(); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // clic sur le fond = Annuler
    dlg.addEventListener('close', () => {
      dlg.remove();
      if (declencheur?.isConnected) declencheur.focus();
      resoudre(ok);
    });
    dlg.append(el('h3', {}, titre));
    if (message) dlg.append(el('p', {}, message));
    if (detail) dlg.append(el('p', { class: 'confirm-detail' }, detail));
    dlg.append(el('div', { class: 'rang-btn' }, btnAnnuler, btnAction));
    document.body.append(dlg);
    dlg.showModal();
    btnAnnuler.focus();
  });
}

// Choix entre plusieurs actions, quand « Annuler / Confirmer » ne suffit pas (ex. convertir ou garder
// les notes au changement de barème). Même feuille modale que `confirmer` : focus initial sur
// Annuler, retour du focus au déclencheur, clic sur le fond ou Échap = annulation. Résout la valeur
// du choix, ou null si l'utilisateur annule.
export function choisir({ titre, message = '', detail = '', choix = [] }) {
  return new Promise((resoudre) => {
    const declencheur = document.activeElement;
    const dlg = el('dialog', { class: 'feuille feuille-confirm', 'aria-label': titre });
    let valeur = null;
    const btnAnnuler = el('button', { class: 'btn', type: 'button' }, 'Annuler');
    btnAnnuler.addEventListener('click', () => dlg.close());
    const boutons = choix.map((c) => {
      const b = el('button', { class: c.principal ? 'btn btn-principal' : 'btn', type: 'button' }, c.libelle);
      b.addEventListener('click', () => { valeur = c.valeur; dlg.close(); });
      return b;
    });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => {
      dlg.remove();
      if (declencheur?.isConnected) declencheur.focus();
      resoudre(valeur);
    });
    dlg.append(el('h3', {}, titre));
    if (message) dlg.append(el('p', {}, message));
    if (detail) dlg.append(el('p', { class: 'confirm-detail' }, detail));
    dlg.append(el('div', { class: 'rang-btn' }, btnAnnuler, ...boutons));
    document.body.append(dlg);
    dlg.showModal();
    btnAnnuler.focus();
  });
}

// Notification brève avec action optionnelle (ex. « Supprimé — Annuler »), auto-disparition.
// Les toasts S'EMPILENT (max 3, le plus ancien cède la place — audit A12) : un « Annuler »
// n'est plus perdu quand deux suppressions s'enchaînent. duree: Infinity = reste affiché.
// Un toast porteur d'action dure 20 s (8 s ne laissaient pas le temps d'y aller au clavier — B28),
// reçoit le focus, et son minuteur est suspendu tant qu'il est survolé ou focalisé.
export function toast(message, { action, libelleAction = 'Annuler', duree = action ? 20000 : 8000 } = {}) {
  // Conteneur permanent (index.html) porteur de la région live ; créé ici seulement à défaut (B27).
  let pile = document.querySelector('.toasts');
  if (!pile) { pile = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(pile); }
  // L'éviction n'emporte que les toasts à durée finie : le toast persistant
  // (ex. « Nouvelle version installée ») survit à une rafale de notifications.
  while (pile.children.length >= 3) {
    const victime = [...pile.children].find((x) => !('persistant' in x.dataset));
    if (!victime) break;
    victime.remove();
  }
  const t = el('div', { class: 'toast' }, el('span', {}, message));
  if (!Number.isFinite(duree)) t.dataset.persistant = '';
  let timer;
  // Si le toast a le focus au moment de disparaître (« Annuler » au clavier), le focus revient au
  // déclencheur, sinon à la zone de contenu — pas au <body> (revue du lot 3, B28).
  const declencheur = document.activeElement;
  const fermer = () => {
    clearTimeout(timer);
    const avaitFocus = t.contains(document.activeElement);
    t.remove();
    if (avaitFocus) (declencheur?.isConnected && !declencheur.closest('.toasts') ? declencheur : document.getElementById('vue'))?.focus({ preventScroll: true });
  };
  const armer = () => {
    clearTimeout(timer);
    if (Number.isFinite(duree)) timer = setTimeout(fermer, duree);
  };
  if (action) {
    const btn = el('button', { class: 'btn btn-principal', type: 'button' }, libelleAction);
    btn.addEventListener('click', async () => {
      fermer();
      try {
        await action();
      } catch (e) {
        // La restauration peut échouer (quota, doublon revérifié…) : le dire, plutôt qu'un
        // rejet muet pendant que l'utilisateur croit l'annulation faite (audit 2026-09-07, D-01).
        toast(`Annulation impossible : ${e?.message || e}`, { duree: 12000 });
      }
    });
    t.append(btn);
    t.addEventListener('focusin', () => clearTimeout(timer));
    t.addEventListener('mouseenter', () => clearTimeout(timer));
    t.addEventListener('focusout', armer);
    t.addEventListener('mouseleave', armer);
  }
  pile.append(t);
  // Le focus va sur l'action seulement quand elle a une échéance (un toast persistant, comme
  // « Recharger », ne doit pas voler le focus au milieu d'une saisie) — et AVANT l'armement du
  // minuteur : le focusin programmatique l'annulait et le toast ne partait plus (revue du lot 3).
  if (action && Number.isFinite(duree)) t.querySelector('button').focus({ preventScroll: true });
  armer();
  return t;
}
