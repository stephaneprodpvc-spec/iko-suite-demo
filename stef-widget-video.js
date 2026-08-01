// ============================================================
// STEF — Assistant Iko pour la page SAV — VARIANTE TEST VIDEO
// Usage : <script type="module" src="stef-widget-video.js"></script>
// Requiert : une video a la racine du site (voir VIDEO_SRC ci-dessous)
//
// Base sur stef-widget.js (personnage 3D Three.js), avec le corps 3D
// remplace par une video en boucle. TOUTE la logique de bulle de texte +
// voix (speechSynthesis) + bouton mute + mode medaillon est conservee a
// l'identique : seul le "corps" de Stef change.
//
// La video source (fond vert) a ete pre-traitee HORS-LIGNE avec ffmpeg
// (detourage + incrustation sur le fond dore de la marque) : ce fichier
// n'a plus besoin de faire de detourage en direct, c'est juste une video
// normale a jouer. Beaucoup plus fiable et rapide qu'un detourage en
// JavaScript image par image dans le navigateur.
//
// Fichier separe expres : stef-widget.js et index.html ne sont pas
// touches, donc la page de production continue de tourner avec le
// personnage 3D actuel. Pour revenir en arriere il suffit de ne pas
// utiliser ce fichier (ou de supprimer index-test1.html).
// ============================================================

// Nom du fichier video a tester (deja detoure + incruste sur fond dore,
// voir stef-test1.mp4 -> stef-test1-keyed.mp4). Pour le test n2, dupliquer
// ce fichier (ex: stef-widget-video-2.js) et changer juste cette ligne +
// la page index-test2.html correspondante.
const VIDEO_SRC = './stef-test1-keyed.mp4';

function stefDebugBadge(msg) {
  console.warn('Stef (video) debug : ' + msg);
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
      /* Centre horizontalement sur la partie doree de la page d'accueil
         (le panneau orange occupe grossierement de 45% a 100% de la
         largeur ; son centre est donc a ~72%), et centre verticalement
         sur toute la hauteur de l'ecran. */
      top: 50%; left: ${IS_MOBILE ? '50%' : '72%'}; right: auto; bottom: auto;
      transform: translate(-50%, -50%);
      width: ${IS_MOBILE ? '82vw' : '36vw'};
      max-width: 620px;
      aspect-ratio: 16 / 9;
      height: auto;
    }
    #stef-box.visible { opacity: 1; }
    #stef-box.mini {
      width: 120px; height: 120px; aspect-ratio: auto;
      left: 18px; right: auto; top: auto; bottom: 18px;
      transform: none;
      border-radius: 50%; overflow: hidden;
      background: radial-gradient(circle at 50% 30%, #FFFFFF, #F2F2F2);
      border: 3px solid ${YELLOW};
      box-shadow: 0 6px 24px rgba(0,0,0,.45);
      pointer-events: auto; cursor: pointer;
    }
    #stef-box video {
      width: 100% !important; height: 100% !important;
      display: block; object-fit: cover; object-position: center center;
      border-radius: inherit;
    }
    #stef-bubble {
      position: fixed !important; z-index: 999991 !important;
      ${IS_MOBILE
        ? 'left: 16px; right: 16px; top: 14px;'
        : 'right: 30vw; bottom: 56vh; max-width: 320px;'}
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

  const video = document.createElement('video');
  video.id = 'stef-video';
  video.src = VIDEO_SRC;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  // Pas d'autoplay : la video reste sur sa premiere image tant qu'elle
  // n'est pas lancee explicitement, synchronisee sur le vrai demarrage de
  // la voix (utter.onstart), pour que corps et voix demarrent ensemble.
  video.autoplay = false;
  video.preload = 'auto';
  box.appendChild(video);

  let videoAvailable = true;
  video.addEventListener('error', () => {
    console.warn('Stef (video) : echec chargement de la video', VIDEO_SRC);
    stefDebugBadge('echec chargement video (' + VIDEO_SRC + ')');
    videoAvailable = false;
    box.remove();
    if (pendingEntrance) startVoiceOnlyEntrance();
  });

  // La voix (speechSynthesis) demarre quasi instantanement des l'appel a
  // speak(), alors qu'une video jamais lancee doit d'abord etre
  // telechargee et decodee : sans prechargement, son image ne s'affichait
  // qu'apres la voix. On "prime" donc la video des le chargement du
  // script (lecture muette immediatement suivie d'une pause), pour
  // qu'elle soit deja prete a jouer instantanement au vrai demarrage.
  let videoPrimed = false;
  function primeVideo() {
    if (videoPrimed) return;
    videoPrimed = true;
    try {
      const p = video.play();
      if (p && p.catch) p.then(() => { video.pause(); video.currentTime = 0; }).catch(() => {});
    } catch (e) {}
  }
  primeVideo();

  function startVideo() {
    if (!videoAvailable) return;
    try { video.currentTime = 0; video.play().catch(() => {}); } catch (e) {}
  }

  const INTRO = "Bonjour, je suis Stef, votre conseiller SAV Iko. Je suis là pour vous accompagner et vous guider.";
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
  box.addEventListener('transitionend', (e) => {
    if (e.target === box && (e.propertyName === 'left' || e.propertyName === 'top' || e.propertyName === 'width' || e.propertyName === 'height')) {
      positionMute();
    }
  });

  // La video redemarre EXACTEMENT au moment ou la voix demarre reellement
  // (utter.onstart), et pas au moment de l'appel a speak() : ca evite tout
  // decalage du a la latence de demarrage du moteur de synthese vocale.
  function speak(text, onStart) {
    if (!('speechSynthesis' in window) || muted) return;
    const utter = new SpeechSynthesisUtterance(stripForSpeech(text));
    utter.lang = 'fr-FR';
    utter.rate = 0.97;
    utter.pitch = 0.85;
    utter.onstart = () => { if (onStart) onStart(); };
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
  function minimize() {
    if (mini) return;
    mini = true;
    bubble.classList.add('hidden');
    box.classList.add('mini');
    setTimeout(() => { positionMini(); positionMute(); }, 720);
  }

  // Pas d'animation "parle/marche" distincte (une seule video en boucle) :
  // un clic sur le medaillon relance la voix, et la video redemarre en
  // meme temps qu'elle.
  box.addEventListener('click', () => {
    if (!mini) return;
    speak(INTRO, startVideo);
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

  let pendingEntrance = false;
  let voiceStarted = false;
  function triggerVoiceAndBubble() {
    if (voiceStarted) return;
    voiceStarted = true;
    typeIntro();
    primeVoice();
    speak(INTRO, startVideo);
  }
  function startEntrance() {
    box.classList.add('visible');
    triggerVoiceAndBubble();
  }
  // Repli "voix seule" si la video ne peut pas se charger/jouer : pas de
  // corps visuel, mais la bulle de texte et la voix de Stef restent
  // fonctionnelles (meme logique de secours que la version 3D).
  function startVoiceOnlyEntrance() {
    if (voiceStarted) return;
    voiceStarted = true;
    typeIntro();
    primeVoice();
    speak(INTRO);
  }
  function requestEntrance() {
    pendingEntrance = true;
    if (videoAvailable) startEntrance();
    else startVoiceOnlyEntrance();
  }

  window.addEventListener('resize', () => { positionMini(); positionMute(); });

  // API identique a la version 3D pour que index.html (bouton "Entrer" du
  // portail) n'ait rien a changer : window.Stef.enter() suffit.
  window.Stef = {
    talk: () => { speak(INTRO, startVideo); },
    minimize,
    play: () => {},
    enter: requestEntrance,
  };
})();
