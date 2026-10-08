// Faux Airtable en memoire pour les tests (AUCUN appel reseau reel, AUCUNE ecriture reelle).
// Gere : GET (id, liste filtree, tri sur Date, pagination), POST (lots), PATCH, DELETE (records[]).
// Formules supportees (celles utilisees par le code) : AND(...) de clauses
//   {Champ}="v"  {Champ}>="v"  {Champ}<="v"  {Champ}<"v"  {Champ}>"v"
//   LOWER({Champ})="v"  LOWER(TRIM({Champ}))="v"  UPPER({Champ})="v"  RECORD_ID()!="v"
//   FIND("nom", ARRAYJOIN({Client|Compte client}))   ARRAYJOIN({Compte client})=""   {Actif}=1

const CHAMPS_LIENS = { "Client": "Clients", "Compte client": "Clients", "tenantId": "Clients" };

function decouperClauses(texte) {
  const out = [];
  let profondeur = 0, enChaine = false, debut = 0;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (c === "\\" && enChaine) { i++; continue; }
    if (c === '"') enChaine = !enChaine;
    if (enChaine) continue;
    if (c === "(") profondeur++;
    if (c === ")") profondeur--;
    if (c === "," && profondeur === 0) { out.push(texte.slice(debut, i).trim()); debut = i + 1; }
  }
  out.push(texte.slice(debut).trim());
  return out;
}

function dechapper(v) {
  return v.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

export function creerFaux(db, options = {}) {
  let compteur = 0;
  const journal = []; // { methode, table }
  const nomClient = (id) => (db.Clients.find((c) => c.id === id) || { fields: {} }).fields["Nom client"] || "";

  function valeur(rec, champ) {
    return rec.fields ? rec.fields[champ] : undefined;
  }
  function joint(rec, champ) {
    const v = valeur(rec, champ);
    if (!Array.isArray(v)) return v == null ? "" : String(v);
    return v.map((id) => (CHAMPS_LIENS[champ] ? nomClient(id) : String(id))).join(", ");
  }

  function evaluer(rec, clause) {
    let m;
    if ((m = clause.match(/^FIND\("((?:[^"\\]|\\.)*)",\s*ARRAYJOIN\(\{([^}]+)\}\)\)$/))) return joint(rec, m[2]).includes(dechapper(m[1]));
    if ((m = clause.match(/^ARRAYJOIN\(\{([^}]+)\}\)=""$/))) return joint(rec, m[1]) === "";
    if ((m = clause.match(/^RECORD_ID\(\)!="([^"]*)"$/))) return rec.id !== m[1];
    if ((m = clause.match(/^LOWER\(TRIM\(\{([^}]+)\}\)\)="((?:[^"\\]|\\.)*)"$/))) return String(valeur(rec, m[1]) || "").trim().toLowerCase() === dechapper(m[2]);
    if ((m = clause.match(/^LOWER\(\{([^}]+)\}\)="((?:[^"\\]|\\.)*)"$/))) return String(valeur(rec, m[1]) || "").toLowerCase() === dechapper(m[2]);
    if ((m = clause.match(/^UPPER\(\{([^}]+)\}\)="((?:[^"\\]|\\.)*)"$/))) return String(valeur(rec, m[1]) || "").toUpperCase() === dechapper(m[2]);
    if ((m = clause.match(/^\{([^}]+)\}=1$/))) return valeur(rec, m[1]) === true;
    if ((m = clause.match(/^\{([^}]+)\}(>=|<=|<|>|=|!=)"((?:[^"\\]|\\.)*)"$/))) {
      const v = String(valeur(rec, m[1]) == null ? "" : valeur(rec, m[1])), w = dechapper(m[3]);
      return { ">=": v >= w, "<=": v <= w, "<": v < w, ">": v > w, "=": v === w, "!=": v !== w }[m[2]];
    }
    throw new Error("clause non geree par le faux Airtable : " + clause);
  }

  function filtrer(recs, formule) {
    if (!formule) return recs;
    let f = formule.trim();
    const m = f.match(/^AND\((.*)\)$/s);
    const clauses = decouperClauses(m ? m[1] : f);
    return recs.filter((r) => clauses.every((c) => evaluer(r, c)));
  }

  const reponse = (corps, ok = true, status = 200) => ({ ok, status, json: async () => corps, text: async () => JSON.stringify(corps) });

  async function faux(url, init = {}) {
    const u = new URL(url);
    if (u.hostname !== "api.airtable.com") throw new Error("appel reseau inattendu : " + u.hostname);
    const parties = decodeURIComponent(u.pathname).split("/").filter(Boolean).slice(2); // apres /v0/<base>
    const table = parties[0];
    const id = parties[1];
    const methode = init.method || "GET";
    if (!db[table]) return reponse({ error: "table inconnue" }, false, 404);
    journal.push({ methode, table });
    if (options.echec && options.echec(methode, table, journal.filter((j) => j.methode === methode && j.table === table).length)) {
      return reponse({ error: "panne simulee" }, false, 500);
    }

    if (methode === "GET" && id) {
      const rec = db[table].find((r) => r.id === id);
      return rec ? reponse(rec) : reponse({ error: "introuvable" }, false, 404);
    }
    if (methode === "GET") {
      let recs = filtrer(db[table], u.searchParams.get("filterByFormula") || "");
      if (u.searchParams.get("sort[0][field]") === "Date") recs = [...recs].sort((a, b) => String(a.fields.Date).localeCompare(String(b.fields.Date)));
      const max = Number(u.searchParams.get("maxRecords")) || Infinity;
      const taille = Math.min(Number(u.searchParams.get("pageSize")) || 100, 100);
      const debut = Number(u.searchParams.get("offset")) || 0;
      const page = recs.slice(debut, Math.min(debut + taille, max));
      const suite = debut + taille < Math.min(recs.length, max) ? { offset: String(debut + taille) } : {};
      return reponse({ records: page, ...suite });
    }
    if (methode === "POST") {
      const corps = JSON.parse(init.body);
      if (corps.records.length > 10) return reponse({ error: "10 enregistrements maximum" }, false, 422);
      const crees = corps.records.map((r) => {
        const rec = { id: "rec" + String(++compteur).padStart(14, "0"), fields: { ...r.fields } };
        db[table].push(rec);
        return rec;
      });
      return reponse({ records: crees });
    }
    if (methode === "PATCH") {
      const rec = db[table].find((r) => r.id === id);
      if (!rec) return reponse({ error: "introuvable" }, false, 404);
      Object.assign(rec.fields, JSON.parse(init.body).fields);
      return reponse(rec);
    }
    if (methode === "DELETE") {
      const ids = u.searchParams.getAll("records[]");
      if (ids.length > 10) return reponse({ error: "10 enregistrements maximum" }, false, 422);
      db[table] = db[table].filter((r) => !ids.includes(r.id));
      return reponse({ records: ids.map((i) => ({ id: i, deleted: true })) });
    }
    return reponse({ error: "methode non geree" }, false, 400);
  }
  faux.journal = journal;
  return faux;
}
