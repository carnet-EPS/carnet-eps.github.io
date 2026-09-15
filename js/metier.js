// metier.js — vocabulaire et règles métier partagés entre modules
// (les modules métier ne s'importent pas entre eux — sauf la brique observations.js importée par
//  eleves.js, exception documentée dans docs/architecture.md : ce qui est commun vit ici).

import { tous, parIndexLot, lireMeta } from './io.js';

// ---- Statuts d'appel (docs/modele-donnees.md) ----
// `pratiquant` : participe physiquement au cours. L'inapte/dispensé présent n'est pas pratiquant.
export const STATUTS = {
  // Pas de couleur ici : la SEULE palette des statuts est en CSS (`--stb-*`, base.css, déclinée par thème — C48).
  present: { libelle: 'Présent', court: 'P', pratiquant: true },
  absent: { libelle: 'Absent', court: 'A', pratiquant: false },
  retard: { libelle: 'Retard', court: 'R', pratiquant: true },
  dispense: { libelle: 'Dispensé (mot)', court: 'D', pratiquant: false },
  inapte: { libelle: 'Inapte (certificat)', court: 'I', pratiquant: false },
  oubli_tenue: { libelle: 'Oubli de tenue', court: 'T', pratiquant: false },
  infirmerie: { libelle: 'Infirmerie', court: 'INF', pratiquant: false },
};

// Statuts parcourus par un tap simple sur l'écran d'appel (le reste via appui long).
export const CYCLE_TAP = ['present', 'absent', 'oubli_tenue'];

// Seuil de signalement (oublis de tenue / dispenses « mot »).
export const SEUIL_ALERTE = 3;
// Seuil atteint sur un cumul { oubli_tenue, dispense } (celui de l'année scolaire, D012).
export const depasseSeuil = (c) => (c?.oubli_tenue || 0) >= SEUIL_ALERTE || (c?.dispense || 0) >= SEUIL_ALERTE;
// Inaptitude > 3 mois → rappel médecin scolaire (réglementation).
export const SEUIL_MEDECIN_JOURS = 90;

// ---- Observations (notes terrain, v2) ----
export const TYPES_OBSERVATION = ['Engagement', 'Comportement', 'Progrès', 'Sécurité', 'Oubli de tenue', 'Inaptitude', 'Autonomie', 'Coopération', 'Remarque'];
export const TONS_OBSERVATION = [
  { cle: 'positif', libelle: 'Positif' },
  { cle: 'neutre', libelle: 'Neutre' },
  { cle: 'vigilance', libelle: 'Vigilance' },
];
export const TAGS_OBSERVATION = ['tenue', 'sécurité', 'engagement', 'progrès', 'comportement', 'conseil', 'bulletin'];
export const MODELES_PHRASES = [
  'Très bon engagement aujourd’hui.',
  'Besoin d’être relancé régulièrement.',
  'Attention au respect des consignes de sécurité.',
  'Oubli de tenue répété.',
  'Beau progrès constaté.',
  'Bonne coopération avec le groupe.',
];

// ---- Tris, normalisation, formats partagés (dédoublonnés des modules — audit 2026-09-05, B27) ----
// Ordre alphabétique « Pronote » : NOM puis Prénom, collation française.
export const trierEleves = (a, b) => a.nom.localeCompare(b.nom, 'fr') || a.prenom.localeCompare(b.prenom, 'fr');
// Classes en tri naturel (6A < 10A).
export const trierClasses = (a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true });
// Minuscules sans accents ; cleTexte ne garde que [a-z0-9] (clés de recherche et de doublon).
export const normaliser = (s = '') => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export const cleTexte = (s = '') => normaliser(s).replace(/[^a-z0-9]/g, '');
// Barème effectif d'une évaluation (null = AFL / positionnement, hors moyenne).
export const baremeDe = (ev) => (ev.type === 'note20' ? 20 : ['bareme','grille'].includes(ev.type) ? Number(ev.bareme) || 20 : null);
// Nombre arrondi à 2 décimales, virgule française.
export const formatFR = (n) => String(Math.round(n * 100) / 100).replace('.', ',');

// Taille lisible (Ko / Mo) — partagée par Réglages (espace du site) et Sauvegarde (poids des pièces).
export function octetsLisibles(n) {
  if (!Number.isFinite(n)) return '?';
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

// ---- Dates & heures ----
// Date LOCALE (pas toISOString/UTC : entre minuit et 1-2 h du matin, l'UTC est encore « hier »).
export const isoAujourdhui = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const dateFR = (iso) => {
  if (!iso) return '?';
  // C45(b) : année affichée seulement si `iso` n'est pas dans l'année scolaire courante — comparaison
  // 100 % synchrone via `anneeScolaireDe` (pure, ne lit pas `meta`), contrairement à `bornesTrimestres`
  // (async, lit `meta`) qui n'est PAS utilisable ici.
  const options = anneeScolaireDe(iso) === anneeScolaireDe(isoAujourdhui())
    ? { day: '2-digit', month: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: 'numeric' };
  return new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', options);
};
export const enMinutes = (hm) => {
  const [h, m] = String(hm || '0:0').split(':').map(Number);
  return h * 60 + m;
};
// Écart en jours entre deux dates ISO (calcul à midi : insensible aux changements d'heure).
export const jours = (de, a) => Math.round((new Date(`${a}T12:00:00`) - new Date(`${de}T12:00:00`)) / 86400000);
// Date ISO décalée de n jours.
export const decalerJours = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---- Trimestres (décision D012 : alerte sur le cumul de l'année, vision par trimestre) ----
// Année scolaire d'une date ISO : d'août à juillet → année civile de la rentrée.
export const anneeScolaireDe = (iso) => {
  const [y, m] = String(iso).split('-').map(Number);
  return m >= 8 ? y : y - 1;
};
// Trimestre (1, 2, 3) d'une date d'après les fins de T1 et T2.
export const trimestreDe = (iso, b) => (iso <= b.finT1 ? 1 : iso <= b.finT2 ? 2 : 3);
// Bornes de l'année scolaire de `iso`. Fins de T1/T2 réglables (Réglages → meta finTrimestre1/2),
// retenues seulement si elles tombent dans cette année scolaire ; sinon 15/12 et 15/03.
export async function bornesTrimestres(iso = isoAujourdhui()) {
  const y = anneeScolaireDe(iso);
  // (à partir du 1er septembre : une fin de T1 en août déjà en base — sauvegarde ancienne — est ignorée, D-10)
  const valide = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) && anneeScolaireDe(v) === y && v >= `${y}-09-01` ? v : '');
  let finT1 = valide(await lireMeta('finTrimestre1', '')) || `${y}-12-15`;
  let finT2 = valide(await lireMeta('finTrimestre2', '')) || `${y + 1}-03-15`;
  // Bornes inversées (T2 avant T1) : défauts pour les deux, sinon le T2 serait vide et le T3
  // engloberait le reste (audit 2026-09-07, V2-02). Réglages signale la valeur ignorée.
  if (finT2 <= finT1) { finT1 = `${y}-12-15`; finT2 = `${y + 1}-03-15`; }
  // Début au 1er août, comme anneeScolaireDe : une séance de pré-rentrée (fin août) comptait
  // pour l'année précédente et échappait aux cumuls (audit 2026-09-07, A06).
  const b = { annee: y, debut: `${y}-08-01`, finT1, finT2, fin: `${y + 1}-07-31` };
  b.courant = trimestreDe(iso, b);
  return b;
}
// Période { du, au } d'un trimestre (1, 2, 3) ou de l'année scolaire (toute autre valeur).
export function periodeTrimestre(t, b) {
  if (t === 1) return { du: b.debut, au: b.finT1 };
  if (t === 2) return { du: decalerJours(b.finT1, 1), au: b.finT2 };
  if (t === 3) return { du: decalerJours(b.finT2, 1), au: b.fin };
  return { du: b.debut, au: b.fin };
}
// Statuts d'appel comptés par élève, par trimestre et sur l'année scolaire des bornes.
// La date vit sur la séance → jointure appels × séances ; un appel orphelin est ignoré.
// Retourne Map(eleveId → { t: { 1: {statut: n}, 2: {…}, 3: {…} }, annee: {statut: n} }).
export function compterStatutsParTrimestre(appels, seances, b) {
  const dateDe = new Map(seances.map((s) => [s.id, s.date]));
  const res = new Map();
  for (const a of appels) {
    const date = dateDe.get(a.seanceId);
    if (!date || date < b.debut || date > b.fin) continue;
    if (!res.has(a.eleveId)) res.set(a.eleveId, { t: { 1: {}, 2: {}, 3: {} }, annee: {} });
    const c = res.get(a.eleveId);
    const tri = c.t[trimestreDe(date, b)];
    const k = STATUTS[a.statut] ? a.statut : 'present'; // statut inconnu (sauvegarde tierce) rabattu comme à l'appel (audit 2026-09-07, A28)
    tri[k] = (tri[k] || 0) + 1;
    c.annee[k] = (c.annee[k] || 0) + 1;
  }
  return res;
}

export function lundiDe(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

// ---- Alternance A/B ----
// 'A' | 'B' | null (si pas de lundi de référence défini dans meta).
// Limite v1 assumée : parité calendaire pure, les vacances ne décalent pas l'alternance.
export async function semaineCourante(date = new Date()) {
  const ref = await lireMeta('semaineAReference', '');
  if (!ref) return null;
  const diff = Math.round((lundiDe(date) - lundiDe(new Date(`${ref}T12:00:00`))) / 604800000);
  return ((diff % 2) + 2) % 2 === 0 ? 'A' : 'B';
}

// Créneaux EDT du jour donné, filtrés par parité A/B (tous si parité inconnue), triés par heure.
export async function coursDuJour(date = new Date()) {
  const jour = ((date.getDay() + 6) % 7) + 1; // 1 = lundi
  const sem = await semaineCourante(date);
  // Une classe archivée garde ses créneaux (restauration possible) mais ne doit plus apparaître
  // dans la journée ni proposer de séance (audit 2026-09-07, A08).
  const archivees = new Set((await tous('classes')).filter((cl) => cl.archivee).map((cl) => cl.id));
  return (await tous('edt'))
    .filter((cr) => cr.jour === jour && !archivees.has(cr.classeId))
    .filter((cr) => cr.semaine === 'AB' || !sem || cr.semaine === sem)
    .sort((a, b) => enMinutes(a.heureDebut) - enMinutes(b.heureDebut));
}

// Inaptitudes actives d'une date donnée (utilisé pour pré-remplir l'appel et les pastilles).
export async function inaptitudesActives(dateISO = isoAujourdhui()) {
  return (await tous('inaptitudes')).filter(
    (i) => (!i.dateDebut || i.dateDebut <= dateISO) && (!i.dateFin || dateISO <= i.dateFin)
  );
}

// Agrège les alertes élèves (utilisé par l'accueil ET l'onglet Suivi) : inaptitudes
// expirant (J-7) / réintégrations, seuils d'oublis de tenue et de dispenses, évaluations
// notées non remontées vers Pronote. Retourne [{ grave, href, texte }].
export async function collecterAlertes() {
  const auj = isoAujourdhui();
  const [inaptitudes, eleves, classes, evaluations, notes, sequences, seances] = await Promise.all([
    tous('inaptitudes'), tous('eleves'), tous('classes'),
    tous('evaluations'), tous('notes'), tous('sequences'), tous('seances'),
  ]);
  const bornes = await bornesTrimestres(auj);
  // Appels de l'ANNÉE SCOLAIRE seulement, lus par index sur ses séances en UNE transaction : l'accueil
  // (route par défaut) chargeait tout le store à chaque lancement (C02) ; une transaction par séance
  // coûtait 2× plus cher qu'une lecture complète (mesuré, revue du lot 4).
  const seancesAnnee = seances.filter((s) => s.date >= bornes.debut && s.date <= bornes.fin);
  const appels = await parIndexLot('appels', 'seanceId', seancesAnnee.map((s) => s.id));
  const parTri = compterStatutsParTrimestre(appels, seances, bornes);
  const eleveDe = (id) => eleves.find((e) => e.id === id);
  const classeDe = (id) => classes.find((cl) => cl.id === id);
  const nomComplet = (e) => `${e.prenom} ${e.nom}${classeDe(e.classeId) ? ' (' + classeDe(e.classeId).nom + ')' : ''}`;
  const alertes = [];

  for (const i of inaptitudes) {
    const e = eleveDe(i.eleveId);
    if (!e || e.actif === false) continue; // élève parti : plus de suivi (audit 2026-09-07, A07)
    if (classeDe(e.classeId)?.archivee) continue; // classe archivée : plus de suivi non plus (revue du lot 1)
    const active = (!i.dateDebut || i.dateDebut <= auj) && (!i.dateFin || auj <= i.dateFin);
    if (active && i.dateFin) {
      const restants = jours(auj, i.dateFin);
      if (restants <= 7) {
        alertes.push({ grave: true, href: `#/inaptitudes/${i.id}`, texte: `${nomComplet(e)} — inaptitude : ${restants <= 0 ? 'dernier jour' : `fin dans ${restants} j`}` });
      }
    } else if (active && i.dateDebut && jours(i.dateDebut, auj) > SEUIL_MEDECIN_JOURS) {
      // Sans date de fin : ni expiration ni rappel « > 3 mois » ne s'allumaient jamais (A09).
      alertes.push({ grave: false, href: `#/inaptitudes/${i.id}`, texte: `${nomComplet(e)} — inaptitude sans date de fin depuis ${jours(i.dateDebut, auj)} j : à revoir (> 3 mois → médecin scolaire)` });
    } else if (i.dateFin && i.dateFin < auj && jours(i.dateFin, auj) <= 7) {
      alertes.push({ grave: false, href: `#/inaptitudes/${i.id}`, texte: `${nomComplet(e)} — redevient apte (inaptitude finie le ${dateFR(i.dateFin)})` });
    }
  }

  // Seuil sur le cumul de l'ANNÉE SCOLAIRE (D012) — plus sur tous les appels depuis l'origine,
  // qui rendait l'alerte perpétuelle (audit 2026-09-07, V2-01/A14) ; le trimestre situe.
  for (const [eleveId, c] of parTri) {
    if (!depasseSeuil(c.annee)) continue;
    const e = eleveDe(eleveId);
    if (!e || e.actif === false || classeDe(e.classeId)?.archivee) continue; // parti ou classe archivée : plus de suivi
    const tri = c.t[bornes.courant] || {};
    const morceaux = [];
    if ((c.annee.oubli_tenue || 0) >= SEUIL_ALERTE) morceaux.push(`${c.annee.oubli_tenue} oublis de tenue (T${bornes.courant} : ${tri.oubli_tenue || 0})`);
    if ((c.annee.dispense || 0) >= SEUIL_ALERTE) morceaux.push(`${c.annee.dispense} dispenses « mot » (T${bornes.courant} : ${tri.dispense || 0})`);
    alertes.push({ grave: true, href: `#/eleves/fiche/${e.id}`, texte: `${nomComplet(e)} — ${morceaux.join(' · ')}` });
  }

  const nbNotes = new Map();
  for (const n of notes) nbNotes.set(n.evaluationId, (nbNotes.get(n.evaluationId) || 0) + 1);
  for (const ev of evaluations) {
    // Deux motifs de remontée : jamais faite, ou faite puis PÉRIMÉE par une modification des
    // valeurs exportables (note ou barème). Le second manquait : l'évaluation disparaissait des
    // alertes alors que Pronote contenait des valeurs fausses (audit Codex V3, constat V3-03).
    const aRefaire = ev.publieePronote && ev.publieeObsolete;
    if ((ev.publieePronote && !aRefaire) || ev.type === 'afl' || !(nbNotes.get(ev.id) > 0)) continue;
    if (ev.date && ev.date < bornes.debut) continue; // année passée : plus rien à remonter (C09)
    const seq = sequences.find((s) => s.id === ev.sequenceId);
    const cl = seq ? classeDe(seq.classeId) : null;
    if (cl?.archivee) continue; // classe archivée : l'évaluation n'est plus à remonter (C09)
    alertes.push({
      grave: false,
      href: `#/notes/eval/${ev.id}`,
      texte: `« ${ev.titre} »${cl ? ' (' + cl.nom + ')' : ''} — ${aRefaire
        ? 'à remettre à jour dans Pronote (les notes ou le barème ont changé depuis la remontée)'
        : 'pas encore remontée vers Pronote'}`,
    });
  }

  // Les graves d'abord (tri stable : l'ordre d'insertion est conservé dans chaque groupe) : l'accueil
  // ne montre que les 8 premières, et des alertes ℹ permanentes évinçaient un ⚠ (revue du lot 1).
  alertes.sort((a, b) => Number(b.grave) - Number(a.grave));
  return alertes;
}
