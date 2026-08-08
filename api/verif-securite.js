// api/verif-securite.js
// Verifications de securite et de bon fonctionnement du poste de pilotage
// et de la plateforme Iko Suite. Deux modes d'appel :
//  - Manuel : POST depuis admin.html (bouton "Lancer maintenant"), execute
//    toujours immediatement.
//  - Automatique : GET declenche par le cron Vercel (voir vercel.json,
//    toutes les heures). Ne fait le vrai travail que si l'heure/jour
//    programmes par Stephane (record CONFIG, table Planning) correspondent
//    a l'heure actuelle - sinon repond immediatement sans rien faire.
//
// Le rapport est toujours ecrit sur le record CONFIG (champ "Verif Dernier
// Rapport") pour que admin.html puisse l'afficher au prochain chargement.

const AIRTABLE_BASE = "appkI8RKHkYNWY86U";
const CONFIG_RECORD_ID = "rec45X231n9dXnyaU";
const CLIENTS_TABLE = "Clients";
const PLANNING_TABLE = "Planning";

function airtableHeaders() {
  return {
    Authorization: "Bearer " + process.env.AIRTABLE_TOKEN,
    "Content-Type": "application/json",
  };
}

async function lireConfig() {
  const r = await fetch(
    "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + encodeURIComponent(PLANNING_TABLE) + "/" + CONFIG_RECORD_ID,
    { headers: airtableHeaders() }
  );
  if (!r.ok) return null;
  const json = await r.json();
  return json.fields || {};
}

async function ecrireRapport(texte) {
  try {
    await fetch(
      "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + encodeURIComponent(PLANNING_TABLE) + "/" + CONFIG_RECORD_ID,
      {
        method: "PATCH",
        headers: airtableHeaders(),
        body: JSON.stringify({
          fields: {
            "Verif Dernier Rapport": texte,
            "Verif Derniere Exec": new Date().toISOString(),
          },
        }),
      }
    );
  } catch (e) {
    console.error("Ecriture rapport verif echouee:", e);
  }
}

// Determine si l'heure actuelle (UTC) correspond a la programmation.
function estLeMomentProgramme(config) {
  if (!config || !config["Verif Active"]) return false;
  const heureProg = String(config["Verif Heure"] || "").trim(); // "HH:MM"
  if (!/^\d{1,2}:\d{2}$/.test(heureProg)) return false;
  const maintenant = new Date();
  const heureActuelle = String(maintenant.getUTCHours()).padStart(2, "0") + ":00";
  const [hProg] = heureProg.split(":");
  const heureProgArrondie = String(parseInt(hProg, 10)).padStart(2, "0") + ":00";
  if (heureActuelle !== heureProgArrondie) return false;

  if (config["Verif Frequence"] === "Hebdomadaire") {
    const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
    const jourActuel = JOURS[maintenant.getUTCDay()];
    if (config["Verif Jour"] && config["Verif Jour"] !== jourActuel) return false;
  }

  // Anti double-declenchement : si deja execute cette heure-ci, on saute.
  const derniere = config["Verif Derniere Exec"];
  if (derniere) {
    const d = new Date(derniere);
    if (!isNaN(d.getTime()) && d.getUTCFullYear() === maintenant.getUTCFullYear() &&
        d.getUTCMonth() === maintenant.getUTCMonth() && d.getUTCDate() === maintenant.getUTCDate() &&
        d.getUTCHours() === maintenant.getUTCHours()) {
      return false;
    }
  }
  return true;
}

async function executerVerifications() {
  const resultats = [];
  const ajouter = (ok, libelle, detail) => resultats.push({ ok, libelle, detail: detail || "" });

  // 1. Variables d'environnement critiques
  ajouter(!!process.env.ANTHROPIC_API_KEY, "Cle API Anthropic configuree");
  ajouter(!!process.env.AIRTABLE_TOKEN, "Token Airtable configure");

  // 2. Connexion Airtable + comptage clients
  try {
    const r = await fetch(
      "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + encodeURIComponent(CLIENTS_TABLE) + "?maxRecords=100",
      { headers: airtableHeaders() }
    );
    if (r.ok) {
      const json = await r.json();
      const clients = json.records || [];
      const actifs = clients.filter((c) => c.fields && c.fields["Statut client"] === "Actif").length;
      ajouter(true, "Connexion Airtable OK", clients.length + " client(s), " + actifs + " actif(s)");

      // 3. Coherence des fiches client : slug, metier et modules renseignes
      const incomplets = clients.filter((c) => {
        const f = c.fields || {};
        return !f["Slug"] || !f["Métier"] || !(f["Modules actifs"] || []).length;
      });
      ajouter(
        incomplets.length === 0,
        "Fiches clients completes",
        incomplets.length ? incomplets.length + " fiche(s) incomplete(s) (slug/metier/modules manquant)" : "Toutes les fiches sont completes"
      );
    } else {
      ajouter(false, "Connexion Airtable OK", "HTTP " + r.status);
    }
  } catch (e) {
    ajouter(false, "Connexion Airtable OK", String(e));
  }

  // 4. Config generale (mode concepteur) lisible
  try {
    const cfg = await lireConfig();
    ajouter(!!cfg, "Configuration generale lisible");
  } catch (e) {
    ajouter(false, "Configuration generale lisible", String(e));
  }

  const dateStr = new Date().toLocaleString("fr-FR", { timeZone: "UTC" }) + " UTC";
  const echecs = resultats.filter((r) => !r.ok);
  const entete = "Verification du " + dateStr + " — " + (echecs.length ? echecs.length + " probleme(s) detecte(s)" : "tout est OK");
  const corps = resultats.map((r) => (r.ok ? "OK" : "ECHEC") + " — " + r.libelle + (r.detail ? " (" + r.detail + ")" : "")).join("\n");
  const texte = entete + "\n\n" + corps;

  await ecrireRapport(texte);
  return { resultats, texte, aDesEchecs: echecs.length > 0 };
}

export default async function handler(req, res) {
  try {
    if (req.method === "POST") {
      // Declenchement manuel (depuis admin.html) : toujours execute.
      const rapport = await executerVerifications();
      return res.status(200).json(rapport);
    }

    if (req.method === "GET") {
      // Declenchement automatique (cron Vercel) : verifie d'abord si c'est
      // le bon moment programme par Stephane.
      const config = await lireConfig();
      if (!estLeMomentProgramme(config)) {
        return res.status(200).json({ execute: false, raison: "hors programmation" });
      }
      const rapport = await executerVerifications();
      return res.status(200).json(Object.assign({ execute: true }, rapport));
    }

    return res.status(405).json({ erreur: "Methode non autorisee" });
  } catch (e) {
    console.error("Erreur verif-securite:", e);
    return res.status(500).json({ erreur: "Une erreur est survenue." });
  }
}
