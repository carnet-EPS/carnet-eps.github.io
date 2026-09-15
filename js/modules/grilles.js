import { el, carte, champ, enregistrerVue, toast, ouvrirFeuille } from '../ui.js';
import { tous, lire, parIndex, enregistrer, mettreAJourEvaluation } from '../io.js';
import { nouvelleGrille, validerGrille, calculerGrille, cleChoix, pointsChoix, COULEURS_NIVEAUX } from '../grilles-calcul.js';
import { trierEleves, formatFR } from '../metier.js';

const bouton = (texte, action, classe = 'btn') => { const b = el('button',{class:classe,type:'button'},texte); b.addEventListener('click',action); return b; };
const retour = href => el('a',{class:'retour no-print',href},'← Retour');
const totalMax = g => Math.max(...g.niveaux.map(n => n.points)) * g.criteres.reduce((s,c) => s+c.poids,0);
const regle = g => `Non évalués : ${g.nonEvalue === 'ignorer' ? 'ignorés dans le calcul' : 'comptés comme zéro'}. Arrondi : ${g.arrondi === 'exact' ? 'au centième' : g.arrondi.replace('.',',')}.`;
const erreur = e => toast(`Non enregistré : ${e?.message || e}`);

async function liste(c) {
  c.append(retour('#/plus'),el('p',{},'Préparez une grille, puis utilisez-la dans Notes → Nouvelle évaluation. Chaque évaluation conserve sa propre copie.'));
  const ajouter = bouton('Nouvelle grille',() => { location.hash = '#/grilles/nouvelle'; },'btn btn-principal');
  c.append(el('div',{class:'rang-btn no-print'},ajouter,el('a',{class:'btn',href:'#/notes'},'Créer une évaluation')));
  const grilles = (await tous('grilles')).sort((a,b) => Number(a.archivee)-Number(b.archivee) || a.titre.localeCompare(b.titre,'fr'));
  if (!grilles.length) c.append(carte('Votre première grille','Quatre niveaux et quatre critères sont proposés pour démarrer. Adaptez-les à votre APSA.'));
  for (const g of grilles) {
    const bloc = carte(g.titre,`${g.apsa || 'Toutes APSA'} · ${g.criteres.length} critères · maximum ${formatFR(totalMax(g))} points${g.archivee ? ' · archivée' : ''}`);
    bloc.append(el('div',{class:'rang-btn'},el('a',{class:'btn',href:`#/grilles/modifier/${g.id}`},'Modifier'),
      bouton('Dupliquer',async () => { try { const n = {...structuredClone(g),id:crypto.randomUUID(),titre:`${g.titre.slice(0,185)} — copie`,archivee:false}; await enregistrer('grilles',n); location.hash = `#/grilles/modifier/${n.id}`; } catch(e) { erreur(e); } }),
      bouton(g.archivee ? 'Restaurer' : 'Archiver',async () => { try { await enregistrer('grilles',{...g,archivee:!g.archivee}); c.replaceChildren(); await liste(c); } catch(e) { erreur(e); } })));
    c.append(bloc);
  }
}

async function editeur(c,id) {
  const source = id ? await lire('grilles',id) : nouvelleGrille();
  if (!source) { c.append(carte('Grille introuvable')); return; }
  const g = structuredClone(source);
  g.niveaux.forEach((n,i)=>{n.couleur ??= COULEURS_NIVEAUX[i];});
  c.append(retour('#/grilles'));
  const form = el('form',{class:'editeur-grille'});
  const saisie = (label,valeur,type,maj) => {
    const input = el('input',{type,value:String(valeur),maxlength:'200',step:'any'});
    input.addEventListener('input',() => { maj(type === 'number' ? (input.value === '' ? NaN : Number(input.value)) : input.value); majTotal(); });
    return el('label',{class:'champ'},el('span',{},label),input);
  };
  const identite = carte('Votre grille');
  identite.append(saisie('Titre de la grille',g.titre,'text',v => g.titre=v),saisie('APSA',g.apsa || '','text',v => g.apsa=v));
  const niveaux = carte('Niveaux de maîtrise','Les points d’un niveau sont multipliés par le poids du critère.');
  const lignesN = el('div');
  const ajustables = el('input',{type:'checkbox'}); ajustables.checked=!!g.pointsAjustables;
  const pas = el('select',{'aria-label':'Pas des points ajustables'},...[1,.5,.25].map(v => el('option',{value:v},formatFR(v)))); pas.value=String(g.pasPoints || 1);
  pas.addEventListener('change',() => {g.pasPoints=Number(pas.value);});
  const champPas=el('label',{class:'champ'},'Pas des points ajustables',pas); champPas.hidden=!g.pointsAjustables;
  ajustables.addEventListener('change',() => {
    g.pointsAjustables=ajustables.checked;g.pasPoints=Number(pas.value);
    g.niveaux.forEach((n,i) => {if(n.minimum==null)n.minimum=i && g.niveaux[i-1].points+g.pasPoints<=n.points ? g.niveaux[i-1].points+g.pasPoints : 0;});
    champPas.hidden=!g.pointsAjustables;rendreN();
  });
  niveaux.append(el('label',{class:'champ'},ajustables,'Points ajustables dans les cases'),champPas,
    el('p',{},'Un clic choisit les points du niveau. Avec l’option, un appui long ou « Ajuster » permet de choisir du minimum au maximum. Les bornes sont définies avant pondération. Vérifiez les intervalles si vous utilisez des demi-points.'));
  const criteres = carte('Critères observés','Précisez ce que l’élève doit montrer. Un poids de 2 compte deux fois plus qu’un poids de 1.');
  const lignesC = el('div');
  const affichageTotal = el('p',{class:'grille-total',role:'status'});
  function majTotal() { const n = totalMax(g); affichageTotal.textContent = Number.isFinite(n) ? `Maximum de la grille : ${formatFR(n)} points` : 'Complétez les points et les poids.'; }
  function rendreN() {
    lignesN.replaceChildren();
    g.niveaux.forEach((n,i) => {
      const ligne = el('div',{class:'grille-edition-ligne'},saisie(`Niveau ${i+1}`,n.libelle,'text',v => n.libelle=v),saisie(`Points niveau ${i+1}`,n.points,'number',v => n.points=v));
      if(g.pointsAjustables)ligne.append(saisie(`Minimum niveau ${i+1}`,n.minimum ?? 0,'number',v => n.minimum=v));
      const couleur=el('select',{'aria-label':`Couleur niveau ${i+1}`},...COULEURS_NIVEAUX.map(v => el('option',{value:v},v)));
      couleur.value=n.couleur || COULEURS_NIVEAUX[i];couleur.addEventListener('change',()=>{n.couleur=couleur.value;});
      ligne.append(el('label',{class:'champ'},`Couleur niveau ${i+1}`,couleur));
      const retirer = bouton(`Retirer le niveau ${i+1}`,() => { g.niveaux.splice(i,1); rendreN(); majTotal(); }); retirer.disabled = g.niveaux.length <= 2;
      ligne.append(retirer); lignesN.append(ligne);
    });
  }
  function rendreC() {
    lignesC.replaceChildren();
    g.criteres.forEach((cr,i) => {
      const ligne = el('fieldset',{class:'grille-edition-critere'},el('legend',{},`Critère ${i+1}`));
      const description = el('textarea',{rows:2,maxlength:1000}); description.value = cr.description || '';
      description.addEventListener('input',() => { cr.description = description.value; });
      ligne.append(saisie(`Libellé critère ${i+1}`,cr.libelle,'text',v => cr.libelle=v),el('label',{class:'champ'},'Ce que l’élève doit montrer',description),saisie(`Poids critère ${i+1}`,cr.poids,'number',v => cr.poids=v));
      const retirer = bouton(`Retirer le critère ${i+1}`,() => { g.criteres.splice(i,1); rendreC(); majTotal(); }); retirer.disabled=g.criteres.length<=1;
      const monter = bouton('Monter',() => { [g.criteres[i-1],g.criteres[i]]=[g.criteres[i],g.criteres[i-1]]; rendreC(); }); monter.disabled=i===0;
      ligne.append(el('div',{class:'rang-btn'},monter,retirer)); lignesC.append(ligne);
    });
  }
  niveaux.append(lignesN,bouton('Ajouter un niveau',() => { if(g.niveaux.length<8) {g.niveaux.push({cle:crypto.randomUUID(),libelle:'Nouveau niveau',points:g.niveaux.length,minimum:0}); rendreN(); majTotal();} else toast('Maximum : 8 niveaux.'); }));
  criteres.append(lignesC,bouton('Ajouter un critère',() => {if(g.criteres.length<30) {g.criteres.push({id:crypto.randomUUID(),libelle:'Nouveau critère',poids:1,description:''}); rendreC(); majTotal();} else toast('Maximum : 30 critères.'); }));
  const regles = carte('Calcul de la note');
  const vide = el('select',{id:'gr-vide'},el('option',{value:'ignorer'},'Ignorer les critères non évalués'),el('option',{value:'zero'},'Compter les critères non évalués comme zéro')); vide.value=g.nonEvalue;
  vide.addEventListener('change',() => {g.nonEvalue=vide.value;});
  const arrondi = el('select',{id:'gr-arrondi'},...['exact','0.25','0.5','1'].map(v => el('option',{value:v},v === 'exact' ? 'Au centième' : `Au pas de ${v.replace('.',',')}`))); arrondi.value=g.arrondi;
  arrondi.addEventListener('change',() => {g.arrondi=arrondi.value;});
  regles.append(champ('gr-vide','Critères non évalués',vide),champ('gr-arrondi','Arrondi de la note convertie',arrondi),el('p',{},'Aucun critère évalué : aucune note, même avec l’option zéro.'));
  const statut = el('p',{role:'status',class:'statut'});
  const sauver = el('button',{type:'submit',class:'btn btn-principal'},'Enregistrer la grille');
  form.addEventListener('submit',async e => { e.preventDefault(); sauver.disabled=true; try {validerGrille(g); await enregistrer('grilles',g); location.hash='#/grilles'; toast('Grille enregistrée. Les évaluations existantes sont conservées.');} catch(err) {statut.textContent=err.message; statut.className='statut statut-erreur';} finally {sauver.disabled=false;} });
  form.append(identite,niveaux,criteres,regles,el('div',{class:'grille-actions'},affichageTotal,sauver),statut); c.append(form); rendreN(); rendreC(); majTotal();
}

async function saisir(c,id) {
  const ev = await lire('evaluations',id);
  if (!ev?.grille) {c.append(carte('Évaluation par grille introuvable'));return;}
  validerGrille(ev.grille);
  const seq = await lire('sequences',ev.sequenceId);
  const classe = seq && await lire('classes',seq.classeId);
  if (!classe) {c.append(carte('Classe introuvable'));return;}
  const eleves=(await parIndex('eleves','classeId',classe.id)).filter(e => e.actif!==false).sort(trierEleves);
  const notes=new Map((await parIndex('notes','evaluationId',id)).map(n => [n.eleveId,n]));
  const g=ev.grille;
  c.append(retour(`#/notes/eval/${id}`),carte(`${ev.titre} — ${classe.nom}`,`${g.titre} · barème /${ev.bareme} · ${regle(g)}`));
  if (!eleves.length) {c.append(carte('Aucun élève actif'));return;}
  let index=0, mode='eleve', critere=g.criteres[0].id, occupe=false;
  const nav=el('div',{class:'grille-navigation no-print'}), contenu=el('div'), statut=el('p',{role:'status',class:'statut'});
  const selEleve=el('select',{'aria-label':'Élève à évaluer'},...eleves.map((e,i) => el('option',{value:String(i)},`${e.nom} ${e.prenom}`)));
  const selCritere=el('select',{'aria-label':'Critère à évaluer'},...g.criteres.map(cr => el('option',{value:cr.id},cr.libelle)));
  const selMode=el('select',{'aria-label':'Mode de saisie'},el('option',{value:'eleve'},'Par élève'),el('option',{value:'critere'},'Par critère'),el('option',{value:'bilan'},'Bilan de la classe'));
  selEleve.addEventListener('change',() => {index=Number(selEleve.value);rendre();});
  selCritere.addEventListener('change',() => {critere=selCritere.value;rendre();});
  selMode.addEventListener('change',() => {mode=selMode.value;rendre();});
  const groupeEleve=el('label',{class:'champ'},'Élève',selEleve), groupeCritere=el('label',{class:'champ'},'Critère',selCritere);
  const reutiliser=bouton('Réutiliser cette grille',async () => {
    reutiliser.disabled=true;
    try {
      const copie={...structuredClone(g),id:crypto.randomUUID(),titre:`${g.titre.slice(0,185)} — copie`,archivee:false};
      await enregistrer('grilles',copie);location.hash=`#/grilles/modifier/${copie.id}`;
    } catch(e) {erreur(e);reutiliser.disabled=false;}
  });
  nav.append(el('label',{class:'champ'},'Saisir ou consulter',selMode),groupeEleve,groupeCritere,el('div',{class:'rang-btn'},bouton('Imprimer',() => window.print()),el('a',{class:'btn',href:`#/notes/eval/${id}`},'Notes et export Pronote'),reutiliser));
  c.append(nav,statut,contenu);
  if(g.pointsAjustables)c.insertBefore(el('p',{class:'no-print'},'Touchez une case pour choisir le niveau. Appui long ou bouton Ajuster : choisir les points. Retoucher le niveau sélectionné efface ce critère.'),contenu);
  async function enregistrerChoix(e,detail,code=undefined) {
    if(occupe)return; occupe=true;
    const focusAvant=document.activeElement?.dataset.grilleFocus;
    const controles=[...c.querySelectorAll('button,select')]; controles.forEach(x => x.disabled=true);
    statut.textContent='Enregistrement…'; statut.className='statut';
    try {
      const calcul=calculerGrille(g,detail,ev.bareme);
      // Une observation n'annule pas une dispense/absence. Seul le sélecteur de statut
      // peut reprendre la notation (null explicite) ; undefined conserve le code actuel.
      const codeActuel=typeof notes.get(e.id)?.valeur==='string' ? notes.get(e.id).valeur : null;
      const valeur=(code===undefined ? codeActuel : code) || calcul.valeur;
      const rec={id:`${id}_${e.id}`,evaluationId:id,eleveId:e.id,valeur,detail,commentaire:notes.get(e.id)?.commentaire || ''};
      await mettreAJourEvaluation(id, {},
        [{store:'notes',...(valeur===null ? {op:'delete',cle:rec.id} : {op:'put',valeur:rec})}],
        [{id:rec.id,note:notes.get(e.id) || null}]);
      if(valeur===null)notes.delete(e.id);else notes.set(e.id,rec);
      statut.textContent='Enregistré ✓'; statut.className='statut statut-ok';
    } catch(err) {statut.textContent=`Non enregistré : ${err.message}`;statut.className='statut statut-erreur';}
    finally {
      occupe=false;controles.forEach(x => x.disabled=false);rendre();
      if(focusAvant && c.isConnected) [...c.querySelectorAll('[data-grille-focus]')].find(x => x.dataset.grilleFocus===focusAvant)?.focus({preventScroll:true});
    }
  }
  function score(e) {
    const n=notes.get(e.id), r=calculerGrille(g,n?.detail || {},ev.bareme);
    if(typeof n?.valeur==='string')return `${n.valeur} · hors moyenne`;
    return r.valeur===null ? 'Aucune note · aucun critère évalué' : `${formatFR(r.brut)}/${formatFR(r.maximum)} points → ${formatFR(r.valeur)}/${ev.bareme}${ev.bareme!==20 ? ` · ${formatFR(r.sur20)}/20` : ''} · ${r.evalues}/${r.total} critères évalués`;
  }
  function ligne(e,cr) {
    const detail=notes.get(e.id)?.detail || {}, choix=cleChoix(detail[cr.id]);
    const bloc=el('fieldset',{class:'grille-critere'},el('legend',{},mode==='critere' ? `${e.nom} ${e.prenom}` : `${cr.libelle} · poids ${cr.poids}`));
    if(cr.description)bloc.append(el('p',{},cr.description));
    const selection=g.niveaux.find(n => n.cle===choix);
    bloc.append(el('p',{class:'grille-selection'},selection ? `${selection.libelle} · ${formatFR(pointsChoix(g,detail[cr.id])*cr.poids)} points` : 'Non évalué'));
    const boutons=el('div',{class:'grille-niveaux no-print'});
    g.niveaux.forEach((n,i) => {
      const ajuste=choix===n.cle && typeof detail[cr.id]==='object';
      const textePoints=ajuste ? `${formatFR(pointsChoix(g,detail[cr.id])*cr.poids)} / ${formatFR(n.points*cr.poids)} points` : `${formatFR(n.points*cr.poids)} pt`;
      const b=bouton(`${n.libelle} · ${textePoints}`,() => {
        const prochain={...detail};if(choix===n.cle)delete prochain[cr.id];else prochain[cr.id]=n.cle;enregistrerChoix(e,prochain);
      },`btn${choix===n.cle ? ' btn-principal':''}`);
      b.setAttribute('aria-pressed',String(n.cle===choix));
      b.dataset.grilleFocus=JSON.stringify([e.id,cr.id,n.cle]);
      b.dataset.niveauCouleur=n.couleur || COULEURS_NIVEAUX[i];
      if(g.pointsAjustables) {
        const ajuster=bouton('Ajuster',() => ouvrirPoints(e,cr,n,ajuster),'btn grille-ajuster');
        ajuster.setAttribute('aria-label',`Ajuster ${n.libelle} — ${mode==='critere' ? e.nom+' '+e.prenom : cr.libelle}`);
        ajuster.dataset.grilleFocus=JSON.stringify([e.id,cr.id,n.cle,'ajuster']);
        installerAppuiLong(b,()=>ouvrirPoints(e,cr,n,b));
        boutons.append(el('div',{class:'grille-case'},b,ajuster));
      } else boutons.append(b);
    });
    bloc.append(boutons);return bloc;
  }
  function ouvrirPoints(e,cr,n,declencheur) {
    if(occupe || !c.isConnected)return;
    declencheur.focus({preventScroll:true});
    const detail=notes.get(e.id)?.detail || {};
    const actuel=cleChoix(detail[cr.id])===n.cle ? pointsChoix(g,detail[cr.id]) : n.points;
    const choix=el('div',{class:'grille-points'});
    let selection=null;
    const choisirPoints=points=>{selection=points;dlg.close();};
    const nombre=Math.round((n.points-n.minimum)/g.pasPoints)+1;
    // Grandes plages : un champ borné évite des milliers de boutons sur téléphone.
    if(nombre<=21) {
      for(let i=0;i<nombre;i++) {
        const points=Math.round((n.minimum+i*g.pasPoints)*100)/100;
        const b=bouton(formatFR(points),()=>choisirPoints(points),`btn${points===actuel ? ' btn-principal':''}`);
        b.setAttribute('aria-pressed',String(points===actuel));choix.append(b);
      }
    } else {
      const form=el('form'),input=el('input',{type:'number',min:n.minimum,max:n.points,step:g.pasPoints,value:actuel,required:true});
      form.append(el('label',{class:'champ'},'Points à attribuer',input),el('button',{type:'submit',class:'btn btn-principal'},'Appliquer'));
      form.addEventListener('submit',event=>{event.preventDefault();if(form.reportValidity())choisirPoints(Number(input.value));});choix.append(form);
    }
    const dlg=ouvrirFeuille({titre:'Ajuster les points',contenu:[
      el('p',{},`${e.nom} ${e.prenom} · ${cr.libelle} · ${n.libelle}`),
      el('p',{},`De ${formatFR(n.minimum)} à ${formatFR(n.points)} points · pas de ${formatFR(g.pasPoints)}${cr.poids!==1 ? ` · multipliés par le poids ${formatFR(cr.poids)}` : ''}.`),
      choix,bouton('Annuler',()=>dlg.close())]});
    dlg.classList.add('feuille-points');
    const fermer=()=>dlg.close();window.addEventListener('hashchange',fermer);
    dlg.addEventListener('close',()=>{
      window.removeEventListener('hashchange',fermer);
      if(selection!==null && c.isConnected)enregistrerChoix(e,{...detail,[cr.id]:{niveau:n.cle,points:selection}});
    },{once:true});
  }
  function rendre() {
    const navigationFocus = document.activeElement?.dataset.grilleNavigation;
    contenu.replaceChildren();groupeEleve.hidden=mode!=='eleve';groupeCritere.hidden=mode!=='critere';
    if(mode==='eleve') {
      const e=eleves[index];
      contenu.append(el('h2',{},`${e.nom} ${e.prenom}`),el('p',{class:'grille-total',role:'status'},score(e)));
      const code=el('select',{'aria-label':'Statut de l’élève'},el('option',{value:''},'Évaluer avec la grille'),...['ABS','DISP','NN'].map(x => el('option',{value:x},x)));
      code.dataset.grilleFocus=JSON.stringify([e.id,'statut']);
      code.value=typeof notes.get(e.id)?.valeur==='string' ? notes.get(e.id).valeur:'';
      code.addEventListener('change',() => enregistrerChoix(e,notes.get(e.id)?.detail || {},code.value || null));
      contenu.append(el('label',{class:'champ no-print'},'Absence / dispense / non noté',code));
      for(const cr of g.criteres)contenu.append(ligne(e,cr));
      const suivant=bouton('Élève suivant',() => {index=(index+1)%eleves.length;selEleve.value=String(index);rendre();});
      const precedent=bouton('Élève précédent',() => {index=(index+eleves.length-1)%eleves.length;selEleve.value=String(index);rendre();});
      precedent.dataset.grilleNavigation='precedent';suivant.dataset.grilleNavigation='suivant';
      contenu.append(el('div',{class:'rang-btn no-print'},precedent,suivant));
    } else if(mode==='critere') {
      const cr=g.criteres.find(x => x.id===critere);contenu.append(el('h2',{},cr.libelle));
      for(const e of eleves)contenu.append(ligne(e,cr),el('p',{class:'note-discrete'},score(e)));
      const suivantCritere=bouton('Critère suivant',() => {critere=g.criteres[(g.criteres.findIndex(x=>x.id===critere)+1)%g.criteres.length].id;selCritere.value=critere;rendre();});
      suivantCritere.dataset.grilleNavigation='critere';
      contenu.append(el('div',{class:'rang-btn no-print'},suivantCritere));
    } else {
      contenu.append(el('h2',{},'Bilan par critère'),el('p',{},'Réussite = points obtenus / points possibles sur les critères observés. Les élèves ABS, DISP et NN sont exclus.'));
      const table=el('table',{class:'table-apercu'},el('caption',{},`${classe.nom} — ${ev.titre}`),el('thead',{},el('tr',{},...['Critère','Observés','Réussite'].map(t => el('th',{scope:'col'},t)))));
      const body=el('tbody');
      for(const cr of g.criteres){const vals=eleves.map(e => notes.get(e.id)).filter(n => typeof n?.valeur==='number' && Object.hasOwn(n.detail || {},cr.id)).map(n => pointsChoix(g,n.detail[cr.id]));body.append(el('tr',{},el('th',{scope:'row'},cr.libelle),el('td',{},`${vals.length}/${eleves.length}`),el('td',{},vals.length ? `${formatFR(vals.reduce((a,b)=>a+b,0)/vals.length/Math.max(...g.niveaux.map(n=>n.points))*100)} %`:'Non évalué')));}
      table.append(body);contenu.append(el('div',{class:'table-scroll'},table));
    }
    if (navigationFocus && c.isConnected) [...contenu.querySelectorAll('[data-grille-navigation]')].find(b => b.dataset.grilleNavigation === navigationFocus)?.focus({preventScroll:true});
  }
  rendre();
}
function installerAppuiLong(b,ouvrir) {
  let timer, depart, ignorerClic=false;
  const annuler=()=>{clearTimeout(timer);depart=null;};
  b.addEventListener('pointerdown',event=>{
    annuler();ignorerClic=false;
    if(!event.isPrimary || event.button!==0)return;
    depart={x:event.clientX,y:event.clientY};
    timer=setTimeout(()=>{
      if(depart && b.isConnected && !b.disabled) {
        ignorerClic=true;
        // Après showModal(), le clic de compatibilité tactile peut cibler le fond du
        // dialogue, plus le bouton initial. Intercepter ce seul geste au document.
        // Le prochain pointerdown (nouveau geste) libère toujours les choix du panneau.
        const nettoyer=()=>{
          document.removeEventListener('click',bloquer,true);
          document.removeEventListener('pointerdown',nettoyer,true);
          window.removeEventListener('hashchange',nettoyer);
        };
        const bloquer=event=>{if(event.detail!==0){event.preventDefault();event.stopImmediatePropagation();}nettoyer();};
        document.addEventListener('click',bloquer,true);
        document.addEventListener('pointerdown',nettoyer,true);
        window.addEventListener('hashchange',nettoyer);
        ouvrir();
      }
    },550);
  });
  b.addEventListener('pointermove',event=>{if(depart && Math.hypot(event.clientX-depart.x,event.clientY-depart.y)>10){ignorerClic=true;annuler();}});
  for(const nom of ['pointerup','pointerleave','pointercancel','lostpointercapture'])b.addEventListener(nom,annuler);
  b.addEventListener('click',event=>{if(ignorerClic && event.detail!==0){event.preventDefault();event.stopImmediatePropagation();}},true);
  b.addEventListener('contextmenu',event=>event.preventDefault());
}
export function initialiser() {
  enregistrerVue('grilles',async(c,p=[]) => { if(p[0]==='nouvelle')await editeur(c);else if(p[0]==='modifier')await editeur(c,p[1]);else if(p[0]==='saisie')await saisir(c,p[1]);else await liste(c); });
}
