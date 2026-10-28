// api/_agences.js — isolation PAR AGENCE (au-dela de l'isolation par client deja faite dans airtable-proxy.js).
// Une session « restreinte » porte une agence (revendication `agence` du jeton, issue du champ « Agence » du compte).
// Elle ne lit, ne cree, ne modifie et ne supprime QUE les donnees de cette agence. Le patron (TENANT_ADMIN sans agence) et
// le super admin ne sont pas concernes. Echec FERME : une table inconnue (ou appelee par son identifiant « tblXXXX ») est refusee.

// Valeur du champ « Agence » d'un compte -> agence imposee, ou null si le compte n'est pas restreint.
export function agenceRestreinte(valeur) {
  const v = String(valeur == null ? "" : valeur).trim();
  if (!v || /^(toutes?|tous|\*|global)$/i.test(v)) return null;
  return v.slice(0, 80);
}

const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const memeAgence = (valeur, agence) => String(valeur == null ? "" : valeur).trim().toLowerCase() === String(agence).trim().toLowerCase();
const liste = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// Tables dont chaque enregistrement appartient a UNE agence.
const TABLES_AGENCE = {
  "Tickets SAV": { champ: "Agence" },
  "Planning": { champ: "Agence", lectureVideOk: true },
  "Contrats entretien": { champ: "Agence" },
  "Techniciens": { champ: "Agence" },
  "Métrés": { champ: "Agence" },
  "RDV Commercial": { champ: "Agence" },
  "Planning Commercial": { champ: "Agence" },
  "Devis": { champ: "Agence", lien: true },
  "Agences": { champ: "Nom agence" },
};
// Reglages du client : lisibles par l'agence, jamais modifiables par elle.
const TABLES_LECTURE_SEULE = ["Clients", "Catalogue Produits", "Grille Main d'œuvre", "Mise en page Devis", "Questionnaire SAV"];
// Interventions : rattachees a une agence par leur ticket.
const TABLE_INTERVENTIONS = "Interventions SAV";

function formuleAgence(conf, agence) {
  if (conf.lien) return 'FIND(", ' + esc(agence) + ',", ", "&ARRAYJOIN({' + conf.champ + '}, ", ")&",")';
  const egal = '{' + conf.champ + '}="' + esc(agence) + '"';
  return conf.lectureVideOk ? 'OR(' + egal + ', {' + conf.champ + '}="")' : egal;
}

async function lireJson(url, headers) {
  const r = await fetch(url, { headers });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

async function agenceDuTicket(ctx, idTicket) {
  if (!/^rec[A-Za-z0-9]{14}$/.test(String(idTicket || ""))) return null;
  const rec = await lireJson("https://api.airtable.com/v0/" + ctx.baseId + "/" + encodeURIComponent("Tickets SAV") + "/" + idTicket, ctx.headers);
  return rec ? ((rec.fields || {})["Agence"] || "") : null;
}

// Verifie qu'UN enregistrement (relu cote serveur) appartient bien a l'agence.
async function enregistrementAutorise(ctx, table, id) {
  const base = "https://api.airtable.com/v0/" + ctx.baseId + "/" + encodeURIComponent(table) + "/" + encodeURIComponent(id);
  const rec = await lireJson(base, ctx.headers);
  if (!rec) return "introuvable";
  const f = rec.fields || {};
  if (table === TABLE_INTERVENTIONS) {
    const ids = liste(f["Ticket SAV"]);
    if (!ids.length) return "refus";
    for (const t of ids) { if (!memeAgence(await agenceDuTicket(ctx, t), ctx.agence)) return "refus"; }
    return "ok";
  }
  const conf = TABLES_AGENCE[table];
  if (conf.lien) {
    // « Agence » d'un devis = lien vers la table Agences : on compare les NOMS des agences liees.
    const noms = [];
    for (const a of liste(f[conf.champ]).slice(0, 5)) {
      const ag = await lireJson("https://api.airtable.com/v0/" + ctx.baseId + "/Agences/" + a, ctx.headers);
      if (ag) noms.push((ag.fields || {})["Nom agence"] || "");
    }
    return noms.length && noms.every((n) => memeAgence(n, ctx.agence)) ? "ok" : "refus";
  }
  const v = f[conf.champ];
  if (memeAgence(v, ctx.agence)) return "ok";
  if (conf.lectureVideOk && !String(v || "").trim() && ctx.method === "GET") return "ok";
  return "refus";
}

const refus = (message) => ({ status: 403, json: { error: message || "Accès refusé : cette donnée appartient à une autre agence." } });

// Point d'entree. Retourne null (continuer) ou { status, json } (repondre tout de suite).
// Peut modifier ctx.rest.filterByFormula et ctx.req.body ; retourne aussi `postFiltre` pour les listes d'interventions.
export async function gardeAgence(ctx) {
  const { method, premierSegment, segments, rest, req } = ctx;
  const table = premierSegment;
  const confAgence = TABLES_AGENCE[table];
  const estIntervention = table === TABLE_INTERVENTIONS;
  const estLectureSeule = TABLES_LECTURE_SEULE.includes(table);
  if (!confAgence && !estIntervention && !estLectureSeule) return refus("Accès refusé : cette ressource n'est pas disponible pour un compte d'agence.");
  const id = segments[1];
  const ecriture = method !== "GET" && method !== "HEAD";

  if (estLectureSeule) {
    return ecriture ? refus("Accès refusé : les réglages du client sont réservés au responsable de l'entreprise.") : null;
  }

  // --- Lecture ---
  if (!ecriture) {
    if (id) {
      const r = await enregistrementAutorise(ctx, table, id);
      return r === "ok" ? null : (r === "introuvable" ? { status: 404, json: { error: "Introuvable." } } : refus());
    }
    if (estIntervention) {
      return { postFiltre: async (records) => {
        const ids = [...new Set(records.flatMap((r) => liste((r.fields || {})["Ticket SAV"])))].filter((x) => /^rec[A-Za-z0-9]{14}$/.test(x));
        const ok = new Set();
        for (let i = 0; i < ids.length; i += 40) {
          const formule = "OR(" + ids.slice(i, i + 40).map((x) => 'RECORD_ID()="' + x + '"').join(",") + ")";
          const j = await lireJson("https://api.airtable.com/v0/" + ctx.baseId + "/" + encodeURIComponent("Tickets SAV") + "?pageSize=100&filterByFormula=" + encodeURIComponent(formule), ctx.headers);
          ((j && j.records) || []).forEach((t) => { if (memeAgence((t.fields || {})["Agence"], ctx.agence)) ok.add(t.id); });
        }
        return records.filter((r) => { const l = liste((r.fields || {})["Ticket SAV"]); return l.length && l.every((t) => ok.has(t)); });
      } };
    }
    const f = formuleAgence(confAgence, ctx.agence);
    rest.filterByFormula = rest.filterByFormula ? "AND(" + rest.filterByFormula + ", " + f + ")" : f;
    return null;
  }

  // --- Ecriture ---
  const corps = req.body && typeof req.body === "object" ? req.body : null;
  if (!corps) return refus("Requête invalide.");
  if (id) {
    const r = await enregistrementAutorise(ctx, table, id);
    if (r !== "ok") return r === "introuvable" ? { status: 404, json: { error: "Introuvable." } } : refus();
    if (method === "PATCH" || method === "PUT") {
      const champs = corps.fields || {};
      if (!estIntervention && !confAgence.lien && confAgence.champ in champs && !memeAgence(champs[confAgence.champ], ctx.agence)) return refus("Accès refusé : on ne peut pas déplacer une donnée vers une autre agence.");
      if (confAgence && confAgence.lien && confAgence.champ in champs) return refus("Accès refusé : l'agence d'un devis ne se modifie pas depuis un compte d'agence.");
    }
    return null;
  }
  if (method === "DELETE" || method === "PATCH" || method === "PUT") return refus("Requête invalide pour un compte d'agence.");

  // Creation (POST) : l'agence est IMPOSEE par le serveur.
  const enregs = Array.isArray(corps.records) ? corps.records : [corps];
  if (enregs.length > 10) return refus("Requête invalide.");
  for (const e of enregs) {
    e.fields = e.fields && typeof e.fields === "object" ? e.fields : {};
    if (estIntervention) {
      const tickets = liste(e.fields["Ticket SAV"]);
      if (!tickets.length) return refus("Accès refusé : une intervention doit être liée à un ticket de votre agence.");
      for (const t of tickets) { if (!memeAgence(await agenceDuTicket(ctx, t), ctx.agence)) return refus(); }
    } else if (confAgence.lien) {
      for (const a of liste(e.fields[confAgence.champ])) {
        const ag = await lireJson("https://api.airtable.com/v0/" + ctx.baseId + "/Agences/" + a, ctx.headers);
        if (!ag || !memeAgence((ag.fields || {})["Nom agence"], ctx.agence)) return refus();
      }
    } else if (table !== "Agences") {
      e.fields[confAgence.champ] = ctx.agence;
    } else {
      return refus("Accès refusé : les agences sont gérées par le responsable de l'entreprise.");
    }
  }
  return null;
}
