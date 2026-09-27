/*
 * Infobulles des termes techniques (survol sur ordinateur, appui sur mobile). Partagé par toutes les pages.
 */

const bulle = document.getElementById("infobulle");
let termeActif = null;

function montrerBulle(el) {
  termeActif = el;
  bulle.textContent = GLOSSAIRE[el.dataset.terme];
  bulle.hidden = false;
  if (window.innerWidth < 640) {
    bulle.className = "bulle-mobile"; // affichée en bas de l'écran (voir CSS)
    return;
  }
  bulle.className = "";
  const r = el.getBoundingClientRect();
  const largeur = bulle.offsetWidth;
  const gauche = Math.min(Math.max(8, r.left + r.width / 2 - largeur / 2), window.innerWidth - largeur - 8);
  let haut = r.top - bulle.offsetHeight - 8;
  if (haut < 8) haut = r.bottom + 8;
  bulle.style.left = gauche + "px";
  bulle.style.top = haut + "px";
}

function cacherBulle() {
  bulle.hidden = true;
  termeActif = null;
}

document.addEventListener("click", e => {
  const el = e.target.closest(".terme");
  if (el) {
    montrerBulle(el); // un appui ailleurs sur la page la referme
  } else if (!e.target.closest("#infobulle")) {
    cacherBulle();
  }
});
document.addEventListener("mouseover", e => {
  const el = e.target.closest(".terme");
  if (el && window.matchMedia("(hover: hover)").matches) montrerBulle(el);
});
document.addEventListener("mouseout", e => {
  if (e.target.closest(".terme") && window.matchMedia("(hover: hover)").matches) cacherBulle();
});
document.addEventListener("focusin", e => { if (e.target.matches(".terme")) montrerBulle(e.target); });
document.addEventListener("focusout", e => { if (e.target.matches(".terme")) cacherBulle(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") cacherBulle(); });
window.addEventListener("scroll", () => { if (window.innerWidth >= 640) cacherBulle(); }, { passive: true });
