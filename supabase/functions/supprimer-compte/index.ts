import { supprimerCompte } from "../_partage/comptes.js";
Deno.serve((req: Request) => supprimerCompte(req, Deno.env.toObject()));
