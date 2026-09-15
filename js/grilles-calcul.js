// Fonctions pures partagées par l'éditeur, la saisie et la validation des sauvegardes.
const objet = v => v && typeof v === 'object' && !Array.isArray(v);
const texte = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 200;
export const COULEURS_NIVEAUX = ['rouge','orange','bleu','vert','violet','rose','turquoise','gris'];
const surPas = (valeur, pas) => Math.abs(valeur / pas - Math.round(valeur / pas)) < 1e-8;
export const cleChoix = choix => objet(choix) ? choix.niveau : choix;
export function pointsChoix(g, choix) {
  const niveau = g.niveaux.find(n => n.cle === cleChoix(choix));
  if (!niveau) throw new Error('Le détail contient un niveau inconnu.');
  if (!objet(choix)) return niveau.points;
  if (!g.pointsAjustables || Object.keys(choix).some(k => !['niveau','points'].includes(k)) ||
      !Number.isFinite(choix.points) || choix.points < niveau.minimum || choix.points > niveau.points || !surPas(choix.points, g.pasPoints)) {
    throw new Error('Points ajustés hors de la plage ou du pas autorisé.');
  }
  return choix.points;
}
export function validerGrille(g) {
  if (!objet(g) || !texte(g.titre)) throw new Error('La grille doit avoir un titre (200 caractères maximum).');
  if (!Array.isArray(g.niveaux) || g.niveaux.length < 2 || g.niveaux.length > 8) throw new Error('Choisissez entre 2 et 8 niveaux.');
  if (!Array.isArray(g.criteres) || !g.criteres.length || g.criteres.length > 30) throw new Error('Choisissez entre 1 et 30 critères.');
  for (const [lignes, cle] of [[g.niveaux, 'cle'], [g.criteres, 'id']]) {
    if (lignes.some(l => !objet(l) || !texte(l[cle]) || !texte(l.libelle)) || new Set(lignes.map(l => l[cle])).size !== lignes.length) throw new Error('Libellés et identifiants obligatoires, sans identifiant en double.');
  }
  if (g.niveaux.some(n => !Number.isFinite(n.points) || n.points < 0 || n.points > 1000) || Math.max(...g.niveaux.map(n => n.points)) <= 0) throw new Error('Les points doivent être compris entre 0 et 1000, avec un maximum supérieur à zéro.');
  if (g.pointsAjustables != null && typeof g.pointsAjustables !== 'boolean') throw new Error('Option de points ajustables invalide.');
  if (g.niveaux.some(n => n.couleur != null && !COULEURS_NIVEAUX.includes(n.couleur))) throw new Error('Couleur de niveau inconnue.');
  if (g.pointsAjustables && (![1, 0.5, 0.25].includes(g.pasPoints) || g.niveaux.some(n =>
    !Number.isFinite(n.minimum) || n.minimum < 0 || n.minimum > n.points || !surPas(n.minimum,g.pasPoints) || !surPas(n.points,g.pasPoints)))) {
    throw new Error('Chaque minimum doit être compris entre 0 et les points du niveau. Les bornes doivent respecter le pas choisi.');
  }
  if (g.criteres.some(c => !Number.isFinite(c.poids) || c.poids <= 0 || c.poids > 100 || (c.description != null && (typeof c.description !== 'string' || c.description.length > 1000)))) throw new Error('Chaque poids doit être compris entre 0 exclu et 100 ; description limitée à 1000 caractères.');
  if (!['exact','0.25','0.5','1'].includes(g.arrondi) || !['ignorer','zero'].includes(g.nonEvalue)) throw new Error('Règles de calcul invalides.');
  return g;
}
export function calculerGrille(g, detail = {}, bareme = 20) {
  validerGrille(g);
  if (!objet(detail) || !Number.isFinite(bareme) || bareme < 1 || bareme > 200) throw new Error('Détail ou barème invalide.');
  const ids = new Set(g.criteres.map(c => c.id));
  for (const [id, choix] of Object.entries(detail)) {
    if (!ids.has(id)) throw new Error('Le détail contient un critère inconnu.');
    pointsChoix(g, choix);
  }
  const max = Math.max(...g.niveaux.map(n => n.points));
  let brut = 0, maximum = 0, evalues = 0;
  for (const c of g.criteres) {
    const choisi = Object.hasOwn(detail,c.id);
    if (choisi) { brut += pointsChoix(g,detail[c.id]) * c.poids; evalues++; }
    if (choisi || g.nonEvalue === 'zero') maximum += max * c.poids;
  }
  const convertir = b => {
    const valeur = brut / maximum * b;
    const pas = g.arrondi === 'exact' ? .01 : Number(g.arrondi);
    return Math.min(b, Math.max(0, Math.round(Math.round((valeur + 1e-10)/pas)*pas*100)/100));
  };
  const valeur = evalues ? convertir(bareme) : null;
  return {brut, maximum, evalues, total:g.criteres.length, valeur, sur20:valeur === null ? null : Math.round(valeur/bareme*2000)/100};
}
export function nouvelleGrille() {
  return {id:crypto.randomUUID(),titre:'Nouvelle grille EPS',apsa:'',archivee:false,dateCreation:new Date().toISOString().slice(0,10),arrondi:'0.25',nonEvalue:'ignorer',
    niveaux:['Non atteint','Fragile','Satisfaisant','Maîtrisé'].map((libelle,points) => ({cle:crypto.randomUUID(),libelle,points})),
    criteres:['Efficacité','Maîtrise technique','Engagement','Rôle social'].map(libelle => ({id:crypto.randomUUID(),libelle,description:'',poids:2}))};
}
