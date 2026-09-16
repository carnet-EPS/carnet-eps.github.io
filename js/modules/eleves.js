// modules/eleves.js — référentiel classes & élèves + import CSV Pronote (phase 2).
// Sous-routes : #/eleves (classes) · #/eleves/classe/<id> · #/eleves/fiche/<id> · #/eleves/import
// Règles métier : docs/fonctionnalites.md §1 — minimisation RGPD (jamais d'INE ni d'adresse),
// suppression d'un élève = cascade documentée (io.supprimerEleveEnCascade).

import { enregistrerVue, el, carte, champTexte, champSelect, champZone, confirmer, toast, rerendre } from '../ui.js';
import {
  tous, lire, parIndex, enregistrer, supprimer, lireMeta,
  parserCSV, lireTexteCSV, supprimerEleveEnCascade,
  apercuSuppressionEleve, detailSuppression, restaurer, enregistrerLot,
} from '../io.js';
import {
  STATUTS, SEUIL_ALERTE, depasseSeuil, dateFR, isoAujourdhui, trierEleves, trierClasses, cleTexte, baremeDe, formatFR, inaptitudesActives,
  normaliser,
  bornesTrimestres, compterStatutsParTrimestre,
} from '../metier.js';
import { preparerFichier, urlDuFichier } from '../media.js';
import { carteObservations } from './observations.js';
import { sauverPrefs } from '../state.js';

const PALETTE = ['#1d5fd6', '#178a52', '#c97a06', '#7c3aed', '#d03a3a', '#0e7490', '#be185d', '#4d7c0f'];

function devinerNiveau(nomClasse) {
  const m = String(nomClasse).trim().match(/^(\d)/);
  return m ? `${m[1]}e` : '';
}

function dateFRversISO(v) {
  const t = String(v || '').trim();
  // JJ/MM/AAAA (Pronote), séparateurs « / . - » acceptés, ou AAAA-MM-JJ ; une date impossible (31/02)
  // est refusée : stockée, elle s'affichait VIDE sur la fiche (audit 2026-09-07, B46 / C51).
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/)?.slice(1).reverse() || t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/)?.slice(1);
  if (!m) return '';
  const iso = `${m[2]}-${m[1].padStart(2, '0')}-${m[0].padStart(2, '0')}`;
  const d = new Date(`${iso}T12:00:00`);
  return d.getMonth() + 1 === Number(m[1]) && d.getDate() === Number(m[0]) ? iso : '';
}

function normaliserSexe(v) {
  const c = String(v || '').trim().charAt(0).toUpperCase();
  if (c === 'G') return 'M'; // certains exports notent G(arçon)/F(ille)
  return c === 'M' || c === 'F' ? c : '';
}

function avatar(eleve, couleur) {
  const initiales = `${(eleve.prenom[0] || '').toUpperCase()}${(eleve.nom[0] || '').toUpperCase()}`;
  const a = el('span', { class: 'avatar', 'aria-hidden': 'true' }, initiales);
  a.style.background = couleur || 'var(--c-accent)';
  return a;
}

// Effectif = élèves présents dans la classe (un élève « parti » reste dans la base pour son
// historique mais ne compte plus — audit 2026-09-05, B10).
async function compterParClasse() {
  const comptes = new Map();
  for (const e of await tous('eleves')) {
    if (e.actif !== false) comptes.set(e.classeId, (comptes.get(e.classeId) || 0) + 1);
  }
  return comptes;
}

// ---------------------------------------------------------------------------
// Vue : liste des classes
// ---------------------------------------------------------------------------

async function vueListeClasses(c) {
  const rafraichir = () => rerendre(c, () => vueListeClasses(c));
  const classes = (await tous('classes')).sort(trierClasses);
  const actives = classes.filter((cl) => !cl.archivee);
  const archivees = classes.filter((cl) => cl.archivee);
  const comptes = await compterParClasse();

  // Barre d'actions
  const btnNouvelle = el('button', { class: 'btn btn-principal', 'aria-expanded': 'false' }, '+ Nouvelle classe');
  const btnImport = el('a', { class: 'btn', href: '#/eleves/import' }, 'Importer depuis Pronote (CSV)');
  c.append(el('div', { class: 'barre-actions' }, btnNouvelle, btnImport));

  // Formulaire nouvelle classe (replié par défaut)
  const inpNom = el('input', { type: 'text', id: 'nc-nom', placeholder: '6A, 5B, 3PM…', autocomplete: 'off' });
  const inpNiveau = el('input', { type: 'text', id: 'nc-niveau', placeholder: '6e (déduit du nom si vide)', autocomplete: 'off' });
  const statutForm = el('p', { class: 'statut', role: 'status' });
  const btnCreer = el('button', { class: 'btn btn-principal' }, 'Créer la classe');
  const formCarte = carte('Nouvelle classe');
  formCarte.append(
    el('div', { class: 'champ' }, el('label', { for: 'nc-nom' }, 'Nom *'), inpNom),
    el('div', { class: 'champ' }, el('label', { for: 'nc-niveau' }, 'Niveau'), inpNiveau),
    el('div', { class: 'rang-btn' }, btnCreer),
    statutForm,
  );
  formCarte.hidden = true;
  c.append(formCarte);
  btnNouvelle.addEventListener('click', () => {
    formCarte.hidden = !formCarte.hidden;
    btnNouvelle.setAttribute('aria-expanded', String(!formCarte.hidden)); // état du dépliant exposé (B19)
    if (!formCarte.hidden) inpNom.focus();
  });
  btnCreer.addEventListener('click', async () => {
    const nom = inpNom.value.trim();
    if (!nom) { statutForm.textContent = 'Le nom est obligatoire.'; statutForm.className = 'statut statut-erreur'; return; }
    if (classes.some((cl) => cleTexte(cl.nom) === cleTexte(nom))) {
      statutForm.textContent = 'Une classe porte déjà ce nom.'; statutForm.className = 'statut statut-erreur'; return;
    }
    btnCreer.disabled = true; // un double clic créait deux classes homonymes (audit 2026-09-07, D-02)
    try {
      await enregistrer('classes', {
        id: crypto.randomUUID(),
        nom,
        niveau: inpNiveau.value.trim() || devinerNiveau(nom),
        anneeScolaire: await lireMeta('anneeScolaire', ''),
        couleur: PALETTE[classes.length % PALETTE.length],
        ordre: classes.length,
        archivee: false,
      });
    } catch (e) {
      statutForm.textContent = `Création impossible : ${e?.message || e}`; statutForm.className = 'statut statut-erreur';
      btnCreer.disabled = false;
      return;
    }
    rafraichir();
  });

  // Liste
  if (!actives.length) {
    const vide = carte('Aucune classe pour l’instant', 'Créez une classe à la main, ou importez directement vos listes d’élèves depuis Pronote : les classes seront créées automatiquement.');
    c.append(vide);
  } else {
    const liste = el('div', { class: 'liste-cartes' });
    for (const cl of actives) {
      const pastille = el('span', { class: 'pastille', 'aria-hidden': 'true' });
      pastille.style.background = cl.couleur || 'var(--c-accent)';
      const effectif = comptes.get(cl.id) || 0;
      const carteCl = carte(`${cl.nom}`, `${cl.niveau ? cl.niveau + ' · ' : ''}${effectif} élève${effectif > 1 ? 's' : ''}`);
      carteCl.querySelector('h2').prepend(pastille);
      liste.append(el('a', { class: 'carte-lien', href: `#/eleves/classe/${cl.id}` }, carteCl));
    }
    c.append(liste);
  }

  // Classes archivées
  if (archivees.length) {
    const carteArch = carte('Classes archivées', '');
    for (const cl of archivees) {
      const btnRestaurer = el('button', { class: 'btn' }, 'Restaurer');
      btnRestaurer.addEventListener('click', async () => {
        // Écriture d'abord, mutation ensuite, et un message si elle est refusée (audit Codex V3, V3-01).
        try {
          await enregistrer('classes', { ...cl, archivee: false });
          cl.archivee = false;
          rafraichir();
        } catch (e) {
          toast(`Classe non restaurée : ${e?.message || e}`);
        }
      });
      carteArch.append(el('div', { class: 'info-ligne' }, el('span', {}, `${cl.nom} (${comptes.get(cl.id) || 0} élèves)`), btnRestaurer));
    }
    c.append(carteArch);
  }
}

// ---------------------------------------------------------------------------
// Vue : une classe (édition + liste des élèves)
// ---------------------------------------------------------------------------

async function vueClasse(c, id) {
  const rafraichir = () => rerendre(c, () => vueClasse(c, id));
  const classe = await lire('classes', id);
  c.append(el('a', { class: 'retour', href: '#/eleves' }, '← Classes'));
  if (!classe) { c.append(carte('Classe introuvable', 'Elle a peut-être été supprimée.')); return; }
  sauverPrefs({ derniereClasseId: id }); // raccourci « Reprendre » de l'accueil
  const eleves = (await parIndex('eleves', 'classeId', id)).sort(trierEleves);
  const nbActifs = eleves.filter((e) => e.actif !== false).length;
  const nbPartis = eleves.length - nbActifs;

  // Carte classe (édition directe)
  const carteCl = carte(`Classe ${classe.nom}`, '', `${nbActifs} élève${nbActifs > 1 ? 's' : ''}${nbPartis ? ` · ${nbPartis} parti${nbPartis > 1 ? 's' : ''}` : ''}`);
  // Écriture d'abord, mutation ensuite, et une écriture à la fois — même règle que la fiche élève
  // (audit Codex V3, V3-01 ; revue du lot V3-A pour la sérialisation).
  let fileCl = Promise.resolve();
  const sauverClasse = (modifs = {}) => {
    const suite = fileCl.catch(() => {}).then(async () => {
      const candidat = { ...classe, ...modifs };
      await enregistrer('classes', candidat);
      Object.assign(classe, modifs);
    });
    fileCl = suite;
    return suite;
  };
  const inpCouleur = el('input', { type: 'color', id: 'cl-couleur' });
  inpCouleur.value = classe.couleur || PALETTE[0];
  // Écriture d'abord, mutation ensuite, et un message si elle est refusée : ce champ n'avait AUCUN
  // filet (rejet silencieux au niveau du champ) — audit Codex V3, V3-01.
  inpCouleur.addEventListener('change', async () => {
    const couleur = inpCouleur.value;
    try {
      await sauverClasse({ couleur });
    } catch (e) {
      inpCouleur.value = classe.couleur || PALETTE[0];
      toast(`Couleur non enregistrée : ${e?.message || e}`);
    }
  });
  carteCl.append(
    champTexte({ id: 'cl-nom', libelle: 'Nom', valeur: classe.nom, onChange: async (v) => {
      if (!v) throw new Error('le nom de la classe ne peut pas être vide'); // « ✓ » sans écriture sinon (audit 2026-09-07, A36)
      // Même contrôle de doublon qu'à la création (vueListeClasses).
      if ((await tous('classes')).some((cl) => cl.id !== classe.id && cleTexte(cl.nom) === cleTexte(v))) {
        toast(`Une classe « ${v} » existe déjà — nom non modifié.`);
        rafraichir();
        return;
      }
      await sauverClasse({ nom: v });
    } }),
    champTexte({ id: 'cl-niveau', libelle: 'Niveau', valeur: classe.niveau || '', onChange: async (v) => { await sauverClasse({ niveau: v }); } }),
    el('div', { class: 'champ' }, el('label', { for: 'cl-couleur' }, 'Couleur'), inpCouleur),
  );
  const btnArchiver = el('button', { class: 'btn' }, classe.archivee ? 'Restaurer' : 'Archiver');
  btnArchiver.addEventListener('click', async () => {
    // Écriture d'abord, mutation ensuite, et un message si elle est refusée : l'écran quittait la
    // vue en croyant l'archivage fait (audit Codex V3, V3-01 — site manqué par l'audit).
    const archivee = !classe.archivee;
    try {
      await sauverClasse({ archivee });
      location.hash = '#/eleves';
    } catch (e) {
      toast(`${archivee ? 'Classe non archivée' : 'Classe non restaurée'} : ${e?.message || e}`);
    }
  });
  const actions = el('div', { class: 'rang-btn' }, btnArchiver);
  if (!eleves.length) {
    const btnSuppr = el('button', { class: 'btn btn-danger' }, 'Supprimer la classe');
    btnSuppr.addEventListener('click', async () => {
      // Une classe encore référencée par des séquences ou des créneaux EDT laisserait des
      // orphelins « Classe ? » partout (audit 2026-09-05, B22) : on refuse tant qu'ils existent.
      const [seqs, crens, docs] = await Promise.all([
        parIndex('sequences', 'classeId', classe.id), parIndex('edt', 'classeId', classe.id),
        tous('documents').then((liste) => liste.filter((d) => (d.classeIds || []).includes(classe.id))), // oubliés du refus (D-12)
      ]);
      const restes = [];
      if (seqs.length) restes.push(`${seqs.length} séquence${seqs.length > 1 ? 's' : ''}`);
      if (crens.length) restes.push(`${crens.length} créneau${crens.length > 1 ? 'x' : ''} EDT`);
      if (docs.length) restes.push(`${docs.length} document${docs.length > 1 ? 's' : ''}`);
      if (restes.length) {
        const liste = restes.length > 1 ? `${restes.slice(0, -1).join(', ')} et ${restes.at(-1)}` : restes[0];
        toast(`Classe non supprimée : elle a encore ${liste} — à supprimer ou détacher d’abord (Plus → Séquences / Emploi du temps / Documents).`);
        return;
      }
      if (!(await confirmer({ titre: 'Supprimer la classe', message: `Supprimer définitivement la classe ${classe.nom} (vide) ?` }))) return;
      await supprimer('classes', classe.id);
      location.hash = '#/eleves';
      toast(`Classe ${classe.nom} supprimée`, { action: async () => {
        // Une classe homonyme a pu être créée entre-temps : pas de doublon restauré (D-03).
        if ((await tous('classes')).some((cl) => cleTexte(cl.nom) === cleTexte(classe.nom))) throw new Error(`une classe « ${classe.nom} » existe déjà`);
        await restaurer({ classes: [classe] }); location.hash = `#/eleves/classe/${classe.id}`;
      } });
    });
    actions.append(btnSuppr);
  }
  carteCl.append(actions);
  c.append(carteCl);

  // Carte élèves
  const carteEl = carte('Élèves');
  const btnAjouter = el('button', { class: 'btn', 'aria-expanded': 'false' }, '+ Ajouter un élève');
  carteEl.append(el('div', { class: 'rang-btn' }, btnAjouter));

  // mini-formulaire d'ajout (replié)
  const inpNom = el('input', { type: 'text', id: 'el-nom', placeholder: 'NOM', autocomplete: 'off' });
  const inpPrenom = el('input', { type: 'text', id: 'el-prenom', placeholder: 'Prénom', autocomplete: 'off' });
  const btnCreer = el('button', { class: 'btn btn-principal' }, 'Ajouter');
  const statutAjout = el('p', { class: 'statut', role: 'status' });
  const formAjout = el('div', {},
    el('div', { class: 'champ' }, el('label', { for: 'el-nom' }, 'Nom *'), inpNom),
    el('div', { class: 'champ' }, el('label', { for: 'el-prenom' }, 'Prénom *'), inpPrenom),
    el('div', { class: 'rang-btn' }, btnCreer),
    statutAjout,
  );
  formAjout.hidden = true;
  carteEl.append(formAjout);
  btnAjouter.addEventListener('click', () => { formAjout.hidden = !formAjout.hidden; btnAjouter.setAttribute('aria-expanded', String(!formAjout.hidden)); if (!formAjout.hidden) inpNom.focus(); });
  btnCreer.addEventListener('click', async () => {
    const nom = inpNom.value.trim();
    const prenom = inpPrenom.value.trim();
    if (!nom || !prenom) { statutAjout.textContent = 'Nom et prénom obligatoires.'; statutAjout.className = 'statut statut-erreur'; return; }
    if (eleves.some((e) => cleTexte(e.nom) === cleTexte(nom) && cleTexte(e.prenom) === cleTexte(prenom))) {
      statutAjout.textContent = 'Cet élève existe déjà dans la classe.'; statutAjout.className = 'statut statut-erreur'; return;
    }
    btnCreer.disabled = true; // anti double-clic (audit 2026-09-07, D-02)
    try {
      await enregistrer('eleves', {
        id: crypto.randomUUID(), classeId: id, nom, prenom,
        sexe: '', dateNaissance: '', notesPerso: '', actif: true,
      });
    } catch (e) {
      statutAjout.textContent = `Ajout impossible : ${e?.message || e}`; statutAjout.className = 'statut statut-erreur';
      btnCreer.disabled = false;
      return;
    }
    rafraichir();
  });

  // recherche + liste
  if (eleves.length) {
    const recherche = el('input', { type: 'search', class: 'recherche', placeholder: 'Rechercher…', 'aria-label': 'Rechercher un élève' });
    carteEl.append(recherche);
    const conteneurListe = el('div', { class: 'liste-eleves' });
    const inaptes = new Set((await inaptitudesActives()).map((i) => i.eleveId)); // pastille « partout » (fonctionnalites.md §5 ; audit 2026-09-07, C53)
    const lignes = eleves.map((e) => {
      const ligne = el('a', { class: 'ligne-eleve', href: `#/eleves/fiche/${e.id}` },
        avatar(e, classe.couleur),
        el('span', { class: 'ligne-eleve-nom' }, `${e.nom} ${e.prenom}`),
        e.actif === false ? el('span', { class: 'badge' }, 'parti') : '',
        inaptes.has(e.id) ? el('span', { class: 'pastille-info', title: 'Inaptitude en cours' }, el('span', { 'aria-hidden': 'true' }, '🩺'), el('span', { class: 'sr-only' }, 'Inaptitude en cours')) : '',
        e.notesPerso ? el('span', { class: 'badge', title: 'À savoir renseigné' }, el('span', { 'aria-hidden': 'true' }, 'ℹ'), el('span', { class: 'sr-only' }, 'à savoir renseigné')) : '',
        el('span', { class: 'chevron', 'aria-hidden': 'true' }, '›'),
      );
      return { e, ligne };
    });
    conteneurListe.append(...lignes.map((l) => l.ligne));
    carteEl.append(conteneurListe);
    recherche.addEventListener('input', () => {
      const q = cleTexte(recherche.value);
      for (const { e, ligne } of lignes) ligne.hidden = q !== '' && !cleTexte(e.nom + e.prenom).includes(q);
    });
  } else {
    carteEl.append(el('p', { class: 'vide' }, 'Aucun élève — ajoutez-les à la main ou via l’import Pronote.'));
  }
  c.append(carteEl);
}

// ---------------------------------------------------------------------------
// Vue : fiche élève
// ---------------------------------------------------------------------------

async function vueFiche(c, id) {
  const rafraichir = () => rerendre(c, () => vueFiche(c, id));
  const eleve = await lire('eleves', id);
  if (!eleve) {
    c.append(el('a', { class: 'retour', href: '#/eleves' }, '← Classes'), carte('Élève introuvable', 'Il a peut-être été supprimé.'));
    return;
  }
  const classes = (await tous('classes')).sort(trierClasses);
  const classe = classes.find((cl) => cl.id === eleve.classeId);
  c.append(el('a', { class: 'retour', href: `#/eleves/classe/${eleve.classeId}` }, `← ${classe ? classe.nom : 'Classes'}`));

  // Mutation seulement après écriture validée (audit Codex V3, V3-01).
  // …et sérialisées (revue du lot V3-A) : sans file d'attente, le second changement repartait de
  // l'objet d'avant et écrasait le premier.
  let file = Promise.resolve();
  const sauver = (modifs = {}) => {
    const suite = file.catch(() => {}).then(async () => {
      const candidat = { ...eleve, ...modifs };
      await enregistrer('eleves', candidat);
      Object.assign(eleve, modifs);
    });
    file = suite;
    return suite;
  };

  const carteId = carte(`${eleve.nom} ${eleve.prenom}`, '', classe ? classe.nom : '');
  // Photo de l'élève (stockée localement, compressée) ou initiales.
  const h2Fiche = carteId.querySelector('h2');
  if (eleve.actif === false) h2Fiche.append(el('span', { class: 'badge' }, 'parti'));
  let photoOK = false;
  if (eleve.photoFichierId) {
    const res = await urlDuFichier(eleve.photoFichierId);
    if (res) {
      const img = el('img', { class: 'avatar avatar-photo', src: res.url, alt: '' });
      img.addEventListener('load', () => URL.revokeObjectURL(res.url), { once: true }); // plus de fuite d'URL (B19)
      img.addEventListener('error', () => URL.revokeObjectURL(res.url), { once: true }); // blob illisible : idem (revue du lot 1)
      h2Fiche.prepend(img);
      photoOK = true;
    }
  }
  if (!photoOK) h2Fiche.prepend(avatar(eleve, classe?.couleur));
  // Sans `capture="user"` : il forçait la caméra FRONTALE sur Android ; le sélecteur natif propose
  // désormais appareil photo (arrière) ou galerie (audit 2026-09-05, B13).
  const inpPhoto = el('input', { type: 'file', accept: 'image/*', hidden: true });
  const statutPhoto = el('p', { class: 'statut', role: 'status' });
  inpPhoto.addEventListener('change', async () => {
    const f = inpPhoto.files[0];
    if (!f) return;
    try {
      statutPhoto.textContent = 'Compression de la photo…'; statutPhoto.className = 'statut'; // retour pendant l'attente (audit 2026-09-07, C44)
      const rec = await preparerFichier(f); // compression HORS transaction (asynchrone)
      // Nouvelle photo, référence de l'élève et suppression de l'ancienne d'un SEUL bloc : une
      // coupure entre les deux laissait un blob orphelin ou une fiche sans photo (avis lot 2, D-04).
      const operations = [
        { store: 'fichiers', op: 'put', valeur: rec },
        { store: 'eleves', op: 'put', valeur: { ...eleve, photoFichierId: rec.id } },
      ];
      if (eleve.photoFichierId) operations.push({ store: 'fichiers', op: 'delete', cle: eleve.photoFichierId });
      await enregistrerLot(operations);
      eleve.photoFichierId = rec.id; // mémoire alignée seulement après l'écriture
      rafraichir();
    } catch (e) {
      statutPhoto.textContent = `Photo non enregistrée : ${e?.message || e}`;
      statutPhoto.className = 'statut statut-erreur';
    }
  });
  // Vrai bouton qui relaie le clic au champ fichier : un <label class="btn"> n'était pas focalisable,
  // on pouvait retirer une photo au clavier mais pas en ajouter (audit 2026-09-07, B03).
  const btnPhoto = el('button', { class: 'btn', type: 'button' }, photoOK ? 'Changer la photo' : 'Ajouter une photo');
  btnPhoto.addEventListener('click', () => inpPhoto.click());
  const rangPhoto = el('div', { class: 'rang-btn' }, btnPhoto, inpPhoto);
  if (photoOK) {
    const btnRetirer = el('button', { class: 'btn' }, 'Retirer la photo');
    btnRetirer.addEventListener('click', async () => {
      // Retrait de la référence et suppression du blob d'un seul bloc (avis lot 2, D-04).
      await enregistrerLot([
        { store: 'eleves', op: 'put', valeur: { ...eleve, photoFichierId: null } },
        { store: 'fichiers', op: 'delete', cle: eleve.photoFichierId },
      ]);
      eleve.photoFichierId = null;
      rafraichir();
    });
    rangPhoto.append(btnRetirer);
  }
  carteId.append(rangPhoto, statutPhoto);
  carteId.append(
    champTexte({ id: 'f-nom', libelle: 'Nom', valeur: eleve.nom, onChange: async (v) => { if (!v) throw new Error('le nom ne peut pas être vide'); await sauver({ nom: v }); } }), // A36
    champTexte({ id: 'f-prenom', libelle: 'Prénom', valeur: eleve.prenom, onChange: async (v) => { if (!v) throw new Error('le prénom ne peut pas être vide'); await sauver({ prenom: v }); } }),
    champSelect({
      id: 'f-sexe', libelle: 'Sexe', valeur: eleve.sexe || '',
      options: [{ value: '', label: '—' }, { value: 'F', label: 'Fille' }, { value: 'M', label: 'Garçon' }],
      onChange: async (v) => { await sauver({ sexe: v }); },
    }),
    champTexte({ id: 'f-naissance', libelle: 'Date de naissance', type: 'date', valeur: eleve.dateNaissance || '', onChange: async (v) => { await sauver({ dateNaissance: v }); } }),
    champSelect({
      id: 'f-classe', libelle: 'Classe', valeur: eleve.classeId,
      options: classes.map((cl) => ({ value: cl.id, label: cl.nom })),
      onChange: async (v) => { await sauver({ classeId: v }); },
    }),
    // Élève parti en cours d'année : masqué à l'appel, aux notes et aux effectifs, historique
    // conservé (le champ `actif` du modèle n'avait aucune interface — audit 2026-09-05, B10).
    champSelect({
      id: 'f-actif', libelle: 'Dans la classe', valeur: eleve.actif === false ? 'parti' : 'oui',
      options: [
        { value: 'oui', label: 'Oui — à l’appel et aux notes' },
        { value: 'parti', label: 'Parti (déménagement, changement d’établissement) — masqué, historique conservé' },
      ],
      onChange: async (v) => { await sauver({ actif: v !== 'parti' }); rafraichir(); },
    }),
    champZone({ id: 'f-notes', libelle: 'À savoir (PAI, asthme, lunettes…)', valeur: eleve.notesPerso || '', placeholder: 'Visible uniquement sur cet appareil', onChange: async (v) => { await sauver({ notesPerso: v }); } }),
  );
  c.append(carteId);

  // --- Historique d'appel (phase 4) ---
  const appelsE = await parIndex('appels', 'eleveId', id);
  const carteAp = carte('Appels & absences EPS');
  if (!appelsE.length) {
    carteAp.append(el('p', {}, 'Aucun appel enregistré pour l’instant.'));
  } else {
    const seancesT = await tous('seances');
    const seqT = await tous('sequences');
    // Vision par trimestre (D012) : l'alerte reste sur le cumul, le tableau situe dans l'année.
    const bornes = await bornesTrimestres();
    const parTri = compterStatutsParTrimestre(appelsE, seancesT, bornes).get(id);
    const triCourant = parTri?.t[bornes.courant] || {};
    // Chips sur l'ANNÉE SCOLAIRE, comme le signalement et le tableau : elles comptaient tout
    // l'historique et contredisaient le tableau juste en dessous (A14, revue du lot 1).
    const cnt = parTri?.annee || {};
    const chips = el('div', { class: 'rang-chips' }, el('span', { class: 'note-inline' }, `Année ${bornes.annee}-${bornes.annee + 1} :`));
    let nbChips = 0;
    for (const [cle, conf] of Object.entries(STATUTS)) {
      if (!cnt[cle]) continue;
      const chip = el('span', { class: 'badge' }, `${conf.libelle} ×${cnt[cle]}`);
      // Même pastille que l'écran d'appel : fond et texte propres au statut s'ils existent (retard en jaune vif).
      chip.style.background = `var(--stbf-${cle}, var(--stb-${cle}))`; // token décliné par thème, pas la couleur brute (B18)
      chip.style.color = `var(--stbt-${cle}, var(--c-sur-accent))`;
      chips.append(chip);
      nbChips++;
    }
    if (!nbChips) chips.append(el('span', { class: 'note-inline' }, 'aucun appel cette année'));
    carteAp.append(chips);
    if (depasseSeuil(parTri?.annee)) { // seuil sur l'année scolaire, pas sur tout l'historique (A14)
      carteAp.append(el('p', { class: 'statut statut-erreur' },
        `⚠ Signalement : ${SEUIL_ALERTE} oublis de tenue ou dispenses atteints sur l’année (T${bornes.courant} : ${triCourant.oubli_tenue || 0} tenue · ${triCourant.dispense || 0} disp.) — penser famille / vie scolaire.`));
    }
    if (parTri) {
      const cles = Object.keys(STATUTS).filter((k) => parTri.annee[k]);
      // Vrai tableau (scope, en-tête de ligne, légende ; le « ● » du trimestre en cours a un
      // équivalent textuel — B07, B43).
      const tableTri = el('table', { class: 'table-apercu' },
        el('caption', {}, `Par trimestre — année scolaire ${bornes.annee}-${bornes.annee + 1} (bornes : Plus → Réglages)`),
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col' }, 'Statut'),
          ...[1, 2, 3].map((t) => el('th', { scope: 'col', title: t === bornes.courant ? 'trimestre en cours' : '' }, `T${t}`,
            t === bornes.courant ? el('span', { 'aria-hidden': 'true' }, ' ●') : '', t === bornes.courant ? el('span', { class: 'sr-only' }, ' (trimestre en cours)') : '')),
          el('th', { scope: 'col' }, 'Année'),
        )),
        el('tbody', {}, ...cles.map((k) => el('tr', {},
          el('th', { scope: 'row' }, STATUTS[k].libelle),
          ...[1, 2, 3].map((t) => el('td', {}, parTri.t[t][k] ? String(parTri.t[t][k]) : '')),
          el('td', {}, String(parTri.annee[k])),
        ))),
      );
      carteAp.append(el('div', { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': 'Appels par trimestre' }, tableTri));
    }
    const derniers = appelsE
      .map((a) => ({ a, s: seancesT.find((x) => x.id === a.seanceId) }))
      .filter((x) => x.s)
      .sort((x, y) => y.s.date.localeCompare(x.s.date))
      .slice(0, 8);
    const listeH = el('div', { class: 'liste-eleves' });
    for (const { a, s } of derniers) {
      const conf = STATUTS[a.statut] || STATUTS.present;
      const b = el('span', { class: 'badge', title: conf.libelle }, conf.court);
      const cleS = a.statut in STATUTS ? a.statut : 'present';
      b.style.background = `var(--stbf-${cleS}, var(--stb-${cleS}))`; // token thématisé (B18), même pastille que l'appel
      b.style.color = `var(--stbt-${cleS}, var(--c-sur-accent))`;
      const seq = seqT.find((q) => q.id === s.sequenceId);
      listeH.append(el('div', { class: 'ligne-eleve' }, b,
        el('span', { class: 'ligne-eleve-nom' },
          `${dateFR(s.date)} · ${seq?.apsa || '?'}${a.minutesRetard ? ` · ${a.minutesRetard} min` : ''}${a.commentaire ? ` · ${a.commentaire}` : ''}`)));
    }
    carteAp.append(listeH);
  }
  // --- Inaptitudes & certificats (phase 5) ---
  const inaptE = (await parIndex('inaptitudes', 'eleveId', id))
    .sort((a, b) => String(b.dateDebut).localeCompare(String(a.dateDebut)));
  const carteIn = carte('Inaptitudes & certificats');
  const aujF = isoAujourdhui();
  if (!inaptE.length) {
    carteIn.append(el('p', {}, 'Aucune inaptitude enregistrée.'));
  } else {
    const listeIn = el('div', { class: 'liste-eleves' });
    for (const i of inaptE) {
      const active = (!i.dateDebut || i.dateDebut <= aujF) && (!i.dateFin || aujF <= i.dateFin);
      listeIn.append(el('a', { class: 'ligne-eleve', href: `#/inaptitudes/${i.id}` },
        el('span', { class: 'badge' + (active ? ' badge-accent' : '') }, active ? 'en cours' : i.dateDebut > aujF ? 'à venir' : 'terminée'),
        el('span', { class: 'ligne-eleve-nom' }, `${i.type === 'totale' ? 'Totale' : 'Partielle'} · ${dateFR(i.dateDebut)} → ${i.dateFin ? dateFR(i.dateFin) : '?'}${i.certificatId ? ' · 📎' : ''}`),
        el('span', { class: 'chevron pousse-droite', 'aria-hidden': 'true' }, '›'),
      ));
    }
    carteIn.append(listeIn);
  }
  carteIn.append(el('div', { class: 'rang-btn' }, el('a', { class: 'btn', href: `#/inaptitudes/nouvelle/${id}` }, '+ Nouvelle inaptitude')));

  // --- Notes (phase 6) ---
  const notesE = await parIndex('notes', 'eleveId', id);
  const carteNo = carte('Notes');
  if (!notesE.length) {
    carteNo.append(el('p', {}, 'Aucune note pour l’instant.'));
  } else {
    const evalsT = await tous('evaluations');
    const seqsT = await tous('sequences');
    const lignesN = notesE
      .map((n) => ({ n, ev: evalsT.find((x) => x.id === n.evaluationId) }))
      .filter((x) => x.ev)
      .sort((x, y) => String(y.ev.date).localeCompare(String(x.ev.date)));
    let somme = 0;
    let poids = 0;
    for (const { n, ev } of lignesN) {
      const bar = baremeDe(ev);
      const coef = Number.isFinite(ev.coef) ? ev.coef : 1; // coef 0 = ne compte pas (B23)
      if (bar && typeof n.valeur === 'number') { somme += (n.valeur / bar) * 20 * coef; poids += coef; }
    }
    if (poids) {
      const moy = formatFR(somme / poids);
      carteNo.append(el('p', { class: 'compteurs' }, el('span', {}, el('strong', {}, moy), '/20 de moyenne générale')));
    }
    const listeN = el('div', { class: 'liste-eleves' });
    for (const { n, ev } of lignesN.slice(0, 8)) {
      const seq = seqsT.find((q) => q.id === ev.sequenceId);
      const bar = baremeDe(ev);
      const valeur = typeof n.valeur === 'number' ? `${formatFR(n.valeur)}${bar ? '/' + bar : ''}` : String(n.valeur);
      listeN.append(el('div', { class: 'ligne-eleve' },
        el('span', { class: 'badge' }, valeur),
        el('span', { class: 'ligne-eleve-nom' }, `${dateFR(ev.date)} · ${seq?.apsa || '?'} · ${ev.titre}`)));
    }
    carteNo.append(listeN);
  }

  c.append(carteAp, carteIn, carteNo);
  c.append(await carteObservations(id, rafraichir));

  const carteSuppr = carte('Supprimer cet élève', 'Supprime l’élève et TOUT son historique (appels, inaptitudes, certificats, notes). Pensez à faire une sauvegarde avant (Plus → Sauvegarde).');
  const btnSuppr = el('button', { class: 'btn btn-danger' }, 'Supprimer définitivement');
  btnSuppr.addEventListener('click', async () => {
    const comptes = await apercuSuppressionEleve(eleve.id);
    if (!(await confirmer({
      titre: `Supprimer ${eleve.prenom} ${eleve.nom} ?`,
      message: 'L’élève et tout son historique seront supprimés. Action définitive.',
      detail: detailSuppression(comptes),
    }))) return;
    const objets = await supprimerEleveEnCascade(eleve.id);
    location.hash = `#/eleves/classe/${eleve.classeId}`;
    toast(`${eleve.prenom} ${eleve.nom} supprimé`, { action: async () => {
      // Un homonyme a pu être (ré)importé entre-temps dans la classe : pas de doublon restauré (D-03).
      const homonyme = (await parIndex('eleves', 'classeId', eleve.classeId))
        .some((x) => cleTexte(x.nom) === cleTexte(eleve.nom) && cleTexte(x.prenom) === cleTexte(eleve.prenom));
      if (homonyme) throw new Error(`${eleve.prenom} ${eleve.nom} existe déjà dans la classe`);
      await restaurer(objets); location.hash = `#/eleves/fiche/${eleve.id}`;
    } });
  });
  carteSuppr.append(el('div', { class: 'rang-btn' }, btnSuppr));
  c.append(carteSuppr);
}

// ---------------------------------------------------------------------------
// Vue : import CSV Pronote
// ---------------------------------------------------------------------------

// « MARTIN Louise » → { nom: 'MARTIN', prenom: 'Louise' }. L'export Pronote met le nom et le prénom
// dans UNE seule colonne, nom de famille en MAJUSCULES : les mots capitalisés de tête forment le nom,
// le reste le prénom — ce qui tient pour un nom en deux mots comme pour un prénom composé
// (test de terrain du 2026-09-09).
export function scinderNomPrenom(texte) {
  const mots = String(texte || '').trim().split(/\s+/).filter(Boolean);
  if (!mots.length) return { nom: '', prenom: '', devine: false };
  const majuscule = (m) => m === m.toLocaleUpperCase('fr') && m !== m.toLocaleLowerCase('fr');
  let i = 0;
  while (i < mots.length && majuscule(mots[i])) i++;
  const sansSignal = i === 0 || i === mots.length;
  // Au-delà de deux mots sans majuscule pour trancher, le découpage est DEVINÉ, pas déduit :
  // « de La Fontaine Apolline » donne nom « de ». À deux mots la convention « NOM Prénom » suffit.
  // Le dire, sinon l'écran d'appel affiche la paire inversée et l'export Pronote sort deux colonnes
  // fausses sans que personne ne l'ait vu passer (revue du correctif de terrain).
  const devine = sansSignal && mots.length > 2;
  if (sansSignal) i = 1; // pas de majuscules distinctives : le 1er mot fait le nom
  return { nom: mots.slice(0, i).join(' '), prenom: mots.slice(i).join(' '), devine };
}

// Vocabulaire de la détection de colonnes. Les en-têtes sont découpés en MOTS (et non écrasés en une
// seule chaîne) : sans frontières de mots, « Nombre d'élèves » contenait « nom » et « Resp. Nom »
// ressemblait à « Nom » (audit Codex V4).
// Élisions et mots de liaison : les SEULS jetons courts qu'on accepte de perdre. Tout autre caractère
// isolé — « Nom 1 », « Prénom 2 », « Nom R » — reste un mot, donc rend l'en-tête SALE. Les juger « au
// poids » laissait passer la numérotation des responsables (revue de l'audit V5).
const MOTS_LIAISON = new Set(['d', 'l', 'de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'au', 'aux', 'pour']);
// Mots qui nomment l'APPRENANT, et qualificatifs d'un NOM : deux catégories closes de la langue.
// Y ajouter un mot, c'est remplir une catégorie — l'inverse d'une liste de tiers, qui serait sans fin.
const MOTS_ELEVE = new Set(['eleve', 'apprenant', 'stagiaire', 'etudiant', 'inscrit', 'jeune']);
const MOTS_QUALIF_NOM = new Set(['famille', 'usage', 'usuel', 'naissance', 'patronymique', 'legal', 'legale', 'marital', 'maritale', 'fille']);
const MOTS_QUALIF_PRENOM = new Set(['usage', 'usuel', 'naissance', 'legal', 'legale']);
// Second rideau, utile aux champs non identitaires : « Date de naissance du responsable » ne doit pas
// être proposée. Pour l'identité, c'est la règle de propreté ci-dessous qui fait tout le travail.
const MOTS_TIERS = /responsable|parent|tuteur|tutrice|representant|pere|mere/;
const racineMot = (m) => (m.length > 3 && m.endsWith('s') ? m.slice(0, -1) : m);
// La flexion entre parenthèses est retirée À LA SOURCE : « Prénom(s) » → « prenom », « Né(e) le » →
// « ne le ». C'est ce qui permet de garder tous les autres jetons courts.
const motsEntete = (e) => normaliser(e).replace(/\((?:s|e|es)\)/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
  .filter((m) => m && !MOTS_LIAISON.has(m)).map(racineMot);

// UNE règle, et une seule : une colonne d'identité n'est proposée d'office que si son en-tête est
// PROPRE, c'est-à-dire s'il ne nomme QUE le champ, l'élève et des mots de liaison. Dès qu'il nomme
// autre chose — « Nom contact », « Nom Resp. », « Nom RL1 », « Nom du contact d'urgence de l'élève » —
// l'application s'abstient et le dit, au lieu d'inventer une identité (audit Codex V4 puis V5).
// On énumère ce qu'on ACCEPTE autour du champ, jamais les tiers qu'on refuse : Pronote abrège
// « responsable » en « Resp. », Siècle numérote « RL1 », et la liste n'aurait pas de fin.
// Le professeur garde la main : les colonnes écartées restent choisissables dans les listes.
export function detecterColonnes(entetes) {
  const brutes = entetes.map((e) => cleTexte(e));
  const t = entetes.map(motsEntete);
  const evaluer = (toks, i, champs, qualif, exclut) => {
    if (MOTS_TIERS.test(brutes[i])) return 0;
    if (exclut.some((x) => toks.includes(x))) return 0;
    if (!champs.some((c) => toks.includes(c))) return 0;
    return toks.every((m) => champs.includes(m) || MOTS_ELEVE.has(m) || qualif.has(m)) ? 2 : 1;
  };
  const meilleure = (champs, qualif, exclut, propreSeulement) => {
    let choix = -1;
    let force = 0;
    t.forEach((toks, i) => {
      const f = evaluer(toks, i, champs, qualif, exclut);
      if (f > force) { force = f; choix = i; } // à force égale, la première colonne du fichier gagne
    });
    return propreSeulement && force < 2 ? -1 : choix;
  };
  // Colonne unique « nom et prénom dans la même cellule » : l'en-tête ne nomme QUE l'élève
  // (« Élèves »), ou il nomme les deux champs (« Nom et prénom »), ou il dit « complet ».
  // « Nom de l'élève » n'en est PAS une : c'est un nom de famille, et la compter ici n'importait
  // personne — le découpage rendait un prénom vide, donc une ligne incomplète.
  const colonneUnique = () => {
    let choix = -1;
    let force = 0;
    t.forEach((toks, i) => {
      if (MOTS_TIERS.test(brutes[i])) return;
      const entiteSeule = toks.length === 1 && MOTS_ELEVE.has(toks[0]);
      const lesDeuxChamps = toks.includes('nom') && toks.includes('prenom');
      const ditComplet = toks.includes('nom') && toks.includes('complet');
      if (!(entiteSeule || lesDeuxChamps || ditComplet)) return;
      const propre = toks.every((m) => m === 'nom' || m === 'prenom' || m === 'complet' || MOTS_ELEVE.has(m));
      const f = propre ? 2 : 1;
      if (f > force) { force = f; choix = i; }
    });
    return force < 2 ? -1 : choix;
  };
  return {
    // Les trois cibles d'identité exigent un signal propre ; les autres se contentent du meilleur
    // disponible, une erreur y étant visible (une date, un sexe) ou rattrapée par le choix explicite
    // de la destination (la classe).
    prenom: meilleure(['prenom'], MOTS_QUALIF_PRENOM, [], true),
    nom: meilleure(['nom'], MOTS_QUALIF_NOM, ['prenom'], true),
    nomComplet: colonneUnique(),
    // « Né(e) à » désigne un LIEU : le « a » reste un mot pour qu'on puisse l'exclure.
    dateNaissance: meilleure(['naissance', 'ne', 'nee'], new Set(['date']), ['lieu', 'commune', 'ville', 'departement', 'pay', 'a'], false),
    sexe: meilleure(['sexe', 'genre'], new Set(), [], false),
    classe: meilleure(['classe', 'division'], new Set(['rattachement']), [], false),
  };
}
async function executerImport(lignes, dest) {
  const annee = await lireMeta('anneeScolaire', '');
  const classes = await tous('classes');
  // Une classe ARCHIVÉE ne reçoit pas d'import en silence (les élèves resteraient invisibles) :
  // refus AVANT toute écriture, avec la marche à suivre (audit 2026-09-07, D-15).
  const parCle = new Map(classes.filter((cl) => !cl.archivee).map((cl) => [cleTexte(cl.nom), cl]));
  const archivees = new Map(classes.filter((cl) => cl.archivee).map((cl) => [cleTexte(cl.nom), cl]));
  const nomsVises = dest.mode === 'nouvelle' ? [dest.nom] : dest.mode === 'colonne' ? lignes.map((l) => l.classe).filter(Boolean) : [];
  const bloquee = nomsVises.map((nom) => cleTexte(nom)).find((cle) => !parCle.has(cle) && archivees.has(cle));
  if (bloquee) {
    throw new Error(`la classe « ${archivees.get(bloquee).nom} » est archivée : restaurez-la d’abord (Élèves → Classes archivées) ou choisissez une autre destination`);
  }
  let ordre = classes.length;
  const classesCreees = [];
  // Rien n'est écrit dans la boucle : tout est collecté, puis écrit en UNE transaction (avis
  // « créations atomiques », lot 2, D-06) — un import interrompu laissait une classe à moitié
  // remplie sans le dire, et payait une transaction par classe et par élève (150+ sur un import réel).
  const aEcrire = { classes: [], eleves: [] };
  const assurerClasse = (nom) => {
    const cle = cleTexte(nom);
    if (parCle.has(cle)) return parCle.get(cle);
    const cl = {
      id: crypto.randomUUID(), nom: String(nom).trim(), niveau: devinerNiveau(nom),
      anneeScolaire: annee, couleur: PALETTE[ordre % PALETTE.length], ordre: ordre++, archivee: false,
    };
    parCle.set(cle, cl);
    aEcrire.classes.push(cl);
    classesCreees.push(cl.nom);
    return cl;
  };

  let classeFixe = null;
  if (dest.mode === 'existante') classeFixe = await lire('classes', dest.classeId);
  if (dest.mode === 'nouvelle') classeFixe = assurerClasse(dest.nom);

  const existants = await tous('eleves');
  const dejaLa = new Map(existants.map((e) => [`${cleTexte(e.nom)}|${cleTexte(e.prenom)}@${e.classeId}`, e]));
  const resultat = { importes: 0, doublons: 0, reactives: 0, ignores: 0, homonymes: [], datesRejetees: 0, scissionsDevinees: 0, classesCreees, classesTouchees: new Set() };

  for (const l of lignes) {
    if (!l.nom || !l.prenom) { resultat.ignores++; continue; }
    const classe = classeFixe || (l.classe ? assurerClasse(l.classe) : null);
    if (!classe) { resultat.ignores++; continue; }
    const cle = `${cleTexte(l.nom)}|${cleTexte(l.prenom)}@${classe.id}`;
    const deja = dejaLa.get(cle);
    if (deja) {
      // Élève « parti » qui revient dans la liste Pronote : réactivé au lieu d'être ignoré en
      // silence comme un doublon (audit 2026-09-07, D-13).
      if (deja.actif === false) {
        deja.actif = true;
        aEcrire.eleves.push(deja);
        resultat.reactives++;
        resultat.classesTouchees.add(classe.nom);
      } else resultat.doublons++;
      continue;
    }
    dejaLa.set(cle, { actif: true });
    const naissance = dateFRversISO(l.dateNaissance);
    if (String(l.dateNaissance || '').trim() && !naissance) resultat.datesRejetees++; // renseignée mais non reconnue ou impossible (B46, C51)
    aEcrire.eleves.push({
      id: crypto.randomUUID(), classeId: classe.id, nom: l.nom, prenom: l.prenom,
      sexe: normaliserSexe(l.sexe), dateNaissance: naissance,
      notesPerso: '', actif: true,
    });
    resultat.importes++;
    // Un nom découpé au jugé est signalé comme les homonymes : sans cela, l'erreur ne se découvre
    // qu'au premier appel, sur le terrain (revue du correctif de terrain).
    if (l.scissionDevinee) resultat.scissionsDevinees++;
    // Même nom dans une AUTRE classe (partis compris) : changement de classe probable, l'historique
    // serait scindé en deux fiches sans un mot (audit 2026-09-07, C14) — signalé, pas bloqué.
    const ailleurs = existants.find((x) => x.classeId !== classe.id && cleTexte(x.nom) === cleTexte(l.nom) && cleTexte(x.prenom) === cleTexte(l.prenom));
    if (ailleurs) resultat.homonymes.push(classes.find((cl) => cl.id === ailleurs.classeId)?.nom || '?');
    resultat.classesTouchees.add(classe.nom);
  }
  // Tout ou rien : si l'écriture est refusée, aucune classe ni aucun élève n'est créé et le message
  // d'erreur de l'appelant s'affiche (avis lot 2, D-06).
  await restaurer(aEcrire);
  return resultat;
}

async function vueImport(c) {
  c.append(el('a', { class: 'retour', href: '#/eleves' }, '← Classes'));

  // --- Étape 1 : source ---
  const carteSource = carte('1 · Source', 'Collez la liste copiée depuis Pronote, ou choisissez le fichier CSV exporté. Séparateur (; ou tabulation) et encodage (UTF-8 / Windows / UTF-16) détectés automatiquement.');
  const zone = el('textarea', { rows: 6, 'aria-label': 'Données CSV collées', placeholder: 'Nom;Prénom;Né(e) le;Sexe;Classe\nDUPONT;Léa;12/03/2014;F;6A\n…' });
  const inputFichier = el('input', { type: 'file', accept: '.csv,.txt,text/csv,text/plain', class: 'champ-fichier', 'aria-label': 'Fichier CSV Pronote' });
  const btnAnalyser = el('button', { class: 'btn btn-principal' }, 'Analyser');
  const btnExemple = el('button', { class: 'btn' }, 'Essayer avec l’exemple');
  const statutSource = el('p', { class: 'statut', role: 'status' });
  carteSource.append(el('div', { class: 'champ' }, zone), inputFichier, el('div', { class: 'rang-btn' }, btnAnalyser, btnExemple), statutSource);
  const suite = el('div', {});
  c.append(carteSource, suite);

  btnExemple.addEventListener('click', async () => {
    try {
      const rep = await fetch('data/exemple_eleves_pronote.csv');
      if (!rep.ok) throw new Error(`HTTP ${rep.status}`); // hors ligne, le service-worker répond 504 (pas un rejet) — revue du lot 4
      zone.value = await rep.text();
      statutSource.textContent = 'Exemple chargé (10 élèves fictifs) — cliquez sur Analyser.';
      statutSource.className = 'statut statut-ok';
    } catch {
      statutSource.textContent = 'Exemple indisponible.';
      statutSource.className = 'statut statut-erreur';
    }
  });

  btnAnalyser.addEventListener('click', async () => {
    suite.replaceChildren(); // une analyse refusée laissait le mapping et le bouton du collage PRÉCÉDENT actifs (revue du lot 5)
    try {
      const texte = inputFichier.files[0] ? await lireTexteCSV(inputFichier.files[0]) : zone.value;
      if (!texte.trim()) throw new Error('aucune donnée : collez du texte ou choisissez un fichier');
      const analyse = parserCSV(texte);
      statutSource.textContent = `${analyse.lignes.length} lignes lues (séparateur « ${analyse.separateur === '\t' ? 'tabulation' : analyse.separateur} »).`;
      statutSource.className = 'statut statut-ok';
      afficherMapping(suite, analyse);
    } catch (e) {
      statutSource.textContent = `Analyse impossible : ${e?.message || e}`;
      statutSource.className = 'statut statut-erreur';
    }
  });
}

async function afficherMapping(c, analyse) {
  c.replaceChildren();
  const { entetes, lignes } = analyse;
  // Colonnes présentes dans les données mais absentes de l'en-tête : proposées au mapping et à
  // l'aperçu au lieu de rester invisibles (audit 2026-09-07, C13).
  const nbCol = lignes.reduce((m, l) => Math.max(m, l.length), entetes.length);
  const colonnes = Array.from({ length: nbCol }, (_, i) => entetes[i] || `Colonne ${i + 1}`);
  const auto = detecterColonnes(entetes);

  // --- Étape 2 : correspondance des colonnes ---
  // Pas de « correspondance détectée » : sur un fichier dont aucun en-tête ne nomme franchement
  // l'élève, l'app n'en détecte aucune, et la carte l'affirmait quand même (revue de l'audit V5).
  const carteMap = carte('2 · Colonnes',
    'Vérifiez la correspondance des colonnes. Pour l’identité, indiquez soit « Nom et prénom », soit « Nom » ET « Prénom ».');
  const selects = {};
  const cibles = [
    // Pas d'astérisque : aucune de ces trois colonnes n'est obligatoire à elle seule, c'est la
    // COMBINAISON qui l'est. Les trois étoiles d'avant se contredisaient entre elles (revue V4).
    ['nomComplet', 'Nom et prénom (une seule colonne)'],
    ['nom', 'Nom'], ['prenom', 'Prénom'], ['dateNaissance', 'Date de naissance'],
    ['sexe', 'Sexe'], ['classe', 'Classe'],
  ];
  for (const [cle, libelle] of cibles) {
    const sel = el('select', { id: `map-${cle}` },
      el('option', { value: '-1' }, '— ignorer —'),
      ...colonnes.map((e, i) => el('option', { value: String(i) }, e)),
    );
    sel.value = String(auto[cle] ?? -1);
    selects[cle] = sel;
    carteMap.append(el('div', { class: 'champ' }, el('label', { for: `map-${cle}` }, libelle), sel));
  }
  // La colonne unique « Nom et prénom » est découpée par une heuristique (majuscules de tête) qui peut
  // se tromper sur une casse inhabituelle : l'enseignant doit VOIR le résultat avant d'importer,
  // l'aperçu brut ne montrant que la cellule d'origine (revue du correctif de terrain).
  // role="status" : ces deux notes apparaissent en cours de route, au changement d'une liste
  // déroulante. Sans région live, un lecteur d'écran ne les annonçait jamais (revue V4).
  const apercuScission = el('p', { class: 'note-discrete', id: 'apercu-scission', role: 'status', hidden: true }, '');
  // L'import refuse quand l'identité est incomplète : le dire AVANT le clic, pas après. La carte
  // affirmait « correspondance détectée » alors qu'elle n'avait rien trouvé (revue V4).
  // Le texte est POSÉ au moment où la note s'affiche, pas écrit une fois pour toutes : une région
  // live n'annonce que ce qui CHANGE, et dévoiler un texte déjà présent en retirant « hidden » ne
  // déclenche rien de garanti chez tous les lecteurs d'écran (revue V4).
  const noteIdentite = el('p', { class: 'note-discrete', id: 'note-identite', role: 'status', hidden: true }, '');
  const TEXTE_IDENTITE = 'Identité incomplète : désignez une colonne « Nom et prénom », ou les colonnes « Nom » ET « Prénom ».';
  carteMap.append(apercuScission, noteIdentite);
  const modeCombine = () => Number(selects.nomComplet.value) >= 0
    && (Number(selects.nom.value) < 0 || Number(selects.prenom.value) < 0);
  const majApercuScission = () => {
    const actif = modeCombine();
    apercuScission.hidden = !actif;
    const identiteOk = actif || (Number(selects.nom.value) >= 0 && Number(selects.prenom.value) >= 0);
    noteIdentite.hidden = identiteOk;
    noteIdentite.textContent = identiteOk ? '' : TEXTE_IDENTITE;
    if (!actif) return;
    const col = Number(selects.nomComplet.value);
    const valeurs = lignes.map((l) => String(l[col] || '').trim()).filter(Boolean);
    // Les cas DEVINÉS passent devant : montrer les deux premières lignes ne les aurait jamais fait
    // voir, alors que ce sont les seuls où le découpage peut être faux.
    const douteuses = valeurs.filter((v) => scinderNomPrenom(v).devine);
    const exemples = [...new Set([...douteuses, ...valeurs])].slice(0, 2)
      .map((v) => {
        const s = scinderNomPrenom(v);
        return `« ${v} » → nom ${s.nom || '(vide)'}, prénom ${s.prenom || '(vide)'}`;
      });
    const alerte = douteuses.length
      ? ` ${douteuses.length} nom${douteuses.length > 1 ? 's' : ''} sans majuscule distinctive : le découpage y est deviné.`
      : '';
    apercuScission.textContent = exemples.length
      ? `Découpage de la colonne unique : ${exemples.join(' · ')}.${alerte} Si c'est faux, désignez les colonnes « Nom » et « Prénom » séparément.`
      : '';
  };
  for (const cle of ['nomComplet', 'nom', 'prenom']) selects[cle].addEventListener('change', majApercuScission);

  // aperçu brut des 3 premières lignes
  const table = el('table', { class: 'table-apercu' },
    el('caption', {}, 'Aperçu des 3 premières lignes du fichier'),
    el('thead', {}, el('tr', {}, ...colonnes.map((e) => el('th', { scope: 'col' }, e)))),
    el('tbody', {}, ...lignes.slice(0, 3).map((l) => el('tr', {}, ...colonnes.map((_, i) => el('td', {}, l[i] || ''))))),
  );
  carteMap.append(el('div', { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': 'Aperçu du fichier' }, table));
  c.append(carteMap);
  // Le premier calcul vient APRÈS l'insertion : une région live injectée déjà remplie n'est annoncée
  // par aucun lecteur d'écran, et c'est justement l'instant où l'app décide de ne rien proposer
  // (revue de l'audit V5).
  majApercuScission();

  // --- Étape 3 : destination ---
  const carteDest = carte('3 · Classe de destination');
  const classes = (await tous('classes')).filter((cl) => !cl.archivee).sort(trierClasses);
  // Le <label> n'enveloppe que la radio et son texte : un select ou un champ texte à l'intérieur
  // d'un label en devenait le « nom » (audit 2026-09-07, B21).
  const radio = (valeur, libelle, controle = '') => {
    const r = el('input', { type: 'radio', name: 'dest-mode', value: valeur, id: `dest-${valeur}` });
    return { r, ligne: el('div', { class: 'ligne-option' }, el('label', { for: `dest-${valeur}` }, r, ` ${libelle}`), controle) };
  };
  const selExistante = el('select', { 'aria-label': 'Classe existante' }, ...classes.map((cl) => el('option', { value: cl.id }, cl.nom)));
  const inpNouvelle = el('input', { type: 'text', placeholder: 'Nom de la nouvelle classe', 'aria-label': 'Nom de la nouvelle classe', autocomplete: 'off' });
  const rColonne = radio('colonne', 'Utiliser la colonne « Classe » (création automatique)');
  const rExistante = radio('existante', 'Tout mettre dans :', selExistante);
  const rNouvelle = radio('nouvelle', 'Créer la classe :', inpNouvelle);
  const noteClasse = el('p', { class: 'note-discrete', id: 'note-classe', role: 'status', hidden: true }, '');
  const TEXTE_CLASSE_VIDE = 'La colonne « Classe » du fichier est vide : indiquez la classe ci-dessous.';
  const TEXTE_CLASSE_ABSENTE = 'Aucune colonne « Classe » dans le fichier : indiquez la classe ci-dessous.';
  carteDest.append(noteClasse);
  if (!classes.length) rExistante.r.disabled = true;
  const colonneRemplie = (col) => col >= 0 && lignes.some((l) => String(l[col] || '').trim());
  // UNE seule source de vérité pour l'état de la destination, appelée au premier rendu ET à chaque
  // remappage manuel de la colonne « Classe ». Auparavant la note était calculée une fois pour
  // toutes pendant que la radio, elle, se recalculait : les deux divergeaient dès le premier
  // changement (revue du correctif de terrain).
  // Une colonne « Classe » DÉTECTÉE mais entièrement VIDE (export Pronote d'une seule classe) ne
  // doit pas piloter la destination : toutes les lignes seraient déclarées incomplètes, et surtout
  // rien ne doit choisir une classe à la place de l'enseignant — « Tout mettre dans : » se cochait
  // sur la PREMIÈRE classe de la liste, et le deuxième export Pronote y versait 28 élèves
  // (terrain 2026-09-09, puis revue).
  const majDestination = (premierRendu) => {
    const col = Number(selects.classe.value);
    const utilisable = colonneRemplie(col);
    // ABSENTE compte autant que VIDE : sans colonne de classe du tout, « Tout mettre dans : » se
    // cochait encore sur la PREMIÈRE classe de la liste — le cas le plus banal, un simple
    // copier-coller « Nom;Prénom » depuis un tableur (revue de l'audit V5).
    const vide = !utilisable;
    rColonne.r.disabled = !utilisable;
    noteClasse.hidden = !vide;
    noteClasse.textContent = vide ? (col >= 0 ? TEXTE_CLASSE_VIDE : TEXTE_CLASSE_ABSENTE) : '';
    const defaut = utilisable ? rColonne : vide ? rNouvelle : classes.length ? rExistante : rNouvelle;
    if (premierRendu || (rColonne.r.disabled && rColonne.r.checked)) defaut.r.checked = true;
  };
  majDestination(true);
  // Mapping manuel de « Classe » : le mode « Utiliser la colonne » suit (il restait inerte,
  // ou coché alors que la colonne venait d'être ignorée — audit 2026-09-07, C12).
  selects.classe.addEventListener('change', () => majDestination(false));
  carteDest.append(el('fieldset', { class: 'groupe' }, el('legend', { class: 'sr-only' }, 'Classe de destination'), rColonne.ligne, rExistante.ligne, rNouvelle.ligne));
  c.append(carteDest);

  // --- Étape 4 : import ---
  const carteGo = carte('4 · Importer');
  const btnImporter = el('button', { class: 'btn btn-principal' },
    `Importer ${lignes.length} élève${lignes.length > 1 ? 's' : ''}`);
  const statutImport = el('p', { class: 'statut', role: 'status' });
  carteGo.append(el('div', { class: 'rang-btn' }, btnImporter), statutImport);
  c.append(carteGo);

  let importFait = false;
  btnImporter.addEventListener('click', async () => {
    if (importFait) return;
    try {
      const colonne = (cle) => Number(selects[cle].value);
      // Deux façons de nommer un élève : deux colonnes séparées, ou une seule « Nom et prénom »
      // (export Pronote). Les colonnes séparées l'emportent si elles sont renseignées.
      // Il suffit que la paire Nom + Prénom soit INCOMPLÈTE : « Nom du responsable » ou « Nom de
      // naissance » satisfait la règle « nom » et désarmait la scission, au point d'importer
      // l'identité du TUTEUR dans la fiche de l'élève (revue du correctif de terrain).
      // Même règle que l'aperçu affiché à l'étape 2 : l'écran ne doit pas promettre autre chose.
      const combine = modeCombine();
      if (!combine && (colonne('nom') < 0 || colonne('prenom') < 0)) {
        throw new Error('indiquez soit une colonne « Nom » et une colonne « Prénom », soit une colonne « Nom et prénom »');
      }
      const valeur = (l, cle) => (colonne(cle) >= 0 ? l[colonne(cle)] || '' : '');
      const prep = lignes.map((l) => {
        const scinde = combine ? scinderNomPrenom(valeur(l, 'nomComplet')) : null;
        return {
          nom: scinde ? scinde.nom : valeur(l, 'nom').trim(),
          prenom: scinde ? scinde.prenom : valeur(l, 'prenom').trim(),
          scissionDevinee: !!(scinde && scinde.devine),
          dateNaissance: valeur(l, 'dateNaissance'),
          sexe: valeur(l, 'sexe'),
          classe: valeur(l, 'classe').trim(),
        };
      });
      const mode = document.querySelector('input[name="dest-mode"]:checked')?.value;
      const dest = { mode };
      if (mode === 'existante') dest.classeId = selExistante.value;
      if (mode === 'nouvelle') {
        dest.nom = inpNouvelle.value.trim();
        if (!dest.nom) throw new Error('donnez un nom à la nouvelle classe');
      }
      btnImporter.disabled = true;
      const r = await executerImport(prep, dest);
      const morceaux = [`${r.importes} élève${r.importes > 1 ? 's' : ''} importé${r.importes > 1 ? 's' : ''}`];
      if (r.classesTouchees.size) morceaux.push(`dans ${[...r.classesTouchees].join(', ')}`);
      if (r.classesCreees.length) morceaux.push(`(${r.classesCreees.length} classe${r.classesCreees.length > 1 ? 's' : ''} créée${r.classesCreees.length > 1 ? 's' : ''})`);
      if (r.reactives) morceaux.push(`· ${r.reactives} élève${r.reactives > 1 ? 's' : ''} parti${r.reactives > 1 ? 's' : ''} réactivé${r.reactives > 1 ? 's' : ''}`);
      if (r.doublons) morceaux.push(`· ${r.doublons} doublon${r.doublons > 1 ? 's' : ''} ignoré${r.doublons > 1 ? 's' : ''}`);
      if (r.ignores) morceaux.push(`· ${r.ignores} ligne${r.ignores > 1 ? 's' : ''} incomplète${r.ignores > 1 ? 's' : ''}`);
      if (r.datesRejetees) morceaux.push(`· ${r.datesRejetees} date${r.datesRejetees > 1 ? 's' : ''} de naissance non reconnue${r.datesRejetees > 1 ? 's' : ''} (laissée${r.datesRejetees > 1 ? 's' : ''} vide${r.datesRejetees > 1 ? 's' : ''})`);
      if (r.scissionsDevinees) morceaux.push(`· ${r.scissionsDevinees} nom${r.scissionsDevinees > 1 ? 's' : ''} découpé${r.scissionsDevinees > 1 ? 's' : ''} au jugé (nom et prénom à vérifier)`);
      if (r.homonymes.length) morceaux.push(`· ${r.homonymes.length} élève${r.homonymes.length > 1 ? 's' : ''} porte${r.homonymes.length > 1 ? 'nt' : ''} le même nom qu’un élève d’une autre classe (${[...new Set(r.homonymes)].join(', ')}) — changement de classe ? à vérifier`);
      statutImport.textContent = morceaux.join(' ') + '.';
      statutImport.className = 'statut statut-ok';
      // Import abouti : le bouton NE se réarme pas. Un second clic rejouait tout l'import (les
      // élèves revenaient en « doublons ignorés », ce qui masquait le premier bilan) et empilait
      // un deuxième « Voir les classes » sous le premier (revue V4).
      importFait = true;
      if (!carteGo.querySelector('.apres-import')) {
        carteGo.append(el('div', { class: 'rang-btn apres-import' },
          el('a', { class: 'btn btn-principal', href: '#/eleves' }, 'Voir les classes')));
      }
    } catch (e) {
      statutImport.textContent = `Import impossible : ${e?.message || e}`;
      statutImport.className = 'statut statut-erreur';
      // Le bouton vit un écran plus bas que la carte des colonnes : sans ce renvoi, il fallait
      // remonter et retrouver soi-même les bonnes listes (revue de l'audit V5).
      if (/colonne/i.test(e?.message || '')) {
        carteMap.scrollIntoView({ block: 'start' });
        selects.nom.focus();
      }
    } finally {
      btnImporter.disabled = importFait;
    }
  });
}

// ---------------------------------------------------------------------------

export function initialiser() {
  enregistrerVue('eleves', async (c, params = []) => {
    const [sous, id] = params;
    if (sous === 'classe' && id) return vueClasse(c, id);
    if (sous === 'fiche' && id) return vueFiche(c, id);
    if (sous === 'import') return vueImport(c);
    return vueListeClasses(c);
  });
}
