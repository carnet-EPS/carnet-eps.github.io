// modules/notes.js — évaluations & notes + export Pronote (phase 6).
// Sous-routes : #/notes (liste + création) · #/notes/eval/<id> (grille de saisie)
//               · #/notes/releve/<classeId> (relevé imprimable)
// Un marquage « publiée » ne vaut que pour les valeurs qui ont ÉTÉ remontées. Dès qu'une note ou le
// barème change, la date est conservée — elle dit quand la remontée a eu lieu — et l'évaluation
// passe « à remettre à jour » (audit Codex V3, constat V3-03).
const texteBadgePubliee = (ev) => (ev.publieePronote
  ? `publiée ${dateFR(ev.publieePronote)}${ev.publieeObsolete ? ' · à remettre à jour' : ' ✓'}`
  : '');

// Export Pronote (docs/pronote.md) : voie A = colonne presse-papiers triée alphabétiquement
// (codes ABS/DISP/NN laissés en lignes vides + liste à saisir à la main, garde-fou effectif) ;
// voie B = CSV Nom;Prénom;Note. Type « afl » = positionnement libre, non exportable vers Pronote.

import { enregistrerVue, el, carte, champ, champTexte, confirmer, choisir, toast } from '../ui.js';
import { tous, lire, lireMeta, parIndex, enregistrer, supprimerLot, restaurer, telechargerTexte, champCSV, mettreAJourEvaluation } from '../io.js';
import { isoAujourdhui, dateFR, trierEleves, trierClasses, baremeDe, formatFR, inaptitudesActives } from '../metier.js';
import { validerGrille, calculerGrille } from '../grilles-calcul.js';
import { sauverPrefs } from '../state.js';

const CODES = ['ABS', 'DISP', 'NN'];

// "12,5" → nombre · "ABS"/"A" → code · "" → vide · sinon invalide (type afl : texte libre)
function parserValeur(brut, max) {
  const t = String(brut).trim().toUpperCase().replace(',', '.');
  if (t === '') return { vide: true };
  if (t === 'ABS' || t === 'A') return { code: 'ABS' };
  if (t === 'DISP' || t === 'D') return { code: 'DISP' };
  if (t === 'NN' || t === 'N') return { code: 'NN' };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > max) return { invalide: true };
  return { nombre: Math.round(n * 100) / 100 };
}

function afficherValeur(v, bareme) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return bareme ? `${formatFR(v)}/${bareme}` : formatFR(v);
  return String(v);
}

// ---------------------------------------------------------------------------
// Vue : liste des évaluations + création
// ---------------------------------------------------------------------------

async function vueListe(c) {
  const actions = el('div', { class: 'barre-actions no-print' },
    el('a', { class: 'btn', href: '#/grilles' }, 'Gérer les grilles d’évaluation'));
  c.append(actions);
  const grilles = (await tous('grilles')).filter(g => !g.archivee);
  const [classes, sequences, evaluations, notes, eleves] = await Promise.all([
    tous('classes'), tous('sequences'), tous('evaluations'), tous('notes'), tous('eleves'),
  ]);
  const classeDe = (id) => classes.find((cl) => cl.id === id);
  const seqDe = (id) => sequences.find((s) => s.id === id);
  if (!sequences.length) {
    c.append(carte('Pas encore de séquence', 'Une évaluation se rattache à une séquence (classe × APSA) : créez-en une d’abord (Plus → Séquences).'),
      el('div', { class: 'rang-btn' }, el('a', { class: 'btn btn-principal', href: '#/sequences' }, 'Créer une séquence')));
    return;
  }

  // --- Création ---
  const btnNouvelle = el('button', { class: 'btn btn-principal', 'aria-expanded': 'false' }, '+ Nouvelle évaluation');
  actions.append(btnNouvelle);

  const seqTriees = [...sequences].sort((a, b) => String(b.dateDebut || '').localeCompare(String(a.dateDebut || '')));
  const selSeq = el('select', { id: 'ev-seq' }, ...seqTriees.map((s) =>
    el('option', { value: s.id }, `${classeDe(s.classeId)?.nom || '?'} — ${s.apsa}`)));
  const inpTitre = el('input', { type: 'text', id: 'ev-titre', placeholder: 'Match en montante, contrôle final…', autocomplete: 'off' });
  const inpDate = el('input', { type: 'date', id: 'ev-date' });
  inpDate.value = isoAujourdhui();
  const selType = el('select', { id: 'ev-type' },
    el('option', { value: 'grille' }, 'Grille d’évaluation EPS'),
    el('option', { value: 'note20' }, 'Note sur 20'),
    el('option', { value: 'bareme' }, 'Barème personnalisé'),
    el('option', { value: 'afl' }, 'AFL / positionnement (texte, non exporté vers Pronote)'));
  selType.value = 'note20';
  const selGrille = el('select',{id:'ev-grille'},el('option',{value:''},'Choisir une grille'),...grilles.map(g => el('option',{value:g.id},g.titre)));
  const blocGrille = champ('ev-grille','Grille à utiliser',selGrille); blocGrille.hidden=true;
  const inpBareme = el('input', { type: 'number', id: 'ev-bareme', min: '1', max: '200', value: '10' });
  const blocBareme = el('div', { class: 'champ' }, el('label', { for: 'ev-bareme' }, 'Barème ( /x )'), inpBareme);
  blocBareme.hidden = true;
  selType.addEventListener('change', () => { blocBareme.hidden = !['bareme','grille'].includes(selType.value); blocGrille.hidden=selType.value!=='grille'; if(selType.value==='grille')inpBareme.value='20'; });
  const inpCoef = el('input', { type: 'number', id: 'ev-coef', min: '0', max: '10', step: '0.5', value: '1' });
  const statutForm = el('p', { class: 'statut', role: 'status' });
  const btnCreer = el('button', { class: 'btn btn-principal' }, 'Créer et saisir les notes');
  const form = carte('Nouvelle évaluation');
  form.append(
    champ('ev-seq', 'Séquence', selSeq),
    champ('ev-titre', 'Titre *', inpTitre),
    el('div', { class: 'rang-2' }, champ('ev-date', 'Date', inpDate), champ('ev-coef', 'Coefficient', inpCoef)),
    champ('ev-type', 'Type', selType),
    blocBareme, blocGrille,
    el('div', { class: 'rang-btn' }, btnCreer),
    statutForm,
  );
  form.hidden = true;
  c.append(form);
  btnNouvelle.addEventListener('click', () => { form.hidden = !form.hidden; btnNouvelle.setAttribute('aria-expanded', String(!form.hidden)); if (!form.hidden) inpTitre.focus(); });
  btnCreer.addEventListener('click', async () => {
    const titre = inpTitre.value.trim();
    if (!titre) { statutForm.textContent = 'Le titre est obligatoire.'; statutForm.className = 'statut statut-erreur'; return; }
    // Coefficient 0 accepté (évaluation blanche, non comptée) : `|| 1` le transformait en 1 sans
    // rien dire (audit 2026-09-05, B23). Vide → 1 ; négatif ou non numérique → refusé (B42).
    const coefSaisi = inpCoef.value.trim() === '' ? 1 : Number(inpCoef.value);
    if (!(Number.isFinite(coefSaisi) && coefSaisi >= 0)) {
      statutForm.textContent = 'Le coefficient doit être un nombre ≥ 0.'; statutForm.className = 'statut statut-erreur'; return;
    }
    // Barème personnalisé : entre 1 et 200 — « 0 » ou « -10 » passaient (min/max HTML non bloquants).
    const bareme = ['bareme','grille'].includes(selType.value) ? Number(inpBareme.value) : null;
    if (['bareme','grille'].includes(selType.value) && !(Number.isFinite(bareme) && bareme >= 1 && bareme <= 200)) {
      statutForm.textContent = 'Le barème doit être compris entre 1 et 200.'; statutForm.className = 'statut statut-erreur'; return;
    }
    btnCreer.disabled = true; // anti double-clic (audit 2026-09-07, D-02)
    try {
      const modele = selType.value==='grille' ? grilles.find(g => g.id===selGrille.value) : null;
      if(selType.value==='grille') { if(!modele)throw new Error('Choisissez une grille dans la liste ; créez-en une dans Gérer les grilles si nécessaire.'); validerGrille(modele); }
      const id = crypto.randomUUID();
      await enregistrer('evaluations', {
        id, sequenceId: selSeq.value, titre, date: inpDate.value || isoAujourdhui(),
        type: selType.value, bareme, coef: coefSaisi, publieePronote: null,
        ...(modele ? {grilleId:modele.id,grille:structuredClone(modele)} : {}),
      });
      location.hash = modele ? `#/grilles/saisie/${id}` : `#/notes/eval/${id}`;
    } catch (e) {
      statutForm.textContent = `Création impossible : ${e?.message || e}`; statutForm.className = 'statut statut-erreur';
    } finally {
      btnCreer.disabled = false;
    }
  });

  // --- Liste ---
  if (!evaluations.length) {
    c.append(carte('Aucune évaluation', 'Créez votre première évaluation : la saisie se fait en grille, dans l’ordre alphabétique de Pronote.'));
  } else {
    // « 28/27 notes » : seules comptent les notes des élèves ACTIFS DE LA CLASSE de l'évaluation —
    // un parti, ou un élève passé dans une autre classe, ne gonfle plus le ratio (B16, revue du lot 1).
    const actifsParClasse = new Map();
    for (const e of eleves) {
      if (e.actif === false) continue;
      if (!actifsParClasse.has(e.classeId)) actifsParClasse.set(e.classeId, new Set());
      actifsParClasse.get(e.classeId).add(e.id);
    }
    const effectifs = new Map([...actifsParClasse].map(([classeId, ids]) => [classeId, ids.size]));
    const evalDe = (id) => evaluations.find((ev) => ev.id === id);
    const nbNotes = new Map();
    for (const n of notes) {
      const classeId = seqDe(evalDe(n.evaluationId)?.sequenceId)?.classeId;
      if (actifsParClasse.get(classeId)?.has(n.eleveId)) nbNotes.set(n.evaluationId, (nbNotes.get(n.evaluationId) || 0) + 1);
    }
    const liste = el('div', { class: 'liste-cartes' });
    for (const ev of [...evaluations].sort((a, b) => String(b.date).localeCompare(String(a.date)))) {
      const seq = seqDe(ev.sequenceId);
      const cl = seq ? classeDe(seq.classeId) : null;
      const bar = baremeDe(ev);
      const morceaux = [dateFR(ev.date), bar ? `/${bar}` : 'AFL', `coef ${ev.coef}`,
        `${nbNotes.get(ev.id) || 0}/${cl ? effectifs.get(cl.id) || 0 : '?'} notes`];
      const carteEv = carte(`${cl?.nom || '?'} — ${ev.titre}`, `${seq?.apsa || '?'} · ${morceaux.join(' · ')}`,
        texteBadgePubliee(ev));
      const pastille = el('span', { class: 'pastille', 'aria-hidden': 'true' });
      pastille.style.background = cl?.couleur || 'var(--c-accent)';
      carteEv.querySelector('h2').prepend(pastille);
      liste.append(el('a', { class: 'carte-lien', href: `#/notes/eval/${ev.id}` }, carteEv));
    }
    c.append(liste);
  }

  // --- Relevés ---
  const actives = classes.filter((cl) => !cl.archivee).sort(trierClasses);
  if (actives.length && evaluations.length) {
    const carteR = carte('Relevés par classe', 'Toutes les notes d’une classe — imprimable et exportable.');
    for (const cl of actives) {
      const pastille = el('span', { class: 'pastille', 'aria-hidden': 'true' });
      pastille.style.background = cl.couleur || 'var(--c-accent)';
      carteR.append(el('a', { class: 'ligne-eleve', href: `#/notes/releve/${cl.id}` },
        pastille, el('span', { class: 'ligne-eleve-nom' }, cl.nom),
        el('span', { class: 'chevron pousse-droite', 'aria-hidden': 'true' }, '›')));
    }
    c.append(carteR);
  }
}

// ---------------------------------------------------------------------------
// Vue : grille de saisie d'une évaluation
// ---------------------------------------------------------------------------

async function vueEval(c, evalId) {
  // UN SEUL re-rendu à la fois : deux `change` rapprochés (fill + dispatch, ou un double tap)
  // lançaient deux rendus concurrents qui empilaient DEUX vues (révélé par le champ barème, C15).
  let rafraichissement = null;
  const rafraichir = () => {
    if (rafraichissement) return rafraichissement;
    c.replaceChildren();
    rafraichissement = vueEval(c, evalId).finally(() => { rafraichissement = null; });
    return rafraichissement;
  };
  c.append(el('a', { class: 'retour', href: '#/notes' }, '← Notes'));
  const ev = await lire('evaluations', evalId);
  if (!ev) { c.append(carte('Évaluation introuvable', 'Elle a peut-être été supprimée.')); return; }
  const sequence = await lire('sequences', ev.sequenceId);
  const classe = sequence ? await lire('classes', sequence.classeId) : null;
  if (!sequence || !classe) { c.append(carte('Évaluation orpheline', 'Sa séquence ou sa classe a été supprimée.')); return; }
  sauverPrefs({ derniereEvalId: evalId }); // raccourci « Reprendre » de l'accueil
  const eleves = (await parIndex('eleves', 'classeId', classe.id)).filter((e) => e.actif !== false).sort(trierEleves);
  const inaptes = new Set((await inaptitudesActives()).map((i) => i.eleveId)); // pastille « partout » (audit 2026-09-07, C53)
  const notesMap = new Map((await parIndex('notes', 'evaluationId', evalId)).map((n) => [n.eleveId, n]));
  const bareme = baremeDe(ev);
  // L'objet n'est modifié qu'APRÈS une écriture validée : muter avant l'`await` laissait une valeur
  // REFUSÉE dans `ev`, que la prochaine écriture réussie (un autre champ) persistait en silence
  // (audit Codex V3, V3-01 — classe de défauts, lot V3-A).
  // …et SÉRIALISÉES : deux champs modifiés coup sur coup construisaient chacun leur candidat depuis
  // l'objet d'avant, et le second écrasait le premier (revue adversariale du lot V3-A).
  let fileEv = Promise.resolve();
  // L'écriture passe par `mettreAJourEvaluation` : l'évaluation est RELUE dans la transaction et
  // les notes jointes y sont contrôlées ; la vue n'adopte que ce que la base a réellement enregistré
  // (copie de travail de Codex, AUD-001 et AUD-002).
  const sauverEv = (modifs = {}, operations = [], attentes = []) => {
    const suite = fileEv.catch(() => {}).then(async () => {
      const candidat = await mettreAJourEvaluation(evalId, modifs, operations, attentes);
      Object.assign(ev, candidat);
    });
    fileEv = suite;
    return suite;
  };

  // --- En-tête ---
  const statsEl = el('p', { class: 'compteurs' });
  const carteTete = carte(`${classe.nom} — ${ev.titre}`, '', texteBadgePubliee(ev));
  const majBadgePubliee = () => {
    carteTete.querySelector('h2 .badge')?.remove();
    const t = texteBadgePubliee(ev);
    if (t) carteTete.querySelector('h2').append(el('span', { class: 'badge' }, t));
  };
  // Une valeur EXPORTABLE qui change (une note, le barème) fait passer une évaluation déjà remontée
  // « à remettre à jour », date de publication conservée (audit Codex V3, V3-03). Pour une note, le
  // drapeau est posé dans la MÊME transaction qu'elle, par `mettreAJourEvaluation`.
  // Les écritures de notes sont SÉRIALISÉES, et toute sortie vers Pronote attend la file. Avant,
  // « Copier pour Pronote » lisait la grille en mémoire pendant qu'une saisie était encore en vol :
  // la colonne partait avec l'ANCIENNE valeur pendant que la base enregistrait la nouvelle
  // (audit Codex V3, constat V3-02).
  let fileNotes = Promise.resolve();
  const enFileNote = (travail) => {
    const suite = fileNotes.catch(() => {}).then(travail);
    fileNotes = suite;
    return suite;
  };
  // Une case en erreur (saisie refusée, écriture échouée) bloque toute sortie vers Pronote tant
  // qu'elle n'est pas corrigée, même si une AUTRE note s'enregistre ensuite. Surveiller la seule file
  // ne suffisait pas : sa dernière promesse redevenait résolue au premier succès suivant (défaut
  // trouvé par la revue du lot, corrigé dans la copie de travail de Codex).
  const erreursNotes = new Set();
  // Compteur de modifications : une copie dont le texte a été figé AVANT une modification ne peut
  // pas confirmer une publication « à jour ».
  let revisionNotes = 0;
  // La zone de copie manuelle affiche une colonne FIGÉE : elle est retirée dès qu'une note change,
  // pour qu'on ne puisse pas coller dans Pronote une colonne qui ne correspond plus à la grille.
  let retirerZoneSecours = () => {};
  const ecrireNote = async (op) => {
    const cle = op.op === 'delete' ? op.cle : op.valeur.id;
    const attendue = [...notesMap.values()].find((x) => x.id === cle) || null;
    await sauverEv({}, [{ store: 'notes', ...op }], [{ id: cle, note: attendue }]);
    majBadgePubliee();
  };
  const notesAJour = async () => {
    await fileNotes.catch(() => {});
    if (erreursNotes.size) throw new Error('une note n’a pas pu être enregistrée : corrigez-la d’abord');
  };
  const rangIdentite = el('div', { class: 'rang-2' },
    champTexte({ id: 'ge-titre', libelle: 'Titre', valeur: ev.titre, onChange: async (v) => { if (!v) throw new Error('le titre ne peut pas être vide'); await sauverEv({ titre: v }); } }), // A36 (revue du lot 5)
    champTexte({ id: 'ge-date', libelle: 'Date', type: 'date', valeur: ev.date || '', onChange: async (v) => { await sauverEv({ date: v }); } }),
  );
  // Barème modifiable après création, le TYPE reste figé (avis du lot 5 point 1, groupe 4 C15) :
  // refusé (throw → « ✗ » + toast + valeur restaurée, contrat V2-04) hors 1..200, et refusé si une
  // note déjà saisie dépasse le nouveau barème. La grille est re-rendue (bornes de saisie, carte
  // « Vers Pronote ») via le rafraîchissement complet de la vue, déjà utilisé ailleurs (ex. eleves.js).
  if (ev.type === 'bareme') {
    // Changements de barème SÉRIALISÉS : un second « change » arrivé pendant que la question est
    // posée ouvrait une seconde question par-dessus la première. Il attend désormais la réponse,
    // puis constate que le barème a déjà changé.
    let fileBareme = Promise.resolve();
    const changerBareme = async (b) => {
      // Les saisies en vol d'abord : sinon cette garde lisait une grille périmée. La transaction
      // revérifie de toute façon les notes EN BASE (AUD-001).
      await notesAJour();
      const ancien = baremeDe(ev);
      if (b === ancien) return;
      // Changer le maximum d'une évaluation déjà notée ne dit pas ce que deviennent les notes :
      // 8/10 devient-il 16/20, ou reste-t-il 8 points sur 20 ? Les deux sont légitimes, changement
      // d'échelle ou barème mal saisi : l'application DEMANDE au lieu de garder les points en
      // silence (stratégie V3, lot V3-B3, décision de l'enseignant). Les codes ne bougent pas.
      const chiffrees = [...notesMap.values()].filter((n) => typeof n.valeur === 'number');
      const convertie = (x) => Math.min(b, Math.round((x * b) / ancien * 100) / 100);
      let convertir = false;
      if (chiffrees.length) {
        const exemple = chiffrees[0].valeur;
        const pl = chiffrees.length > 1 ? 's' : '';
        const choix = await choisir({
          titre: `Passer de /${formatFR(ancien)} à /${formatFR(b)}`,
          message: `${chiffrees.length} note${pl} déjà saisie${pl}. Que deviennent-elles ?`,
          detail: `Convertir : ${formatFR(exemple)}/${formatFR(ancien)} devient ${formatFR(convertie(exemple))}/${formatFR(b)}. Garder les points : ${formatFR(exemple)}/${formatFR(b)}. Les codes ABS, DISP et NN ne changent pas.`,
          choix: [
            { valeur: 'garder', libelle: 'Garder les points' },
            { valeur: 'convertir', libelle: 'Convertir les notes', principal: true },
          ],
        });
        if (!choix) throw new Error('changement annulé, le barème reste inchangé');
        convertir = choix === 'convertir';
      }
      if (!convertir) {
        const depassement = chiffrees.find((n) => n.valeur > b);
        if (depassement) throw new Error(`une note saisie (${formatFR(depassement.valeur)}) dépasse ${formatFR(b)} : convertissez les notes ou corrigez-la d’abord`);
      }
      // Conversion écrite dans la MÊME transaction que le barème, chaque note comparée à celle
      // que la vue croit en base : jamais un barème converti avec des notes à moitié réécrites.
      const operations = convertir ? chiffrees.map((n) => ({ store: 'notes', op: 'put', valeur: { ...n, valeur: convertie(n.valeur) } })) : [];
      const attentes = convertir ? chiffrees.map((n) => ({ id: n.id, note: n })) : [];
      revisionNotes++;
      retirerZoneSecours();
      await sauverEv({ bareme: b, ...(ev.publieePronote ? { publieeObsolete: true } : {}) }, operations, attentes);
      await rafraichir();
    };
    rangIdentite.append(champTexte({
      id: 'ge-bareme', libelle: 'Barème ( /x )', type: 'number', valeur: String(ev.bareme ?? ''),
      onChange: async (v) => {
        const b = Number(v);
        if (!(Number.isFinite(b) && b >= 1 && b <= 200)) throw new Error('le barème doit être compris entre 1 et 200');
        const suite = fileBareme.catch(() => {}).then(() => changerBareme(b));
        fileBareme = suite;
        return suite;
      },
    }));
  }
  carteTete.append(
    el('p', {}, `${sequence.apsa} · ${bareme ? `noté /${bareme}` : 'AFL / positionnement'} · coef ${ev.coef}`),
    rangIdentite,
    statsEl,
  );
  c.append(carteTete);

  function majStats() {
    // Sur les élèves ACTIFS de la grille : les notes d'un parti gonflaient « saisies » (B16).
    const valeurs = eleves.map((e) => notesMap.get(e.id)?.valeur);
    const nums = valeurs.filter((v) => typeof v === 'number');
    const saisies = valeurs.filter((v) => v !== undefined).length;
    const enfants = [el('span', { class: 'note-inline' }, `${saisies}/${eleves.length} saisies`)];
    if (bareme && nums.length) {
      const moy = nums.reduce((a, b) => a + b, 0) / nums.length;
      enfants.unshift(
        el('span', {}, el('strong', {}, formatFR(moy)), `/${bareme} de moyenne`),
        el('span', { class: 'note-inline' }, `min ${formatFR(Math.min(...nums))} · max ${formatFR(Math.max(...nums))}`),
      );
    }
    statsEl.replaceChildren(...enfants);
  }

  if (ev.type === 'grille') {
    const carteModele = carte(ev.grille.titre, `Grille figée · barème /${bareme}. Les notes se calculent depuis les critères.`);
    carteModele.append(el('div', { class: 'rang-btn no-print' },
      el('a', { class: 'btn btn-principal', href: `#/grilles/saisie/${evalId}` }, 'Saisir les critères / voir le détail')));
    c.append(carteModele);
  }

  // --- Grille ---
  const carteGrille = carte(ev.type==='grille' ? 'Notes calculées' : 'Saisie', ev.type==='grille'
    ? 'Ces notes sont calculées depuis les critères. Utilisez « Saisir les critères / voir le détail » pour les modifier.' : bareme
    ? `Note (virgule acceptée) ou code : ABS, DISP, NN. Entrée = élève suivant. Vide = non saisi.`
    : 'Positionnement libre (ex. AFL1 D3). Non exportable vers Pronote.');
  // Motif d'un refus, annoncé (role=alert) : la couleur seule ne disait rien (B22). Le message est
  // déplacé SOUS la ligne fautive au moment du refus (en bas d'une classe de 30, il était hors
  // écran — revue du lot 3) et relié au champ par aria-describedby.
  const alerteSaisie = el('p', { class: 'statut statut-erreur', role: 'alert', id: 'note-alerte' });
  const inputs = [];
  eleves.forEach((eleve, idx) => {
    const note = notesMap.get(eleve.id);
    const input = el('input', {
      class: 'input-note', type: 'text', inputmode: bareme ? 'decimal' : 'text',
      'aria-label': `Note de ${eleve.nom} ${eleve.prenom}`, autocomplete: 'off', placeholder: '—', // même ordre que le libellé visible (commande vocale — B48)
    });
    if(ev.type==='grille') { input.readOnly=true; input.title='Note calculée depuis les critères'; }
    input.value = note ? (typeof note.valeur === 'number' ? formatFR(note.valeur) : note.valeur) : '';
    if (note && typeof note.valeur !== 'number') input.classList.add('code');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); (inputs[idx + 1] || input).focus(); inputs[idx + 1]?.select?.(); }
    });
    const appliquer = async () => {
      input.classList.remove('invalide', 'code');
      const idNote = `${evalId}_${eleve.id}`;
      if (!bareme) { // afl : texte libre
        const t = input.value.trim();
        if (!t) { await ecrireNote({ op: 'delete', cle: idNote }); notesMap.delete(eleve.id); }
        else {
          const rec = { id: idNote, evaluationId: evalId, eleveId: eleve.id, valeur: t, commentaire: '' };
          await ecrireNote({ op: 'put', valeur: rec }); notesMap.set(eleve.id, rec);
        }
        majStats();
        return;
      }
      const r = parserValeur(input.value, bareme);
      if (r.invalide) {
        // Refus signalé par un texte annoncé, pas par la seule couleur (B22).
        input.classList.add('invalide');
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', 'note-alerte');
        input.closest('.ligne-note').insertAdjacentElement('afterend', alerteSaisie);
        alerteSaisie.dataset.pour = eleve.id;
        alerteSaisie.textContent = `Note refusée pour ${eleve.nom} ${eleve.prenom} : attendu 0 à ${bareme}, ABS, DISP ou NN.`;
        return;
      }
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
      if (alerteSaisie.dataset.pour === eleve.id) alerteSaisie.textContent = ''; // le message d'un AUTRE élève reste
      if (r.vide) { await ecrireNote({ op: 'delete', cle: idNote }); notesMap.delete(eleve.id); majStats(); return; }
      const valeur = r.code || r.nombre;
      const rec = { id: idNote, evaluationId: evalId, eleveId: eleve.id, valeur, commentaire: '' };
      await ecrireNote({ op: 'put', valeur: rec });
      notesMap.set(eleve.id, rec);
      if (r.code) { input.value = r.code; input.classList.add('code'); }
      else input.value = formatFR(r.nombre);
      majStats();
    };
    input.addEventListener('change', async () => {
      // Évaluation par grille : la note se CALCULE depuis les critères, elle ne se saisit pas ici.
      if (ev.type === 'grille') return;
      revisionNotes++;
      retirerZoneSecours();
      erreursNotes.add(eleve.id); // levée seulement quand la note est bel et bien enregistrée
      try {
        await enFileNote(appliquer);
        if (!input.classList.contains('invalide')) erreursNotes.delete(eleve.id);
      } catch (e) {
        // Écriture refusée : la case restait « propre » comme si la note était en base (D-05).
        input.classList.add('invalide');
        toast(`Note non enregistrée : ${e?.message || e}`);
      }
    });
    inputs.push(input);
    carteGrille.append(el('div', { class: 'ligne-note' },
      el('span', { class: 'nom' }, `${eleve.nom} ${eleve.prenom}`, inaptes.has(eleve.id) ? el('span', { class: 'pastille-info', title: 'Inaptitude en cours' }, el('span', { 'aria-hidden': 'true' }, ' 🩺'), el('span', { class: 'sr-only' }, ' Inaptitude en cours')) : ''), input));
  });
  carteGrille.append(alerteSaisie);
  c.append(carteGrille);
  majStats();

  // --- Export Pronote ---
  if (bareme) {
    const carteExp = carte('Vers Pronote', 'Dans Pronote, ouvrez le service de notation (même classe, même barème), cliquez sur la première case de la colonne et collez.');
    const statutExp = el('p', { class: 'statut', role: 'status' });
    const zoneSecours = el('div', {}); // textarea de copie manuelle (si presse-papiers indisponible)
    retirerZoneSecours = () => zoneSecours.replaceChildren();
    const zoneRecap = el('div', {});
    const btnCopier = el('button', { class: 'btn btn-principal' }, 'Copier pour Pronote');
    const btnCSV = el('button', { class: 'btn' }, 'Exporter CSV');

    // Une note de grille calculée sur une PARTIE des critères part dans Pronote comme une note
    // complète : l'écran de la grille affichait « 2/4 critères évalués », la copie rien. Elle est
    // désormais listée dans le récapitulatif, comme les codes à saisir à la main.
    const construireColonne = () => {
      const lignes = [];
      const codes = [];
      const partiels = [];
      eleves.forEach((e, i) => {
        const v = notesMap.get(e.id)?.valeur;
        if (typeof v === 'number') {
          lignes.push(formatFR(v));
          if (ev.type === 'grille') {
            const r = calculerGrille(ev.grille, notesMap.get(e.id)?.detail || {}, bareme);
            const manque = r.total - r.evalues;
            if (manque > 0) {
              partiels.push(ev.grille.nonEvalue === 'zero'
                ? `ligne ${i + 1} : ${e.nom} ${e.prenom}, ${manque} critère${manque > 1 ? 's' : ''} non évalué${manque > 1 ? 's' : ''} compté${manque > 1 ? 's' : ''} zéro`
                : `ligne ${i + 1} : ${e.nom} ${e.prenom}, note calculée sur ${r.evalues} critère${r.evalues > 1 ? 's' : ''} sur ${r.total}`);
            }
          }
        } else {
          lignes.push('');
          if (v) codes.push(`ligne ${i + 1} — ${e.nom} ${e.prenom} : ${v}`);
        }
      });
      return { texte: lignes.join('\r\n'), codes, partiels, vides: lignes.filter((l) => l === '').length };
    };

    // « Publiée » n'est marquée que sur PREUVE de copie (presse-papiers réussi, ou copie
    // effective depuis la zone de secours) — audit A13. Le CSV ne marque plus ; un bouton
    // de marquage manuel couvre les autres workflows (et corrige un marquage erroné).
    const btnMarquer = el('button', { class: 'btn' }, '');
    const majMarquer = () => {
      btnMarquer.textContent = ev.publieePronote
        ? `Annuler le marquage « publiée le ${dateFR(ev.publieePronote)} »`
        : 'Marquer remontée dans Pronote (manuel)';
    };
    majMarquer();
    btnMarquer.addEventListener('click', async () => {
      await sauverEv({ publieePronote: ev.publieePronote ? null : isoAujourdhui(), publieeObsolete: false });
      if (!ev.publieePronote) zoneRecap.replaceChildren();
      majBadgePubliee();
      majMarquer();
    });

    const apresExport = async (codes, vides, revisionCopie, notesCopie, partiels = []) => {
      // La remontée vient d'être refaite : la demande de mise à jour tombe, SAUF si la grille a changé
      // depuis que le texte copié a été figé. Et les notes copiées sont revérifiées en base dans la
      // transaction : un autre onglet a pu les modifier pendant la copie (AUD-002).
      const aJour = revisionCopie === revisionNotes;
      await sauverEv({ publieePronote: isoAujourdhui(), publieeObsolete: !aJour }, [], aJour ? notesCopie : []);
      majBadgePubliee();
      majMarquer();
      zoneRecap.replaceChildren(
        el('p', { class: 'statut statut-ok' },
          // Lignes vides comptées (non saisies + codes) : le total seul masquait une colonne à trous (audit 2026-09-07, C16).
          `${eleves.length} lignes dont ${vides} vide${vides > 1 ? 's' : ''} (${eleves.length - vides} note${eleves.length - vides > 1 ? 's' : ''}, ordre alphabétique). Garde-fou : vérifiez que le service Pronote compte bien ${eleves.length} élèves et le barème /${bareme}.`),
        ...(codes.length ? [el('p', {}, 'À saisir à la main dans Pronote :'),
          el('ul', {}, ...codes.map((t) => el('li', {}, t)))] : []),
        ...(partiels.length ? [el('p', { class: 'partiels-titre' }, 'Notes calculées sur une partie seulement des critères, copiées comme des notes complètes :'),
          el('ul', { class: 'partiels' }, ...partiels.map((t) => el('li', {}, t)))] : []),
      );
    };

    // Toute sortie vers Pronote attend d'abord que la grille soit RÉELLEMENT en base, et refuse si
    // une écriture a échoué : transmettre une valeur périmée est pire que ne rien transmettre.
    const grillePrete = async () => {
      try {
        await notesAJour();
        await fileEv.catch(() => {}); // un ancien échec est rattrapé par la relecture ci-dessous
        // Relire la base : un autre onglet a pu changer le barème ou les notes (AUD-002).
        const actuelle = await lire('evaluations', evalId);
        if (!actuelle || baremeDe(actuelle) !== bareme) throw new Error('évaluation modifiée dans un autre onglet : rechargez la page');
        const enBase = await parIndex('notes', 'evaluationId', evalId);
        notesMap.clear();
        for (const x of enBase) notesMap.set(x.eleveId, x);
        Object.assign(ev, actuelle);
        return true;
      } catch (e) {
        statutExp.textContent = `Copie impossible : ${e?.message || e}`;
        statutExp.className = 'statut statut-erreur';
        return false;
      }
    };

    btnCopier.addEventListener('click', async () => {
      if (!await grillePrete()) return;
      // Rien à copier → rien à marquer « publiée » : une grille vide désarmait l'alerte (B24).
      if (!eleves.some((e) => notesMap.has(e.id))) {
        statutExp.textContent = 'Aucune note à copier : saisissez d’abord la grille.';
        statutExp.className = 'statut statut-erreur';
        return;
      }
      const { texte, codes, vides, partiels } = construireColonne();
      const revisionCopie = revisionNotes;
      // Figées AVEC le texte : ce sont ces notes-là qui partent, et elles seules que la publication
      // peut confirmer.
      const notesCopie = structuredClone(eleves.map((e) => ({ id: `${evalId}_${e.id}`, note: notesMap.get(e.id) || null })));
      try {
        await navigator.clipboard.writeText(texte);
        statutExp.textContent = 'Colonne copiée dans le presse-papiers ✓'
          + (partiels.length ? ` · ${partiels.length} note${partiels.length > 1 ? 's' : ''} sur une partie des critères, voir ci-dessous` : '');
        statutExp.className = 'statut statut-ok';
        zoneSecours.replaceChildren();
        try {
          await apresExport(codes, vides, revisionCopie, notesCopie, partiels); // copie réussie = preuve
        } catch (e) {
          // Surtout pas la zone de secours : la colonne EST copiée, c'est la publication qui échoue.
          statutExp.textContent = `Colonne copiée, mais publication non confirmée : ${e?.message || e}`;
          statutExp.className = 'statut statut-erreur';
        }
      } catch {
        // Pas de presse-papiers (http réseau local…) : colonne à copier à la main.
        // « Publiée » ne sera marquée qu'à la copie réelle (événement copy).
        const zone = el('textarea', { rows: 8, 'aria-label': 'Colonne à copier' }); // enveloppée dans .champ ci-dessous (style — B49)
        zone.value = texte;
        zone.addEventListener('copy', () => {
          apresExport(codes, vides, revisionCopie, notesCopie, partiels).catch((e) => {
            statutExp.textContent = `Publication non confirmée : ${e?.message || e}`;
            statutExp.className = 'statut statut-erreur';
          });
        }, { once: true });
        zoneSecours.replaceChildren(
          el('p', {}, 'Copie automatique indisponible : sélectionnez tout puis copiez (Ctrl+C) — l’évaluation sera alors marquée « publiée ».'),
          el('div', { class: 'champ' }, zone)); // même style que les autres zones de texte (B49)
        zone.focus(); zone.select();
        statutExp.textContent = '';
      }
    });

    btnCSV.addEventListener('click', async () => {
      if (!await grillePrete()) return;
      const lignes = eleves.map((e) => {
        const v = notesMap.get(e.id)?.valeur;
        return [e.nom, e.prenom, typeof v === 'number' ? formatFR(v) : v || ''].map(champCSV).join(';');
      });
      telechargerTexte(`notes_${classe.nom}_${ev.titre.replace(/[^\wàâéèêëîïôùûç -]/gi, '')}_${isoAujourdhui()}.csv`,
        [['Nom', 'Prénom', 'Note'].map(champCSV).join(';'), ...lignes].join('\r\n'));
      statutExp.textContent = 'CSV téléchargé. (Le CSV ne marque pas « publiée » : utilisez la copie Pronote ou le marquage manuel.)';
      statutExp.className = 'statut statut-ok';
    });

    carteExp.append(el('div', { class: 'rang-btn' }, btnCopier, btnCSV), statutExp, zoneSecours, zoneRecap,
      el('div', { class: 'rang-btn' }, btnMarquer));
    c.append(carteExp);
  }

  // --- Suppression ---
  const carteS = carte('Supprimer cette évaluation', 'Supprime l’évaluation et toutes ses notes.');
  const btnSuppr = el('button', { class: 'btn btn-danger' }, 'Supprimer définitivement');
  btnSuppr.addEventListener('click', async () => {
    if (!(await confirmer({
      titre: 'Supprimer l’évaluation',
      message: `Supprimer « ${ev.titre} » ?`,
      detail: notesMap.size ? `Seront aussi supprimées : ${notesMap.size} note${notesMap.size > 1 ? 's' : ''}.` : '',
    }))) return;
    const objets = { notes: await parIndex('notes', 'evaluationId', evalId), evaluations: [ev] };
    await supprimerLot(objets); // une transaction : évaluation + notes, et annulation idem (avis B29)
    location.hash = '#/notes';
    toast(`Évaluation « ${ev.titre} » supprimée`, { action: async () => { await restaurer(objets); location.hash = `#/notes/eval/${evalId}`; } });
  });
  carteS.append(el('div', { class: 'rang-btn' }, btnSuppr));
  c.append(carteS);
}

// ---------------------------------------------------------------------------
// Vue : relevé par classe (imprimable)
// ---------------------------------------------------------------------------

async function vueReleve(c, classeId) {
  c.classList.add('vue-large'); // relevé (tableau) : pleine largeur sur PC
  c.append(el('a', { class: 'retour no-print', href: '#/notes' }, '← Notes'));
  const classe = await lire('classes', classeId);
  if (!classe) { c.append(carte('Classe introuvable', '')); return; }
  const sequencesCl = await parIndex('sequences', 'classeId', classeId);
  const seqIds = new Set(sequencesCl.map((s) => s.id));
  const evals = (await tous('evaluations')).filter((ev) => seqIds.has(ev.sequenceId))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const notes = await tous('notes');
  const noteDe = new Map(notes.map((n) => [`${n.evaluationId}_${n.eleveId}`, n.valeur]));
  // Élèves actifs + partis ayant au moins une note dans ces évaluations : un « parti » ne
  // disparaît plus rétroactivement du relevé (audit 2026-09-07, A13).
  const evalIds = new Set(evals.map((ev) => ev.id));
  const eleves = (await parIndex('eleves', 'classeId', classeId))
    .filter((e) => e.actif !== false || notes.some((n) => n.eleveId === e.id && evalIds.has(n.evaluationId)))
    .sort(trierEleves);
  const seqDe = (id) => sequencesCl.find((s) => s.id === id);

  const btnImprimer = el('button', { class: 'btn' }, 'Imprimer');
  btnImprimer.addEventListener('click', () => window.print());
  const btnCSV = el('button', { class: 'btn' }, 'Exporter CSV');
  const carteTete = carte(`Relevé de notes — ${classe.nom}`, 'Moyenne /20 pondérée par les coefficients ; les codes (ABS, DISP, NN) et les AFL ne comptent pas dans la moyenne.');
  // Établissement (Réglages) et date d'édition : la carte de tête s'imprime, le papier était anonyme et non daté (audit 2026-09-07, B44).
  carteTete.append(el('p', { class: 'note-discrete', id: 'rl-edition' }, [(await lireMeta('etablissement')) || '', `édité le ${new Date().toLocaleDateString('fr-FR')}`].filter(Boolean).join(' — ')));
  carteTete.append(el('div', { class: 'rang-btn no-print' }, btnImprimer, btnCSV));
  c.append(carteTete);

  if (!evals.length) { c.append(carte('Aucune évaluation pour cette classe', '')); return; }

  const moyenneEleve = (eleveId) => {
    let somme = 0;
    let poids = 0;
    for (const ev of evals) {
      const bar = baremeDe(ev);
      const v = noteDe.get(`${ev.id}_${eleveId}`);
      const coef = Number.isFinite(ev.coef) ? ev.coef : 1; // coef 0 = ne compte pas (B23)
      if (bar && typeof v === 'number') { somme += (v / bar) * 20 * coef; poids += coef; }
    }
    return poids ? somme / poids : null;
  };

  const lignes = eleves.map((e) => ({ e, moyenne: moyenneEleve(e.id) }));
  // Vrai tableau (scope, en-tête de ligne, légende, région défilable nommée — B07).
  const table = el('table', { class: 'table-apercu' },
    el('caption', {}, `Relevé de notes ${classe.nom}`), // court : la boîte du caption prend la largeur du tableau (revue du lot 3)
    el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, 'Élève'),
      ...evals.map((ev) => el('th', { scope: 'col', title: `${seqDe(ev.sequenceId)?.apsa || ''} · coef ${ev.coef}` },
        `${ev.titre} ${baremeDe(ev) ? `/${baremeDe(ev)}` : '(AFL)'}`)),
      el('th', { scope: 'col' }, 'Moy. /20'),
    )),
    el('tbody', {},
      ...lignes.map(({ e, moyenne }) => el('tr', {},
        el('th', { scope: 'row' }, `${e.nom} ${e.prenom}${e.actif === false ? ' (parti)' : ''}`),
        ...evals.map((ev) => el('td', {}, afficherValeur(noteDe.get(`${ev.id}_${e.id}`), null))),
        el('td', {}, moyenne === null ? '' : formatFR(moyenne)),
      )),
    ),
  );
  // Moyenne de classe sur l'effectif RÉEL : un parti reste lisible sur son relevé mais ne pèse
  // plus dans la synthèse remontée au conseil de classe (revue du lot 1, A13).
  const moyennes = lignes.filter(({ e }) => e.actif !== false).map((l) => l.moyenne).filter((m) => m !== null);
  c.append(el('div', { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': `Relevé ${classe.nom}` }, table));
  if (moyennes.length) {
    c.append(el('p', { class: 'note-discrete' },
      `Moyenne de classe : ${formatFR(moyennes.reduce((a, b) => a + b, 0) / moyennes.length)}/20 (${moyennes.length} élèves notés)`));
  }

  btnCSV.addEventListener('click', () => {
    const tete = ['Nom', 'Prénom', ...evals.map((ev) => `${ev.titre}${baremeDe(ev) ? ` /${baremeDe(ev)}` : ' (AFL)'}`), 'Moyenne /20'].map(champCSV).join(';');
    const corps = lignes.map(({ e, moyenne }) =>
      [`${e.nom}${e.actif === false ? ' (parti)' : ''}`, e.prenom, // même mention qu'à l'écran (revue du lot 1)
        ...evals.map((ev) => afficherValeur(noteDe.get(`${ev.id}_${e.id}`), null)),
        moyenne === null ? '' : formatFR(moyenne)].map(champCSV).join(';'));
    telechargerTexte(`releve_${classe.nom}_${isoAujourdhui()}.csv`, [tete, ...corps].join('\r\n'));
  });
}

// ---------------------------------------------------------------------------

export function initialiser() {
  enregistrerVue('notes', async (c, params = []) => {
    const [a, b] = params;
    if (a === 'eval' && b) return vueEval(c, b);
    if (a === 'releve' && b) return vueReleve(c, b);
    return vueListe(c);
  });
}
