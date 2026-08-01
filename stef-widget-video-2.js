// ============================================================
// STEF — Assistant Falliero pour la page SAV — VARIANTE TEST VIDEO 2
// Usage : <script type="module" src="stef-widget-video-2.js"></script>
//
// Difference avec le test video 1 (stef-widget-video.js) : ici la voix
// de l'intro est directement la bande son de la video (PixVerse, lip
// sync), et non plus une voix de synthese (speechSynthesis). Plus aucun
// probleme de synchro possible pour l'intro : l'image et le son viennent
// du meme fichier, lus ensemble nativement par le navigateur.
//
// La lecture a voix haute des QUESTIONS DU FORMULAIRE (texte dynamique,
// non present dans la video) reste en synthese vocale — impossible de
// faire autrement puisque ce texte n'existe pas dans la video.
//
// Video source (fond vert) pre-traitee hors-ligne avec ffmpeg, comme pour
// le test 1 : detouree + incrustee sur le fond dore de la marque.
//
// Fichier separe expres : stef-widget.js, stef-widget-video.js et
// index.html ne sont pas touches. Pour revenir en arriere, ne pas
// utiliser ce fichier (ou supprimer index-test2.html).
// ============================================================

const VIDEO_SRC = './stef-test2-keyed.mp4?v=3';
// Format vertical (480x1024, ~9:19) contrairement au test 1 (16:9).
const VIDEO_ASPECT = '480 / 1024';
// Dans le medaillon, on ne rejoue pas la video entiere (elle a son propre
// texte/timing, qui ne correspond plus une fois qu'on lit les questions du
// formulaire a voix haute) : on boucle juste sur ce segment, ou la bouche
// bouge naturellement, pour donner une animation "il parle" generique.
// IMPORTANT : ce segment doit correspondre a un plan CAMERA FIXE (portrait
// rapproche), pas au debut de la video ou le personnage marche (la tete
// bouge alors de haut en bas a chaque pas, ce qui rend n'importe quel
// recadrage fixe "pas centre" une fois sur deux). Verifie image par image :
// la camera est fixe sur le visage entre 3.8s et 6.2s (avant, il marche ;
// apres 6.3s il leve la main vers la camera).
const MINI_LOOP_START = 3.8;
const MINI_LOOP_END = 6.2;

function stefDebugBadge(msg) {
  console.warn('Stef (video2) debug : ' + msg);
}

(function () {
  'use strict';

  const NAVY = '#16233F', YELLOW = '#E5B531';
  const IS_MOBILE = window.matchMedia('(max-width: 760px)').matches;

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
      /* Position geree en JS (positionBox), calee sur la rangee de boutons
         du bas ("Suivi de ma demande" / "Demande SAV") : top/left ci-dessous
         ne sont que des valeurs de secours avant le premier calcul. */
      top: 50%; left: ${IS_MOBILE ? '50%' : '72%'}; right: auto; bottom: auto;
      transform: translate(-50%, -50%);
      ${IS_MOBILE ? `
      height: 28vh;
      width: auto;
      max-width: 48vw;
      ` : `
      /* Largeur alignee sur celle des deux boutons du bas, encore reduite
         par rapport a l'essai precedent (36vw/380px). */
      width: 29vw;
      max-width: 320px;
      height: auto;
      max-height: 66vh;
      `}
      aspect-ratio: ${VIDEO_ASPECT};
    }
    /* Tablette (iPad, etc.) : ni IS_MOBILE (>760px de large la plupart du
       temps, portrait ET paysage) ni vraiment "desktop" (bien moins de
       hauteur disponible qu'un ecran d'ordinateur). Le calcul base sur la
       largeur (29vw) donnait donc une boite bien trop haute (jusqu'a
       ~500px), qui deborde tres haut au-dessus des boutons. Sur cette
       plage de largeur, on repasse en calcul base sur la hauteur (comme
       IS_MOBILE), en vraie media query CSS pour rester juste aussi en
       cas de rotation d'ecran. Plafond remonte a 1366px pour couvrir le
       paysage des iPad Pro 11" (1194px) et 12.9" (1366px), pas seulement
       les iPad standard/Air (jusqu'a ~1180px). */
    @media (min-width: 761px) and (max-width: 1366px) {
      #stef-box:not(.mini) {
        width: auto !important;
        height: 48vh !important;
        max-width: 68vw !important;
        max-height: none !important;
      }
    }
    #stef-box.visible { opacity: 1; }
    #stef-box.mini {
      width: 120px; height: 120px; aspect-ratio: auto;
      left: 18px; right: auto; top: auto; bottom: 18px;
      transform: none;
      border-radius: 50%; overflow: hidden;
      /* Fond or (et non blanc) : si un pixel de bord echappe au recadrage
         video (arrondi/anti-aliasing du cercle), il doit se fondre dans le
         meme or que l'arriere-plan incruste dans la video, pas ressortir
         en blanc. */
      background: #DAB239;
      border: 3px solid ${YELLOW};
      box-shadow: 0 6px 24px rgba(0,0,0,.45);
      pointer-events: auto; cursor: pointer;
    }
    #stef-box:not(.mini) {
      border-radius: 18px;
      border: 7px solid ${NAVY};
      box-shadow: 0 12px 34px rgba(0,0,0,.28);
    }
    #stef-box video {
      width: 100% !important; height: 100% !important;
      display: block; object-fit: cover; object-position: center center;
      border-radius: inherit;
    }
    /* Dans le medaillon : tete + epaules, mesure sur le plan fixe 3.8s-6.2s
       (voir MINI_LOOP_START/END plus haut). Recadrage : largeur pleine
       (480px, aucun decalage horizontal) x 720px de haut a partir de y=10
       dans les 480x1024 d'origine (au lieu de 480x480 avant, qui ne
       montrait que le visage) -> on voit maintenant le col/les epaules.
       Largeur et hauteur n'ont plus le meme facteur d'echelle (480 vs 720
       sources pour un medaillon carre 120x120) : leger ecrasement vertical
       assume, verifie visuellement, bien moins genant que de ne pas voir
       les epaules du tout. */
    #stef-box.mini video {
      position: absolute !important;
      width: 100% !important; height: 142.2% !important;
      left: 0%; top: -1.4%;
      object-fit: fill;
      object-position: initial;
      transform: none;
    }
    /* Reflet cuit dans la video source (oreille gauche) : tente au prealable
       de le masquer avec un fondu dore (#stef-ear-patch), mais a la vraie
       taille du medaillon (120px) ce fondu ressort lui-meme comme un halo
       disgracieux sur le visage (pire que le petit reflet d'origine, a
       peine visible a cette taille). Retire : on laisse la video telle
       quelle dans le medaillon. */
    #stef-ear-patch { display: none; }
    #stef-bubble {
      position: fixed !important; z-index: 999991 !important;
      ${IS_MOBILE
        ? 'left: 16px; right: 16px; top: 14px;'
        : 'max-width: 320px;'}
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

  let muted = false;
  try { muted = localStorage.getItem('stef-muted') === '1'; } catch (e) {}

  const video = document.createElement('video');
  video.id = 'stef-video';
  video.src = VIDEO_SRC;
  video.muted = muted; // la video a un vrai son : on respecte la preference muet memorisee
  video.loop = false; // une seule lecture, pas de boucle
  video.playsInline = true;
  video.autoplay = false;
  video.preload = 'auto';
  box.appendChild(video);

  // Cf. commentaire CSS #stef-ear-patch plus haut : masque doux du reflet
  // d'oreille, actif uniquement dans le medaillon (voir CSS .mini).
  const earPatch = document.createElement('div');
  earPatch.id = 'stef-ear-patch';
  box.appendChild(earPatch);

  let videoAvailable = true;
  video.addEventListener('error', () => {
    console.warn('Stef (video2) : echec chargement de la video', VIDEO_SRC);
    stefDebugBadge('echec chargement video (' + VIDEO_SRC + ')');
    videoAvailable = false;
    box.remove();
  });

  // Boucle sur le segment MINI_LOOP_START-MINI_LOOP_END uniquement en mode
  // medaillon (voir minimize()) ; sans effet en plein format.
  // - Pendant que la voix de synthese parle (speaking=true), on boucle en
  //   continu : la bouche doit bouger tant qu'on entend la question.
  // - Sinon (clic manuel sur le medaillon, simple apercu), une seule
  //   passe : on s'arrete a la fin et on revient au repos, pas de boucle
  //   infinie non sollicitee.
  video.addEventListener('timeupdate', () => {
    if (!mini || video.currentTime < MINI_LOOP_END) return;
    if (speaking) {
      video.currentTime = MINI_LOOP_START;
    } else {
      video.pause();
      video.currentTime = MINI_LOOP_START;
    }
  });

  function startVideo() {
    if (!videoAvailable) return;
    // Dans le medaillon, le son natif de la video est toujours coupe (seule
    // la voix de synthese des questions doit s'entendre a ce moment-la) ;
    // en plein format, il suit le bouton muet comme avant.
    try { video.currentTime = 0; video.muted = mini ? true : muted; video.play().catch(() => {}); } catch (e) {}
  }

  const INTRO = "Bonjour, je suis Stef, votre conseiller SAV Falliero. Je suis là pour vous accompagner et vous guider.";
  function stripForSpeech(text) {
    return text
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, '')
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

  // La synthese vocale sert uniquement a lire les QUESTIONS DU FORMULAIRE
  // (texte dynamique absent de la video) une fois le panneau SAV ouvert —
  // pas pour l'intro, qui utilise le son natif de la video ci-dessus.
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
  // La bouche du medaillon ne doit bouger QUE pendant que cette voix de
  // synthese parle reellement (demande explicite) : on demarre la boucle
  // video sur onstart, on la coupe et on revient au visage neutre sur
  // onend/onerror. speaking sert aussi au timeupdate ci-dessus.
  let speaking = false;
  function stopMiniAnim() {
    speaking = false;
    if (mini && videoAvailable) {
      try { video.pause(); video.currentTime = MINI_LOOP_START; } catch (e) {}
    }
  }
  function speak(text) {
    if (!('speechSynthesis' in window) || muted) { stopMiniAnim(); return; }
    const utter = new SpeechSynthesisUtterance(stripForSpeech(text));
    utter.lang = 'fr-FR';
    utter.rate = 0.97;
    utter.pitch = 0.85;
    const voices = cachedVoices.length ? cachedVoices : (('speechSynthesis' in window) ? speechSynthesis.getVoices() : []);
    const fr = pickFrenchMaleVoice(voices);
    if (fr) utter.voice = fr;
    utter.onstart = () => {
      speaking = true;
      if (mini && videoAvailable) {
        try { video.muted = true; video.currentTime = MINI_LOOP_START; video.play().catch(() => {}); } catch (e) {}
      }
    };
    utter.onend = stopMiniAnim;
    utter.onerror = stopMiniAnim;
    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
  }

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
    // Ce bouton n'est visible qu'en mode medaillon, ou le son natif de la
    // video est de toute facon toujours coupe (voir startVideo/minimize) :
    // il ne controle donc que la voix de synthese des questions.
    if (!mini) video.muted = muted;
    if (muted && 'speechSynthesis' in window) { speechSynthesis.cancel(); stopMiniAnim(); }
  });
  function positionMute() {
    if (!mini || !box.classList.contains('visible')) { muteBtn.classList.remove('visible'); return; }
    const r = box.getBoundingClientRect();
    if (!r.width) { muteBtn.classList.remove('visible'); return; }
    muteBtn.style.left = (r.right - 30 - 4) + 'px';
    muteBtn.style.top = (r.bottom - 30 - 4) + 'px';
    muteBtn.classList.add('visible');
  }
  box.addEventListener('transitionend', (e) => {
    if (e.target === box && (e.propertyName === 'left' || e.propertyName === 'top' || e.propertyName === 'width' || e.propertyName === 'height')) {
      positionMute();
    }
  });

  const rsiaPanel = document.getElementById('rsia-widget-panel');
  function positionMini() {
    if (!mini) return;
    const open = !!rsiaPanel && rsiaPanel.getBoundingClientRect().width > 0 && getComputedStyle(rsiaPanel).display !== 'none';
    if (!open || amandineOpen()) {
      box.classList.remove('visible');
      box.style.pointerEvents = 'none';
      return;
    }
    box.classList.add('visible');
    box.style.pointerEvents = 'auto';
    if (IS_MOBILE || !rsiaPanel) { box.style.left = ''; box.style.top = ''; box.style.right = ''; box.style.bottom = ''; box.style.transform = ''; return; }
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
    box.style.transform = 'none';
  }
  if (rsiaPanel && 'MutationObserver' in window) {
    new MutationObserver(() => { positionMini(); positionMute(); }).observe(rsiaPanel, { attributes: true, attributeFilter: ['class', 'style'] });
  }

  let mini = false;
  let userWantsVisible = false;
  let entranceReady = false;
  let hiddenForOverlap = false;
  const amandinePanelEl = document.getElementById("amandine-widget-panel");
function amandineOpen() {
  return !!amandinePanelEl && getComputedStyle(amandinePanelEl).display !== "none";
}
  function checkAmandineOverlap() {
    const open = amandineOpen();
    if (open && box.classList.contains("visible")) {
      box.classList.remove("visible");
      bubble.classList.remove("visible");
      hiddenForOverlap = true;
    } else if (!open && hiddenForOverlap && userWantsVisible) {
      box.classList.add("visible");
      bubble.classList.add("visible");
      hiddenForOverlap = false;
    } else if (!open) {
      hiddenForOverlap = false;
    }
    positionMini(); positionMute();
  }
  if (amandinePanelEl && "MutationObserver" in window) {
    new MutationObserver(checkAmandineOverlap).observe(amandinePanelEl, { attributes: true, attributeFilter: ["style"] });
  }
  
  function minimize() {
    if (mini) return;
    mini = true;
    bubble.classList.add('hidden');
    // sizeBoxForTablet() (voir positionBox()) fixe une largeur/hauteur en
    // ligne (style="width:...;height:...") pour la boite plein format sur
    // iPad/fenetre etroite. Ces valeurs en ligne restent plus prioritaires
    // que le CSS ".mini" (120x120px) si on ne les efface pas -> medaillon
    // enorme au lieu d'un petit rond. On les vide avant de passer en mini
    // pour laisser le CSS reprendre la main.
    box.style.width = '';
    box.style.height = '';
    box.classList.add('mini');
    // Dans le medaillon, Stef reste au repos (visage neutre, bouche
    // fermee) tant qu'aucune question n'est lue a voix haute : la bouche
    // ne doit bouger QUE pendant que la voix de synthese parle (voir
    // speak()/stopMiniAnim ci-dessus), pas en boucle continue. Son de la
    // video toujours coupe.
    if (videoAvailable) {
      video.loop = false;
      video.muted = true;
      try { video.currentTime = MINI_LOOP_START; video.pause(); } catch (e) {}
    }
    setTimeout(() => { positionMini(); positionMute(); }, 720);
  }

  // Un clic sur le medaillon donne juste un apercu manuel : une seule
  // passe du segment (pas de boucle infinie, voir timeupdate plus haut),
  // sans lancer la voix de synthese.
  box.addEventListener('click', () => {
    if (!mini || !videoAvailable || speaking) return;
    try { video.currentTime = MINI_LOOP_START; video.play().catch(() => {}); } catch (e) {}
  });

  bubble.querySelector('#stef-cta').addEventListener('click', () => {
    if (typeof window.toggleWidget === 'function') window.toggleWidget();
    else minimize();
  });

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

  // La boite video est calee juste au-dessus de la rangee de boutons du
  // bas ("Suivi de ma demande" / "Demande SAV"), centree horizontalement
  // dessus — calcule en JS a partir de leur position reelle plutot que
  // des valeurs fixes en vw/vh, pour rester juste quelle que soit la
  // largeur d'ecran.
  // Sur tablette (iPad, etc.), une taille fixe en vh/vw ne peut pas savoir
  // combien de place il reste vraiment entre le haut de l'ecran et la
  // rangee de boutons : trop grande, elle deborde par le haut ("la video
  // arrive par le haut"). Ici on calcule la hauteur qui REMPLIT tout
  // l'espace dispo au-dessus des boutons (avec juste une petite marge en
  // haut), donc la boite est la plus grande possible SANS jamais deborder,
  // quelle que soit la taille/orientation de l'iPad.
  // Uniquement pour de vraies tablettes tactiles : une fenetre de PC/Mac
  // non maximisee (un MacBook 13-14" fait souvent 1280-1440px de large)
  // peut tomber dans la meme plage de largeur qu'un iPad. Sans ce test
  // tactile, ce calcul se declenchait aussi sur PC/Mac par erreur.
  const IS_TOUCH_DEVICE = (navigator.maxTouchPoints || 0) > 1 || 'ontouchstart' in window;
  function sizeBoxForTablet(ar) {
    const w = window.innerWidth;
    if (!IS_TOUCH_DEVICE || w <= 760 || w > 1366 || !ar || !ar.width) return;
    const topMargin = 16, gapAboveActions = 20;
    const availableHeight = ar.top - gapAboveActions - topMargin;
    if (availableHeight < 80) return; // pas assez de place, on garde le CSS de base
    const aspect = 480 / 1024;
    let h = availableHeight;
    let w2 = h * aspect;
    const maxW = window.innerWidth * 0.68;
    if (w2 > maxW) { w2 = maxW; h = w2 / aspect; }
    box.style.height = h + 'px';
    box.style.width = w2 + 'px';
  }

  function positionBox() {
    if (mini) return;
    const actions = document.getElementById('rsia-widget-actions');
    const ar = actions ? actions.getBoundingClientRect() : null;
    sizeBoxForTablet(ar);
    const r = box.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const gap = 20;
    let centerX, bottomY;
    if (ar && ar.width) {
      centerX = ar.left + ar.width / 2;
      bottomY = ar.top - gap;
    } else {
      centerX = window.innerWidth * (IS_MOBILE ? 0.5 : 0.72);
      bottomY = window.innerHeight - 100;
    }
    box.style.left = (centerX - r.width / 2) + 'px';
    box.style.top = (bottomY - r.height) + 'px';
    box.style.right = 'auto';
    box.style.bottom = 'auto';
    box.style.transform = 'none';
  }

  // La bulle est positionnee dynamiquement par rapport a la boite video
  // reelle (et non plus par des valeurs fixes en vw/vh) : la boite ayant
  // change de taille/position plusieurs fois pendant les tests, des
  // valeurs figees finissaient par faire chevaucher la bulle et la video.
  function positionBubble() {
    if (IS_MOBILE || mini) return;
    const r = box.getBoundingClientRect();
    if (!r.width) return;
    const gap = 24;
    bubble.style.right = (window.innerWidth - r.left + gap) + 'px';
    bubble.style.left = 'auto';
    const bh = bubble.offsetHeight || 140;
    bubble.style.top = Math.max(12, r.top + r.height / 2 - bh / 2) + 'px';
    bubble.style.bottom = 'auto';
  }

  let voiceStarted = false;
  function requestEntrance() {
    if (voiceStarted) return;
    voiceStarted = true;
    // La rangee de boutons ("Suivi de ma demande" / "Demande SAV") sert
    // d'ancre a positionBox(). Si on revele la boite avant qu'elle existe
    // dans le DOM, positionBox() retombe sur une position generique de
    // repli, puis "saute" vers la bonne position un peu plus tard une
    // fois les boutons trouves -> mouvement non voulu. On attend donc
    // qu'elle soit presente avant de calculer la position.
    let tries = 0;
    (function waitAndReveal() {
      const actions = document.getElementById('rsia-widget-actions');
      if (!actions && tries < 40) { tries++; requestAnimationFrame(waitAndReveal); return; }
      // #stef-box a une transition CSS "all .7s" qui anime AUSSI les
      // changements de position (left/top/transform), pas seulement
      // l'opacite. Sans precaution, positionBox() (qui fait passer la
      // boite de sa position par defaut centree a sa position finale
      // calee sur les boutons) serait donc lui-meme anime -> effet de
      // "glissement" visible en meme temps que l'apparition, meme si la
      // position finale est correcte des le premier calcul. On coupe la
      // transition, on positionne, on force un reflow (offsetHeight),
      // puis on la reactive juste avant de faire apparaitre (opacite)
      // la boite : seule l'opacite doit s'animer a l'arrivee.
      box.style.transition = 'none';
      positionBox();
      positionBubble();
      void box.offsetHeight;
      box.style.transition = '';
      entranceReady = true;
      if (userWantsVisible) {
        box.classList.add('visible');
        typeIntro();
        startVideo();
      }
      // Recalages de securite apres l'apparition : sur iOS/iPad, la
      // fenetre (innerWidth/innerHeight, unites vw/vh) peut etre mesuree
      // de travers tout de suite au chargement, le temps que Safari cale
      // sa barre d'adresse — surtout constate au lancement direct en
      // paysage. Un seul recalage immediat (rAF) ne suffisait donc pas
      // toujours ; on en ajoute deux de plus, un peu plus tard, pour
      // rattraper une mesure initiale fausse sans attendre une rotation
      // d'ecran. A ce stade la transition est de nouveau active, donc un
      // eventuel ecart s'animera en douceur au lieu de sauter.
      requestAnimationFrame(() => { positionBox(); positionBubble(); });
      setTimeout(() => { positionBox(); positionBubble(); }, 300);
      setTimeout(() => { positionBox(); positionBubble(); }, 900);
    })();
  }

  // resize couvre la plupart des cas ; orientationchange en plus car sur
  // certains iPad/Safari il se declenche avec un timing different (et
  // parfois AVANT que innerWidth/innerHeight ne refletent la nouvelle
  // orientation), d'ou le petit delai avant de repositionner.
  window.addEventListener('resize', () => { positionMini(); positionMute(); positionBox(); positionBubble(); });
  window.addEventListener('orientationchange', () => {
    setTimeout(() => { positionMini(); positionMute(); positionBox(); positionBubble(); }, 250);
  });

  // API identique aux autres variantes pour que index.html n'ait rien a
  // changer : window.Stef.enter() suffit.
  window.Stef = {
    talk: () => {
      if (mini && videoAvailable) { if (!speaking) { try { video.currentTime = MINI_LOOP_START; video.play().catch(() => {}); } catch (e) {} } }
      else startVideo();
    },
    minimize,
    play: () => {},
    enter: requestEntrance,
    toggleVisible: function () {
      userWantsVisible = !userWantsVisible;
      if (userWantsVisible) {
        if (entranceReady) { box.classList.add('visible'); typeIntro(); startVideo(); }
        checkAmandineOverlap();
      } else {
        box.classList.remove('visible');
        bubble.classList.remove('visible');
      }
      return userWantsVisible;
    },
    isVisible: function () { return userWantsVisible; },
  };
})();
