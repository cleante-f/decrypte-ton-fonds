/*
 * Bouton « Créateur » : animation plein écran puis redirection vers le profil LinkedIn.
 *
 * Déroulé (≈ 4,5 s) :
 *   1. explosion de particules depuis le bouton
 *   2. les particules se rassemblent pour écrire le nom
 *   3. le nom scintille, un sous-titre apparaît
 *   4. passage en « vitesse lumière » (les particules deviennent des traînées), flash, redirection
 * Échap annule, « Passer » redirige tout de suite. Animation réduite si l'utilisateur préfère moins de mouvement.
 */

// ⚠️ Remplace par l'adresse exacte du profil, par ex. "https://www.linkedin.com/in/ton-identifiant/"
const LIEN_LINKEDIN = "https://www.linkedin.com/in/cleante-aupetit/";
const NOM_CREATEUR = "Cléante Aupetit";

(function () {
  const bouton = document.getElementById("btn-createur");
  if (!bouton) return;

  const COULEURS = ["#4fd1ff", "#2a78d6", "#7c5cff", "#b18cff", "#ffffff"];
  const DUREES = { explosion: 900, rassemblement: 1500, pause: 1000, warp: 1100 };

  let enCours = null;

  bouton.addEventListener("click", () => {
    if (enCours) return;
    const r = bouton.getBoundingClientRect();
    enCours = lancer(r.left + r.width / 2, r.top + r.height / 2);
  });

  // Si l'utilisateur revient en arrière depuis LinkedIn, on ne laisse pas l'écran noir
  window.addEventListener("pageshow", () => { if (enCours) enCours.fermer(); });

  function lancer(origineX, origineY) {
    const reduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ----- Calque plein écran -----
    const calque = document.createElement("div");
    calque.className = "createur-calque";
    calque.innerHTML = `
      <canvas></canvas>
      <p class="createur-sous-titre">Créateur de « Décrypte ton fonds »<br><span>Direction LinkedIn…</span></p>
      <button type="button" class="createur-passer">Passer →</button>
      <div class="createur-flash"></div>`;
    document.body.appendChild(calque);
    document.body.classList.add("createur-actif");
    requestAnimationFrame(() => calque.classList.add("visible"));

    const canvas = calque.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    const sousTitre = calque.querySelector(".createur-sous-titre");
    const flash = calque.querySelector(".createur-flash");
    let arrete = false, idAnim = 0, minuterie = 0;

    const aller = () => { if (!arrete) { arrete = true; window.location.href = LIEN_LINKEDIN; } };
    const fermer = () => {
      arrete = true;
      cancelAnimationFrame(idAnim);
      clearTimeout(minuterie);
      document.removeEventListener("keydown", surTouche);
      calque.remove();
      document.body.classList.remove("createur-actif");
      enCours = null;
    };
    const surTouche = e => { if (e.key === "Escape") fermer(); };
    document.addEventListener("keydown", surTouche);
    calque.querySelector(".createur-passer").addEventListener("click", aller);

    // Version sobre : simple fondu puis redirection
    if (reduit) {
      sousTitre.classList.add("visible");
      minuterie = setTimeout(aller, 1500);
      return { fermer };
    }

    // ----- Dimensions (écrans haute densité) -----
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const L = window.innerWidth, H = window.innerHeight;
    canvas.width = L * dpr; canvas.height = H * dpr;
    canvas.style.width = L + "px"; canvas.style.height = H + "px";
    ctx.scale(dpr, dpr);

    // ----- Points cibles : les pixels du nom écrit sur un canvas invisible -----
    const cibles = pointsDuTexte(NOM_CREATEUR, L, H);
    const nb = Math.min(1600, Math.max(700, cibles.length));
    const particules = [];
    for (let i = 0; i < nb; i++) {
      const angle = Math.random() * Math.PI * 2;
      const vitesse = 4 + Math.random() * 14;
      const cible = cibles[Math.floor(i * cibles.length / nb)];
      particules.push({
        x: origineX, y: origineY, px: origineX, py: origineY,
        vx: Math.cos(angle) * vitesse, vy: Math.sin(angle) * vitesse,
        cx: cible.x, cy: cible.y,
        taille: 1.4 + Math.random() * 1.8,
        couleur: COULEURS[Math.floor(Math.random() * COULEURS.length)],
        phase: Math.random() * Math.PI * 2,
        delai: Math.random() * 0.35
      });
    }
    // Étoiles de fond
    const etoiles = Array.from({ length: 160 }, () => ({ x: Math.random() * L, y: Math.random() * H, a: Math.random(), v: 0.2 + Math.random() * 0.8 }));

    const cx = L / 2, cy = H / 2;
    const t0 = performance.now();
    const T1 = DUREES.explosion, T2 = T1 + DUREES.rassemblement, T3 = T2 + DUREES.pause, T4 = T3 + DUREES.warp;
    const adoucir = t => 1 - Math.pow(1 - t, 3);

    function image(maintenant) {
      if (arrete) return;
      const t = maintenant - t0;

      // traînées : on n'efface pas complètement l'image précédente
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = t < T3 ? "rgba(4, 6, 18, 0.28)" : "rgba(4, 6, 18, 0.18)";
      ctx.fillRect(0, 0, L, H);

      // étoiles
      for (const e of etoiles) {
        const scint = 0.4 + 0.6 * Math.abs(Math.sin(t / 700 + e.a * 10));
        ctx.fillStyle = `rgba(200, 220, 255, ${0.35 * scint})`;
        ctx.fillRect(e.x, e.y, e.v * 1.4, e.v * 1.4);
      }

      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round"; // une particule immobile reste visible (un point) au lieu d'un trait de longueur nulle
      for (const p of particules) {
        p.px = p.x; p.py = p.y;
        if (t < T1) {
          // 1. explosion avec frottement
          p.x += p.vx; p.y += p.vy;
          p.vx *= 0.94; p.vy *= 0.94;
          p.vy += 0.05;
        } else if (t < T3) {
          // 2 et 3. rassemblement vers le nom, puis léger frémissement
          const k = Math.min(1, Math.max(0, ((t - T1) / DUREES.rassemblement - p.delai) / (1 - p.delai)));
          const e = adoucir(k);
          const bruit = t > T2 ? Math.sin(t / 180 + p.phase) * 0.6 : 0;
          p.x += (p.cx + bruit - p.x) * (0.06 + 0.25 * e);
          p.y += (p.cy + Math.cos(t / 210 + p.phase) * (t > T2 ? 0.6 : 0) - p.y) * (0.06 + 0.25 * e);
        } else {
          // 4. vitesse lumière : chaque particule file vers l'extérieur en accélérant
          const k = (t - T3) / DUREES.warp;
          const dx = p.x - cx, dy = p.y - cy;
          const d = Math.hypot(dx, dy) || 1;
          const acc = 1 + 60 * k * k;
          p.x += dx / d * acc + dx * 0.02 * k;
          p.y += dy / d * acc + dy * 0.02 * k;
        }

        const brille = t > T2 && t < T3 ? 0.75 + 0.25 * Math.sin(t / 120 + p.phase) : 1;
        ctx.strokeStyle = p.couleur;
        ctx.globalAlpha = brille;
        ctx.lineWidth = t > T3 ? p.taille * 1.3 : p.taille;
        ctx.beginPath();
        ctx.moveTo(p.px, p.py);
        ctx.lineTo(p.x + 0.01, p.y + 0.01);
        ctx.stroke();
        // halo doux autour de chaque particule quand le nom est formé
        if (t > T1 + DUREES.rassemblement * 0.5 && t < T3) {
          ctx.globalAlpha = 0.12 * brille;
          ctx.lineWidth = p.taille * 5;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // halo lumineux au centre pendant la pause
      if (t > T2 - 300 && t < T4) {
        const force = t < T3 ? Math.min(1, (t - T2 + 300) / 600) : 1 - (t - T3) / DUREES.warp;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(L, H) * 0.45);
        g.addColorStop(0, `rgba(124, 92, 255, ${0.10 * force})`);
        g.addColorStop(1, "rgba(124, 92, 255, 0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, L, H);
      }

      if (t > T2 && !sousTitre.classList.contains("visible")) sousTitre.classList.add("visible");
      if (t > T3 && sousTitre.classList.contains("visible")) sousTitre.classList.add("sortie");
      if (t > T4 - 250) flash.classList.add("visible");
      if (t >= T4) { aller(); return; }
      idAnim = requestAnimationFrame(image);
    }
    ctx.fillStyle = "rgb(4, 6, 18)";
    ctx.fillRect(0, 0, L, H);
    idAnim = requestAnimationFrame(image);
    return { fermer };
  }

  // Dessine le texte sur un canvas invisible et renvoie les coordonnées des pixels allumés
  function pointsDuTexte(texte, L, H) {
    const c = document.createElement("canvas");
    c.width = L; c.height = H;
    const x = c.getContext("2d");
    const deuxLignes = L < 640;
    const lignes = deuxLignes ? texte.split(" ") : [texte];
    const taille = Math.floor(deuxLignes ? Math.min(L * 0.2, 110) : Math.min(L * 0.1, 150));
    x.fillStyle = "#fff";
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.font = `800 ${taille}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    // lignes centrées verticalement, un peu au-dessus du milieu pour laisser la place au sous-titre
    lignes.forEach((l, i) => x.fillText(l, L / 2, H * 0.45 + (i - (lignes.length - 1) / 2) * taille * 1.05));
    const donnees = x.getImageData(0, 0, L, H).data;
    const pas = Math.max(3, Math.round(taille / 22));
    const points = [];
    for (let py = 0; py < H; py += pas) {
      for (let px = 0; px < L; px += pas) {
        if (donnees[(py * L + px) * 4 + 3] > 128) points.push({ x: px, y: py });
      }
    }
    // mélange pour que les particules arrivent de partout
    for (let i = points.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [points[i], points[j]] = [points[j], points[i]]; }
    return points.length ? points : [{ x: L / 2, y: H / 2 }];
  }
})();
