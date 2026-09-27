/*
 * Bouton « Créateurs » : une scène plein écran avec les deux créateurs du site.
 *
 * Déroulé :
 *   1. saut en « vitesse lumière » (traînées d'étoiles), puis champ d'étoiles
 *   2. les logos des entreprises jaillissent du bouton et filent vers leur orbite en laissant une traînée
 *   3. des particules partent des logos de chacun et viennent écrire son nom
 *   4. les logos tournent autour de chaque nom ; Hexagone Group, commun aux deux, brille au centre et les relie
 *   5. un clic sur un nom : ses logos s'enroulent jusqu'à lui, éclair, puis ouverture de son profil LinkedIn
 * Échap ou « Fermer » pour quitter. Scène immobile si le système demande de réduire les animations.
 *
 * Les logos sont des badges au nom et aux couleurs de chaque entreprise. Pour afficher le vrai logo d'une entreprise,
 * place son fichier dans img/logos/ et indique son chemin dans « image », par exemple image: "img/logos/hsbc.png".
 */

const CREATEURS = [
  { cle: "cleante", nom: "Cléante Aupetit", lien: "https://www.linkedin.com/in/cleante-aupetit/", logos: ["hsbc", "hexagone", "swisskap", "cic"] },
  { cle: "maelys", nom: "Maëlys Richard", lien: "https://www.linkedin.com/in/ma%C3%ABlys-richard-/", logos: ["hexagone", "acm", "lv", "disney"] }
];

const LOGOS = {
  hsbc: { nom: "HSBC Asset Management", fond: "#db0011", texte: "#ffffff", image: null,
    html: `<span class="badge-texte"><strong>HSBC</strong><small>Asset Management</small></span>` },
  hexagone: { nom: "Hexagone Group", fond: "#12264d", texte: "#ffffff", image: null,
    html: `<svg class="badge-hexa" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg><span class="badge-texte"><strong>HEXAGONE</strong><small>Group</small></span>` },
  swisskap: { nom: "SwissKap", fond: "#d52b1e", texte: "#ffffff", image: null,
    html: `<span class="badge-croix" aria-hidden="true"></span><span class="badge-texte"><strong>SwissKap</strong></span>` },
  cic: { nom: "CIC", fond: "#0a3a82", texte: "#ffffff", image: null,
    html: `<span class="badge-texte"><strong class="badge-cic">CIC</strong></span>` },
  acm: { nom: "Automobile Club de Monaco", fond: "#ce1126", texte: "#ffffff", image: null,
    html: `<span class="badge-texte"><strong>ACM</strong><small>Automobile Club de Monaco</small></span>` },
  lv: { nom: "Louis Vuitton", fond: "#3a2519", texte: "#e8d3a2", image: null,
    html: `<span class="badge-texte"><strong class="badge-lv">LOUIS VUITTON</strong></span>` },
  disney: { nom: "Walt Disney World", fond: "#0b3a8c", texte: "#ffffff", image: null,
    html: `<span class="badge-etincelle" aria-hidden="true">✦</span><span class="badge-texte"><strong class="badge-disney">Walt Disney World</strong></span>` }
};
const LOGO_COMMUN = "hexagone";   // entreprise commune aux deux créateurs : elle brille au centre

(function () {
  const bouton = document.getElementById("btn-createur");
  if (!bouton) return;
  let scene = null;

  bouton.addEventListener("click", () => {
    if (scene) return;
    const r = bouton.getBoundingClientRect();
    scene = ouvrir(r.left + r.width / 2, r.top + r.height / 2);
  });
  // Retour arrière depuis LinkedIn : on ne laisse pas la scène figée
  window.addEventListener("pageshow", e => { if (scene && e.persisted) scene.fermer(); });

  // ---------- Construction de la scène ----------

  function badge(cle) {
    const l = LOGOS[cle];
    const el = document.createElement("div");
    el.className = `logo-badge logo-${cle}`;
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", l.nom);
    el.style.setProperty("--marque", l.fond);
    el.style.setProperty("--marque-texte", l.texte);
    el.innerHTML = l.image ? `<img src="${l.image}" alt="">` : l.html;
    return el;
  }

  function ouvrir(origineX, origineY) {
    const reduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const calque = document.createElement("div");
    calque.className = "createurs-calque";
    calque.setAttribute("role", "dialog");
    calque.setAttribute("aria-modal", "true");
    calque.setAttribute("aria-labelledby", "createurs-titre");
    calque.innerHTML = `
      <canvas aria-hidden="true"></canvas>
      <p class="createurs-titre" id="createurs-titre">Les créateurs de « Décrypte ton fonds »</p>
      ${CREATEURS.map((c, i) => `<div class="createur-bloc" data-i="${i}">
        <a class="createur-nom" href="${c.lien}" rel="noopener">${c.nom}</a>
        <span class="createur-lien">Profil LinkedIn ↗</span>
      </div>`).join("")}
      <p class="createurs-invite">Clique sur un nom pour découvrir son parcours sur LinkedIn</p>
      <button type="button" class="createurs-fermer" aria-label="Fermer">Fermer ✕</button>`;
    document.body.appendChild(calque);
    document.body.classList.add("createur-actif");

    const canvas = calque.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    const blocs = [...calque.querySelectorAll(".createur-bloc")];
    const liens = [...calque.querySelectorAll(".createur-nom")];

    // Un badge par logo propre à chacun, un seul pour le logo commun
    const logos = [];
    CREATEURS.forEach((c, p) => c.logos.filter(k => k !== LOGO_COMMUN).forEach((k, rang, liste) => {
      logos.push({ cle: k, personne: p, rang, nb: liste.length, el: badge(k), couleur: LOGOS[k].fond });
    }));
    const commun = { cle: LOGO_COMMUN, personne: -1, el: badge(LOGO_COMMUN), couleur: LOGOS[LOGO_COMMUN].fond };
    commun.el.classList.add("logo-commun");
    logos.push(commun);
    logos.forEach(l => calque.appendChild(l.el));
    logos.forEach(l => { l.largeur = l.el.offsetWidth; l.hauteur = l.el.offsetHeight; });

    let arrete = false, idAnim = 0, minuterie = 0;
    let G = geometrie();
    const t0 = performance.now();
    const etat = { survol: [0, 0], vitesse: [1, 1], angle: [0, 0], derniere: t0, sortie: null, souris: { x: G.L / 2, y: G.H / 2 } };

    function fermer() {
      arrete = true;
      cancelAnimationFrame(idAnim);
      clearTimeout(minuterie);
      document.removeEventListener("keydown", surTouche);
      window.removeEventListener("resize", surRedim);
      calque.remove();
      document.body.classList.remove("createur-actif");
      bouton.focus({ preventScroll: true });
      scene = null;
    }
    function surTouche(e) {
      if (e.key === "Escape") { fermer(); return; }
      if (e.key === "Tab") { // le focus reste dans la scène
        const f = [...liens, calque.querySelector(".createurs-fermer")];
        const i = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
    }
    function surRedim() { G = geometrie(); dimensionner(); }
    document.addEventListener("keydown", surTouche);
    window.addEventListener("resize", surRedim);
    calque.querySelector(".createurs-fermer").addEventListener("click", fermer);
    calque.addEventListener("pointermove", e => { etat.souris = { x: e.clientX, y: e.clientY }; });
    liens.forEach((a, p) => {
      a.addEventListener("pointerenter", () => { etat.survol[p] = 1; });
      a.addEventListener("pointerleave", () => { etat.survol[p] = 0; });
      a.addEventListener("focus", () => { etat.survol[p] = 1; });
      a.addEventListener("blur", () => { etat.survol[p] = 0; });
      a.addEventListener("click", e => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;   // nouvel onglet : comportement normal
        e.preventDefault();
        partir(p);
      });
    });

    function partir(p) {
      if (etat.sortie) return;
      if (reduit) { window.location.href = CREATEURS[p].lien; return; }
      etat.sortie = { p, t: performance.now() };
      calque.classList.add("sortie", `sortie-${p}`);
      minuterie = setTimeout(() => { window.location.href = CREATEURS[p].lien; }, 1150);
    }

    // ---------- Géométrie (recalculée si la fenêtre change de taille) ----------

    // Écran large : les deux noms côte à côte, le logo commun au-dessus, entre eux (en triangle).
    // Écran étroit : les deux noms l'un au-dessus de l'autre, le logo commun entre les deux.
    function geometrie() {
      const L = window.innerWidth, H = window.innerHeight;
      const horizontal = L >= 720 && L / H > 1.05;
      const taille = horizontal ? Math.max(28, Math.min(L * 0.032, 46)) : Math.max(24, Math.min(L * 0.08, 40));
      const demiNom = taille * 3.9;                                   // demi-largeur approximative d'un nom
      const echelle = horizontal ? Math.max(0.7, Math.min(1, L / 1400 + 0.1)) : Math.min(0.72, L / 520);
      const demiBadge = 100 * echelle;
      if (horizontal) {
        const cy = H * 0.54;
        const rx = Math.max(demiNom * 0.9, Math.min(L * 0.25 - demiBadge - 24, demiNom + 70));
        const ry = Math.min(rx * 0.62, H * 0.21);
        return { L, H, horizontal, taille, echelle, rx, ry, centres: [[L * 0.25, cy], [L * 0.75, cy]], centre: [L / 2, Math.max(H * 0.22, cy - ry - 70)] };
      }
      const rx = Math.min(L / 2 - demiBadge - 10, demiNom + 40);
      const ry = Math.min(rx * 0.6, H * 0.09);
      return { L, H, horizontal, taille, echelle, rx, ry, centres: [[L / 2, H * 0.34], [L / 2, H * 0.74]], centre: [L / 2, H * 0.54] };
    }

    // Centre réel du nom affiché (sert aux particules, aux faisceaux et au halo)
    function centreNom(p) {
      const r = liens[p].getBoundingClientRect();
      return r.width ? [r.left + r.width / 2, r.top + r.height / 2] : G.centres[p];
    }

    function dimensionner() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = G.L * dpr; canvas.height = G.H * dpr;
      canvas.style.width = G.L + "px"; canvas.style.height = G.H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      calque.style.setProperty("--taille-nom", G.taille + "px");
      blocs.forEach((b, p) => { b.style.left = G.centres[p][0] + "px"; b.style.top = G.centres[p][1] + "px"; });
    }
    dimensionner();
    requestAnimationFrame(() => calque.classList.add("visible"));

    // Position d'un logo sur son orbite (ellipse inclinée, avec profondeur)
    function surOrbite(l, t) {
      if (l.personne < 0) {
        const [cx, cy] = G.centre;
        return { x: cx, y: cy + Math.sin(t / 900) * 8, z: 1, devant: true, echelle: G.echelle * 1.12 };
      }
      const p = l.personne, [cx, cy] = G.centres[p];
      const sens = p === 0 ? 1 : -1;
      const theta = l.rang / l.nb * Math.PI * 2 + (p ? Math.PI / 3 : -Math.PI / 6) + sens * etat.angle[p];
      const incl = (G.horizontal ? 0.2 : 0.12) * (p === 0 ? -1 : 1);
      const ex = Math.cos(theta) * G.rx, ey = Math.sin(theta) * G.ry;
      const z = Math.sin(theta);   // profondeur : taille et luminosité du logo
      // devant le nom seulement quand le logo passe nettement en dessous ; sinon il glisse derrière
      return { x: cx + ex * Math.cos(incl) - ey * Math.sin(incl), y: cy + ex * Math.sin(incl) + ey * Math.cos(incl), z, devant: z > 0.6,
        echelle: G.echelle * (0.8 + 0.22 * (z + 1) / 2) };
    }

    function placer(l, x, y, echelle, opacite, devant) {
      l.el.style.transform = `translate3d(${(x - l.largeur / 2).toFixed(1)}px, ${(y - l.hauteur / 2).toFixed(1)}px, 0) scale(${echelle.toFixed(3)})`;
      l.el.style.opacity = opacite.toFixed(3);
      l.el.style.zIndex = devant ? 7 : 3;
      l.x = x; l.y = y;
    }

    // Scène sans mouvement
    if (reduit) {
      calque.classList.add("reduit");
      blocs.forEach(b => b.classList.add("visible"));
      logos.forEach(l => { const o = surOrbite(l, 0); placer(l, o.x, o.y, o.echelle, 1, o.devant); });
      ctx.fillStyle = "#050816"; ctx.fillRect(0, 0, G.L, G.H);
      liens[0].focus({ preventScroll: true });
      return { fermer };
    }

    // ---------- Étoiles, particules, traînées ----------

    const etoiles = Array.from({ length: 260 }, () => ({ angle: Math.random() * Math.PI * 2, d: Math.random() * 0.5, v: 0.5 + Math.random(),
      x: Math.random(), y: Math.random(), p: 0.3 + Math.random() * 0.7, s: Math.random() * 6 }));
    const traces = [];          // étincelles laissées par les logos en vol
    let particules = null;      // particules qui écrivent les noms
    let filante = null;         // étoile filante occasionnelle

    const DUREES = { saut: 750, vol: 950, ecart: 80, noms: 1500, apparition: 2700 };
    const debutVol = l => 350 + logos.indexOf(l) * DUREES.ecart;
    const adoucir = x => 1 - Math.pow(1 - x, 3);
    const clair = (hex, a) => { const n = parseInt(hex.slice(1), 16); const r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
      const m = v => Math.round(v + (255 - v) * 0.45); return `rgba(${m(r)}, ${m(g)}, ${m(b)}, ${a})`; };

    // Points de chaque nom (texte dessiné sur un canvas invisible)
    function pointsDesNoms() {
      const c = document.createElement("canvas");
      c.width = G.L; c.height = G.H;
      const x = c.getContext("2d");
      x.textAlign = "center"; x.textBaseline = "middle";
      x.font = `800 ${G.taille}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      const pas = Math.max(2, Math.round(G.taille / 16));
      return CREATEURS.map((cr, p) => {
        x.clearRect(0, 0, G.L, G.H);
        x.fillStyle = "#fff";
        const [nx, ny] = centreNom(p);
        x.fillText(cr.nom, nx, ny);
        const d = x.getImageData(0, 0, G.L, G.H).data, pts = [];
        const y0 = Math.max(0, Math.floor(ny - G.taille)), y1 = Math.min(G.H, Math.ceil(ny + G.taille));
        for (let py = y0; py < y1; py += pas) for (let px = 0; px < G.L; px += pas) if (d[(py * G.L + px) * 4 + 3] > 128) pts.push([px, py]);
        return pts;
      });
    }

    function lancerParticules(t) {
      const cibles = pointsDesNoms();
      particules = [];
      cibles.forEach((pts, p) => {
        // les particules partent de l'emplacement de chaque logo sur son orbite
        const sources = logos.filter(l => l.personne === p || l.personne < 0).map(l => ({ ...surOrbite(l, t), couleur: l.couleur }));
        const max = Math.min(pts.length, 900);
        for (let i = 0; i < max; i++) {
          const cible = pts[Math.floor(i * pts.length / max)];
          const s = sources[i % sources.length];
          particules.push({ x: s.x, y: s.y, sx: s.x, sy: s.y, cx: cible[0], cy: cible[1], couleur: clair(s.couleur, 1), blanc: Math.random() < 0.45,
            delai: Math.random() * 0.45, courbe: (Math.random() - 0.5) * 220, taille: 1 + Math.random() * 1.4, phase: Math.random() * 6.28, t });
        }
      });
    }

    function image(maintenant) {
      if (arrete) return;
      const t = maintenant - t0;
      const dt = Math.min(50, maintenant - etat.derniere) / 1000;
      etat.derniere = maintenant;
      const { L, H } = G;
      const sortie = etat.sortie ? Math.min(1, (maintenant - etat.sortie.t) / 1100) : 0;

      // Vitesse de rotation : accélère au survol d'un nom, et encore plus au départ vers LinkedIn
      for (let p = 0; p < 2; p++) {
        const cible = etat.sortie && etat.sortie.p === p ? 9 : 1 + 2.6 * etat.survol[p];
        etat.vitesse[p] += (cible - etat.vitesse[p]) * Math.min(1, dt * 4);
        if (t > DUREES.saut) etat.angle[p] += dt * 0.32 * etat.vitesse[p];
      }

      // Fond : on ne l'efface pas complètement, pour garder de courtes traînées lumineuses
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = t < DUREES.saut ? "rgba(3, 5, 16, 0.35)" : "rgba(3, 5, 16, 0.42)";
      ctx.fillRect(0, 0, L, H);

      // 1. Étoiles : saut en vitesse lumière, puis champ d'étoiles qui suit un peu la souris
      const [ox, oy] = [origineX, origineY];
      const decalX = (etat.souris.x - L / 2) * 0.012, decalY = (etat.souris.y - H / 2) * 0.012;
      ctx.lineCap = "round";
      for (const e of etoiles) {
        if (t < DUREES.saut) {
          const k = t / DUREES.saut;
          const cx = L / 2 + (ox - L / 2) * (1 - k), cy = H / 2 + (oy - H / 2) * (1 - k);
          const d1 = (e.d + k * k * 1.6 * e.v) * Math.max(L, H), d0 = d1 * (0.55 + 0.4 * k);
          ctx.strokeStyle = `rgba(190, 210, 255, ${0.55 * (1 - k * 0.4)})`;
          ctx.lineWidth = 1 + e.v;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(e.angle) * d0, cy + Math.sin(e.angle) * d0);
          ctx.lineTo(cx + Math.cos(e.angle) * d1, cy + Math.sin(e.angle) * d1);
          ctx.stroke();
        } else {
          const brille = 0.35 + 0.65 * Math.abs(Math.sin(t / 900 + e.s));
          ctx.fillStyle = `rgba(210, 225, 255, ${0.55 * brille * e.p})`;
          const x = e.x * L + decalX * e.p * 3, y = e.y * H + decalY * e.p * 3;
          ctx.fillRect(x, y, e.p * 1.7, e.p * 1.7);
        }
      }
      // Étoile filante de temps en temps
      if (!filante && t > 3500 && Math.random() < 0.006) filante = { x: Math.random() * L * 0.7, y: Math.random() * H * 0.3, t: maintenant };
      if (filante) {
        const k = (maintenant - filante.t) / 900;
        if (k > 1) filante = null;
        else {
          const x = filante.x + k * L * 0.35, y = filante.y + k * H * 0.22;
          const g = ctx.createLinearGradient(x - 120, y - 75, x, y);
          g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(1, `rgba(255,255,255,${0.8 * (1 - k)})`);
          ctx.strokeStyle = g; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(x - 120, y - 75); ctx.lineTo(x, y); ctx.stroke();
        }
      }

      ctx.globalCompositeOperation = "lighter";

      // 2. Logos : vol depuis le bouton, puis orbite
      for (const l of logos) {
        const o = surOrbite(l, t);
        let x = o.x, y = o.y, echelle = o.echelle, opacite = 0.55 + 0.45 * (o.z + 1) / 2, devant = o.devant;
        if (l.personne < 0) opacite = 1;
        const k = Math.min(1, Math.max(0, (t - debutVol(l)) / DUREES.vol));
        if (k < 1) {
          // courbe de Bézier : du bouton vers l'orbite, en passant par un point décalé (effet de spirale)
          const e = adoucir(k);
          const mx = (origineX + o.x) / 2 + (o.y - origineY) * 0.45, my = (origineY + o.y) / 2 - (o.x - origineX) * 0.45;
          x = (1 - e) * (1 - e) * origineX + 2 * (1 - e) * e * mx + e * e * o.x;
          y = (1 - e) * (1 - e) * origineY + 2 * (1 - e) * e * my + e * e * o.y;
          echelle = o.echelle * (0.2 + 0.8 * e);
          opacite = k <= 0 ? 0 : Math.min(1, k * 4) * opacite;
          devant = true;
          if (k > 0) for (let n = 0; n < 3; n++) traces.push({ x: x + (Math.random() - 0.5) * 16, y: y + (Math.random() - 0.5) * 16, vie: 1, couleur: clair(l.couleur, 1),
            vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, taille: 1.2 + Math.random() * 2.2 });
        }
        // Départ vers LinkedIn : les logos de la personne s'enroulent jusqu'à son nom, les autres s'effacent
        if (etat.sortie) {
          const p = etat.sortie.p, [cx, cy] = centreNom(p);
          if (l.personne === p || l.personne < 0) {
            const e = adoucir(Math.min(1, sortie * 1.25));
            x += (cx - x) * e; y += (cy - y) * e;
            echelle *= 1 - 0.75 * e;
            opacite *= 1 - Math.max(0, (sortie - 0.55) / 0.45);
            if (Math.random() < 0.8) traces.push({ x, y, vie: 1, couleur: clair(l.couleur, 1), vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, taille: 1.5 + Math.random() * 2.5 });
          } else opacite *= 1 - Math.min(1, sortie * 2.2);
        }
        // Mise en valeur au survol : les logos de la personne grossissent, ceux de l'autre s'estompent
        if (!etat.sortie && l.personne >= 0) {
          const autre = etat.survol[1 - l.personne];
          echelle *= 1 + 0.1 * etat.survol[l.personne];
          opacite *= 1 - 0.45 * autre * (1 - etat.survol[l.personne]);
        }
        placer(l, x, y, echelle, opacite, devant);
      }

      // 3. Faisceaux : chaque logo relié à son créateur, le logo commun relié aux deux
      const centresNoms = [centreNom(0), centreNom(1)];
      if (t > DUREES.apparition - 400 && !etat.sortie) {
        const force = Math.min(1, (t - DUREES.apparition + 400) / 800);
        for (const l of logos) {
          const cibles = l.personne < 0 ? [0, 1] : [l.personne];
          for (const p of cibles) {
            const [cx, cy] = centresNoms[p];
            const o = l.personne < 0 ? 1 : (surOrbite(l, t).z + 1) / 2;
            const g = ctx.createLinearGradient(l.x, l.y, cx, cy);
            g.addColorStop(0, clair(l.couleur, (l.personne < 0 ? 0.38 : 0.2 + 0.2 * o) * force * (1 + etat.survol[p])));
            g.addColorStop(1, "rgba(124, 92, 255, 0)");
            ctx.strokeStyle = g; ctx.lineWidth = l.personne < 0 ? 2 : 1.3;
            ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(cx, cy); ctx.stroke();
            if (l.personne < 0) { // impulsions lumineuses qui voyagent vers chaque nom
              for (let n = 0; n < 2; n++) {
                const k = ((t / 1400) + n / 2 + p * 0.25) % 1;
                ctx.fillStyle = `rgba(200, 220, 255, ${0.9 * force * Math.sin(k * Math.PI)})`;
                ctx.beginPath(); ctx.arc(l.x + (cx - l.x) * k, l.y + (cy - l.y) * k, 2.4, 0, Math.PI * 2); ctx.fill();
              }
            }
          }
        }
        // Halo derrière le nom survolé
        for (let p = 0; p < 2; p++) {
          const [cx, cy] = centresNoms[p];
          const a = 0.1 + 0.16 * etat.survol[p];
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, G.rx * 1.1);
          g.addColorStop(0, `rgba(124, 92, 255, ${a * force})`); g.addColorStop(1, "rgba(124, 92, 255, 0)");
          ctx.fillStyle = g; ctx.fillRect(cx - G.rx * 1.2, cy - G.rx * 1.2, G.rx * 2.4, G.rx * 2.4);
        }
      }

      // 4. Étincelles des traînées
      for (let i = traces.length - 1; i >= 0; i--) {
        const s = traces[i];
        s.vie -= dt * 1.6; s.x += s.vx * dt; s.y += s.vy * dt;
        if (s.vie <= 0) { traces.splice(i, 1); continue; }
        ctx.fillStyle = s.couleur.replace(/[\d.]+\)$/, (0.85 * s.vie).toFixed(2) + ")");
        ctx.beginPath(); ctx.arc(s.x, s.y, s.taille * s.vie, 0, Math.PI * 2); ctx.fill();
      }
      if (traces.length > 1500) traces.splice(0, traces.length - 1500);

      // 5. Les particules partent des logos et écrivent les noms, puis s'effacent derrière le texte net
      if (!particules && t > DUREES.noms) lancerParticules(t);
      if (particules) {
        const fondu = t < DUREES.apparition ? 1 : Math.max(0, 1 - (t - DUREES.apparition) / 900);
        if (fondu > 0) {
          for (const q of particules) {
            const k = Math.min(1, Math.max(0, ((t - DUREES.noms) / (DUREES.apparition - DUREES.noms) - q.delai) / (1 - q.delai)));
            const e = adoucir(k);
            const px = q.x, py = q.y;
            // trajectoire courbe entre le logo et le point du nom
            q.x = q.sx + (q.cx - q.sx) * e + Math.sin(e * Math.PI) * q.courbe * 0.5;
            q.y = q.sy + (q.cy - q.sy) * e - Math.sin(e * Math.PI) * q.courbe * 0.3;
            if (k >= 1) { q.x += Math.sin(t / 160 + q.phase) * 0.4; q.y += Math.cos(t / 190 + q.phase) * 0.4; }
            ctx.strokeStyle = q.blanc ? `rgba(235, 240, 255, ${0.9 * fondu})` : q.couleur.replace(/[\d.]+\)$/, (0.9 * fondu).toFixed(2) + ")");
            ctx.lineWidth = q.taille;
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(q.x + 0.01, q.y + 0.01); ctx.stroke();
          }
        } else particules = [];
      }
      if (t > DUREES.apparition && !blocs[0].classList.contains("visible")) {
        blocs.forEach(b => b.classList.add("visible"));
        calque.classList.add("pret");
        if (!liens.includes(document.activeElement)) liens[0].focus({ preventScroll: true });
      }

      // 6. Départ : onde de choc et éclair sur le nom choisi
      if (etat.sortie) {
        const [cx, cy] = centreNom(etat.sortie.p);
        if (sortie > 0.45) {
          const k = (sortie - 0.45) / 0.55;
          ctx.strokeStyle = `rgba(210, 225, 255, ${0.8 * (1 - k)})`;
          ctx.lineWidth = 3 * (1 - k) + 0.5;
          ctx.beginPath(); ctx.arc(cx, cy, k * Math.max(L, H) * 0.9, 0, Math.PI * 2); ctx.stroke();
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(L, H) * (0.2 + k));
          g.addColorStop(0, `rgba(255, 255, 255, ${Math.min(1, k * 1.3)})`); g.addColorStop(1, "rgba(160, 140, 255, 0)");
          ctx.globalCompositeOperation = "source-over";
          ctx.fillStyle = g; ctx.fillRect(0, 0, L, H);
        }
      }
      idAnim = requestAnimationFrame(image);
    }

    ctx.fillStyle = "rgb(3, 5, 16)";
    ctx.fillRect(0, 0, G.L, G.H);
    idAnim = requestAnimationFrame(image);
    return { fermer };
  }
})();
