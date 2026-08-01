// ============================================================
// STEF — Assistant 3D Falliero pour la page SAV
// Usage : <script type="module" src="stef-widget.js"></script>
// Requiert : stef.glb à la racine du site
// ============================================================

// Cause identifiee (voir echanges) : sur Android, l'echec de Stef vient le
// plus souvent du mode economie de batterie qui coupe l'acceleration
// graphique (GPU) du navigateur -> WebGL indisponible. Ce n'est pas un bug
// de code, donc pas d'alerte visible pour les vrais clients : on se
// contente de logger dans la console (utile en debug via un PC connecte),
// et le reste du module SAV (chat, formulaire) continue de fonctionner
// normalement sans Stef dans ce cas.
function stefDebugBadge(msg) {
  console.warn('Stef debug : ' + msg);
}

let THREE, GLTFLoader;
try {
  if (!document.querySelector('script[type="importmap"]')) {
    const map = document.createElement('script');
    map.type = 'importmap';
    map.textContent = JSON.stringify({
      imports: {
        'three': 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
        'three/addons/': 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/'
      }
    });
    document.head.appendChild(map);
  }

  THREE = await import('three');
  ({ GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'));
} catch (e) {
  stefDebugBadge('echec chargement Three.js (' + (e && e.message ? e.message : e) + ')');
  throw e;
}

(function () {
  'use strict';

  const NAVY = '#16233F', YELLOW = '#E5B531';
  const IS_MOBILE = window.matchMedia('(max-width: 760px)').matches;
  // Sur Android (contrairement a iPhone/iPad), le personnage en pleine
  // largeur/hauteur venait recouvrir le titre et le texte de la page
  // d'accueil. On le reduit et on le cale a droite UNIQUEMENT sur Android ;
  // PC, tablette et iPhone gardent le rendu actuel (deja correct).
  const IS_ANDROID = /Android/i.test(navigator.userAgent);

  const box = document.createElement('div');
  box.id = 'stef-box';
  const bubble = document.createElement('div');
  bubble.id = 'stef-bubble';
  bubble.innerHTML =
    '<div id="stef-bubble-text"></div>' +
    '<button id="stef-cta">Commencer ma demande SAV</button>';

  const muteBtn = document.createElement('button');
  muteBtn.id = 'stef-mute';
  muteBtn.type = 'button';
  muteBtn.textContent = '🔊';
  muteBtn.setAttribute('aria-label', 'Couper la voix de Stef');

  document.documentElement.appendChild(box);
  document.documentElement.appendChild(bubble);
  document.documentElement.appendChild(muteBtn);

  const style = document.createElement('style');
  style.textContent = `
    #stef-box {
      position: fixed !important; z-index: 999990 !important; pointer-events: none;
      margin: 0 !important;
      opacity: 0; transition: opacity .8s ease, all .7s cubic-bezier(.4,0,.2,1);
      top: auto; left: auto; right: 0; bottom: 0;
      width: ${IS_MOBILE ? '100vw' : '46vw'};
      height: ${IS_MOBILE ? '58vh' : '92vh'};
      height: ${IS_MOBILE ? '58dvh' : '92dvh'};
      /* IMPORTANT (Android) : combiner translate()+scale() dans un meme
         transform casse le rendu du canvas WebGL sur certains
         telephones/GPU Android (carre blanc a la place du personnage). On
         se limite donc a UN SEUL scale(), et on joue uniquement sur
         transform-origin (point au-dela du coin haut-droit de la boite)
         pour decaler visuellement le personnage plus haut et plus a droite
         en meme temps qu'il retrecit. */
      /* origin-x reste a 100% (bord de l'ecran) : la boite occupe deja toute
         la largeur (100vw), donc un origin-x > 100% poussait carrement le
         personnage hors ecran (invisible). Seul origin-y remonte (100% ->
         80%) pour decaler le rendu vers le haut, sans risque de sortie
         d'ecran. Le decalage "vers la droite" se fait via la position du
         modele 3D lui-meme (voir arriveX plus bas), pas via ce transform. */
      ${IS_MOBILE && IS_ANDROID ? 'transform: scale(0.62); transform-origin: 100% 80%;' : ''}
    }
    #stef-box.visible { opacity: 1; }
    #stef-box.mini {
      width: 120px; height: 120px;
      left: 18px; right: auto; bottom: 18px;
      border-radius: 50%; overflow: hidden;
      background: radial-gradient(circle at 50% 30%, #FFFFFF, #F2F2F2);
      border: 3px solid ${YELLOW};
      box-shadow: 0 6px 24px rgba(0,0,0,.45);
      pointer-events: auto; cursor: pointer;
      transform: none;
    }
    #stef-box canvas { width: 100% !important; height: 100% !important; display: block; }
    #stef-bubble {
      position: fixed !important; z-index: 999991 !important;
      ${IS_MOBILE
        ? 'left: 16px; right: 16px; top: 14px;'
        : 'right: 34vw; bottom: 46vh; max-width: 320px;'}
      background: #fff; color: ${NAVY};
      border-radius: 16px; border-bottom-right-radius: 4px;
      padding: 16px 18px; font-family: 'Segoe UI', sans-serif;
      font-size: 14.5px; line-height: 1.55;
      box-shadow: 0 10px 34px rgba(0,0,0,.35);
      opacity: 0; transform: translateY(12px);
      transition: opacity .5s ease .2s, transform .5s ease .2s;
      pointer-events: auto;
    }
    #stef-bubble.visible { opacity: 1; transform: translateY(0); }
    #stef-bubble.hidden { opacity: 0; pointer-events: none; transform: translateY(12px); }
    #stef-bubble::after {
      content: ''; position: absolute; bottom: -9px; right: 26px;
      border: 10px solid transparent; border-top-color: #fff;
      border-bottom: none; border-right: none;
    }
    #stef-cta {
      margin-top: 12px; width: 100%;
      background: ${YELLOW}; color: ${NAVY};
      border: none; border-radius: 10px;
      padding: 11px 14px; font-weight: 700; font-size: 14px;
      font-family: 'Segoe UI', sans-serif; cursor: pointer;
      transition: transform .15s ease, box-shadow .15s ease;
    }
    #stef-cta:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(229,181,49,.4); }
    #stef-mute {
      position: fixed !important; z-index: 999992 !important;
      width: 30px; height: 30px; border-radius: 50%;
      background: ${NAVY}; color: #fff; border: 2px solid ${YELLOW};
      font-size: 14px; line-height: 1; display: none;
      align-items: center; justify-content: center;
      cursor: pointer; padding: 0; margin: 0;
      box-shadow: 0 3px 10px rgba(0,0,0,.35);
      transition: transform .15s ease;
    }
    #stef-mute.visible { display: flex; }
    #stef-mute:hover { transform: scale(1.08); }
    @media (prefers-reduced-motion: reduce) {
      #stef-box, #stef-bubble { transition: none; }
    }
  `;
  document.head.appendChild(style);

  // Certains telephones Android (mode economie de batterie, materiel bas de
  // gamme, ou navigateur avec l'acceleration materielle desactivee) n'ont
  // pas de WebGL disponible : la creation du renderer levait alors une
  // exception non rattrapee qui coupait TOUT le script en silence (aucun
  // personnage, MAIS AUSSI aucun son puisque le code de la voix est defini
  // plus bas dans le meme script et n'etait donc jamais atteint). On isole
  // desormais l'echec du renderer pour degrader proprement : sans WebGL,
  // Stef n'a plus de corps 3D, mais garde sa voix (bulle de texte + parole),
  // qui ne depend pas du rendu graphique.
  let renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (e) {
    console.warn('Stef : WebGL indisponible, mode voix seule :', e);
    stefDebugBadge('WebGL indisponible (' + (e && e.message ? e.message : e) + ')');
    renderer = null;
  }

  let scene, camera;
  let mixer = null, actions = {}, current = null, model = null, modelH = 1, walkState = null;
  let idleBaseY = 0, idleBaseScaleY = 1;

  function sizeRenderer() {
    if (!renderer) return;
    const w = box.clientWidth || 300, h = box.clientHeight || 300;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function frameFull() {
    if (!camera) return;
    const dist = modelH / (2 * Math.tan((camera.fov * Math.PI / 180) / 2)) * 1.35;
    camera.position.set(0, modelH * 0.5, dist);
    camera.lookAt(0, modelH * 0.5, 0);
  }
  function frameBust() {
    if (!camera) return;
    const x = model ? model.position.x : 0;
    camera.position.set(x, modelH * 0.78, modelH * 0.72);
    camera.lookAt(x, modelH * 0.70, 0);
  }

  function play(name, { loop = true, fade = 0.35 } = {}) {
    const a = actions[name];
    if (!a || a === current) return;
    if (current) current.fadeOut(fade);
    a.reset().setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity).fadeIn(fade).play();
    a.clampWhenFinished = !loop;
    current = a;
  }

  let talkTimer = null;
  function talk(dur = 4000) {
    play('Stand_and_Chat', { fade: 0.7 });
    clearTimeout(talkTimer);
    talkTimer = setTimeout(() => play('Idle_3', { fade: 0.9 }), dur);
  }

  if (renderer) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    box.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);

    scene.add(new THREE.HemisphereLight(0xBFCBE8, 0x2A3348, 1.25));
    const key = new THREE.DirectionalLight(0xFFF2DC, 1.7);
    key.position.set(3, 6, 4);
    scene.add(key);
    const rim = new THREE.PointLight(0xE5B531, 10, 18);
    rim.position.set(-3, 3, -2.5);
    scene.add(rim);
  }

  const INTRO = "Bonjour, je suis Stef, votre conseiller SAV Falliero. Je suis là pour vous accompagner et vous guider.";
  function stripForSpeech(text) {
    return text
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, '')
      // "SAV" ne doit pas etre lu comme un mot ("save"). L'epellation
      // lettre par lettre ("S. A. V.") n'est pas fiable selon les
      // navigateurs/voix (certains moteurs ignorent les points et
      // recomposent le mot) : on prononce donc l'expression complete, ce
      // qui garantit une prononciation correcte partout. Le texte AFFICHE
      // a l'ecran garde "SAV" tel quel (seule la voix est concernee).
      .replace(/\bSAV\b/g, 'Service Après-Vente')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function typeIntro() {
    bubble.classList.add('visible');
    const el = bubble.querySelector('#stef-bubble-text');
    let i = 0;
    (function tick() {
      el.textContent = INTRO.slice(0, ++i);
      if (i < INTRO.length) setTimeout(tick, 22);
    })();
  }

  const MALE_VOICE_HINTS = ['thomas', 'daniel', 'paul', 'henri', 'guillaume', 'nicolas', 'yannick', 'fr-fr-x-frd', 'fr-fr-x-frc', 'male', 'homme'];
  const FEMALE_VOICE_HINTS = ['julie', 'amelie', 'audrey', 'celine', 'femme', 'female', 'marie', 'virginie', 'hortense'];
  function pickFrenchMaleVoice(voices) {
    const fr = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('fr'));
    if (!fr.length) return null;
    const byHint = fr.find((v) => MALE_VOICE_HINTS.some((h) => v.name.toLowerCase().includes(h)));
    if (byHint) return byHint;
    const notFemale = fr.find((v) => !FEMALE_VOICE_HINTS.some((h) => v.name.toLowerCase().includes(h)));
    return notFemale || fr[0];
  }

  // Les voix ne sont pas toujours disponibles immediatement au chargement
  // (surtout Android/Chrome : getVoices() peut renvoyer [] pendant plusieurs
  // secondes apres le chargement). On les met en cache des qu'elles sont
  // pretes, en tache de fond, independamment de tout geste utilisateur :
  // ainsi, au moment du clic sur "Entrer", on n'a PLUS besoin d'attendre
  // l'evenement "voiceschanged" (asynchrone) au milieu du geste : sur certains
  // navigateurs (surtout Android), cette attente asynchrone faisait sortir
  // l'appel speechSynthesis.speak() du contexte "geste utilisateur" et la
  // voix ne partait jamais.
  let cachedVoices = [];
  function refreshVoiceCache() {
    if (!('speechSynthesis' in window)) return;
    const v = speechSynthesis.getVoices();
    if (v && v.length) cachedVoices = v;
  }
  if ('speechSynthesis' in window) {
    refreshVoiceCache();
    speechSynthesis.addEventListener('voiceschanged', refreshVoiceCache);
  }

  let voicePrimed = false;
  function primeVoice() {
    if (voicePrimed || !('speechSynthesis' in window)) return;
    voicePrimed = true;
    try {
      const warm = new SpeechSynthesisUtterance('');
      warm.volume = 0;
      speechSynthesis.speak(warm);
    } catch (e) {}
  }

  // Coupe-son : un badge apparait autour du medaillon (mode mini) pour
  // permettre de couper/reactiver la voix de Stef. Preference memorisee
  // d'une visite a l'autre.
  let muted = false;
  try { muted = localStorage.getItem('stef-muted') === '1'; } catch (e) {}
  function updateMuteIcon() {
    muteBtn.textContent = muted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', muted ? 'Activer la voix de Stef' : 'Couper la voix de Stef');
  }
  updateMuteIcon();
  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    muted = !muted;
    try { localStorage.setItem('stef-muted', muted ? '1' : '0'); } catch (e) {}
    updateMuteIcon();
    if (muted && 'speechSynthesis' in window) speechSynthesis.cancel();
  });
  function positionMute() {
    if (!mini || !box.classList.contains('visible')) { muteBtn.classList.remove('visible'); return; }
    const r = box.getBoundingClientRect();
    if (!r.width) { muteBtn.classList.remove('visible'); return; }
    muteBtn.style.left = (r.right - 30 - 4) + 'px';
    muteBtn.style.top = (r.bottom - 30 - 4) + 'px';
    muteBtn.classList.add('visible');
  }
  // #stef-box a une transition CSS ("all .7s") sur sa position/taille : un
  // appel a positionMute() juste apres avoir declenche ce deplacement lit
  // une position pas encore a jour (animation en cours). On recale donc le
  // badge une fois la transition terminee, pour eviter qu'il reste "coince"
  // a une ancienne position (ex: apres ouverture du panneau de discussion).
  box.addEventListener('transitionend', (e) => {
    if (e.target === box && (e.propertyName === 'left' || e.propertyName === 'top' || e.propertyName === 'width' || e.propertyName === 'height')) {
      positionMute();
    }
  });

  function speak(text, onStart) {
    if (!('speechSynthesis' in window) || muted) return;
    const utter = new SpeechSynthesisUtterance(stripForSpeech(text));
    utter.lang = 'fr-FR';
    utter.rate = 0.97;
    utter.pitch = 0.85;
    utter.onstart = () => { if (onStart) onStart(); if (!(walkState && walkState.active)) play('Stand_and_Chat', { fade: 0.7 }); };
    utter.onend = () => { if (!(walkState && walkState.active)) play('Idle_3', { fade: 0.9 }); };
    utter.onerror = () => { if (!(walkState && walkState.active)) play('Idle_3', { fade: 0.9 }); };
    // Synchrone : pas d'attente async ici, on utilise le cache deja pret
    // (ou la voix par defaut du navigateur si le cache n'a pas encore ete
    // rempli), pour rester dans la meme pile d'appel que le geste utilisateur.
    const voices = cachedVoices.length ? cachedVoices : (('speechSynthesis' in window) ? speechSynthesis.getVoices() : []);
    const fr = pickFrenchMaleVoice(voices);
    if (fr) utter.voice = fr;
    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
  }

  const rsiaPanel = document.getElementById('rsia-widget-panel');
  function positionMini() {
    if (!mini) return;
    const open = !!rsiaPanel && rsiaPanel.getBoundingClientRect().width > 0 && getComputedStyle(rsiaPanel).display !== 'none';
    if (!open) {
      box.classList.remove('visible');
      box.style.pointerEvents = 'none';
      return;
    }
    box.classList.add('visible');
    box.style.pointerEvents = 'auto';
    if (IS_MOBILE || !rsiaPanel) { box.style.left = ''; box.style.top = ''; box.style.right = ''; box.style.bottom = ''; return; }
    const r = rsiaPanel.getBoundingClientRect();
    const size = 120, gap = 16;
    let left = r.left - size - gap;
    let top = r.top;
    if (left < 8) {
      left = Math.max(8, Math.min(r.left, window.innerWidth - size - 8));
      top = r.top - size - gap;
    }
    top = Math.max(8, Math.min(top, window.innerHeight - size - 8));
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    box.style.right = 'auto';
    box.style.bottom = 'auto';
  }
  if (rsiaPanel && 'MutationObserver' in window) {
    new MutationObserver(() => { positionMini(); positionMute(); }).observe(rsiaPanel, { attributes: true, attributeFilter: ['class', 'style'] });
  }

  let mini = false;
  function minimize() {
    if (mini || !model) return;
    mini = true;
    bubble.classList.add('hidden');
    box.classList.add('mini');
    setTimeout(() => { sizeRenderer(); frameBust(); play('Idle_3'); positionMini(); positionMute(); }, 720);
  }

  box.addEventListener('click', () => { if (mini) talk(3000); });

  bubble.querySelector('#stef-cta').addEventListener('click', () => {
    if (typeof window.toggleWidget === 'function') window.toggleWidget();
    else minimize();
  });

  // "mini" (medaillon 3D reduit) ne devient jamais vrai sans WebGL/modele,
  // puisque minimize() l'exige. La lecture a voix haute des questions du
  // formulaire ne doit pourtant pas en dependre : on utilise ce flag
  // separe, mis a jour des l'ouverture du panneau SAV, que Stef ait un
  // corps 3D ou non.
  let hasOpenedPanel = false;
  const origToggle = window.toggleWidget;
  if (typeof origToggle === 'function') {
    window.toggleWidget = function () {
      origToggle.apply(this, arguments);
      hasOpenedPanel = true;
      minimize();
      setTimeout(positionMini, 50);
    };
  }
  const root = document.getElementById('root');
  let lastSpokenQuestion = '';
  let questionDebounce = null;
  // Certains labels bruts du formulaire ne se lisent pas naturellement a voix
  // haute tels quels (ex: un simple titre de section) : on les remplace par une
  // phrase parlee plus naturelle, sans toucher au texte affiche a l'ecran.
  const SPOKEN_OVERRIDES = {
    'Photos ou documents (facultatif)': "Merci de joindre une photo, ou passez cette etape si vous n'en avez pas.",
  };
  function findCurrentQuestionText() {
    const nodes = document.querySelectorAll('div');
    for (let i = nodes.length - 1; i >= 0; i--) {
      const el = nodes[i];
      const st = el.style;
      if (!st) continue;
      const isBubble = st.borderRadius === '16px 16px 16px 4px';
      const isLabel = st.borderLeft && st.borderLeft.indexOf('218, 178, 57') !== -1;
      if (isBubble || isLabel) {
        const t = el.textContent.replace(/\s+/g, ' ').trim();
        if (t && t.length > 1 && t.length < 220) return t;
      }
    }
    return null;
  }
  if (root && 'MutationObserver' in window) {
    new MutationObserver(() => {
      if (!hasOpenedPanel) return;
      clearTimeout(questionDebounce);
      questionDebounce = setTimeout(() => {
        const q = findCurrentQuestionText();
        if (q && q !== lastSpokenQuestion) {
          lastSpokenQuestion = q;
          speak(SPOKEN_OVERRIDES[q] || q);
        }
      }, 200);
    }).observe(root, { childList: true, subtree: true });
  }

  let sceneReady = false;
  let pendingEntrance = false;
  let entranceStarted = false;
  // La voix et la bulle de texte ne doivent plus attendre le chargement
  // du modele 3D (fichier de ~10 Mo, souvent 1-2s meme en bonne connexion) :
  // on les declenche des l'appui sur "Entrer", independamment de l'etat du
  // chargement. La marche du personnage, elle, reste liee a l'arrivee du
  // modele puisqu'elle a besoin du modele pour exister. Le flag
  // "voiceStarted" garantit qu'on ne parle qu'une seule fois, meme si
  // requestEntrance() et startEntrance() sont tous les deux appeles.
  let voiceStarted = false;
  function triggerVoiceAndBubble() {
    if (voiceStarted) return;
    voiceStarted = true;
    typeIntro();
    primeVoice();
    speak(INTRO);
  }
  function startEntrance() {
    if (!sceneReady || entranceStarted || !model) return;
    entranceStarted = true;

    box.classList.add('visible');

    const arriveX = model.position.x + (IS_MOBILE ? (IS_ANDROID ? modelH * 0.08 : -modelH * 0.12) : modelH * 0.06);
    const arriveZ = model.position.z;
    const startZ = arriveZ - modelH * 2.2;
    const WALK_SPEED = 1.25;

    const walkClip = actions['Walking'];
    const cycleSec = walkClip ? walkClip.getClip().duration : 0.8;
    const rawSec = Math.abs(startZ - arriveZ) / WALK_SPEED;
    const cycles = Math.min(4, Math.max(1, Math.round(rawSec / cycleSec)));
    const duration = cycles * cycleSec * 1000;

    model.position.x = arriveX;
    model.position.z = startZ;
    if (walkClip) {
      walkClip.reset().setLoop(THREE.LoopRepeat, Infinity).play();
      current = walkClip;
    }
    walkState = { active: true, from: startZ, to: arriveZ, start: performance.now(), duration };
    triggerVoiceAndBubble();
  }
  // Repli "voix seule" quand WebGL n'est pas disponible (ex: economie de
  // batterie Android) : pas de corps 3D ni de marche, mais la bulle de
  // texte et la voix de Stef restent fonctionnelles.
  function startVoiceOnlyEntrance() {
    triggerVoiceAndBubble();
  }
  function requestEntrance() {
    pendingEntrance = true;
    // Voix + bulle immediatement, sans attendre le modele 3D.
    triggerVoiceAndBubble();
    if (renderer) startEntrance();
  }

  if (renderer) {
  // Filet de securite : si le modele (10 Mo) ne finit ni par charger ni par
  // echouer clairement (reseau mobile capricieux, requete qui reste
  // "pending" indefiniment), on le signale au bout de 20s au lieu de
  // laisser un ecran vide sans aucune explication.
  setTimeout(() => {
    if (!sceneReady) stefDebugBadge('chargement du modele 3D trop long / bloque (reseau ?)');
  }, 20000);

  new GLTFLoader().load(
    './stef_v2.glb', // TEST nouveau personnage - a remettre './stef.glb' si on ne garde pas
    (gltf) => {
      model = gltf.scene;
      const bb = new THREE.Box3().setFromObject(model);
      const size = bb.getSize(new THREE.Vector3());
      const scale = 2.0 / size.y;
      model.scale.setScalar(scale);
      bb.setFromObject(model);
      const c = bb.getCenter(new THREE.Vector3());
      model.position.set(-c.x, -bb.min.y, -c.z);
      modelH = 2.0;
      scene.add(model);

      mixer = new THREE.AnimationMixer(model);
      gltf.animations.forEach((clip) => { actions[clip.name] = mixer.clipAction(clip); });

      function stripHorizontalDrift(action) {
        if (!action) return;
        action.getClip().tracks.forEach((track) => {
          if (/\.position$/.test(track.name) && track.values && track.values.length >= 3) {
            const x0 = track.values[0], z0 = track.values[2];
            for (let i = 0; i < track.values.length; i += 3) {
              track.values[i] = x0;
              track.values[i + 2] = z0;
            }
          }
        });
      }
      ['Walking', 'Idle_3', 'Stand_and_Chat'].forEach((n) => stripHorizontalDrift(actions[n]));

      function matchRestOrientation(fromAction, toAction, boneNames, factor = 1) {
        if (!fromAction || !toAction) return;
        const fromClip = fromAction.getClip(), toClip = toAction.getClip();
        boneNames.forEach((bone) => {
          const tFrom = fromClip.tracks.find((t) => t.name === bone + '.quaternion');
          const tTo = toClip.tracks.find((t) => t.name === bone + '.quaternion');
          if (!tFrom || !tTo) return;
          const qFrom0 = new THREE.Quaternion(tFrom.values[0], tFrom.values[1], tFrom.values[2], tFrom.values[3]);
          const qTo0 = new THREE.Quaternion(tTo.values[0], tTo.values[1], tTo.values[2], tTo.values[3]);
          const fullDelta = qTo0.clone().multiply(qFrom0.clone().invert());
          const delta = new THREE.Quaternion().slerp(fullDelta, factor);
          const q = new THREE.Quaternion();
          for (let i = 0; i < tFrom.values.length; i += 4) {
            q.set(tFrom.values[i], tFrom.values[i + 1], tFrom.values[i + 2], tFrom.values[i + 3]);
            q.premultiply(delta);
            tFrom.values[i] = q.x; tFrom.values[i + 1] = q.y; tFrom.values[i + 2] = q.z; tFrom.values[i + 3] = q.w;
          }
        });
      }
      // "Stand_and_Chat" (l'animation jouee pendant que Stef parle en mode
      // medaillon) a ete capturee avec un bassin ("Hips") place et oriente
      // tres differemment d'"Idle_3" (la pose de repos). Sans correction, le
      // personnage "saute"/se decale brutalement hors du cercle des que la
      // voix demarre. On recale donc sa translation ET son orientation de
      // base sur celles d'Idle_3, en conservant le mouvement relatif
      // (respiration, petits gestes) de l'animation.
      function rebaseHipsTranslation(action, referenceAction) {
        if (!action || !referenceAction) return;
        const track = action.getClip().tracks.find((t) => t.name === 'Hips.position');
        const refTrack = referenceAction.getClip().tracks.find((t) => t.name === 'Hips.position');
        if (!track || !refTrack || track.values.length < 3 || refTrack.values.length < 3) return;
        const dx = refTrack.values[0] - track.values[0];
        const dy = refTrack.values[1] - track.values[1];
        const dz = refTrack.values[2] - track.values[2];
        for (let i = 0; i < track.values.length; i += 3) {
          track.values[i] += dx;
          track.values[i + 1] += dy;
          track.values[i + 2] += dz;
        }
      }
      rebaseHipsTranslation(actions['Stand_and_Chat'], actions['Idle_3']);

      matchRestOrientation(
        actions['Idle_3'], actions['Walking'],
        ['LeftShoulder', 'RightShoulder', 'LeftArm', 'RightArm'],
        0.55
      );
      matchRestOrientation(actions['Stand_and_Chat'], actions['Idle_3'], ['Hips'], 1);

      const startClip = actions['Idle_3'] || actions[Object.keys(actions)[0]];
      if (startClip) { startClip.play(); mixer.update(0.001); startClip.stop(); }

      const bb2 = new THREE.Box3().setFromObject(model);
      const size2 = bb2.getSize(new THREE.Vector3());
      const rescale = (2.0 / size2.y) / (2.0 / size.y);
      model.scale.multiplyScalar(rescale);
      const bb3 = new THREE.Box3().setFromObject(model);
      const c3 = bb3.getCenter(new THREE.Vector3());
      model.position.z -= c3.z - c.z;
      model.position.y -= bb3.min.y;
      idleBaseY = model.position.y;
      idleBaseScaleY = model.scale.y;

      sizeRenderer();
      frameFull();

      sceneReady = true;
      if (pendingEntrance) startEntrance();
    },
    undefined,
    (err) => {
      // WebGL fonctionne mais le modele 3D lui-meme n'a pas pu charger
      // (reseau, fichier indisponible...) : on bascule en voix seule au
      // lieu de tout supprimer, la bulle de texte et la voix n'ayant pas
      // besoin du modele.
      console.warn('Stef indisponible (chargement du modele 3D) :', err);
      stefDebugBadge('echec chargement du modele 3D (' + (err && err.message ? err.message : err) + ')');
      box.remove();
      if (pendingEntrance) startVoiceOnlyEntrance();
    }
  );

  const clock = new THREE.Clock();
  (function loop() {
    requestAnimationFrame(loop);
    const dt = clock.getDelta();
    if (mixer) mixer.update(dt);

    if (walkState && walkState.active) {
      const t = Math.min((performance.now() - walkState.start) / walkState.duration, 1);
      model.position.z = walkState.from + (walkState.to - walkState.from) * t;
      if (t >= 1) {
        walkState.active = false;
        const stillTalking = ('speechSynthesis' in window) && speechSynthesis.speaking;
        // Coupure courte (au lieu d'1.1s) : un fondu long laissait le cycle de
        // marche continuer a jouer alors que le personnage etait deja arrete,
        // ce qui donnait l'impression qu'il marchait sur place a l'arrivee.
        play(stillTalking ? 'Stand_and_Chat' : 'Idle_3', { fade: 0.3 });
      }
    } else if (model && !mini && !current) {
      const breathe = Math.sin(clock.elapsedTime * 1.3);
      model.position.y = idleBaseY + breathe * modelH * 0.004;
      model.scale.y = idleBaseScaleY * (1 + breathe * 0.006);
    }

    renderer.render(scene, camera);
  })();
  } // fin du bloc "if (renderer)" : tout ce qui precede (scene, GLTFLoader,
    // boucle de rendu) ne s'execute que si WebGL a pu demarrer.

  window.addEventListener('resize', () => { sizeRenderer(); mini ? frameBust() : frameFull(); positionMini(); positionMute(); });

  window.Stef = { talk, minimize, play, enter: requestEntrance };
})();
